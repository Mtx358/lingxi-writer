/**
 * src/utils/aiService.ts 单元测试
 *
 * 测试目标：
 *   - 纯函数/同步函数：analyzeCharacterArcs / filterSensitiveWords / analyzeChapterForReading
 *   - Mock provider 路径：generateContinuation / expandText / polishText / generateBrainstorm 等
 *     （provider='mock' 时不调用 LLM，直接返回预置 mock 数据）
 *   - LLM 路径：mock llmClient.callLLM，验证 prompt 构造、JSON 解析、humanize 后处理
 *   - 流式 mock 路径：generateContinuationStream / polishTextStream 的 chunk 分发与中止
 *   - 错误降级：LLM 抛错时 fallback 到 mock 分支
 *
 * 测试策略：
 *   - 纯函数直接断言（无 LLM/IPC 依赖）
 *   - Mock 路径：updateSettings({ provider: 'mock' }) 即可，无需 mock IPC
 *   - LLM 路径：vi.spyOn(llmClient, 'callLLM') 控制返回值
 *   - 流式路径：provider='mock' 时 chunk 分发由内部 delay + split 实现，可直接测试
 *
 * 注意：humanizeWithAITraceCheck 依赖 fullHumanize / detectAITrace / deAIByReport 三个外部模块，
 * 测试不 mock 这些模块，验证端到端行为（mock 数据经过 humanize 后仍为有效 HTML）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateContinuation,
  generateContinuationStream,
  expandText,
  expandTextStream,
  polishText,
  polishTextStream,
  analyzeChapter,
  generateBrainstorm,
  generateStoryIdea,
  generateCharacterNames,
  generateChapterTitleSuggestions,
  polishOutline,
  analyzeCharacterArcs,
  filterSensitiveWords,
  analyzeChapterForReading,
  generateMultipleVersions,
  switchPerspective,
  analyzeStructure,
  checkStyleConsistency,
  expandOutlineNode,
  generateChapterBeats,
  generateStructureVariants,
  generateConflictCompass,
  askMaterialQuestion,
  previewCausalImpact,
  generateFullBookReview,
  generateCoreSettingCardQuestions,
  checkSettingCardContradictions,
  generateBlueprintOverview,
  generateBlueprintChangeImpact,
  generateWritingByInstruction,
  optimizeSynopsis,
  recommendPlatformTags,
  updateSettings,
  setLLMClient,
  getLLMClient,
} from './aiService';
import { llmClient, type LLMClient } from './llmClient';
import type { Chapter, Character, Material, Foreshadow, ProjectSettingCard, BlueprintOverview } from '@/types';

// ============ 测试 fixtures ============
function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'proj-1',
    name: '林墨',
    role: 'protagonist',
    color: '#3b82f6',
    profile: {
      personality: '冷静、理性',
      goal: '寻找真相',
      background: '前刑警',
    },
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'proj-1',
    parentId: null,
    title: '第一章 开始',
    summary: '主角发现线索',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 1000,
    content: '<p>林墨走进房间，看见了桌上的信封。</p><p>他打开信封，里面是一张旧照片。</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMaterial(overrides: Partial<Material> = {}): Material {
  return {
    id: 'mat-1',
    projectId: 'proj-1',
    title: '灵感卡片',
    type: 'inspiration',
    content: '一个关于复仇与救赎的故事',
    tags: [],
    category: '默认',
    references: [],
    pinned: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    id: 'fs-1',
    projectId: 'proj-1',
    title: '关键信件',
    description: '一封被隐瞒的信件',
    status: 'planted',
    plantedChapterId: null,
    payoffChapterId: null,
    priority: 'high',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 0,
    notes: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSettingCard(overrides: Partial<ProjectSettingCard> = {}): ProjectSettingCard {
  return {
    title: '测试小说',
    genreTags: ['玄幻', '爽文'],
    sellingPoint: '主角逆袭',
    protagonist: {
      name: '林墨',
      personalityKeywords: ['冷静', '理性'],
      coreDesire: '寻找真相',
      fatalFlaw: '过于自信',
      goldenFinger: '系统',
      growthArc: '平凡 → 觉醒 → 逆袭',
    },
    worldview: {
      basicRules: '修真世界',
      powerSystem: '灵气体系',
    },
    coreConflict: {
      mainConflict: '人神大战',
      ultimateGoal: '拯救苍生',
    },
    emotionalTone: 'cool',
    romanceType: 'single',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<BlueprintOverview> = {}): BlueprintOverview {
  return {
    mainline: '主线一句话',
    startPoint: '起点状态',
    turnPoints: [{ progress: 30, title: '转折1', description: '描述' }],
    endPoint: '终点',
    growthArc: [{ volumeIndex: 1, fromState: '平凡', experiences: '获得能力', toState: '觉醒' }],
    characterFates: [{ characterName: '林墨', keyNodes: '初始→觉醒', ending: '逆袭' }],
    volumes: [{ index: 1, title: '第一卷', chapterRange: '第1-30章', coreTask: '建立主角', endingHook: '钩子' }],
    lockedAt: null,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============ 公共 setup ============
beforeEach(() => {
  // 每个测试前重置为 mock provider
  updateSettings({ provider: 'mock', strictness: 50, temperature: 0.7 });
});

afterEach(() => {
  // 测试后恢复 mock provider，避免污染其他测试
  updateSettings({ provider: 'mock', strictness: 50, temperature: 0.7 });
});

// ============ analyzeCharacterArcs（同步纯函数）============
describe('analyzeCharacterArcs', () => {
  it('空角色数组返回空数组', () => {
    const chapters = [makeChapter()];
    expect(analyzeCharacterArcs(chapters, [])).toEqual([]);
  });

  it('空章节返回空数组', () => {
    const chars = [makeCharacter()];
    expect(analyzeCharacterArcs([], chars)).toEqual([]);
  });

  it('非 chapter 类型章节被过滤（仅保留 levelType=chapter）', () => {
    const chars = [makeCharacter({ name: '主角' })];
    const chapters = [
      makeChapter({ id: 'vol-1', levelType: 'volume', content: '主角' }),
      makeChapter({ id: 'ch-1', levelType: 'chapter', content: '主角出现' }),
    ];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].appearanceChapters).toEqual(['ch-1']);
  });

  it('主角在所有章节出场：risk=ok', () => {
    const chars = [makeCharacter({ role: 'protagonist', name: '林墨' })];
    const chapters = [
      makeChapter({ id: 'ch-1', content: '林墨来了' }),
      makeChapter({ id: 'ch-2', content: '林墨走了' }),
    ];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].risk).toBe('ok');
    expect(arcs[0].appearanceCount).toBe(2);
    expect(arcs[0].consecutiveAbsence).toBe(0);
  });

  it('主角连续 3 章未出场：risk=high + arcGaps 含警告', () => {
    const chars = [makeCharacter({ role: 'protagonist', name: '林墨' })];
    const chapters = [
      makeChapter({ id: 'ch-1', content: '林墨出场' }),
      makeChapter({ id: 'ch-2', content: '其他角色' }),
      makeChapter({ id: 'ch-3', content: '其他角色' }),
      makeChapter({ id: 'ch-4', content: '其他角色' }),
    ];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].risk).toBe('high');
    expect(arcs[0].consecutiveAbsence).toBe(3);
    expect(arcs[0].arcGaps.length).toBeGreaterThan(0);
    expect(arcs[0].arcGaps[0]).toContain('连续 3 章未出场');
  });

  it('反派全书未出场：arcGaps 含"对手戏缺失"', () => {
    const chars = [makeCharacter({ role: 'antagonist', name: '暗影' })];
    const chapters = [makeChapter({ id: 'ch-1', content: '主角独白' })];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].arcGaps).toContain('反派在全书中未出现，对手戏缺失可能导致冲突单薄');
    expect(arcs[0].risk).toBe('medium');
  });

  it('主角出场占比过低（<30% 且 >=5 章）：arcGaps 含"视角漂移"', () => {
    const chars = [makeCharacter({ role: 'protagonist', name: '林墨' })];
    const chapters = Array.from({ length: 10 }, (_, i) =>
      makeChapter({
        id: `ch-${i}`,
        content: i === 0 ? '林墨出场' : '其他角色',
      }),
    );
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].arcGaps.some(g => g.includes('视角漂移'))).toBe(true);
  });

  it('characterFocus 包含角色 id 也算出场', () => {
    const chars = [makeCharacter({ id: 'char-1', name: '林墨' })];
    const chapters = [
      makeChapter({ id: 'ch-1', content: '无关内容', characterFocus: ['char-1'] }),
    ];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].appearanceChapters).toEqual(['ch-1']);
  });

  it('配角全书未出场：risk=medium', () => {
    const chars = [makeCharacter({ role: 'supporting', name: '配角' })];
    const chapters = [makeChapter({ id: 'ch-1', content: '主角独白' })];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].risk).toBe('medium');
    expect(arcs[0].riskDescription).toBe('全书未出场');
  });

  it('重要角色连续 5 章未出场：risk=low', () => {
    const chars = [makeCharacter({ role: 'supporting', name: '赵云' })];
    const chapters = [
      makeChapter({ id: 'ch-1', content: '赵云出场' }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeChapter({ id: `ch-${i + 2}`, content: '其他人在战斗' }),
      ),
    ];
    const arcs = analyzeCharacterArcs(chapters, chars);
    expect(arcs[0].risk).toBe('low');
    expect(arcs[0].consecutiveAbsence).toBe(5);
  });
});

// ============ filterSensitiveWords（同步纯函数）============
describe('filterSensitiveWords', () => {
  it('无敏感词返回空结果', () => {
    const chapters = [makeChapter({ content: '<p>正常内容</p>' })];
    const result = filterSensitiveWords(chapters);
    expect(result.totalHits).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it('单段多次命中同一敏感词', () => {
    const chapters = [makeChapter({
      id: 'ch-1',
      content: '<p>杀掉他，杀掉她，杀掉它</p>',
    })];
    const result = filterSensitiveWords(chapters);
    expect(result.totalHits).toBe(3);
    expect(result.hits.every(h => h.word === '杀掉')).toBe(true);
  });

  it('byParagraph key 为 chapterId:paragraphIndex', () => {
    const chapters = [makeChapter({
      id: 'ch-1',
      content: '<p>杀掉</p><p>正常</p><p>杀掉</p>',
    })];
    const result = filterSensitiveWords(chapters);
    expect(result.byParagraph['ch-1:0']).toBe(1);
    expect(result.byParagraph['ch-1:2']).toBe(1);
    expect(result.byParagraph['ch-1:1']).toBeUndefined();
  });

  it('跨章节段落 key 不互相覆盖', () => {
    const chapters = [
      makeChapter({ id: 'ch-1', content: '<p>杀掉</p>' }),
      makeChapter({ id: 'ch-2', content: '<p>杀掉</p>' }),
    ];
    const result = filterSensitiveWords(chapters);
    expect(result.byParagraph['ch-1:0']).toBe(1);
    expect(result.byParagraph['ch-2:0']).toBe(1);
  });

  it('extraWords 扩展词库', () => {
    const chapters = [makeChapter({ content: '<p>测试词出现在这里</p>' })];
    const result = filterSensitiveWords(chapters, { extraWords: ['测试词'] });
    expect(result.totalHits).toBe(1);
    expect(result.hits[0].word).toBe('测试词');
  });

  it('high severity 敏感词（强奸/海洛因等）', () => {
    const chapters = [makeChapter({ content: '<p>涉及海洛因的段落</p>' })];
    const result = filterSensitiveWords(chapters);
    expect(result.hits[0].severity).toBe('high');
  });

  it('medium severity 敏感词（普通敏感词）', () => {
    const chapters = [makeChapter({ content: '<p>杀掉</p>' })];
    const result = filterSensitiveWords(chapters);
    expect(result.hits[0].severity).toBe('medium');
  });

  it('context 含命中词前后各 10 字', () => {
    const chapters = [makeChapter({
      content: '<p>前文字符一二三四五六七八九十杀掉后文字符一二三四五六七八九十</p>',
    })];
    const result = filterSensitiveWords(chapters);
    expect(result.hits[0].context).toContain('杀掉');
    expect(result.hits[0].context.length).toBeLessThanOrEqual(23); // 10 + 2 + 10 + 1
  });

  it('HTML 标签被剥离后再匹配', () => {
    const chapters = [makeChapter({
      content: '<p>杀<strong>掉</strong>他</p>',
    })];
    const result = filterSensitiveWords(chapters);
    // 标签剥离后文本为"杀掉他"，应命中"杀掉"
    expect(result.totalHits).toBe(1);
  });

  it('空内容章节不报错', () => {
    const chapters = [makeChapter({ content: '' })];
    const result = filterSensitiveWords(chapters);
    expect(result.totalHits).toBe(0);
  });
});

// ============ analyzeChapterForReading（纯本地分析）============
describe('analyzeChapterForReading', () => {
  it('长句检测：80 字以上无标点段落', async () => {
    const longPara = '一'.repeat(85);
    const chapter = makeChapter({ content: `<p>${longPara}</p>` });
    const result = await analyzeChapterForReading(chapter);
    expect(result.longSentences.length).toBeGreaterThan(0);
    expect(result.longSentences[0].paragraphIndex).toBe(0);
  });

  it('短句不报长句', async () => {
    const chapter = makeChapter({ content: '<p>短句。</p><p>也是短句。</p>' });
    const result = await analyzeChapterForReading(chapter);
    expect(result.longSentences).toEqual([]);
  });

  it('重复词检测：同一 2 字词出现 5+ 次', async () => {
    // 用标点分隔，确保正则 `[\u4e00-\u9fa5]{2,4}` 每次只匹配到 "他们" 本身
    // （连续中文无标点时正则会贪婪匹配 "他们他们" 等长 token，导致 "他们" 计数 < 5）
    const content = '<p>他们。他们。他们。他们。他们。</p>';
    const chapter = makeChapter({ content });
    const result = await analyzeChapterForReading(chapter);
    expect(result.repeatedWords.some(r => r.word === '他们')).toBe(true);
  });

  it('重复词检测：出现 4 次不报', async () => {
    const content = '<p>他们他们他们他们</p>';
    const chapter = makeChapter({ content });
    const result = await analyzeChapterForReading(chapter);
    expect(result.repeatedWords.some(r => r.word === '他们')).toBe(false);
  });

  it('钩子分数：末段含问号得 25 分', async () => {
    const chapter = makeChapter({ content: '<p>正常段落</p><p>这是真的吗？</p>' });
    const result = await analyzeChapterForReading(chapter);
    expect(result.hookScore).toBeGreaterThanOrEqual(25);
  });

  it('钩子分数：末段含多个钩子词叠加（上限 100）', async () => {
    const chapter = makeChapter({
      content: '<p>段落</p><p>突然然而竟然？……——</p>',
    });
    const result = await analyzeChapterForReading(chapter);
    expect(result.hookScore).toBe(100);
  });

  it('钩子分数：末段无钩子词得 0', async () => {
    const chapter = makeChapter({ content: '<p>平淡的结尾。</p>' });
    const result = await analyzeChapterForReading(chapter);
    expect(result.hookScore).toBe(0);
  });

  it('空内容不报错', async () => {
    const chapter = makeChapter({ content: '' });
    const result = await analyzeChapterForReading(chapter);
    expect(result.longSentences).toEqual([]);
    expect(result.repeatedWords).toEqual([]);
    expect(result.hookScore).toBe(0);
  });
});

// ============ generateContinuation（mock provider 路径）============
describe('generateContinuation mock 路径', () => {
  it('返回 3 条续写建议（plot/atmosphere/twist）', async () => {
    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].type).toBe('continue');
    expect(suggestions[0].title).toContain('推进剧情');
    expect(suggestions[1].title).toContain('氛围渲染');
    expect(suggestions[2].title).toContain('转折悬念');
  });

  it('每条建议 content 是有效 HTML（<p> 包裹）', async () => {
    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    suggestions.forEach(s => {
      expect(s.content).toContain('<p>');
      expect(s.content).toContain('</p>');
    });
  });

  it('无角色时使用"主角"作为默认名', async () => {
    const suggestions = await generateContinuation('上下文', '概要', []);
    expect(suggestions).toHaveLength(3);
    // 不抛错即可（内部用 characters[0]?.name || '主角'）
  });
});

// ============ generateContinuation LLM 路径 ============
describe('generateContinuation LLM 路径', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callLLMSpy: any;

  beforeEach(() => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    callLLMSpy = vi.spyOn(llmClient, 'callLLM');
  });

  afterEach(() => {
    callLLMSpy.mockRestore();
  });

  it('LLM 成功返回 1 条建议', async () => {
    callLLMSpy.mockResolvedValueOnce('<p>AI 生成的续写内容</p>');
    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('AI 续写');
    expect(suggestions[0].content).toContain('<p>');
  });

  it('LLM 抛错时 fallback 到 mock 分支（返回 3 条）', async () => {
    callLLMSpy.mockRejectedValueOnce(new Error('API error'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    expect(suggestions).toHaveLength(3); // fallback 到 mock
    expect(suggestions[0].title).toContain('推进剧情');
    consoleWarn.mockRestore();
  });
});

// ============ generateContinuationStream（mock provider 路径）============
describe('generateContinuationStream mock 路径', () => {
  it('流式输出 chunk 并最终触发 onComplete', async () => {
    const chunks: string[] = [];
    let completeContent: string | null = null;
    const result = await generateContinuationStream(
      '上下文', '概要', [makeCharacter()], undefined,
      {
        onChunk: c => chunks.push(c),
        onComplete: c => { completeContent = c; },
        onError: () => { /* 不应触发 */ },
      },
    );
    expect(result).toContain('<p>');
    expect(chunks.length).toBeGreaterThan(0);
    expect(completeContent).toBe(result);
  });

  it('signal abort 后停止 chunk 分发且不触发 onComplete', async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    let completeCalled = false;
    const result = await generateContinuationStream(
      '上下文', '概要', [makeCharacter()], undefined,
      {
        onChunk: c => {
          chunks.push(c);
          controller.abort();
        },
        onComplete: () => { completeCalled = true; },
        onError: () => {},
      },
      controller.signal,
    );
    // 中止后不再触发 onComplete
    expect(completeCalled).toBe(false);
    // 但返回值仍为已生成内容
    expect(typeof result).toBe('string');
  });
});

// ============ expandText（mock 路径）============
describe('expandText mock 路径', () => {
  it('4 种扩写类型都能返回建议', async () => {
    const types = ['detail', 'dialogue', 'environment', 'psychology'] as const;
    for (const type of types) {
      const suggestion = await expandText('原始文本', type);
      expect(suggestion.type).toBe('expand');
      expect(suggestion.content).toContain('<p>');
    }
  });
});

// ============ polishText（mock 路径）============
describe('polishText mock 路径', () => {
  it('返回润色建议', async () => {
    const suggestion = await polishText('需要润色的文本', 'balanced');
    expect(suggestion.type).toBe('polish');
    expect(suggestion.content).toContain('<p>');
  });
});

// ============ polishTextStream（mock 路径）============
describe('polishTextStream mock 路径', () => {
  it('流式输出 chunk 并触发 onComplete', async () => {
    const chunks: string[] = [];
    let completeCalled = false;
    await polishTextStream('文本', 'balanced', {
      onChunk: c => chunks.push(c),
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(completeCalled).toBe(true);
  });
});

// ============ expandTextStream（mock 路径）============
describe('expandTextStream mock 路径', () => {
  it('流式输出 chunk 并触发 onComplete', async () => {
    const chunks: string[] = [];
    let completeCalled = false;
    await expandTextStream('文本', 'detail', {
      onChunk: c => chunks.push(c),
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(completeCalled).toBe(true);
  });
});

// ============ analyzeChapter（mock 路径）============
describe('analyzeChapter mock 路径', () => {
  it('返回 6 维度评分', async () => {
    const chapter = makeChapter();
    const analysis = await analyzeChapter(chapter);
    // 烟雾测试：后续对 emotionScore 的断言已隐式验证 analysis 非空，
    // 此处补充对数组字段的结构校验，避免仅靠 toBeDefined 放过空对象
    expect(analysis.characters).toBeInstanceOf(Array);
    expect(analysis.settings).toBeInstanceOf(Array);
    expect(typeof analysis.emotionScore).toBe('number');
    expect(analysis.emotionScore).toBeGreaterThanOrEqual(0);
    expect(analysis.emotionScore).toBeLessThanOrEqual(100);
  });
});

// ============ generateBrainstorm（mock 路径）============
describe('generateBrainstorm mock 路径', () => {
  it('返回 3 条剧情分支', async () => {
    const ideas = await generateBrainstorm('上下文');
    expect(ideas).toHaveLength(3);
    ideas.forEach(idea => {
      expect(typeof idea).toBe('string');
      expect(idea.length).toBeGreaterThan(0);
    });
  });
});

// ============ generateStoryIdea（mock 路径）============
describe('generateStoryIdea mock 路径', () => {
  it('返回 3 条故事创意', async () => {
    const ideas = await generateStoryIdea('prompt');
    expect(ideas).toHaveLength(3);
    ideas.forEach(idea => {
      expect(typeof idea).toBe('string');
    });
  });
});

// ============ generateCharacterNames（mock 路径）============
describe('generateCharacterNames mock 路径', () => {
  it('返回指定数量的角色名', async () => {
    const names = await generateCharacterNames('protagonist', 5);
    expect(names).toHaveLength(5);
    names.forEach(name => {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });

  it('默认 count=5', async () => {
    const names = await generateCharacterNames('antagonist');
    expect(names).toHaveLength(5);
  });
});

// ============ generateChapterTitleSuggestions（mock 路径）============
describe('generateChapterTitleSuggestions mock 路径', () => {
  it('返回 3 条章节标题候选', async () => {
    const chapter = makeChapter();
    const titles = await generateChapterTitleSuggestions(chapter);
    expect(titles).toHaveLength(3);
    titles.forEach(title => {
      expect(typeof title).toBe('string');
    });
  });
});

// ============ polishOutline（mock 路径）============
describe('polishOutline mock 路径', () => {
  it('空章节返回空数组', async () => {
    const issues = await polishOutline([]);
    expect(issues).toEqual([]);
  });

  it('返回启发式诊断 issues：连续 3 章字数偏低触发 pacing 节奏诊断', async () => {
    // 启发式规则：连续 3 章 wordCount < 500 触发"节奏偏缓"诊断
    const chapters = [
      makeChapter({ id: 'ch-1', title: '第一章', content: '<p>短</p>', wordCount: 100, summary: '摘要一' }),
      makeChapter({ id: 'ch-2', title: '第二章', content: '<p>短</p>', wordCount: 100, summary: '摘要二' }),
      makeChapter({ id: 'ch-3', title: '第三章', content: '<p>短</p>', wordCount: 100, summary: '摘要三' }),
    ];
    const issues = await polishOutline(chapters);
    expect(Array.isArray(issues)).toBe(true);
    // 修复 T4：原 toBeGreaterThanOrEqual(0) 是恒真断言，改为精确验证启发式产出
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const pacingIssues = issues.filter(i => i.dimension === 'pacing' && i.description.includes('节奏可能偏缓'));
    expect(pacingIssues.length).toBe(1);
    expect(pacingIssues[0].severity).toBe('warning');
    expect(pacingIssues[0].chapterId).toBe('ch-1');
  });
});

// ============ generateMultipleVersions（mock 路径）============
describe('generateMultipleVersions mock 路径', () => {
  it('返回 3 个版本', async () => {
    const versions = await generateMultipleVersions('指令', {
      chapterContent: '上下文',
      characters: [makeCharacter()],
    }, 3);
    expect(versions).toHaveLength(3);
    versions.forEach(v => {
      expect(typeof v).toBe('string');
    });
  });

  it('默认 count=3', async () => {
    const versions = await generateMultipleVersions('指令', {
      chapterContent: '上下文',
      characters: [makeCharacter()],
    });
    expect(versions).toHaveLength(3);
  });
});

// ============ generateMultipleVersions LLM 路径 ============
describe('generateMultipleVersions LLM 路径', () => {
  it('temperature 在 finally 中恢复', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk', temperature: 0.7 });
    const baseTemp = llmClient.getSettings().temperature;
    const callLLMSpy = vi.spyOn(llmClient, 'callLLMStream').mockResolvedValue('内容');

    await generateMultipleVersions('指令', {
      chapterContent: '上下文',
      characters: [makeCharacter()],
    }, 3);

    // finally 中应恢复 temperature
    expect(llmClient.getSettings().temperature).toBe(baseTemp);
    callLLMSpy.mockRestore();
  });
});

// ============ 错误降级测试 ============
describe('错误降级', () => {
  it('LLM 抛错时 generateContinuation 降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    expect(suggestions).toHaveLength(3); // mock fallback

    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });

  it('LLM 抛错时 expandText 降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const suggestion = await expandText('文本', 'detail');
    expect(suggestion.type).toBe('expand');
    expect(suggestion.content).toContain('<p>');

    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });

  it('LLM 流式抛错时 generateContinuationStream 触发 onError', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const error = new Error('stream failed');
    const callLLMSpy = vi.spyOn(llmClient, 'callLLMStream').mockRejectedValueOnce(error);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let errorCaught: Error | null = null;
    const result = await generateContinuationStream(
      '上下文', '概要', [makeCharacter()], undefined,
      {
        onChunk: () => {},
        onComplete: () => {},
        onError: e => { errorCaught = e; },
      },
    );

    expect(result).toBe('');
    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toBe('stream failed');

    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ switchPerspective ============
describe('switchPerspective', () => {
  it('mock 返回 perspective 类型建议，title 含角色名', async () => {
    const result = await switchPerspective('原文内容', '林墨');
    expect(result.type).toBe('perspective');
    expect(result.title).toContain('林墨');
    expect(result.content).toContain('<p>');
  });

  it('mock contextUsed 含角色相关字段', async () => {
    const result = await switchPerspective('原文', '苏婉');
    expect(result.contextUsed.some(c => c.includes('苏婉'))).toBe(true);
  });

  it('LLM 成功返回视角切换结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('<p>视角切换后的内容</p>');
    const result = await switchPerspective('原文', '苏婉');
    expect(result.type).toBe('perspective');
    expect(result.title).toContain('苏婉');
    expect(result.content).toContain('<p>');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await switchPerspective('原文', '林墨');
    expect(result.type).toBe('perspective');
    expect(result.title).toContain('林墨');
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ analyzeStructure ============
describe('analyzeStructure', () => {
  it('mock 返回 2 个 issues + 长度匹配的 pacing/emotionCurve', async () => {
    const chapters = [
      makeChapter({ id: 'ch-1' }),
      makeChapter({ id: 'ch-2' }),
      makeChapter({ id: 'ch-3' }),
    ];
    const result = await analyzeStructure(chapters);
    expect(result.issues).toHaveLength(2);
    expect(result.pacing).toHaveLength(3);
    expect(result.emotionCurve).toHaveLength(3);
    // pacing/emotionCurve 值在 0-100 之间
    result.pacing.forEach(v => expect(v).toBeGreaterThanOrEqual(0));
    result.pacing.forEach(v => expect(v).toBeLessThanOrEqual(100));
  });

  it('mock 空 chapters：issues 仍返回 2 条，pacing/emotionCurve 为空', async () => {
    const result = await analyzeStructure([]);
    expect(result.issues).toHaveLength(2);
    expect(result.pacing).toHaveLength(0);
    expect(result.emotionCurve).toHaveLength(0);
  });

  it('mock 非 chapter 类型被过滤', async () => {
    const chapters = [
      makeChapter({ id: 'vol-1', levelType: 'volume' }),
      makeChapter({ id: 'ch-1', levelType: 'chapter' }),
    ];
    const result = await analyzeStructure(chapters);
    expect(result.pacing).toHaveLength(1);
    expect(result.emotionCurve).toHaveLength(1);
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        issues: [{ type: 'pacing', severity: 'info', chapterId: 'ch-1', description: '节奏偏慢', suggestion: '加快冲突' }],
        pacing: [60, 70],
        emotionCurve: [50, 80],
      }),
    );
    const result = await analyzeStructure([makeChapter(), makeChapter({ id: 'ch-2' })]);
    expect(result.issues).toHaveLength(1);
    expect(result.pacing).toEqual([60, 70]);
    expect(result.emotionCurve).toEqual([50, 80]);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await analyzeStructure([makeChapter()]);
    expect(result.issues).toHaveLength(2);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ checkStyleConsistency ============
describe('checkStyleConsistency', () => {
  it('mock 返回空 issues', async () => {
    const result = await checkStyleConsistency([makeChapter()]);
    expect(result.issues).toEqual([]);
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({ issues: [{ type: 'tone', severity: 'warning', chapterId: 'ch-1', description: '文风不一致' }] }),
    );
    const result = await checkStyleConsistency([makeChapter()]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].description).toBe('文风不一致');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回非数组 issues 时回退为空数组', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({ issues: 'not-an-array' }),
    );
    const result = await checkStyleConsistency([makeChapter()]);
    expect(result.issues).toEqual([]);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await checkStyleConsistency([makeChapter()]);
    expect(result.issues).toEqual([]);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ expandOutlineNode ============
describe('expandOutlineNode', () => {
  it('mock 遇险关键词 → "意外卷入阴谋"', async () => {
    const chapter = makeChapter({ title: '主角遇险', summary: '主角陷入危险' });
    const result = await expandOutlineNode(chapter, []);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('意外卷入阴谋');
  });

  it('mock 危险关键词（在 summary 中）→ "意外卷入阴谋"', async () => {
    const chapter = makeChapter({ title: '普通标题', summary: '主角遇到危险情况' });
    const result = await expandOutlineNode(chapter, []);
    expect(result[0].title).toBe('意外卷入阴谋');
  });

  it('mock 决裂关键词 → "隐瞒信件曝光"', async () => {
    const chapter = makeChapter({ title: '二人决裂', summary: '朋友决裂' });
    const result = await expandOutlineNode(chapter, []);
    expect(result[0].title).toBe('隐瞒信件曝光');
  });

  it('mock 通用关键词 → "意外转折"', async () => {
    const chapter = makeChapter({ title: '日常', summary: '普通的一天' });
    const result = await expandOutlineNode(chapter, []);
    expect(result[0].title).toBe('意外转折');
  });

  it('mock 所有方案含 title/content/dramaticTension', async () => {
    const result = await expandOutlineNode(makeChapter(), []);
    result.forEach(o => {
      expect(o.title).toBeTruthy();
      expect(o.content).toBeTruthy();
      expect(o.dramaticTension).toBeTruthy();
    });
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { title: 'LLM方案', content: '内容描述', dramaticTension: '张力点' },
      ]),
    );
    const result = await expandOutlineNode(makeChapter(), []);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('LLM方案');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回空数组时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('[]');
    const result = await expandOutlineNode(makeChapter(), []);
    expect(result).toHaveLength(3);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await expandOutlineNode(makeChapter(), []);
    expect(result).toHaveLength(3);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateChapterBeats ============
describe('generateChapterBeats', () => {
  it('mock 返回 5 个节拍，类型固定', async () => {
    const result = await generateChapterBeats(makeChapter(), []);
    expect(result).toHaveLength(5);
    expect(result.map(b => b.type)).toEqual(['hook', 'progress', 'midpoint', 'escalation', 'cliffhanger']);
  });

  it('mock hook 节拍 content 含章节标题', async () => {
    const chapter = makeChapter({ title: '第一章 开始' });
    const result = await generateChapterBeats(chapter, []);
    expect(result[0].content).toContain('第一章 开始');
  });

  it('mock 所有节拍 content 非空', async () => {
    const result = await generateChapterBeats(makeChapter(), []);
    result.forEach(b => expect(b.content).toBeTruthy());
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { type: 'hook', content: 'LLM钩子' },
        { type: 'progress', content: 'LLM推进' },
      ]),
    );
    const result = await generateChapterBeats(makeChapter(), []);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('LLM钩子');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回无效 type 时被过滤', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { type: 'invalid', content: '无效类型' },
        { type: 'hook', content: '有效钩子' },
      ]),
    );
    const result = await generateChapterBeats(makeChapter(), []);
    expect(result).toHaveLength(1);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateChapterBeats(makeChapter(), []);
    expect(result).toHaveLength(5);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateStructureVariants ============
describe('generateStructureVariants', () => {
  it('mock 返回 3 个变体，名称固定', async () => {
    const result = await generateStructureVariants('我的小说', '一个故事', []);
    expect(result).toHaveLength(3);
    expect(result.map(v => v.name)).toEqual(['经典线性', '双线交织', '多视角罗生门']);
  });

  it('mock 变体 id 含 "variant-"', async () => {
    const result = await generateStructureVariants('我的小说', '一个故事', []);
    result.forEach(v => expect(v.id).toContain('variant-'));
  });

  it('mock 变体含 description/pros/cons/fitScenarios/suggestedHierarchy', async () => {
    const result = await generateStructureVariants('我的小说', '一个故事', []);
    result.forEach(v => {
      expect(v.description).toBeTruthy();
      expect(v.pros).toBeTruthy();
      expect(v.cons).toBeTruthy();
      expect(v.fitScenarios).toBeTruthy();
      expect(v.suggestedHierarchy).toEqual(['卷', '章']);
    });
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { name: '自定义结构', description: '描述', pros: '优势', cons: '劣势', fitScenarios: '场景', suggestedHierarchy: ['卷', '章'] },
      ]),
    );
    const result = await generateStructureVariants('我的小说', '一个故事', []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('自定义结构');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateStructureVariants('我的小说', '一个故事', []);
    expect(result).toHaveLength(3);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateConflictCompass ============
describe('generateConflictCompass', () => {
  it('mock 返回 4 层冲突，类型固定', async () => {
    const result = await generateConflictCompass('核心驱动', []);
    expect(result).toHaveLength(4);
    expect(result.map(l => l.layer)).toEqual(['inner', 'interpersonal', 'faction', 'social']);
  });

  it('mock 每层有 3 个 seeds', async () => {
    const result = await generateConflictCompass('核心驱动', []);
    result.forEach(l => expect(l.seeds).toHaveLength(3));
  });

  it('mock 每层 description 非空', async () => {
    const result = await generateConflictCompass('核心驱动', []);
    result.forEach(l => expect(l.description).toBeTruthy());
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { layer: 'inner', description: '内心冲突', seeds: ['种子1', '种子2'] },
      ]),
    );
    const result = await generateConflictCompass('核心驱动', []);
    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe('inner');
    expect(result[0].seeds).toHaveLength(2);
    callLLMSpy.mockRestore();
  });

  it('LLM 返回无效 layer 时被过滤', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { layer: 'invalid', description: '无效层', seeds: [] },
        { layer: 'inner', description: '有效层', seeds: ['种子'] },
      ]),
    );
    const result = await generateConflictCompass('核心驱动', []);
    expect(result).toHaveLength(1);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateConflictCompass('核心驱动', []);
    expect(result).toHaveLength(4);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ askMaterialQuestion ============
describe('askMaterialQuestion', () => {
  it('mock inspiration 类型返回 4 个问题', async () => {
    const result = await askMaterialQuestion(makeMaterial({ type: 'inspiration' }));
    expect(result).toHaveLength(4);
    expect(result[0].dimension).toBe('核心冲突');
  });

  it('mock reference 类型返回 2 个问题', async () => {
    const result = await askMaterialQuestion(makeMaterial({ type: 'reference' }));
    expect(result).toHaveLength(2);
  });

  it('mock research 类型返回 2 个问题', async () => {
    const result = await askMaterialQuestion(makeMaterial({ type: 'research' }));
    expect(result).toHaveLength(2);
  });

  it('mock quote 类型返回 2 个问题', async () => {
    const result = await askMaterialQuestion(makeMaterial({ type: 'quote' }));
    expect(result).toHaveLength(2);
  });

  it('mock image 类型返回 2 个问题', async () => {
    const result = await askMaterialQuestion(makeMaterial({ type: 'image' }));
    expect(result).toHaveLength(2);
  });

  it('mock audio 类型返回 1 个问题', async () => {
    const result = await askMaterialQuestion(makeMaterial({ type: 'audio' }));
    expect(result).toHaveLength(1);
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { dimension: '秘密', question: '主角隐藏了什么？' },
      ]),
    );
    const result = await askMaterialQuestion(makeMaterial());
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe('秘密');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock（inspiration 默认 4 个）', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await askMaterialQuestion(makeMaterial());
    expect(result).toHaveLength(4);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ previewCausalImpact ============
describe('previewCausalImpact', () => {
  it('mock "死"关键词 → broken+weakened, high risk', async () => {
    const result = await previewCausalImpact('主角死亡', 'char-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('high');
    expect(result.impacts.some(i => i.type === 'broken')).toBe(true);
    expect(result.impacts.some(i => i.type === 'weakened')).toBe(true);
  });

  it('mock "删除"关键词 → broken+weakened, high risk', async () => {
    const result = await previewCausalImpact('删除角色', 'char-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('high');
    expect(result.impacts.some(i => i.type === 'broken')).toBe(true);
  });

  it('mock "移除"关键词 → broken+weakened, high risk', async () => {
    const result = await previewCausalImpact('移除章节', 'ch-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('high');
  });

  it('mock "提前"关键词 → broken, high risk', async () => {
    const result = await previewCausalImpact('把章节提前', 'ch-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('high');
    expect(result.impacts.some(i => i.type === 'broken')).toBe(true);
    expect(result.impacts.some(i => i.type === 'weakened')).toBe(false);
  });

  it('mock "延后"关键词 → broken, high risk', async () => {
    const result = await previewCausalImpact('把章节延后', 'ch-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('high');
  });

  it('mock 其他描述 → weakened, medium risk', async () => {
    const result = await previewCausalImpact('修改章节标题', 'ch-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('medium');
    expect(result.impacts.every(i => i.type === 'weakened')).toBe(true);
  });

  it('mock 返回 changeDescription/targetId/generatedAt', async () => {
    const foreshadows = [makeForeshadow({ id: 'fs-1', title: '关键信件' })];
    const result = await previewCausalImpact('改动描述', 'target-1', [makeChapter()], [], foreshadows);
    expect(result.changeDescription).toBe('改动描述');
    expect(result.targetId).toBe('target-1');
    expect(result.generatedAt).toBeTruthy();
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        overallRisk: 'low',
        impacts: [
          { type: 'missing', chapterId: 'ch-1', description: '缺失铺垫', alternative: '补充铺垫' },
        ],
      }),
    );
    const result = await previewCausalImpact('改动', 'ch-1', [makeChapter()], [], []);
    expect(result.overallRisk).toBe('low');
    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0].type).toBe('missing');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await previewCausalImpact('改动描述', 'ch-1', [makeChapter()], [], []);
    expect(result.impacts.length).toBeGreaterThan(0);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateFullBookReview ============
describe('generateFullBookReview', () => {
  it('mock 空章节返回 "尚无章节内容"', async () => {
    const result = await generateFullBookReview([]);
    expect(result.summary).toBe('尚无章节内容，无法通读');
    expect(result.issues).toEqual([]);
  });

  it('mock wordCount<800 → low priority pacing', async () => {
    const chapter = makeChapter({ id: 'ch-1', title: '短章', wordCount: 500 });
    const result = await generateFullBookReview([chapter]);
    expect(result.issues.some(i => i.priority === 'low' && i.type === 'pacing')).toBe(true);
  });

  it('mock wordCount>6000 → medium priority pacing', async () => {
    const chapter = makeChapter({ id: 'ch-1', title: '长章', wordCount: 7000 });
    const result = await generateFullBookReview([chapter]);
    expect(result.issues.some(i => i.priority === 'medium' && i.type === 'pacing')).toBe(true);
  });

  it('mock wordCount 在 800-6000 之间不触发 pacing 问题', async () => {
    const chapter = makeChapter({ id: 'ch-1', title: '正常章', wordCount: 2000 });
    const result = await generateFullBookReview([chapter]);
    expect(result.issues.some(i => i.type === 'pacing')).toBe(false);
  });

  it('mock chapters>5 → high priority rhythm', async () => {
    const chapters = Array.from({ length: 6 }, (_, i) =>
      makeChapter({ id: `ch-${i}`, title: `第${i + 1}章`, wordCount: 1500 }),
    );
    const result = await generateFullBookReview(chapters);
    expect(result.issues.some(i => i.priority === 'high' && i.type === 'rhythm')).toBe(true);
  });

  it('mock 0-5 章节不触发 rhythm 问题', async () => {
    const chapters = Array.from({ length: 3 }, (_, i) =>
      makeChapter({ id: `ch-${i}`, title: `第${i + 1}章`, wordCount: 1500 }),
    );
    const result = await generateFullBookReview(chapters);
    expect(result.issues.some(i => i.type === 'rhythm')).toBe(false);
  });

  it('mock summary 含章节数', async () => {
    const chapters = [
      makeChapter({ id: 'ch-1', wordCount: 1500 }),
      makeChapter({ id: 'ch-2', wordCount: 1500 }),
    ];
    const result = await generateFullBookReview(chapters);
    expect(result.summary).toContain('2');
  });

  it('LLM 成功返回解析结果', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        summary: '整体评价',
        issues: [
          { type: 'rhythm', chapterIndex: 1, description: '节奏问题', suggestion: '建议', priority: 'high' },
        ],
      }),
    );
    const result = await generateFullBookReview([makeChapter()]);
    expect(result.summary).toBe('整体评价');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].chapterId).toBe('ch-1');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateFullBookReview([makeChapter({ wordCount: 500 })]);
    expect(result.issues.some(i => i.priority === 'low')).toBe(true);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateCoreSettingCardQuestions ============
describe('generateCoreSettingCardQuestions', () => {
  it('mock 模式下空字段给出针对性问题', async () => {
    const card = makeSettingCard({
      protagonist: {
        name: '林墨',
        personalityKeywords: ['冷静'],
        coreDesire: '',
        fatalFlaw: '',
        goldenFinger: '',
      },
      coreConflict: { mainConflict: '' },
      worldview: { powerSystem: '' },
    });
    const result = await generateCoreSettingCardQuestions(card);
    // 5 个空字段对应 5 个问题，slice(0, 4) 取 4 个
    expect(result.length).toBeLessThanOrEqual(4);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(q => q.includes('欲望'))).toBe(true);
  });

  it('mock 模式下字段完整时给出通用问题', async () => {
    const result = await generateCoreSettingCardQuestions(makeSettingCard());
    expect(result).toHaveLength(4);
    expect(result.some(q => q.includes('反派'))).toBe(true);
  });

  it('LLM 成功返回字符串数组', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify(['问题1', '问题2', '问题3']),
    );
    const result = await generateCoreSettingCardQuestions(makeSettingCard());
    expect(result).toEqual(['问题1', '问题2', '问题3']);
    callLLMSpy.mockRestore();
  });

  it('LLM 返回非数组降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('not json');
    const result = await generateCoreSettingCardQuestions(makeSettingCard());
    expect(result).toHaveLength(4);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateCoreSettingCardQuestions(makeSettingCard());
    expect(result).toHaveLength(4);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ checkSettingCardContradictions ============
describe('checkSettingCardContradictions', () => {
  it('mock 模式返回空数组', async () => {
    const result = await checkSettingCardContradictions(makeSettingCard());
    expect(result).toEqual([]);
  });

  it('LLM 成功返回矛盾数组', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { description: '主角弱点与金手指冲突', severity: 'warning' },
        { description: '世界观力量体系不清晰', severity: 'error' },
      ]),
    );
    const result = await checkSettingCardContradictions(makeSettingCard());
    expect(result).toHaveLength(2);
    expect(result[0].severity).toBe('warning');
    expect(result[1].severity).toBe('error');
    expect(result[0].resolved).toBe(false);
    callLLMSpy.mockRestore();
  });

  it('LLM 返回非数组降级到空数组', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('not json');
    const result = await checkSettingCardContradictions(makeSettingCard());
    expect(result).toEqual([]);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到空数组', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await checkSettingCardContradictions(makeSettingCard());
    expect(result).toEqual([]);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });

  it('LLM 返回的 severity 无效时降级为 warning', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([{ description: '矛盾', severity: 'invalid' }]),
    );
    const result = await checkSettingCardContradictions(makeSettingCard());
    expect(result[0].severity).toBe('warning');
    callLLMSpy.mockRestore();
  });
});

// ============ generateBlueprintOverview ============
describe('generateBlueprintOverview', () => {
  it('mock 模式基于设定卡拼装可读概览', async () => {
    const result = await generateBlueprintOverview(makeSettingCard(), [], []);
    expect(result.mainline).toContain('林墨');
    expect(result.mainline).toContain('寻找真相');
    expect(result.startPoint).toContain('林墨');
    expect(result.turnPoints).toHaveLength(3);
    expect(result.turnPoints[0].progress).toBe(30);
    expect(result.growthArc).toHaveLength(1);
    expect(result.characterFates).toHaveLength(1);
    expect(result.volumes).toHaveLength(1);
    expect(result.lockedAt).toBeNull();
    expect(result.updatedAt).toBeTruthy();
  });

  it('mock 模式 emotionalTone=cool 时主线含"爽快逆袭"', async () => {
    const result = await generateBlueprintOverview(makeSettingCard({ emotionalTone: 'cool' }), [], []);
    expect(result.mainline).toContain('爽快逆袭');
  });

  it('mock 模式 emotionalTone 非 cool 时主线含"跌宕起伏"', async () => {
    const result = await generateBlueprintOverview(makeSettingCard({ emotionalTone: 'dark' }), [], []);
    expect(result.mainline).toContain('跌宕起伏');
  });

  it('LLM 成功返回完整蓝图', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        mainline: 'LLM 主线',
        startPoint: 'LLM 起点',
        turnPoints: [{ progress: 50, title: '转折', description: '描述' }],
        endPoint: 'LLM 终点',
        growthArc: [{ volumeIndex: 1, fromState: '初始', experiences: '经历', toState: '终态' }],
        characterFates: [{ characterName: '林墨', keyNodes: '节点', ending: '结局' }],
        volumes: [{ index: 1, title: '卷一', chapterRange: '1-10', coreTask: '任务', endingHook: '钩子' }],
      }),
    );
    const result = await generateBlueprintOverview(makeSettingCard(), [], []);
    expect(result.mainline).toBe('LLM 主线');
    expect(result.turnPoints[0].title).toBe('转折');
    expect(result.growthArc[0].fromState).toBe('初始');
    expect(result.characterFates[0].characterName).toBe('林墨');
    expect(result.volumes[0].title).toBe('卷一');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回非对象降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('not json');
    const result = await generateBlueprintOverview(makeSettingCard(), [], []);
    expect(result.mainline).toContain('林墨');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateBlueprintOverview(makeSettingCard(), [], []);
    expect(result.mainline).toContain('林墨');
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });

  it('progress 越界时被 clamp 到 0-100', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        mainline: '主线',
        startPoint: '起点',
        endPoint: '终点',
        turnPoints: [{ progress: 200, title: '转折', description: '描述' }],
      }),
    );
    const result = await generateBlueprintOverview(makeSettingCard(), [], []);
    expect(result.turnPoints[0].progress).toBe(100);
    callLLMSpy.mockRestore();
  });
});

// ============ generateBlueprintChangeImpact ============
describe('generateBlueprintChangeImpact', () => {
  it('mock 模式：含"删除"关键词 → high 风险', async () => {
    const result = await generateBlueprintChangeImpact(
      '删除主角',
      makeBlueprint(),
      [makeChapter()],
      [makeForeshadow()],
    );
    expect(result.riskLevel).toBe('high');
    expect(result.affectedVolumes).toEqual([1, 2]);
    expect(result.suggestion).toContain('高风险');
  });

  it('mock 模式：含"调整"关键词 → medium 风险', async () => {
    const result = await generateBlueprintChangeImpact(
      '调整章节顺序',
      makeBlueprint(),
      [],
      [],
    );
    expect(result.riskLevel).toBe('medium');
    expect(result.affectedVolumes).toEqual([1]);
    expect(result.suggestion).toContain('中风险');
  });

  it('mock 模式：无关键词 → low 风险', async () => {
    const result = await generateBlueprintChangeImpact(
      '添加备注',
      makeBlueprint(),
      [],
      [],
    );
    expect(result.riskLevel).toBe('low');
    expect(result.affectedVolumes).toEqual([1]);
    expect(result.suggestion).toContain('低风险');
  });

  it('mock 模式：含"结局"关键词 → high 风险', async () => {
    const result = await generateBlueprintChangeImpact(
      '修改结局',
      makeBlueprint(),
      [],
      [],
    );
    expect(result.riskLevel).toBe('high');
  });

  it('LLM 成功返回影响报告', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        affectedVolumes: [1, 2, 3],
        affectedChapters: ['第一章', '第二章'],
        affectedForeshadows: ['关键信件'],
        riskLevel: 'high',
        suggestion: '建议先备份',
      }),
    );
    const result = await generateBlueprintChangeImpact(
      '改动',
      makeBlueprint(),
      [makeChapter()],
      [makeForeshadow()],
    );
    expect(result.affectedVolumes).toEqual([1, 2, 3]);
    expect(result.affectedChapters).toEqual(['第一章', '第二章']);
    expect(result.riskLevel).toBe('high');
    expect(result.suggestion).toBe('建议先备份');
    expect(result.changeDescription).toBe('改动');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回无效 riskLevel 降级为 medium', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        affectedVolumes: [],
        affectedChapters: [],
        affectedForeshadows: [],
        riskLevel: 'invalid',
        suggestion: '建议',
      }),
    );
    const result = await generateBlueprintChangeImpact('改动', makeBlueprint(), [], []);
    expect(result.riskLevel).toBe('medium');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateBlueprintChangeImpact('删除', makeBlueprint(), [], []);
    expect(result.riskLevel).toBe('high');
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateWritingByInstruction ============
describe('generateWritingByInstruction', () => {
  it('mock 模式：流式输出 mock 内容并触发 onComplete', async () => {
    const chunks: string[] = [];
    let completed = '';
    const handler = {
      onChunk: (c: string) => { chunks.push(c); },
      onComplete: (full: string) => { completed = full; },
      onError: () => {},
    };
    const result = await generateWritingByInstruction(
      '写一段战斗场景',
      { chapterContent: '<p>前文</p>', characters: [makeCharacter()] },
      handler,
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(result).toBeTruthy();
    expect(completed).toBeTruthy();
  });

  it('mock 模式：signal 已 aborted 时返回空串且不触发 onError（与 LLM 分支一致，避免用户取消弹出失败 toast）', async () => {
    const controller = new AbortController();
    controller.abort();
    let errored: Error | null = null;
    let completed = '';
    const handler = {
      onChunk: () => {},
      onComplete: (full: string) => { completed = full; },
      onError: (e: Error) => { errored = e; },
    };
    const result = await generateWritingByInstruction(
      '写一段',
      { chapterContent: '', characters: [] },
      handler,
      controller.signal,
    );
    // 修复 M5：mock 分支 abort 时直接 return ''，不触发 onError，与 LLM 分支 (if (signal?.aborted) return content) 行为一致
    expect(result).toBe('');
    expect(errored).toBeNull();
    expect(completed).toBe('');
  });

  it('LLM 成功：返回 humanized 内容', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMStreamSpy = vi.spyOn(llmClient, 'callLLMStream').mockResolvedValueOnce(
      '<p>LLM 生成的正文</p>',
    );
    let completed = '';
    const handler = {
      onChunk: () => {},
      onComplete: (full: string) => { completed = full; },
      onError: () => {},
    };
    const result = await generateWritingByInstruction(
      '写一段',
      { chapterContent: '<p>前文</p>', characters: [makeCharacter()] },
      handler,
    );
    expect(result).toBeTruthy();
    expect(completed).toBeTruthy();
    callLLMStreamSpy.mockRestore();
  });

  it('LLM 抛错：触发 handler.onError 并返回空串', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMStreamSpy = vi.spyOn(llmClient, 'callLLMStream').mockRejectedValueOnce(
      new Error('stream error'),
    );
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let errored: Error | null = null;
    const handler = {
      onChunk: () => {},
      onComplete: () => {},
      onError: (e: Error) => { errored = e; },
    };
    const result = await generateWritingByInstruction(
      '写一段',
      { chapterContent: '', characters: [] },
      handler,
    );
    expect(result).toBe('');
    expect(errored).toBeInstanceOf(Error);
    expect(errored!.message).toBe('stream error');
    callLLMStreamSpy.mockRestore();
    consoleWarn.mockRestore();
  });

  it('LLM 返回空串：不触发 onComplete', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMStreamSpy = vi.spyOn(llmClient, 'callLLMStream').mockResolvedValueOnce('');
    let completed = '';
    const handler = {
      onChunk: () => {},
      onComplete: (full: string) => { completed = full; },
      onError: () => {},
    };
    const result = await generateWritingByInstruction(
      '写一段',
      { chapterContent: '', characters: [] },
      handler,
    );
    expect(result).toBe('');
    expect(completed).toBe('');
    callLLMStreamSpy.mockRestore();
  });

  it('LLM 中止后不触发 onComplete', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMStreamSpy = vi.spyOn(llmClient, 'callLLMStream').mockResolvedValueOnce(
      '<p>内容</p>',
    );
    const controller = new AbortController();
    let completed = '';
    const handler = {
      onChunk: () => {},
      onComplete: (full: string) => { completed = full; },
      onError: () => {},
    };
    // 在调用前 abort
    controller.abort();
    await generateWritingByInstruction(
      '写一段',
      { chapterContent: '', characters: [] },
      handler,
      controller.signal,
    );
    // signal.aborted 时直接返回 content，不触发 onComplete
    expect(completed).toBe('');
    callLLMStreamSpy.mockRestore();
  });
});

// ============ optimizeSynopsis ============
describe('optimizeSynopsis', () => {
  it('mock 模式：长简介 + qidian 平台 → 截断拼接', async () => {
    const longSynopsis = 'A'.repeat(250);
    const result = await optimizeSynopsis(longSynopsis, 'qidian');
    expect(result).toContain('……（更多精彩等你揭晓）');
    expect(result.length).toBeLessThan(longSynopsis.length);
  });

  it('mock 模式：长简介 + fanqie 平台 → 截断拼接', async () => {
    const longSynopsis = 'A'.repeat(250);
    const result = await optimizeSynopsis(longSynopsis, 'fanqie');
    expect(result).toContain('……');
  });

  it('mock 模式：长简介 + qimao 平台 → 截断拼接', async () => {
    const longSynopsis = 'A'.repeat(250);
    const result = await optimizeSynopsis(longSynopsis, 'qimao');
    expect(result).toContain('……');
  });

  it('mock 模式：短简介原样返回', async () => {
    const short = '短简介';
    const result = await optimizeSynopsis(short, 'general');
    expect(result).toBe(short);
  });

  it('mock 模式：长简介 + general 平台 → 原样返回', async () => {
    const long = 'A'.repeat(250);
    const result = await optimizeSynopsis(long, 'general');
    expect(result).toBe(long);
  });

  it('LLM 成功：返回改写后简介', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('  改写后的简介  ');
    const result = await optimizeSynopsis('原简介', 'qidian');
    expect(result).toBe('改写后的简介');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回空串降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('   ');
    const result = await optimizeSynopsis('原简介', 'general');
    expect(result).toBe('原简介');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await optimizeSynopsis('原简介', 'general');
    expect(result).toBe('原简介');
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });

  it('带 settingCard 时 prompt 含类型信息', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('改写');
    await optimizeSynopsis('原简介', 'qidian', makeSettingCard());
    expect(callLLMSpy).toHaveBeenCalled();
    callLLMSpy.mockRestore();
  });
});

// ============ recommendPlatformTags ============
describe('recommendPlatformTags', () => {
  it('mock 模式：基于设定卡字段映射标签', async () => {
    const result = await recommendPlatformTags(makeSettingCard(), '简介');
    expect(result.tags).toContain('玄幻');
    expect(result.tags).toContain('爽文');
    expect(result.tags).toContain('逆袭');
    expect(result.categories).toContain('玄幻');
    expect(result.reason).toBeTruthy();
  });

  it('mock 模式：emotionalTone=hot-blooded 添加热血标签', async () => {
    const result = await recommendPlatformTags(makeSettingCard({ emotionalTone: 'hot-blooded' }), '');
    expect(result.tags).toContain('热血');
    expect(result.tags).toContain('战斗');
  });

  it('mock 模式：emotionalTone=light 添加轻松标签', async () => {
    const result = await recommendPlatformTags(makeSettingCard({ emotionalTone: 'light' }), '');
    expect(result.tags).toContain('轻松');
    expect(result.tags).toContain('日常');
  });

  it('mock 模式：romanceType=harem 添加后宫标签', async () => {
    const result = await recommendPlatformTags(makeSettingCard({ romanceType: 'harem' }), '');
    expect(result.tags).toContain('后宫');
  });

  it('mock 模式：无 settingCard 返回空结果', async () => {
    const result = await recommendPlatformTags(undefined, '简介');
    expect(result.tags).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  it('LLM 成功：返回标签推荐', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        tags: ['标签1', '标签2'],
        categories: ['分类1'],
        reason: '推荐理由',
      }),
    );
    const result = await recommendPlatformTags(makeSettingCard(), '简介');
    expect(result.tags).toEqual(['标签1', '标签2']);
    expect(result.categories).toEqual(['分类1']);
    expect(result.reason).toBe('推荐理由');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回非对象降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('not json');
    const result = await recommendPlatformTags(makeSettingCard(), '');
    expect(result.tags.length).toBeGreaterThan(0);
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await recommendPlatformTags(makeSettingCard(), '');
    expect(result.tags.length).toBeGreaterThan(0);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ polishOutline 启发式规则覆盖（generateHeuristicOutlineIssues 8 条规则）============
// 覆盖 L1190-1308 的 8 条启发式诊断规则，每条规则用精心构造的输入独立触发
describe('polishOutline 启发式规则覆盖', () => {
  // 辅助：构造不触发其他规则的"干净"章节
  function makeCleanChapter(overrides: Partial<Chapter> = {}): Chapter {
    return makeChapter({
      title: '第一章 测试章节标题',
      summary: '这是一个足够长的章节摘要用于避免触发规则三',
      content: '<p>林墨出现在这一章中。</p>',
      wordCount: 1000,
      ...overrides,
    });
  }

  it('规则1：连续 3 章字数偏低（均<500）→ pacing-slow 警告', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1', wordCount: 100 }),
      makeCleanChapter({ id: 'ch-2', wordCount: 100 }),
      makeCleanChapter({ id: 'ch-3', wordCount: 100 }),
    ];
    const issues = await polishOutline(chapters);
    const slowIssue = issues.find(i => i.description.includes('连续 3 章字数偏低'));
    expect(slowIssue).toBeDefined();
    expect(slowIssue!.dimension).toBe('pacing');
    expect(slowIssue!.severity).toBe('warning');
  });

  it('规则2：单章字数远超均值（>avg*2.5 且 >3000）→ pacing-dense 信息', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1', wordCount: 100 }),
      makeCleanChapter({ id: 'ch-2', wordCount: 100 }),
      makeCleanChapter({ id: 'ch-3', wordCount: 5000 }),
    ];
    const issues = await polishOutline(chapters);
    const denseIssue = issues.find(i => i.description.includes('显著高于均值'));
    expect(denseIssue).toBeDefined();
    expect(denseIssue!.dimension).toBe('pacing');
    expect(denseIssue!.severity).toBe('info');
  });

  it('规则3：3+ 章节缺少摘要（summary<10字）→ structure-nosummary 警告', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1', summary: '' }),
      makeCleanChapter({ id: 'ch-2', summary: '' }),
      makeCleanChapter({ id: 'ch-3', summary: '' }),
    ];
    const issues = await polishOutline(chapters);
    const noSummaryIssue = issues.find(i => i.description.includes('缺少摘要'));
    expect(noSummaryIssue).toBeDefined();
    expect(noSummaryIssue!.dimension).toBe('structure');
    expect(noSummaryIssue!.severity).toBe('warning');
  });

  it('规则4：未规划回收路径的遗留伏笔 → foreshadow-orphan 警告', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1' }),
      makeCleanChapter({ id: 'ch-2' }),
    ];
    const foreshadows = [
      makeForeshadow({ id: 'fs-1', status: 'planted', payoffChapterId: null, title: '关键信件' }),
    ];
    const issues = await polishOutline(chapters, [], foreshadows);
    const orphanIssue = issues.find(i => i.description.includes('未规划回收章节'));
    expect(orphanIssue).toBeDefined();
    expect(orphanIssue!.dimension).toBe('foreshadow');
    expect(orphanIssue!.severity).toBe('warning');
  });

  it('规则5：伏笔长期未提及（chaptersSinceMention>=8）→ foreshadow-stale 信息', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1' }),
      makeCleanChapter({ id: 'ch-2' }),
    ];
    const foreshadows = [
      makeForeshadow({
        id: 'fs-1',
        status: 'planted',
        payoffChapterId: 'ch-1',
        chaptersSinceMention: 10,
        title: '古老信件',
      }),
    ];
    const issues = await polishOutline(chapters, [], foreshadows);
    const staleIssue = issues.find(i => i.description.includes('未提及'));
    expect(staleIssue).toBeDefined();
    expect(staleIssue!.dimension).toBe('foreshadow');
    expect(staleIssue!.severity).toBe('info');
  });

  it('规则6：主角在所有章节均未出场 → character-absent 警告', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1', content: '<p>其他角色出场。</p>' }),
      makeCleanChapter({ id: 'ch-2', content: '<p>另一个角色出场。</p>' }),
    ];
    const characters = [
      makeCharacter({ id: 'char-1', role: 'protagonist', name: '独孤求败' }),
    ];
    const issues = await polishOutline(chapters, characters, []);
    const absentIssue = issues.find(i => i.description.includes('均未标注出场'));
    expect(absentIssue).toBeDefined();
    expect(absentIssue!.dimension).toBe('character');
    expect(absentIssue!.severity).toBe('warning');
  });

  it('规则7：3+ 章节标题仅为「第X章」无副标题 → structure-title 信息', async () => {
    const longSummary = '足够长的摘要内容避免触发规则三';
    const chapters = [
      makeCleanChapter({ id: 'ch-1', title: '第一章', summary: longSummary }),
      makeCleanChapter({ id: 'ch-2', title: '第二章', summary: longSummary }),
      makeCleanChapter({ id: 'ch-3', title: '第三章', summary: longSummary }),
    ];
    const issues = await polishOutline(chapters);
    const titleIssue = issues.find(i => i.description.includes('仅为「第X章」'));
    expect(titleIssue).toBeDefined();
    expect(titleIssue!.dimension).toBe('structure');
    expect(titleIssue!.severity).toBe('info');
  });

  it('规则8：相邻章节字数骤降（prev>2000, curr<200）→ logic-gap 警告', async () => {
    const chapters = [
      makeCleanChapter({ id: 'ch-1', wordCount: 3000 }),
      makeCleanChapter({ id: 'ch-2', wordCount: 100 }),
    ];
    const issues = await polishOutline(chapters);
    const gapIssue = issues.find(i => i.description.includes('字数骤降'));
    expect(gapIssue).toBeDefined();
    expect(gapIssue!.dimension).toBe('logic');
    expect(gapIssue!.severity).toBe('warning');
  });
});

// ============ polishText LLM 路径 ============
describe('polishText LLM 路径', () => {
  it('LLM 成功返回润色内容', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('<p>润色后的优美文字</p>');
    const result = await polishText('原文', 'balanced');
    expect(result.type).toBe('polish');
    expect(result.title).toBe('润色优化');
    expect(result.content).toContain('<p>');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock（含润色说明）', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await polishText('原文', 'balanced');
    expect(result.type).toBe('polish');
    expect(result.content).toContain('润色说明');
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ polishOutline LLM 路径 ============
describe('polishOutline LLM 路径', () => {
  it('LLM 返回有效 JSON 数组 → 解析为 OutlineIssue[]', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { dimension: 'pacing', severity: 'info', chapterId: 'ch-1', description: '节奏偏慢', suggestion: '加快冲突' },
        { dimension: 'structure', severity: 'warning', chapterId: '', description: '结构断层', suggestion: '增加过渡' },
      ]),
    );
    const chapters = [makeChapter({ id: 'ch-1', levelType: 'chapter' })];
    const issues = await polishOutline(chapters);
    expect(issues).toHaveLength(2);
    expect(issues[0].dimension).toBe('pacing');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].chapterId).toBe('ch-1');
    expect(issues[1].dimension).toBe('structure');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回非数组 → 降级到启发式', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('{"not":"array"}');
    const chapters = [
      makeChapter({ id: 'ch-1', levelType: 'chapter' }),
      makeChapter({ id: 'ch-2', levelType: 'chapter' }),
    ];
    const issues = await polishOutline(chapters);
    expect(Array.isArray(issues)).toBe(true);
    callLLMSpy.mockRestore();
  });

  it('LLM 返回数组含无效 dimension/severity → 降级到默认值', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify([
        { dimension: 'invalid-dim', severity: 'invalid-sev', description: '测试', suggestion: '建议' },
      ]),
    );
    const chapters = [makeChapter({ id: 'ch-1', levelType: 'chapter' })];
    const issues = await polishOutline(chapters);
    expect(issues).toHaveLength(1);
    expect(issues[0].dimension).toBe('structure');
    expect(issues[0].severity).toBe('info');
    callLLMSpy.mockRestore();
  });
});

// ============ analyzeChapter LLM 路径 ============
describe('analyzeChapter LLM 路径', () => {
  it('LLM 返回有效 JSON → 解析为 ChapterAnalysis', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        emotionScore: 80,
        conflictIntensity: 70,
        hookStrength: 60,
        pacingScore: 50,
        dialogueRatio: 30,
        descriptionRatio: 40,
      }),
    );
    const result = await analyzeChapter(makeChapter());
    expect(result.emotionScore).toBe(80);
    expect(result.conflictIntensity).toBe(70);
    expect(result.hookStrength).toBe(60);
    expect(result.characters).toEqual([]);
    callLLMSpy.mockRestore();
  });

  it('LLM 返回无效 JSON → 降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('not json at all');
    const result = await analyzeChapter(makeChapter());
    expect(typeof result.emotionScore).toBe('number');
    callLLMSpy.mockRestore();
  });
});

// ============ checkStyleConsistency LLM 路径 ============
describe('checkStyleConsistency LLM 路径', () => {
  it('LLM 返回有效 JSON → 解析为 issues 数组', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      JSON.stringify({
        issues: [
          { type: 'tone', severity: 'warning', chapterId: 'ch-1', description: '文风不一致' },
        ],
      }),
    );
    const result = await checkStyleConsistency([makeChapter()]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('tone');
    expect(result.issues[0].description).toBe('文风不一致');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock（空 issues）', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await checkStyleConsistency([makeChapter()]);
    expect(result.issues).toEqual([]);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateBrainstorm LLM 路径 ============
describe('generateBrainstorm LLM 路径', () => {
  it('LLM 成功返回 3 个剧情分支', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      '主角发现秘密\n突如其来的危机\n意外盟友出现',
    );
    const ideas = await generateBrainstorm('上下文', '林墨');
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toBe('主角发现秘密');
    callLLMSpy.mockRestore();
  });

  it('LLM 返回带编号的文本 → 编号被清除', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      '1. 第一个分支\n2. 第二个分支\n3. 第三个分支',
    );
    const ideas = await generateBrainstorm('上下文');
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toBe('第一个分支');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ideas = await generateBrainstorm('上下文', '林墨');
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toContain('林墨');
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateStoryIdea LLM 路径 ============
describe('generateStoryIdea LLM 路径', () => {
  it('LLM 成功返回故事创意', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      '记忆可以交易的世界\n时间循环中的救赎\n午夜商店售卖人生',
    );
    const ideas = await generateStoryIdea('提示');
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toBe('记忆可以交易的世界');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ideas = await generateStoryIdea('提示');
    expect(ideas).toHaveLength(3);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateCharacterNames LLM 路径 ============
describe('generateCharacterNames LLM 路径', () => {
  it('LLM 成功返回角色名字', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('林远\n苏晚\n陈默');
    const names = await generateCharacterNames('protagonist', 3);
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('林远');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const names = await generateCharacterNames('protagonist', 5);
    expect(names.length).toBeGreaterThan(0);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ generateChapterTitleSuggestions LLM 路径 ============
describe('generateChapterTitleSuggestions LLM 路径', () => {
  it('LLM 成功返回标题候选', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce(
      '暗夜追踪\n迷雾重重\n黎明破晓',
    );
    const titles = await generateChapterTitleSuggestions(makeChapter());
    expect(titles).toHaveLength(3);
    expect(titles[0]).toBe('暗夜追踪');
    callLLMSpy.mockRestore();
  });

  it('LLM 抛错时降级到 mock', async () => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockRejectedValueOnce(new Error('API down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const titles = await generateChapterTitleSuggestions(makeChapter());
    expect(titles).toHaveLength(3);
    callLLMSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============ humanizeIntensityForExpand/Continue 分支覆盖 ============
// 通过不同 strictness 设置触发 ternary 的三个分支（>70 / >40 / <=40）
describe('humanizeIntensity 分支覆盖', () => {
  it('expandText mock 模式 strictness>70 触发高严格度分支', async () => {
    updateSettings({ provider: 'mock', strictness: 80 });
    const result = await expandText('原文内容', 'detail');
    expect(result.type).toBe('expand');
    expect(result.content).toBeTruthy();
  });

  it('expandText mock 模式 strictness<=40 触发低严格度分支', async () => {
    updateSettings({ provider: 'mock', strictness: 30 });
    const result = await expandText('原文内容', 'detail');
    expect(result.type).toBe('expand');
    expect(result.content).toBeTruthy();
  });

  it('generateContinuation mock 模式 strictness>70 触发高严格度分支', async () => {
    updateSettings({ provider: 'mock', strictness: 80 });
    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    expect(suggestions).toHaveLength(3);
  });

  it('generateContinuation mock 模式 strictness<=40 触发低严格度分支', async () => {
    updateSettings({ provider: 'mock', strictness: 30 });
    const suggestions = await generateContinuation('上下文', '概要', [makeCharacter()]);
    expect(suggestions).toHaveLength(3);
  });
});

// ============ analyzeContextStyle 分支覆盖 ============
// 通过 generateContinuation LLM 路径触发 buildContinuePrompt → analyzeContextStyle 的各分支
describe('analyzeContextStyle 分支覆盖（via generateContinuation LLM 路径）', () => {
  beforeEach(() => {
    updateSettings({ provider: 'openai', apiKey: 'sk-test' });
  });

  it('第一人称上下文（含"我"）', async () => {
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('<p>续写内容</p>');
    await generateContinuation('我走进了房间。', '概要', []);
    expect(callLLMSpy).toHaveBeenCalled();
    callLLMSpy.mockRestore();
  });

  it('第三人称上下文（含"他"，不含"我"）', async () => {
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('<p>续写内容</p>');
    await generateContinuation('他走进了房间。', '概要', []);
    expect(callLLMSpy).toHaveBeenCalled();
    callLLMSpy.mockRestore();
  });

  it('含对话（中文引号）+ 短句', async () => {
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('<p>续写内容</p>');
    await generateContinuation('他说："你好。"然后走了。', '概要', []);
    expect(callLLMSpy).toHaveBeenCalled();
    callLLMSpy.mockRestore();
  });

  it('无人称 + 长句为主', async () => {
    const callLLMSpy = vi.spyOn(llmClient, 'callLLM').mockResolvedValueOnce('<p>续写内容</p>');
    await generateContinuation('天空飘着雪花，整个城市被白色覆盖，远处传来若有若无的钟声。', '概要', []);
    expect(callLLMSpy).toHaveBeenCalled();
    callLLMSpy.mockRestore();
  });
});

// ============ llmClient 注入化测试 ============
//
// 验证 setLLMClient/getLLMClient 注入机制：
// - 注入 mock client 后，子模块使用注入的 client（而非单例）
// - 注入 client 的 settings 与单例隔离
// - 恢复默认 client 后，子模块回退到单例
describe('llmClient 注入化', () => {
  let originalClient: LLMClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    originalClient = getLLMClient();
    // 构造符合 LLMClient 接口的 mock，所有方法用 vi.fn 便于断言
    mockClient = {
      getSettings: vi.fn(() => ({ provider: 'mock', strictness: 50, temperature: 0.7 })),
      callLLM: vi.fn(),
      callLLMStream: vi.fn(),
      ensureHtmlParagraphs: vi.fn((s: string) => s),
      clampScore: vi.fn(() => 50),
      delay: vi.fn(() => Promise.resolve()),
      updateSettings: vi.fn(),
      getTotalTokensUsed: vi.fn(() => 0),
      testConnection: vi.fn(),
    };
    setLLMClient(mockClient);
  });

  afterEach(() => {
    // 恢复默认 client，避免污染后续测试
    setLLMClient(originalClient);
  });

  it('注入后 generateBrainstorm 使用 mock client（getSettings/delay 被调用）', async () => {
    await generateBrainstorm('上下文');
    expect(mockClient.getSettings).toHaveBeenCalled();
    expect(mockClient.delay).toHaveBeenCalledWith(800);
  });

  it('注入 client provider=openai 时走 LLM 路径，调用 mock callLLM', async () => {
    mockClient.getSettings = vi.fn(() => ({ provider: 'openai', apiKey: 'sk-test', strictness: 50, temperature: 0.7 }));
    mockClient.callLLM = vi.fn().mockResolvedValue('分支一\n分支二\n分支三');
    const ideas = await generateBrainstorm('上下文', '林墨');
    expect(mockClient.callLLM).toHaveBeenCalled();
    expect(ideas).toEqual(['分支一', '分支二', '分支三']);
  });

  it('注入 client 的 settings 与单例隔离', async () => {
    // 单例设为 mock，注入 client 设为 openai——两者互不影响
    llmClient.updateSettings({ provider: 'mock', strictness: 50, temperature: 0.7 });
    mockClient.getSettings = vi.fn(() => ({ provider: 'openai', apiKey: 'sk-test', strictness: 50, temperature: 0.7 }));
    mockClient.callLLM = vi.fn().mockResolvedValue('创意一\n创意二\n创意三');
    // generateStoryIdea 应走 LLM 路径（使用注入 client 的 openai 设置）
    await generateStoryIdea('提示');
    expect(mockClient.callLLM).toHaveBeenCalled();
    // 单例的 settings 仍为 mock，未被注入 client 污染
    expect(llmClient.getSettings().provider).toBe('mock');
  });

  it('恢复默认 client 后，子模块回退到单例', async () => {
    setLLMClient(originalClient);
    // 直接操作单例，确保 mock provider
    llmClient.updateSettings({ provider: 'mock', strictness: 50, temperature: 0.7 });
    await generateBrainstorm('上下文');
    // mock client 不应被调用
    expect(mockClient.getSettings).not.toHaveBeenCalled();
  });
});
