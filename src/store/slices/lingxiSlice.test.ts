/**
 * src/store/slices/lingxiSlice.ts 单元测试
 *
 * 测试目标：
 *   - 灵犀设定：getSettingCard / initSettingCard / updateSettingCard /
 *     resolveSettingCardContradiction（同步部分）
 *   - 灵犀蓝图：getBlueprint / updateBlueprint / lockBlueprint / unlockBlueprint /
 *     clearBlueprintImpact（含锁定拦截）
 *   - 灵犀总控-支线：addSubplot / updateSubplot / deleteSubplot / progressSubplot
 *     （含 closed/abandoned 拒绝推进）
 *   - 灵犀总控-存稿：updateUpdateSchedule / getStockpileDays
 *     （含 dailySpeed<=0 返回 0、仅 done 章节计入存稿）
 *   - 灵犀发布-敏感词：runSensitiveWordCheck / clearSensitiveWordCheck
 *
 * 测试策略：
 *   - useAppStore.getState() 触发 actions
 *   - vi.mock('@/utils/storage') 内存实现 + markDirty no-op
 *   - vi.mock('@/hooks/useToast') 简单 vi.fn 占位
 *   - 每个测试前 useAppStore.setState 重置关键字段
 *   - 异步 AI action（askSettingCardQuestions / generateBlueprint 等）由 aiService
 *     的 mock provider 路径直接走，无需额外 mock
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import type {
  Chapter, Project,
  ProjectSettingCard, BlueprintOverview, PlotTurnPoint,
  GrowthArcSegment, CharacterFateSegment, VolumeOverview,
} from '@/types';
import { createEmptySettingCard } from '@/types';

// ============ 内存存储 mock ============
const { mockStorage, toastMock } = vi.hoisted(() => {
  const mockStorage = {
    get: vi.fn(async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue),
    set: vi.fn(async () => undefined),
    setMany: vi.fn(async () => undefined),
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
  summary: '', order: 0, level: 1, levelType: 'chapter',
  status: 'draft', wordCount: 0, content: '',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeSettingCard = (overrides: Partial<ProjectSettingCard> = {}): ProjectSettingCard => ({
  ...createEmptySettingCard('测试作品'),
  ...overrides,
});

const makeBlueprint = (overrides: Partial<BlueprintOverview> = {}): BlueprintOverview => ({
  mainline: '主线',
  startPoint: '起点',
  turnPoints: [] as PlotTurnPoint[],
  endPoint: '终点',
  growthArc: [] as GrowthArcSegment[],
  characterFates: [] as CharacterFateSegment[],
  volumes: [] as VolumeOverview[],
  lockedAt: null,
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ============ 测试前重置 store ============
beforeEach(() => {
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();

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
    lastSensitiveWordCheck: null,
    isSettingCardBusy: false,
    settingCardQuestions: [],
    isBlueprintBusy: false,
  });
});

// ============ 测试用例 ============

describe('lingxiSlice', () => {
  // -------------------- 灵犀设定 --------------------
  describe('灵犀设定', () => {
    it('getSettingCard：无 settingCard 返回 null', () => {
      expect(useAppStore.getState().getSettingCard()).toBeNull();
    });

    it('getSettingCard：返回 project.settingCard', () => {
      const card = makeSettingCard();
      useAppStore.setState({
        projects: [makeProject({ settingCard: card })],
      });
      expect(useAppStore.getState().getSettingCard()).toEqual(card);
    });

    it('getSettingCard：无 currentProjectId 返回 null', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(useAppStore.getState().getSettingCard()).toBeNull();
    });

    it('initSettingCard：创建空设定卡并写入 project', () => {
      const card = useAppStore.getState().initSettingCard();
      expect(card).not.toBeNull();
      expect(card!.title).toBe('测试项目'); // 用 project.title 初始化
      // 已持久化到 project.settingCard
      expect(useAppStore.getState().getSettingCard()).toEqual(card);
    });

    it('initSettingCard：无 currentProjectId 时 toast 错误并返回 null', () => {
      useAppStore.setState({ currentProjectId: null });
      const card = useAppStore.getState().initSettingCard();
      expect(card).toBeNull();
      expect(toastMock.error).toHaveBeenCalled();
    });

    it('updateSettingCard：合并 protagonist/worldview/coreConflict 子字段', () => {
      useAppStore.getState().initSettingCard();
      useAppStore.getState().updateSettingCard({
        protagonist: { name: '林墨', personalityKeywords: ['冷静'] },
        worldview: { basicRules: '长安城' },
        coreConflict: { mainConflict: '复仇' },
      });
      const card = useAppStore.getState().getSettingCard()!;
      expect(card.protagonist.name).toBe('林墨');
      expect(card.protagonist.personalityKeywords).toEqual(['冷静']);
      expect(card.worldview.basicRules).toBe('长安城');
      expect(card.coreConflict.mainConflict).toBe('复仇');
    });

    it('updateSettingCard：无 currentProjectId 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateSettingCard({ protagonist: { name: 'x', personalityKeywords: [] } });
      // 无 currentProjectId 时 settingCard 不应被创建
      expect(useAppStore.getState().getSettingCard()).toBeNull();
    });

    it('resolveSettingCardContradiction：标记指定 index 为已解决', () => {
      useAppStore.getState().initSettingCard();
      useAppStore.getState().updateSettingCard({
        contradictions: [
          { description: '矛盾1', severity: 'error', resolved: false },
          { description: '矛盾2', severity: 'warning', resolved: false },
        ],
      });
      useAppStore.getState().resolveSettingCardContradiction(0);
      const card = useAppStore.getState().getSettingCard()!;
      expect(card.contradictions![0].resolved).toBe(true);
      expect(card.contradictions![1].resolved).toBe(false);
    });

    it('resolveSettingCardContradiction：无 contradictions 时 noop', () => {
      useAppStore.getState().initSettingCard();
      useAppStore.getState().resolveSettingCardContradiction(0);
      expect(useAppStore.getState().getSettingCard()!.contradictions).toBeUndefined();
    });
  });

  // -------------------- 灵犀蓝图 --------------------
  describe('灵犀蓝图', () => {
    it('getBlueprint：无 blueprint 返回 null', () => {
      expect(useAppStore.getState().getBlueprint()).toBeNull();
    });

    it('getBlueprint：返回 project.blueprint', () => {
      const bp = makeBlueprint({ mainline: '自定义主线' });
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      expect(useAppStore.getState().getBlueprint()!.mainline).toBe('自定义主线');
    });

    it('updateBlueprint：无 blueprint 时 toast 警告', () => {
      useAppStore.getState().updateBlueprint({ mainline: 'x' });
      expect(toastMock.warning).toHaveBeenCalledWith('请先生成蓝图', '尚未生成全局走向概览');
    });

    it('updateBlueprint：合并字段', () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      useAppStore.getState().updateBlueprint({ mainline: '新主线', endPoint: '新终点' });
      const updated = useAppStore.getState().getBlueprint()!;
      expect(updated.mainline).toBe('新主线');
      expect(updated.endPoint).toBe('新终点');
    });

    it('updateBlueprint：锁定时拦截并 toast 警告', () => {
      const bp = makeBlueprint({ lockedAt: '2024-01-01T00:00:00.000Z' });
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      useAppStore.getState().updateBlueprint({ mainline: '不应被覆盖' });
      expect(useAppStore.getState().getBlueprint()!.mainline).toBe('主线');
      expect(toastMock.warning).toHaveBeenCalledWith('蓝图已锁定', '请先解锁蓝图再修改');
    });

    it('lockBlueprint：设置 lockedAt 并 toast 成功', () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      useAppStore.getState().lockBlueprint();
      expect(useAppStore.getState().getBlueprint()!.lockedAt).not.toBeNull();
      expect(toastMock.success).toHaveBeenCalled();
    });

    it('lockBlueprint：无 blueprint 时 toast 警告', () => {
      useAppStore.getState().lockBlueprint();
      expect(toastMock.warning).toHaveBeenCalledWith('请先生成蓝图', '锁定前需先生成全局走向概览');
    });

    it('unlockBlueprint：清除 lockedAt', () => {
      const bp = makeBlueprint({ lockedAt: '2024-01-01T00:00:00.000Z' });
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      useAppStore.getState().unlockBlueprint();
      expect(useAppStore.getState().getBlueprint()!.lockedAt).toBeNull();
      expect(toastMock.info).toHaveBeenCalled();
    });

    it('unlockBlueprint：未锁定时 noop', () => {
      const bp = makeBlueprint({ lockedAt: null });
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      useAppStore.getState().unlockBlueprint();
      // 不应触发 toast
      expect(toastMock.info).not.toHaveBeenCalled();
    });

    it('clearBlueprintImpact：清除 lastChangeImpact', () => {
      const bp = makeBlueprint({
        lastChangeImpact: {
          changeDescription: 'x',
          affectedVolumes: [], affectedChapters: [], affectedForeshadows: [],
          riskLevel: 'low', suggestion: '', generatedAt: '',
        },
      });
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      useAppStore.getState().clearBlueprintImpact();
      expect(useAppStore.getState().getBlueprint()!.lastChangeImpact).toBeUndefined();
    });
  });

  // -------------------- 灵犀总控-支线 --------------------
  describe('灵犀总控-支线', () => {
    it('addSubplot：默认值填充并写入 project + state', () => {
      const s = useAppStore.getState().addSubplot({ title: '支线1' });
      expect(s).not.toBeNull();
      expect(s!.title).toBe('支线1');
      expect(s!.status).toBe('open'); // DEFAULT_SUBPLOT_STATUS
      expect(useAppStore.getState().subplots).toHaveLength(1);
      // project.subplots 同步
      const project = useAppStore.getState().projects.find(p => p.id === 'p1')!;
      expect(project.subplots).toHaveLength(1);
    });

    it('addSubplot：无项目返回 null + toast 错误', () => {
      useAppStore.setState({ currentProjectId: null });
      const s = useAppStore.getState().addSubplot({ title: 'x' });
      expect(s).toBeNull();
      expect(toastMock.error).toHaveBeenCalled();
    });

    it('updateSubplot：合并字段', () => {
      const s = useAppStore.getState().addSubplot({ title: 'a' })!;
      useAppStore.getState().updateSubplot(s.id, { title: 'b', notes: '备注' });
      const updated = useAppStore.getState().subplots.find(x => x.id === s.id)!;
      expect(updated.title).toBe('b');
      expect(updated.notes).toBe('备注');
    });

    it('updateSubplot：无项目 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().updateSubplot('any', { title: 'x' })).not.toThrow();
    });

    it('deleteSubplot：从列表移除', () => {
      const s = useAppStore.getState().addSubplot({ title: 'a' })!;
      useAppStore.getState().deleteSubplot(s.id);
      expect(useAppStore.getState().subplots).toHaveLength(0);
    });

    it('progressSubplot：open → progressing，记录推进章节', () => {
      const s = useAppStore.getState().addSubplot({ title: 'a', status: 'open' })!;
      useAppStore.getState().progressSubplot(s.id, 'ch1');
      const updated = useAppStore.getState().subplots.find(x => x.id === s.id)!;
      expect(updated.status).toBe('progressing');
      expect(updated.lastProgressChapterId).toBe('ch1');
      expect(updated.lastProgressAt).not.toBeNull();
    });

    it('progressSubplot：paused → progressing', () => {
      const s = useAppStore.getState().addSubplot({ title: 'a', status: 'paused' })!;
      useAppStore.getState().progressSubplot(s.id, 'ch1');
      expect(useAppStore.getState().subplots.find(x => x.id === s.id)!.status).toBe('progressing');
    });

    it('progressSubplot：closed 拒绝推进（保持 closed）', () => {
      const s = useAppStore.getState().addSubplot({ title: 'a', status: 'closed' })!;
      useAppStore.getState().progressSubplot(s.id, 'ch1');
      const updated = useAppStore.getState().subplots.find(x => x.id === s.id)!;
      expect(updated.status).toBe('closed');
      expect(updated.lastProgressChapterId).toBeNull(); // 未被更新
    });

    it('progressSubplot：abandoned 拒绝推进', () => {
      const s = useAppStore.getState().addSubplot({ title: 'a', status: 'abandoned' })!;
      useAppStore.getState().progressSubplot(s.id, 'ch1');
      expect(useAppStore.getState().subplots.find(x => x.id === s.id)!.status).toBe('abandoned');
    });

    it('progressSubplot：subplots 不存在时 noop', () => {
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        projects: [{ ...project, subplots: undefined }],
      });
      expect(() => useAppStore.getState().progressSubplot('any', 'ch1')).not.toThrow();
    });
  });

  // -------------------- 灵犀总控-存稿 --------------------
  describe('灵犀总控-存稿', () => {
    it('updateUpdateSchedule：合并字段并写入 project + state', () => {
      useAppStore.getState().updateUpdateSchedule({ dailySpeed: 2000, dailyTargetWords: 3000 });
      const schedule = useAppStore.getState().updateSchedule!;
      expect(schedule.dailySpeed).toBe(2000);
      expect(schedule.dailyTargetWords).toBe(3000);
      // 其他字段使用 createDefaultUpdateSchedule 的默认值
      expect(schedule.enableStaleAlert).toBeDefined();
      // project.updateSchedule 同步
      const project = useAppStore.getState().projects.find(p => p.id === 'p1')!;
      expect(project.updateSchedule).toEqual(schedule);
    });

    it('updateUpdateSchedule：无项目 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().updateUpdateSchedule({ dailySpeed: 1000 })).not.toThrow();
      expect(useAppStore.getState().updateSchedule).toBeNull();
    });

    it('getStockpileDays：无 schedule 返回 0', () => {
      expect(useAppStore.getState().getStockpileDays()).toBe(0);
    });

    it('getStockpileDays：dailySpeed<=0 返回 0', () => {
      useAppStore.getState().updateUpdateSchedule({ dailySpeed: 0 });
      expect(useAppStore.getState().getStockpileDays()).toBe(0);
    });

    it('getStockpileDays：仅 done 状态章节计入存稿', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', status: 'done', wordCount: 5000 }),
          makeChapter({ id: 'ch2', status: 'draft', wordCount: 3000 }), // 不算
          makeChapter({ id: 'ch3', status: 'writing', wordCount: 2000 }), // 不算
          makeChapter({ id: 'ch4', status: 'done', wordCount: 3000 }),
        ],
      });
      useAppStore.getState().updateUpdateSchedule({ dailySpeed: 2000 });
      // 存稿 = 5000 + 3000 = 8000 字，日更 2000 → 4 天
      expect(useAppStore.getState().getStockpileDays()).toBe(4);
    });

    it('getStockpileDays：非 chapter 级别不计入', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'book1', levelType: 'book', status: 'done', wordCount: 10000 }),
          makeChapter({ id: 'ch1', levelType: 'chapter', status: 'done', wordCount: 3000 }),
        ],
      });
      useAppStore.getState().updateUpdateSchedule({ dailySpeed: 1000 });
      // 只算 chapter 级别 3000 字 → 3 天
      expect(useAppStore.getState().getStockpileDays()).toBe(3);
    });
  });

  // -------------------- 灵犀发布-敏感词 --------------------
  describe('灵犀发布-敏感词', () => {
    it('runSensitiveWordCheck：默认检查所有 chapter 级别章节', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', levelType: 'chapter', content: '<p>正常内容</p>' }),
          makeChapter({ id: 'book1', levelType: 'book', content: '<p>正常</p>' }),
        ],
      });
      const result = useAppStore.getState().runSensitiveWordCheck();
      expect(result).toBeDefined();
      expect(result.totalHits).toBe(0);
      expect(useAppStore.getState().lastSensitiveWordCheck).toBe(result);
    });

    it('runSensitiveWordCheck：指定 chapterIds 仅检查这些章节', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', levelType: 'chapter', content: '<p>正常</p>' }),
          makeChapter({ id: 'ch2', levelType: 'chapter', content: '<p>正常</p>' }),
        ],
      });
      const result = useAppStore.getState().runSensitiveWordCheck(['ch1']);
      expect(result).toBeDefined();
      // 仅扫描 ch1，结果与全扫描不同（hit 数应一致或更少）
      expect(result.totalHits).toBe(0);
    });

    it('runSensitiveWordCheck：含敏感词时 totalHits > 0', () => {
      // 词库中"海洛因"是违禁品类敏感词，应命中
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', levelType: 'chapter', content: '<p>这里出现海洛因两个字</p>' }),
        ],
      });
      const result = useAppStore.getState().runSensitiveWordCheck();
      expect(result.totalHits).toBeGreaterThanOrEqual(1);
    });

    it('clearSensitiveWordCheck：清空 lastSensitiveWordCheck', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', levelType: 'chapter', content: '<p>正常</p>' })],
      });
      useAppStore.getState().runSensitiveWordCheck();
      expect(useAppStore.getState().lastSensitiveWordCheck).not.toBeNull();
      useAppStore.getState().clearSensitiveWordCheck();
      expect(useAppStore.getState().lastSensitiveWordCheck).toBeNull();
    });
  });

  // -------------------- 异步 AI action 补测 --------------------
  describe('askSettingCardQuestions 异步', () => {
    it('无设定卡时 toast 警告并返回空数组', async () => {
      const result = await useAppStore.getState().askSettingCardQuestions();
      expect(result).toEqual([]);
      expect(toastMock.warning).toHaveBeenCalledWith('请先填写设定卡', 'AI 提问需要先初始化设定卡');
    });

    it('无 currentProjectId 时 toast 警告并返回空数组', async () => {
      useAppStore.getState().initSettingCard();
      useAppStore.setState({ currentProjectId: null });
      const result = await useAppStore.getState().askSettingCardQuestions();
      expect(result).toEqual([]);
      expect(toastMock.warning).toHaveBeenCalled();
    });

    it('成功时写入 settingCardQuestions + 复位 busy', async () => {
      useAppStore.getState().initSettingCard();
      const result = await useAppStore.getState().askSettingCardQuestions();
      expect(result.length).toBeGreaterThan(0);
      expect(useAppStore.getState().settingCardQuestions).toEqual(result);
      expect(useAppStore.getState().isSettingCardBusy).toBe(false);
    });

    it('await 期间切换项目：不写入 settingCardQuestions 但返回结果', async () => {
      useAppStore.getState().initSettingCard();
      // 通过 vi.spyOn 在调用 generateCoreSettingCardQuestions 中途切换项目
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateCoreSettingCardQuestions').mockImplementationOnce(async () => {
        // 模拟 await 期间用户切换项目
        useAppStore.setState({ currentProjectId: 'other-project' });
        return ['问题1'];
      });
      const result = await useAppStore.getState().askSettingCardQuestions();
      expect(result).toEqual(['问题1']);
      // settingCardQuestions 不应被写入（因为是旧项目的结果）
      expect(useAppStore.getState().settingCardQuestions).toEqual([]);
      // busy flag 也不应被复位（项目已切换）
      expect(useAppStore.getState().isSettingCardBusy).toBe(true);
      // 还原 currentProjectId 以便后续测试
      useAppStore.setState({ currentProjectId: 'p1', isSettingCardBusy: false });
      spy.mockRestore();
    });

    it('抛错时 toast 错误并返回空数组', async () => {
      useAppStore.getState().initSettingCard();
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateCoreSettingCardQuestions').mockRejectedValueOnce(new Error('AI 异常'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await useAppStore.getState().askSettingCardQuestions();
      expect(result).toEqual([]);
      expect(toastMock.error).toHaveBeenCalledWith('AI 提问失败', 'AI 异常');
      expect(useAppStore.getState().isSettingCardBusy).toBe(false);
      consoleSpy.mockRestore();
      spy.mockRestore();
    });
  });

  describe('checkSettingCard 异步', () => {
    it('无设定卡时 toast 警告', async () => {
      await useAppStore.getState().checkSettingCard();
      expect(toastMock.warning).toHaveBeenCalledWith('请先填写设定卡', '矛盾检查需要先初始化设定卡');
    });

    it('无矛盾时 toast 成功', async () => {
      useAppStore.getState().initSettingCard();
      await useAppStore.getState().checkSettingCard();
      expect(toastMock.success).toHaveBeenCalledWith('未发现矛盾', '设定卡自洽，可放心进入下一步');
      expect(useAppStore.getState().getSettingCard()!.contradictions).toEqual([]);
      expect(useAppStore.getState().isSettingCardBusy).toBe(false);
    });

    it('有矛盾时 toast 警告（含 error severity）', async () => {
      useAppStore.getState().initSettingCard();
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'checkSettingCardContradictions').mockResolvedValueOnce([
        { description: '矛盾1', severity: 'error', resolved: false },
        { description: '矛盾2', severity: 'warning', resolved: false },
      ]);
      await useAppStore.getState().checkSettingCard();
      expect(toastMock.warning).toHaveBeenCalledWith('发现 2 处矛盾', '1 处需立即修改，详见设定卡');
      expect(useAppStore.getState().getSettingCard()!.contradictions).toHaveLength(2);
      spy.mockRestore();
    });

    it('全部 warning 时 toast 不含"需立即修改"', async () => {
      useAppStore.getState().initSettingCard();
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'checkSettingCardContradictions').mockResolvedValueOnce([
        { description: '矛盾1', severity: 'warning', resolved: false },
      ]);
      await useAppStore.getState().checkSettingCard();
      expect(toastMock.warning).toHaveBeenCalledWith('发现 1 处矛盾', '均为提示性矛盾，可酌情处理');
      spy.mockRestore();
    });

    it('await 期间切换项目：不写入 contradictions', async () => {
      useAppStore.getState().initSettingCard();
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'checkSettingCardContradictions').mockImplementationOnce(async () => {
        useAppStore.setState({ currentProjectId: 'other-project' });
        return [{ description: '矛盾', severity: 'warning', resolved: false }];
      });
      await useAppStore.getState().checkSettingCard();
      // 切换项目后 getSettingCard() 返回 null（other-project 不存在）；
      // 验证 p1 项目的 settingCard 也不应被写入 contradictions
      const p1 = useAppStore.getState().projects.find(p => p.id === 'p1')!;
      expect(p1.settingCard!.contradictions).toBeUndefined();
      useAppStore.setState({ currentProjectId: 'p1', isSettingCardBusy: false });
      spy.mockRestore();
    });

    it('抛错时 toast 错误', async () => {
      useAppStore.getState().initSettingCard();
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'checkSettingCardContradictions').mockRejectedValueOnce(new Error('检查失败'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await useAppStore.getState().checkSettingCard();
      expect(toastMock.error).toHaveBeenCalledWith('检查失败', '检查失败');
      expect(useAppStore.getState().isSettingCardBusy).toBe(false);
      consoleSpy.mockRestore();
      spy.mockRestore();
    });
  });

  describe('generateBlueprint 异步', () => {
    it('无 pid 时 toast 警告', async () => {
      useAppStore.setState({ currentProjectId: null });
      await useAppStore.getState().generateBlueprint();
      expect(toastMock.warning).toHaveBeenCalledWith('未打开项目', '请先打开项目再生成蓝图');
    });

    it('蓝图已锁定时 toast 警告', async () => {
      const bp = makeBlueprint({ lockedAt: '2024-01-01T00:00:00.000Z' });
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      await useAppStore.getState().generateBlueprint();
      expect(toastMock.warning).toHaveBeenCalledWith('蓝图已锁定', '请先解锁蓝图再重新生成');
    });

    it('成功时写入 blueprint + toast 成功', async () => {
      await useAppStore.getState().generateBlueprint();
      expect(useAppStore.getState().getBlueprint()).not.toBeNull();
      expect(useAppStore.getState().isBlueprintBusy).toBe(false);
      expect(toastMock.success).toHaveBeenCalledWith('蓝图已生成', '可在蓝图面板查看与调整');
    });

    it('无 settingCard 时用 project.title 兜底', async () => {
      // 项目无 settingCard，generateBlueprint 仍能成功（用 createEmptySettingCard 兜底）
      await useAppStore.getState().generateBlueprint();
      expect(useAppStore.getState().getBlueprint()).not.toBeNull();
    });

    it('await 期间切换项目：不写入 blueprint', async () => {
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintOverview').mockImplementationOnce(async () => {
        useAppStore.setState({ currentProjectId: 'other-project' });
        return makeBlueprint({ mainline: '不应被写入' });
      });
      await useAppStore.getState().generateBlueprint();
      expect(useAppStore.getState().getBlueprint()?.mainline).not.toBe('不应被写入');
      useAppStore.setState({ currentProjectId: 'p1', isBlueprintBusy: false });
      spy.mockRestore();
    });

    it('抛错时 toast 错误', async () => {
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintOverview').mockRejectedValueOnce(new Error('生成失败'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await useAppStore.getState().generateBlueprint();
      expect(toastMock.error).toHaveBeenCalledWith('蓝图生成失败', '生成失败');
      expect(useAppStore.getState().isBlueprintBusy).toBe(false);
      consoleSpy.mockRestore();
      spy.mockRestore();
    });
  });

  describe('generateBlueprintImpact 异步', () => {
    it('无 blueprint 时 toast 警告', async () => {
      await useAppStore.getState().generateBlueprintImpact('删除主角');
      expect(toastMock.warning).toHaveBeenCalledWith('请先生成蓝图', '尚无蓝图可评估改动影响');
    });

    it('无 pid 时 noop', async () => {
      useAppStore.setState({ currentProjectId: null });
      await useAppStore.getState().generateBlueprintImpact('x');
      expect(toastMock.warning).not.toHaveBeenCalled();
    });

    it('成功时写入 lastChangeImpact + toast 警告', async () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      // mock 返回 high risk 影响报告
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintChangeImpact').mockResolvedValueOnce({
        changeDescription: '删除主角',
        affectedVolumes: [1],
        affectedChapters: ['ch1'],
        affectedForeshadows: [],
        riskLevel: 'high',
        suggestion: '建议先调整结局再删除',
        generatedAt: '2024-01-01',
      });
      await useAppStore.getState().generateBlueprintImpact('删除主角');
      const updated = useAppStore.getState().getBlueprint()!;
      expect(updated.lastChangeImpact).toBeDefined();
      expect(updated.lastChangeImpact!.riskLevel).toBe('high');
      expect(toastMock.warning).toHaveBeenCalledWith('高风险改动', '建议先调整结局再删除');
      expect(useAppStore.getState().isBlueprintBusy).toBe(false);
      spy.mockRestore();
    });

    it('medium risk 时 toast 含"中风险"', async () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintChangeImpact').mockResolvedValueOnce({
        changeDescription: '调整',
        affectedVolumes: [1],
        affectedChapters: [],
        affectedForeshadows: [],
        riskLevel: 'medium',
        suggestion: '',
        generatedAt: '2024-01-01',
      });
      await useAppStore.getState().generateBlueprintImpact('调整');
      expect(toastMock.warning).toHaveBeenCalledWith('中风险改动', '波及 1 个分卷');
      spy.mockRestore();
    });

    it('low risk 时 toast 含"低风险"', async () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintChangeImpact').mockResolvedValueOnce({
        changeDescription: '小改',
        affectedVolumes: [],
        affectedChapters: [],
        affectedForeshadows: [],
        riskLevel: 'low',
        suggestion: '',
        generatedAt: '2024-01-01',
      });
      await useAppStore.getState().generateBlueprintImpact('小改');
      expect(toastMock.warning).toHaveBeenCalledWith('低风险改动', '波及 0 个分卷');
      spy.mockRestore();
    });

    it('await 期间切换项目：不写入 lastChangeImpact', async () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintChangeImpact').mockImplementationOnce(async () => {
        useAppStore.setState({ currentProjectId: 'other-project' });
        return {
          changeDescription: '删除',
          affectedVolumes: [],
          affectedChapters: [],
          affectedForeshadows: [],
          riskLevel: 'high',
          suggestion: '',
          generatedAt: '2024-01-01',
        };
      });
      await useAppStore.getState().generateBlueprintImpact('删除');
      expect(useAppStore.getState().getBlueprint()?.lastChangeImpact).toBeUndefined();
      useAppStore.setState({ currentProjectId: 'p1', isBlueprintBusy: false });
      spy.mockRestore();
    });

    it('抛错时 toast 错误', async () => {
      const bp = makeBlueprint();
      useAppStore.setState({ projects: [makeProject({ blueprint: bp })] });
      const original = await import('@/utils/aiService');
      const spy = vi.spyOn(original, 'generateBlueprintChangeImpact').mockRejectedValueOnce(new Error('评估失败'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await useAppStore.getState().generateBlueprintImpact('删除');
      expect(toastMock.error).toHaveBeenCalledWith('影响评估失败', '评估失败');
      expect(useAppStore.getState().isBlueprintBusy).toBe(false);
      consoleSpy.mockRestore();
      spy.mockRestore();
    });
  });

  // -------------------- 边界分支补测 --------------------
  describe('边界分支补测', () => {
    it('getBlueprint：无 pid 返回 null', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(useAppStore.getState().getBlueprint()).toBeNull();
    });

    it('updateBlueprint：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().updateBlueprint({ mainline: 'x' })).not.toThrow();
    });

    it('updateBlueprint：无 project 时 noop', () => {
      // currentProjectId 指向不存在的项目
      useAppStore.setState({ currentProjectId: 'not-exist' });
      expect(() => useAppStore.getState().updateBlueprint({ mainline: 'x' })).not.toThrow();
    });

    it('lockBlueprint：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().lockBlueprint();
      expect(toastMock.warning).not.toHaveBeenCalled();
    });

    it('unlockBlueprint：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().unlockBlueprint()).not.toThrow();
    });

    it('unlockBlueprint：无 blueprint 时 noop', () => {
      // 项目存在但无 blueprint
      expect(() => useAppStore.getState().unlockBlueprint()).not.toThrow();
      expect(toastMock.info).not.toHaveBeenCalled();
    });

    it('clearBlueprintImpact：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().clearBlueprintImpact()).not.toThrow();
    });

    it('clearBlueprintImpact：无 blueprint 时 noop', () => {
      expect(() => useAppStore.getState().clearBlueprintImpact()).not.toThrow();
    });

    it('addSubplot：title 为空时使用默认"新支线"', () => {
      const s = useAppStore.getState().addSubplot({});
      expect(s!.title).toBe('新支线');
    });

    it('addSubplot：项目不存在时返回 null + toast 错误', () => {
      useAppStore.setState({ currentProjectId: 'not-exist' });
      const s = useAppStore.getState().addSubplot({ title: 'x' });
      expect(s).toBeNull();
      expect(toastMock.error).toHaveBeenCalledWith('添加失败', '未找到当前项目');
    });

    it('updateSubplot：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().updateSubplot('any', { title: 'x' })).not.toThrow();
    });

    it('updateSubplot：subplots 不存在时 noop', () => {
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({ projects: [{ ...project, subplots: undefined }] });
      expect(() => useAppStore.getState().updateSubplot('any', { title: 'x' })).not.toThrow();
    });

    it('deleteSubplot：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().deleteSubplot('any')).not.toThrow();
    });

    it('deleteSubplot：subplots 不存在时 noop', () => {
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({ projects: [{ ...project, subplots: undefined }] });
      expect(() => useAppStore.getState().deleteSubplot('any')).not.toThrow();
    });

    it('progressSubplot：无 pid 时 noop', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().progressSubplot('any', 'ch1')).not.toThrow();
    });

    it('progressSubplot：subplots 不存在时 noop', () => {
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({ projects: [{ ...project, subplots: undefined }] });
      expect(() => useAppStore.getState().progressSubplot('any', 'ch1')).not.toThrow();
    });

    it('progressSubplot：subplotId 不存在时 noop', () => {
      useAppStore.getState().addSubplot({ title: 'a' });
      // 推进不存在的 subplotId，不应抛错
      expect(() => useAppStore.getState().progressSubplot('not-exist', 'ch1')).not.toThrow();
    });

    it('updateUpdateSchedule：项目不存在时 noop', () => {
      useAppStore.setState({ currentProjectId: 'not-exist' });
      expect(() => useAppStore.getState().updateUpdateSchedule({ dailySpeed: 1000 })).not.toThrow();
    });

    it('getStockpileDays：无 pid 返回 0', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(useAppStore.getState().getStockpileDays()).toBe(0);
    });

    it('getStockpileDays：项目无 updateSchedule 时使用默认值', () => {
      // 项目存在但无 updateSchedule → createDefaultUpdateSchedule()，dailySpeed 默认 0 → 返回 0
      expect(useAppStore.getState().getStockpileDays()).toBe(0);
    });

    it('initSettingCard：项目不存在时仍用"未命名作品"兜底', () => {
      useAppStore.setState({ currentProjectId: 'not-exist', projects: [] });
      const card = useAppStore.getState().initSettingCard();
      // 不应抛错（项目不存在时 createEmptySettingCard 用 '未命名作品'）
      // 注意：updateProject 在 currentProjectId 不存在时也是 noop
      expect(card).not.toBeNull();
    });
  });
});
