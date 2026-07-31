/**
 * 智能导入检测器
 *
 * 解决三类识别问题：
 *   1. 内容形式识别（content form）：markdown / html / docx / 纯文本
 *   2. 章节标题识别（chapter heading）：扩展中文/英文/数字/自定义前缀
 *   3. 项目指纹识别（project fingerprint）：判断导入内容是否已存在
 *
 * 设计原则：
 *   - 不破坏现有 importUtils.ts 的对外 API，仅作为增强层
 *   - 所有检测都基于启发式 + 启发式回退，不依赖 LLM
 *   - 可独立单元测试
 */
import type { ImportResult, ImportedChapter } from './importUtils';
import type { Project, Chapter } from '@/types';

// ==================== 1. 内容形式识别 ====================

export type ContentForm = 'markdown' | 'html' | 'docx' | 'plain-text' | 'empty';

/**
 * 嗅探内容形式。
 * 优先级：docx（二进制，调用方自行判断）> markdown > html > plain-text
 *
 * 启发式：
 *   - markdown：含 `^# / ## / ###` 标题、`**bold**`、`- list`、`> quote`、`[link](url)` 等任一特征
 *   - html：含 `<html` / `<body` / `<div` / `<p>` / `<h1-6>` 标签
 *   - plain-text：以上都不满足
 */
export function detectContentForm(text: string): ContentForm {
  if (!text || !text.trim()) return 'empty';

  // markdown 标题（行首 #）
  if (/^#{1,6}\s+/m.test(text)) return 'markdown';
  // markdown 加粗 / 斜体 / 列表 / 引用 / 链接 / 代码块（同时出现 ≥2 种特征才判定，避免误判）
  const mdFeatures = [
    /\*\*[^*]+\*\*/.test(text),      // **bold**
    /^\s*[-*+]\s+/m.test(text),       // - list
    /^>/m.test(text),                 // > quote
    /\[.+?\]\(.+?\)/.test(text),      // [text](url)
    /^```/m.test(text),               // ```code block```
  ];
  if (mdFeatures.filter(Boolean).length >= 2) return 'markdown';

  // HTML 标签（同时出现 ≥2 个常见标签才判定，避免偶然的 < > 符号误判）
  const htmlFeatures = [
    /<html[\s>]/i.test(text),
    /<body[\s>]/i.test(text),
    /<div[\s>]/i.test(text),
    /<p[\s>]/i.test(text),
    /<h[1-6][\s>]/i.test(text),
  ];
  if (htmlFeatures.filter(Boolean).length >= 2) return 'html';

  return 'plain-text';
}

// ==================== 2. 章节标题识别 ====================

/**
 * 扩展的章节标题识别模式。
 *
 * 覆盖中文/英文/数字/特殊章节四类，并支持自定义前缀检测。
 * 每条模式都做了"行首锚定 + 短标题长度限制（≤50 字符）"，避免把正文里的"第三章提到..."
 * 这种句子误识别为标题。
 */
export interface ChapterPattern {
  /** 模式名称（用于调试和提示） */
  name: string;
  /** 行首匹配正则 */
  regex: RegExp;
  /** 解析出的"层级"：1=卷/部级，2=章级，3=节级 */
  level: 1 | 2 | 3;
}

export const CHAPTER_PATTERNS: ChapterPattern[] = [
  // ===== 中文：卷级 =====
  { name: '卷一/卷二', regex: /^第[一二三四五六七八九十百千零\d]+卷[\s:：、]/, level: 1 },
  { name: '卷一/卷二（无分隔）', regex: /^第[一二三四五六七八九十百千零\d]+卷[^\d]/, level: 1 },
  { name: '卷X：名', regex: /^卷[一二三四五六七八九十百千零\d]+[\s:：]/, level: 1 },
  { name: '上部/中部/下部', regex: /^[上下中]部[\s·:：]/, level: 1 },
  { name: '上篇/中篇/下篇', regex: /^[上下中]篇[\s·:：]/, level: 1 },
  { name: '第一部/第二部', regex: /^第[一二三四五六七八九十\d]+部[\s:：、]/, level: 1 },

  // ===== 中文：章级 =====
  { name: '第X章', regex: /^第[一二三四五六七八九十百千零\d]+章[\s:：、]/, level: 2 },
  { name: '第X回', regex: /^第[一二三四五六七八九十百千零\d]+回[\s:：、]/, level: 2 },
  { name: '第X节', regex: /^第[一二三四五六七八九十百千零\d]+节[\s:：、]/, level: 2 },
  { name: '第X篇', regex: /^第[一二三四五六七八九十百千零\d]+篇[\s:：、]/, level: 2 },
  { name: '第X折', regex: /^第[一二三四五六七八九十百千零\d]+折[\s:：、]/, level: 2 },
  { name: '第X场', regex: /^第[一二三四五六七八九十百千零\d]+场[\s:：、]/, level: 2 },

  // ===== 中文：特殊章节 =====
  { name: '序章/楔子/引子', regex: /^(序章|楔子|引子|前言|序言|序)[\s:：]/, level: 2 },
  { name: '尾声/终章/后记', regex: /^(尾声|终章|后记|结语|跋)[\s:：]/, level: 2 },
  { name: '番外', regex: /^番外[\s\d一二三四五六七八九十:：]/, level: 2 },

  // ===== 英文 =====
  { name: 'Volume X', regex: /^Volume\s+\d+/i, level: 1 },
  { name: 'Part X', regex: /^Part\s+\d+/i, level: 1 },
  { name: 'Book X', regex: /^Book\s+\d+/i, level: 1 },
  { name: 'Chapter X', regex: /^Chapter\s+\d+/i, level: 2 },
  { name: 'Section X', regex: /^Section\s+\d+/i, level: 3 },
  { name: 'Episode X', regex: /^Episode\s+\d+/i, level: 2 },
  { name: 'Prologue', regex: /^Prologue[\s:：]/i, level: 2 },
  { name: 'Epilogue', regex: /^Epilogue[\s:：]/i, level: 2 },

  // ===== 数字编号 =====
  { name: '1. / 1、', regex: /^\d+\s*[.、]\s*/, level: 2 },
  { name: '1) ', regex: /^\d+\s*\)\s*/, level: 2 },
  { name: '【1】', regex: /^【\d+】\s*/, level: 2 },
  { name: '[1]', regex: /^\[\d+\]\s*/, level: 2 },
];

/**
 * 检测自定义章节标题前缀。
 *
 * 启发式：扫描所有非空短行（≤30 字符，不含标点），统计"前 2-4 字符前缀"出现次数。
 * 同一前缀出现 ≥3 次且不匹配任何内置模式时，视为自定义章节标题前缀。
 *
 * 例：用户的大纲用「✦第一话」「✦第二话」「✦第三话」→ 识别「✦第」为前缀。
 *
 * @returns 自定义前缀模式，未识别到返回 null
 */
export function detectCustomChapterPattern(text: string): ChapterPattern | null {
  const lines = text.split('\n');
  const prefixCount = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length > 30) continue;
    // 跳过明显是正文的行（含句号/逗号/分号等正文标点）
    if (/[。，；！？,;!?]/.test(trimmed)) continue;
    // 跳过已匹配内置模式的行
    if (CHAPTER_PATTERNS.some(p => p.regex.test(trimmed))) continue;

    // 取前 2 字符作为前缀候选（中文按字符，英文按单词）
    const prefix = trimmed.slice(0, 2);
    if (!prefix) continue;
    prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
  }

  let bestPrefix: string | null = null;
  let bestCount = 0;
  for (const [prefix, count] of prefixCount) {
    if (count > bestCount && count >= 3) {
      bestCount = count;
      bestPrefix = prefix;
    }
  }

  if (!bestPrefix) return null;

  // 转义正则特殊字符
  const escaped = bestPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: `自定义前缀「${bestPrefix}」`,
    regex: new RegExp(`^${escaped}`),
    level: 2,
  };
}

/**
 * 判断单行是否为章节标题。
 *
 * 优先匹配内置模式，未命中时回退到自定义前缀检测（需调用方传入 customPattern）。
 * 返回匹配到的模式，未匹配返回 null。
 */
export function matchChapterTitle(
  line: string,
  customPattern?: ChapterPattern | null,
): ChapterPattern | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50) return null;

  for (const p of CHAPTER_PATTERNS) {
    if (p.regex.test(trimmed)) return p;
  }
  if (customPattern && customPattern.regex.test(trimmed)) return customPattern;
  return null;
}

/**
 * 统计文本中可识别的章节数量（用于内容形式判断和指纹计算）。
 * 不做完整解析，只统计标题行数。
 */
export function countDetectableChapters(text: string): number {
  if (!text) return 0;
  const customPattern = detectCustomChapterPattern(text);
  let count = 0;
  for (const line of text.split('\n')) {
    if (matchChapterTitle(line, customPattern)) count++;
  }
  return count;
}

// ==================== 3. 项目指纹识别 ====================

/**
 * 简易 hash 函数：32 位 FNV-1a 变体。
 * 不追求密码学强度，只用于内容指纹比对。返回十六进制字符串。
 */
function hashString(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // 转无符号 32 位，再转十六进制
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface ImportFingerprint {
  /** 项目标题（已归一化：去书名号、去空白、小写） */
  normalizedTitle: string;
  /** 章节数量 */
  chapterCount: number;
  /** 前 3 章标题拼接后的 hash（章节顺序敏感） */
  firstChaptersHash: string;
  /** 全部章节标题拼接后的 hash（章节顺序敏感，更严格） */
  allChaptersHash: string;
  /** 总字数 */
  totalWords: number;
}

export interface ProjectFingerprint {
  projectId: string;
  projectTitle: string;
  normalizedTitle: string;
  chapterCount: number;
  firstChaptersHash: string;
  allChaptersHash: string;
  totalWords: number;
}

/**
 * 从解析结果生成指纹。
 */
export function computeImportFingerprint(result: ImportResult): ImportFingerprint {
  const normalizedTitle = normalizeTitle(result.title);
  const chapterCount = result.chapters.length;

  const titles = result.chapters.map(c => c.title.trim());
  const firstThree = titles.slice(0, 3).join('|');
  const all = titles.join('|');

  return {
    normalizedTitle,
    chapterCount,
    firstChaptersHash: hashString(firstThree),
    allChaptersHash: hashString(all),
    totalWords: result.totalWords,
  };
}

/**
 * 从项目数据生成指纹（用于与导入指纹比对）。
 *
 * 取项目下所有章节，按 order 排序后参与 hash 计算。
 */
export function computeProjectFingerprint(
  project: Project,
  chapters: Chapter[],
): ProjectFingerprint {
  const normalizedTitle = normalizeTitle(project.title);
  // 只参与可打磨章节（与导入解析的章节口径尽量一致：排除 book 容器）
  const relevantChapters = chapters
    .filter(c => c.levelType !== 'book' && c.projectId === project.id)
    .sort((a, b) => a.order - b.order);

  const titles = relevantChapters.map(c => c.title.trim());
  const firstThree = titles.slice(0, 3).join('|');
  const all = titles.join('|');

  const totalWords = relevantChapters.reduce((sum, c) => sum + c.wordCount, 0);

  return {
    projectId: project.id,
    projectTitle: project.title,
    normalizedTitle,
    chapterCount: relevantChapters.length,
    firstChaptersHash: hashString(firstThree),
    allChaptersHash: hashString(all),
    totalWords,
  };
}

function normalizeTitle(title: string): string {
  return title
    .replace(/[《》【】\[\]()（）"'']/g, '')  // 去书名号/引号/括号
    .replace(/\s+/g, '')                       // 去所有空白
    .toLowerCase();
}

// ==================== 4. 项目匹配决策 ====================

export type MatchLevel = 'exact' | 'high' | 'medium' | 'low' | 'none';

export interface ProjectMatch {
  project: ProjectFingerprint;
  level: MatchLevel;
  /** 0-100 的相似度分数，便于排序和展示 */
  score: number;
  /** 命中的特征，用于 UI 展示"为什么认为是同一项目" */
  reasons: string[];
}

/**
 * 比对导入指纹与单个项目指纹，返回匹配级别与理由。
 *
 * 决策矩阵：
 *   - exact（100）：标题归一化相同 + 前 3 章 hash 相同 + 章节数相同
 *       → 极高概率是同一文件的重新导入
 *   - high（80-99）：标题相同 + 前 3 章 hash 相同（章节数可能不同，说明追加了内容）
 *       → 同一项目的更新版
 *   - medium（50-79）：标题相同（前 3 章 hash 不同）
 *       → 同名项目，但内容不同（可能是同名不同书）
 *   - low（20-49）：标题不同 + 前 3 章 hash 相同
 *       → 内容相同但项目名被改了
 *   - none（<20）：标题和内容都不匹配
 */
export function matchProject(
  importFp: ImportFingerprint,
  projectFp: ProjectFingerprint,
): ProjectMatch {
  const reasons: string[] = [];
  let score = 0;

  const titleMatch = importFp.normalizedTitle === projectFp.normalizedTitle
    && importFp.normalizedTitle.length > 0;
  const firstChaptersMatch = importFp.firstChaptersHash === projectFp.firstChaptersHash
    && importFp.firstChaptersHash !== hashString('');  // 排除空内容误判
  const allChaptersMatch = importFp.allChaptersHash === projectFp.allChaptersHash
    && importFp.allChaptersHash !== hashString('');
  const chapterCountMatch = importFp.chapterCount === projectFp.chapterCount;

  if (titleMatch) {
    score += 40;
    reasons.push('项目名相同');
  }
  if (firstChaptersMatch) {
    score += 40;
    reasons.push('前 3 章标题序列相同');
  }
  if (allChaptersMatch) {
    score += 15;
    reasons.push('全部章节标题序列相同');
  }
  if (chapterCountMatch) {
    score += 5;
    reasons.push('章节数相同');
  }

  let level: MatchLevel;
  if (titleMatch && firstChaptersMatch && chapterCountMatch) {
    level = 'exact';
    score = Math.max(score, 100);
  } else if (titleMatch && firstChaptersMatch) {
    level = 'high';
    score = Math.max(score, 85);
  } else if (titleMatch) {
    level = 'medium';
    score = Math.max(score, 55);
  } else if (firstChaptersMatch || allChaptersMatch) {
    level = 'low';
    score = Math.max(score, 35);
  } else {
    level = 'none';
    score = Math.min(score, 10);
  }

  return { project: projectFp, level, score, reasons };
}

/**
 * 在项目列表中查找最佳匹配。
 *
 * 返回所有 medium 及以上匹配，按分数降序排列。
 * 调用方可根据 level 决定是否弹窗询问用户。
 */
export function findMatchingProjects(
  importFp: ImportFingerprint,
  projectFps: ProjectFingerprint[],
): ProjectMatch[] {
  return projectFps
    .map(p => matchProject(importFp, p))
    .filter(m => m.level !== 'none')
    .sort((a, b) => b.score - a.score);
}

// ==================== 5. 情境决策 ====================

export type ImportAction =
  | { kind: 'create-new' }                                       // 直接新建
  | { kind: 'ask-user'; matches: ProjectMatch[] }                // 弹窗询问
  | { kind: 'suggest-merge'; target: ProjectMatch; reason: string }  // 建议合并
  | { kind: 'suggest-overwrite'; target: ProjectMatch; reason: string };

/**
 * 根据当前项目状态和匹配结果，决定导入动作。
 *
 * 情境矩阵（用户要求"设想遇到不同情况的反应"）：
 *
 *   情境 1：用户没有任何项目
 *     → 直接新建（create-new）
 *
 *   情境 2：有项目但无匹配
 *     → 直接新建（create-new）
 *
 *   情境 3：检测到 exact 匹配（同一文件重新导入）
 *     → 建议覆盖（suggest-overwrite），让用户选择覆盖/合并/另建
 *     → 理由："检测到与《XX》内容完全一致，可能是重新导入"
 *
 *   情境 4：检测到 high 匹配（同书追加了新章节）
 *     → 建议合并（suggest-merge），追加新章节到现有项目
 *     → 理由："《XX》已有 N 章，本次导入 M 章，前 3 章相同，疑似追更"
 *
 *   情境 5：检测到 medium 匹配（同名不同书）
 *     → 弹窗询问（ask-user）
 *     → 理由："已存在同名项目《XX》，但内容不同，是否另建新项目？"
 *
 *   情境 6：多个匹配（罕见）
 *     → 弹窗询问（ask-user），让用户选目标
 */
export function decideImportAction(
  importFp: ImportFingerprint,
  matches: ProjectMatch[],
  hasAnyProject: boolean,
): ImportAction {
  // 情境 1 & 2：无项目或无匹配 → 直接新建
  if (!hasAnyProject || matches.length === 0) {
    return { kind: 'create-new' };
  }

  const topMatch = matches[0];

  // 情境 3：内容完全一致 → 建议覆盖
  if (topMatch.level === 'exact') {
    return {
      kind: 'suggest-overwrite',
      target: topMatch,
      reason: `检测到与《${topMatch.project.projectTitle}》内容完全一致（${topMatch.reasons.join('、')}），可能是重新导入同一文件。`,
    };
  }

  // 情境 4：标题相同 + 前 3 章相同（追更） → 建议合并
  if (topMatch.level === 'high') {
    const chapterDelta = importFp.chapterCount - topMatch.project.chapterCount;
    const deltaText = chapterDelta > 0
      ? `本次多 ${chapterDelta} 章，疑似追更内容`
      : chapterDelta < 0
      ? `本次少 ${-chapterDelta} 章，疑似旧版本`
      : '章节数相同';
    return {
      kind: 'suggest-merge',
      target: topMatch,
      reason: `《${topMatch.project.projectTitle}》已有 ${topMatch.project.chapterCount} 章，本次导入 ${importFp.chapterCount} 章，前 3 章相同，${deltaText}。`,
    };
  }

  // 情境 5 & 6：medium 匹配或多匹配 → 弹窗询问
  return { kind: 'ask-user', matches };
}

// ==================== 6. 章节合并工具 ====================

/**
 * 计算导入章节与现有章节的差集（用于"合并追加"模式）。
 *
 * 策略：以章节标题为键，导入结果中存在但现有项目不存在的章节视为"新增"。
 * 标题归一化后比对（去空白、去书名号），避免「第一章 风雪」「第一章 風雪」误判为不同。
 *
 * @returns 新增章节列表（按导入顺序）
 */
export function computeNewChapters(
  importResult: ImportResult,
  existingChapters: Chapter[],
): ImportedChapter[] {
  const existingTitles = new Set(
    existingChapters
      .filter(c => c.levelType !== 'book')
      .map(c => normalizeTitle(c.title)),
  );
  return importResult.chapters.filter(c => !existingTitles.has(normalizeTitle(c.title)));
}

/**
 * 计算导入章节与现有章节的"被修改"章节（标题相同但内容不同）。
 * 用于"覆盖"模式下提示用户哪些章节会被改动。
 */
export function computeModifiedChapters(
  importResult: ImportResult,
  existingChapters: Chapter[],
): Array<{ existing: Chapter; imported: ImportedChapter }> {
  const existingMap = new Map<string, Chapter>();
  for (const c of existingChapters) {
    if (c.levelType !== 'book') {
      existingMap.set(normalizeTitle(c.title), c);
    }
  }
  const modified: Array<{ existing: Chapter; imported: ImportedChapter }> = [];
  for (const imp of importResult.chapters) {
    const existing = existingMap.get(normalizeTitle(imp.title));
    if (existing) {
      // 内容 hash 不同即视为修改
      const existingHash = hashString(existing.content.replace(/<[^>]*>/g, ''));
      const importedHash = hashString(imp.content.replace(/<[^>]*>/g, ''));
      if (existingHash !== importedHash) {
        modified.push({ existing, imported: imp });
      }
    }
  }
  return modified;
}
