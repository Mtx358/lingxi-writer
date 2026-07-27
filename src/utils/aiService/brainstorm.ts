import type { Chapter } from '@/types';
import { getLLMClient } from './core';

// ==================== 创意能力域 ====================

export async function generateBrainstorm(context: string, characterName?: string): Promise<string[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = `请针对下面的场景，给出 3 个不同走向的剧情分支。

要求：
- 每个分支 1-2 句话，清晰说明走向和冲突点
- 适合作为小说剧情发展方向
- 用换行分隔，不要编号

【当前场景】
${context}

【角色】${characterName || '（无）'}

请直接输出 3 个剧情分支：`;

      const result = await llmClient.callLLM(prompt, '你是一位创意写作导师，擅长构思剧情分支。直接输出分支，不要加说明。');
      const ideas = result
        .split(/\n+/)
        .map(s => s.replace(/^\d+[.、)]\s*/, '').trim())
        .filter(Boolean);
      if (ideas.length > 0) return ideas.slice(0, 3);
    } catch (e) {
      console.warn('AI generateBrainstorm failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(800);

  return [
    `${characterName || '主角'}发现了一个隐藏的秘密，这个秘密将颠覆他之前的所有认知...`,
    `一场突如其来的危机打乱了${characterName || '主角'}的计划，迫使他做出艰难的选择...`,
    `${characterName || '主角'}遇到了一个意想不到的盟友，两人将共同面对更大的挑战...`,
  ];
}

export async function generateStoryIdea(prompt: string): Promise<string[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const fullPrompt = `请基于以下提示，生成 3 个有创意的小说故事创意。

要求：
- 每个创意 1-2 句话，简洁有力
- 有独特的设定或反转
- 适合中文小说创作
- 用换行分隔每个创意，不要编号

【用户提示】
${prompt || '随机生成'}`;

      const result = await llmClient.callLLM(fullPrompt, '你是一位创意写作导师，擅长构思独特的故事创意。直接输出创意，不要加说明。');
      const ideas = result
        .split(/\n+/)
        .map(s => s.replace(/^\d+[.、)]\s*/, '').replace(/^[「""』「]/, '').replace(/[」""』」]$/, '').trim())
        .filter(Boolean);
      if (ideas.length > 0) return ideas.slice(0, 5);
    } catch (e) {
      console.warn('AI generateStoryIdea failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(1000);

  return [
    '一个记忆可以被提取和交易的世界，主角发现自己的记忆是被植入的...',
    '时间循环中的救赎：主角被困在同一天，而打破循环的关键是一个他不认识的女人...',
    '城市深处有一家只在午夜营业的店，售卖的是"别人的人生"...',
  ];
}

export async function generateCharacterNames(role: string, count: number = 5): Promise<string[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const roleMap: Record<string, string> = {
        protagonist: '主角',
        antagonist: '反派',
        supporting: '配角',
      };
      const roleDesc = roleMap[role] || '角色';

      const prompt = `请生成 ${count} 个适合中文小说的${roleDesc}名字。

要求：
- 符合中文小说习惯，不要太洋化
- 每个名字 2-3 字
- 有一定的寓意或性格暗示
- 用换行分隔，不要编号`;

      const result = await llmClient.callLLM(prompt, '你是一位中文小说创作助手，擅长起名。直接输出名字，不要加说明。');
      const names = result
        .split(/\n+/)
        .map(s => s.replace(/^\d+[.、)]\s*/, '').replace(/^[「""』「]/, '').replace(/[」""』」]$/, '').trim())
        .filter(Boolean);
      if (names.length > 0) return names.slice(0, count);
    } catch (e) {
      console.warn('AI generateCharacterNames failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);

  const names: Record<string, string[]> = {
    protagonist: ['林远', '苏晚', '陈默', '顾言', '沈清'],
    antagonist: ['陆沉', '魏明', '赵渊', '孙黎', '周恒'],
    supporting: ['老陈', '小雅', '老王', '阿凯', '美玲'],
  };
  return names[role] || names.supporting;
}

/**
 * 为单个章节生成标题建议（O2：替换 OutlinePolishPanel 中硬编码的假建议）
 *
 * 依据章节摘要/正文片段与主题，由 LLM 给出 3 条更具吸引力的标题候选。
 * Mock 模式下依据章节关键词生成可读标题，保证无 API 配置时仍有可用输出。
 */
export async function generateChapterTitleSuggestions(chapter: Chapter): Promise<string[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const plainText = (chapter.summary || chapter.content || '').replace(/<[^>]*>/g, '').trim();
  const snippet = plainText.slice(0, 600);

  if (settings.provider !== 'mock') {
    try {
      const prompt = `请为下面的小说章节生成 3 个更具吸引力的标题候选。

要求：
- 每条 4-10 字，符合中文小说章节标题习惯
- 体现章节核心冲突或意象，避免剧透关键反转
- 兼顾悬念感与文学性，不要过于直白
- 用换行分隔，不要编号、不要书名号、不要引号

【章节原标题】
${chapter.title || '（无）'}

【章节摘要/正文片段】
${snippet || '（无）'}

请直接输出 3 个标题候选：`;

      const result = await llmClient.callLLM(prompt, '你是一位资深小说编辑，擅长打磨章节标题。直接输出标题，不要加说明。');
      const titles = result
        .split(/\n+/)
        .map(s => s.replace(/^\d+[.、)]\s*/, '')
          .replace(/^[「""『《【]/, '')
          .replace(/[」""』》】]$/, '')
          .trim())
        .filter(Boolean);
      if (titles.length > 0) return titles.slice(0, 3);
    } catch (e) {
      console.warn('AI generateChapterTitleSuggestions failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(600);

  // Mock：依据章节文本关键词生成可读标题候选，避免硬编码与章节内容无关的固定文案
  const fallback: string[] = [];
  if (chapter.title) fallback.push(chapter.title);
  const keywords = snippet.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  const picked = Array.from(new Set(keywords)).slice(0, 2);
  for (const kw of picked) {
    fallback.push(`${kw}之夜`);
    if (fallback.length >= 3) break;
  }
  while (fallback.length < 3) {
    fallback.push(`第${chapter.order ?? fallback.length + 1}章·未命名`);
  }
  return fallback.slice(0, 3);
}
