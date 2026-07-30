/**
 * 流程 3：崩溃恢复集成测试
 *
 * 验证 store → storage.saveRecoveryDraft → 模拟崩溃 → checkForRecovery → restoreRecoveryDraft 回环：
 *   1. 创建项目 + 添加章节 + saveProject 持久化初始内容
 *   2. 编辑章节内容（自动触发 saveRecoveryDraft 写入未保存的草稿）
 *   3. 模拟"崩溃"：清空内存 store 状态，但不调用 saveProject（草稿在 storage 中保留）
 *   4. 模拟"重启"：loadProjects + openProject + checkForRecovery
 *   5. 断言：recoveryDraft 出现在 store；章节内容仍是崩溃前的旧内容（未保存的部分丢失）
 *   6. restoreRecoveryDraft：断言章节内容恢复为崩溃前未保存的草稿内容
 *
 * Mock 策略：
 *   - storage：内存 Map 实现真实 IPC 行为
 *     · saveRecoveryDraft / loadRecoveryDraft / clearRecoveryDraft 三个方法真实读写 memoryStore
 *       （与 ElectronStorage / LocalStorage 行为一致），让崩溃恢复链路真实可测
 *     · 其余方法（get/set/patchProjects 等）同样真实写入 memoryStore
 *   - markDirty / triggerSave / clearAutoSaveTimer：no-op
 *   - toast：no-op
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import type { Project, Chapter } from '@/types';
// RecoveryDraft 类型在 store/appState 中定义；这里仅用于类型断言
type RecoveryDraftShape = { projectId: string; chapterId: string; content: string; timestamp: string };

// ============ 内存存储 mock（关键：saveRecoveryDraft 真实落盘）============
const { memoryStore, mockStorage } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();

  const mockStorage = {
    get: vi.fn(async <T>(key: string, defaultValue: T): Promise<T> => {
      return memoryStore.has(key) ? (memoryStore.get(key) as T) : defaultValue;
    }),
    set: vi.fn(async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value);
    }),
    setMany: vi.fn(async (entries: Record<string, unknown>): Promise<void> => {
      for (const [key, value] of Object.entries(entries)) {
        memoryStore.set(key, value);
      }
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      memoryStore.delete(key);
    }),
    patchProjects: vi.fn(async (op: { type: 'add'; project: Project } | { type: 'remove'; id: string } | { type: 'update'; project: Project } | { type: 'clear' }): Promise<Project[] | null> => {
      const cur = (memoryStore.get('projects') as Project[]) || [];
      let next = cur;
      if (op.type === 'add') next = cur.some(p => p.id === op.project.id) ? cur.map(p => (p.id === op.project.id ? op.project : p)) : [...cur, op.project];
      else if (op.type === 'remove') next = cur.filter(p => p.id !== op.id);
      else if (op.type === 'update') next = cur.some(p => p.id === op.project.id) ? cur.map(p => (p.id === op.project.id ? { ...p, ...op.project } : p)) : [...cur, op.project];
      else next = [];
      memoryStore.set('projects', next);
      return next;
    }),
    readProjectFile: vi.fn().mockResolvedValue(null),
    writeProjectFile: vi.fn().mockResolvedValue(false),
    backupProjectFile: vi.fn().mockResolvedValue(false),
    listBackups: vi.fn().mockResolvedValue([]),
    restoreBackup: vi.fn().mockResolvedValue(false),
    openFileDialog: vi.fn().mockResolvedValue(null),
    saveFileDialog: vi.fn().mockResolvedValue(null),
    // 关键：崩溃恢复链路真实读写 memoryStore，模拟 IPC 行为
    checkForRecovery: vi.fn(async () => {
      return memoryStore.get('recovery_draft') as RecoveryDraftShape | null || null;
    }),
    saveRecoveryDraft: vi.fn(async (projectId: string, chapterId: string, content: string): Promise<void> => {
      memoryStore.set('recovery_draft', {
        projectId, chapterId, content,
        timestamp: new Date().toISOString(),
      });
    }),
    loadRecoveryDraft: vi.fn(async (): Promise<RecoveryDraftShape | null> => {
      return (memoryStore.get('recovery_draft') as RecoveryDraftShape) || null;
    }),
    clearRecoveryDraft: vi.fn(async (): Promise<void> => {
      memoryStore.delete('recovery_draft');
    }),
    saveAISettings: vi.fn().mockResolvedValue(true),
    loadAISettings: vi.fn().mockResolvedValue(null),
  };

  return { memoryStore, mockStorage };
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
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const EMPTY_STORE_STATE = {
  projects: [] as Project[],
  currentProjectId: null as string | null,
  currentProjectFilePath: null as string | null,
  lastSavedAt: null as string | null,
  isSaving: false,
  chapters: [] as Chapter[],
  currentChapterId: null as string | null,
  pendingEditorInsert: null,
  pendingScrollTo: null,
  contentEpoch: 0,
  isAIGenerating: false,
  characters: [],
  settingCategories: [],
  settingItems: [],
  foreshadows: [],
  materials: [],
  versions: {} as Record<string, unknown[]>,
  histories: {},
  conflicts: [],
  aiSuggestions: [],
  analysis: {},
  aiSettings: { ...DEFAULT_AI_SETTINGS },
  recoveryDraft: null,
  subplots: [],
  updateSchedule: null,
};

beforeEach(() => {
  memoryStore.clear();
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.setMany.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  mockStorage.saveRecoveryDraft.mockClear();
  mockStorage.loadRecoveryDraft.mockClear();
  mockStorage.clearRecoveryDraft.mockClear();
  useAppStore.setState(EMPTY_STORE_STATE);
});

describe('流程 3：崩溃恢复', () => {
  it('完整崩溃恢复链路：保存→编辑未保存→崩溃→重启→恢复', async () => {
    // ---------- 阶段 1：创建项目 + 章节 + 持久化初始内容 ----------
    const project = await useAppStore.getState().createProject('崩溃恢复测试', 'blank');
    const projectId = project.id;
    const chapter = useAppStore.getState().addChapter(null, '第一章', 0, 'chapter')!;
    const chapterId = chapter.id;

    // 切换到该章节并写入初始内容
    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, '<p>这是初始保存的正文。</p>');
    const saveOk = await useAppStore.getState().saveProject();
    expect(saveOk).toBe(true);

    // 阶段性断言：持久化的章节内容是初始版本
    const persistedChapters = (memoryStore.get(`project_${projectId}_chapters`) as Chapter[]) || [];
    expect(persistedChapters.find(c => c.id === chapterId)?.content).toBe('<p>这是初始保存的正文。</p>');

    // ---------- 阶段 2：编辑到新内容，触发 saveRecoveryDraft（但不 saveProject）----------
    useAppStore.getState().updateChapterContent(chapterId, '<p>这是用户继续编辑但尚未保存的新内容！</p>');

    // saveRecoveryDraft 被 chapterSlice.updateChapterContent 调用（currentChapterId === chapterId）
    expect(mockStorage.saveRecoveryDraft).toHaveBeenCalledWith(
      projectId,
      chapterId,
      '<p>这是用户继续编辑但尚未保存的新内容！</p>',
    );
    // memoryStore 中确实有 recovery_draft
    const draftInStore = memoryStore.get('recovery_draft') as RecoveryDraftShape;
    expect(draftInStore).not.toBeNull();
    expect(draftInStore.projectId).toBe(projectId);
    expect(draftInStore.chapterId).toBe(chapterId);
    expect(draftInStore.content).toBe('<p>这是用户继续编辑但尚未保存的新内容！</p>');

    // 此时章节持久化版本仍是初始内容（saveProject 未被调用）
    const persistedChaptersAfterEdit = (memoryStore.get(`project_${projectId}_chapters`) as Chapter[]) || [];
    expect(persistedChaptersAfterEdit.find(c => c.id === chapterId)?.content).toBe('<p>这是初始保存的正文。</p>');

    // ---------- 阶段 3：模拟"崩溃"——只清空 store 状态，不清 memoryStore ----------
    useAppStore.setState(EMPTY_STORE_STATE);
    expect(useAppStore.getState().chapters).toEqual([]);
    expect(useAppStore.getState().recoveryDraft).toBeNull();
    // 持久化数据保留
    expect(memoryStore.get('recovery_draft')).toBeTruthy();
    expect(memoryStore.has(`project_${projectId}_chapters`)).toBe(true);

    // ---------- 阶段 4：模拟"重启"——loadProjects + openProject + checkForRecovery ----------
    await useAppStore.getState().loadProjects();
    await useAppStore.getState().openProject(projectId);
    await useAppStore.getState().checkForRecovery();

    // ---------- 阶段 5：断言恢复提示出现 ----------
    const restoredState = useAppStore.getState();
    expect(restoredState.recoveryDraft).not.toBeNull();
    expect(restoredState.recoveryDraft?.projectId).toBe(projectId);
    expect(restoredState.recoveryDraft?.chapterId).toBe(chapterId);
    expect(restoredState.recoveryDraft?.content).toBe('<p>这是用户继续编辑但尚未保存的新内容！</p>');

    // 章节内容仍是崩溃前的旧版本（saveProject 之前的版本）
    const restoredChapter = restoredState.chapters.find(c => c.id === chapterId);
    expect(restoredChapter).toBeDefined();
    expect(restoredChapter?.content).toBe('<p>这是初始保存的正文。</p>');

    // ---------- 阶段 6：调用 restoreRecoveryDraft ----------
    useAppStore.getState().restoreRecoveryDraft();

    // ---------- 阶段 7：断言章节内容恢复为崩溃前的草稿内容 ----------
    const finalChapter = useAppStore.getState().chapters.find(c => c.id === chapterId);
    expect(finalChapter?.content).toBe('<p>这是用户继续编辑但尚未保存的新内容！</p>');

    // 恢复后 recoveryDraft 已清空（store 内）
    expect(useAppStore.getState().recoveryDraft).toBeNull();
    // storage 中 recovery_draft 也被 clearRecoveryDraft 清除
    expect(mockStorage.clearRecoveryDraft).toHaveBeenCalled();
    expect(memoryStore.has('recovery_draft')).toBe(false);
  });

  it('草稿归属项目与当前项目不一致时拒绝恢复（不污染错误章节）', async () => {
    // ---------- 阶段 1：项目 A 编辑章节，草稿归属 A ----------
    const projectA = await useAppStore.getState().createProject('项目A', 'blank');
    const projectAId = projectA.id;
    const chapterA = useAppStore.getState().addChapter(null, 'A章', 0, 'chapter')!;
    useAppStore.getState().setCurrentChapter(chapterA.id);
    useAppStore.getState().updateChapterContent(chapterA.id, '<p>项目A已保存内容</p>');
    await useAppStore.getState().saveProject();

    // 继续编辑（未保存）——触发 saveRecoveryDraft，归属项目A
    useAppStore.getState().updateChapterContent(chapterA.id, '<p>项目A未保存的草稿内容</p>');

    // 此时 memoryStore 中 recovery_draft 归属项目A
    const draft = memoryStore.get('recovery_draft') as RecoveryDraftShape;
    expect(draft.projectId).toBe(projectAId);
    expect(draft.content).toBe('<p>项目A未保存的草稿内容</p>');

    // ---------- 阶段 2：创建项目 B（不编辑任何章节，避免覆盖 A 的草稿）----------
    const projectB = await useAppStore.getState().createProject('项目B', 'blank');
    const projectBId = projectB.id;
    // 注意：不调用 addChapter / updateChapterContent，避免触发 saveRecoveryDraft 覆盖 A 的草稿
    await useAppStore.getState().saveProject();

    // 草稿仍归属 A（createProject / saveProject 都不会调 saveRecoveryDraft）
    const draftAfterB = memoryStore.get('recovery_draft') as RecoveryDraftShape;
    expect(draftAfterB.projectId).toBe(projectAId);

    // ---------- 阶段 3：模拟崩溃与重启，打开项目 B ----------
    useAppStore.setState(EMPTY_STORE_STATE);
    await useAppStore.getState().loadProjects();
    await useAppStore.getState().openProject(projectBId);
    await useAppStore.getState().checkForRecovery();

    // recoveryDraft 被加载到 store（归属 A，与当前项目 B 不一致）
    expect(useAppStore.getState().recoveryDraft).not.toBeNull();
    expect(useAppStore.getState().recoveryDraft?.projectId).toBe(projectAId);
    expect(useAppStore.getState().currentProjectId).toBe(projectBId);

    // ---------- 阶段 4：在项目 B 中调用 restoreRecoveryDraft → 应被拒绝 ----------
    const chaptersBefore = useAppStore.getState().chapters.map(c => ({ id: c.id, content: c.content }));
    useAppStore.getState().restoreRecoveryDraft();

    // 章节内容未被污染（项目 B 的章节列表不变）
    const chaptersAfter = useAppStore.getState().chapters.map(c => ({ id: c.id, content: c.content }));
    expect(chaptersAfter).toEqual(chaptersBefore);

    // recoveryDraft 未被清除（restoreRecoveryDraft 在 projectId 不匹配时不清除草稿）
    expect(useAppStore.getState().recoveryDraft).not.toBeNull();
  });

  it('用户主动丢弃草稿 → recoveryDraft 与 storage 均被清除', async () => {
    await useAppStore.getState().createProject('丢弃测试', 'blank');
    const chapter = useAppStore.getState().addChapter(null, '章', 0, 'chapter')!;
    useAppStore.getState().setCurrentChapter(chapter.id);
    useAppStore.getState().updateChapterContent(chapter.id, '<p>未保存内容</p>');

    // 草稿已落盘
    expect(memoryStore.has('recovery_draft')).toBe(true);

    // 用户丢弃
    useAppStore.getState().discardRecoveryDraft();

    expect(useAppStore.getState().recoveryDraft).toBeNull();
    expect(mockStorage.clearRecoveryDraft).toHaveBeenCalled();
    expect(memoryStore.has('recovery_draft')).toBe(false);
  });
});
