/**
 * src/utils/aiService/health.ts 单元测试
 *
 * 覆盖目标（原覆盖率仅 7.84%，105-525 行未覆盖）：
 *   - analyzeProjectHealth：mock provider 启发式 7 类问题 + 非 mock LLM 路径 + 异常 fallback
 *   - buildHealthReport：severity 排序 + overallStatus 三态（critical/warning/healthy）
 *   - recommendPolishGuide：空报告 / 多 severity 步骤 / 耗时估算
 *   - generatePolishSummary：全 0 / 部分字段 / 全字段
 *
 * 测试策略：
 *   - 默认 provider='mock'：走启发式分支，验证 7 类问题触发条件
 *   - setLLMClient 注入 provider='openai' 的 mock：覆盖 LLM 解析路径与异常 fallback
 *   - 测试后恢复默认 client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLLMClient, getLLMClient } from './core';
import {
  analyzeProjectHealth,
  recommendPolishGuide,
  generatePolishSummary,
  type ProjectHealthReport,
  type HealthIssue,
} from './health';
import { type LLMClient } from '../llmClient';
import type { Chapter, Character, Foreshadow, Subplot, UpdateSchedule } from '@/types';

// ============ fixtures ============
const NOW = '2025-01-01T00:00:00.000Z';

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'c-1',
    projectId: 'p-1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 1,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 0,
    content: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Chapter;
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'p-1',
    name: '主角',
    role: 'protagonist',
    description: '',
    age: '',
    gender: '',
    personality: '',
    background: '',
    motivation: '',
    arc: '',
    relationships: [],
    tags: [],
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Character;
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    id: 'f-1',
    projectId: 'p-1',
    title: '伏笔1',
    description: '',
    status: 'planted',
    plantedChapterId: 'c-1',
    payoffChapterId: null,
    priority: 'medium',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 0,
    notes: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSubplot(overrides: Partial<Subplot> = {}): Subplot {
  return {
    id: 's-1',
    projectId: 'p-1',
    title: '支线1',
    description: '',
    status: 'open',
    startChapterId: null,
    lastProgressChapterId: null,
    expectedCloseChapterId: null,
    relatedCharacters: [],
    relatedForeshadows: [],
    notes: '',
    lastProgressAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeUpdateSchedule(overrides: Partial<UpdateSchedule> = {}): UpdateSchedule {
  return {
    dailyTargetWords: 2000,
    dailySpeed: 1500,
    paywallChapterThreshold: 30,
    lastUpdateAt: null,
    enableStaleAlert: true,
    staleAlertDays: 3,
    ...overrides,
  } as UpdateSchedule;
}

// ============ mock LLMClient 工厂 ============
function makeMockClient(provider: 'mock' | 'openai' = 'mock') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    getSettings: vi.fn(() => ({ provider, apiKey: '', strictness: 50, temperature: 0.7 })),
    callLLM: vi.fn(),
    callLLMStream: vi.fn(),
    ensureHtmlParagraphs: vi.fn((s: string) => s),
    clampScore: vi.fn(() => 50),
    delay: vi.fn(() => Promise.resolve()),
    updateSettings: vi.fn(),
    getTotalTokensUsed: vi.fn(() => 0),
    testConnection: vi.fn(),
  };
  return client;
}

describe('analyzeProjectHealth', () => {
  let originalClient: LLMClient;

  beforeEach(() => {
    originalClient = getLLMClient();
  });

  afterEach(() => {
    setLLMClient(originalClient);
    vi.restoreAllMocks();
  });

  // ============ 启发式：mock provider 默认路径 ============
  it('mock provider：空项目只报"核心驱动未锁定"(medium) + "蓝图未生成"(low)', async () => {
    setLLMClient(makeMockClient('mock'));
    const report = await analyzeProjectHealth({
      chapters: [],
      characters: [],
      foreshadows: [],
    });

    expect(report.summary.totalIssues).toBe(2);
    // severity 排序：medium 在前，low 在后
    expect(report.issues[0].severity).toBe('medium');
    expect(report.issues[0].category).toBe('structure');
    expect(report.issues[0].title).toContain('核心驱动');
    expect(report.issues[1].severity).toBe('low');
    expect(report.issues[1].title).toContain('蓝图');
    // overallStatus = warning（有 medium 无 high）
    expect(report.summary.overallStatus).toBe('warning');
    expect(report.summary.highCount).toBe(0);
    expect(report.summary.mediumCount).toBe(1);
    expect(report.summary.lowCount).toBe(1);
  });

  it('mock provider：已锁定核心驱动 + 已生成蓝图 → overallStatus=healthy', async () => {
    setLLMClient(makeMockClient('mock'));
    const report = await analyzeProjectHealth({
      chapters: [makeChapter({ id: 'c-1', status: 'done' })],
      characters: [],
      foreshadows: [],
      coreDriver: { type: 'character' },
      blueprint: { mainline: 'x' },
    });

    expect(report.summary.totalIssues).toBe(0);
    expect(report.summary.overallStatus).toBe('healthy');
  });

  // ============ 启发式：伏笔逾期（high）============
  it('伏笔 status=planted 且距埋设章节 > 5 章 → high 伏笔逾期', async () => {
    setLLMClient(makeMockClient('mock'));
    // 构造 8 章，伏笔埋在第 1 章（gap = 7 - 0 = 7 > 5）
    const chapters = Array.from({ length: 8 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1, title: `第${i + 1}章` }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [
        makeForeshadow({ id: 'f-1', plantedChapterId: 'c-1', status: 'planted' }),
      ],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const foreshadowIssue = report.issues.find(i => i.category === 'foreshadow');
    expect(foreshadowIssue).toBeDefined();
    expect(foreshadowIssue!.severity).toBe('high');
    expect(foreshadowIssue!.title).toContain('逾期');
    expect(foreshadowIssue!.actionTab).toBe('foreshadowBoard');
    expect(foreshadowIssue!.actionChapterId).toBe('c-1');
    expect(report.summary.overallStatus).toBe('critical');
  });

  it('伏笔 status≠planted（已回收/进行中）→ 不报逾期', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 8 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1 }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [
        makeForeshadow({ id: 'f-1', plantedChapterId: 'c-1', status: 'paid-off' }),
        makeForeshadow({ id: 'f-2', plantedChapterId: 'c-1', status: 'progressing' }),
      ],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'foreshadow')).toBeUndefined();
  });

  it('伏笔 plantedChapterId 不在主章节列表 → 跳过', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 8 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1 }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [
        makeForeshadow({ id: 'f-1', plantedChapterId: 'c-missing', status: 'planted' }),
      ],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'foreshadow')).toBeUndefined();
  });

  // ============ 启发式：节奏拖沓（medium）============
  it('最近 10 章连续 5+ 章无高潮关键词 → medium 节奏拖沓', async () => {
    setLLMClient(makeMockClient('mock'));
    // 5 章正文均不含高潮/冲突/转折/对决/揭秘
    const chapters = Array.from({ length: 5 }, (_, i) =>
      makeChapter({
        id: `c-${i + 1}`,
        order: i + 1,
        content: '平淡的日常描写',
        summary: '日常',
      }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const pacingIssue = report.issues.find(i => i.category === 'pacing');
    expect(pacingIssue).toBeDefined();
    expect(pacingIssue!.severity).toBe('medium');
    expect(pacingIssue!.actionTab).toBe('pacing');
    expect(pacingIssue!.title).toContain('连续5章无高潮');
  });

  it('章节正文含高潮关键词 → 不报节奏拖沓', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 5 }, (_, i) =>
      makeChapter({
        id: `c-${i + 1}`,
        order: i + 1,
        content: i === 2 ? '关键剧情转折点' : '平淡日常',
        summary: '',
      }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'pacing')).toBeUndefined();
  });

  it('主章节数 < 5 → 不进入节奏检测', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 4 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1, content: '平淡' }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'pacing')).toBeUndefined();
  });

  // ============ 启发式：角色长期未出场（medium）============
  it('非 minor 角色连续 15+ 章未在正文出现 → medium 角色弧光断层', async () => {
    setLLMClient(makeMockClient('mock'));
    // 15 章，全部不含主角名字
    const chapters = Array.from({ length: 15 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1, content: '其他人的故事' }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [makeCharacter({ id: 'char-1', name: '主角', role: 'protagonist' })],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const charIssue = report.issues.find(i => i.category === 'character');
    expect(charIssue).toBeDefined();
    expect(charIssue!.severity).toBe('medium');
    expect(charIssue!.actionTab).toBe('characters');
    expect(charIssue!.title).toContain('主角');
    expect(charIssue!.title).toContain('15章未出场');
  });

  it('role=minor 角色 → 不检测出场', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 15 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1, content: '路人故事' }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [makeCharacter({ id: 'char-1', name: '路人', role: 'minor' })],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'character')).toBeUndefined();
  });

  it('角色通过 characterFocus 数组被提及 → 不报断层', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 15 }, (_, i) =>
      makeChapter({
        id: `c-${i + 1}`,
        order: i + 1,
        content: '其他故事',
        // 最后一章通过 characterFocus 引用主角
        ...(i === 14 ? { characterFocus: ['char-1'] } : {}),
      } as Partial<Chapter>),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [makeCharacter({ id: 'char-1', name: '主角', role: 'protagonist' })],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'character')).toBeUndefined();
  });

  it('对手/叙述者角色未出场 → 角色标签正确', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 16 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1, content: '无人提及' }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [
        makeCharacter({ id: 'char-a', name: '反派', role: 'antagonist' }),
        makeCharacter({ id: 'char-b', name: '说书人', role: 'narrator' }),
        makeCharacter({ id: 'char-c', name: '配角', role: 'supporting' }),
      ],
      foreshadows: [],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const charIssues = report.issues.filter(i => i.category === 'character');
    expect(charIssues).toHaveLength(3);
    // 三个不同 roleLabel：对手 / 叙述者 / 重要角色
    expect(charIssues.some(i => i.description.includes('对手'))).toBe(true);
    expect(charIssues.some(i => i.description.includes('叙述者'))).toBe(true);
    expect(charIssues.some(i => i.description.includes('重要角色'))).toBe(true);
  });

  // ============ 启发式：支线停滞（high）============
  it('支线状态非 closed/abandoned 且 updatedAt 距今 > 14 天 → high 停滞', async () => {
    setLLMClient(makeMockClient('mock'));
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const report = await analyzeProjectHealth({
      chapters: [makeChapter()],
      characters: [],
      foreshadows: [],
      subplots: [
        makeSubplot({ id: 's-1', title: '旧支线', status: 'open', updatedAt: staleDate }),
      ],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const subplotIssue = report.issues.find(i => i.category === 'subplot');
    expect(subplotIssue).toBeDefined();
    expect(subplotIssue!.severity).toBe('high');
    expect(subplotIssue!.actionTab).toBe('beats');
    expect(subplotIssue!.title).toContain('停滞');
    expect(subplotIssue!.title).toContain('20天');
  });

  it('支线 status=closed 或 abandoned → 不报停滞', async () => {
    setLLMClient(makeMockClient('mock'));
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const report = await analyzeProjectHealth({
      chapters: [makeChapter()],
      characters: [],
      foreshadows: [],
      subplots: [
        makeSubplot({ id: 's-1', status: 'closed', updatedAt: staleDate }),
        makeSubplot({ id: 's-2', status: 'abandoned', updatedAt: staleDate }),
      ],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'subplot')).toBeUndefined();
  });

  it('支线 updatedAt 无效日期 → 跳过', async () => {
    setLLMClient(makeMockClient('mock'));
    const report = await analyzeProjectHealth({
      chapters: [makeChapter()],
      characters: [],
      foreshadows: [],
      subplots: [makeSubplot({ id: 's-1', status: 'open', updatedAt: 'invalid-date' })],
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'subplot')).toBeUndefined();
  });

  // ============ 启发式：存稿不足（high/medium）============
  it('updateSchedule 存在 + done 章节数 < 3 → high 存稿告警', async () => {
    setLLMClient(makeMockClient('mock'));
    const report = await analyzeProjectHealth({
      chapters: [
        makeChapter({ id: 'c-1', status: 'done' }),
        makeChapter({ id: 'c-2', status: 'draft' }),
      ],
      characters: [],
      foreshadows: [],
      updateSchedule: makeUpdateSchedule(),
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const stockpileIssue = report.issues.find(i => i.category === 'stockpile');
    expect(stockpileIssue).toBeDefined();
    expect(stockpileIssue!.severity).toBe('high');
    expect(stockpileIssue!.title).toContain('存稿仅剩 1 天');
    expect(stockpileIssue!.actionTab).toBe('snapshots');
  });

  it('updateSchedule 存在 + done 章节数 3-6 → medium 存稿告警', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 5 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, status: i < 4 ? 'done' : 'draft' }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [],
      updateSchedule: makeUpdateSchedule(),
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });

    const stockpileIssue = report.issues.find(i => i.category === 'stockpile');
    expect(stockpileIssue).toBeDefined();
    expect(stockpileIssue!.severity).toBe('medium');
    expect(stockpileIssue!.title).toContain('4 天');
  });

  it('updateSchedule 存在 + done 章节数 >= 7 → 不报存稿告警', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 7 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, status: 'done' }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [],
      updateSchedule: makeUpdateSchedule(),
      coreDriver: { type: 'plot' },
      blueprint: { mainline: 'x' },
    });
    expect(report.issues.find(i => i.category === 'stockpile')).toBeUndefined();
  });

  // ============ 非 mock provider：LLM 解析路径 ============
  it('openai provider：LLM 返回合法 JSON 数组 → 解析为 issues', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
      {
        severity: 'high',
        category: 'foreshadow',
        title: '测试伏笔问题',
        description: '描述',
        suggestion: '建议',
        actionTab: 'foreshadowBoard',
        actionLabel: '查看',
      },
      {
        severity: 'invalid-severity',
        category: 'invalid-category',
        title: '非法字段应被规整为默认值',
        actionTab: 'invalid-tab',
        actionLabel: '操作',
      },
    ]));
    setLLMClient(client);

    const report = await analyzeProjectHealth({
      chapters: [makeChapter({ id: 'c-1' })],
      characters: [],
      foreshadows: [],
    });

    expect(client.callLLM).toHaveBeenCalledTimes(1);
    expect(report.summary.totalIssues).toBe(2);
    // 合法字段保留
    expect(report.issues[0].category).toBe('foreshadow');
    expect(report.issues[0].severity).toBe('high');
    // 非法字段规整：severity→medium, category→structure, actionTab→diagnosis
    expect(report.issues[1].severity).toBe('medium');
    expect(report.issues[1].category).toBe('structure');
    expect(report.issues[1].actionTab).toBe('diagnosis');
  });

  it('openai provider：actionChapterId 引用不存在章节 → 置 undefined', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
      {
        severity: 'medium',
        category: 'character',
        title: '问题',
        actionTab: 'characters',
        actionChapterId: 'c-missing',
        actionLabel: '查看',
      },
    ]));
    setLLMClient(client);

    const report = await analyzeProjectHealth({
      chapters: [makeChapter({ id: 'c-1' })],
      characters: [],
      foreshadows: [],
    });

    expect(report.issues[0].actionChapterId).toBeUndefined();
  });

  it('openai provider：actionChapterId 引用存在章节 → 保留', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
      {
        severity: 'medium',
        category: 'character',
        title: '问题',
        actionTab: 'characters',
        actionChapterId: 'c-1',
        actionLabel: '查看',
      },
    ]));
    setLLMClient(client);

    const report = await analyzeProjectHealth({
      chapters: [makeChapter({ id: 'c-1' })],
      characters: [],
      foreshadows: [],
    });

    expect(report.issues[0].actionChapterId).toBe('c-1');
  });

  it('openai provider：LLM 返回非数组 → fallback 到启发式', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockResolvedValue('{"not":"array"}');
    setLLMClient(client);

    const report = await analyzeProjectHealth({
      chapters: [],
      characters: [],
      foreshadows: [],
    });

    // 启发式会产出"核心驱动未锁定"+"蓝图未生成"
    expect(report.summary.totalIssues).toBe(2);
    expect(report.issues.some(i => i.title.includes('核心驱动'))).toBe(true);
  });

  it('openai provider：LLM 抛错 → catch 后 fallback 到启发式 + console.warn', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockRejectedValue(new Error('API 故障'));
    setLLMClient(client);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const report = await analyzeProjectHealth({
      chapters: [],
      characters: [],
      foreshadows: [],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('falling back to heuristic'),
      expect.any(Error),
    );
    // fallback 后产出启发式问题
    expect(report.issues.some(i => i.title.includes('核心驱动'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('openai provider：LLM 返回非对象数组项 → 跳过非法项', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
      null,
      'string-item',
      42,
      { severity: 'high', category: 'foreshadow', title: '合法项', actionTab: 'foreshadowBoard', actionLabel: '查看' },
    ]));
    setLLMClient(client);

    const report = await analyzeProjectHealth({
      chapters: [makeChapter()],
      characters: [],
      foreshadows: [],
    });

    // 仅 1 个合法项被保留
    expect(report.summary.totalIssues).toBe(1);
    expect(report.issues[0].title).toBe('合法项');
  });

  it('LLM 路径：字段缺失时使用默认值（title/description/suggestion/actionLabel）', async () => {
    const client = makeMockClient('openai');
    client.callLLM = vi.fn().mockResolvedValue(JSON.stringify([{}]));
    setLLMClient(client);

    const report = await analyzeProjectHealth({
      chapters: [makeChapter()],
      characters: [],
      foreshadows: [],
    });

    expect(report.summary.totalIssues).toBe(1);
    const issue = report.issues[0];
    expect(issue.title).toBe('');
    expect(issue.actionLabel).toBe('查看详情');
    expect(issue.severity).toBe('medium');
    expect(issue.category).toBe('structure');
    expect(issue.actionTab).toBe('diagnosis');
  });

  // ============ buildHealthReport：overallStatus 三态 ============
  it('overallStatus=critical：含 high 严重度问题', async () => {
    setLLMClient(makeMockClient('mock'));
    const chapters = Array.from({ length: 8 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1 }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [makeForeshadow({ plantedChapterId: 'c-1', status: 'planted' })],
    });
    expect(report.summary.overallStatus).toBe('critical');
    expect(report.summary.highCount).toBeGreaterThan(0);
  });

  it('severity 排序：high → medium → low 顺序', async () => {
    setLLMClient(makeMockClient('mock'));
    // 构造同时含 high（伏笔逾期）+ medium（核心驱动未锁）+ low（蓝图未生成）
    const chapters = Array.from({ length: 8 }, (_, i) =>
      makeChapter({ id: `c-${i + 1}`, order: i + 1 }),
    );
    const report = await analyzeProjectHealth({
      chapters,
      characters: [],
      foreshadows: [makeForeshadow({ plantedChapterId: 'c-1', status: 'planted' })],
      // 不传 coreDriver / blueprint 触发 medium + low
    });

    const severities = report.issues.map(i => i.severity);
    const firstHigh = severities.indexOf('high');
    const firstMedium = severities.indexOf('medium');
    const firstLow = severities.indexOf('low');
    expect(firstHigh).toBeLessThan(firstMedium);
    expect(firstMedium).toBeLessThan(firstLow);
  });
});

describe('recommendPolishGuide', () => {
  it('空 issues → 返回空 steps + 健康良好文案', async () => {
    const emptyReport: ProjectHealthReport = {
      issues: [],
      summary: { totalIssues: 0, highCount: 0, mediumCount: 0, lowCount: 0, overallStatus: 'healthy' },
    };
    const guide = await recommendPolishGuide(emptyReport);
    expect(guide.steps).toHaveLength(0);
    expect(guide.totalEstimatedMinutes).toBe(0);
    expect(guide.summary).toContain('健康状况良好');
  });

  it('high 问题估算 8 分钟，medium 4 分钟，low 2 分钟', async () => {
    const report: ProjectHealthReport = {
      issues: [
        { id: '1', severity: 'high', category: 'foreshadow', title: '高危', description: 'd', suggestion: 's', actionTab: 'foreshadowBoard', actionLabel: '查看' },
        { id: '2', severity: 'medium', category: 'pacing', title: '中危', description: 'd', suggestion: 's', actionTab: 'pacing', actionLabel: '查看' },
        { id: '3', severity: 'low', category: 'structure', title: '低危', description: 'd', suggestion: 's', actionTab: 'skeleton', actionLabel: '查看' },
      ],
      summary: { totalIssues: 3, highCount: 1, mediumCount: 1, lowCount: 1, overallStatus: 'critical' },
    };
    const guide = await recommendPolishGuide(report);
    expect(guide.steps).toHaveLength(3);
    expect(guide.steps[0].estimatedMinutes).toBe(8);
    expect(guide.steps[1].estimatedMinutes).toBe(4);
    expect(guide.steps[2].estimatedMinutes).toBe(2);
    expect(guide.totalEstimatedMinutes).toBe(14);
    // order 从 1 开始递增
    expect(guide.steps[0].order).toBe(1);
    expect(guide.steps[2].order).toBe(3);
    // detail 拼装 description + suggestion
    expect(guide.steps[0].detail).toContain('d');
    expect(guide.steps[0].detail).toContain('s');
    // summary 文案包含高/中危计数与总耗时
    expect(guide.summary).toContain('1 个高危');
    expect(guide.summary).toContain('1 个中危');
    expect(guide.summary).toContain('14 分钟');
  });

  it('问题顺序：按 severity 排序后生成步骤（与原 issues 顺序无关）', async () => {
    const report: ProjectHealthReport = {
      issues: [
        { id: '3', severity: 'low', category: 'structure', title: '低', description: 'd', suggestion: 's', actionTab: 'skeleton', actionLabel: '查看' },
        { id: '1', severity: 'high', category: 'foreshadow', title: '高', description: 'd', suggestion: 's', actionTab: 'foreshadowBoard', actionLabel: '查看' },
        { id: '2', severity: 'medium', category: 'pacing', title: '中', description: 'd', suggestion: 's', actionTab: 'pacing', actionLabel: '查看' },
      ],
      summary: { totalIssues: 3, highCount: 1, mediumCount: 1, lowCount: 1, overallStatus: 'critical' },
    };
    const guide = await recommendPolishGuide(report);
    expect(guide.steps[0].title).toBe('高');
    expect(guide.steps[1].title).toBe('中');
    expect(guide.steps[2].title).toBe('低');
  });

  it('携带 actionChapterId 的 issue → step.targetChapterId 透传', async () => {
    const report: ProjectHealthReport = {
      issues: [
        {
          id: '1', severity: 'high', category: 'foreshadow', title: '高',
          description: 'd', suggestion: 's', actionTab: 'foreshadowBoard',
          actionChapterId: 'c-99', actionLabel: '查看',
        },
      ],
      summary: { totalIssues: 1, highCount: 1, mediumCount: 0, lowCount: 0, overallStatus: 'critical' },
    };
    const guide = await recommendPolishGuide(report);
    expect(guide.steps[0].targetChapterId).toBe('c-99');
  });
});

describe('generatePolishSummary', () => {
  it('所有字段为 0 → 返回"未产生明显变更"提示', () => {
    const summary = generatePolishSummary({
      foreshadowsResolved: 0,
      pacingAdjusted: 0,
      arcFixed: 0,
      newInspirations: 0,
      snapshotsCreated: 0,
    });
    expect(summary).toContain('未产生明显变更');
    expect(summary).toContain('灵感打磨');
  });

  it('部分字段非零 → 仅列出有变更的项', () => {
    const summary = generatePolishSummary({
      foreshadowsResolved: 3,
      pacingAdjusted: 0,
      arcFixed: 2,
      newInspirations: 0,
      snapshotsCreated: 0,
    });
    expect(summary).toContain('回收 3 个伏笔');
    expect(summary).toContain('修复 2 处角色弧光');
    expect(summary).not.toContain('节奏');
    expect(summary).not.toContain('灵感');
    expect(summary).not.toContain('快照');
  });

  it('全部字段非零 → 全部列出，以顿号连接', () => {
    const summary = generatePolishSummary({
      foreshadowsResolved: 1,
      pacingAdjusted: 1,
      arcFixed: 1,
      newInspirations: 1,
      snapshotsCreated: 1,
    });
    expect(summary).toBe('本次打磨共回收 1 个伏笔、调整 1 处节奏、修复 1 处角色弧光、新增 1 条灵感、创建 1 个快照。');
  });
});

// ============ 类型守卫：HealthIssue 字段完整性 ============
describe('HealthIssue 类型与字段', () => {
  it('analyzeProjectHealth 产出的 issue 字段完整（id/severity/category/title/description/suggestion/actionTab/actionLabel）', async () => {
    const { setLLMClient: setClient, getLLMClient: getClient } = await import('./core');
    const original = getClient();
    setClient(makeMockClient('mock'));
    try {
      const report = await analyzeProjectHealth({
        chapters: [],
        characters: [],
        foreshadows: [],
      });
      const issue: HealthIssue = report.issues[0];
      expect(typeof issue.id).toBe('string');
      expect(['high', 'medium', 'low']).toContain(issue.severity);
      expect(['foreshadow', 'pacing', 'character', 'subplot', 'stockpile', 'structure', 'emotion'])
        .toContain(issue.category);
      expect(typeof issue.title).toBe('string');
      expect(typeof issue.description).toBe('string');
      expect(typeof issue.suggestion).toBe('string');
      expect(typeof issue.actionTab).toBe('string');
      expect(typeof issue.actionLabel).toBe('string');
    } finally {
      setClient(original);
    }
  });
});
