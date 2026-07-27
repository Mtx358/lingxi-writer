import type { AISuggestion, AISettings, Character } from '@/types';
import { NOVEL_SYSTEM_PROMPT, type StreamHandler } from '../llmClient';
import { humanizeWithAITraceCheck, defaultHumanizeOptions, humanizeIntensityForContinue, analyzeContextStyle, getLLMClient } from './core';

// ==================== 续写能力域 ====================

export async function generateContinuation(
  context: string,
  chapterSummary: string,
  characters: Character[],
  style?: string
): Promise<AISuggestion[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = buildContinuePrompt(context, chapterSummary, characters, style, settings);
      const result = await llmClient.callLLM(prompt, NOVEL_SYSTEM_PROMPT);
      const htmlContent = llmClient.ensureHtmlParagraphs(result);
      const finalContent = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(humanizeIntensityForContinue()));

      return [{
        id: '',
        type: 'continue',
        title: 'AI 续写',
        content: finalContent,
        reasoning: '基于当前章节上下文、角色设定和风格偏好由 AI 生成，并经过真人化处理与 AI 痕迹检测。',
        contextUsed: ['当前章节末尾', '角色设定', '风格偏好', '章节概要'],
        timestamp: '',
      }];
    } catch (e) {
      console.warn('AI generateContinuation failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(800);

  const mainChar = characters[0]?.name || '主角';
  const humanizeOptions = defaultHumanizeOptions(humanizeIntensityForContinue());

  const suggestions: AISuggestion[] = [
    { id: '', type: 'continue', title: '续写方向一：推进剧情', content: generateSmartContinuation(context, mainChar, 'plot'), reasoning: '基于当前章节的紧张氛围，继续推进主线冲突，让主角面临新的抉择。', contextUsed: ['当前章节末尾', '主角性格设定', '主线冲突走向'], timestamp: '' },
    { id: '', type: 'continue', title: '续写方向二：氛围渲染', content: generateSmartContinuation(context, mainChar, 'atmosphere'), reasoning: '侧重环境描写和心理活动，加深读者的代入感和情绪积累。', contextUsed: ['当前章节场景', '世界观设定', '角色情绪状态'], timestamp: '' },
    { id: '', type: 'continue', title: '续写方向三：转折悬念', content: generateSmartContinuation(context, mainChar, 'twist'), reasoning: '在段落末尾引入意外元素，制造新的悬念，吸引读者继续阅读。', contextUsed: ['伏笔线索', '角色秘密', '剧情节奏控制'], timestamp: '' },
  ];
  return suggestions.map(s => ({ ...s, content: humanizeWithAITraceCheck(s.content, humanizeOptions) }));
}

export async function generateContinuationStream(
  context: string,
  chapterSummary: string,
  characters: Character[],
  style?: string,
  handler?: StreamHandler,
  signal?: AbortSignal
): Promise<string> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider === 'mock') {
    await llmClient.delay(50);
    const mainChar = characters[0]?.name || '主角';
    const content = generateSmartContinuation(context, mainChar, 'plot');

    const chunks = content.split(/(<p>|<\/p>|\n)/).filter(Boolean);
    for (const chunk of chunks) {
      if (signal?.aborted) break;
      await llmClient.delay(50 + Math.random() * 50);
      if (signal?.aborted) break;
      handler?.onChunk(chunk);
    }
    // 中止后不再触发 onComplete，避免向已取消/卸载的调用方回调
    if (signal?.aborted) return content;
    handler?.onComplete(content);
    return content;
  }

  try {
    const prompt = buildContinuePrompt(context, chapterSummary, characters, style, settings);
    // 包装 handler：抑制 callLLMStream 的原始 onComplete，
    // 改为在真人化处理完成后再触发，确保编辑器拿到的是 humanized 后的最终内容
    const wrappedHandler: StreamHandler | undefined = handler
      ? {
          onChunk: handler.onChunk,
          onComplete: () => { /* 延迟到 humanize 后再回调 */ },
          // 抑制内部 onError：callLLMStream 内部 catch 会先 onError 再 throw err，
          // 错误由本函数外层 catch 统一回调 handler?.onError，避免 useEditorAI 收到两次错误 toast
          onError: () => {},
        }
      : undefined;
    const result = await llmClient.callLLMStream(prompt, NOVEL_SYSTEM_PROMPT, wrappedHandler, signal);
    if (signal?.aborted) return result;
    const htmlContent = llmClient.ensureHtmlParagraphs(result);
    const humanized = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(humanizeIntensityForContinue()));
    handler?.onComplete(humanized);
    return humanized;
  } catch (e) {
    console.warn('AI generateContinuationStream failed:', e);
    handler?.onError(e instanceof Error ? e : new Error(String(e)));
    return '';
  }
}

// 构造续写 prompt（被同步/流式两个入口复用，避免重复拼装）
function buildContinuePrompt(
  context: string,
  chapterSummary: string,
  characters: Character[],
  style: string | undefined,
  settings: AISettings,
): string {
  const charInfo = characters.slice(0, 5).map(c => {
    const parts: string[] = [c.name];
    if (c.role) parts.push(`(${c.role})`);
    if (c.profile?.personality) parts.push(`性格:${c.profile.personality}`);
    if (c.profile?.background) parts.push(`背景:${c.profile.background}`);
    if (c.profile?.goal) parts.push(`目标:${c.profile.goal}`);
    return parts.join(' ');
  }).join('\n');

  const styleMap: Record<string, string> = {
    balanced: '均衡（叙事、对话、描写并重）',
    action: '动作向（侧重动作和冲突）',
    psychology: '心理向（侧重内心活动）',
    description: '环境向（侧重氛围和场景）',
  };
  const styleDesc = styleMap[style || settings.style] || styleMap.balanced;
  const descLevel = settings.descriptionDensity > 60 ? '丰富' : settings.descriptionDensity < 40 ? '精简' : '适中';
  const dialogueLevel = settings.dialogueDensity > 60 ? '较多' : settings.dialogueDensity < 40 ? '较少' : '适中';
  const contextStyle = analyzeContextStyle(context);

  return `请续写下面的小说片段。要求：
- 风格：${styleDesc}
- 描写浓度：${descLevel}
- 对话浓度：${dialogueLevel}
- 续写约 300-500 字
- 【重要】严格延续原文的人称、时态、语气、场景

【当前文本风格分析】
${contextStyle}

【章节概要】
${chapterSummary || '（无）'}

【相关角色】
${charInfo || '（无）'}

【当前章节末尾内容（最后500字）】
${context}

请直接输出续写内容，用 <p> 标签分段。续写必须从原文的最后一句自然衔接，不得跳转场景或引入新角色：`;
}

// Mock 模式下根据上下文关键词生成"看起来智能"的续写片段
function generateSmartContinuation(context: string, mainChar: string, direction: string): string {
  const isFirstPerson = context.includes('我');
  const hasDialogue = context.match(/"[^"]+"/);

  const sceneKeywords: Record<string, boolean> = {
    indoors: /房间|屋|屋内|室内|走廊|门/.test(context),
    outdoors: /街|路|外|野外|山|河|海/.test(context),
    night: /夜|晚|黑暗|月光/.test(context),
    tension: /紧张|恐惧|危险|威胁/.test(context),
  };

  if (direction === 'plot') {
    if (sceneKeywords.tension) {
      return `<p>${isFirstPerson ? '我' : mainChar}的心跳加速，周围的空气仿佛凝固了。</p>
<p>接下来发生的事情，将会改变一切。</p>
<p>${hasDialogue ? `"我们必须做出选择。"${isFirstPerson ? '我' : mainChar}低声说，眼神里闪烁着坚定的光芒。` : ''}</p>`;
    }
    return `<p>${isFirstPerson ? '我' : mainChar}深吸一口气，迈出了下一步。</p>
<p>无论前方等待的是什么，都已经没有退路了。</p>`;
  }

  if (direction === 'atmosphere') {
    const sceneDesc = sceneKeywords.night
      ? '夜色渐浓，月光透过窗户洒进来，在地板上投下斑驳的光影。'
      : sceneKeywords.indoors
      ? '房间里弥漫着一种说不清的气氛，仿佛有什么东西即将发生。'
      : '风轻轻吹过，带起一阵细碎的声响，像是远方传来的低语。';
    return `<p>${sceneDesc}</p>
<p>${isFirstPerson ? '我' : mainChar}站在原地，感受着这一切。</p>
<p>时间仿佛慢了下来，每一秒都像是被拉长了。</p>`;
  }

  if (direction === 'twist') {
    return `<p>就在这时，一个意想不到的声音打破了沉默。</p>
<p>${isFirstPerson ? '我' : mainChar}猛地抬头，心跳骤然加速。</p>
<p>那个声音...意味着什么？</p>
<p>答案即将揭晓。</p>`;
  }

  return `<p>${isFirstPerson ? '我' : mainChar}深吸一口气，继续向前。</p>
<p>故事还在继续。</p>`;
}
