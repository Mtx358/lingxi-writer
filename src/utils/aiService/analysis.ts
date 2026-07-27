import type { Chapter, ChapterAnalysis, CharacterArcAnalysis, Character } from '@/types';
import { parseJsonFromLLM, getLLMClient } from './core';
import { READING_SPEED_WPM } from '@/constants/config';

// ==================== 分析能力域 ====================

export async function analyzeChapter(chapter: Chapter): Promise<ChapterAnalysis> {
  const text = chapter.content.replace(/<[^>]*>/g, '');
  const wordCount = text.length;
  const readingTime = Math.ceil(wordCount / READING_SPEED_WPM);

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = `请分析下面的小说章节，返回 JSON 格式的分析结果。

需要包含以下字段（0-100 的整数分数）：
- emotionScore: 情感浓度
- conflictIntensity: 冲突强度
- hookStrength: 钩子强度（开篇吸引力）
- pacingScore: 节奏分数
- dialogueRatio: 对话占比（0-100）
- descriptionRatio: 描写占比（0-100）

只返回 JSON，不要其他内容。格式：
{"emotionScore":50,"conflictIntensity":50,"hookStrength":50,"pacingScore":50,"dialogueRatio":30,"descriptionRatio":40}

【章节内容】
${text.slice(0, 3000)}`;

      const result = await llmClient.callLLM(prompt, '你是一位专业的小说编辑，擅长分析小说章节质量。只返回JSON，不要其他内容。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed) {
        return {
          chapterId: chapter.id,
          wordCount,
          readingTime,
          emotionScore: llmClient.clampScore(parsed.emotionScore),
          conflictIntensity: llmClient.clampScore(parsed.conflictIntensity),
          hookStrength: llmClient.clampScore(parsed.hookStrength),
          pacingScore: llmClient.clampScore(parsed.pacingScore),
          dialogueRatio: llmClient.clampScore(parsed.dialogueRatio),
          descriptionRatio: llmClient.clampScore(parsed.descriptionRatio),
          characters: [],
          settings: [],
          foreshadows: [],
        };
      }
    } catch (e) {
      console.warn('AI analyzeChapter failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(400);

  return {
    chapterId: chapter.id,
    wordCount,
    readingTime,
    emotionScore: 50 + Math.floor(Math.random() * 40),
    conflictIntensity: 40 + Math.floor(Math.random() * 50),
    hookStrength: 30 + Math.floor(Math.random() * 60),
    pacingScore: 40 + Math.floor(Math.random() * 50),
    dialogueRatio: 20 + Math.floor(Math.random() * 40),
    descriptionRatio: 30 + Math.floor(Math.random() * 40),
    characters: [],
    settings: [],
    foreshadows: [],
  };
}

export async function analyzeStructure(chapters: Chapter[]): Promise<{
  issues: { type: string; severity: string; chapterId?: string; description: string; suggestion: string }[];
  pacing: number[];
  emotionCurve: number[];
}> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const topChapters = chapters.filter(c => c.levelType === 'chapter');
      const chapterList = topChapters.map((c, i) =>
        `第${i + 1}章 ${c.title}: ${c.summary || c.content.replace(/<[^>]*>/g, '').slice(0, 200)}`
      ).join('\n');

      const prompt = `请分析下面小说的整体结构，返回 JSON。

需要包含：
- issues: 结构问题数组，每个元素包含 {type, severity, chapterId, description, suggestion}。type 可为 structure/pacing/emotion/conflict，severity 可为 warning/info/error
- pacing: 每章节奏分数数组（0-100 整数），按章节顺序
- emotionCurve: 每章情感强度数组（0-100 整数），按章节顺序

只返回 JSON，格式：
{"issues":[{"type":"pacing","severity":"info","chapterId":"","description":"...","suggestion":"..."}],"pacing":[60,70],"emotionCurve":[50,80]}

如果没有问题，issues 返回空数组。

【章节列表】
${chapterList || '（暂无章节）'}`;

      const result = await llmClient.callLLM(prompt, '你是一位专业的小说结构编辑。只返回JSON，不要其他内容。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed) {
        return {
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          pacing: Array.isArray(parsed.pacing) ? parsed.pacing.map((v: unknown) => llmClient.clampScore(v)) : [],
          emotionCurve: Array.isArray(parsed.emotionCurve) ? parsed.emotionCurve.map((v: unknown) => llmClient.clampScore(v)) : [],
        };
      }
    } catch (e) {
      console.warn('AI analyzeStructure failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(1000);

  const issues = [
    { type: 'structure', severity: 'warning', chapterId: chapters[1]?.id, description: '第二章到第三章之间过渡略显突兀', suggestion: '可以增加一个过渡场景，让情节转换更自然。' },
    { type: 'pacing', severity: 'info', chapterId: chapters[0]?.id, description: '开篇节奏偏慢，建议加快冲突引入', suggestion: '可以将悬念前置，在第一章就抛出核心问题。' },
  ];

  const pacing = chapters.filter(c => c.levelType === 'chapter').map(() => 30 + Math.floor(Math.random() * 60));
  const emotionCurve = chapters.filter(c => c.levelType === 'chapter').map(() => 40 + Math.floor(Math.random() * 50));

  return { issues, pacing, emotionCurve };
}

export async function checkStyleConsistency(chapters: Chapter[]): Promise<{
  issues: { type: string; severity: string; chapterId: string; description: string }[];
}> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const topChapters = chapters.filter(c => c.levelType === 'chapter');
      const chapterList = topChapters.map(c =>
        `章节 ${c.title}: ${c.content.replace(/<[^>]*>/g, '').slice(0, 500)}`
      ).join('\n---\n');

      const prompt = `请检查下面各章节的文风一致性，返回 JSON。

需要包含：
- issues: 文风问题数组，每个元素包含 {type, severity, chapterId, description}。type 可为 tone/vocabulary/pacing/perspective

只返回 JSON：
{"issues":[{"type":"tone","severity":"warning","chapterId":"","description":"..."}]}

如果文风一致，返回 {"issues":[]}

【各章节内容】
${chapterList || '（暂无章节）'}`;

      const result = await llmClient.callLLM(prompt, '你是一位专业的小说编辑，擅长检测文风一致性。只返回JSON。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed) {
        return { issues: Array.isArray(parsed.issues) ? parsed.issues : [] };
      }
    } catch (e) {
      console.warn('AI checkStyleConsistency failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(600);
  return { issues: [] };
}

/**
 * 角色弧光分析：基于章节 characterFocus 与正文提及统计每个角色的出场分布，
 * 检测长期未出场、弧光不完整等问题。纯本地计算，不调用 LLM。
 */
export function analyzeCharacterArcs(
  chapters: Chapter[],
  characters: Character[],
): CharacterArcAnalysis[] {
  const mainChapters = chapters.filter(c => c.levelType === 'chapter');
  if (characters.length === 0 || mainChapters.length === 0) return [];

  return characters.map(character => {
    const appearanceChapters: string[] = [];
    for (const ch of mainChapters) {
      const focused = ch.characterFocus?.includes(character.id);
      const mentioned = ch.content.includes(character.name);
      if (focused || mentioned) {
        appearanceChapters.push(ch.id);
      }
    }

    // 计算从最后一章倒推的连续缺席数
    let consecutiveAbsence = 0;
    for (let i = mainChapters.length - 1; i >= 0; i--) {
      const ch = mainChapters[i];
      const appeared = ch.characterFocus?.includes(character.id) || ch.content.includes(character.name);
      if (appeared) break;
      consecutiveAbsence++;
    }

    // 弧光缺口：长期未出场 + 重要角色
    const arcGaps: string[] = [];
    if (character.role === 'protagonist' && consecutiveAbsence >= 3) {
      arcGaps.push(`主角已连续 ${consecutiveAbsence} 章未出场，主线推进可能受阻`);
    }
    if (character.role === 'antagonist' && appearanceChapters.length === 0) {
      arcGaps.push('反派在全书中未出现，对手戏缺失可能导致冲突单薄');
    }
    if (character.role === 'protagonist' && appearanceChapters.length < mainChapters.length * 0.3 && mainChapters.length >= 5) {
      arcGaps.push(`主角出场章节数占比过低（${appearanceChapters.length}/${mainChapters.length}），存在视角漂移风险`);
    }

    let risk: CharacterArcAnalysis['risk'] = 'ok';
    let riskDescription: string | undefined;
    if (arcGaps.length > 0) {
      risk = character.role === 'protagonist' ? 'high' : 'medium';
      riskDescription = arcGaps[0];
    } else if (appearanceChapters.length === 0) {
      risk = character.role === 'protagonist' || character.role === 'antagonist' ? 'high' : 'medium';
      riskDescription = '全书未出场';
    } else if (consecutiveAbsence >= 5 && character.role !== 'minor') {
      risk = 'low';
      riskDescription = `近期 ${consecutiveAbsence} 章未出场`;
    }

    return {
      characterId: character.id,
      characterName: character.name,
      role: character.role,
      appearanceChapters,
      appearanceCount: appearanceChapters.length,
      consecutiveAbsence,
      arcGaps,
      risk,
      riskDescription,
    };
  });
}

/**
 * 全书通读：连续阅读模式下的实时分析（灵犀打磨 4.3）。
 * 对单章返回节奏/重复/前后矛盾标记，供通读模式高亮。
 */
export async function analyzeChapterForReading(chapter: Chapter): Promise<{
  longSentences: { paragraphIndex: number; preview: string }[];
  repeatedWords: { word: string; count: number }[];
  hookScore: number;
}> {
  // 段落切分：先把 </p> 与 <br> 转成换行，再剥离其余 HTML 标签，最后按换行切分。
  // 此前实现先 strip HTML 再 split，<p> 已被剥光，导致整章退化为单段。
  const paragraphs = chapter.content
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean);
  const fullText = paragraphs.join('');

  // 长句检测：连续 80 字以上无标点
  const longSentences: { paragraphIndex: number; preview: string }[] = [];
  paragraphs.forEach((p, idx) => {
    if (/[^。！？，；、…\s]{80,}/.test(p)) {
      longSentences.push({ paragraphIndex: idx, preview: p.slice(0, 60) + '...' });
    }
  });

  // 重复词检测：2 字以上出现 5 次以上
  const wordCount = new Map<string, number>();
  const tokens = fullText.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  tokens.forEach(t => wordCount.set(t, (wordCount.get(t) || 0) + 1));
  const repeatedWords = Array.from(wordCount.entries())
    .filter(([, c]) => c >= 5)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 钩子分数：末段是否包含问号/省略号/破折号/悬念词
  const lastPara = paragraphs[paragraphs.length - 1] || '';
  // 钩子关键词：末段若包含这些词，说明有悬念收尾。注意去重，否则单问号会被计为 2 次
  const hookKeywords = ['？', '……', '——', '突然', '忽然', '然而', '却', '竟然', '居然'];
  const hookScore = Math.min(100, hookKeywords.filter(k => lastPara.includes(k)).length * 25);

  return { longSentences, repeatedWords, hookScore };
}
