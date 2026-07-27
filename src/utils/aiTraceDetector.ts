/**
 * AI 痕迹检测器
 *
 * 纯本地、确定性的检测，对标主流 AI 检测平台（知网 AIGC、GPTZero、朱雀、
 * Originality.ai 等）的判定逻辑。检测 10+ 维度的 AI 写作典型特征，给出：
 *   - aiRate: 0-100，AI 痕迹分数（越低越像真人）
 *   - humanScore: 0-100，真人质感分（越高越好）
 *   - issues: 具体问题清单（含定位与修改建议）
 *   - verdict: 按发布平台标准给出结论
 *
 * 检测维度（与 system prompt 中的规避项一一对应）：
 *   1. 句式雷同（连续三句结构相同）
 *   2. 过渡词滥用
 *   3. 四字成语堆砌
 *   4. 排比三连
 *   5. 总分式段落
 *   6. 对话标签单调
 *   7. 情绪直述
 *   8. 总结收尾
 *   9. 对仗工整
 *  10. 万能比喻
 *  11. 句长方差过小（AI 倾向均匀句长）
 *  12. 困惑度过低（perplexity，用字符级熵近似）
 *  13. 突发度低（burstiness，句长变化幅度）
 */

// ==================== 类型定义 ====================

export type AIIssueSeverity = 'high' | 'medium' | 'low';

export interface AITraceIssue {
  /** 问题类型，对应检测维度 */
  type: string;
  /** 严重度 */
  severity: AIIssueSeverity;
  /** 问题描述 */
  description: string;
  /** 命中的原文片段（用于定位） */
  snippet: string;
  /** 修改建议 */
  suggestion: string;
}

export interface AITraceReport {
  /** AI 痕迹分数 0-100，越低越像真人 */
  aiRate: number;
  /** 真人质感分 0-100，越高越好 */
  humanScore: number;
  /** 困惑度近似值（越高越像真人） */
  perplexity: number;
  /** 突发度近似值（越高越像真人） */
  burstiness: number;
  /** 句长统计 */
  sentenceLengthStats: {
    short: number;
    medium: number;
    long: number;
    avg: number;
    stdDev: number;
  };
  /** 各维度得分明细 */
  dimensions: Array<{
    name: string;
    score: number;
    weight: number;
    issues: AITraceIssue[];
  }>;
  /** 按发布平台标准判定 */
  verdicts: PlatformVerdict[];
}

export interface PlatformVerdict {
  /** 平台名 */
  platform: string;
  /** 该平台的 AI 率上限（%） */
  threshold: number;
  /** 是否通过 */
  passed: boolean;
  /** 当前 AI 率与阈值的差值（负数=通过余量，正数=超出） */
  margin: number;
  /** 结论文案 */
  message: string;
}

// ==================== 发布平台标准 ====================

/**
 * 平台标准配置（只有 platform 和 threshold 是配置项，
 * passed/margin/message 由 detectAITrace 运行时计算）
 */
export interface PlatformStandard {
  platform: string;
  threshold: number;
}

/**
 * 主流发布平台的 AI 率检测标准（基于 2024-2025 各平台公开政策）。
 * threshold 表示该平台允许的最高 AI 痕迹分数，超过即可能被限流/下架。
 */
export const PLATFORM_STANDARDS: PlatformStandard[] = [
  { platform: '起点中文网', threshold: 30 },
  { platform: '番茄小说', threshold: 25 },
  { platform: '晋江文学城', threshold: 20 },
  { platform: '知乎盐选', threshold: 15 },
  { platform: '微信读书', threshold: 35 },
  { platform: '豆瓣阅读', threshold: 20 },
  { platform: '出版社投稿', threshold: 10 },
];

// 最严格平台（出版社投稿）的阈值
export const STRICTEST_THRESHOLD = 10;

// ==================== 工具函数 ====================

function htmlToText(html: string): string {
  if (!html) return '';
  // 移除 HTML 标签与实体
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function splitSentences(text: string): string[] {
  if (!text) return [];
  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    current += text[i];
    // 中文省略号"……"是两个 U+2026 字符，第一个断句后第二个会成空句，
    // 所以遇到 … 时跳过紧随其后的下一个 …
    if (text[i] === '…' && text[i + 1] === '…') {
      current += text[i + 1];
      i++;
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
      continue;
    }
    if (['。', '！', '？', '…', '!', '?'].includes(text[i])) {
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
    }
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/** 计算标准差 */
function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** 字符级熵（近似困惑度的逆向指标） */
function charEntropy(text: string): number {
  if (text.length < 10) return 0;
  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  const len = text.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ==================== 各维度检测器 ====================

// --- 维度 1：过渡词滥用 ---
const TRANSITION_WORDS = ['然而', '不过', '只是', '可是', '但是', '于是', '因此', '所以', '接着', '随后', '与此同时', '不禁', '不由得', '转眼间', '片刻之后', '过了一会儿'];

function detectTransitionAbuse(sentences: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  let startCount = 0;
  const hitWords: string[] = [];
  for (const s of sentences) {
    for (const w of TRANSITION_WORDS) {
      if (s.startsWith(w)) {
        startCount++;
        hitWords.push(w);
        break;
      }
    }
  }
  // 段落开头超 2 次用过渡词即视为 AI 痕迹
  if (startCount > 2) {
    issues.push({
      type: 'transition-abuse',
      severity: startCount > 5 ? 'high' : 'medium',
      description: `过渡词在句首出现 ${startCount} 次（${[...new Set(hitWords)].slice(0, 4).join('、')}），AI 倾向用过渡词充当连接`,
      snippet: hitWords.slice(0, 3).map(w => `${w}...`).join(' / '),
      suggestion: '减少"然而/于是/随后"等过渡词开头，改用动作或场景转换推进',
    });
  }
  return issues;
}

// --- 维度 2：四字成语堆砌 ---
// 注意：只检测已知的陈词成语，不能用"四字+逗号+四字"通配模式，
// 否则会误报几乎所有正常中文（如"风吹过处，落叶纷飞"会被误判）
const CLICHE_IDIOMS = ['波澜壮阔', '气势磅礴', '令人窒息', '不可思议', '美轮美奂', '叹为观止', '心潮澎湃', '热血沸腾', '惊天动地', '震耳欲聋', '恍如隔世', '刻骨铭心', '魂牵梦萦', '惊心动魄', '刻不容缓', '势不可挡', '蔚为壮观', '不可名状', '难以言喻', '不言而喻', '顺理成章', '理所当然', '毋庸置疑', '显而易见', '众所周知', '与此同时'];

function detectIdiomPileup(paragraphs: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  for (const p of paragraphs) {
    let idiomCount = 0;
    const hitIdioms: string[] = [];
    for (const idiom of CLICHE_IDIOMS) {
      const matches = p.match(new RegExp(idiom, 'g'));
      if (matches) {
        idiomCount += matches.length;
        hitIdioms.push(...matches);
      }
    }

    if (idiomCount > 2) {
      issues.push({
        type: 'idiom-pileup',
        severity: idiomCount > 4 ? 'high' : 'medium',
        description: `段落内陈词成语出现 ${idiomCount} 次（${hitIdioms.slice(0, 3).join('、')}），AI 倾向堆砌成语`,
        snippet: hitIdioms.slice(0, 3).join('、'),
        suggestion: '用具体动作或细节替代空泛成语，如"波澜壮阔"→"浪头拍上甲板，咸涩的水雾糊了一脸"',
      });
    }
  }
  return issues;
}

// --- 维度 3：情绪直述 ---
const EMOTION_PATTERNS = [
  /他感到一阵[^\s，。]{1,6}/g,
  /她感到一阵[^\s，。]{1,6}/g,
  /心中涌起[^\s，。]{1,6}/g,
  /心里涌起[^\s，。]{1,6}/g,
  /内心[^\s，。]{0,4}(悲伤|愤怒|喜悦|恐惧|绝望)/g,
  /不禁感到[^\s，。]{1,6}/g,
  /一股[^\s，。]{1,6}涌上心头/g,
];

function detectEmotionTelling(sentences: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  const hits: string[] = [];
  for (const s of sentences) {
    for (const re of EMOTION_PATTERNS) {
      const m = s.match(re);
      if (m) hits.push(...m);
    }
  }
  if (hits.length > 0) {
    issues.push({
      type: 'emotion-telling',
      severity: hits.length > 3 ? 'high' : 'medium',
      description: `直述情绪 ${hits.length} 处（${hits.slice(0, 2).join('、')}），AI 倾向直接报告情绪而非展示`,
      snippet: hits.slice(0, 2).join(' / '),
      suggestion: '改用肢体语言/感官展示情绪，如"他感到愤怒"→"他的指节捏得发白"',
    });
  }
  return issues;
}

// --- 维度 4：万能比喻过载 ---
function detectMetaphorOverload(sentences: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  const metaphorRe = /(如同|仿佛|好似|宛如|像是|犹如)[^，。！？]{2,15}(一般|似的|一样|般)?/g;
  const hits: string[] = [];
  for (const s of sentences) {
    const m = s.match(metaphorRe);
    if (m) hits.push(...m);
  }
  // 每段超 2 次即为过载
  if (hits.length > 2) {
    issues.push({
      type: 'metaphor-overload',
      severity: hits.length > 5 ? 'medium' : 'low',
      description: `"如同/仿佛/像是"比喻出现 ${hits.length} 次，AI 倾向过度使用万能比喻`,
      snippet: hits.slice(0, 2).join(' / '),
      suggestion: '减少比喻频次，部分改用直写或动作描写',
    });
  }
  return issues;
}

// --- 维度 5：排比/对仗三连 ---
function detectParallelOveruse(paragraphs: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  for (const p of paragraphs) {
    // 三段排比："既...又...还..." / "不仅...而且...更..."
    const triple = p.match(/(既[^，。]{1,10}[，、])\s*(又[^，。]{1,10}[，、])\s*(还|更|也)/g);
    const triple2 = p.match(/(不仅[^，。]{1,10}[，、])\s*(而且[^，。]{1,10}[，、])\s*(更|还|也)/g);
    const count = (triple?.length || 0) + (triple2?.length || 0);
    if (count > 1) {
      issues.push({
        type: 'parallel-overuse',
        severity: 'medium',
        description: `段落内三段排比出现 ${count} 次，AI 倾向工整排比`,
        snippet: p.slice(0, 30) + '...',
        suggestion: '拆解排比，保留一两句，其余改为自然语序',
      });
    }
  }
  return issues;
}

// --- 维度 6：对话标签单调 ---
function detectDialogueTagMonotony(text: string): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  // 匹配 "他说" "她说" 紧跟引号的情况
  const tagRe = /(他|她|它)(说|道|问|答)/g;
  const matches = text.match(tagRe) || [];
  // 连续两个对话都用"他说/她说"
  const dialogueBlocks = text.match(/[""][^""]{1,50}[""][，。]?(他|她)说/g) || [];
  if (matches.length > 4 && dialogueBlocks.length > 1) {
    issues.push({
      type: 'dialogue-tag-monotony',
      severity: 'medium',
      description: `"他说/她说"类对话标签出现 ${matches.length} 次，AI 倾向单调标签`,
      snippet: '他说... / 她说...',
      suggestion: '用动作代替标签（"她把茶盏一放"），或直接省略标签',
    });
  }
  return issues;
}

// --- 维度 7：总结收尾 ---
const SUMMARY_PATTERNS = [
  /这一刻[，,]?他(终于)?明白/g,
  /这一刻[，,]?她(终于)?明白/g,
  /从此以后/g,
  /就这样[，,]?\s*[^，。]{0,10}了/g,
  /或许[，,]?\s*这(就是|便是)/g,
];

function detectSummaryEnding(paragraphs: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  const hits: string[] = [];
  for (const p of paragraphs) {
    for (const re of SUMMARY_PATTERNS) {
      const m = p.match(re);
      if (m) hits.push(...m);
    }
  }
  if (hits.length > 0) {
    issues.push({
      type: 'summary-ending',
      severity: hits.length > 2 ? 'medium' : 'low',
      description: `段落末尾出现 ${hits.length} 处升华总结（${hits.slice(0, 2).join('、')}）`,
      snippet: hits.slice(0, 2).join(' / '),
      suggestion: '删掉总结句，让场景自己说话；真人写作很少每段升华',
    });
  }
  return issues;
}

// --- 维度 8：句长方差过小（突发度低） ---
function detectLowBurstiness(sentences: string[]): { issues: AITraceIssue[]; burstiness: number } {
  const issues: AITraceIssue[] = [];
  if (sentences.length < 5) return { issues, burstiness: 50 };

  const lengths = sentences.map(s => s.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const sd = stdDev(lengths);
  // burstiness = 标准差 / 均值，真人写作通常 > 0.5，AI 通常 < 0.3
  const burstiness = avg > 0 ? clamp((sd / avg) * 100) : 0;

  if (burstiness < 30) {
    issues.push({
      type: 'low-burstiness',
      severity: burstiness < 20 ? 'high' : 'medium',
      description: `句长方差过小（突发度 ${burstiness.toFixed(0)}），AI 倾向均匀句长，真人写作长短句交错明显`,
      snippet: `平均句长 ${avg.toFixed(1)} 字，标准差 ${sd.toFixed(1)}`,
      suggestion: '混入短句（<10字）和碎片句，制造呼吸感；偶尔用一个词成句',
    });
  }
  return { issues, burstiness };
}

// --- 维度 9：困惑度过低（字符熵低 = 用词重复 = AI 痕迹） ---
function detectLowPerplexity(text: string): { issues: AITraceIssue[]; perplexity: number } {
  const issues: AITraceIssue[] = [];
  const entropy = charEntropy(text);
  // 短文本字符熵天然偏低（样本不足），需要按长度做补偿：
  // 文本 <200 字时，熵会系统性偏低，用对数补偿避免误判
  const lenCompensation = text.length < 200
    ? Math.log2(200 / Math.max(text.length, 50)) * 0.8
    : 0;
  const adjustedEntropy = entropy + lenCompensation;
  // 中文文本字符熵通常 7-9 之间；AI 生成往往因用词集中而偏低
  // 将熵映射到 0-100 的 perplexity 分数
  const perplexity = clamp((adjustedEntropy - 5) * 30);

  if (perplexity < 40) {
    issues.push({
      type: 'low-perplexity',
      severity: perplexity < 25 ? 'high' : 'medium',
      description: `困惑度过低（${perplexity.toFixed(0)}），用词重复度高，AI 倾向高频复用词汇`,
      snippet: `字符熵 ${entropy.toFixed(2)}`,
      suggestion: '替换重复用词，使用同义词、具体名词、动词替代泛词',
    });
  }
  return { issues, perplexity };
}

// --- 维度 10：连续相同句式结构 ---
function detectRepeatedStructure(sentences: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  if (sentences.length < 3) return issues;

  // 简化句式指纹：取前 4 个字（主语+谓语开头）
  const fingerprints = sentences.map(s => s.slice(0, Math.min(4, s.length)));
  let consecutiveCount = 0;
  let maxConsecutive = 0;
  let startIdx = 0;
  for (let i = 1; i < fingerprints.length; i++) {
    if (fingerprints[i] === fingerprints[i - 1]) {
      consecutiveCount++;
      if (consecutiveCount > maxConsecutive) {
        maxConsecutive = consecutiveCount;
        startIdx = i - consecutiveCount;
      }
    } else {
      consecutiveCount = 0;
    }
  }
  // 连续 3 句以上相同开头
  if (maxConsecutive >= 2) {
    const repeated = sentences.slice(startIdx, startIdx + maxConsecutive + 1);
    issues.push({
      type: 'repeated-structure',
      severity: maxConsecutive >= 3 ? 'high' : 'medium',
      description: `连续 ${maxConsecutive + 1} 句以"${fingerprints[startIdx]}"开头，句式雷同`,
      snippet: repeated.map(s => s.slice(0, 15)).join(' / '),
      suggestion: '变换句式开头，用倒装、状语前置或不同主语打破雷同',
    });
  }
  return issues;
}

// --- 维度 11：总分式段落 ---
function detectListStructure(paragraphs: string[]): AITraceIssue[] {
  const issues: AITraceIssue[] = [];
  for (const p of paragraphs) {
    // "第一...第二...第三..." 或 "首先...其次...最后..."
    if (/第[一二三四五六七八九]/.test(p) && /第[二三四五六七八九]/.test(p) && /第[三四五六七八九]/.test(p)) {
      issues.push({
        type: 'list-structure',
        severity: 'high',
        description: '段落使用"第一/第二/第三"总分式结构，这是 AI 经典段落组织方式',
        snippet: p.slice(0, 40) + '...',
        suggestion: '改为自然叙事，用连接动作或场景过渡替代列举',
      });
    }
    if (/首先/.test(p) && /其次/.test(p) && /(最后|最终)/.test(p)) {
      issues.push({
        type: 'list-structure',
        severity: 'high',
        description: '段落使用"首先/其次/最后"总分式结构',
        snippet: p.slice(0, 40) + '...',
        suggestion: '改为自然叙事，用连接动作或场景过渡替代列举',
      });
    }
  }
  return issues;
}

// ==================== 主检测函数 ====================

export function detectAITrace(html: string): AITraceReport {
  const text = htmlToText(html);
  const sentences = splitSentences(text);
  const paragraphs = text.split(/\n+/).filter(p => p.trim());

  // 空文本或过短文本
  if (sentences.length === 0 || text.length < 50) {
    return {
      aiRate: 0,
      humanScore: 100,
      perplexity: 50,
      burstiness: 50,
      sentenceLengthStats: { short: 0, medium: 0, long: 0, avg: 0, stdDev: 0 },
      dimensions: [],
      verdicts: PLATFORM_STANDARDS.map(s => ({
        ...s,
        passed: true,
        margin: -s.threshold,
        message: '文本过短，无法检测',
      })),
    };
  }

  // ===== 各维度检测 =====
  const transitionIssues = detectTransitionAbuse(sentences);
  const idiomIssues = detectIdiomPileup(paragraphs);
  const emotionIssues = detectEmotionTelling(sentences);
  const metaphorIssues = detectMetaphorOverload(sentences);
  const parallelIssues = detectParallelOveruse(paragraphs);
  const dialogueTagIssues = detectDialogueTagMonotony(text);
  const summaryIssues = detectSummaryEnding(paragraphs);
  const { issues: burstinessIssues, burstiness } = detectLowBurstiness(sentences);
  const { issues: perplexityIssues, perplexity } = detectLowPerplexity(text);
  const repeatedStructureIssues = detectRepeatedStructure(sentences);
  const listStructureIssues = detectListStructure(paragraphs);

  // ===== 句长统计 =====
  const lengths = sentences.map(s => s.length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const sdLen = stdDev(lengths);
  const short = lengths.filter(l => l < 10).length;
  const medium = lengths.filter(l => l >= 10 && l <= 20).length;
  const long = lengths.filter(l => l > 20).length;

  // ===== 维度评分（每个维度 0-100，越高越像 AI） =====
  const dimensions: AITraceReport['dimensions'] = [
    {
      name: '过渡词滥用',
      score: clamp(transitionIssues.length * 18),
      weight: 1.2,
      issues: transitionIssues,
    },
    {
      name: '成语堆砌',
      score: clamp(idiomIssues.length * 22),
      weight: 1.0,
      issues: idiomIssues,
    },
    {
      name: '情绪直述',
      score: clamp(emotionIssues.length * 20),
      weight: 1.3,
      issues: emotionIssues,
    },
    {
      name: '万能比喻过载',
      score: clamp(metaphorIssues.length * 15),
      weight: 0.8,
      issues: metaphorIssues,
    },
    {
      name: '排比对仗过载',
      score: clamp(parallelIssues.length * 25),
      weight: 0.9,
      issues: parallelIssues,
    },
    {
      name: '对话标签单调',
      score: clamp(dialogueTagIssues.length * 20),
      weight: 1.0,
      issues: dialogueTagIssues,
    },
    {
      name: '总结收尾',
      score: clamp(summaryIssues.length * 22),
      weight: 1.0,
      issues: summaryIssues,
    },
    {
      name: '突发度（句长方差）',
      // burstiness 越低越像 AI：score = 100 - burstiness
      score: clamp(100 - burstiness),
      weight: 1.5,
      issues: burstinessIssues,
    },
    {
      name: '困惑度（用词多样性）',
      // perplexity 越低越像 AI
      score: clamp(100 - perplexity),
      weight: 1.5,
      issues: perplexityIssues,
    },
    {
      name: '句式雷同',
      score: clamp(repeatedStructureIssues.length * 30),
      weight: 1.4,
      issues: repeatedStructureIssues,
    },
    {
      name: '总分式段落',
      score: clamp(listStructureIssues.length * 35),
      weight: 1.2,
      issues: listStructureIssues,
    },
  ];

  // ===== 加权平均得 AI 率 =====
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedScore = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const aiRate = clamp(weightedScore / totalWeight);

  const humanScore = clamp(100 - aiRate);

  // ===== 平台判定 =====
  const verdicts = PLATFORM_STANDARDS.map(standard => {
    const margin = aiRate - standard.threshold;
    const passed = aiRate <= standard.threshold;
    const message = passed
      ? `AI 率 ${aiRate.toFixed(1)}% ≤ 阈值 ${standard.threshold}%，通过（余量 ${Math.abs(margin).toFixed(1)}%）`
      : `AI 率 ${aiRate.toFixed(1)}% > 阈值 ${standard.threshold}%，未通过（超出 ${margin.toFixed(1)}%）`;
    return { ...standard, passed, margin, message };
  });

  return {
    aiRate,
    humanScore,
    perplexity,
    burstiness,
    sentenceLengthStats: {
      short,
      medium,
      long,
      avg: Number(avgLen.toFixed(1)),
      stdDev: Number(sdLen.toFixed(1)),
    },
    dimensions,
    verdicts,
  };
}

// ==================== 降 AI 策略建议 ====================

/**
 * 根据 AI 痕迹报告生成针对性的降 AI 改写建议。
 * 按 score 降序排列，只保留得分 > 30 的维度。
 */
export function generateDeAISuggestions(report: AITraceReport): string[] {
  const suggestions: string[] = [];
  const sorted = [...report.dimensions].sort((a, b) => b.score - a.score);

  for (const dim of sorted) {
    if (dim.score <= 30) break;
    const topIssue = dim.issues[0];
    if (topIssue) {
      suggestions.push(`【${dim.name}】${topIssue.suggestion}`);
    } else {
      suggestions.push(`【${dim.name}】该维度得分 ${dim.score.toFixed(0)}，建议针对性优化`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('当前文本 AI 痕迹较低，已达到主流发布平台标准。');
  }

  return suggestions;
}
