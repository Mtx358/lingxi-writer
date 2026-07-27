import type { AISuggestion } from '@/types';
import { NOVEL_SYSTEM_PROMPT, type StreamHandler } from '../llmClient';
import { humanizeWithAITraceCheck, defaultHumanizeOptions, getLLMClient } from './core';

// ==================== 润色能力域 ====================

export async function polishText(text: string, style: string): Promise<AISuggestion> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = buildPolishPrompt(text, style);
      const result = await llmClient.callLLM(prompt, NOVEL_SYSTEM_PROMPT);
      const htmlContent = llmClient.ensureHtmlParagraphs(result);
      const finalContent = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(55));

      return {
        id: '',
        type: 'polish',
        title: '润色优化',
        content: finalContent,
        reasoning: '基于整体文风一致性和表达效果进行润色，在保留原意的基础上提升文学性和自然度。',
        contextUsed: ['选中文本', '全书风格', '角色语气特点', '真人写作质感'],
        timestamp: '',
      };
    } catch (e) {
      console.warn('AI polishText failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(700);

  const plainText = text.replace(/<[^>]*>/g, '');
  let polishedText = plainText;

  // 简单的同义词替换，模拟润色效果
  const synonyms: [RegExp, string][] = [
    [/非常/g, '格外'], [/很/g, '颇为'], [/然后/g, '接着'], [/突然/g, '骤然'],
    [/慢慢/g, '缓缓'], [/看着/g, '凝视着'], [/感觉/g, '只觉得'], [/美丽/g, '动人'],
    [/高兴/g, '欣喜'], [/难过/g, '酸楚'], [/害怕/g, '心悸'], [/想/g, '心念一动'],
    [/说/g, '开口'], [/走/g, '踱步'], [/跑/g, '疾步'],
  ];
  for (const [pattern, replacement] of synonyms) {
    if (Math.random() > 0.3) continue;
    polishedText = polishedText.replace(pattern, replacement);
  }

  const content = humanizeWithAITraceCheck(`<p>${polishedText}</p>`, defaultHumanizeOptions(55));

  return {
    id: '',
    type: 'polish',
    title: '润色优化',
    content: content + `<p class="text-ink-500 text-sm mt-3"><br/>【润色说明】</p><ul class="text-ink-400 text-xs ml-4 list-disc"><li>替换了重复用词，增加表达丰富度</li><li>调整了句式节奏，使行文更有呼吸感</li><li>加入细微的感官细节，增强画面感</li><li>使用真人化后处理，让文字更自然</li></ul>`,
    reasoning: '基于整体文风一致性和表达效果进行润色，在保留原意的基础上提升文学性和自然度。',
    contextUsed: ['选中文本', '全书风格', '角色语气特点', '真人写作质感'],
    timestamp: '',
  };
}

export async function polishTextStream(
  text: string,
  style: string,
  handler?: StreamHandler,
  signal?: AbortSignal
): Promise<string> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider === 'mock') {
    await llmClient.delay(50);
    const plainText = text.replace(/<[^>]*>/g, '');
    const polishedText = plainText.replace(/非常/g, '格外').replace(/很/g, '颇为');
    const content = `<p>${polishedText}</p>`;

    let currentIndex = 0;
    while (currentIndex < content.length) {
      if (signal?.aborted) break;
      const chunkSize = Math.min(15 + Math.floor(Math.random() * 25), content.length - currentIndex);
      const chunk = content.slice(currentIndex, currentIndex + chunkSize);
      await llmClient.delay(40 + Math.random() * 40);
      if (signal?.aborted) break;
      handler?.onChunk(chunk);
      currentIndex += chunkSize;
    }
    // 中止后不再触发 onComplete，避免向已取消/卸载的调用方回调
    if (signal?.aborted) return content;
    handler?.onComplete(content);
    return content;
  }

  try {
    const prompt = buildPolishPrompt(text, style);
    // 包装 handler：抑制原始 onComplete，改为在 humanize 后回调，
    // 否则 useEditorAI 的 onComplete 会用 raw streaming buffer 写入编辑器，
    // 导致真人化后的最终内容被丢弃（HIGH 严重 bug）
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
    const humanized = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(55));
    handler?.onComplete(humanized);
    return humanized;
  } catch (e) {
    console.warn('AI polishTextStream failed:', e);
    handler?.onError(e instanceof Error ? e : new Error(String(e)));
    return '';
  }
}

function buildPolishPrompt(text: string, style: string): string {
  const styleMap: Record<string, string> = {
    balanced: '均衡',
    action: '动作紧凑',
    psychology: '心理细腻',
    description: '描写丰富',
  };
  const styleDesc = styleMap[style] || styleMap.balanced;
  return `请润色下面的小说片段。

要求：
- 保留原意和情节
- 提升文字的文学性和自然度
- 替换重复用词，丰富表达
- 调整句式节奏，让行文更有呼吸感
- 风格：${styleDesc}
- 用 <p> 标签分段

【原文】
${text}

请直接输出润色后的内容，用 <p> 标签分段：`;
}

// ==================== 视角切换能力域 ====================

export async function switchPerspective(text: string, characterName: string): Promise<AISuggestion> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = `请将下面的小说片段从"${characterName}"的视角重新叙述。

要求：
- 切换到 ${characterName} 的视角（第一人称或第三人称限知视角）
- 体现 ${characterName} 的内心活动、感受和独特观察
- 保留原文的情节走向，但视角和感官细节要变化
- 用 <p> 标签分段

【原文】
${text}

请直接输出从 ${characterName} 视角重写的内容，用 <p> 标签分段：`;

      const result = await llmClient.callLLM(prompt, NOVEL_SYSTEM_PROMPT);
      const htmlContent = llmClient.ensureHtmlParagraphs(result);
      const finalContent = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(60));

      return {
        id: '',
        type: 'perspective',
        title: `切换到${characterName}视角`,
        content: finalContent,
        reasoning: `切换到${characterName}的视角，从其内心活动和感官体验出发重新叙述同一段情节，为读者提供更多维度的信息。`,
        contextUsed: [`${characterName}的性格设定`, `${characterName}的内心活动`, '当前情节发展'],
        timestamp: '',
      };
    } catch (e) {
      console.warn('AI switchPerspective failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(700);

  return {
    id: '',
    type: 'perspective',
    title: `切换到${characterName}视角`,
    content: `<p>（从${characterName}的视角重新叙述）</p>
<p>她看着眼前这个人，心里五味杂陈。</p>
<p>他好像什么都不记得了。这样也好，有些事情，忘了反而是一种解脱。</p>
<p>但为什么，看到他困惑的样子，她的心还是会隐隐作痛？</p>
<p>明明已经决定好了的——只要他能安全，就算他永远恨她、永远不认识她，也没关系。</p>
<p>可是真的站在他面前的时候，她才发现，自己比想象中要脆弱得多。</p>
<p>"..."</p>
<p>她深吸一口气，把所有情绪都压回心底。</p>
<p>现在不是时候。</p>
<p>还有更重要的事情要做。</p>`,
    reasoning: `切换到${characterName}的视角，从她的内心活动和感官体验出发重新叙述同一段情节，为读者提供更多维度的信息。`,
    contextUsed: [`${characterName}的性格设定`, `${characterName}的秘密/动机`, '当前情节发展'],
    timestamp: '',
  };
}
