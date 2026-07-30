/**
 * 流程 1：项目持久化主链路集成测试
 *
 * 验证完整的 store → action → storage(IPC) → store 回环：
 *   1. createProject：新建项目后写入 projects 列表
 *   2. addChapter + updateChapterContent：编辑章节内容
 *   3. saveProject：触发持久化（写到内存 storage mock）
 *   4. 模拟"重启"：清空内存 store 状态，重新 loadProjects + openProject
 *   5. 断言：项目元数据、章节内容、章节顺序完整恢复
 *
 * Mock 策略（与 slice 单测一致，最小化）：
 *   - storage：内存 Map 实现，模拟真实 IPC 持久化的 write→read 回环
 *   - markDirty / triggerSave / clearAutoSaveTimer：no-op，避免 30s 自动保存计时器在测试中触发
 *   - toast：no-op
 *   - 真实 store：使用 useAppStore 单例，所有 slice 逻辑跑真实实现
 *
 * 注：本测试不依赖渲染层；store action 是纯函数，可在 jsdom 下直接驱动。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import type { Project, Chapter } from '@/types';

// ============ 内存存储 mock（与 slice 单测同一套模式）============
// 与单测不同：集成测试不 reset 调用记录，只清空 memoryStore，
// 让 createProject → saveProject → loadProjects 的 IPC 回环真实发生
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
    patchProjects: vi.fn(async (op:
      | { type: 'add'; project: Project }
      | { type: 'remove'; id: string }
      | { type: 'update'; project: Project }
      | { type: 'clear' }
    ): Promise<Project[] | null> => {
      const cur = (memoryStore.get('projects') as Project[]) || [];
      let next = cur;
      if (op.type === 'add') {
        next = cur.some(p => p.id === op.project.id)
          ? cur.map(p => (p.id === op.project.id ? op.project : p))
          : [...cur, op.project];
      } else if (op.type === 'remove') {
        next = cur.filter(p => p.id !== op.id);
      } else if (op.type === 'update') {
        next = cur.some(p => p.id === op.project.id)
          ? cur.map(p => (p.id === op.project.id ? { ...p, ...op.project } : p))
          : [...cur, op.project];
      } else if (op.type === 'clear') {
        next = [];
      }
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
    checkForRecovery: vi.fn().mockResolvedValue(null),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    loadRecoveryDraft: vi.fn().mockResolvedValue(null),
    clearRecoveryDraft: vi.fn().mockResolvedValue(undefined),
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
    // no-op：避免 30s 自动保存计时器在测试中触发，干扰断言
    markDirty: vi.fn(),
    triggerSave: vi.fn(async () => {}),
    clearAutoSaveTimer: vi.fn(),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ============ 重置 Zustand 单例 store ============
// useAppStore 是模块级单例，跨用例共享。每个用例前清空状态，避免污染。
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
  useAppStore.setState(EMPTY_STORE_STATE);
});

describe('流程 1：项目持久化主链路', () => {
  it('新建项目 → 项目出现在列表并已持久化', async () => {
    const store = useAppStore.getState();

    const project = await store.createProject('我的小说', 'blank');

    // 内存 store：当前项目已切换
    expect(useAppStore.getState().currentProjectId).toBe(project.id);
    expect(useAppStore.getState().projects.some(p => p.id === project.id)).toBe(true);

    // 持久化：projects 列表已写入 storage（patchProjects add op）
    const persistedProjects = (memoryStore.get('projects') as Project[]) || [];
    expect(persistedProjects.length).toBe(1);
    expect(persistedProjects[0].id).toBe(project.id);
    expect(persistedProjects[0].title).toBe('我的小说');
  });

  it('完整回环：新建项目 → 编辑章节 → 保存 → 重启 → 重新加载', async () => {
    // ---------- 阶段 1：创建项目 ----------
    let store = useAppStore.getState();
    const project = await store.createProject('持久化测试', 'blank');
    const projectId = project.id;

    // ---------- 阶段 2：添加章节并编辑内容 ----------
    store = useAppStore.getState();
    const ch1 = store.addChapter(null, '第一章', 0, 'chapter');
    const ch2 = store.addChapter(null, '第二章', 1, 'chapter');
    expect(ch1).not.toBeNull();
    expect(ch2).not.toBeNull();
    const ch1Id = ch1!.id;
    const ch2Id = ch2!.id;

    // 切换到 ch1 并写入正文
    useAppStore.getState().setCurrentChapter(ch1Id);
    useAppStore.getState().updateChapterContent(ch1Id, '<p>这是第一章的初始内容。</p>');
    useAppStore.getState().setCurrentChapter(ch2Id);
    useAppStore.getState().updateChapterContent(ch2Id, '<p>这是第二章的初始内容。</p>');

    // 阶段性断言：内存 store 已更新
    const ch1Before = useAppStore.getState().chapters.find(c => c.id === ch1Id);
    const ch2Before = useAppStore.getState().chapters.find(c => c.id === ch2Id);
    expect(ch1Before?.content).toBe('<p>这是第一章的初始内容。</p>');
    expect(ch2Before?.content).toBe('<p>这是第二章的初始内容。</p>');

    // ---------- 阶段 3：触发显式 saveProject ----------
    // currentProjectFilePath 为 null：走 localStorage 多 key 分支
    store = useAppStore.getState();
    const saveResult = await store.saveProject();
    expect(saveResult).toBe(true);

    // 持久化断言：7 个子 key + projects（patchProjects update 已写入）
    expect(memoryStore.has(`project_${projectId}_chapters`)).toBe(true);
    expect(memoryStore.has(`project_${projectId}_characters`)).toBe(true);
    expect(memoryStore.has(`project_${projectId}_versions`)).toBe(true);
    // projects 列表中 updatedAt 已更新
    const persistedProjects = (memoryStore.get('projects') as Project[]) || [];
    expect(persistedProjects.find(p => p.id === projectId)?.updatedAt).toBeTruthy();

    // ---------- 阶段 4：模拟"应用重启" ----------
    // 清空内存 store 状态（不删除 memoryStore 持久化数据）
    useAppStore.setState(EMPTY_STORE_STATE);
    // 此时 store 已"失忆"
    expect(useAppStore.getState().projects).toEqual([]);
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(useAppStore.getState().chapters).toEqual([]);

    // ---------- 阶段 5：重新加载项目列表 ----------
    await useAppStore.getState().loadProjects();
    expect(useAppStore.getState().projects.length).toBe(1);
    expect(useAppStore.getState().projects[0].id).toBe(projectId);
    expect(useAppStore.getState().projects[0].title).toBe('持久化测试');

    // ---------- 阶段 6：重新打开项目 ----------
    await useAppStore.getState().openProject(projectId);

    // ---------- 阶段 7：断言数据完整恢复 ----------
    const restoredState = useAppStore.getState();
    expect(restoredState.currentProjectId).toBe(projectId);
    expect(restoredState.chapters.length).toBe(2);

    // 章节顺序完整恢复
    const restoredCh1 = restoredState.chapters.find(c => c.id === ch1Id);
    const restoredCh2 = restoredState.chapters.find(c => c.id === ch2Id);
    expect(restoredCh1).toBeDefined();
    expect(restoredCh2).toBeDefined();

    // 排序后顺序：第一章 order=0 在前
    const sortedChapters = [...restoredState.chapters].sort((a, b) => a.order - b.order);
    expect(sortedChapters[0].id).toBe(ch1Id);
    expect(sortedChapters[1].id).toBe(ch2Id);

    // 章节内容完整恢复
    expect(restoredCh1?.content).toBe('<p>这是第一章的初始内容。</p>');
    expect(restoredCh2?.content).toBe('<p>这是第二章的初始内容。</p>');
    expect(restoredCh1?.title).toBe('第一章');
    expect(restoredCh2?.title).toBe('第二章');

    // 章节 level / levelType 保留
    expect(restoredCh1?.level).toBe(1);
    expect(restoredCh1?.levelType).toBe('chapter');
    expect(restoredCh2?.level).toBe(1);
    expect(restoredCh2?.levelType).toBe('chapter');
  });

  it('编辑并保存后修改章节内容 → 再次重启 → 恢复最新内容', async () => {
    // 第一轮：创建项目 + 章节
    const project = await useAppStore.getState().createProject('第二轮测试', 'blank');
    const projectId = project.id;
    const chapter = useAppStore.getState().addChapter(null, '唯一章节', 0, 'chapter')!;
    const chapterId = chapter.id;

    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, '<p>初版正文</p>');
    await useAppStore.getState().saveProject();

    // 模拟重启并重新加载
    useAppStore.setState(EMPTY_STORE_STATE);
    await useAppStore.getState().loadProjects();
    await useAppStore.getState().openProject(projectId);

    const ch1 = useAppStore.getState().chapters.find(c => c.id === chapterId);
    expect(ch1?.content).toBe('<p>初版正文</p>');

    // 第二轮：再次编辑 + 保存
    useAppStore.getState().updateChapterContent(chapterId, '<p>修改后的正文</p>');
    await useAppStore.getState().saveProject();

    // 再次模拟重启
    useAppStore.setState(EMPTY_STORE_STATE);
    await useAppStore.getState().loadProjects();
    await useAppStore.getState().openProject(projectId);

    const ch2 = useAppStore.getState().chapters.find(c => c.id === chapterId);
    expect(ch2?.content).toBe('<p>修改后的正文</p>');
  });

  it('删除项目后重启 → 项目不再出现在列表', async () => {
    const project = await useAppStore.getState().createProject('待删除', 'blank');
    const projectId = project.id;
    useAppStore.getState().addChapter(null, '章节', 0, 'chapter');
    await useAppStore.getState().saveProject();

    // 删除项目（currentProjectId === projectId，会触发内存状态重置）
    await useAppStore.getState().deleteProject(projectId);

    // 持久化层：projects 列表已不含该项目
    const persistedProjects = (memoryStore.get('projects') as Project[]) || [];
    expect(persistedProjects.find(p => p.id === projectId)).toBeUndefined();

    // 模拟重启：项目不再出现
    useAppStore.setState(EMPTY_STORE_STATE);
    await useAppStore.getState().loadProjects();
    expect(useAppStore.getState().projects.find(p => p.id === projectId)).toBeUndefined();
    expect(useAppStore.getState().projects.length).toBe(0);
  });
});
