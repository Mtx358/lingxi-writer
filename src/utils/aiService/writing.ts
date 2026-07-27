import type { Chapter, Character, ProjectSettingCard, BlueprintOverview, SensitiveWordHit, SensitiveWordCheckResult, PlatformTagRecommendation, ExportPlatform } from '@/types';
import { NOVEL_SYSTEM_PROMPT, type StreamHandler } from '../llmClient';
import { humanizeWithAITraceCheck, defaultHumanizeOptions, humanizeIntensityForExpand, parseJsonFromLLM, getLLMClient } from './core';
import { SENSITIVE_WORDS, HIGH_SEVERITY_SENSITIVE_WORDS } from '@/constants/config';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';

/**
 * 按自由指令生成正文（灵犀写作 3.2）。
 * 与续写不同：用户输入详细写作指令，AI 据此生成该节拍/段落的正文。
 */
export async function generateWritingByInstruction(
  instruction: string,
  context: {
    chapterContent: string;
    chapterSummary?: string;
    characters: Character[];
    settingCard?: ProjectSettingCard;
    blueprint?: BlueprintOverview;
    beatContent?: string;
  },
  handler: StreamHandler,
  signal?: AbortSignal,
): Promise<string> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  const plainText = context.chapterContent.replace(/<[^>]*>/g, '').slice(-1500);
  const charDigest = context.characters.slice(0, 5).map(c =>
    `- ${c.name}（${c.role}）：${c.profile?.personality || ''}｜目标：${c.profile?.goal || '未指定'}`
  ).join('\n');
  const blueprintDigest = context.blueprint
    ? `主线：${context.blueprint.mainline}\n主角弧光：${context.blueprint.growthArc.map(g => g.fromState + '→' + g.toState).join('；')}`
    : '（未锁定蓝图）';

  const prompt = `请按照创作者的写作指令生成一段小说正文。

【写作指令】
${instruction}

【本章蓝图节拍（若有）】
${context.beatContent || '（无）'}

【本章概要】
${context.chapterSummary || '（无）'}

【本章前文末尾】
${plainText || '（章首）'}

【本章涉及角色】
${charDigest || '（无）'}

【故事蓝图】
${blueprintDigest}

【情感基调】${context.settingCard?.emotionalTone || '未指定'}
【主角金手指】${context.settingCard?.protagonist.goldenFinger || '未指定'}

要求：
1. 严格遵循写作指令中的细节、风格、节奏要求
2. 保持与前文的语感连贯
3. 字数 800-2000 字
4. 不输出任何解释，只输出正文`;

  // Mock 分支：与 generateContinuationStream 等保持一致，避免 mock 模式下 callLLMStream 抛错导致 UI 崩溃
  if (settings.provider === 'mock') {
    const mockContent = `<p>${instruction.slice(0, 8)}……他望着眼前的景象，心中掠过一丝难以言说的复杂。</p>` +
      `<p>风从远处吹来，带着熟悉的气息。${context.characters[0]?.name || '他'}握紧了拳头。</p>` +
      `<p>前路漫长，但有些事，终究无法回避。</p>`;
    // 模拟流式输出，让 UI 的 streamingContent 有渐进反馈
    for (const chunk of mockContent.match(/<p>[^<]*<\/p>/g) || [mockContent]) {
      if (signal?.aborted) {
        // 与 LLM 分支（下方 if (signal?.aborted) return content）保持一致：
        // 用户主动取消不触发 onError，避免 useEditorAI 弹出"AI 生成失败"误导 toast
        return '';
      }
      handler.onChunk(chunk);
      await new Promise(r => setTimeout(r, 80));
    }
    // 与其他生成函数一致：mock 内容也走 humanizeWithAITraceCheck，保证 mock/LLM 行为一致
    try {
      const humanized = humanizeWithAITraceCheck(mockContent, defaultHumanizeOptions(humanizeIntensityForExpand()));
      handler?.onComplete(humanized);
      return humanized;
    } catch (e) {
      console.warn('humanizeWritingByInstruction(mock) failed:', e);
      handler?.onComplete(mockContent);
      return mockContent;
    }
  }

  // LLM 分支：包 try/catch，错误时触发 handler.onError 并返回空串，
  // 与 polishTextStream 等保持一致，避免错误冒泡让 UI 卡在"生成中"
  // 包装 handler：抑制原始 onComplete，改为在 humanize 后回调，
  // 否则 useEditorAI 的 onComplete 会用 raw streaming buffer 写入编辑器，
  // 导致真人化后的最终内容被丢弃（与 polishTextStream 同样的 HIGH 严重 bug）
  const wrappedHandler: StreamHandler | undefined = handler
    ? {
        onChunk: handler.onChunk,
        onComplete: () => { /* 延迟到 humanize 后再回调 */ },
        // 抑制内部 onError：callLLMStream 内部 catch 会先 onError 再 throw err，
        // 错误由本函数外层 catch 统一回调 handler?.onError，避免 useEditorAI 收到两次错误 toast
        onError: () => {},
      }
    : undefined;
  let content = '';
  try {
    content = await llmClient.callLLMStream(prompt, NOVEL_SYSTEM_PROMPT, wrappedHandler, signal);
  } catch (e) {
    const msg = getErrorMessage(e);
    console.warn('generateWritingByInstruction failed:', msg);
    handler?.onError?.(e instanceof Error ? e : new Error(msg));
    return '';
  }

  // 中止后不再 humanize/onComplete，避免向已取消/卸载的调用方回调
  if (signal?.aborted) return content;

  // 真人化处理：与其他生成函数一致，走 humanizeWithAITraceCheck 完成 AI 痕迹检测 + 二次降 AI
  // ensureHtmlParagraphs 兜底：LLM 可能返回纯文本（无 <p> 标签），humanize 阶段需要结构化输入
  if (content) {
    try {
      const html = llmClient.ensureHtmlParagraphs(content);
      const humanized = humanizeWithAITraceCheck(html, defaultHumanizeOptions(humanizeIntensityForExpand()));
      handler?.onComplete(humanized);
      return humanized;
    } catch (e) {
      console.warn('humanizeWritingByInstruction failed:', e);
      // 真人化失败时已返回原始生成内容，AI 率可能偏高，提示用户手动降 AI
      toast.warning('真人化处理失败', '已返回原始生成内容，AI 率可能偏高，建议手动降 AI');
      handler?.onComplete(content);
      return content;
    }
  }
  return content;
}

/**
 * 生成多版本正文供选择（灵犀写作 3.2）。
 * 并发调用 generateWritingByInstruction 3 次（不同 temperature 偏移）。
 */
export async function generateMultipleVersions(
  instruction: string,
  context: {
    chapterContent: string;
    chapterSummary?: string;
    characters: Character[];
    settingCard?: ProjectSettingCard;
    blueprint?: BlueprintOverview;
    beatContent?: string;
  },
  count: number = 3,
  signal?: AbortSignal,
): Promise<string[]> {
  const llmClient = getLLMClient();
  const baseSettings = llmClient.getSettings();
  const baseTemp = baseSettings.temperature;

  // Mock 分支：直接生成 3 个差异化 mock 版本，避免依赖 generateWritingByInstruction 的 mock 流程
  // 也避免在 mock 模式下做无意义的 temperature 偏移
  if (baseSettings.provider === 'mock') {
    const styles = [
      `<p>版本一：${instruction.slice(0, 6)}——他缓缓开口，声音低沉却坚定。</p><p>夜色渐深，决定已成。</p>`,
      `<p>版本二：风掠过耳畔，${context.characters[0]?.name || '他'}没有回头。</p><p>"该走的路，总要走完。"他轻声说。</p>`,
      `<p>版本三：突如其来的声响打破了寂静。他握紧手中的物事，目光沉了下去。</p><p>该来的，终究还是来了。</p>`,
    ];
    return styles.slice(0, Math.min(count, 3));
  }

  // 不同 temperature 偏移生成不同风格版本
  // 三个 task 在 for 循环中同步 push，各自在 push 瞬间同步执行到 callLLMStreamViaProxy 内
  // `const { temperature } = this.settings` 同步快照（llmClient.ts:405），因此每个 task
  // 各自得到不同的 temperature（0 / -0.2 / +0.2），不会互相污染。
  // finally 恢复 baseTemp：三个 task 同步快照后全局 settings.temperature 留在 base+0.2，
  // 不恢复会污染后续 LLM 调用。
  //
  // ⚠️ 耦合约束（H4）：此实现依赖 callLLMStreamViaProxy 在调用入口同步读取 this.settings.temperature，
  //    而非在异步 IPC 发起时延迟读取。若后续重构 llmClient 使 temperature 读取延迟到异步阶段，
  //    三个 task 会共用同一个 temperature 值（最后一个 task 的 base+0.2），失去差异化。
  //    正确修复需将 temperature 作为显式参数透传 callLLMStream → callLLMStreamViaProxy →
  //    resolveEndpoint，但涉及多个调用点，需配套调整 llmClient 公开 API，暂以注释约束。
  const tempOffsets = [0, -0.2, 0.2];
  const tasks: Promise<string>[] = [];
  try {
    for (let i = 0; i < Math.min(count, 3); i++) {
      const offset = tempOffsets[i % tempOffsets.length];
      const adjusted = Math.max(0.1, Math.min(1.5, baseTemp + offset));
      llmClient.updateSettings({ ...baseSettings, temperature: adjusted });
      const handler: StreamHandler = {
        onChunk: () => {},  // 多版本不流式反馈，统一等待
        onComplete: () => {},
        onError: () => {},
      };
      tasks.push(generateWritingByInstruction(instruction, context, handler, signal));
    }
    const results = await Promise.allSettled(tasks);
    // 三个 task 已在入口同步快照 temperature，Promise.allSettled 完成后立即恢复
    // 到原始值，不依赖 finally 时机，缩小全局 temperature 污染窗口
    // （否则等待 versions 计算与 return 期间全局 settings.temperature 仍停在 base+0.2）
    llmClient.updateSettings({ ...baseSettings, temperature: baseTemp });
    const versions = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled' && !!r.value)
      .map(r => r.value);
    return versions.length > 0 ? versions : [];
  } finally {
    // 兜底：确保即使上方逻辑或 task 抛错也能恢复原始 temperature
    llmClient.updateSettings({ ...baseSettings, temperature: baseTemp });
  }
}

/**
 * 全书润色建议清单（灵犀打磨 4.3）。
 */
export async function generateFullBookReview(
  chapters: Chapter[],
): Promise<{
  issues: { type: 'rhythm' | 'consistency' | 'repetition' | 'pacing'; chapterId?: string; description: string; suggestion: string; priority: 'high' | 'medium' | 'low' }[];
  summary: string;
}> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const topChapters = chapters.filter(c => c.levelType === 'chapter');

  if (settings.provider !== 'mock' && topChapters.length > 0) {
    try {
      const digest = topChapters.slice(0, 50).map((c, i) =>
        `第${i + 1}章「${c.title}」（${c.wordCount}字）：${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 100)}`
      ).join('\n');
      const prompt = `请通读以下全书章节摘要，生成《全书润色建议清单》。
返回 JSON：
{
  "summary": "整体评价（80-200字）",
  "issues": [
    {
      "type": "rhythm|consistency|repetition|pacing",
      "chapterIndex": 1,
      "description": "问题简述（30-80字）",
      "suggestion": "建议（30-100字）",
      "priority": "high|medium|low"
    }
  ]
}

【全书章节摘要】
${digest}

只返回 JSON 对象。最多 10 条 issues。`;
      const result = await llmClient.callLLM(prompt, '你是资深网文编辑，擅长通读全书发现节奏/一致性/重复/节奏问题。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed && typeof parsed === 'object') {
        const validType = ['rhythm', 'consistency', 'repetition', 'pacing'];
        const validPriority = ['high', 'medium', 'low'];
        const issues = Array.isArray(parsed.issues)
          ? parsed.issues
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map(r => {
                const chapterIdx = Number(r.chapterIndex);
                const chapter = chapterIdx > 0 ? topChapters[chapterIdx - 1] : undefined;
                return {
                  type: validType.includes(String(r.type)) ? String(r.type) as 'rhythm' | 'consistency' | 'repetition' | 'pacing' : 'pacing',
                  chapterId: chapter?.id,
                  description: String(r.description || '').slice(0, 200),
                  suggestion: String(r.suggestion || '').slice(0, 300),
                  priority: validPriority.includes(String(r.priority)) ? String(r.priority) as 'high' | 'medium' | 'low' : 'medium',
                };
              })
              .filter(i => i.description)
              .slice(0, 10)
          : [];
        return {
          issues,
          summary: String(parsed.summary || '').slice(0, 500),
        };
      }
    } catch (e) {
      console.warn('AI generateFullBookReview failed, falling back to mock:', e);
    }
  }
  await llmClient.delay(500);
  // Mock：基于章节字数分布给出可读建议
  const issues: { type: 'rhythm' | 'consistency' | 'repetition' | 'pacing'; chapterId?: string; description: string; suggestion: string; priority: 'high' | 'medium' | 'low' }[] = [];
  topChapters.forEach((c, i) => {
    if (c.wordCount < 800) {
      issues.push({
        type: 'pacing',
        chapterId: c.id,
        description: `第${i + 1}章「${c.title}」字数偏少（${c.wordCount}字）`,
        suggestion: '考虑补充场景细节或对话，避免章节过于单薄',
        priority: 'low',
      });
    } else if (c.wordCount > 6000) {
      issues.push({
        type: 'pacing',
        chapterId: c.id,
        description: `第${i + 1}章「${c.title}」字数偏多（${c.wordCount}字）`,
        suggestion: '考虑拆分为两章，或在节点处设置章末钩子',
        priority: 'medium',
      });
    }
  });
  if (topChapters.length > 5) {
    issues.push({
      type: 'rhythm',
      description: '建议检查第 3-5 章是否设置了第一个小高潮',
      suggestion: '网文通常在第 3 章前后给出第一个爽点，留住读者',
      priority: 'high',
    });
  }
  return {
    issues: issues.slice(0, 10),
    summary: topChapters.length === 0
      ? '尚无章节内容，无法通读'
      : `全书共 ${topChapters.length} 章，建议关注章节字数分布与节奏起伏。`,
  };
}

/**
 * 优化简介（灵犀发布 5.2）——按平台风格改写。
 */
export async function optimizeSynopsis(
  synopsis: string,
  platform: ExportPlatform,
  settingCard?: ProjectSettingCard,
): Promise<string> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const platformStyle: Record<ExportPlatform, string> = {
    general: '通用风格，简洁有力',
    qidian: '起点风格，强调爽点与设定，前 50 字必须抓住读者',
    fanqie: '番茄风格，节奏快、爽点密，适合短章节阅读',
    jjwxc: '晋江风格，重情感细腻描写，可略带文艺',
    qimao: '七猫风格，节奏快、悬念多，每章结尾留钩子',
    wechat: '微信读书风格，偏向精品向，重视文笔',
  };

  if (settings.provider !== 'mock') {
    try {
      const genreHint = settingCard ? `类型：${settingCard.genreTags.join(' / ')}；情感基调：${settingCard.emotionalTone}` : '';
      const prompt = `请按以下平台风格改写这段简介，使其在该平台更有吸引力。

【原简介】
${synopsis}

【目标平台】${platform}
【平台风格要求】${platformStyle[platform]}
${genreHint ? `【作品定位】${genreHint}` : ''}

要求：
1. 字数 100-300 字
2. 突出爽点/悬念/情感（按平台侧重）
3. 不输出任何解释，只输出改写后的简介`;
      const result = await llmClient.callLLM(prompt, '你是网文简介优化专家。只输出改写后的简介，不加任何说明。');
      if (result && result.trim()) return result.trim().slice(0, 500);
    } catch (e) {
      console.warn('AI optimizeSynopsis failed, falling back to mock:', e);
    }
  }
  await llmClient.delay(300);
  // Mock：按平台风格简单截断或拼接
  if (synopsis.length > 200 && (platform === 'qidian' || platform === 'fanqie' || platform === 'qimao')) {
    return synopsis.slice(0, 180) + '……（更多精彩等你揭晓）';
  }
  return synopsis;
}

/**
 * 推荐平台标签与分类（灵犀发布 5.2）。
 */
export async function recommendPlatformTags(
  settingCard?: ProjectSettingCard,
  synopsis?: string,
): Promise<PlatformTagRecommendation> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = `请基于以下作品信息，推荐适合的网文标签和分类。

【书名】${settingCard?.title || '（未填）'}
【类型标签】${settingCard?.genreTags.join(' / ') || '（未填）'}
【情感基调】${settingCard?.emotionalTone || '（未填）'}
【感情线】${settingCard?.romanceType || '（未填）'}
【简介】${synopsis || '（未填）'}

返回 JSON：
{
  "tags": ["标签1", "标签2", "标签3"],
  "categories": ["分类1", "分类2"],
  "reason": "推荐理由（50-100字）"
}

标签 5-8 个，分类 1-3 个。只返回 JSON 对象。`;
      const result = await llmClient.callLLM(prompt, '你是网文运营专家，熟悉各平台标签体系。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed && typeof parsed === 'object') {
        return {
          tags: Array.isArray(parsed.tags)
            ? parsed.tags.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 20)).slice(0, 8)
            : [],
          categories: Array.isArray(parsed.categories)
            ? parsed.categories.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 20)).slice(0, 3)
            : [],
          reason: String(parsed.reason || '').slice(0, 200),
        };
      }
    } catch (e) {
      console.warn('AI recommendPlatformTags failed, falling back to mock:', e);
    }
  }
  await llmClient.delay(300);
  // Mock：基于设定卡字段映射
  const tags: string[] = [];
  const categories: string[] = [];
  settingCard?.genreTags.forEach(g => {
    tags.push(g);
    categories.push(g);
  });
  if (settingCard?.emotionalTone === 'cool') tags.push('爽文', '逆袭');
  if (settingCard?.emotionalTone === 'hot-blooded') tags.push('热血', '战斗');
  if (settingCard?.emotionalTone === 'light') tags.push('轻松', '日常');
  if (settingCard?.romanceType === 'harem') tags.push('后宫');
  if (settingCard?.romanceType === 'single') tags.push('专一');
  return {
    tags: tags.slice(0, 6),
    categories: categories.slice(0, 2),
    reason: '基于作品类型与情感基调推荐',
  };
}

/**
 * 敏感词过滤（灵犀发布 5.2）——本地词库 + 简单匹配，无 LLM 调用。
 * 词库已抽取到 @/constants/config 便于统一维护。
 */

export function filterSensitiveWords(
  chapters: Chapter[],
  options?: { extraWords?: string[] },
): SensitiveWordCheckResult {
  const words = [...SENSITIVE_WORDS, ...(options?.extraWords || [])];
  const hits: SensitiveWordHit[] = [];
  // key 为 `${chapterId}:${pIdx}`，避免不同章节的同序号段落互相覆盖
  const byParagraph: Record<string, number> = {};

  chapters.forEach(chapter => {
    const html = chapter.content || '';
    // 按段落分割（<p> 或 <br>）
    const paragraphs = html
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .split(/\n+/)
      .map(p => p.trim())
      .filter(Boolean);

    paragraphs.forEach((para, pIdx) => {
      const lower = para.toLowerCase();
      const paraKey = `${chapter.id}:${pIdx}`;
      words.forEach(word => {
        const wordLower = word.toLowerCase();
        // 循环查找段落内所有出现位置，而非只取首个；
        // 否则同段多次命中会被低估，误导作者评估整改工作量
        let from = 0;
        let idx = lower.indexOf(wordLower, from);
        while (idx !== -1) {
          const contextStart = Math.max(0, idx - 10);
          const contextEnd = Math.min(para.length, idx + word.length + 10);
          hits.push({
            word,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            paragraphIndex: pIdx,
            context: para.slice(contextStart, contextEnd),
            severity: HIGH_SEVERITY_SENSITIVE_WORDS.includes(word) ? 'high' : 'medium',
            suggestion: '请替换或删除该词',
          });
          byParagraph[paraKey] = (byParagraph[paraKey] || 0) + 1;
          from = idx + word.length;
          idx = lower.indexOf(wordLower, from);
        }
      });
    });
  });

  return {
    totalHits: hits.length,
    hits,
    byParagraph,
  };
}
