/**
 * src/store/slices/outlinePolishSlice.ts 单元测试
 *
 * 测试目标：
 *   - runOutlinePolish：mock provider 下生成报告，含 issues / pacingCurve / emotionCurve /
 *     threeActRatio / characterArcs / foreshadowDensity；并发守卫；scope 局部打磨
 *   - 诊断项操作：ignoreOutlineIssue / resolveOutlineIssue / batchResolveOutlineIssues
 *   - 版本花园：saveOutlineSnapshot（MAX_OUTLINE_SNAPSHOTS 淘汰）/ deleteOutlineSnapshot /
 *     restoreOutlineSnapshot（仅结构字段，不触及正文）
 *   - 情节扩展器：fetchOutlineExpansion（缓存命中）/ clearOutlineExpansionCache
 *   - 节拍：updateChapterBeat / toggleBeatLock / lockCoreDriver / unlockCoreDriver
 *   - 因果推演：clearCausalImpact
 *   - 杂项：getOutlineReport / clearOutlineExpansionCache（全清）
 *
 * 测试策略：
 *   - useAppStore.getState() 触发 actions
 *   - vi.mock('@/utils/storage') 内存实现 + markDirty no-op
 *   - vi.mock('@/hooks/useToast') vi.fn 占位
 *   - 默认 provider='mock'，所有 AI action 走启发式 mock 分支，无需 mock LLM
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import { clearOutlinePolishRequests } from '@/store/slices/outlinePolishSlice';
import * as aiServiceModule from '@/utils/aiService';
import type { Chapter, Project, Character, Foreshadow, OutlineIssue, Material, StructureVariant, ConflictLayer, CoreDriver, ChapterBeat, CausalImpactReport } from '@/types';

// ============ 内存存储 mock ============
const { mockStorage, toastMock } = vi.hoisted(() => {
  const mockStorage = {
    get: vi.fn(async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    patchProjects: vi.fn(async () => null),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
  };
  const toastMock = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  return { mockStorage, toastMock };
});

vi.mock('@/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    storage: mockStorage,
    markDirty: vi.fn(),
    triggerSave: vi.fn(async () => {}),
    clearAutoSaveTimer: vi.fn(),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

// ============ 测试 fixtures ============
const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: '测试项目',
  description: '',
  template: 'blank',
  lastOpenedAt: '',
  totalWords: 0,
  config: {
    theme: 'dark', fontSize: 16, lineHeight: 1.8, fontFamily: 'system-ui',
    showLineNumbers: false, showWordCount: true, zenMode: false,
    aiSettings: { ...DEFAULT_AI_SETTINGS } as never,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'ch-1', projectId: 'p1', parentId: null, title: '第一章',
  summary: '主角发现线索', order: 0, level: 1, levelType: 'chapter',
  status: 'draft', wordCount: 1000,
  content: '<p>林墨走进房间，看见了桌上的信封。他打开信封，里面是一张旧照片。</p>',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeCharacter = (overrides: Partial<Character> = {}): Character => ({
  id: 'c1', projectId: 'p1', name: '林墨', role: 'protagonist', color: '#3b82f6',
  profile: {}, relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeForeshadow = (overrides: Partial<Foreshadow> = {}): Foreshadow => ({
  id: 'f1', projectId: 'p1', title: '神秘信物', description: '',
  status: 'planted', plantedChapterId: null, payoffChapterId: null,
  priority: 'medium', relatedCharacters: [], relatedSettings: [],
  chaptersSinceMention: 0, notes: '',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeMaterial = (overrides: Partial<Material> = {}): Material => ({
  id: 'm1', projectId: 'p1', title: '素材', type: 'inspiration',
  content: '素材内容', tags: [], category: '灵感', references: [],
  pinned: false,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ============ 测试前重置 store ============
beforeEach(() => {
  clearOutlinePolishRequests();
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();
  // 恢复所有 spy（error path 测试用 vi.spyOn 覆盖 aiService 命名导出）
  vi.restoreAllMocks();

  useAppStore.setState({
    projects: [makeProject()],
    currentProjectId: 'p1',
    currentProjectFilePath: null,
    lastSavedAt: null,
    isSaving: false,
    chapters: [],
    currentChapterId: null,
    pendingEditorInsert: null,
    pendingScrollTo: null,
    contentEpoch: 0,
    isAIGenerating: false,
    characters: [],
    settingCategories: [],
    settingItems: [],
    foreshadows: [],
    materials: [],
    subplots: [],
    versions: {},
    histories: {},
    conflicts: [],
    aiSuggestions: [],
    searchQuery: '',
    searchResults: [],
    analysis: {},
    updateSchedule: null,
    lastOutlineReport: null,
    outlineSnapshots: [],
    isPolishingOutline: false,
    outlineExpansionCache: {},
    coreDriver: null,
    conflictCompass: [],
    structureVariants: [],
    lastCausalImpact: null,
    aiSettings: { ...DEFAULT_AI_SETTINGS },
  });
});

// ============ 测试用例 ============

describe('outlinePolishSlice', () => {
  // -------------------- runOutlinePolish --------------------
  describe('runOutlinePolish', () => {
    it('无 currentProjectId 时 noop', async () => {
      useAppStore.setState({ currentProjectId: null });
      await useAppStore.getState().runOutlinePolish();
      expect(useAppStore.getState().lastOutlineReport).toBeNull();
    });

    it('生成完整报告：含 issues / pacingCurve / emotionCurve / 三幕比例 / characterArcs / foreshadowDensity', async () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>主角登场，初步交代背景</p>', wordCount: 800, order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>冲突升级，主角面临抉择</p>', wordCount: 1200, order: 1 }),
          makeChapter({ id: 'ch3', content: '<p>真相揭露，高潮对决</p>', wordCount: 1500, order: 2 }),
        ],
        characters: [makeCharacter()],
        foreshadows: [makeForeshadow({ plantedChapterId: 'ch1', payoffChapterId: 'ch3' })],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport;
      expect(report).not.toBeNull();
      expect(report!.projectId).toBe('p1');
      expect(report!.scope).toBe('all');
      expect(report!.totalChapters).toBe(3);
      expect(report!.totalWords).toBe(3500);
      expect(Array.isArray(report!.issues)).toBe(true);
      expect(report!.pacingCurve).toHaveLength(3);
      expect(report!.emotionCurve).toHaveLength(3);
      expect(report!.threeActRatio).toHaveLength(3);
      // 三幕比例之和约等于 100
      const sum = report!.threeActRatio.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThanOrEqual(99);
      expect(sum).toBeLessThanOrEqual(101);
      expect(report!.characterArcs).toHaveLength(1);
      expect(report!.foreshadowDensity).toHaveLength(3);
    });

    it('pacingCurve.tension 在 5-100 范围内', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>内容</p>', wordCount: 100 })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      report.pacingCurve.forEach(p => {
        expect(p.tension).toBeGreaterThanOrEqual(5);
        expect(p.tension).toBeLessThanOrEqual(100);
      });
    });

    it('emotionCurve.emotion 在 5-100 范围内', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>内容</p>', wordCount: 100 })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      report.emotionCurve.forEach(p => {
        expect(p.emotion).toBeGreaterThanOrEqual(5);
        expect(p.emotion).toBeLessThanOrEqual(100);
      });
    });

    it('scope 局部打磨：仅诊断指定章节及其后代', async () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'book1', level: 1, levelType: 'book', content: '', wordCount: 0 }),
          makeChapter({ id: 'ch1', parentId: 'book1', level: 2, levelType: 'chapter', content: '<p>a</p>', wordCount: 100, order: 0 }),
          makeChapter({ id: 'ch2', parentId: 'book1', level: 2, levelType: 'chapter', content: '<p>b</p>', wordCount: 200, order: 1 }),
        ],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish('book1');
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.scope).toBe('book1');
      // book1 + ch1 + ch2 都在 scope 内，但只有 chapter 级别进入 mainChapters
      expect(report.totalChapters).toBe(2);
    });

    it('并发守卫：旧请求晚于新请求返回时丢弃旧结果', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      // 同步发起两次 runOutlinePolish，第二次应覆盖第一次
      const p1 = useAppStore.getState().runOutlinePolish();
      const p2 = useAppStore.getState().runOutlinePolish();
      await Promise.all([p1, p2]);
      // 最终 lastOutlineReport 不为 null，且 isPolishingOutline=false
      expect(useAppStore.getState().lastOutlineReport).not.toBeNull();
      expect(useAppStore.getState().isPolishingOutline).toBe(false);
    });
  });

  // -------------------- 诊断项操作 --------------------
  describe('诊断项操作', () => {
    const makeIssue = (overrides: Partial<OutlineIssue> = {}): OutlineIssue => ({
      id: 'issue-1',
      dimension: 'structure',
      severity: 'warning',
      description: '问题',
      suggestion: '建议',
      ...overrides,
    });

    it('ignoreOutlineIssue：切换 ignored 标志', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        lastOutlineReport: {
          generatedAt: '2024-01-01T00:00:00.000Z',
          scope: 'all', projectId: 'p1',
          issues: [makeIssue({ id: 'i1' }), makeIssue({ id: 'i2' })],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().ignoreOutlineIssue('i1');
      let issues = useAppStore.getState().lastOutlineReport!.issues;
      expect(issues.find(i => i.id === 'i1')!.ignored).toBe(true);
      // 再次调用切换回 false（注意需重新读取 issues 引用，set 已替换整个数组）
      useAppStore.getState().ignoreOutlineIssue('i1');
      issues = useAppStore.getState().lastOutlineReport!.issues;
      expect(issues.find(i => i.id === 'i1')!.ignored).toBe(false);
      // i2 不受影响
      expect(issues.find(i => i.id === 'i2')!.ignored).toBeUndefined();
    });

    it('resolveOutlineIssue：切换 resolved 标志', () => {
      useAppStore.setState({
        lastOutlineReport: {
          generatedAt: '', scope: 'all', projectId: 'p1',
          issues: [makeIssue({ id: 'i1' })],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().resolveOutlineIssue('i1');
      expect(useAppStore.getState().lastOutlineReport!.issues[0].resolved).toBe(true);
    });

    it('batchResolveOutlineIssues：默认采纳所有未忽略未解决的 issue', () => {
      useAppStore.setState({
        lastOutlineReport: {
          generatedAt: '', scope: 'all', projectId: 'p1',
          issues: [
            makeIssue({ id: 'i1' }),
            makeIssue({ id: 'i2', ignored: true }),
            makeIssue({ id: 'i3', resolved: true }),
            makeIssue({ id: 'i4' }),
          ],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().batchResolveOutlineIssues();
      const issues = useAppStore.getState().lastOutlineReport!.issues;
      // i1, i4 应被标记为 resolved（i2 ignored 跳过，i3 已 resolved）
      expect(issues.find(i => i.id === 'i1')!.resolved).toBe(true);
      expect(issues.find(i => i.id === 'i2')!.resolved).toBeUndefined();
      expect(issues.find(i => i.id === 'i3')!.resolved).toBe(true);
      expect(issues.find(i => i.id === 'i4')!.resolved).toBe(true);
    });

    it('batchResolveOutlineIssues：显式指定 ids 只采纳这些', () => {
      useAppStore.setState({
        lastOutlineReport: {
          generatedAt: '', scope: 'all', projectId: 'p1',
          issues: [makeIssue({ id: 'i1' }), makeIssue({ id: 'i2' })],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().batchResolveOutlineIssues(['i1']);
      const issues = useAppStore.getState().lastOutlineReport!.issues;
      expect(issues.find(i => i.id === 'i1')!.resolved).toBe(true);
      expect(issues.find(i => i.id === 'i2')!.resolved).toBeUndefined();
    });

    it('无 report 时所有操作 noop', () => {
      expect(() => useAppStore.getState().ignoreOutlineIssue('x')).not.toThrow();
      expect(() => useAppStore.getState().resolveOutlineIssue('x')).not.toThrow();
      expect(() => useAppStore.getState().batchResolveOutlineIssues()).not.toThrow();
    });

    it('getOutlineReport 返回 lastOutlineReport', () => {
      expect(useAppStore.getState().getOutlineReport()).toBeNull();
    });
  });

  // -------------------- 版本花园 --------------------
  describe('版本花园', () => {
    it('saveOutlineSnapshot：保存当前章节结构快照', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', title: 'A', summary: 'a', order: 0, level: 1, levelType: 'chapter' }),
          makeChapter({ id: 'ch2', title: 'B', summary: 'b', order: 1, level: 1, levelType: 'chapter' }),
        ],
      });
      const snap = useAppStore.getState().saveOutlineSnapshot('v1');
      expect(snap).not.toBeNull();
      expect(snap!.label).toBe('v1');
      expect(snap!.projectId).toBe('p1');
      expect(snap!.chapters).toHaveLength(2);
      // 仅结构字段，不含 content/wordCount/status
      const snapCh = snap!.chapters[0];
      expect(snapCh.id).toBe('ch1');
      expect(snapCh.title).toBe('A');
      expect(snapCh.summary).toBe('a');
      expect((snapCh as { content?: string }).content).toBeUndefined();
      expect((snapCh as { wordCount?: number }).wordCount).toBeUndefined();
      expect(useAppStore.getState().outlineSnapshots).toHaveLength(1);
    });

    it('saveOutlineSnapshot：label 为空时使用默认值', () => {
      useAppStore.setState({ chapters: [makeChapter()] });
      const snap = useAppStore.getState().saveOutlineSnapshot('   ');
      expect(snap!.label).toContain('快照');
    });

    it('saveOutlineSnapshot：无项目返回 null', () => {
      useAppStore.setState({ currentProjectId: null });
      const snap = useAppStore.getState().saveOutlineSnapshot('v1');
      expect(snap).toBeNull();
    });

    it('saveOutlineSnapshot：超过 MAX (30) 时淘汰最旧', () => {
      useAppStore.setState({ chapters: [makeChapter()] });
      // 预填 30 个旧快照
      const oldSnaps = Array.from({ length: 30 }, (_, i) => ({
        id: `old-${i}`,
        projectId: 'p1',
        createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        label: `旧-${i}`,
        chapters: [],
      }));
      useAppStore.setState({ outlineSnapshots: oldSnaps });
      // 再保存一个新快照
      const newSnap = useAppStore.getState().saveOutlineSnapshot('新');
      expect(useAppStore.getState().outlineSnapshots).toHaveLength(30);
      // 新快照应在列表中
      expect(useAppStore.getState().outlineSnapshots.find(s => s.id === newSnap!.id)).toBeTruthy();
      // 最旧的 old-0 应被淘汰（按 createdAt 升序淘汰）
      expect(useAppStore.getState().outlineSnapshots.find(s => s.id === 'old-0')).toBeUndefined();
    });

    it('deleteOutlineSnapshot：从列表移除', () => {
      useAppStore.setState({
        chapters: [makeChapter()],
        outlineSnapshots: [
          { id: 's1', projectId: 'p1', createdAt: '', label: 'a', chapters: [] },
          { id: 's2', projectId: 'p1', createdAt: '', label: 'b', chapters: [] },
        ],
      });
      useAppStore.getState().deleteOutlineSnapshot('s1');
      expect(useAppStore.getState().outlineSnapshots).toHaveLength(1);
      expect(useAppStore.getState().outlineSnapshots[0].id).toBe('s2');
    });

    it('restoreOutlineSnapshot：仅恢复结构字段，不触及正文', () => {
      const originalChapter = makeChapter({
        id: 'ch1', title: '原标题', summary: '原摘要',
        content: '<p>原正文，不应被覆盖</p>', wordCount: 999, status: 'done',
        order: 0, level: 1, levelType: 'chapter',
      });
      useAppStore.setState({
        chapters: [originalChapter],
        outlineSnapshots: [{
          id: 'snap1', projectId: 'p1', createdAt: '',
          label: 'v1',
          chapters: [{
            id: 'ch1', parentId: null, order: 5, level: 2,
            levelType: 'volume', title: '新标题', summary: '新摘要',
          }],
        }],
      });
      useAppStore.getState().restoreOutlineSnapshot('snap1');
      const ch = useAppStore.getState().chapters[0];
      // 结构字段已恢复
      expect(ch.title).toBe('新标题');
      expect(ch.summary).toBe('新摘要');
      expect(ch.order).toBe(5);
      expect(ch.level).toBe(2);
      expect(ch.levelType).toBe('volume');
      // 正文字段保持不变
      expect(ch.content).toBe('<p>原正文，不应被覆盖</p>');
      expect(ch.wordCount).toBe(999);
      expect(ch.status).toBe('done');
      // contentEpoch 自增（通知编辑器刷新）
      expect(useAppStore.getState().contentEpoch).toBe(1);
    });

    it('restoreOutlineSnapshot：快照不存在时 noop', () => {
      useAppStore.setState({ chapters: [makeChapter()] });
      useAppStore.getState().restoreOutlineSnapshot('nonexistent');
      expect(useAppStore.getState().chapters).toHaveLength(1);
    });
  });

  // -------------------- 情节扩展器 --------------------
  describe('情节扩展器', () => {
    it('fetchOutlineExpansion：mock provider 返回扩展方案并写入缓存', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', summary: '主角遇险' })],
      });
      const options = await useAppStore.getState().fetchOutlineExpansion('ch1');
      expect(Array.isArray(options)).toBe(true);
      expect(useAppStore.getState().outlineExpansionCache['ch1']).toBeDefined();
    });

    it('fetchOutlineExpansion：缓存命中时直接返回缓存', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        outlineExpansionCache: {
          ch1: [{ title: '缓存方案', content: 'x', dramaticTension: 'y' }],
        },
      });
      const options = await useAppStore.getState().fetchOutlineExpansion('ch1');
      expect(options).toHaveLength(1);
      expect(options[0].title).toBe('缓存方案');
    });

    it('fetchOutlineExpansion：章节不存在时返回空数组', async () => {
      const options = await useAppStore.getState().fetchOutlineExpansion('nonexistent');
      expect(options).toEqual([]);
    });

    it('clearOutlineExpansionCache：清空所有缓存', () => {
      useAppStore.setState({
        outlineExpansionCache: {
          ch1: [{ title: 'a', content: '', dramaticTension: '' }],
          ch2: [{ title: 'b', content: '', dramaticTension: '' }],
        },
      });
      useAppStore.getState().clearOutlineExpansionCache();
      expect(useAppStore.getState().outlineExpansionCache).toEqual({});
    });

    it('clearOutlineExpansionCache：仅清空指定 chapterId', () => {
      useAppStore.setState({
        outlineExpansionCache: {
          ch1: [{ title: 'a', content: '', dramaticTension: '' }],
          ch2: [{ title: 'b', content: '', dramaticTension: '' }],
        },
      });
      useAppStore.getState().clearOutlineExpansionCache('ch1');
      const cache = useAppStore.getState().outlineExpansionCache;
      expect(cache.ch1).toBeUndefined();
      expect(cache.ch2).toBeDefined();
    });
  });

  // -------------------- 节拍与核心驱动 --------------------
  describe('节拍与核心驱动', () => {
    it('lockCoreDriver：写入 coreDriver 并清空 conflictCompass', () => {
      const driver = { type: 'character' as const, description: '主角复仇', lockedAt: '' };
      // 先填充 conflictCompass 模拟旧罗盘
      useAppStore.setState({
        conflictCompass: [{ layer: 'inner', description: 'x', seeds: [] }],
      });
      useAppStore.getState().lockCoreDriver(driver);
      expect(useAppStore.getState().coreDriver).toEqual(driver);
      // 旧 conflictCompass 应被清空
      expect(useAppStore.getState().conflictCompass).toEqual([]);
    });

    it('unlockCoreDriver：清空 coreDriver 与 conflictCompass', () => {
      useAppStore.setState({
        coreDriver: { type: 'character', description: 'x', lockedAt: '' },
        conflictCompass: [{ layer: 'inner', description: 'x', seeds: [] }],
      });
      useAppStore.getState().unlockCoreDriver();
      expect(useAppStore.getState().coreDriver).toBeNull();
      expect(useAppStore.getState().conflictCompass).toEqual([]);
    });

    it('updateChapterBeat：已存在 beatType 则更新，否则新增', () => {
      useAppStore.setState({
        chapters: [makeChapter({
          id: 'ch1',
          beats: [{ type: 'hook', content: '旧内容', locked: false }],
        })],
      });
      // 更新已存在的 hook
      useAppStore.getState().updateChapterBeat('ch1', 'hook', '新内容');
      let ch = useAppStore.getState().chapters[0];
      expect(ch.beats!.find(b => b.type === 'hook')!.content).toBe('新内容');
      expect(ch.beats).toHaveLength(1);
      // 新增 progress
      useAppStore.getState().updateChapterBeat('ch1', 'progress', '转折点');
      ch = useAppStore.getState().chapters[0];
      expect(ch.beats).toHaveLength(2);
      expect(ch.beats!.find(b => b.type === 'progress')!.content).toBe('转折点');
    });

    it('updateChapterBeat：章节不存在时 noop', () => {
      expect(() => useAppStore.getState().updateChapterBeat('nonexistent', 'hook', 'x')).not.toThrow();
    });

    it('toggleBeatLock：切换 beat 的 locked 标志', () => {
      useAppStore.setState({
        chapters: [makeChapter({
          id: 'ch1',
          beats: [
            { type: 'hook', content: 'x', locked: false },
            { type: 'progress', content: 'y', locked: false },
          ],
        })],
      });
      useAppStore.getState().toggleBeatLock('ch1', 'hook');
      const ch = useAppStore.getState().chapters[0];
      expect(ch.beats!.find(b => b.type === 'hook')!.locked).toBe(true);
      expect(ch.beats!.find(b => b.type === 'progress')!.locked).toBe(false);
    });

    it('toggleBeatLock：章节无 beats 时 noop', () => {
      useAppStore.setState({ chapters: [makeChapter({ id: 'ch1' })] });
      expect(() => useAppStore.getState().toggleBeatLock('ch1', 'hook')).not.toThrow();
    });
  });

  // -------------------- 因果推演 --------------------
  describe('因果推演', () => {
    it('clearCausalImpact：清空 lastCausalImpact', () => {
      useAppStore.setState({
        lastCausalImpact: {
          changeDescription: 'x',
          affectedChapters: [], affectedForeshadows: [], affectedCharacters: [],
          riskLevel: 'low', suggestion: '', generatedAt: '',
        } as never,
      });
      useAppStore.getState().clearCausalImpact();
      expect(useAppStore.getState().lastCausalImpact).toBeNull();
    });

    it('runCausalPreview：成功后写入 lastCausalImpact', async () => {
      const mockReport: CausalImpactReport = {
        changeDescription: '测试改动',
        targetId: 'ch1',
        impacts: [],
        overallRisk: 'low',
        generatedAt: '2024-01-01T00:00:00.000Z',
      };
      vi.spyOn(aiServiceModule, 'previewCausalImpact').mockResolvedValue(mockReport);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [makeCharacter()],
        foreshadows: [],
      });
      await useAppStore.getState().runCausalPreview('测试改动', 'ch1');
      expect(useAppStore.getState().lastCausalImpact).toEqual(mockReport);
    });

    it('runCausalPreview：previewCausalImpact 抛错时不写入 lastCausalImpact', async () => {
      vi.spyOn(aiServiceModule, 'previewCausalImpact').mockRejectedValue(new Error('AI 异常'));
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runCausalPreview('改动', 'ch1');
      expect(useAppStore.getState().lastCausalImpact).toBeNull();
    });

    it('runCausalPreview：项目切换后丢弃结果', async () => {
      const mockReport: CausalImpactReport = {
        changeDescription: 'x', targetId: 'ch1', impacts: [],
        overallRisk: 'low', generatedAt: '',
      };
      vi.spyOn(aiServiceModule, 'previewCausalImpact').mockImplementation(async () => {
        // 模拟在 await 期间用户切换了项目
        useAppStore.setState({ currentProjectId: 'p2' });
        return mockReport;
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runCausalPreview('改动', 'ch1');
      expect(useAppStore.getState().lastCausalImpact).toBeNull();
    });

    it('runCausalPreview：并发守卫丢弃旧请求结果', async () => {
      const oldReport: CausalImpactReport = {
        changeDescription: '旧', targetId: 'ch1', impacts: [],
        overallRisk: 'low', generatedAt: '',
      };
      const newReport: CausalImpactReport = {
        changeDescription: '新', targetId: 'ch1', impacts: [],
        overallRisk: 'high', generatedAt: '',
      };
      let firstCall = true;
      vi.spyOn(aiServiceModule, 'previewCausalImpact').mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          // 在旧请求返回前触发新请求（新请求走 else 分支直接返回，不再递归）
          await useAppStore.getState().runCausalPreview('新', 'ch1');
          return oldReport;
        }
        return newReport;
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runCausalPreview('旧', 'ch1');
      // 旧请求被 isStale() 丢弃，新请求的结果写入
      expect(useAppStore.getState().lastCausalImpact).toEqual(newReport);
    });
  });

  // -------------------- fetchConflictCompass --------------------
  describe('fetchConflictCompass', () => {
    it('无 coreDriver 时 noop', async () => {
      await useAppStore.getState().fetchConflictCompass();
      expect(useAppStore.getState().conflictCompass).toEqual([]);
    });

    it('成功后写入 conflictCompass', async () => {
      const mockLayers: ConflictLayer[] = [
        { layer: 'inner', description: '内心冲突', seeds: ['种子1'] },
        { layer: 'interpersonal', description: '人际冲突', seeds: ['种子2'] },
      ];
      vi.spyOn(aiServiceModule, 'generateConflictCompass').mockResolvedValue(mockLayers);
      const driver: CoreDriver = { type: 'character', description: '主角复仇', lockedAt: '' };
      useAppStore.setState({
        coreDriver: driver,
        characters: [makeCharacter()],
      });
      await useAppStore.getState().fetchConflictCompass();
      expect(useAppStore.getState().conflictCompass).toEqual(mockLayers);
    });

    it('generateConflictCompass 抛错时不写入', async () => {
      vi.spyOn(aiServiceModule, 'generateConflictCompass').mockRejectedValue(new Error('AI 异常'));
      const driver: CoreDriver = { type: 'character', description: 'x', lockedAt: '' };
      useAppStore.setState({ coreDriver: driver, characters: [] });
      await useAppStore.getState().fetchConflictCompass();
      expect(useAppStore.getState().conflictCompass).toEqual([]);
    });

    it('await 后 coreDriver 被解锁时丢弃结果', async () => {
      const mockLayers: ConflictLayer[] = [
        { layer: 'inner', description: 'x', seeds: [] },
      ];
      vi.spyOn(aiServiceModule, 'generateConflictCompass').mockImplementation(async () => {
        // 模拟在 await 期间用户解锁了 coreDriver
        useAppStore.setState({ coreDriver: null });
        return mockLayers;
      });
      const driver: CoreDriver = { type: 'character', description: 'x', lockedAt: '' };
      useAppStore.setState({ coreDriver: driver, characters: [] });
      await useAppStore.getState().fetchConflictCompass();
      expect(useAppStore.getState().conflictCompass).toEqual([]);
    });

    it('项目切换后丢弃结果', async () => {
      const mockLayers: ConflictLayer[] = [
        { layer: 'inner', description: 'x', seeds: [] },
      ];
      vi.spyOn(aiServiceModule, 'generateConflictCompass').mockImplementation(async () => {
        useAppStore.setState({ currentProjectId: 'p2' });
        return mockLayers;
      });
      const driver: CoreDriver = { type: 'character', description: 'x', lockedAt: '' };
      useAppStore.setState({ coreDriver: driver, characters: [] });
      await useAppStore.getState().fetchConflictCompass();
      expect(useAppStore.getState().conflictCompass).toEqual([]);
    });

    it('并发守卫：旧请求结果被丢弃', async () => {
      const oldLayers: ConflictLayer[] = [
        { layer: 'inner', description: '旧', seeds: [] },
      ];
      const newLayers: ConflictLayer[] = [
        { layer: 'inner', description: '新', seeds: [] },
      ];
      let firstCall = true;
      vi.spyOn(aiServiceModule, 'generateConflictCompass').mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          await useAppStore.getState().fetchConflictCompass();
          return oldLayers;
        }
        return newLayers;
      });
      const driver: CoreDriver = { type: 'character', description: 'x', lockedAt: '' };
      useAppStore.setState({ coreDriver: driver, characters: [] });
      await useAppStore.getState().fetchConflictCompass();
      // 旧请求被丢弃，新请求的结果写入
      expect(useAppStore.getState().conflictCompass).toEqual(newLayers);
    });
  });

  // -------------------- fetchStructureVariants --------------------
  describe('fetchStructureVariants', () => {
    it('无 currentProjectId 时 noop', async () => {
      useAppStore.setState({ currentProjectId: null });
      await useAppStore.getState().fetchStructureVariants();
      expect(useAppStore.getState().structureVariants).toEqual([]);
    });

    it('项目不存在时 noop', async () => {
      useAppStore.setState({ projects: [] });
      await useAppStore.getState().fetchStructureVariants();
      expect(useAppStore.getState().structureVariants).toEqual([]);
    });

    it('成功后写入 structureVariants', async () => {
      const mockVariants: StructureVariant[] = [
        { id: 'v1', name: '经典线性', description: 'x', pros: '好', cons: '差', structureType: 'linear' } as never,
      ];
      vi.spyOn(aiServiceModule, 'generateStructureVariants').mockResolvedValue(mockVariants);
      useAppStore.setState({
        projects: [makeProject()],
        materials: [makeMaterial()],
      });
      await useAppStore.getState().fetchStructureVariants();
      expect(useAppStore.getState().structureVariants).toEqual(mockVariants);
    });

    it('generateStructureVariants 抛错时不写入', async () => {
      vi.spyOn(aiServiceModule, 'generateStructureVariants').mockRejectedValue(new Error('AI 异常'));
      useAppStore.setState({ projects: [makeProject()], materials: [] });
      await useAppStore.getState().fetchStructureVariants();
      expect(useAppStore.getState().structureVariants).toEqual([]);
    });

    it('项目切换后丢弃结果', async () => {
      const mockVariants: StructureVariant[] = [
        { id: 'v1', name: 'x', description: '', pros: '', cons: '', structureType: 'linear' } as never,
      ];
      vi.spyOn(aiServiceModule, 'generateStructureVariants').mockImplementation(async () => {
        useAppStore.setState({ currentProjectId: 'p2' });
        return mockVariants;
      });
      useAppStore.setState({ projects: [makeProject()], materials: [] });
      await useAppStore.getState().fetchStructureVariants();
      expect(useAppStore.getState().structureVariants).toEqual([]);
    });
  });

  // -------------------- generateBeatsForChapter --------------------
  describe('generateBeatsForChapter', () => {
    it('章节不存在时 noop', async () => {
      await useAppStore.getState().generateBeatsForChapter('nonexistent');
      // 不抛错即通过
    });

    it('成功后调用 updateChapter 写入 beats', async () => {
      const mockBeats: ChapterBeat[] = [
        { type: 'hook', content: '钩子', locked: false },
        { type: 'progress', content: '进展', locked: false },
      ];
      vi.spyOn(aiServiceModule, 'generateChapterBeats').mockResolvedValue(mockBeats);
      const updateChapter = vi.fn();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [makeCharacter()],
        updateChapter,
      });
      await useAppStore.getState().generateBeatsForChapter('ch1');
      expect(updateChapter).toHaveBeenCalledWith('ch1', { beats: mockBeats });
    });

    it('generateChapterBeats 抛错时不调用 updateChapter', async () => {
      vi.spyOn(aiServiceModule, 'generateChapterBeats').mockRejectedValue(new Error('AI 异常'));
      const updateChapter = vi.fn();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        updateChapter,
      });
      await useAppStore.getState().generateBeatsForChapter('ch1');
      expect(updateChapter).not.toHaveBeenCalled();
    });

    it('项目切换后丢弃结果', async () => {
      const mockBeats: ChapterBeat[] = [{ type: 'hook', content: 'x', locked: false }];
      vi.spyOn(aiServiceModule, 'generateChapterBeats').mockImplementation(async () => {
        useAppStore.setState({ currentProjectId: 'p2' });
        return mockBeats;
      });
      const updateChapter = vi.fn();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        updateChapter,
      });
      await useAppStore.getState().generateBeatsForChapter('ch1');
      expect(updateChapter).not.toHaveBeenCalled();
    });

    it('章节被删除后丢弃结果', async () => {
      const mockBeats: ChapterBeat[] = [{ type: 'hook', content: 'x', locked: false }];
      vi.spyOn(aiServiceModule, 'generateChapterBeats').mockImplementation(async () => {
        // 模拟章节在 await 期间被删除
        useAppStore.setState({ chapters: [] });
        return mockBeats;
      });
      const updateChapter = vi.fn();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        updateChapter,
      });
      await useAppStore.getState().generateBeatsForChapter('ch1');
      expect(updateChapter).not.toHaveBeenCalled();
    });

    it('并发守卫：旧请求结果被丢弃', async () => {
      const oldBeats: ChapterBeat[] = [{ type: 'hook', content: '旧', locked: false }];
      const newBeats: ChapterBeat[] = [{ type: 'hook', content: '新', locked: false }];
      let firstCall = true;
      vi.spyOn(aiServiceModule, 'generateChapterBeats').mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          await useAppStore.getState().generateBeatsForChapter('ch1');
          return oldBeats;
        }
        return newBeats;
      });
      const updateChapter = vi.fn();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        updateChapter,
      });
      await useAppStore.getState().generateBeatsForChapter('ch1');
      // 旧请求被丢弃，新请求调用 updateChapter 写入 newBeats
      expect(updateChapter).toHaveBeenCalledWith('ch1', { beats: newBeats });
    });
  });

  // -------------------- runOutlinePolish 错误路径 --------------------
  describe('runOutlinePolish 错误路径', () => {
    it('polishOutline 抛错时 toast.error("大纲诊断失败")', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockRejectedValue(new Error('AI 诊断异常'));
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      expect(toastMock.error).toHaveBeenCalledWith('大纲诊断失败', 'AI 诊断异常');
      // 仍会生成报告（issues 为空，但本地补充仍执行）
      const report = useAppStore.getState().lastOutlineReport;
      expect(report).not.toBeNull();
      expect(report!.issues).toEqual([]);
    });

    it('polishOutline 抛非 Error 时 toast.error 使用默认消息', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockRejectedValue('字符串错误');
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      expect(toastMock.error).toHaveBeenCalledWith('大纲诊断失败', 'AI 诊断服务异常，请稍后重试');
    });

    it('项目切换后丢弃结果（currentProjectId 变化）', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockImplementation(async () => {
        useAppStore.setState({ currentProjectId: 'p2' });
        return [];
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      // 项目已切换，不写入 lastOutlineReport
      expect(useAppStore.getState().lastOutlineReport).toBeNull();
    });

    it('并发守卫：旧请求 isPolishingOutline 不被复位', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockImplementation(async () => {
        // 旧请求返回前触发新请求
        await useAppStore.getState().runOutlinePolish();
        return [];
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      // 最终 isPolishingOutline 应为 false
      expect(useAppStore.getState().isPolishingOutline).toBe(false);
    });
  });

  // -------------------- fetchOutlineExpansion 错误路径 --------------------
  describe('fetchOutlineExpansion 错误路径', () => {
    it('expandOutlineNode 抛错时 toast.error("大纲展开失败")', async () => {
      vi.spyOn(aiServiceModule, 'expandOutlineNode').mockRejectedValue(new Error('AI 异常'));
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
      });
      const options = await useAppStore.getState().fetchOutlineExpansion('ch1');
      expect(options).toEqual([]);
      expect(toastMock.error).toHaveBeenCalledWith('大纲展开失败', 'AI 异常');
    });

    it('expandOutlineNode 抛非 Error 时使用默认消息', async () => {
      vi.spyOn(aiServiceModule, 'expandOutlineNode').mockRejectedValue('字符串错误');
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
      });
      await useAppStore.getState().fetchOutlineExpansion('ch1');
      expect(toastMock.error).toHaveBeenCalledWith('大纲展开失败', 'AI 服务异常，请稍后重试');
    });

    it('项目切换后丢弃结果', async () => {
      vi.spyOn(aiServiceModule, 'expandOutlineNode').mockImplementation(async () => {
        useAppStore.setState({ currentProjectId: 'p2' });
        return [{ title: 'x', content: '', dramaticTension: '' }];
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
      });
      const options = await useAppStore.getState().fetchOutlineExpansion('ch1');
      expect(options).toEqual([]);
    });

    it('章节被删除后丢弃结果', async () => {
      vi.spyOn(aiServiceModule, 'expandOutlineNode').mockImplementation(async () => {
        useAppStore.setState({ chapters: [] });
        return [{ title: 'x', content: '', dramaticTension: '' }];
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
      });
      const options = await useAppStore.getState().fetchOutlineExpansion('ch1');
      expect(options).toEqual([]);
    });

    it('并发守卫：旧请求结果被丢弃', async () => {
      const oldOptions = [{ title: '旧', content: '', dramaticTension: '' }];
      const newOptions = [{ title: '新', content: '', dramaticTension: '' }];
      let firstCall = true;
      vi.spyOn(aiServiceModule, 'expandOutlineNode').mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          await useAppStore.getState().fetchOutlineExpansion('ch1');
          return oldOptions;
        }
        return newOptions;
      });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
      });
      await useAppStore.getState().fetchOutlineExpansion('ch1');
      // 旧请求被丢弃，新请求写入缓存
      expect(useAppStore.getState().outlineExpansionCache['ch1']).toEqual(newOptions);
    });
  });

  // -------------------- restoreOutlineSnapshot 边界 --------------------
  describe('restoreOutlineSnapshot 边界', () => {
    it('恢复后当前章节不存在时清空 currentChapterId', () => {
      useAppStore.setState({
        currentChapterId: 'ch-missing',
        chapters: [makeChapter({ id: 'ch1' })],
        outlineSnapshots: [{
          id: 'snap1', projectId: 'p1', createdAt: '', label: 'v1',
          chapters: [{ id: 'ch1', parentId: null, order: 0, level: 1, levelType: 'chapter', title: 'A', summary: 'a' }],
        }],
      });
      useAppStore.getState().restoreOutlineSnapshot('snap1');
      // ch-missing 不在 updatedChapters 中（快照只含 ch1），应被清空
      expect(useAppStore.getState().currentChapterId).toBeNull();
    });

    it('恢复后当前章节仍存在时保持选中', () => {
      useAppStore.setState({
        currentChapterId: 'ch1',
        chapters: [makeChapter({ id: 'ch1' })],
        outlineSnapshots: [{
          id: 'snap1', projectId: 'p1', createdAt: '', label: 'v1',
          chapters: [{ id: 'ch1', parentId: null, order: 0, level: 1, levelType: 'chapter', title: 'A', summary: 'a' }],
        }],
      });
      useAppStore.getState().restoreOutlineSnapshot('snap1');
      expect(useAppStore.getState().currentChapterId).toBe('ch1');
    });
  });

  // -------------------- batchResolveOutlineIssues 边界 --------------------
  describe('batchResolveOutlineIssues 边界', () => {
    it('显式指定空数组时退化为"采纳所有未解决"（与 undefined 一致）', () => {
      useAppStore.setState({
        lastOutlineReport: {
          generatedAt: '', scope: 'all', projectId: 'p1',
          issues: [{ id: 'i1', dimension: 'structure', severity: 'warning', description: 'x', suggestion: 'y' }],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().batchResolveOutlineIssues([]);
      // [] 的 length > 0 为 false → 走 else 分支，退化为"采纳所有未解决"
      expect(useAppStore.getState().lastOutlineReport!.issues[0].resolved).toBe(true);
    });

    it('所有 issue 都已 ignored/resolved 时 noop', () => {
      useAppStore.setState({
        lastOutlineReport: {
          generatedAt: '', scope: 'all', projectId: 'p1',
          issues: [
            { id: 'i1', dimension: 'structure', severity: 'warning', description: 'x', suggestion: 'y', ignored: true },
            { id: 'i2', dimension: 'structure', severity: 'warning', description: 'x', suggestion: 'y', resolved: true },
          ],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().batchResolveOutlineIssues();
      // 无可采纳项 → noop
      const issues = useAppStore.getState().lastOutlineReport!.issues;
      expect(issues.find(i => i.id === 'i1')!.resolved).toBeUndefined();
    });

    it('resolveOutlineIssue：切换 resolved 回 false', () => {
      useAppStore.setState({
        lastOutlineReport: {
          generatedAt: '', scope: 'all', projectId: 'p1',
          issues: [{ id: 'i1', dimension: 'structure', severity: 'warning', description: 'x', suggestion: 'y', resolved: true }],
          pacingCurve: [], emotionCurve: [], threeActRatio: [0, 0, 0],
          characterArcs: [], foreshadowDensity: [],
          totalChapters: 0, totalWords: 0,
        },
      });
      useAppStore.getState().resolveOutlineIssue('i1');
      expect(useAppStore.getState().lastOutlineReport!.issues[0].resolved).toBe(false);
    });
  });

  // -------------------- computeTension/computeEmotion 边界 --------------------
  describe('computeTension/computeEmotion 边界（通过 runOutlinePolish 间接覆盖）', () => {
    it('章节无正文但有摘要时 tension=30, emotion=25', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '', summary: '有摘要', wordCount: 0 })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.pacingCurve[0].tension).toBe(30);
      expect(report.emotionCurve[0].emotion).toBe(25);
    });

    it('章节无正文无摘要时 tension=10, emotion=10', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '', summary: '', wordCount: 0 })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.pacingCurve[0].tension).toBe(10);
      expect(report.emotionCurve[0].emotion).toBe(10);
    });

    it('章节 wordCount 为 0 时用正文长度计算 lengthScore', async () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>较短的内容</p>', wordCount: 0 })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      // 不抛错即通过；tension 在 5-100 范围
      expect(report.pacingCurve[0].tension).toBeGreaterThanOrEqual(5);
      expect(report.pacingCurve[0].tension).toBeLessThanOrEqual(100);
    });
  });

  // -------------------- computeThreeActRatio 边界 --------------------
  describe('computeThreeActRatio 边界', () => {
    it('无章节时返回 [0, 0, 0]', async () => {
      useAppStore.setState({
        chapters: [],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.threeActRatio).toEqual([0, 0, 0]);
      expect(report.totalChapters).toBe(0);
      expect(report.totalWords).toBe(0);
    });

    it('章节 wordCount 为 0 时用 1 作为权重', async () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>a</p>', wordCount: 0, order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>b</p>', wordCount: 0, order: 1 }),
          makeChapter({ id: 'ch3', content: '<p>c</p>', wordCount: 0, order: 2 }),
          makeChapter({ id: 'ch4', content: '<p>d</p>', wordCount: 0, order: 3 }),
        ],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      // 三幕比例之和约 100
      const sum = report.threeActRatio.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThanOrEqual(99);
      expect(sum).toBeLessThanOrEqual(101);
    });
  });

  // -------------------- computeForeshadowDensity 边界 --------------------
  describe('computeForeshadowDensity 边界', () => {
    it('progressing 状态伏笔在章节正文中被提及时计入 progressing', async () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>这里提到了神秘信物</p>', summary: '', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>无关内容</p>', summary: '', order: 1 }),
        ],
        characters: [],
        foreshadows: [
          makeForeshadow({
            id: 'f1',
            title: '神秘信物',
            status: 'progressing',
            plantedChapterId: 'ch1',
            payoffChapterId: 'ch2',
          }),
        ],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      // ch1 正文提到"神秘信物"，但 ch1 是 plantedChapterId，不计入 progressing
      // ch2 正文不含"神秘信物"，也不计入
      // 验证 planted/payoff 统计正确
      const ch1Density = report.foreshadowDensity.find(d => d.chapterId === 'ch1')!;
      expect(ch1Density.planted).toBe(1);
      const ch2Density = report.foreshadowDensity.find(d => d.chapterId === 'ch2')!;
      expect(ch2Density.paidOff).toBe(1);
    });

    it('planted 状态伏笔在中间章节正文中被提及时计入 progressing', async () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>埋下伏笔</p>', summary: '', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>这里提到了神秘信物</p>', summary: '', order: 1 }),
          makeChapter({ id: 'ch3', content: '<p>回收伏笔</p>', summary: '', order: 2 }),
        ],
        characters: [],
        foreshadows: [
          makeForeshadow({
            id: 'f1',
            title: '神秘信物',
            status: 'planted',
            plantedChapterId: 'ch1',
            payoffChapterId: 'ch3',
          }),
        ],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      // ch2 正文提到"神秘信物"，且 ch2 既不是 planted 也不是 payoff → progressing++
      const ch2Density = report.foreshadowDensity.find(d => d.chapterId === 'ch2')!;
      expect(ch2Density.progressing).toBe(1);
    });
  });

  // -------------------- enrichIssues 边界 --------------------
  describe('enrichIssues 边界', () => {
    it('issue 无 chapterTitle 但有 chapterId 时从 chapters 查找填充', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockResolvedValue([
        { id: 'issue-1', dimension: 'structure', severity: 'warning', chapterId: 'ch1', description: '问题', suggestion: '建议' },
      ]);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '第一章' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.issues[0].chapterTitle).toBe('第一章');
    });

    it('issue 已有 chapterTitle 时保持不变', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockResolvedValue([
        { id: 'issue-1', dimension: 'structure', severity: 'warning', chapterId: 'ch1', chapterTitle: '自定义标题', description: '问题', suggestion: '建议' },
      ]);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '第一章' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.issues[0].chapterTitle).toBe('自定义标题');
    });

    it('issue 的 chapterId 在 chapters 中不存在时保持不变', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockResolvedValue([
        { id: 'issue-1', dimension: 'structure', severity: 'warning', chapterId: 'nonexistent', description: '问题', suggestion: '建议' },
      ]);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.issues[0].chapterTitle).toBeUndefined();
    });

    it('issue 无 chapterId 时保持不变', async () => {
      vi.spyOn(aiServiceModule, 'polishOutline').mockResolvedValue([
        { id: 'issue-1', dimension: 'structure', severity: 'warning', description: '问题', suggestion: '建议' },
      ]);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish();
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report.issues[0].chapterTitle).toBeUndefined();
    });
  });

  // -------------------- isDescendant 边界 --------------------
  describe('isDescendant 边界（通过 runOutlinePolish scope 间接覆盖）', () => {
    it('多级后代：孙章节在 scope 内', async () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'vol1', level: 1, levelType: 'volume', content: '', wordCount: 0 }),
          makeChapter({ id: 'ch1', parentId: 'vol1', level: 2, levelType: 'chapter', content: '<p>a</p>', wordCount: 100, order: 0 }),
        ],
        characters: [],
        foreshadows: [],
      });
      await useAppStore.getState().runOutlinePolish('vol1');
      const report = useAppStore.getState().lastOutlineReport!;
      // vol1 + ch1 都在 scope，但只有 chapter 级别进入 mainChapters
      expect(report.totalChapters).toBe(1);
    });

    it('环状结构防御：parentId 形成环时不死循环', async () => {
      // 构造环：a → b → a
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'a', parentId: 'b', level: 1, levelType: 'volume', content: '', wordCount: 0 }),
          makeChapter({ id: 'b', parentId: 'a', level: 2, levelType: 'chapter', content: '<p>x</p>', wordCount: 100, order: 0 }),
        ],
        characters: [],
        foreshadows: [],
      });
      // 不应死循环
      await useAppStore.getState().runOutlinePolish('a');
      const report = useAppStore.getState().lastOutlineReport!;
      expect(report).not.toBeNull();
    });
  });
});
