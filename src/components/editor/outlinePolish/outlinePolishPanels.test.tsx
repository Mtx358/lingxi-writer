/**
 * outlinePolish 子面板渲染冒烟测试
 *
 * 覆盖 7 个独立功能域子组件（规格书第一/二/三/四/五阶段）：
 *   - InspirationPanel（默认导出）：灵感池 + 连线沙盘
 *   - CoreDriverLockPanel（命名导出）：核心驱动锁定
 *   - MultiLineCommandPanel（默认导出）：多线作战指挥台
 *   - PacingPressurePanel（命名导出）：节奏压力测试
 *   - ForeshadowBoardPanel（命名导出）：草蛇灰线看板
 *   - CharacterArcCheckPanel（命名导出）：人物弧光校验
 *   - VersionDiffPanel（命名导出）：版本对比
 *
 * 测试策略：每个组件 2-3 个用例，覆盖默认空态 / 有数据态 / 关键交互，
 * 主要目的是渲染冒烟 + 关键文案检查，提升 functions 覆盖率。
 *
 * mock 模式参考 OutlinePolishPanel.test.tsx：用 vi.mock 替换 @/store/useAppStore，
 * useAppStore 既支持 selector 调用（useAppStore(s => s.xxx)），也支持
 * useAppStore.setState(...) 直接调用（ForeshadowBoardPanel.handleCardClick 用到）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ============ mock useAppStore ============
// mockStateRef 在 hoisted 阶段创建，factory 内引用同一对象；
// 每个 beforeEach 通过 setMockState 重置为默认值后再按用例覆盖。
const { mockStateRef } = vi.hoisted(() => ({
  mockStateRef: { current: {} as Record<string, unknown> },
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: Object.assign(
    vi.fn((selector: ((s: Record<string, unknown>) => unknown) | undefined) =>
      selector ? selector(mockStateRef.current) : mockStateRef.current,
    ),
    {
      setState: vi.fn((partial: Record<string, unknown>) => {
        Object.assign(mockStateRef.current, partial);
      }),
      getState: () => mockStateRef.current,
    },
  ),
}));

// ============ mock useToast（部分组件可能间接依赖） ============
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ============ 被测组件 ============
import InspirationPanel from './InspirationPanel';
import { CoreDriverLockPanel } from './CoreDriverLockPanel';
import MultiLineCommandPanel from './MultiLineCommandPanel';
import { PacingPressurePanel } from './PacingPressurePanel';
import { ForeshadowBoardPanel } from './ForeshadowBoardPanel';
import { CharacterArcCheckPanel } from './CharacterArcCheckPanel';
import { ReaderEmpathyCheckPanel } from './ReaderEmpathyCheckPanel';
import { SandboxTrialPanel } from './SandboxTrialPanel';
import { VersionDiffPanel } from './VersionDiffPanel';
import { useAppStore } from '@/store/useAppStore';
import type {
  Chapter,
  Character,
  Foreshadow,
  InspirationCard,
  StoryLink,
  Storyline,
  IntersectionTarget,
  PacingPressureReport,
  CharacterArcIssue,
  OutlineSnapshot,
  ForeshadowBoardItem,
  CoreDriver,
  VersionDiffReport,
  RelationshipTemperatureCurve,
  ReaderEmpathyReport,
  SandboxTrialReport,
  SandboxTrialSnapshot,
} from '@/types';

// ============ 默认 mock state ============
// 各组件用到的字段集中在此；每用例可通过 setMockState 覆盖。
function buildDefaultState(): Record<string, unknown> {
  return {
    chapters: [],
    characters: [],
    foreshadows: [],
    currentProjectId: 'proj-1',
    currentChapterId: null,
    inspirationCards: [] as InspirationCard[],
    storyLinks: [] as StoryLink[],
    isInspirationBusy: false,
    storylines: [] as Storyline[],
    intersectionTargets: [] as IntersectionTarget[],
    outlineSnapshots: [] as OutlineSnapshot[],
    coreDriver: null as CoreDriver | null,
    lastPacingReport: null as PacingPressureReport | null,
    lastArcIssues: [] as CharacterArcIssue[],
    lastArcCurves: [] as unknown[],
    lastCharacterEmotionReport: null,
    lastRelationshipCurve: null,
    lastReaderEmpathyReport: null as ReaderEmpathyReport | null,
    sandboxBaseline: null as SandboxTrialSnapshot | null,
    lastSandboxReport: null as SandboxTrialReport | null,
    lastOutlineReport: null,
    // actions
    addInspirationCard: vi.fn(() => ({
      id: 'card-1',
      projectId: 'proj-1',
      type: 'character',
      title: '测试',
      content: '内容',
      createdAt: new Date().toISOString(),
    })),
    updateInspirationCard: vi.fn(),
    deleteInspirationCard: vi.fn(),
    askInspirationCard: vi.fn(async () => []),
    addInspirationChildCard: vi.fn(() => null),
    createStoryLink: vi.fn(async () => null),
    deleteStoryLink: vi.fn(),
    addStoryline: vi.fn(() => null),
    updateStoryline: vi.fn(),
    deleteStoryline: vi.fn(),
    addTimelineNode: vi.fn(() => null),
    removeTimelineNode: vi.fn(),
    moveTimelineNode: vi.fn(),
    detectMultiLineConflicts: vi.fn(),
    multiLineConflicts: [] as unknown[],
    addIntersectionTarget: vi.fn(() => null),
    deleteIntersectionTarget: vi.fn(),
    checkIntersection: vi.fn(),
    runPacingPressureTest: vi.fn(async () => {}),
    updatePacingPoint: vi.fn(),
    resetPacingPoint: vi.fn(),
    requestPacingAdvice: vi.fn(async () => {}),
    applyPacingAdvice: vi.fn(),
    clearPacingAdvice: vi.fn(),
    lastPacingAdvice: null,
    getForeshadowBoardItems: vi.fn(() => [] as ForeshadowBoardItem[]),
    updateForeshadow: vi.fn(),
    foreshadowPayoffChecks: [],
    emergencyRecoveryPlans: [],
    runForeshadowPayoffCheck: vi.fn(async () => {}),
    generateRecoveryPlan: vi.fn(async () => {}),
    clearForeshadowChecks: vi.fn(),
    compareSnapshots: vi.fn(() => null),
    runCharacterArcCheck: vi.fn(async () => {}),
    runCharacterEmotionConsistencyCheck: vi.fn(async () => {}),
    analyzeRelationship: vi.fn(async () => {}),
    runReaderEmpathyCheck: vi.fn(async () => {}),
    captureSandboxBaseline: vi.fn(),
    clearSandboxBaseline: vi.fn(),
    restoreSandboxBaseline: vi.fn(),
    runSandboxVerification: vi.fn(async () => {}),
    saveOutlineSnapshot: vi.fn(() => null),
    deleteOutlineSnapshot: vi.fn(),
    restoreOutlineSnapshot: vi.fn(),
    lockCoreDriver: vi.fn(),
    unlockCoreDriver: vi.fn(),
    setCurrentChapter: vi.fn(),
  };
}

function setMockState(overrides: Record<string, unknown> = {}) {
  mockStateRef.current = { ...buildDefaultState(), ...overrides };
}

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'c-1',
    projectId: 'proj-1',
    parentId: null,
    title: '第一章',
    summary: '章节摘要',
    order: 1,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 1000,
    content: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Chapter;
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'proj-1',
    name: '主角',
    role: 'protagonist',
    color: '#3b82f6',
    profile: {},
    relationships: [],
    appearanceCount: 1,
    dialogueCount: 0,
    tags: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'f-1',
    projectId: 'proj-1',
    title: '神秘伏笔',
    description: '',
    status: 'planted',
    plantedChapterId: 'c-1',
    payoffChapterId: null,
    priority: 'medium',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 3,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeInspirationCard(overrides: Partial<InspirationCard> = {}): InspirationCard {
  return {
    id: 'ic-1',
    projectId: 'proj-1',
    type: 'concept',
    title: '灵感标题',
    content: '灵感内容',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStoryline(overrides: Partial<Storyline> = {}): Storyline {
  return {
    id: 'sl-1',
    projectId: 'proj-1',
    type: 'protagonist',
    name: '主角复仇线',
    color: '#3b82f6',
    nodes: [],
    ...overrides,
  };
}

function makeBoardItem(overrides: Partial<ForeshadowBoardItem> = {}): ForeshadowBoardItem {
  return {
    foreshadowId: 'f-1',
    title: '神秘伏笔',
    group: 'pending',
    plantedChapterTitle: '第一章',
    payoffChapterTitle: undefined,
    overdueChapters: 0,
    priority: 'medium',
    relatedCharacters: [],
    ...overrides,
  };
}

function makePacingReport(
  overrides: Partial<PacingPressureReport> = {},
): PacingPressureReport {
  return {
    generatedAt: '2025-01-01T00:00:00.000Z',
    scope: 'all',
    points: [
      {
        chapterId: 'c-1',
        chapterTitle: '第一章',
        external: 60,
        emotional: 40,
        isBuffer: false,
        total: 100,
      },
      {
        chapterId: 'c-2',
        chapterTitle: '第二章',
        external: 20,
        emotional: 10,
        isBuffer: true,
        total: 30,
      },
    ],
    issues: [
      {
        id: 'pi-1',
        type: 'low-streak',
        chapterIds: ['c-2'],
        description: '连续 3 章低能量',
        suggestion: '插入一个外部冲突提升节奏',
        severity: 'warning',
      },
    ],
    ...overrides,
  };
}

function makeArcIssue(overrides: Partial<CharacterArcIssue> = {}): CharacterArcIssue {
  return {
    id: 'ai-1',
    characterId: 'char-1',
    characterName: '主角',
    type: 'personality-break',
    chapterId: 'c-1',
    chapterTitle: '第一章',
    description: '性格突变：从冷静变为暴躁',
    suggestion: '补充前置铺垫章节',
    severity: 'warning',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<OutlineSnapshot> = {}): OutlineSnapshot {
  return {
    id: 'snap-1',
    projectId: 'proj-1',
    createdAt: '2025-01-01T10:00:00.000Z',
    label: '第一轮打磨',
    chapters: [
      {
        id: 'c-1',
        parentId: null,
        order: 1,
        level: 1,
        levelType: 'chapter',
        title: '第一章',
        summary: '',
      },
    ],
    ...overrides,
  };
}

function makeDiffReport(overrides: Partial<VersionDiffReport> = {}): VersionDiffReport {
  return {
    oldSnapshotId: 'snap-1',
    newSnapshotId: 'snap-2',
    generatedAt: '2025-01-02T10:00:00.000Z',
    diffs: [
      {
        field: '第一章',
        oldValue: '旧标题',
        newValue: '新标题',
        changeType: 'modified',
      },
      {
        field: '第二章',
        oldValue: '',
        newValue: '新增章节',
        changeType: 'added',
      },
      {
        field: '第三章',
        oldValue: '被删除的章节',
        newValue: '',
        changeType: 'removed',
      },
    ],
    ...overrides,
  };
}

function makeRelationshipCurve(
  overrides: Partial<RelationshipTemperatureCurve> = {},
): RelationshipTemperatureCurve {
  return {
    characterAId: 'char-1',
    characterBId: 'char-2',
    points: [
      { chapterId: 'c-1', chapterTitle: '第一章', temperature: 80, note: '亲密' },
      { chapterId: 'c-2', chapterTitle: '第二章', temperature: 40, note: '中立' },
      { chapterId: 'c-3', chapterTitle: '第三章', temperature: 20, note: '敌对' },
    ],
    jumps: [
      {
        chapterId: 'c-2',
        chapterTitle: '第二章',
        fromTemp: 80,
        toTemp: 40,
        description: '关系骤降',
      },
    ],
    ...overrides,
  };
}

function makeReaderEmpathyReport(
  overrides: Partial<ReaderEmpathyReport> = {},
): ReaderEmpathyReport {
  return {
    generatedAt: '2025-01-01T00:00:00.000Z',
    scope: 'all',
    overallScore: 55,
    points: [
      {
        chapterId: 'c-1',
        chapterTitle: '第一章',
        motivation: 60,
        emotion: 40,
        stakes: 50,
        total: 50,
      },
      {
        chapterId: 'c-2',
        chapterTitle: '第二章',
        motivation: 80,
        emotion: 70,
        stakes: 60,
        total: 70,
      },
    ],
    issues: [
      {
        id: 'ei-1',
        type: 'emotion-flat',
        chapterId: 'c-1',
        chapterTitle: '第一章',
        description: '第一章 情感冲击力不足，关键场景未能唤起读者情绪',
        suggestion: '强化场景的感官描写与角色生理反应',
        severity: 'warning',
      },
      {
        id: 'ei-2',
        type: 'motivation-gap',
        chapterId: 'c-2',
        chapterTitle: '第二章',
        description: '第二章 主角行为缺乏可理解的动机',
        suggestion: '补一句主角的内心独白点明动机',
        severity: 'error',
      },
    ],
    ...overrides,
  };
}

function makeSandboxSnapshot(
  overrides: Partial<SandboxTrialSnapshot> = {},
): SandboxTrialSnapshot {
  return {
    capturedAt: '2025-01-01T00:00:00.000Z',
    totalIssues: 2,
    errorCount: 1,
    warningCount: 1,
    threeActRatio: [25, 50, 25],
    totalChapters: 3,
    totalWords: 3000,
    issueDigests: [
      {
        id: 'd-1',
        dimension: 'structure',
        severity: 'error',
        description: '结构断裂',
        chapterId: 'c-1',
        chapterTitle: '第一章',
      },
      {
        id: 'd-2',
        dimension: 'pacing',
        severity: 'warning',
        description: '节奏拖沓',
        chapterId: 'c-2',
        chapterTitle: '第二章',
      },
    ],
    pacingMean: 50,
    pacingVariance: 25,
    characterArcRiskCount: 1,
    foreshadowStats: [2, 1, 1, 0],
    foreshadowRecoveryRate: 25,
    logicIssueCount: 1,
    avgHookStrength: 3.2,
    ...overrides,
  };
}

function makeSandboxReport(
  overrides: Partial<SandboxTrialReport> = {},
): SandboxTrialReport {
  const before = makeSandboxSnapshot();
  const after = makeSandboxSnapshot({
    totalIssues: 1,
    errorCount: 0,
    warningCount: 1,
    issueDigests: [
      {
        id: 'd-2',
        dimension: 'pacing',
        severity: 'warning',
        description: '节奏拖沓',
        chapterId: 'c-2',
        chapterTitle: '第二章',
      },
    ],
  });
  return {
    generatedAt: '2025-01-02T00:00:00.000Z',
    before,
    after,
    resolvedIssues: [
      {
        id: 'd-1',
        dimension: 'structure',
        severity: 'error',
        description: '结构断裂',
        chapterId: 'c-1',
        chapterTitle: '第一章',
      },
    ],
    newIssues: [],
    remainingIssues: [
      {
        id: 'd-2',
        dimension: 'pacing',
        severity: 'warning',
        description: '节奏拖沓',
        chapterId: 'c-2',
        chapterTitle: '第二章',
      },
    ],
    metricDeltas: [
      { label: '问题总数', before: 2, after: 1, direction: 'down', positive: true },
      { label: '必修问题', before: 1, after: 0, direction: 'down', positive: true },
      { label: '建议问题', before: 1, after: 1, direction: 'same', positive: true },
      { label: '章节数', before: 3, after: 3, direction: 'same', positive: true },
      { label: '总字数', before: 3000, after: 3000, direction: 'same', positive: true },
      { label: '三幕比例', before: '25 / 50 / 25', after: '25 / 50 / 25', direction: 'same', positive: true },
    ],
    verdict: 'improved',
    ...overrides,
  };
}

// ============================================================================
// InspirationPanel
// ============================================================================
describe('InspirationPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('渲染默认空状态（灵感池 tab）', () => {
    render(<InspirationPanel />);
    // 默认 capture tab：顶部操作栏 + 空态提示
    expect(screen.getByText('新建灵感')).toBeInTheDocument();
    expect(screen.getByText(/还没有灵感碎片/)).toBeInTheDocument();
    // tab 切换按钮
    expect(screen.getByText('碎片捕获 · 卡片促活')).toBeInTheDocument();
    expect(screen.getByText('连线沙盘')).toBeInTheDocument();
  });

  it('切换到沙盘 tab 显示连线沙盘', () => {
    render(<InspirationPanel />);
    fireEvent.click(screen.getByText('连线沙盘'));
    // sandbox tab：已建立的叙事脉络标题
    expect(screen.getByText(/已建立的叙事脉络/)).toBeInTheDocument();
    // 无连线时显示空态
    expect(screen.getByText(/还没有连线/)).toBeInTheDocument();
  });

  it('点击新建灵感按钮展开表单', () => {
    render(<InspirationPanel />);
    fireEvent.click(screen.getByText('新建灵感'));
    // 表单展开：标题输入框 + 创建按钮
    expect(screen.getByPlaceholderText('一句话标题（保留你的原始语气）')).toBeInTheDocument();
    expect(screen.getByText('创建')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('填写表单点击创建调用 addInspirationCard', () => {
    const addInspirationCard = vi.fn(() => ({
      id: 'card-new',
      projectId: 'proj-1',
      type: 'concept',
      title: '新灵感',
      content: '新内容',
      createdAt: new Date().toISOString(),
    }));
    setMockState({ addInspirationCard });
    render(<InspirationPanel />);
    fireEvent.click(screen.getByText('新建灵感'));
    fireEvent.change(screen.getByPlaceholderText('一句话标题（保留你的原始语气）'), {
      target: { value: '新灵感' },
    });
    fireEvent.change(screen.getByPlaceholderText(/详细内容/), {
      target: { value: '新内容' },
    });
    fireEvent.click(screen.getByText('创建'));
    expect(addInspirationCard).toHaveBeenCalledWith({
      type: 'concept',
      title: '新灵感',
      content: '新内容',
    });
  });

  it('有灵感卡时点击卡片选中并显示详情', () => {
    setMockState({
      inspirationCards: [
        makeInspirationCard({
          id: 'ic-1',
          type: 'concept',
          title: '高概念卡',
          content: '详细内容',
        }),
      ],
    });
    render(<InspirationPanel />);
    // 列表中渲染卡片
    expect(screen.getByText('高概念卡')).toBeInTheDocument();
    // 点击卡片选中
    fireEvent.click(screen.getByText('高概念卡'));
    // 详情区显示标题 + 内容 + 深度提问入口
    expect(screen.getAllByText('高概念卡').length).toBeGreaterThan(1);
    // 内容同时出现在列表预览和详情区（getAllByText 容忍多匹配）
    expect(screen.getAllByText('详细内容').length).toBeGreaterThan(0);
    expect(screen.getByText('深度提问')).toBeInTheDocument();
  });
});

// ============================================================================
// CoreDriverLockPanel
// ============================================================================
describe('CoreDriverLockPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('未锁定状态显示三选一卡片', () => {
    render(<CoreDriverLockPanel />);
    expect(screen.getByText('人物驱动型')).toBeInTheDocument();
    expect(screen.getByText('情节驱动型')).toBeInTheDocument();
    expect(screen.getByText('主题驱动型')).toBeInTheDocument();
    // 每张卡片均有"锁定此方向"按钮
    expect(screen.getAllByText('锁定此方向').length).toBe(3);
  });

  it('已锁定状态显示核心驱动信息', () => {
    setMockState({
      coreDriver: {
        type: 'character',
        description: '主角从逃避到直面代价的弧光',
        lockedAt: '2025-01-01T10:00:00.000Z',
        note: '首轮锁定',
      },
    });
    render(<CoreDriverLockPanel />);
    expect(screen.getByText('核心驱动已锁定')).toBeInTheDocument();
    expect(screen.getByText('人物驱动型')).toBeInTheDocument();
    expect(screen.getByText('主角从逃避到直面代价的弧光')).toBeInTheDocument();
    expect(screen.getByText('解锁重选')).toBeInTheDocument();
    expect(screen.getByText(/备注：首轮锁定/)).toBeInTheDocument();
  });

  it('点击锁定按钮调用 lockCoreDriver', () => {
    render(<CoreDriverLockPanel />);
    // 在人物驱动卡片的 textarea 中输入描述
    const textarea = screen.getByPlaceholderText(/弧光描述/);
    fireEvent.change(textarea, { target: { value: '主角弧光描述' } });
    // 三张卡片各有一个"锁定此方向"按钮，点击第一个（人物驱动）
    fireEvent.click(screen.getAllByText('锁定此方向')[0]);
    expect(useAppStore.getState().lockCoreDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'character',
        description: '主角弧光描述',
      }),
    );
  });

  it('点击解锁按钮（confirm 确认）调用 unlockCoreDriver', () => {
    const unlockCoreDriver = vi.fn();
    setMockState({
      coreDriver: {
        type: 'character',
        description: '锁定描述',
        lockedAt: '2025-01-01T10:00:00.000Z',
      },
      unlockCoreDriver,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CoreDriverLockPanel />);
    fireEvent.click(screen.getByText('解锁重选'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(unlockCoreDriver).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

// ============================================================================
// MultiLineCommandPanel
// ============================================================================
describe('MultiLineCommandPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('空状态显示添加故事线提示', () => {
    render(<MultiLineCommandPanel />);
    expect(screen.getByText('添加故事线')).toBeInTheDocument();
    expect(screen.getByText(/还没有故事线/)).toBeInTheDocument();
    // 时间轴对齐视图空态
    expect(screen.getByText('时间轴对齐视图')).toBeInTheDocument();
    expect(screen.getByText('先添加故事线，再在此对齐章节节点')).toBeInTheDocument();
  });

  it('有故事线时显示时间轴对齐视图', () => {
    setMockState({
      storylines: [
        makeStoryline({ id: 'sl-1', name: '主角复仇线' }),
        makeStoryline({ id: 'sl-2', name: '反派布局线', type: 'antagonist' }),
      ],
      chapters: [
        makeChapter({ id: 'c-1', title: '第一章', order: 1 }),
        makeChapter({ id: 'c-2', title: '第二章', order: 2 }),
      ],
    });
    render(<MultiLineCommandPanel />);
    // 故事线名在列表和时间轴行中均出现（各 2 次）
    expect(screen.getAllByText('主角复仇线').length).toBe(2);
    expect(screen.getAllByText('反派布局线').length).toBe(2);
    // 时间轴对齐视图渲染（章节列表头）
    expect(screen.getByText('章节＼线索')).toBeInTheDocument();
    // 故事线节点数显示
    expect(screen.getAllByText('0 节点').length).toBe(2);
  });

  it('添加故事线表单提交调用 addStoryline', () => {
    const addStoryline = vi.fn(() => null);
    setMockState({ addStoryline });
    render(<MultiLineCommandPanel />);
    fireEvent.click(screen.getByText('添加故事线'));
    fireEvent.change(screen.getByPlaceholderText(/故事线名称/), {
      target: { value: '新故事线' },
    });
    fireEvent.click(screen.getByText('创建'));
    expect(addStoryline).toHaveBeenCalledWith({
      type: 'protagonist',
      name: '新故事线',
    });
  });

  it('点击时间轴格子调用 addTimelineNode', () => {
    const addTimelineNode = vi.fn(() => null);
    setMockState({
      addTimelineNode,
      storylines: [makeStoryline({ id: 'sl-1', name: '主线' })],
      chapters: [makeChapter({ id: 'c-1', title: '第一章', order: 1 })],
    });
    render(<MultiLineCommandPanel />);
    // 时间轴格子 button（空格子，title 含"点击添加节点"）
    const cell = screen.getByTitle(/点击添加节点/);
    fireEvent.click(cell);
    expect(addTimelineNode).toHaveBeenCalledWith('sl-1', 'c-1');
  });
});

// ============================================================================
// PacingPressurePanel
// ============================================================================
describe('PacingPressurePanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('空状态显示运行节奏检测提示', () => {
    render(<PacingPressurePanel />);
    expect(screen.getByText('运行节奏检测')).toBeInTheDocument();
    expect(screen.getByText('点击上方按钮运行节奏检测')).toBeInTheDocument();
  });

  it('有报告时显示节奏曲线', () => {
    setMockState({ lastPacingReport: makePacingReport() });
    render(<PacingPressurePanel />);
    expect(screen.getByText('节奏能量曲线')).toBeInTheDocument();
    // 图例
    expect(screen.getByText('外部能量')).toBeInTheDocument();
    expect(screen.getByText('情感能量')).toBeInTheDocument();
    expect(screen.getByText('缓冲段')).toBeInTheDocument();
    // 问题清单
    expect(screen.getByText(/节奏问题（1）/)).toBeInTheDocument();
    expect(screen.getByText('连续低能量')).toBeInTheDocument();
    expect(screen.getByText('连续 3 章低能量')).toBeInTheDocument();
  });

  it('点击运行节奏检测调用 runPacingPressureTest', async () => {
    const runPacingPressureTest = vi.fn(async () => {});
    setMockState({ runPacingPressureTest });
    render(<PacingPressurePanel />);
    fireEvent.click(screen.getByText('运行节奏检测'));
    await waitFor(() => expect(runPacingPressureTest).toHaveBeenCalledWith('all'));
  });

  it('点击柱子展开调校面板，显示滑块与缓冲段勾选', () => {
    setMockState({ lastPacingReport: makePacingReport() });
    render(<PacingPressurePanel />);
    // 初始无调校面板
    expect(screen.queryByTestId('pacing-adjuster')).not.toBeInTheDocument();
    // 点击第一根柱子
    fireEvent.click(screen.getByTestId('pacing-bar-c-1'));
    // 调校面板出现
    expect(screen.getByTestId('pacing-adjuster')).toBeInTheDocument();
    // 两个滑块
    expect(screen.getByTestId('pacing-slider-外部能量')).toBeInTheDocument();
    expect(screen.getByTestId('pacing-slider-情感能量')).toBeInTheDocument();
    // 缓冲段勾选
    expect(screen.getByText('标记为缓冲段（日常过渡/信息铺垫/文戏）')).toBeInTheDocument();
  });

  it('拖动外部能量滑块调用 updatePacingPoint', () => {
    const updatePacingPoint = vi.fn();
    setMockState({ lastPacingReport: makePacingReport(), updatePacingPoint });
    render(<PacingPressurePanel />);
    fireEvent.click(screen.getByTestId('pacing-bar-c-1'));
    // 拖动外部能量滑块到 80
    fireEvent.change(screen.getByTestId('pacing-slider-外部能量'), { target: { value: '80' } });
    expect(updatePacingPoint).toHaveBeenCalledWith('c-1', { external: 80 });
  });

  it('拖动情感能量滑块调用 updatePacingPoint', () => {
    const updatePacingPoint = vi.fn();
    setMockState({ lastPacingReport: makePacingReport(), updatePacingPoint });
    render(<PacingPressurePanel />);
    fireEvent.click(screen.getByTestId('pacing-bar-c-1'));
    fireEvent.change(screen.getByTestId('pacing-slider-情感能量'), { target: { value: '55' } });
    expect(updatePacingPoint).toHaveBeenCalledWith('c-1', { emotional: 55 });
  });

  it('点击清零按钮调用 resetPacingPoint', () => {
    const resetPacingPoint = vi.fn();
    setMockState({ lastPacingReport: makePacingReport(), resetPacingPoint });
    render(<PacingPressurePanel />);
    fireEvent.click(screen.getByTestId('pacing-bar-c-1'));
    fireEvent.click(screen.getByText('清零'));
    expect(resetPacingPoint).toHaveBeenCalledWith('c-1');
  });

  it('再次点击同根柱子收起调校面板', () => {
    setMockState({ lastPacingReport: makePacingReport() });
    render(<PacingPressurePanel />);
    fireEvent.click(screen.getByTestId('pacing-bar-c-1'));
    expect(screen.getByTestId('pacing-adjuster')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pacing-bar-c-1'));
    expect(screen.queryByTestId('pacing-adjuster')).not.toBeInTheDocument();
  });
});

// ============================================================================
// ForeshadowBoardPanel
// ============================================================================
describe('ForeshadowBoardPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('空状态显示无伏笔提示', () => {
    render(<ForeshadowBoardPanel />);
    expect(screen.getByText('暂无伏笔')).toBeInTheDocument();
    // StatsBar 仍渲染（四栏计数为 0）
    expect(screen.getAllByText('待回收').length).toBeGreaterThan(0);
    expect(screen.getAllByText('推进中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已回收').length).toBeGreaterThan(0);
    expect(screen.getAllByText('逾期未回收').length).toBeGreaterThan(0);
  });

  it('有伏笔时显示四栏看板', () => {
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-1', title: '神秘伏笔' }),
        makeForeshadow({ id: 'f-2', title: '已回收伏笔', status: 'paid-off' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({
          foreshadowId: 'f-1',
          title: '神秘伏笔',
          group: 'pending',
          priority: 'high',
        }),
        makeBoardItem({
          foreshadowId: 'f-2',
          title: '已回收伏笔',
          group: 'paidoff',
          priority: 'medium',
        }),
        makeBoardItem({
          foreshadowId: 'f-3',
          title: '逾期伏笔',
          group: 'overdue',
          overdueChapters: 5,
          priority: 'high',
        }),
      ]),
    });
    render(<ForeshadowBoardPanel />);
    // 四栏标题在 StatsBar 与 BoardColumn 中各出现一次（共 2 次）
    expect(screen.getAllByText('待回收').length).toBe(2);
    expect(screen.getAllByText('推进中').length).toBe(2);
    expect(screen.getAllByText('已回收').length).toBe(2);
    expect(screen.getAllByText('逾期未回收').length).toBe(2);
    // 三张卡片（标题唯一）
    expect(screen.getByText('神秘伏笔')).toBeInTheDocument();
    expect(screen.getByText('已回收伏笔')).toBeInTheDocument();
    expect(screen.getByText('逾期伏笔')).toBeInTheDocument();
    // 逾期标记
    expect(screen.getByText('逾期 5 章')).toBeInTheDocument();
  });

  it('点击伏笔卡片调用 useAppStore.setState 设置 currentChapterId', () => {
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-1', title: '神秘伏笔', plantedChapterId: 'c-1' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({ foreshadowId: 'f-1', title: '神秘伏笔', group: 'pending' }),
      ]),
    });
    render(<ForeshadowBoardPanel />);
    // 点击卡片（title=点击跳转到埋设章节，拖拽切换状态）
    fireEvent.click(screen.getByTitle('点击跳转到埋设章节，拖拽切换状态'));
    // handleCardClick 调用 useAppStore.setState({ currentChapterId: 'c-1' })
    expect(useAppStore.getState().currentChapterId).toBe('c-1');
  });

  it('切换优先级筛选过滤卡片', () => {
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-1', title: '高优先伏笔' }),
        makeForeshadow({ id: 'f-2', title: '低优先伏笔' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({ foreshadowId: 'f-1', title: '高优先伏笔', group: 'pending', priority: 'high' }),
        makeBoardItem({ foreshadowId: 'f-2', title: '低优先伏笔', group: 'pending', priority: 'low' }),
      ]),
    });
    render(<ForeshadowBoardPanel />);
    // 初始：两张卡片均可见
    expect(screen.getByText('高优先伏笔')).toBeInTheDocument();
    expect(screen.getByText('低优先伏笔')).toBeInTheDocument();
    // 选择"高"优先级筛选
    fireEvent.change(screen.getByDisplayValue('全部等级'), { target: { value: 'high' } });
    // 仅高优先伏笔可见，低优先伏笔被过滤
    expect(screen.getByText('高优先伏笔')).toBeInTheDocument();
    expect(screen.queryByText('低优先伏笔')).not.toBeInTheDocument();
  });

  it('拖拽卡片到「推进中」列调用 updateForeshadow 设置 status=progressing', () => {
    const updateForeshadow = vi.fn();
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-1', title: '神秘伏笔', status: 'planted' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({ foreshadowId: 'f-1', title: '神秘伏笔', group: 'pending' }),
      ]),
      updateForeshadow,
    });
    render(<ForeshadowBoardPanel />);
    // 卡片初始在 pending 列
    const card = screen.getByTestId('foreshadow-card-f-1');
    const targetColumn = screen.getByTestId('board-column-progressing');
    // 模拟拖拽：dragStart → dragOver(target) → drop
    fireEvent.dragStart(card);
    fireEvent.dragOver(targetColumn);
    fireEvent.drop(targetColumn);
    // 调用 updateForeshadow(f-1, { status: 'progressing' })
    expect(updateForeshadow).toHaveBeenCalledWith('f-1', { status: 'progressing' });
  });

  it('拖拽卡片到「已回收」列调用 updateForeshadow 设置 status=paid-off', () => {
    const updateForeshadow = vi.fn();
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-1', title: '神秘伏笔', status: 'planted' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({ foreshadowId: 'f-1', title: '神秘伏笔', group: 'pending' }),
      ]),
      updateForeshadow,
    });
    render(<ForeshadowBoardPanel />);
    const card = screen.getByTestId('foreshadow-card-f-1');
    const targetColumn = screen.getByTestId('board-column-paidoff');
    fireEvent.dragStart(card);
    fireEvent.dragOver(targetColumn);
    fireEvent.drop(targetColumn);
    expect(updateForeshadow).toHaveBeenCalledWith('f-1', { status: 'paid-off' });
  });

  it('拖拽卡片到「逾期未回收」列不调用 updateForeshadow（不可拖入）', () => {
    const updateForeshadow = vi.fn();
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-1', title: '神秘伏笔', status: 'planted' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({ foreshadowId: 'f-1', title: '神秘伏笔', group: 'pending' }),
      ]),
      updateForeshadow,
    });
    render(<ForeshadowBoardPanel />);
    const card = screen.getByTestId('foreshadow-card-f-1');
    const overdueColumn = screen.getByTestId('board-column-overdue');
    fireEvent.dragStart(card);
    fireEvent.dragOver(overdueColumn);
    fireEvent.drop(overdueColumn);
    // overdue 列不可拖入，不应调用 updateForeshadow
    expect(updateForeshadow).not.toHaveBeenCalled();
  });

  it('推进中状态的伏笔显示在推进中栏', () => {
    setMockState({
      foreshadows: [
        makeForeshadow({ id: 'f-2', title: '推进中伏笔', status: 'progressing' }),
      ],
      getForeshadowBoardItems: vi.fn(() => [
        makeBoardItem({ foreshadowId: 'f-2', title: '推进中伏笔', group: 'progressing' }),
      ]),
    });
    render(<ForeshadowBoardPanel />);
    // 推进中列包含该卡片
    const progressingColumn = screen.getByTestId('board-column-progressing');
    expect(progressingColumn).toContainElement(screen.getByText('推进中伏笔'));
  });
});

// ============================================================================
// CharacterArcCheckPanel
// ============================================================================
describe('CharacterArcCheckPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('空状态显示运行弧光校验提示', () => {
    render(<CharacterArcCheckPanel />);
    expect(screen.getByText('运行弧光校验')).toBeInTheDocument();
    expect(screen.getByText('点击上方按钮运行全本弧光校验')).toBeInTheDocument();
    // 关系温度计子区始终渲染
    expect(screen.getByText('关系温度计')).toBeInTheDocument();
    expect(screen.getByText('分析关系')).toBeInTheDocument();
  });

  it('有弧光问题时显示问题列表', () => {
    setMockState({
      characters: [makeCharacter({ id: 'char-1', name: '主角' })],
      lastArcIssues: [
        makeArcIssue({
          id: 'ai-1',
          characterId: 'char-1',
          characterName: '主角',
          type: 'personality-break',
          description: '性格突变：从冷静变为暴躁',
          suggestion: '补充前置铺垫章节',
        }),
      ],
    });
    render(<CharacterArcCheckPanel />);
    expect(screen.getByText(/弧光问题（1）/)).toBeInTheDocument();
    expect(screen.getByText('性格突变')).toBeInTheDocument();
    expect(screen.getByText('性格突变：从冷静变为暴躁')).toBeInTheDocument();
    expect(screen.getByText('补充前置铺垫章节')).toBeInTheDocument();
  });

  it('点击运行弧光校验调用 runCharacterArcCheck', async () => {
    const runCharacterArcCheck = vi.fn(async () => {});
    setMockState({ runCharacterArcCheck });
    render(<CharacterArcCheckPanel />);
    fireEvent.click(screen.getByText('运行弧光校验'));
    await waitFor(() => expect(runCharacterArcCheck).toHaveBeenCalled());
  });

  it('点击弧光问题章节跳转调用 setCurrentChapter', () => {
    const setCurrentChapter = vi.fn();
    setMockState({
      characters: [makeCharacter({ id: 'char-1', name: '主角' })],
      lastArcIssues: [
        makeArcIssue({
          id: 'ai-1',
          characterId: 'char-1',
          characterName: '主角',
          chapterId: 'c-1',
          chapterTitle: '第一章',
          type: 'personality-break',
          description: '性格突变',
          suggestion: '补充铺垫',
        }),
      ],
      setCurrentChapter,
    });
    render(<CharacterArcCheckPanel />);
    // 问题卡片中的章节跳转按钮（title=跳转到该章节）
    fireEvent.click(screen.getByTitle('跳转到该章节'));
    expect(setCurrentChapter).toHaveBeenCalledWith('c-1');
  });

  it('选择两角色点击分析关系调用 analyzeRelationship', async () => {
    const analyzeRelationship = vi.fn(async () => {});
    setMockState({
      characters: [
        makeCharacter({ id: 'char-1', name: '主角' }),
        makeCharacter({ id: 'char-2', name: '反派' }),
      ],
      analyzeRelationship,
    });
    render(<CharacterArcCheckPanel />);
    // 选择角色 A 和 B
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'char-1' } });
    fireEvent.change(selects[1], { target: { value: 'char-2' } });
    fireEvent.click(screen.getByText('分析关系'));
    await waitFor(() => expect(analyzeRelationship).toHaveBeenCalledWith('char-1', 'char-2'));
  });

  it('有关系曲线时渲染 RelationshipCurveView 温度图', () => {
    setMockState({
      characters: [
        makeCharacter({ id: 'char-1', name: '主角' }),
        makeCharacter({ id: 'char-2', name: '反派' }),
      ],
      lastRelationshipCurve: makeRelationshipCurve(),
    });
    const { container } = render(<CharacterArcCheckPanel />);
    // SVG 温度曲线渲染
    expect(container.querySelector('svg')).toBeInTheDocument();
    // 角色名标题
    expect(screen.getByText(/主角 ↔ 反派/)).toBeInTheDocument();
    // 温度图例（亲密/中立/敌对 三色带）
    expect(screen.getByText(/亲密 \(70-100\)/)).toBeInTheDocument();
    expect(screen.getByText(/敌对 \(0-30\)/)).toBeInTheDocument();
    // 关系跳转问题区标题（跳转描述文本跨 span，用区标题断言）
    expect(screen.getByText(/温度跳转（1）/)).toBeInTheDocument();
  });
});

// ============================================================================
// VersionDiffPanel
// ============================================================================
describe('VersionDiffPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('空状态显示保存快照提示', () => {
    render(<VersionDiffPanel />);
    // 顶部保存快照区："保存当前为快照" 同时作为 Section 标题和按钮文本出现
    expect(screen.getAllByText('保存当前为快照').length).toBeGreaterThanOrEqual(1);
    // 无章节时按钮 disabled
    expect(screen.getByRole('button', { name: /保存当前为快照/ })).toBeDisabled();
    expect(screen.getByText('当前项目暂无大纲节点，无法保存快照')).toBeInTheDocument();
    // 快照管理区空态
    expect(screen.getByText('暂无快照')).toBeInTheDocument();
  });

  it('有快照时显示快照列表', () => {
    setMockState({
      chapters: [makeChapter()],
      outlineSnapshots: [
        makeSnapshot({ id: 'snap-1', label: '第一轮打磨' }),
        makeSnapshot({ id: 'snap-2', label: '第二轮打磨' }),
      ],
    });
    render(<VersionDiffPanel />);
    // 保存按钮可点击（有章节）
    expect(screen.getByRole('button', { name: /保存当前为快照/ })).not.toBeDisabled();
    // 快照列表
    expect(screen.getByText('第一轮打磨')).toBeInTheDocument();
    expect(screen.getByText('第二轮打磨')).toBeInTheDocument();
    // 节点数显示
    expect(screen.getAllByText(/1 个节点/).length).toBe(2);
    // 恢复 / 删除按钮（每个快照各一组）
    expect(screen.getAllByTitle('恢复结构（不影响正文）').length).toBe(2);
    expect(screen.getAllByTitle('删除快照').length).toBe(2);
  });

  it('点击保存快照展开表单提交调用 saveOutlineSnapshot', () => {
    const saveOutlineSnapshot = vi.fn(() => null);
    setMockState({
      chapters: [makeChapter()],
      saveOutlineSnapshot,
    });
    render(<VersionDiffPanel />);
    // 点击"保存当前为快照"按钮展开输入框
    fireEvent.click(screen.getByRole('button', { name: /保存当前为快照/ }));
    // 输入标签
    fireEvent.change(screen.getByPlaceholderText(/快照标签/), {
      target: { value: '测试快照' },
    });
    // 点击"保存"按钮
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(saveOutlineSnapshot).toHaveBeenCalledWith('测试快照');
  });

  it('选择两个快照点击生成对比调用 compareSnapshots 并渲染 DiffView', () => {
    const compareSnapshots = vi.fn(() => makeDiffReport());
    setMockState({
      chapters: [makeChapter()],
      outlineSnapshots: [
        makeSnapshot({ id: 'snap-1', label: '第一轮' }),
        makeSnapshot({ id: 'snap-2', label: '第二轮' }),
      ],
      compareSnapshots,
    });
    render(<VersionDiffPanel />);
    // 双栏对比区出现（>=2 快照）
    expect(screen.getByText('生成对比')).toBeInTheDocument();
    // 选择旧版本和新版本（两个 select）
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'snap-1' } });
    fireEvent.change(selects[1], { target: { value: 'snap-2' } });
    fireEvent.click(screen.getByText('生成对比'));
    expect(compareSnapshots).toHaveBeenCalledWith('snap-1', 'snap-2');
    // DiffView 渲染：差异计数 + 变更类型徽章
    expect(screen.getByText(/共 3 项差异/)).toBeInTheDocument();
    expect(screen.getByText('新增')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    expect(screen.getByText('修改')).toBeInTheDocument();
  });

  it('点击恢复快照 confirm 确认后调用 restoreOutlineSnapshot', () => {
    const restoreOutlineSnapshot = vi.fn();
    setMockState({
      chapters: [makeChapter()],
      outlineSnapshots: [makeSnapshot({ id: 'snap-1', label: '第一轮' })],
      restoreOutlineSnapshot,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<VersionDiffPanel />);
    fireEvent.click(screen.getAllByTitle('恢复结构（不影响正文）')[0]);
    expect(confirmSpy).toHaveBeenCalled();
    expect(restoreOutlineSnapshot).toHaveBeenCalledWith('snap-1');
    confirmSpy.mockRestore();
  });

  it('点击删除快照 confirm 确认后调用 deleteOutlineSnapshot', () => {
    const deleteOutlineSnapshot = vi.fn();
    setMockState({
      chapters: [makeChapter()],
      outlineSnapshots: [makeSnapshot({ id: 'snap-1', label: '第一轮' })],
      deleteOutlineSnapshot,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<VersionDiffPanel />);
    fireEvent.click(screen.getAllByTitle('删除快照')[0]);
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteOutlineSnapshot).toHaveBeenCalledWith('snap-1');
    confirmSpy.mockRestore();
  });

  it('对比结果无差异时显示完全一致提示', () => {
    const compareSnapshots = vi.fn(() => makeDiffReport({ diffs: [] }));
    setMockState({
      chapters: [makeChapter()],
      outlineSnapshots: [
        makeSnapshot({ id: 'snap-1', label: '第一轮' }),
        makeSnapshot({ id: 'snap-2', label: '第二轮' }),
      ],
      compareSnapshots,
    });
    render(<VersionDiffPanel />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'snap-1' } });
    fireEvent.change(selects[1], { target: { value: 'snap-2' } });
    fireEvent.click(screen.getByText('生成对比'));
    expect(screen.getByText('两个快照结构完全一致，无差异')).toBeInTheDocument();
  });
});

// ============================================================================
// ReaderEmpathyCheckPanel
// ============================================================================
describe('ReaderEmpathyCheckPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('渲染默认空状态', () => {
    render(<ReaderEmpathyCheckPanel />);
    expect(screen.getByText('读者共情校验')).toBeInTheDocument();
    expect(screen.getByText('点击上方按钮运行读者共情校验')).toBeInTheDocument();
    expect(screen.getByText('运行共情校验')).toBeInTheDocument();
  });

  it('点击运行按钮调用 runReaderEmpathyCheck', () => {
    const runReaderEmpathyCheck = vi.fn(async () => {});
    setMockState({ runReaderEmpathyCheck });
    render(<ReaderEmpathyCheckPanel />);
    fireEvent.click(screen.getByText('运行共情校验'));
    expect(runReaderEmpathyCheck).toHaveBeenCalledWith('all');
  });

  it('切换 scope 下拉后调用时传入选中章节 ID', () => {
    const runReaderEmpathyCheck = vi.fn(async () => {});
    setMockState({
      runReaderEmpathyCheck,
      chapters: [makeChapter({ id: 'c-1', title: '第一章' })],
    });
    render(<ReaderEmpathyCheckPanel />);
    const select = screen.getByDisplayValue('全量大纲');
    fireEvent.change(select, { target: { value: 'c-1' } });
    fireEvent.click(screen.getByText('运行共情校验'));
    expect(runReaderEmpathyCheck).toHaveBeenCalledWith('c-1');
  });

  it('有报告时渲染三维柱状图与共情评分', () => {
    setMockState({
      lastReaderEmpathyReport: makeReaderEmpathyReport(),
    });
    render(<ReaderEmpathyCheckPanel />);
    expect(screen.getByText('共情强度曲线')).toBeInTheDocument();
    expect(screen.getByText('共情问题（2）')).toBeInTheDocument();
    // 评分徽章（overallScore=55 → 共情待加强）
    expect(screen.getByText('共情待加强')).toBeInTheDocument();
    // 两个章节柱
    expect(screen.getByTestId('empathy-bar-c-1')).toBeInTheDocument();
    expect(screen.getByTestId('empathy-bar-c-2')).toBeInTheDocument();
  });

  it('报告无问题时显示未检测到共情问题', () => {
    setMockState({
      lastReaderEmpathyReport: makeReaderEmpathyReport({ issues: [] }),
    });
    render(<ReaderEmpathyCheckPanel />);
    expect(screen.getByText('未检测到共情问题')).toBeInTheDocument();
  });

  it('问题卡片显示类型标签与建议', () => {
    setMockState({
      lastReaderEmpathyReport: makeReaderEmpathyReport(),
    });
    render(<ReaderEmpathyCheckPanel />);
    expect(screen.getByText('情感扁平')).toBeInTheDocument();
    expect(screen.getByText('动机断层')).toBeInTheDocument();
    expect(screen.getByText('强化场景的感官描写与角色生理反应')).toBeInTheDocument();
  });

  it('点击问题卡片的章节跳转按钮调用 setCurrentChapter', () => {
    const setCurrentChapter = vi.fn();
    setMockState({
      lastReaderEmpathyReport: makeReaderEmpathyReport(),
      setCurrentChapter,
    });
    render(<ReaderEmpathyCheckPanel />);
    const jumpBtns = screen.getAllByText('[第一章]');
    fireEvent.click(jumpBtns[0]);
    expect(setCurrentChapter).toHaveBeenCalledWith('c-1');
  });

  it('高分报告显示共情良好', () => {
    setMockState({
      lastReaderEmpathyReport: makeReaderEmpathyReport({ overallScore: 85 }),
    });
    render(<ReaderEmpathyCheckPanel />);
    expect(screen.getByText('共情良好')).toBeInTheDocument();
  });
});

// ============================================================================
// SandboxTrialPanel
// ============================================================================
describe('SandboxTrialPanel', () => {
  beforeEach(() => setMockState());
  afterEach(() => cleanup());

  it('无基线无报告时渲染空态引导', () => {
    render(<SandboxTrialPanel />);
    expect(screen.getByText('沙盒试运行')).toBeInTheDocument();
    expect(screen.getByText('开始试运行')).toBeInTheDocument();
    expect(screen.getByText('发现问题 → 拿到方案 → 就地修改 → 验证闭环')).toBeInTheDocument();
  });

  it('无诊断报告时"开始试运行"按钮禁用', () => {
    render(<SandboxTrialPanel />);
    expect(screen.getByText('开始试运行').closest('button')).toBeDisabled();
  });

  it('有诊断报告时点击"开始试运行"调用 captureSandboxBaseline', () => {
    const captureSandboxBaseline = vi.fn();
    setMockState({
      lastOutlineReport: { generatedAt: '', scope: 'all', projectId: 'p1', issues: [], pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0], characterArcs: [], foreshadowDensity: [], totalChapters: 0, totalWords: 0 },
      captureSandboxBaseline,
    });
    render(<SandboxTrialPanel />);
    fireEvent.click(screen.getByText('开始试运行'));
    expect(captureSandboxBaseline).toHaveBeenCalled();
  });

  it('基线已锁定时显示验证闭环与放弃按钮', () => {
    setMockState({ sandboxBaseline: makeSandboxSnapshot() });
    render(<SandboxTrialPanel />);
    // 操作栏与基线提示均含「基线已锁定」前缀，共两处
    expect(screen.getAllByText(/基线已锁定/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('验证闭环')).toBeInTheDocument();
    expect(screen.getByText('放弃')).toBeInTheDocument();
  });

  it('点击"验证闭环"调用 runSandboxVerification', async () => {
    const runSandboxVerification = vi.fn(async () => {});
    setMockState({
      sandboxBaseline: makeSandboxSnapshot(),
      runSandboxVerification,
    });
    render(<SandboxTrialPanel />);
    fireEvent.click(screen.getByText('验证闭环'));
    await waitFor(() => expect(runSandboxVerification).toHaveBeenCalledWith('all'));
  });

  it('点击"放弃"调用 clearSandboxBaseline', () => {
    const clearSandboxBaseline = vi.fn();
    setMockState({
      sandboxBaseline: makeSandboxSnapshot(),
      clearSandboxBaseline,
    });
    render(<SandboxTrialPanel />);
    fireEvent.click(screen.getByText('放弃'));
    expect(clearSandboxBaseline).toHaveBeenCalled();
  });

  it('有对比报告时渲染验证结论与指标变化', () => {
    setMockState({
      sandboxBaseline: makeSandboxSnapshot(),
      lastSandboxReport: makeSandboxReport(),
    });
    render(<SandboxTrialPanel />);
    // verdict=improved → "已改善 — 修改有效"
    expect(screen.getByText('已改善 — 修改有效')).toBeInTheDocument();
    // 指标变化区域
    expect(screen.getByText('指标变化')).toBeInTheDocument();
    expect(screen.getByText('问题总数')).toBeInTheDocument();
    // 解决 1 · 新增 0 · 仍存 1
    expect(screen.getByText(/解决 1/)).toBeInTheDocument();
  });

  it('对比报告渲染已解决/仍存在分组', () => {
    setMockState({
      sandboxBaseline: makeSandboxSnapshot(),
      lastSandboxReport: makeSandboxReport(),
    });
    render(<SandboxTrialPanel />);
    expect(screen.getByText('已解决（1）')).toBeInTheDocument();
    expect(screen.getByText('仍存在（1）')).toBeInTheDocument();
    // 已解决问题的描述（带删除线）
    expect(screen.getByText('结构断裂')).toBeInTheDocument();
    expect(screen.getByText('节奏拖沓')).toBeInTheDocument();
  });

  it('regressed 报告显示退步结论', () => {
    setMockState({
      sandboxBaseline: makeSandboxSnapshot(),
      lastSandboxReport: makeSandboxReport({ verdict: 'regressed' }),
    });
    render(<SandboxTrialPanel />);
    expect(screen.getByText('已退步 — 需复核修改')).toBeInTheDocument();
  });

  it('全部解决无新增时显示闭环完成提示', () => {
    setMockState({
      sandboxBaseline: makeSandboxSnapshot(),
      lastSandboxReport: makeSandboxReport({
        resolvedIssues: makeSandboxReport().before.issueDigests,
        newIssues: [],
        remainingIssues: [],
      }),
    });
    render(<SandboxTrialPanel />);
    expect(screen.getByText('所有问题已解决，未引入新问题，闭环完成')).toBeInTheDocument();
  });
});
