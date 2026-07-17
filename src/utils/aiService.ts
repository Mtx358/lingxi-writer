import type { Chapter, Character, AISuggestion, AISettings, ChapterAnalysis } from '@/types';
import { fullHumanize, type HumanizeOptions } from './humanizeText';
import { llmClient, NOVEL_SYSTEM_PROMPT, type StreamHandler } from './llmClient';

/**
 * AI 能力门面（facade）
 *
 * 此前所有 AI 能力（续写/扩写/润色/视角/分析/起名/头脑风暴）与底层
 * 请求逻辑（callLLM/callLLMStream）耦合在一个 1300+ 行的类中。现已将
 * 公共请求层抽离到 LLMClient（见 ./llmClient.ts），本文件按能力域
 * 组织剩余的业务方法，并通过 aiService 单例对外暴露，保持调用方零改动。
 *
 * 能力域划分：
 *   - 续写   generateContinuation / generateContinuationStream
 *   - 扩写   expandText / expandTextStream
 *   - 润色   polishText / polishTextStream
 *   - 视角   switchPerspective
 *   - 分析   analyzeChapter / analyzeStructure / checkStyleConsistency
 *   - 创意   generateBrainstorm / generateStoryIdea / generateCharacterNames
 */

// 复用 LLMClient 上的设置/连接测试/token 计数能力
export const updateSettings = (s: Partial<AISettings>) => llmClient.updateSettings(s);
export const getSettings = (): AISettings => llmClient.getSettings();
export const getTotalTokensUsed = (): number => llmClient.getTotalTokensUsed();
export const testConnection = () => llmClient.testConnection();

// 透传共享类型与系统提示
export type { StreamHandler };
export { NOVEL_SYSTEM_PROMPT };

// ==================== 共享小工具 ====================

// 根据当前 strictness 设置推导真人化强度
function humanizeIntensityForExpand(): number {
  const { strictness } = llmClient.getSettings();
  return strictness > 70 ? 40 : strictness > 40 ? 60 : 80;
}
function humanizeIntensityForContinue(): number {
  const { strictness } = llmClient.getSettings();
  return strictness > 70 ? 30 : strictness > 40 ? 50 : 70;
}
function defaultHumanizeOptions(intensity: number): HumanizeOptions {
  return { intensity, style: 'novel', preserveMeaning: true };
}

// 分析当前文本风格（人称/对话/句式），用于续写时延续原文风格
function analyzeContextStyle(text: string): string {
  const features: string[] = [];
  if (text.includes('我')) features.push('第一人称');
  else if (text.match(/他|她/)) features.push('第三人称');
  if (text.match(/"[^"]+"/)) features.push('有对话');
  if (text.match(/。.{0,5}。/)) features.push('短句为主');
  else features.push('长句为主');
  return features.join('、');
}

// ==================== 续写能力域 ====================

export async function generateContinuation(
  context: string,
  chapterSummary: string,
  characters: Character[],
  style?: string
): Promise<AISuggestion[]> {
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = buildContinuePrompt(context, chapterSummary, characters, style, settings);
      const result = await llmClient.callLLM(prompt, NOVEL_SYSTEM_PROMPT);
      const htmlContent = llmClient.ensureHtmlParagraphs(result);
      const finalContent = fullHumanize(htmlContent, defaultHumanizeOptions(humanizeIntensityForContinue()));

      return [{
        id: '',
        type: 'continue',
        title: 'AI 续写',
        content: finalContent,
        reasoning: '基于当前章节上下文、角色设定和风格偏好由 AI 生成，并经过真人化处理。',
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
  return suggestions.map(s => ({ ...s, content: fullHumanize(s.content, humanizeOptions) }));
}

export async function generateContinuationStream(
  context: string,
  chapterSummary: string,
  characters: Character[],
  style?: string,
  handler?: StreamHandler,
  signal?: AbortSignal
): Promise<string> {
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
    const result = await llmClient.callLLMStream(prompt, NOVEL_SYSTEM_PROMPT, handler, signal);
    const htmlContent = llmClient.ensureHtmlParagraphs(result);
    return fullHumanize(htmlContent, defaultHumanizeOptions(humanizeIntensityForContinue()));
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

// ==================== 扩写能力域 ====================

export async function expandText(
  text: string,
  type: 'detail' | 'dialogue' | 'environment' | 'psychology'
): Promise<AISuggestion> {
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
      const finalContent = fullHumanize(htmlContent, defaultHumanizeOptions(humanizeIntensityForExpand()));

      return {
        id: '',
        type: 'expand',
        title: `扩写：${titleMap[type]}`,
        content: finalContent,
        reasoning: `从${titleMap[type]}的角度扩展原文，让场景更立体。文字经过真人化处理。`,
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
  const content = fullHumanize(expansions[type] || expansions.detail, defaultHumanizeOptions(humanizeIntensityForExpand()));

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
    const result = await llmClient.callLLMStream(prompt, NOVEL_SYSTEM_PROMPT, handler, signal);
    const htmlContent = llmClient.ensureHtmlParagraphs(result);
    return fullHumanize(htmlContent, defaultHumanizeOptions(humanizeIntensityForExpand()));
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

// ==================== 润色能力域 ====================

export async function polishText(text: string, style: string): Promise<AISuggestion> {
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = buildPolishPrompt(text, style);
      const result = await llmClient.callLLM(prompt, NOVEL_SYSTEM_PROMPT);
      const htmlContent = llmClient.ensureHtmlParagraphs(result);
      const finalContent = fullHumanize(htmlContent, defaultHumanizeOptions(55));

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

  const content = fullHumanize(`<p>${polishedText}</p>`, defaultHumanizeOptions(55));

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
    const result = await llmClient.callLLMStream(prompt, NOVEL_SYSTEM_PROMPT, handler, signal);
    const htmlContent = llmClient.ensureHtmlParagraphs(result);
    return fullHumanize(htmlContent, defaultHumanizeOptions(55));
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
      const finalContent = fullHumanize(htmlContent, defaultHumanizeOptions(60));

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

// ==================== 分析能力域 ====================

export async function analyzeChapter(chapter: Chapter): Promise<ChapterAnalysis> {
  const text = chapter.content.replace(/<[^>]*>/g, '');
  const wordCount = text.length;
  const readingTime = Math.ceil(wordCount / 400);

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
      // 先 trim 后尝试直接 JSON.parse，失败再回退到正则提取，避免贪婪 \{[\s\S]*\} 吞掉解释性文字中的 }
      const trimmed = result.trim();
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
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
      // 先 trim 后尝试直接 JSON.parse，失败再回退到正则提取，避免贪婪 \{[\s\S]*\} 吞掉解释性文字中的 }
      const trimmed = result.trim();
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
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
      // 先 trim 后尝试直接 JSON.parse，失败再回退到正则提取，避免贪婪 \{[\s\S]*\} 吞掉解释性文字中的 }
      const trimmed = result.trim();
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
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

// ==================== 创意能力域 ====================

export async function generateBrainstorm(context: string, characterName?: string): Promise<string[]> {
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

// ==================== 兼容旧调用的单例 facade ====================
//
// 调用方仍可通过 aiService.xxx(...) 形式访问所有能力，迁移到模块函数
// 后无需改动现有 import。
export const aiService = {
  updateSettings,
  getSettings,
  getTotalTokensUsed,
  testConnection,
  generateContinuation,
  generateContinuationStream,
  expandText,
  expandTextStream,
  polishText,
  polishTextStream,
  switchPerspective,
  analyzeChapter,
  analyzeStructure,
  checkStyleConsistency,
  generateBrainstorm,
  generateStoryIdea,
  generateCharacterNames,
  generateChapterTitleSuggestions,
};
