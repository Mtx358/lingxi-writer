import type { AISuggestion } from '@/types';
import { NOVEL_SYSTEM_PROMPT, type StreamHandler } from '../llmClient';
import { humanizeWithAITraceCheck, defaultHumanizeOptions, humanizeIntensityForExpand, getLLMClient } from './core';

// ==================== 扩写能力域 ====================

export async function expandText(
  text: string,
  type: 'detail' | 'dialogue' | 'environment' | 'psychology'
): Promise<AISuggestion> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const titleMap: Record<typeof type, string> = {
        detail: '丰富细节',
        dialogue: '增加对话',
        environment: '环境描写',
        psychology: '心理活动',
      };
      const prompt = buildExpandPrompt(text, type);
      const result = await llmClient.callLLM(prompt, NOVEL_SYSTEM_PROMPT);
      const htmlContent = llmClient.ensureHtmlParagraphs(result);
      const finalContent = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(humanizeIntensityForExpand()));

      return {
        id: '',
        type: 'expand',
        title: `扩写：${titleMap[type]}`,
        content: finalContent,
        reasoning: `从${titleMap[type]}的角度扩展原文，让场景更立体。文字经过真人化处理与 AI 痕迹检测。`,
        contextUsed: ['选中文本', '扩写方向', '真人写作风格'],
        timestamp: '',
      };
    } catch (e) {
      console.warn('AI expandText failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(800);

  const plainText = text.replace(/<[^>]*>/g, '');
  const expansions = buildMockExpansions(plainText);
  const content = humanizeWithAITraceCheck(expansions[type] || expansions.detail, defaultHumanizeOptions(humanizeIntensityForExpand()));

  return {
    id: '',
    type: 'expand',
    title: `扩写：${type === 'detail' ? '丰富细节' : type === 'dialogue' ? '增加对话' : type === 'environment' ? '环境描写' : '心理活动'}`,
    content,
    reasoning: `基于原文的基调，从${type === 'detail' ? '感官细节' : type === 'dialogue' ? '人物对话' : type === 'environment' ? '环境氛围' : '内心活动'}的角度进行扩展，让场景更加立体。文字经过真人化处理，更有自然写作的质感。`,
    contextUsed: ['选中文本', '角色性格', '当前场景氛围', '真人写作风格'],
    timestamp: '',
  };
}

export async function expandTextStream(
  text: string,
  type: 'detail' | 'dialogue' | 'environment' | 'psychology',
  handler?: StreamHandler,
  signal?: AbortSignal
): Promise<string> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider === 'mock') {
    await llmClient.delay(50);
    const plainText = text.replace(/<[^>]*>/g, '');
    const expansions = buildMockExpansions(plainText);
    const content = expansions[type] || expansions.detail;
    let currentIndex = 0;
    while (currentIndex < content.length) {
      if (signal?.aborted) break;
      const chunkSize = Math.min(10 + Math.floor(Math.random() * 20), content.length - currentIndex);
      const chunk = content.slice(currentIndex, currentIndex + chunkSize);
      await llmClient.delay(30 + Math.random() * 30);
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
    const prompt = buildExpandPrompt(text, type);
    // 包装 handler：抑制原始 onComplete，改为在 humanize 后回调，确保编辑器拿到最终内容
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
    const humanized = humanizeWithAITraceCheck(htmlContent, defaultHumanizeOptions(humanizeIntensityForExpand()));
    handler?.onComplete(humanized);
    return humanized;
  } catch (e) {
    console.warn('AI expandTextStream failed:', e);
    handler?.onError(e instanceof Error ? e : new Error(String(e)));
    return '';
  }
}

function buildExpandPrompt(text: string, type: 'detail' | 'dialogue' | 'environment' | 'psychology'): string {
  const typeMap: Record<typeof type, string> = {
    detail: '丰富细节（增加感官描写、动作细节、细微表情）',
    dialogue: '增加对话（扩展人物对话，体现性格冲突）',
    environment: '环境描写（扩展场景、氛围、光影声音）',
    psychology: '心理活动（深入角色内心、矛盾情绪）',
  };
  return `请扩写下面的小说片段，扩写方向：${typeMap[type]}

要求：
- 保留原文核心信息，在其基础上扩展
- 扩写约 200-400 字
- 自然衔接原文，不要简单重复原文
- 用 <p> 标签分段

【原文】
${text}

请直接输出扩写后的内容（包含原文部分），用 <p> 标签分段：`;
}

// Mock 模式下按扩写类型返回预置片段
function buildMockExpansions(plainText: string): Record<'detail' | 'dialogue' | 'environment' | 'psychology', string> {
  return {
    detail: `<p>${plainText}</p>
<p>他的动作很慢，慢到连时间都像是被拉长了。每一个细微的变化都逃不过人的眼睛——指尖的颤抖、喉结的滚动、还有那一瞬间闪过眼底的复杂情绪。</p>
<p>光线从侧面照过来，在他脸上投下深深的阴影，让原本就难以捉摸的表情更加模糊不清。</p>
<p>空气仿佛凝固了。</p>
<p>只有心跳声，一声比一声清晰。</p>`,
    dialogue: `<p>两人之间的空气仿佛凝滞了片刻。</p>
<p>"你真的这么想？"他终于开口，声音比平时低了几分，目光直直地看着对方，像是想要从那张脸上看出什么端倪。</p>
<p>"不然呢？"她轻轻笑了一声，那笑意却没到眼底，"你以为我还有别的选择吗？"</p>
<p>她说这话的时候，手指无意识地绞着衣角，这个细微的动作泄露了她内心的不平静。</p>
<p>沉默。</p>
<p>漫长的沉默。</p>
<p>久到他几乎以为她不会再说话了，才听见那声几不可闻的叹息。</p>
<p>"...对不起。"他说。声音很轻，像是怕惊扰了什么。</p>
<p>"不用跟我说对不起。"她别开脸，望向窗外，"这是我自己选的路。"</p>
<p>窗外的阳光正好，落在她侧脸上，却照不进她眼底的那片阴霾。</p>`,
    environment: `<p>周围的环境渐渐清晰起来。</p>
<p>空气中弥漫着一股说不清道不明的气味——像是旧书的霉味，混合着灰尘和某种金属的腥气。每一次呼吸，都像是在吞噬着什么。</p>
<p>头顶的灯管有些年头了，发出"嗡嗡"的低鸣，光线忽明忽暗，把影子拉得奇形怪状。墙壁上的涂料大片大片地剥落，露出底下深色的水泥，像是伤痕。</p>
<p>不知道从哪里传来滴水的声音，"滴答——滴答——"，在这死寂的空间里格外清晰，像是某种倒计时。</p>
<p>远处偶尔传来模糊的响动，听不真切，却更让人心里发毛。</p>
<p>这里就像是一个被世界遗忘的角落。</p>
<p>而他们，正一步步走向深处。</p>`,
    psychology: `<p>${plainText}</p>
<p>他表面上看起来还算镇定，只有他自己知道，心里早就乱成了一团。</p>
<p>各种各样的念头在脑海里翻来覆去，像一群没头的苍蝇，嗡嗡地吵得人头疼。有害怕，有不甘，有愤怒，还有那么一丝连他自己都不愿承认的...期待？</p>
<p>如果她说是真的呢？</p>
<p>如果他一直以来坚信的一切，全都是假的呢？</p>
<p>他有勇气去面对那个真相吗？</p>
<p>还是说——他其实早就知道，只是一直在自欺欺人？</p>
<p>这个念头一冒出来，就让他浑身发冷。</p>
<p>不，不会的。</p>
<p>他拼命地摇头，想要把这个可怕的想法甩出脑海。</p>
<p>可是越是抗拒，那个声音就越是清晰。</p>
<p>就像有另一个自己，在黑暗深处，冷冷地看着他。</p>`,
  };
}
