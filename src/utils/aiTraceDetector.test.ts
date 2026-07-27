import { describe, it, expect } from 'vitest';
import {
  detectAITrace,
  generateDeAISuggestions,
  PLATFORM_STANDARDS,
  STRICTEST_THRESHOLD,
  type AITraceReport,
} from './aiTraceDetector';

// ============ 测试文本 ============

// 自然的人类写作：长短句交错、无陈词成语、无总分式结构、无情绪直述
const HUMAN_TEXT = `雨落在窗台上。滴答。
她拿起杯子，茶已经凉了。门口传来脚步声，是谁？
不知道。可能是邻居，也可能是风。
她站起身，走到窗边。楼下的路灯亮了，橘黄色的光晕在雨里散开。
远处的车鸣笛，近处的猫叫了一声。
她把窗帘拉上一半，又拉开一些。茶还是凉的。
她没喝。`;

// 典型 AI 痕迹：连续相同句式 + 总分式结构 + 成语堆砌 + 情绪直述 + 万能比喻 + 过渡词滥用
const AI_TEXT = `他感到一阵愤怒。他感到一阵恐惧。他感到一阵迷茫。他感到一阵绝望。
首先，他如同被雷击一般，仿佛时间停止了似的，犹如困兽般挣扎。其次，气势磅礴的力量震耳欲聋，惊心动魄。最后，波澜壮阔的景象令人窒息，不可思议。
然而，他心中涌起悲伤。于是，他内心涌起绝望。随后，他感到一阵孤独。`;

describe('detectAITrace', () => {
  describe('空文本与短文本', () => {
    it('空文本不抛错，返回默认低风险报告', () => {
      const report = detectAITrace('');
      expect(report.aiRate).toBe(0);
      expect(report.humanScore).toBe(100);
      expect(report.dimensions).toEqual([]);
    });

    it('undefined 输入不抛错', () => {
      // htmlToText 内部对 falsy 输入返回空字符串
      expect(() => detectAITrace(undefined as unknown as string)).not.toThrow();
    });

    it('短文本 (< 50 字) 应降级处理，aiRate 为 0', () => {
      const report = detectAITrace('这是一段很短的文本。');
      expect(report.aiRate).toBe(0);
      expect(report.humanScore).toBe(100);
      // verdicts 应包含"文本过短"提示
      expect(report.verdicts.length).toBeGreaterThan(0);
      expect(report.verdicts[0].message).toContain('文本过短');
    });

    it('含 HTML 标签的短文本应先剥离标签再判断', () => {
      const report = detectAITrace('<p>短</p>');
      expect(report.aiRate).toBe(0);
    });
  });

  describe('检测准确性', () => {
    it('纯人类文本 AI 率应低于阈值 30', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(report.aiRate).toBeLessThan(30);
      expect(report.humanScore).toBeGreaterThan(50);
    });

    it('纯 AI 文本 AI 率应高于阈值 25', () => {
      const report = detectAITrace(AI_TEXT);
      expect(report.aiRate).toBeGreaterThan(25);
    });

    it('AI 文本应比人类文本 AI 率更高', () => {
      const humanReport = detectAITrace(HUMAN_TEXT);
      const aiReport = detectAITrace(AI_TEXT);
      expect(aiReport.aiRate).toBeGreaterThan(humanReport.aiRate);
    });

    it('AI 文本应触发多个维度的问题', () => {
      const report = detectAITrace(AI_TEXT);
      const dimensionsWithIssues = report.dimensions.filter(d => d.issues.length > 0);
      expect(dimensionsWithIssues.length).toBeGreaterThanOrEqual(3);
    });

    it('中英混合文本应正确检测不抛错', () => {
      const mixedText = `今天 weather 很好，我们去了 park 散步。The sun is bright and warm.
她 looked at the sky，感到一丝宁静。Birds were singing in the trees.
风吹过 her hair，带来 spring 的气息。Everything was peaceful.`;
      expect(() => detectAITrace(mixedText)).not.toThrow();
      const report = detectAITrace(mixedText);
      expect(report.aiRate).toBeGreaterThanOrEqual(0);
      expect(report.aiRate).toBeLessThanOrEqual(100);
    });
  });

  describe('返回结构', () => {
    it('应包含 aiRate (0-100)', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(report.aiRate).toBeGreaterThanOrEqual(0);
      expect(report.aiRate).toBeLessThanOrEqual(100);
    });

    it('应包含 humanScore (0-100) 且 humanScore + aiRate ≈ 100', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(report.humanScore).toBeGreaterThanOrEqual(0);
      expect(report.humanScore).toBeLessThanOrEqual(100);
      expect(report.aiRate + report.humanScore).toBeCloseTo(100, 0);
    });

    it('应包含 perplexity 和 burstiness 数值', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(typeof report.perplexity).toBe('number');
      expect(typeof report.burstiness).toBe('number');
    });

    it('应包含 sentenceLengthStats 统计', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(report.sentenceLengthStats).toHaveProperty('short');
      expect(report.sentenceLengthStats).toHaveProperty('medium');
      expect(report.sentenceLengthStats).toHaveProperty('long');
      expect(report.sentenceLengthStats).toHaveProperty('avg');
      expect(report.sentenceLengthStats).toHaveProperty('stdDev');
    });

    it('应包含 dimensions 维度列表，每项有 name/score/weight/issues', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(Array.isArray(report.dimensions)).toBe(true);
      expect(report.dimensions.length).toBeGreaterThan(0);
      for (const dim of report.dimensions) {
        expect(dim).toHaveProperty('name');
        expect(dim).toHaveProperty('score');
        expect(dim).toHaveProperty('weight');
        expect(dim).toHaveProperty('issues');
        expect(dim.score).toBeGreaterThanOrEqual(0);
        expect(dim.score).toBeLessThanOrEqual(100);
      }
    });

    it('应包含 verdicts 平台判定列表', () => {
      const report = detectAITrace(HUMAN_TEXT);
      expect(Array.isArray(report.verdicts)).toBe(true);
      expect(report.verdicts.length).toBe(PLATFORM_STANDARDS.length);
      for (const v of report.verdicts) {
        expect(v).toHaveProperty('platform');
        expect(v).toHaveProperty('threshold');
        expect(v).toHaveProperty('passed');
        expect(v).toHaveProperty('margin');
        expect(v).toHaveProperty('message');
        expect(typeof v.passed).toBe('boolean');
      }
    });

    it('AI 文本应在部分平台 verdicts 中 passed=false', () => {
      const report = detectAITrace(AI_TEXT);
      const failedPlatforms = report.verdicts.filter(v => !v.passed);
      expect(failedPlatforms.length).toBeGreaterThan(0);
    });
  });

  describe('平台标准常量', () => {
    it('PLATFORM_STANDARDS 应包含主流平台', () => {
      const platforms = PLATFORM_STANDARDS.map(s => s.platform);
      expect(platforms).toContain('起点中文网');
      expect(platforms).toContain('番茄小说');
      expect(platforms.length).toBeGreaterThanOrEqual(5);
    });

    it('STRICTEST_THRESHOLD 应为正数（最严格平台阈值）', () => {
      expect(STRICTEST_THRESHOLD).toBeGreaterThan(0);
      expect(STRICTEST_THRESHOLD).toBeLessThanOrEqual(20);
    });
  });

  describe('AI 文本特定维度检测', () => {
    it('"首先/其次/最后" 总分式结构应被检测', () => {
      // 文本需 > 50 字才会进入完整检测流程
      const text =
        '首先，他做了第一件事，仔细地完成了每个步骤。其次，他做了第二件事，同样认真对待。最后，他做了第三件事，为整个计划画上句号。';
      const report = detectAITrace(text);
      const listDim = report.dimensions.find(d => d.name.includes('总分式'));
      expect(listDim).toBeDefined();
      expect(listDim!.issues.length).toBeGreaterThan(0);
    });

    it('连续相同句式开头应被检测', () => {
      // 4 句都以 "他慢慢地" 开头，4 字指纹完全一致
      const text =
        '他慢慢地走向前方，脚步很轻。他慢慢地走向大门，推开了门。他慢慢地走向车里，坐了下来。他慢慢地走向远方，消失在夜色中。';
      const report = detectAITrace(text);
      const repeatedDim = report.dimensions.find(d => d.name.includes('句式雷同'));
      expect(repeatedDim).toBeDefined();
      expect(repeatedDim!.issues.length).toBeGreaterThan(0);
    });

    it('陈词成语堆砌应被检测', () => {
      // 同一段落内堆砌 > 2 个陈词成语，文本 > 50 字才会进入完整检测
      const text =
        '波澜壮阔的景象令人窒息，气势磅礴的力量震耳欲聋，惊心动魄的场景出现了。这不可思议的变化让人叹为观止，刻骨铭心的感受涌上心头。';
      const report = detectAITrace(text);
      const idiomDim = report.dimensions.find(d => d.name.includes('成语'));
      expect(idiomDim).toBeDefined();
      expect(idiomDim!.issues.length).toBeGreaterThan(0);
    });

    it('情绪直述应被检测', () => {
      const text =
        '他感到一阵愤怒，握紧了拳头。心中涌起悲伤，眼眶微微泛红。不禁感到绝望，仿佛世界崩塌。一股寒意涌上心头，他打了个冷颤。';
      const report = detectAITrace(text);
      const emotionDim = report.dimensions.find(d => d.name.includes('情绪'));
      expect(emotionDim).toBeDefined();
      expect(emotionDim!.issues.length).toBeGreaterThan(0);
    });
  });
});

describe('generateDeAISuggestions', () => {
  it('应返回字符串数组', () => {
    const report = detectAITrace(AI_TEXT);
    const suggestions = generateDeAISuggestions(report);
    expect(Array.isArray(suggestions)).toBe(true);
    for (const s of suggestions) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('AI 文本应生成多条优化建议', () => {
    const report = detectAITrace(AI_TEXT);
    const suggestions = generateDeAISuggestions(report);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('人类文本应返回非空建议列表', () => {
    const report = detectAITrace(HUMAN_TEXT);
    const suggestions = generateDeAISuggestions(report);
    expect(suggestions.length).toBeGreaterThan(0);
    // 人类文本要么给出针对性优化建议，要么给出"已达标"兜底建议
    for (const s of suggestions) {
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('空报告（无维度）应返回兜底建议', () => {
    const emptyReport: AITraceReport = {
      aiRate: 0,
      humanScore: 100,
      perplexity: 50,
      burstiness: 50,
      sentenceLengthStats: { short: 0, medium: 0, long: 0, avg: 0, stdDev: 0 },
      dimensions: [],
      verdicts: [],
    };
    const suggestions = generateDeAISuggestions(emptyReport);
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
