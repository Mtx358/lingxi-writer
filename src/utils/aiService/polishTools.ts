/**
 * 打磨工具域 AI 服务（规格书第二档）
 *
 * 三个能力：
 *   - suggestSceneLocators   场景定位仪：为每章推断视点/情绪起止/信息释放/伏笔关联
 *   - parseNaturalLanguageCommand  自然语言命令：把用户口语解析成跳转意图
 *   - analyzeEmotionConsistency    情感一致性：跨章情感曲线 + 不连续点告警
 *
 * 与 health.ts 同构：非 Mock 走 LLM，Mock / 异常 fallback 到本地启发式，
 * LLM 输出经白名单校验与字段截断后返回，避免脏数据污染 UI。
 */
import type { Chapter, Character, Foreshadow, SceneLocator, ForeshadowPayoffCheck, EmergencyRecoveryPlan, EmergencyRecoveryVariant } from '@/types';
import type { TabId } from '@/components/editor/outlinePolish/types';
import { getLLMClient, parseJsonFromLLM } from './core';

// ==================== 场景定位仪 ====================

export interface SceneLocatorSuggestion {
  chapterId: string;
  locator: SceneLocator;
  /** AI 给出的一句话理由，供用户判断是否采纳 */
  reason: string;
}

/**
 * 为给定章节批量推断场景定位仪四要素。
 * 仅处理 levelType === 'chapter' 的正文章节；跳过卷/书级节点。
 */
export async function suggestSceneLocators(params: {
  chapters: Chapter[];
  characters: Character[];
  foreshadows: Foreshadow[];
}): Promise<SceneLocatorSuggestion[]> {
  const { chapters, characters, foreshadows } = params;
  const mainChapters = chapters.filter(c => c.levelType === 'chapter').slice(0, 40);
  if (mainChapters.length === 0) return [];

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  // Mock / 无 key：走启发式
  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(400);
    return mainChapters.map((ch, idx) => heuristicLocator(ch, idx, characters, foreshadows));
  }

  try {
    const charMap = characters.map(c => `${c.id}:${c.name}`).join('、') || '（无角色）';
    const fMap = foreshadows.slice(0, 20).map(f => `${f.id}:${f.title}[${f.status}]`).join('、') || '（无伏笔）';
    const digest = mainChapters.map(ch =>
      `第${ch.order + 1}章 id=${ch.id} 《${ch.title}》 摘要:${(ch.summary || '').slice(0, 80)}`
    ).join('\n');

    const prompt = `下面是一部小说的章节列表，请为每章推断"场景定位仪"四要素：
- povCharacterId: 视点人物 ID（从角色列表选，没有则留空字符串）
- emotionStart: 开场情绪标签（2-4 字，如：松弛/警觉/愤怒/期待）
- emotionEnd: 收尾情绪标签（2-4 字）
- infoRelease: 信息释放量，三选一：reader-more / reader-same / reader-less
- foreshadowLinks: 关联伏笔 ID 数组（埋设或回收的伏笔，没有则空数组）
- reason: 一句话理由（20 字内）

角色：${charMap}
伏笔：${fMap}

章节：
${digest}

仅返回 JSON 数组，每个元素 { chapterId, locator: { povCharacterId, emotionStart, emotionEnd, infoRelease, foreshadowLinks }, reason }。不要输出任何额外文字。`;

    const result = await llmClient.callLLM(prompt, '你是资深小说结构分析师，擅长定位每场戏的视点与情绪走向。');
    const parsed = parseJsonFromLLM<unknown>(result);
    if (!Array.isArray(parsed)) throw new Error('LLM 返回非数组');

    const validRelease = ['reader-more', 'reader-same', 'reader-less'];
    const charIds = new Set(characters.map(c => c.id));
    const fIds = new Set(foreshadows.map(f => f.id));
    const out: SceneLocatorSuggestion[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const chapterId = String(raw.chapterId || '');
      if (!mainChapters.some(c => c.id === chapterId)) continue;
      const loc = (raw.locator || {}) as Record<string, unknown>;
      const release = validRelease.includes(String(loc.infoRelease)) ? String(loc.infoRelease) as SceneLocator['infoRelease'] : 'reader-same';
      const povId = String(loc.povCharacterId || '');
      const links = Array.isArray(loc.foreshadowLinks)
        ? loc.foreshadowLinks.filter(x => typeof x === 'string' && fIds.has(String(x))).map(x => String(x))
        : [];
      out.push({
        chapterId,
        locator: {
          povCharacterId: charIds.has(povId) ? povId : undefined,
          emotionStart: String(loc.emotionStart || '').slice(0, 8) || undefined,
          emotionEnd: String(loc.emotionEnd || '').slice(0, 8) || undefined,
          infoRelease: release,
          foreshadowLinks: links,
        },
        reason: String(raw.reason || '').slice(0, 40),
      });
    }
    return out;
  } catch (e) {
    console.warn('suggestSceneLocators LLM 失败，回退启发式:', e);
    return mainChapters.map((ch, idx) => heuristicLocator(ch, idx, characters, foreshadows));
  }
}

/**
 * 场景定位仪自动评分（规格书阶段3-4：填完自动生成本章评分）。
 * 基于四要素完整度计算 0-100 分，并给出维度细分：
 *   - 视点清晰度（0-25）：指定了视点人物得满分
 *   - 情绪弧度（0-25）：起止情绪均有且不同得满分，相同得半分
 *   - 信息节奏（0-25）：明确释放量得满分
 *   - 伏笔密度（0-25）：关联伏笔数 ×8，上限 25
 * 纯本地计算，无 LLM 调用，可同步执行。
 */
export function scoreSceneLocator(locator: SceneLocator): {
  score: number;
  breakdown: import('@/types').SceneLocatorScoreBreakdown;
} {
  const povClarity = locator.povCharacterId ? 25 : 0;
  const hasStart = !!locator.emotionStart?.trim();
  const hasEnd = !!locator.emotionEnd?.trim();
  let emotionArc = 0;
  if (hasStart && hasEnd) {
    emotionArc = locator.emotionStart === locator.emotionEnd ? 13 : 25;
  } else if (hasStart || hasEnd) {
    emotionArc = 8;
  }
  const infoRhythm = locator.infoRelease ? 25 : 0;
  const linkCount = locator.foreshadowLinks?.length ?? 0;
  const foreshadowDensity = Math.min(25, linkCount * 8);
  const score = povClarity + emotionArc + infoRhythm + foreshadowDensity;
  return {
    score,
    breakdown: { povClarity, emotionArc, infoRhythm, foreshadowDensity },
  };
}

function heuristicLocator(
  ch: Chapter,
  idx: number,
  characters: Character[],
  foreshadows: Foreshadow[],
): SceneLocatorSuggestion {
  const pov = characters[idx % Math.max(1, characters.length)];
  const emotions = ['松弛', '警觉', '期待', '紧张', '愤怒', '释然', '压抑', '振奋'];
  const linked = foreshadows
    .filter(f => f.plantedChapterId === ch.id || f.payoffChapterId === ch.id)
    .slice(0, 3)
    .map(f => f.id);
  return {
    chapterId: ch.id,
    locator: {
      povCharacterId: pov?.id,
      emotionStart: emotions[idx % emotions.length],
      emotionEnd: emotions[(idx + 3) % emotions.length],
      infoRelease: idx % 3 === 0 ? 'reader-more' : idx % 3 === 1 ? 'reader-same' : 'reader-less',
      foreshadowLinks: linked,
    },
    reason: '基于章节序号与角色轮换的启发式推断，建议人工复核',
  };
}

// ==================== 自然语言命令 ====================

/** 自然语言修改指令的语义槽位（规格书阶段5-1：「AI 自动识别修改对象、生效节点、事件类型」）
 *  用户说一句"让导师在第 8 章提前牺牲"，AI 拆出三个结构化槽位，供用户确认/修正后再执行。
 *  核心原则：AI 负责算力（解析），人类负责判断（确认/修正槽位）。
 */
export interface NLCommandSlots {
  /** 修改对象：被改动的实体（如"导师"、"反派身份"、"主角能力"、"《暗影》伏笔"） */
  modificationTarget: string;
  /** 生效节点：改动从哪里开始起作用（如"第8章"、"中期情节"、"结尾"、"全本"） */
  effectiveNode: string;
  /** 事件类型：改动的性质（如"死亡"、"换身份"、"提前"、"延后"、"新增"、"删除"、"合并"） */
  eventType: string;
}

export interface NLCommandIntent {
  /** 解析后的目标 Tab */
  targetTab: TabId;
  /** 目标章节 ID（可选） */
  targetChapterId?: string;
  /** AI 对用户意图的复述，供用户确认 */
  interpretation: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 结构化语义槽位：修改对象 / 生效节点 / 事件类型（规格书阶段5-1）
   *  UI 会让用户确认/修正这三个槽位后再执行，而不是直接把整句丢给 LLM 跑。
   */
  slots?: NLCommandSlots;
}

const NL_KEYWORD_MAP: Array<{ keywords: string[]; tab: TabId }> = [
  { keywords: ['灵感', '想法', '脑洞', '闪念'], tab: 'inspiration' },
  { keywords: ['连线画布', '力导向', '灵感缺口', '灵感画布'], tab: 'inspirationCanvas' },
  { keywords: ['骨架', '结构', '主线', '驱动'], tab: 'skeleton' },
  { keywords: ['核心驱动', '锁定'], tab: 'coreDriver' },
  { keywords: ['概览', '鸟瞰', '章节网格'], tab: 'chapterGrid' },
  { keywords: ['节拍', 'beat'], tab: 'beats' },
  { keywords: ['扩展', '扩写', '展开'], tab: 'expansion' },
  { keywords: ['多线', '支线', '并行'], tab: 'multiline' },
  { keywords: ['场景定位', '视点', '情绪走向'], tab: 'sceneLocator' },
  { keywords: ['骨架曲线', '高潮位', '断层', '骨架时间轴'], tab: 'skeletonTimeline' },
  { keywords: ['诊断', '体检', '问题'], tab: 'diagnosis' },
  { keywords: ['节奏', '快慢', '拖沓'], tab: 'pacing' },
  { keywords: ['弧光', '人物成长', '角色变化'], tab: 'characters' },
  { keywords: ['共情', '读者感受', '代入'], tab: 'readerEmpathy' },
  { keywords: ['伏笔', '草蛇灰线', '回收'], tab: 'foreshadowBoard' },
  { keywords: ['情感一致', '情绪曲线', '情感连贯'], tab: 'emotionConsistency' },
  { keywords: ['读者评论', '评论回流', '读者反馈'], tab: 'reviewReflow' },
  { keywords: ['批注', '评论', '待办', '备注'], tab: 'comments' },
  { keywords: ['因果', '推演', '如果'], tab: 'causal' },
  { keywords: ['沙盒', '试运行', '对比试'], tab: 'sandbox' },
  { keywords: ['快照', '版本花园'], tab: 'snapshots' },
  { keywords: ['分支花园', '分叉', '分支'], tab: 'branchGarden' },
  { keywords: ['版本对比', 'diff'], tab: 'versionDiff' },
];

/**
 * 把用户自然语言命令解析为跳转意图。
 * 例如"帮我看看第三章的节奏是不是太慢了" → { targetTab: 'pacing', targetChapterId: '...', interpretation: '...' }
 */
export async function parseNaturalLanguageCommand(params: {
  input: string;
  chapters: Chapter[];
}): Promise<NLCommandIntent> {
  const { input, chapters } = params;
  const trimmed = input.trim();
  if (!trimmed) {
    return { targetTab: 'inspiration', interpretation: '空命令', confidence: 0 };
  }

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  // Mock / 无 key：走关键词匹配
  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(200);
    return heuristicNLCommand(trimmed, chapters);
  }

  try {
    const validTabs = NL_KEYWORD_MAP.map(k => k.tab);
    const chDigest = chapters.filter(c => c.levelType === 'chapter').slice(0, 40)
      .map(c => `id=${c.id} 第${c.order + 1}章《${c.title}》`).join('\n');
    const prompt = `用户在小说打磨台中输入了一句自然语言命令，请解析为跳转意图 + 结构化语义槽位。

可用 Tab：${validTabs.join(', ')}
章节列表：
${chDigest}

用户命令："${trimmed}"

返回 JSON（不要输出额外文字）：
{
  "targetTab": "TabId",
  "targetChapterId": "章节id或null",
  "interpretation": "对用户意图的复述(30字内)",
  "confidence": 0到1的数字,
  "slots": {
    "modificationTarget": "修改对象：被改动的实体（如导师/反派身份/主角能力/《暗影》伏笔）",
    "effectiveNode": "生效节点：改动从哪里起作用（如第8章/中期情节/结尾/全本）",
    "eventType": "事件类型：改动的性质（如死亡/换身份/提前/延后/新增/删除/合并）"
  }
}

slots 三个槽位必须填写：
- modificationTarget：从命令里识别出"对什么动手"（角色/伏笔/设定/章节），找不到时填"未指定"
- effectiveNode：从命令里识别出"在哪一章/哪个阶段生效"，找不到时填"未指定"
- eventType：从命令里识别出"做什么改动"，找不到时填"未指定"`;
    const result = await llmClient.callLLM(prompt, '你是小说创作助手的意图识别模块，把用户口语映射到打磨台的具体功能，并拆出结构化语义槽位供用户确认。');
    const parsed = parseJsonFromLLM<unknown>(result) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') throw new Error('LLM 返回非对象');

    const tab = validTabs.includes(String(parsed.targetTab) as TabId) ? String(parsed.targetTab) as TabId : 'inspiration';
    const cid = String(parsed.targetChapterId || '');
    const targetChapterId = cid && cid !== 'null' && chapters.some(c => c.id === cid) ? cid : undefined;
    // 解析语义槽位（规格书阶段5-1）
    const rawSlots = parsed.slots as Record<string, unknown> | undefined;
    const slots = rawSlots && typeof rawSlots === 'object'
      ? {
          modificationTarget: String(rawSlots.modificationTarget || '未指定').slice(0, 60),
          effectiveNode: String(rawSlots.effectiveNode || '未指定').slice(0, 60),
          eventType: String(rawSlots.eventType || '未指定').slice(0, 60),
        }
      : undefined;
    return {
      targetTab: tab,
      targetChapterId,
      interpretation: String(parsed.interpretation || '').slice(0, 60) || `跳转到「${tab}」`,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      slots,
    };
  } catch (e) {
    console.warn('parseNaturalLanguageCommand LLM 失败，回退关键词匹配:', e);
    return heuristicNLCommand(trimmed, chapters);
  }
}

function heuristicNLCommand(input: string, chapters: Chapter[]): NLCommandIntent {
  // 章节匹配：第N章 / 第三章 / "标题"
  let targetChapterId: string | undefined;
  const numMatch = input.match(/第\s*([一二三四五六七八九十百\d]+)\s*章/);
  let effectiveNodeFromChapter = '';
  if (numMatch) {
    const n = parseChineseNumber(numMatch[1]);
    const ch = chapters.filter(c => c.levelType === 'chapter').find(c => c.order === n - 1);
    if (ch) {
      targetChapterId = ch.id;
      effectiveNodeFromChapter = `第${n}章`;
    }
  } else {
    const byTitle = chapters.find(c => c.title && input.includes(c.title));
    if (byTitle) {
      targetChapterId = byTitle.id;
      effectiveNodeFromChapter = `《${byTitle.title}》`;
    }
  }

  // Tab 匹配
  let targetTab: TabId = 'inspiration';
  let confidence = 0.4;
  for (const { keywords, tab } of NL_KEYWORD_MAP) {
    if (keywords.some(k => input.includes(k))) {
      targetTab = tab;
      confidence = 0.7;
      break;
    }
  }

  // 语义槽位启发式提取（规格书阶段5-1）
  const slots = extractSlotsHeuristic(input, effectiveNodeFromChapter);

  return {
    targetTab,
    targetChapterId,
    interpretation: `关键词匹配：跳转到「${targetTab}」${targetChapterId ? '并定位到目标章节' : ''}`,
    confidence,
    slots,
  };
}

/** 从自然语言命令启发式提取三个语义槽位：修改对象 / 生效节点 / 事件类型 */
function extractSlotsHeuristic(input: string, effectiveNodeFromChapter: string): NLCommandSlots {
  // 事件类型：从命令里识别改动性质
  const EVENT_RULES: Array<{ keywords: string[]; type: string }> = [
    { keywords: ['死', '牺牲', '阵亡', '陨落', '身亡', '遇害'], type: '死亡' },
    { keywords: ['换身份', '变成', '替换', '伪装', '卧底'], type: '换身份' },
    { keywords: ['提前'], type: '提前' },
    { keywords: ['延后', '推迟'], type: '延后' },
    { keywords: ['新增', '增加', '添加', '补充'], type: '新增' },
    { keywords: ['删除', '移除', '去掉', '删掉'], type: '删除' },
    { keywords: ['合并', '合体'], type: '合并' },
    { keywords: ['分拆', '拆成'], type: '分拆' },
    { keywords: ['反转', '颠覆'], type: '反转' },
  ];
  let eventType = '未指定';
  for (const rule of EVENT_RULES) {
    if (rule.keywords.some(k => input.includes(k))) {
      eventType = rule.type;
      break;
    }
  }

  // 修改对象：从命令里识别被改动的实体
  // 启发式：取"让/把/将"后面的名词短语；找不到时回退到整句
  let modificationTarget = '未指定';
  const targetMatch = input.match(/(?:让|把|将)\s*([^\s，。、的]+)/);
  if (targetMatch && targetMatch[1]) {
    modificationTarget = targetMatch[1].slice(0, 30);
  } else {
    // 回退：移除事件关键词后剩下的部分
    const stripped = input.replace(/第[一二三四五六七八九十百\d]+章/g, '').trim();
    if (stripped.length > 0 && stripped.length < 30) {
      modificationTarget = stripped.slice(0, 30);
    }
  }

  // 生效节点：优先用已识别的章节，否则按阶段关键词识别
  let effectiveNode = effectiveNodeFromChapter || '未指定';
  if (!effectiveNodeFromChapter) {
    const NODE_RULES: Array<{ keywords: string[]; node: string }> = [
      { keywords: ['开头', '开篇', '序章'], node: '开头' },
      { keywords: ['中期', '中段', '中盘'], node: '中期情节' },
      { keywords: ['结尾', '终章', '结局', '尾声'], node: '结尾' },
      { keywords: ['全本', '全部', '整本'], node: '全本' },
    ];
    for (const rule of NODE_RULES) {
      if (rule.keywords.some(k => input.includes(k))) {
        effectiveNode = rule.node;
        break;
      }
    }
  }

  return { modificationTarget, effectiveNode, eventType };
}

function parseChineseNumber(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (s.length === 1) return map[s] || 0;
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + (map[s[1]] || 0);
  if (s.endsWith('十')) return (map[s[0]] || 0) * 10;
  if (s.includes('十')) {
    const parts = s.split('十');
    return (map[parts[0]] || 0) * 10 + (map[parts[1]] || 0);
  }
  return 0;
}

// ==================== 情感一致性 ====================

export interface EmotionCurvePoint {
  chapterId: string;
  chapterTitle: string;
  order: number;
  /** 情感强度 0-100 */
  intensity: number;
  /** 情感标签 */
  emotion: string;
}

export interface EmotionInconsistency {
  chapterId: string;
  /** 与前一章的情感断裂描述 */
  description: string;
  /** 建议如何衔接 */
  suggestion: string;
}

export interface EmotionConsistencyReport {
  curve: EmotionCurvePoint[];
  inconsistencies: EmotionInconsistency[];
  /** 整体情感走向概述 */
  overview: string;
}

/**
 * 跨章情感一致性分析：生成情感强度曲线，并标出情绪断裂点。
 */
export async function analyzeEmotionConsistency(params: {
  chapters: Chapter[];
}): Promise<EmotionConsistencyReport> {
  const { chapters } = params;
  const mainChapters = chapters.filter(c => c.levelType === 'chapter').slice(0, 40);
  if (mainChapters.length === 0) {
    return { curve: [], inconsistencies: [], overview: '暂无正文章节，无法分析情感走向。' };
  }

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(400);
    return heuristicEmotionReport(mainChapters);
  }

  try {
    const digest = mainChapters.map(ch =>
      `第${ch.order + 1}章 id=${ch.id} 《${ch.title}》 摘要:${(ch.summary || '').slice(0, 100)}`
    ).join('\n');

    const prompt = `分析以下章节的情感走向，输出情感强度曲线与情绪断裂点。

章节：
${digest}

仅返回 JSON：
{
  "curve": [{ "chapterId": "...", "chapterTitle": "...", "order": 0, "intensity": 0到100的整数, "emotion": "2-4字标签" }],
  "inconsistencies": [{ "chapterId": "...", "description": "与前一章情感断裂的描述(30字内)", "suggestion": "如何衔接(30字内)" }],
  "overview": "整体情感走向概述(60字内)"
}
不要输出额外文字。`;

    const result = await llmClient.callLLM(prompt, '你是资深小说情感节奏分析师，擅长识别情绪曲线的连贯与断裂。');
    const parsed = parseJsonFromLLM<unknown>(result) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') throw new Error('LLM 返回非对象');

    const validIds = new Set(mainChapters.map(c => c.id));
    const rawCurve = Array.isArray(parsed.curve) ? parsed.curve : [];
    const curve: EmotionCurvePoint[] = rawCurve
      .map((p: unknown) => {
        const r = p as Record<string, unknown>;
        const chapterId = String(r.chapterId || '');
        if (!validIds.has(chapterId)) return null;
        return {
          chapterId,
          chapterTitle: String(r.chapterTitle || '').slice(0, 30),
          order: typeof r.order === 'number' ? r.order : 0,
          intensity: typeof r.intensity === 'number' ? Math.max(0, Math.min(100, Math.round(r.intensity))) : 50,
          emotion: String(r.emotion || '').slice(0, 8) || '中性',
        };
      })
      .filter((x): x is EmotionCurvePoint => x !== null)
      .sort((a, b) => a.order - b.order);

    const rawInc = Array.isArray(parsed.inconsistencies) ? parsed.inconsistencies : [];
    const inconsistencies: EmotionInconsistency[] = rawInc
      .map((p: unknown) => {
        const r = p as Record<string, unknown>;
        const chapterId = String(r.chapterId || '');
        if (!validIds.has(chapterId)) return null;
        return {
          chapterId,
          description: String(r.description || '').slice(0, 60),
          suggestion: String(r.suggestion || '').slice(0, 60),
        };
      })
      .filter((x): x is EmotionInconsistency => x !== null);

    return {
      curve,
      inconsistencies,
      overview: String(parsed.overview || '').slice(0, 120) || '情感走向已生成，详见曲线与断裂点。',
    };
  } catch (e) {
    console.warn('analyzeEmotionConsistency LLM 失败，回退启发式:', e);
    return heuristicEmotionReport(mainChapters);
  }
}

function heuristicEmotionReport(chapters: Chapter[]): EmotionConsistencyReport {
  const emotions = ['松弛', '期待', '紧张', '高潮', '舒缓', '压抑', '振奋', '释然'];
  const curve: EmotionCurvePoint[] = chapters.map((ch, idx) => {
    // 模拟一个起伏曲线：sin 波 + 章节推进
    const base = 50 + Math.round(35 * Math.sin(idx / Math.max(2, chapters.length / 4)));
    return {
      chapterId: ch.id,
      chapterTitle: ch.title,
      order: ch.order,
      intensity: Math.max(10, Math.min(95, base)),
      emotion: emotions[idx % emotions.length],
    };
  });

  // 启发式断裂点：相邻强度差 > 40 视为断裂
  const inconsistencies: EmotionInconsistency[] = [];
  for (let i = 1; i < curve.length; i++) {
    const diff = Math.abs(curve[i].intensity - curve[i - 1].intensity);
    if (diff > 40) {
      inconsistencies.push({
        chapterId: curve[i].chapterId,
        description: `与上一章情感强度差 ${diff}，跳跃过大`,
        suggestion: '考虑增加过渡场景，让情绪转换更平滑',
      });
    }
  }

  return {
    curve,
    inconsistencies,
    overview: '基于章节序号的启发式情感曲线（建议配置 API Key 后获取精准分析）。',
  };
}

// ==================== 读者评论回流（规格书 3.3）====================

export interface ReviewReflowResult {
  target: 'foreshadow' | 'character' | 'pacing' | 'structure' | 'other';
  suggestion: string;
  relatedChapterId?: string;
  relatedCharacterId?: string;
  relatedForeshadowId?: string;
}

/**
 * 对单条读者评论做 AI 归类，输出应汇入哪个打磨阶段 + 处置建议。
 * 文档示例：
 *  - "配角林清瑶太久没出现" → character
 *  - "第15章反派动机不够充分" → pacing
 *  - "猜出了伏笔#7的走向" → foreshadow
 */
export async function classifyReaderReview(params: {
  content: string;
  chapters: Chapter[];
  characters: Character[];
  foreshadows: Foreshadow[];
}): Promise<ReviewReflowResult> {
  const { content, chapters, characters, foreshadows } = params;
  const trimmed = content.trim();
  if (!trimmed) {
    return { target: 'other', suggestion: '评论为空' };
  }

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(300);
    return heuristicClassify(trimmed, chapters, characters, foreshadows);
  }

  try {
    const charList = characters.slice(0, 20).map(c => `${c.id}:${c.name}`).join('、') || '（无角色）';
    const chList = chapters.filter(c => c.levelType === 'chapter').slice(0, 30)
      .map(c => `第${c.order + 1}章 id=${c.id}《${c.title}》`).join('、') || '（无章节）';
    const fList = foreshadows.slice(0, 15).map(f => `${f.id}:${f.title}[${f.status}]`).join('、') || '（无伏笔）';

    const prompt = `下面是一条读者评论，请归类它应汇入哪个打磨阶段，并给出处置建议。

读者评论：${trimmed}

可选目标：
- foreshadow：读者提到伏笔（猜到走向/等不及回收/觉得突兀）
- character：读者提到角色（太久没出现/动机不足/人设问题）
- pacing：读者提到节奏/某章问题（拖沓/无聊/反派动机）
- structure：读者提到整体结构/情节不合理
- other：其他

项目数据：
角色：${charList}
章节：${chList}
伏笔：${fList}

只返回 JSON：{"target":"...","suggestion":"一句话处置建议","relatedChapterId":"可选","relatedCharacterId":"可选","relatedForeshadowId":"可选"}`;

    const raw = await llmClient.callLLM(prompt, '你是读者评论分析助手，擅长把读者反馈归类到对应的打磨阶段。只返回 JSON。');
    const parsed = parseJsonFromLLM<ReviewReflowResult>(raw);
    if (parsed && parsed.target && parsed.suggestion) {
      return parsed;
    }
    return heuristicClassify(trimmed, chapters, characters, foreshadows);
  } catch {
    return heuristicClassify(trimmed, chapters, characters, foreshadows);
  }
}

/** 启发式归类：基于关键词匹配 */
function heuristicClassify(
  content: string,
  chapters: Chapter[],
  characters: Character[],
  foreshadows: Foreshadow[],
): ReviewReflowResult {
  const lower = content.toLowerCase();
  // 匹配角色名
  const matchedChar = characters.find(c => content.includes(c.name));
  if (matchedChar && (content.includes('没出现') || content.includes('太久') || content.includes('消失'))) {
    return {
      target: 'character',
      suggestion: `读者反映「${matchedChar.name}」太久没出现，建议在近期章节安排其出场`,
      relatedCharacterId: matchedChar.id,
    };
  }
  // 匹配伏笔
  const matchedFore = foreshadows.find(f => content.includes(f.title));
  if (matchedFore || content.includes('伏笔') || content.includes('猜到')) {
    return {
      target: 'foreshadow',
      suggestion: matchedFore
        ? `读者提到伏笔「${matchedFore.title}」，建议调整回收方式避免被猜透`
        : '读者提到伏笔相关，建议检查伏笔是否被过早揭露',
      relatedForeshadowId: matchedFore?.id,
    };
  }
  // 匹配章节号
  const chMatch = content.match(/第\s*(\d+)\s*章/);
  if (chMatch) {
    const order = parseInt(chMatch[1], 10) - 1;
    const chapter = chapters.find(c => c.order === order && c.levelType === 'chapter');
    if (chapter) {
      if (content.includes('动机') || content.includes('拖') || content.includes('无聊')) {
        return {
          target: 'pacing',
          suggestion: `读者反映第${order + 1}章存在问题，建议检查节奏与角色动机`,
          relatedChapterId: chapter.id,
        };
      }
    }
  }
  if (lower.includes('节奏') || lower.includes('慢') || lower.includes('快')) {
    return { target: 'pacing', suggestion: '读者提到节奏问题，建议检查整体节奏曲线' };
  }
  if (lower.includes('情节') || lower.includes('结构') || lower.includes('逻辑')) {
    return { target: 'structure', suggestion: '读者提到情节结构问题，建议复核骨架因果链' };
  }
  return { target: 'other', suggestion: '未明确归类，建议人工研判' };
}

// ==================== 灵感缺口智能提示（规格书阶段1-3）====================

export interface InspirationGapResult {
  id: string;
  kind: 'missing-character' | 'missing-foreshadow' | 'missing-conflict' | 'missing-setting' | 'weak-motivation';
  description: string;
  suggestion: string;
  relatedChapterId?: string;
  relatedCharacterId?: string;
}

/**
 * 基于已锁定蓝图和主线，反向推断灵感缺口。
 * Mock / 无 key 时走启发式：检查角色覆盖、伏笔回收、冲突分布等。
 */
export async function detectInspirationGaps(params: {
  chapters: Chapter[];
  characters: Character[];
  foreshadows: Foreshadow[];
}): Promise<InspirationGapResult[]> {
  const { chapters, characters, foreshadows } = params;
  const mainChapters = chapters.filter(c => c.levelType === 'chapter');
  if (mainChapters.length === 0) return [];

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(400);
    return heuristicGaps(mainChapters, characters, foreshadows);
  }

  try {
    const digest = mainChapters.slice(0, 30).map(c => `第${c.order + 1}章《${c.title}》:${(c.summary || '').slice(0, 60)}`).join('\n');
    const charDigest = characters.slice(0, 15).map(c => `${c.name}(${c.role})`).join('、') || '（无角色）';
    const prompt = `下面是一部小说的大纲与角色，请反向推断还缺什么灵感素材。

章节：
${digest}

角色：${charDigest}

请输出 3-5 条缺口提示，每条包含：
- kind: missing-character(缺关键角色)/missing-foreshadow(缺伏笔铺垫)/missing-conflict(缺冲突)/missing-setting(缺设定)/weak-motivation(主角动机单薄)
- description: 缺口描述
- suggestion: 填补建议

只返回 JSON 数组。`;

    const raw = await llmClient.callLLM(prompt, '你是资深小说策划，擅长反向推断故事还缺什么灵感素材。只返回 JSON 数组。');
    const parsed = parseJsonFromLLM<InspirationGapResult[]>(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((g, i) => ({ ...g, id: g.id || `gap-${Date.now()}-${i}` }));
    }
    return heuristicGaps(mainChapters, characters, foreshadows);
  } catch {
    return heuristicGaps(mainChapters, characters, foreshadows);
  }
}

/** 启发式缺口检测 */
function heuristicGaps(
  chapters: Chapter[],
  characters: Character[],
  foreshadows: Foreshadow[],
): InspirationGapResult[] {
  const gaps: InspirationGapResult[] = [];
  const now = Date.now();

  // 缺反派：有主角但没反派
  const hasAntagonist = characters.some(c => c.role === 'antagonist');
  if (!hasAntagonist && characters.some(c => c.role === 'protagonist')) {
    gaps.push({
      id: `gap-${now}-1`,
      kind: 'missing-character',
      description: '已锁定主角，但缺少明确的反派/对手角色',
      suggestion: '构思一个与主角目标对立的反派，冲突才有发动机',
    });
  }
  // 伏笔回收缺口：有未回收伏笔且超过 5 章未提及
  const overdue = foreshadows.filter(f => f.status !== 'paid-off' && f.status !== 'abandoned' && f.chaptersSinceMention > 5);
  if (overdue.length > 0) {
    gaps.push({
      id: `gap-${now}-2`,
      kind: 'missing-foreshadow',
      description: `${overdue.length} 个伏笔超过 5 章未提及，存在被读者遗忘风险`,
      suggestion: '在近期章节安排一次伏笔呼应，或补充新的铺垫伏笔',
    });
  }
  // 主角动机单薄：主角档案无 profile.motivation
  const protagonist = characters.find(c => c.role === 'protagonist');
  if (protagonist && (!protagonist.profile || !protagonist.profile.motivation)) {
    gaps.push({
      id: `gap-${now}-3`,
      kind: 'weak-motivation',
      description: `主角「${protagonist.name}」的动机尚未明确`,
      suggestion: '补充主角的核心驱动力（复仇/成长/守护/寻真），驱动整条主线',
      relatedCharacterId: protagonist.id,
    });
  }
  // 冲突缺口：章节超过 5 章但无冲突相关内容
  if (chapters.length > 5) {
    const lowConflictChapters = chapters.filter(c => !(c.summary || '').match(/冲突|对抗|危机|阻碍|敌人/));
    if (lowConflictChapters.length > chapters.length / 2) {
      gaps.push({
        id: `gap-${now}-4`,
        kind: 'missing-conflict',
        description: `${lowConflictChapters.length}/${chapters.length} 章节摘要未体现冲突，节奏可能平淡`,
        suggestion: '为这些章节注入外部阻碍或内心矛盾，提升张力',
      });
    }
  }
  return gaps;
}

// ==================== 灵感连线情节变体扩展（规格书阶段1-2：点击连线展开 3 个变体方向）====================

export interface StoryLinkVariant {
  /** 变体标题（如：暗中结盟/反目成仇/相互利用） */
  title: string;
  /** 这个关联可以发展成什么情节（30-80 字） */
  plotDirection: string;
  /** 落点风险/连锁提示，供创作者判断代价 */
  risk: string;
}

/**
 * 点击已建立的灵感连线，展开「这个关联可以发展成什么情节」，附带 3 个变体方向。
 * 核心原则：AI 负责算力（给方向），人类负责判断（挑哪个/要不要用）。
 */
export async function expandStoryLinkVariants(params: {
  sourceTitle: string;
  targetTitle: string;
  narrative: string;
}): Promise<StoryLinkVariant[]> {
  const { sourceTitle, targetTitle, narrative } = params;
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(300);
    return heuristicLinkVariants(sourceTitle, targetTitle, narrative);
  }

  try {
    const prompt = `两张灵感卡之间已建立叙事连线，请展开「这个关联可以发展成什么情节」，给出 3 个变体方向。

卡 A：${sourceTitle}
卡 B：${targetTitle}
连线脉络：${narrative || '（无）'}

返回 JSON 数组（3 项），每项：
{
  "title": "变体标题（4-8字，如：暗中结盟/反目成仇/相互利用）",
  "plotDirection": "这个关联可以发展成什么情节（30-80字，要具体可写）",
  "risk": "落点风险或连锁提示（20-40字）"
}

3 个变体要走向明显不同的方向（如合作/对抗/利用），让创作者有真正的选择空间。只返回 JSON。`;
    const raw = await llmClient.callLLM(prompt, '你是资深小说策划，擅长把一个关系点子发展成多条可写的情节线。只返回 JSON 数组。');
    const parsed = parseJsonFromLLM<unknown>(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const out: StoryLinkVariant[] = parsed
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(r => ({
          title: String(r.title || '').slice(0, 16) || '变体',
          plotDirection: String(r.plotDirection || '').slice(0, 120),
          risk: String(r.risk || '').slice(0, 60),
        }))
        .filter(v => v.plotDirection);
      if (out.length > 0) return out.slice(0, 3);
    }
    return heuristicLinkVariants(sourceTitle, targetTitle, narrative);
  } catch {
    return heuristicLinkVariants(sourceTitle, targetTitle, narrative);
  }
}

/** 启发式连线变体：基于两张卡标题 + 脉络生成 3 个通用方向（合作/对抗/利用） */
function heuristicLinkVariants(source: string, target: string, narrative: string): StoryLinkVariant[] {
  const ctx = narrative ? `（脉络：${narrative.slice(0, 20)}）` : '';
  return [
    {
      title: '暗中结盟',
      plotDirection: `${source} 与 ${target} 因共同利益暗中联手，但各自保留底牌，合作中互相试探${ctx}`,
      risk: '结盟若过早暴露，会让外部反派提前警觉，需控制信息释放节奏',
    },
    {
      title: '反目成仇',
      plotDirection: `${source} 与 ${target} 因一次误会或利益冲突走向对立，原本的关联变成攻击彼此的把柄${ctx}`,
      risk: '反目需要前置铺垫足够动机，否则会显得突兀',
    },
    {
      title: '相互利用',
      plotDirection: `${source} 表面顺从 ${target}，实则为达目的借力打力；双方都以为自己在利用对方${ctx}`,
      risk: '双向利用易让两条线纠缠，需理清谁先识破谁',
    },
  ];
}

// ==================== 假设式推演（规格书阶段2-2：如果主角第20章选择…在时间轴上标注后续变化）====================

export interface HypothesisProjectionChange {
  /** 受影响的章节序号（从 1 开始），用于在时间轴上标注位置 */
  chapterOrder: number;
  /** 该章会发生的变化（30-80 字） */
  change: string;
  /** 变化性质：增强/削弱/反转/新增/删除 */
  kind: 'enhance' | 'weaken' | 'reverse' | 'add' | 'remove';
}

export interface HypothesisProjectionResult {
  /** 对假设的整体判断（成立前提/主要后果一句话） */
  summary: string;
  /** 在时间轴上标注的后续变化（按章节序号升序） */
  changes: HypothesisProjectionChange[];
  /** 推演出的潜在风险/需补充的铺垫 */
  risks: string[];
}

/**
 * 假设式推演：用户提出「如果主角第 20 章选择和反派合作」这类假设，
 * AI 推演后续在时间轴上的连锁变化，标注到对应章节位置。
 * 不改动原大纲，只返回标注结果供创作者评估。
 */
export async function runHypothesisProjection(params: {
  hypothesis: string;
  anchorChapterOrder: number;
  chapters: Chapter[];
}): Promise<HypothesisProjectionResult> {
  const { hypothesis, anchorChapterOrder, chapters } = params;
  const mainChapters = chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order);
  // 推演范围：从假设锚点章到结尾
  const downstream = mainChapters.filter(c => c.order >= anchorChapterOrder - 1).slice(0, 15);

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(400);
    return heuristicHypothesis(hypothesis, downstream);
  }

  try {
    const digest = downstream.map(c => `第${c.order + 1}章《${c.title}》:${(c.summary || '').slice(0, 50)}`).join('\n');
    const prompt = `用户提出一个假设性情节改动，请推演它在后续时间轴上的连锁变化，标注到对应章节。

假设：${hypothesis}
锚点章节：第${anchorChapterOrder}章
后续章节：
${digest || '（无）'}

返回 JSON（不要额外文字）：
{
  "summary": "对假设的整体判断（30字内，含主要后果）",
  "changes": [
    { "chapterOrder": 章节序号(从1开始), "change": "该章会发生的变化(30-80字)", "kind": "enhance|weaken|reverse|add|remove" }
  ],
  "risks": ["潜在风险或需补充的铺垫", "..."]
}

changes 至少 2 条，覆盖锚点之后的多个章节，让创作者在时间轴上一眼看清波及范围。kind 含义：
- enhance 增强（原冲突/张力被放大）
- weaken 削弱（原功能被弱化）
- reverse 反转（原走向被逆转）
- add 新增（需补一场戏）
- remove 删除（原场次失去作用）`;

    const raw = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长推演假设性改动在时间轴上的连锁后果。只返回 JSON。');
    const parsed = parseJsonFromLLM<unknown>(raw) as Record<string, unknown> | null;
    if (parsed && typeof parsed === 'object') {
      const validKinds: HypothesisProjectionChange['kind'][] = ['enhance', 'weaken', 'reverse', 'add', 'remove'];
      const changes: HypothesisProjectionChange[] = Array.isArray(parsed.changes)
        ? (parsed.changes as unknown[])
            .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
            .map(x => {
              const order = Number(x.chapterOrder);
              const kind = String(x.kind).toLowerCase();
              return {
                chapterOrder: Number.isFinite(order) && order > 0 ? Math.floor(order) : anchorChapterOrder,
                change: String(x.change || '').slice(0, 120),
                kind: validKinds.includes(kind as HypothesisProjectionChange['kind']) ? kind as HypothesisProjectionChange['kind'] : 'add',
              };
            })
            .filter(c => c.change)
        : [];
      const risks = Array.isArray(parsed.risks)
        ? (parsed.risks as unknown[]).map(r => String(r).slice(0, 80)).filter(Boolean)
        : [];
      const summary = String(parsed.summary || '').slice(0, 60);
      if (changes.length > 0 || summary) {
        return { summary, changes: changes.slice(0, 8), risks: risks.slice(0, 4) };
      }
    }
    return heuristicHypothesis(hypothesis, downstream);
  } catch {
    return heuristicHypothesis(hypothesis, downstream);
  }
}

/** 启发式假设推演：基于假设关键词在锚点之后章节生成通用变化标注 */
function heuristicHypothesis(
  hypothesis: string,
  downstream: Chapter[],
): HypothesisProjectionResult {
  const h = hypothesis.toLowerCase();
  const isCoop = h.includes('合作') || h.includes('联手') || h.includes('结盟');
  const isBetray = h.includes('背叛') || h.includes('反水');
  const isDeath = h.includes('死') || h.includes('牺牲');
  const changes: HypothesisProjectionChange[] = [];
  const baseKind = isCoop ? 'reverse' : isBetray ? 'reverse' : isDeath ? 'remove' : 'enhance';
  const label = isCoop ? '敌我合作' : isBetray ? '关键背叛' : isDeath ? '关键角色退场' : '情节调整';

  // 锚点章 + 后续 3 章标注变化
  for (let i = 0; i < Math.min(4, downstream.length); i++) {
    const ch = downstream[i];
    if (i === 0) {
      changes.push({
        chapterOrder: ch.order + 1,
        change: `假设成立：${label}在本章触发，原定对抗/走向被改写，需补一场转折戏承接`,
        kind: baseKind,
      });
    } else if (i === 1) {
      changes.push({
        chapterOrder: ch.order + 1,
        change: `后续连锁：原本章的冲突失去对手，需替换阻力来源或调整为内部矛盾`,
        kind: 'weaken',
      });
    } else {
      changes.push({
        chapterOrder: ch.order + 1,
        change: `远端波及：相关伏笔回收节奏与角色弧光需重新校准，避免悬空`,
        kind: 'add',
      });
    }
  }
  return {
    summary: `${label}假设成立后，将在锚点章触发转折，并削弱后续原冲突、波及远端伏笔与弧光`,
    changes,
    risks: [
      '需为假设成立补充前置铺垫，否则转折显得突兀',
      '原对抗线失去对手后，要尽快引入新阻力维持张力',
    ],
  };
}

// ==================== 伏笔回收合理性检测 + 逾期应急回收方案（规格书阶段4-4）====================

/**
 * 回收合理性检测：检查已标记 paid-off 的伏笔，其回收章节正文是否真正呼应了埋设内容。
 * Mock / 无 key 时走启发式：基于埋设章节与回收章节的关键词重合度判定。
 */
export async function checkForeshadowPayoffReasonability(params: {
  foreshadows: Foreshadow[];
  chapters: Chapter[];
}): Promise<ForeshadowPayoffCheck[]> {
  const { foreshadows, chapters } = params;
  // 仅检测已回收伏笔（paid-off）；无回收章节的跳过
  const paidOff = foreshadows.filter(f => f.status === 'paid-off' && f.payoffChapterId);
  if (paidOff.length === 0) return [];

  const chapterById = new Map(chapters.map(c => [c.id, c]));
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(400);
    return paidOff.map(f => heuristicPayoffCheck(f, chapterById));
  }

  try {
    const digest = paidOff.slice(0, 15).map(f => {
      const planted = chapterById.get(f.plantedChapterId || '');
      const payoff = chapterById.get(f.payoffChapterId || '');
      return `伏笔 ${f.id}《${f.title}》描述:${(f.description || '').slice(0, 60)}
埋设章节《${planted?.title ?? '?'}》:${(planted?.summary || '').slice(0, 80)}
回收章节《${payoff?.title ?? '?'}》:${(payoff?.summary || '').slice(0, 80)}`;
    }).join('\n---\n');

    const prompt = `下面是若干已标记"已回收"的伏笔，请逐条判断回收章节是否真正呼应了埋设内容。

${digest}

对每条伏笔输出：
- foreshadowId: 伏笔 ID
- level: good(回收充分呼应)/weak(只是提了一句，未真正回收)/missing(回收章节完全没呼应)
- reason: 一句话说明判定依据
- suggestion: 若非 good，给出改进建议；good 时填"无需调整"

严格输出 JSON 数组。`;

    const raw = await llmClient.callLLM(prompt);
    const parsed = parseJsonFromLLM<ForeshadowPayoffCheck[]>(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(p => ({
        foreshadowId: String(p.foreshadowId ?? ''),
        reasonable: p.level === 'good',
        level: (['good', 'weak', 'missing'].includes(p.level) ? p.level : 'weak') as ForeshadowPayoffCheck['level'],
        reason: String(p.reason ?? '').slice(0, 200),
        suggestion: String(p.suggestion ?? '').slice(0, 200),
      }));
    }
    return paidOff.map(f => heuristicPayoffCheck(f, chapterById));
  } catch {
    return paidOff.map(f => heuristicPayoffCheck(f, chapterById));
  }
}

/** 启发式回收合理性检测：基于埋设/回收章节摘要与伏笔标题的关键词重合度 */
function heuristicPayoffCheck(
  f: Foreshadow,
  chapterById: Map<string, Chapter>,
): ForeshadowPayoffCheck {
  const payoff = chapterById.get(f.payoffChapterId || '');
  if (!payoff) {
    return {
      foreshadowId: f.id,
      reasonable: false,
      level: 'missing',
      reason: '回收章节不存在，无法验证',
      suggestion: '重新指定有效的回收章节',
    };
  }
  // 提取伏笔标题与描述的关键词（长度 ≥2 的中文片段）
  const keywords = extractKeywords(`${f.title} ${f.description}`);
  const haystack = `${payoff.title} ${payoff.summary} ${payoff.content || ''}`;
  const hitCount = keywords.filter(k => haystack.includes(k)).length;

  if (hitCount === 0) {
    return {
      foreshadowId: f.id,
      reasonable: false,
      level: 'missing',
      reason: `回收章节《${payoff.title}》未出现与伏笔相关的关键词`,
      suggestion: '在回收章节补充对伏笔的明确呼应，否则读者会觉得伏笔被遗弃',
    };
  }
  if (hitCount < Math.max(1, Math.ceil(keywords.length / 3))) {
    return {
      foreshadowId: f.id,
      reasonable: false,
      level: 'weak',
      reason: `回收章节仅提及 ${hitCount}/${keywords.length} 个相关关键词，呼应较弱`,
      suggestion: '加强回收章节对伏笔的展开，让回收更有"草蛇灰线"的满足感',
    };
  }
  return {
    foreshadowId: f.id,
    reasonable: true,
    level: 'good',
    reason: `回收章节《${payoff.title}》充分呼应了埋设内容（命中 ${hitCount} 个关键词）`,
    suggestion: '无需调整',
  };
}

/** 简易中文关键词提取：按非汉字字符切分，保留长度 ≥2 的片段 */
function extractKeywords(text: string): string[] {
  if (!text) return [];
  return text
    .split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)
    .filter(s => s.length >= 2)
    .slice(0, 8);
}

/**
 * 逾期伏笔应急回收方案：为逾期未回收的伏笔生成 3 个变体回收方向。
 * Mock / 无 key 时走启发式：基于伏笔描述与就近章节生成通用方案。
 */
export async function generateEmergencyRecoveryPlan(params: {
  foreshadow: Foreshadow;
  chapters: Chapter[];
  characters: Character[];
}): Promise<EmergencyRecoveryPlan> {
  const { foreshadow, chapters, characters } = params;
  const mainChapters = chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order);
  // 就近选择当前最新章节作为推荐回收点（已过埋设点的最近章节）
  const plantedOrder = mainChapters.find(c => c.id === foreshadow.plantedChapterId)?.order ?? 0;
  const candidates = mainChapters.filter(c => c.order >= plantedOrder);
  const recommended = candidates[candidates.length - 1] ?? mainChapters[mainChapters.length - 1];

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider === 'mock' || !settings.apiKey) {
    await llmClient.delay(400);
    return heuristicRecoveryPlan(foreshadow, recommended, characters);
  }

  try {
    const charDigest = characters.slice(0, 10).map(c => `${c.name}(${c.role})`).join('、') || '（无角色）';
    const chapterDigest = mainChapters.slice(-5).map(c => `第${c.order + 1}章《${c.title}》:${(c.summary || '').slice(0, 60)}`).join('\n');
    const prompt = `这条伏笔已经逾期未回收，请给出 3 个应急回收方案。

伏笔标题：${foreshadow.title}
伏笔描述：${foreshadow.description || '（无描述）'}
埋设章节：第${(mainChapters.find(c => c.id === foreshadow.plantedChapterId)?.order ?? 0) + 1}章
关联角色：${foreshadow.relatedCharacters.length > 0 ? foreshadow.relatedCharacters.map(id => characters.find(c => c.id === id)?.name).filter(Boolean).join('、') : '无'}

最近 5 章概要：
${chapterDigest}

角色：${charDigest}

输出 JSON：
{
  "variants": [
    { "title": "方案名（10 字内）", "content": "具体怎么做（50 字内）", "cost": "low/medium/high" }
  ],
  "summary": "综合提示（30 字内）"
}

要求 3 个变体，分别对应低成本（就近补一句呼应）、中成本（安排一个过渡场景）、高成本（重构一段情节作为回收高潮）。`;

    const raw = await llmClient.callLLM(prompt);
    const parsed = parseJsonFromLLM<{ variants: EmergencyRecoveryVariant[]; summary: string }>(raw);
    if (parsed && Array.isArray(parsed.variants) && parsed.variants.length > 0) {
      return {
        foreshadowId: foreshadow.id,
        recommendedChapterId: recommended?.id,
        recommendedChapterTitle: recommended?.title,
        variants: parsed.variants.slice(0, 3).map(v => ({
          title: String(v.title ?? '').slice(0, 20),
          content: String(v.content ?? '').slice(0, 100),
          cost: (['low', 'medium', 'high'].includes(v.cost) ? v.cost : 'medium') as EmergencyRecoveryVariant['cost'],
        })),
        summary: String(parsed.summary ?? '').slice(0, 60),
      };
    }
    return heuristicRecoveryPlan(foreshadow, recommended, characters);
  } catch {
    return heuristicRecoveryPlan(foreshadow, recommended, characters);
  }
}

/** 启发式应急回收方案：基于伏笔描述与就近章节生成 3 个通用变体 */
function heuristicRecoveryPlan(
  foreshadow: Foreshadow,
  recommended: Chapter | undefined,
  characters: Character[],
): EmergencyRecoveryPlan {
  const relatedCharNames = foreshadow.relatedCharacters
    .map(id => characters.find(c => c.id === id)?.name)
    .filter(Boolean);
  const charHint = relatedCharNames.length > 0 ? `通过${relatedCharNames.join('、')}之口` : '通过旁白或配角对话';
  const titleHint = foreshadow.title || '该伏笔';

  return {
    foreshadowId: foreshadow.id,
    recommendedChapterId: recommended?.id,
    recommendedChapterTitle: recommended?.title,
    variants: [
      {
        title: '就近补一句呼应',
        content: `在《${recommended?.title ?? '最近章节}'}中安排 ${charHint} 顺带提及 ${titleHint}，让读者想起这条线索还在`,
        cost: 'low',
      },
      {
        title: '过渡场景承接',
        content: `新增一个过渡场景，让主角在行动中自然触发对 ${titleHint} 的回忆或推进，为正式回收铺垫`,
        cost: 'medium',
      },
      {
        title: '重构为回收高潮',
        content: `把 ${titleHint} 的回收设计为某个章节的高潮点，让逾期反而成为强化戏剧性的契机`,
        cost: 'high',
      },
    ],
    summary: `建议在《${recommended?.title ?? '最近章节}'}附近回收，3 个方案按成本递增`,
  };
}
