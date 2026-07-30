/**
 * projectSlice 单元测试
 *
 * 测试策略：
 * - projectSlice 通过 createProjectSlice 注入 useAppStore 单例，因此直接调用
 *   useAppStore.getState() 触发各 action，再用 getState() 验证状态。
 * - vi.mock('@/utils/storage') 替换 storage 为内存实现，并把 markDirty /
 *   triggerSave / clearAutoSaveTimer 改为 no-op，避免 30s 自动保存计时器干扰测试。
 * - 每个测试前用 useAppStore.setState 重置关键字段，避免单例 store 跨用例污染。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { createDefaultProject } from '@/constants/mockData';
import type { Project } from '@/types';

// ============ 内存存储 mock ============
// 用 vi.hoisted 让 mock factory 与测试代码共享同一份 Map 与 mock 对象
// vi.mock factory 会被 hoist 到文件顶部，普通 const 无法被 factory 引用
const { memoryStore, mockStorage } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();

  // storage 的内存实现：与 ElectronStorage / LocalStorage 接口一致
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

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

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
  toast: toastMock,
}));

// ============ 测试前重置 store 与 memoryStore ============
beforeEach(() => {
  memoryStore.clear();
  // 清除 mock 调用记录，保留实现
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.setMany.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  // 清除 toast mock 调用记录
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();

  // 重置 store 关键状态，避免上一个用例残留
  useAppStore.setState({
    projects: [],
    currentProjectId: null,
    currentProjectFilePath: null,
    lastSavedAt: null,
    isSaving: false,
    chapters: [],
    characters: [],
    settingCategories: [],
    settingItems: [],
    foreshadows: [],
    materials: [],
    versions: {},
    conflicts: [],
    aiSuggestions: [],
    currentChapterId: null,
    isAIGenerating: false,
    searchQuery: '',
    searchResults: [],
    analysis: {},
    subplots: [],
    updateSchedule: null,
  });
});

// ============ 测试用例 ============

describe('projectSlice', () => {
  // -------------------- createProject --------------------
  describe('createProject', () => {
    it('返回 Project 对象，含 id 和 title', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'blank');
      expect(project).toBeTruthy();
      expect(typeof project.id).toBe('string');
      expect(project.id.length).toBeGreaterThan(0);
      expect(project.title).toBe('测试项目');
    });

    it('state.currentProjectId 等于返回的 project.id', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'blank');
      expect(useAppStore.getState().currentProjectId).toBe(project.id);
    });

    it('state.projects 包含新项目', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'blank');
      const projects = useAppStore.getState().projects;
      expect(projects.some(p => p.id === project.id)).toBe(true);
    });

    it('blank 模板：state.chapters 为空数组', async () => {
      await useAppStore.getState().createProject('测试项目', 'blank');
      expect(useAppStore.getState().chapters).toEqual([]);
    });

    it('three-act 模板：state.chapters 有 3 个（第一幕/第二幕/第三幕）', async () => {
      await useAppStore.getState().createProject('测试项目', 'three-act');
      const chapters = useAppStore.getState().chapters;
      expect(chapters).toHaveLength(3);
      expect(chapters.map(c => c.title)).toEqual([
        '第一幕：建置',
        '第二幕：对抗',
        '第三幕：结局',
      ]);
    });

    it('chapter 模板：state.chapters 有 10 个', async () => {
      await useAppStore.getState().createProject('测试项目', 'chapter');
      const chapters = useAppStore.getState().chapters;
      expect(chapters).toHaveLength(10);
      expect(chapters.map(c => c.title)).toEqual([
        '第1章', '第2章', '第3章', '第4章', '第5章',
        '第6章', '第7章', '第8章', '第9章', '第10章',
      ]);
    });

    it('three-act 模板：每章 levelType=book, level=1, parentId=null, order 递增', async () => {
      await useAppStore.getState().createProject('测试项目', 'three-act');
      const chapters = useAppStore.getState().chapters;
      chapters.forEach((c, i) => {
        expect(c.levelType).toBe('book');
        expect(c.level).toBe(1);
        expect(c.parentId).toBeNull();
        expect(c.order).toBe(i);
        expect(c.wordCount).toBe(0);
        expect(c.content).toBe('');
      });
    });

    it('chapter 模板：每章 levelType=chapter, level=1, parentId=null, order 递增', async () => {
      await useAppStore.getState().createProject('测试项目', 'chapter');
      const chapters = useAppStore.getState().chapters;
      chapters.forEach((c, i) => {
        expect(c.levelType).toBe('chapter');
        expect(c.level).toBe(1);
        expect(c.parentId).toBeNull();
        expect(c.order).toBe(i);
      });
    });

    it('默认 template 参数（不传第二参）等价于 blank', async () => {
      // createProject 签名 template = 'blank'，不传时应走 blank 分支
      await useAppStore.getState().createProject('默认模板项目');
      expect(useAppStore.getState().chapters).toEqual([]);
    });

    it('未知 template 值走隐式 else 分支：chapters 为空', async () => {
      // 'foo' 不匹配 'three-act' 也不匹配 'chapter'，落入 else → initialChapters=[]
      await useAppStore.getState().createProject('未知模板项目', 'foo' as never);
      expect(useAppStore.getState().chapters).toEqual([]);
    });

    it('调用 patchProjects 持久化（add 操作）', async () => {
      await useAppStore.getState().createProject('测试项目', 'blank');
      expect(mockStorage.patchProjects).toHaveBeenCalled();
      const call = mockStorage.patchProjects.mock.calls[0][0];
      expect(call.type).toBe('add');
      // discriminated union narrowing 在 vi.fn mock 下不会自动收窄，用 as 显式断言
      expect((call as { project?: Project }).project).toBeTruthy();
    });
  });

  // -------------------- deleteProject --------------------
  describe('deleteProject', () => {
    it('从 state.projects 中移除被删除的项目', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'blank');
      await useAppStore.getState().deleteProject(project.id);
      const projects = useAppStore.getState().projects;
      expect(projects.some(p => p.id === project.id)).toBe(false);
    });

    it('删除当前项目：currentProjectId 置 null、chapters 清空', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'three-act');
      // 此时 currentProjectId === project.id，chapters 有 3 个
      expect(useAppStore.getState().currentProjectId).toBe(project.id);

      await useAppStore.getState().deleteProject(project.id);

      const state = useAppStore.getState();
      expect(state.currentProjectId).toBeNull();
      expect(state.chapters).toEqual([]);
    });

    it('删除当前项目：所有相关域被重置（P32 修复）', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'blank');
      // 注入非空状态，验证删除后会被重置
      useAppStore.setState({
        characters: [{ id: 'c1', projectId: project.id, name: '角色', role: 'protagonist', color: '#fff', profile: {}, relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [], createdAt: '', updatedAt: '' } as never],
        settingCategories: [{ id: 'sc1', projectId: project.id, name: '分类', icon: '📄', color: '#fff', order: 0, parentId: null } as never],
        settingItems: [{ id: 'si1', projectId: project.id, categoryId: 'sc1', name: '设定', description: '', content: '', references: [], tags: [], order: 0, createdAt: '', updatedAt: '' } as never],
        foreshadows: [{ id: 'f1', projectId: project.id, title: '伏笔', description: '', status: 'planted', plantedChapterId: null, payoffChapterId: null, priority: 'medium', relatedCharacters: [], relatedSettings: [], chaptersSinceMention: 0, notes: '', createdAt: '', updatedAt: '' } as never],
        materials: [{ id: 'm1', projectId: project.id, title: '素材', type: 'inspiration', content: '', tags: [], category: '', references: [], pinned: false, createdAt: '', updatedAt: '' } as never],
        versions: { ch1: [] as never },
      });

      await useAppStore.getState().deleteProject(project.id);

      const state = useAppStore.getState();
      expect(state.characters).toEqual([]);
      expect(state.settingCategories).toEqual([]);
      expect(state.settingItems).toEqual([]);
      expect(state.foreshadows).toEqual([]);
      expect(state.materials).toEqual([]);
      expect(state.versions).toEqual({});
      expect(state.currentProjectFilePath).toBeNull();
      expect(state.currentChapterId).toBeNull();
    });

    it('删除非当前项目：当前项目状态保持不变', async () => {
      const p1 = await useAppStore.getState().createProject('项目1', 'three-act');
      const p2 = await useAppStore.getState().createProject('项目2', 'chapter');
      // 当前项目为 p2，章节有 10 个
      expect(useAppStore.getState().currentProjectId).toBe(p2.id);

      // 删除 p1（非当前）
      await useAppStore.getState().deleteProject(p1.id);

      const state = useAppStore.getState();
      expect(state.projects.some(p => p.id === p1.id)).toBe(false);
      // 当前项目仍是 p2，章节未变
      expect(state.currentProjectId).toBe(p2.id);
      expect(state.chapters).toHaveLength(10);
    });
  });

  // -------------------- updateProject --------------------
  describe('updateProject', () => {
    it('更新项目标题', async () => {
      const project = await useAppStore.getState().createProject('旧标题', 'blank');
      useAppStore.getState().updateProject(project.id, { title: '新标题' });
      const updated = useAppStore.getState().projects.find(p => p.id === project.id);
      expect(updated?.title).toBe('新标题');
    });

    it('更新会调用 patchProjects（update 操作）', async () => {
      const project = await useAppStore.getState().createProject('旧标题', 'blank');
      mockStorage.patchProjects.mockClear();
      useAppStore.getState().updateProject(project.id, { title: '新标题' });
      expect(mockStorage.patchProjects).toHaveBeenCalled();
      const call = mockStorage.patchProjects.mock.calls[0][0];
      expect(call.type).toBe('update');
    });

    it('项目不存在时安全跳过', async () => {
      // 不应抛错
      useAppStore.getState().updateProject('不存在的-id', { title: 'x' });
      expect(useAppStore.getState().projects).toEqual([]);
    });
  });

  // -------------------- openProject 并发守卫 --------------------
  describe('openProject 并发守卫', () => {
    it('快速连续 openProject：最终 currentProjectId 为最后一次请求（不被旧请求覆盖）', async () => {
      const p_a = { ...createDefaultProject('A'), id: 'a' };
      const p_b = { ...createDefaultProject('B'), id: 'b' };
      useAppStore.setState({ projects: [p_a, p_b], currentProjectId: null });

      // 同步发起两次 openProject：reqId 自增，a 的 await 期间 b 进入并 ++reqId
      // a 在 await 后比对 reqId 不一致直接 return，不会覆盖 b 的状态
      const pa = useAppStore.getState().openProject('a');
      const pb = useAppStore.getState().openProject('b');

      await Promise.all([pa, pb]);

      const state = useAppStore.getState();
      expect(state.currentProjectId).toBe('b');
    });
  });

  // -------------------- closeProject --------------------
  describe('closeProject', () => {
    it('关闭项目：currentProjectId 置 null', async () => {
      await useAppStore.getState().createProject('测试项目', 'three-act');
      expect(useAppStore.getState().currentProjectId).not.toBeNull();

      await useAppStore.getState().closeProject();

      expect(useAppStore.getState().currentProjectId).toBeNull();
    });

    it('关闭项目：chapters 与所有相关域被重置', async () => {
      const project = await useAppStore.getState().createProject('测试项目', 'three-act');
      // 注入额外状态，验证 closeProject 会重置
      useAppStore.setState({
        characters: [{ id: 'c1', projectId: project.id, name: '角色', role: 'protagonist', color: '#fff', profile: {}, relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [], createdAt: '', updatedAt: '' } as never],
        versions: { ch1: [] as never },
      });
      expect(useAppStore.getState().chapters).toHaveLength(3);

      await useAppStore.getState().closeProject();

      const state = useAppStore.getState();
      expect(state.chapters).toEqual([]);
      expect(state.characters).toEqual([]);
      expect(state.versions).toEqual({});
      expect(state.currentProjectFilePath).toBeNull();
      expect(state.currentChapterId).toBeNull();
      expect(state.lastSavedAt).toBeNull();
    });
  });

  // -------------------- loadProjects --------------------
  describe('loadProjects', () => {
    it('从 storage 加载项目列表', async () => {
      const p1 = createDefaultProject('P1');
      const p2 = createDefaultProject('P2');
      memoryStore.set('projects', [p1, p2]);

      await useAppStore.getState().loadProjects();

      expect(useAppStore.getState().projects).toEqual([p1, p2]);
    });

    it('storage 返回 null（非数组）时回退到空数组（P31 修复）', async () => {
      memoryStore.set('projects', null);

      await useAppStore.getState().loadProjects();

      expect(useAppStore.getState().projects).toEqual([]);
    });

    it('storage 返回对象（非数组）时回退到空数组', async () => {
      memoryStore.set('projects', { not: 'an array' });

      await useAppStore.getState().loadProjects();

      expect(useAppStore.getState().projects).toEqual([]);
    });

    it('storage 中无 projects 键时使用默认值 []', async () => {
      // memoryStore 已在 beforeEach 清空，无 'projects' 键
      await useAppStore.getState().loadProjects();

      expect(useAppStore.getState().projects).toEqual([]);
    });
  });

  // -------------------- openProjectFile --------------------
  describe('openProjectFile', () => {
    it('readProjectFile 返回 null 时返回 false', async () => {
      mockStorage.readProjectFile.mockResolvedValueOnce(null);
      const ok = await useAppStore.getState().openProjectFile('/path/a.cwp');
      expect(ok).toBe(false);
    });

    it('readProjectFile 返回完整数据时设置状态并返回 true', async () => {
      const project = createDefaultProject('文件项目');
      const chapters = [{
        id: 'ch1', projectId: project.id, parentId: null, title: '第一章',
        summary: '', order: 0, level: 1, levelType: 'chapter' as const,
        status: 'draft' as const, wordCount: 100, content: '<p>x</p>',
        createdAt: '', updatedAt: '',
      }];
      mockStorage.readProjectFile.mockResolvedValueOnce({
        project, chapters, characters: [], settingCategories: [],
        settingItems: [], foreshadows: [], materials: [], versions: {},
      });

      const ok = await useAppStore.getState().openProjectFile('/path/a.cwp');

      expect(ok).toBe(true);
      const state = useAppStore.getState();
      expect(state.currentProjectId).toBe(project.id);
      expect(state.currentProjectFilePath).toBe('/path/a.cwp');
      expect(state.chapters).toEqual(chapters);
      expect(state.currentChapterId).toBe('ch1');
    });

    it('并发守卫：旧请求晚于新请求返回时被丢弃', async () => {
      // 让 readProjectFile 不立即 resolve，控制 resolve 顺序
      let resolveA!: (v: unknown) => void;
      let resolveB!: (v: unknown) => void;
      mockStorage.readProjectFile
        .mockReturnValueOnce(new Promise(r => { resolveA = r; }))
        .mockReturnValueOnce(new Promise(r => { resolveB = r; }));

      const pa = useAppStore.getState().openProjectFile('/a.cwp');
      const pb = useAppStore.getState().openProjectFile('/b.cwp');

      // 先 resolve B（新请求），再 resolve A（旧请求）
      const projectB = createDefaultProject('B');
      resolveB({ project: projectB, chapters: [], characters: [], settingCategories: [], settingItems: [], foreshadows: [], materials: [], versions: {} });
      await pb;

      const projectA = createDefaultProject('A');
      resolveA({ project: projectA, chapters: [], characters: [], settingCategories: [], settingItems: [], foreshadows: [], materials: [], versions: {} });
      await pa;

      // 旧请求 A 被丢弃，currentProjectId 仍为 B
      expect(useAppStore.getState().currentProjectId).toBe(projectB.id);
    });

    it('从已有项目切换到新文件项目时清理图片缓存', async () => {
      // 先创建一个项目（currentProjectId 非空）
      await useAppStore.getState().createProject('当前项目', 'blank');
      expect(useAppStore.getState().currentProjectId).not.toBeNull();

      const newProject = createDefaultProject('新文件项目');
      newProject.id = 'different-id';
      mockStorage.readProjectFile.mockResolvedValueOnce({
        project: newProject, chapters: [], characters: [], settingCategories: [],
        settingItems: [], foreshadows: [], materials: [], versions: {},
      });

      await useAppStore.getState().openProjectFile('/path.cwp');
      expect(useAppStore.getState().currentProjectId).toBe('different-id');
    });
  });

  // -------------------- saveProject --------------------
  describe('saveProject', () => {
    it('无 currentProjectId 时返回 false', async () => {
      const ok = await useAppStore.getState().saveProject();
      expect(ok).toBe(false);
    });

    it('isSaving=true 时互斥跳过，返回 false', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      useAppStore.setState({ isSaving: true });
      const ok = await useAppStore.getState().saveProject();
      expect(ok).toBe(false);
    });

    it('无 filePath 走 localStorage 分支：成功返回 true 并设置 lastSavedAt', async () => {
      const project = await useAppStore.getState().createProject('测试', 'blank');
      // createProject 后 currentProjectFilePath 为 null，走 localStorage 分支
      const ok = await useAppStore.getState().saveProject();
      expect(ok).toBe(true);
      expect(useAppStore.getState().lastSavedAt).not.toBeNull();
      // 验证 storage.setMany 被调用（chapters/characters 等多键合并为一次批量写入）
      expect(mockStorage.setMany).toHaveBeenCalled();
      // 验证 patchProjects 被调用（update 操作，更新 totalWords/updatedAt）
      const updateCall = mockStorage.patchProjects.mock.calls.find(
        c => (c[0] as { type: string; project?: { id: string } }).type === 'update'
          && (c[0] as { project?: { id: string } }).project?.id === project.id,
      );
      expect(updateCall).toBeDefined();
    });

    it('有 filePath 走文件分支：writeProjectFile 成功返回 true', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      useAppStore.setState({ currentProjectFilePath: '/path.cwp' });
      mockStorage.writeProjectFile.mockResolvedValueOnce(true);

      const ok = await useAppStore.getState().saveProject();
      expect(ok).toBe(true);
      expect(mockStorage.writeProjectFile).toHaveBeenCalled();
      expect(mockStorage.backupProjectFile).toHaveBeenCalled();
      expect(useAppStore.getState().lastSavedAt).not.toBeNull();
    });

    it('有 filePath 但 writeProjectFile 返回 false：toast.error 并返回 false', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      useAppStore.setState({ currentProjectFilePath: '/path.cwp' });
      mockStorage.writeProjectFile.mockResolvedValueOnce(false);

      const ok = await useAppStore.getState().saveProject();
      expect(ok).toBe(false);
    });

    it('有 filePath 但 writeProjectFile 抛错：toast.error 并返回 false', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      useAppStore.setState({ currentProjectFilePath: '/path.cwp' });
      mockStorage.writeProjectFile.mockRejectedValueOnce(new Error('disk full'));

      const ok = await useAppStore.getState().saveProject();
      expect(ok).toBe(false);
    });

    it('saveProject 完成后 isSaving 复位为 false', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      await useAppStore.getState().saveProject();
      expect(useAppStore.getState().isSaving).toBe(false);
    });
  });

  // -------------------- saveProjectAs --------------------
  describe('saveProjectAs', () => {
    it('无 currentProjectId 时返回 null', async () => {
      const result = await useAppStore.getState().saveProjectAs();
      expect(result).toBeNull();
    });

    it('saveFileDialog 取消（返回 null）时返回 null', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      mockStorage.saveFileDialog.mockResolvedValueOnce(null);

      const result = await useAppStore.getState().saveProjectAs();
      expect(result).toBeNull();
    });

    it('saveFileDialog 成功 + saveProject 成功：返回 filePath', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      mockStorage.saveFileDialog.mockResolvedValueOnce('/new/path.cwp');
      // saveProjectAs 会先 set currentProjectFilePath，随后 saveProject 走文件分支
      // 需要 writeProjectFile 返回 true 才能成功
      mockStorage.writeProjectFile.mockResolvedValueOnce(true);

      const result = await useAppStore.getState().saveProjectAs();
      expect(result).toBe('/new/path.cwp');
      expect(useAppStore.getState().currentProjectFilePath).toBe('/new/path.cwp');
    });

    it('saveFileDialog 成功 + saveProject 失败：返回 null', async () => {
      await useAppStore.getState().createProject('测试', 'blank');
      mockStorage.saveFileDialog.mockResolvedValueOnce('/new/path.cwp');
      // 让 writeProjectFile 失败（saveProjectAs 会先 set filePath 再调用 saveProject）
      useAppStore.setState({ currentProjectFilePath: '/new/path.cwp' });
      mockStorage.writeProjectFile.mockResolvedValueOnce(false);

      const result = await useAppStore.getState().saveProjectAs();
      expect(result).toBeNull();
    });

    it('默认文件名替换非法字符', async () => {
      const project = await useAppStore.getState().createProject('测试/项目:*', 'blank');
      mockStorage.saveFileDialog.mockResolvedValueOnce(null);
      await useAppStore.getState().saveProjectAs();
      // 验证 saveFileDialog 收到的默认名已替换非法字符
      const call = mockStorage.saveFileDialog.mock.calls[0][0] as string;
      expect(call).toBe('测试_项目__.cwp');
      // 防止 project 未使用告警
      expect(project.id).toBeTruthy();
    });
  });

  // -------------------- loadSampleProject --------------------
  describe('loadSampleProject', () => {
    it('加载示例项目：currentProjectId 设置，chapters 非空，patchProjects add 调用', () => {
      mockStorage.patchProjects.mockClear();
      useAppStore.getState().loadSampleProject();

      const state = useAppStore.getState();
      expect(state.currentProjectId).not.toBeNull();
      expect(state.chapters.length).toBeGreaterThan(0);
      expect(state.projects.length).toBeGreaterThan(0);
      // 示例项目标题为"星尘往事"
      const sampleProject = state.projects.find(p => p.id === state.currentProjectId);
      expect(sampleProject?.title).toBe('星尘往事');
      // patchProjects 被调用（add 操作）
      expect(mockStorage.patchProjects).toHaveBeenCalled();
      const call = mockStorage.patchProjects.mock.calls[0][0];
      expect(call.type).toBe('add');
    });

    it('加载示例项目：currentChapterId 为首个 levelType=chapter 的章节', () => {
      useAppStore.getState().loadSampleProject();
      const state = useAppStore.getState();
      const firstChapter = state.chapters.find(c => c.levelType === 'chapter');
      expect(state.currentChapterId).toBe(firstChapter?.id || null);
    });

    it('加载示例项目：角色/设定/伏笔/素材 均非空', () => {
      useAppStore.getState().loadSampleProject();
      const state = useAppStore.getState();
      expect(state.characters.length).toBeGreaterThan(0);
      expect(state.settingCategories.length).toBeGreaterThan(0);
      expect(state.foreshadows.length).toBeGreaterThan(0);
      expect(state.materials.length).toBeGreaterThan(0);
    });
  });

  // -------------------- deleteProject 边界 --------------------
  describe('deleteProject 边界', () => {
    it('部分 storage.remove 失败时调用 toast.warning', async () => {
      const project = await useAppStore.getState().createProject('测试', 'blank');
      // 让其中一个 storage.remove reject，触发 hasFailure 分支
      mockStorage.remove.mockRejectedValueOnce(new Error('disk error'));

      await useAppStore.getState().deleteProject(project.id);

      // 修复 T3：补充 toast.warning 断言（此前遗漏，仅验证项目被删）
      expect(toastMock.warning).toHaveBeenCalledWith('项目删除部分失败', expect.any(String));
      expect(useAppStore.getState().projects.some(p => p.id === project.id)).toBe(false);
    });

    it('删除当前项目：清空灵犀助手域（subplots / updateSchedule）', async () => {
      const project = await useAppStore.getState().createProject('测试', 'blank');
      useAppStore.setState({
        subplots: [{ id: 's1', title: '支线', status: 'open' } as never],
        updateSchedule: { lastUpdate: '2024-01-01' } as never,
      });

      await useAppStore.getState().deleteProject(project.id);

      const state = useAppStore.getState();
      expect(state.subplots).toEqual([]);
      expect(state.updateSchedule).toBeNull();
    });

    // 修复 T5：补 createProject / deleteProject 的 patchProjects 失败回滚测试（关键容错分支）
    it('createProject：patchProjects 返回 null 时 toast.error 并抛错（磁盘满/权限不足）', async () => {
      mockStorage.patchProjects.mockResolvedValueOnce(null);
      await expect(useAppStore.getState().createProject('失败项目', 'blank'))
        .rejects.toThrow('项目列表持久化失败');
      expect(toastMock.error).toHaveBeenCalledWith('创建项目失败', expect.any(String));
      // 内存中不应残留项目
      expect(useAppStore.getState().projects.find(p => p.title === '失败项目')).toBeUndefined();
    });

    it('deleteProject：patchProjects rejected 时回滚内存状态并 toast.error', async () => {
      const project = await useAppStore.getState().createProject('待删除', 'blank');
      const projectsBefore = useAppStore.getState().projects.slice();
      // patchProjects reject 模拟磁盘故障
      mockStorage.patchProjects.mockRejectedValueOnce(new Error('disk full'));

      await useAppStore.getState().deleteProject(project.id);

      // 回滚：projects 恢复到删除前（项目仍存在）
      expect(useAppStore.getState().projects.some(p => p.id === project.id)).toBe(true);
      expect(useAppStore.getState().projects).toEqual(projectsBefore);
      expect(toastMock.error).toHaveBeenCalledWith('项目删除失败', expect.any(String));
    });

    it('deleteProject：patchProjects 返回 null 时回滚内存状态并 toast.error', async () => {
      const project = await useAppStore.getState().createProject('待删除2', 'blank');
      const projectsBefore = useAppStore.getState().projects.slice();
      mockStorage.patchProjects.mockResolvedValueOnce(null);

      await useAppStore.getState().deleteProject(project.id);

      expect(useAppStore.getState().projects.some(p => p.id === project.id)).toBe(true);
      expect(useAppStore.getState().projects).toEqual(projectsBefore);
      expect(toastMock.error).toHaveBeenCalledWith('项目删除失败', expect.any(String));
    });
  });
});
