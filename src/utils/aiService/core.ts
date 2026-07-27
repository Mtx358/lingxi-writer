import type { AISettings } from '@/types';
import { fullHumanize, type HumanizeOptions } from '../humanizeText';
import { llmClient as defaultLLMClient, NOVEL_SYSTEM_PROMPT, type StreamHandler, type LLMClient } from '../llmClient';
import { detectAITrace, STRICTEST_THRESHOLD } from '../aiTraceDetector';
import { deAIByReport } from '../deAIRewriter';

/**
 * AI 能力门面（facade）——共享层
 *
 * 此模块承载 LLMClient 的设置/连接/token 计数等能力的薄包装，以及所有
 * 能力域共享的小工具（真人化后处理、JSON 解析、风格分析等）。各能力域
 * 模块通过 `import { ... } from './core'` 复用这些 helper。
 */

// ==================== llmClient 可注入化 ====================
//
// 问题背景：原实现中各 aiService 子模块 `import { llmClient } from '../llmClient'`
// 直接引用模块级单例，测试无法注入 mock——只能用 vi.spyOn 替换单例方法，
// 无法替换整个 client 实例（如需测试"settings 隔离""并发任务互不污染"等场景）。
//
// 方案：在 core 维护可替换的 activeLLMClient（默认指向单例），子模块统一通过
// getLLMClient() 取用。测试可 setLLMClient(mockClient) 注入隔离实例，结束后恢复。
//
// activeLLMClient 为 let：setLLMClient 重新赋值后，后续 getLLMClient() 调用立即生效。
// 各能力域函数在调用入口取 client（而非模块加载时缓存），保证注入在调用时生效
let activeLLMClient: LLMClient = defaultLLMClient;

/**
 * 注入自定义 LLMClient（主要用于测试）。调用后所有 aiService 子模块立即改用新实例。
 *
 * 生产环境守卫：渲染层被 XSS 后即使能 import 到 setLLMClient，也无法替换 client
 * 窃取 prompt/apiKey（生产构建 import.meta.env.DEV=false，函数 no-op 并告警）。
 *
 * - import.meta.env.DEV 在 vite dev server 与 vitest 下均为 true（vitest 默认 mode='test'，
 *   非 production 时 DEV=true）；额外判断 MODE==='test' 兜底某些环境下 DEV 未正确注入。
 * - client=null 视为"重置为默认单例"：测试结束后无 client 引用时可传 null 复位，
 *   避免外部必须 import defaultLLMClient 才能复位。
 */
export function setLLMClient(client: LLMClient | null): void {
  if (!import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    console.warn('setLLMClient is only available in development');
    return;
  }
  activeLLMClient = client ?? defaultLLMClient;
}

/** 取当前激活的 LLMClient。子模块统一通过本函数获取，避免硬编码单例 */
export function getLLMClient(): LLMClient {
  return activeLLMClient;
}

// 复用 LLMClient 上的设置/连接测试/token 计数能力
// 引用 activeLLMClient（而非导入的单例），使 setLLMClient 注入对这些包装函数生效
export const updateSettings = (s: Partial<AISettings>) => activeLLMClient.updateSettings(s);
export const getSettings = (): AISettings => activeLLMClient.getSettings();
export const getTotalTokensUsed = (): number => activeLLMClient.getTotalTokensUsed();
export const testConnection = () => activeLLMClient.testConnection();

// 透传共享类型与系统提示
export type { StreamHandler };
export { NOVEL_SYSTEM_PROMPT };

// ==================== 共享小工具 ====================

// 根据当前 strictness 设置推导真人化强度
export function humanizeIntensityForExpand(): number {
  const { strictness } = activeLLMClient.getSettings();
  return strictness > 70 ? 40 : strictness > 40 ? 60 : 80;
}

/**
 * 从可能含有前后噪声文本的字符串中提取首个完整 JSON 数组或对象。
 *
 * 实现理由：直接用贪婪正则 `[\s\S]*` 会在 LLM 输出形如
 *   "好的，[解释] [{...JSON...}]"
 * 时把首尾括号间的所有内容（含解释文本）吞掉；而非贪婪 `[\s\S]*?`
 * 又会在嵌套结构（如 `[{seeds:[...]}]`）的内部 `]` 处提前截断，导致
 * 解析失败。此处用括号深度计数 + 字符串/转义识别，正确处理嵌套。
 *
 * 仅追踪与起始括号同类型的开闭字符，另一类型括号视为普通字符不计入深度
 * （JSON 中两种括号天然配对，互不嵌套出错）。
 */
function extractBalancedJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;
  // 最大扫描字符数上限：防恶意 LLM 返回超长未闭合结构导致长时间循环
  // 200000 字符足够覆盖任何合法 JSON 响应，超出视为攻击/异常直接放弃
  const MAX_SCAN = 200000;
  const endLimit = Math.min(text.length, start + MAX_SCAN);
  for (let i = start; i < endLimit; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 尝试从 LLM 文本中解析 JSON：先直接 parse，失败则用括号平衡算法提取首个
 * JSON 片段再 parse。返回解析后的值，或 null（解析失败）。
 */
export function parseJsonFromLLM<T>(text: string): T | null {
  // 响应体积上限：防恶意 LLM 返回超长响应导致 JSON.parse 触发 OOM。
  // 1MB 远超任何合法小说 AI 接口响应，超出直接判失败
  if (text.length > 1024 * 1024) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const extracted = extractBalancedJson(trimmed);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted) as T;
    } catch {
      return null;
    }
  }
}

export function humanizeIntensityForContinue(): number {
  const { strictness } = activeLLMClient.getSettings();
  return strictness > 70 ? 30 : strictness > 40 ? 50 : 70;
}
export function defaultHumanizeOptions(intensity: number): HumanizeOptions {
  return { intensity, style: 'novel', preserveMeaning: true };
}

/**
 * 真人化 + AI 痕迹检测 + 二次降 AI 的统一后处理流程。
 *
 * 流程：
 *   1. fullHumanize 随机扰动（填充词/感官/句长变化/对话标签替换）
 *   2. detectAITrace 检测 AI 痕迹分数
 *   3. 若 aiRate > STRICTEST_THRESHOLD（最严格平台阈值=10），则 deAIByReport 定向修复
 *   4. 再检测一次，若仍超标则保留修复结果（至少比原版好）
 *
 * 这样保证所有 AI 生成正文都经过最严格平台标准的 AI 率把关。
 * 返回处理后的 HTML。
 */
export function humanizeWithAITraceCheck(html: string, options: HumanizeOptions): string {
  // 第 1 步：随机真人化扰动
  let result = fullHumanize(html, options);

  // 第 2 步：检测 AI 痕迹
  let report = detectAITrace(result);

  // 第 3 步：若超过最严格平台阈值，进入定向降 AI
  if (report.aiRate > STRICTEST_THRESHOLD) {
    result = deAIByReport(result, report);
    // 第 4 步：再检测一次确认效果
    report = detectAITrace(result);
    // 若仍超标，记录日志（不阻断流程，已尽力优化）
    if (report.aiRate > STRICTEST_THRESHOLD) {
      console.info(`[AI后处理] 二次降 AI 后仍超严格阈值：${report.aiRate.toFixed(1)}% > ${STRICTEST_THRESHOLD}%，建议人工润色`);
    }
  }

  return result;
}

// 分析当前文本风格（人称/对话/句式），用于续写时延续原文风格
export function analyzeContextStyle(text: string): string {
  const features: string[] = [];
  if (text.includes('我')) features.push('第一人称');
  else if (text.match(/他|她/)) features.push('第三人称');
  if (text.match(/"[^"]+"/)) features.push('有对话');
  if (text.match(/。.{0,5}。/)) features.push('短句为主');
  else features.push('长句为主');
  return features.join('、');
}
