/**
 * src/store/slices/chapterSlice.ts 单元测试
 *
 * 测试目标：
 *   - addChapter：默认/自定义 levelType、order 自增、嵌套层级上限、无项目抛错
 *   - updateChapter：合并字段、updatedAt 刷新、无项目 noop
 *   - deleteChapter：级联删子章节、order 回填、currentChapterId 切换、
 *     foreshadows/subplots/versions/histories 级联清理
 *   - moveChapter：同父级前后移动、跨父级移动、循环检测拒绝、嵌套层级超限拒绝、子树 level 递归更新
 *   - setCurrentChapter：isAIGenerating 期间锁定、清空 aiSuggestions
 *   - updateChapterContent：wordCount 计数、project.totalWords 同步、recovery 草稿保存
 *   - 杂项 setter：setPendingEditorInsert / setPendingScrollTo / bumpContentEpoch / setAIGenerating
 *
 * 测试策略：
 *   - 通过 useAppStore.getState() 触发 actions
 *   - vi.mock('@/utils/storage') 替换为内存实现，markDirty/triggerSave no-op
 *   - 每个测试前 useAppStore.setState 重置关键字段，避免单例 store 跨用例污染
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import { clearForeshadowRecomputeTimer } from '@/store/slices/chapterSlice';
import type { Chapter, Project, Foreshadow, Subplot } from '@/types';

// ============ 内存存储 mock ============
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
    patchProjects: vi.fn(async () => null),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    loadRecoveryDraft: vi.fn().mockResolvedValue(null),
    clearRecoveryDraft: vi.fn().mockResolvedValue(undefined),
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

// ============ toast mock（用于断言 C-M4 崩溃恢复草稿失败节流 toast.error 调用） ============
const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
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
    theme: 'dark',
    fontSize: 16,
    lineHeight: 1.8,
    fontFamily: 'system-ui',
    showLineNumbers: false,
    showWordCount: true,
    zenMode: false,
    aiSettings: { ...DEFAULT_AI_SETTINGS } as never,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ============ 测试前重置 store ============
beforeEach(() => {
  clearForeshadowRecomputeTimer(); // 清除模块级防抖定时器，避免跨用例残留
  memoryStore.clear();
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  mockStorage.saveRecoveryDraft.mockClear();
  mockStorage.loadRecoveryDraft.mockClear();
  mockStorage.clearRecoveryDraft.mockClear();
  toastMock.error.mockClear();

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
  });
});

// ============ 测试用例 ============

describe('chapterSlice', () => {
  // -------------------- addChapter --------------------
  describe('addChapter', () => {
    it('根级新增章节：默认 level=1, levelType=book, order=0', () => {
      const ch = useAppStore.getState().addChapter(null, '第一卷');
      expect(ch).not.toBeNull();
      expect(ch!.level).toBe(1);
      expect(ch!.levelType).toBe('book');
      expect(ch!.order).toBe(0);
      expect(ch!.projectId).toBe('p1');
      expect(useAppStore.getState().chapters).toHaveLength(1);
      // 新增后自动切换 currentChapterId
      expect(useAppStore.getState().currentChapterId).toBe(ch!.id);
    });

    it('根级新增多章节：order 自增', () => {
      const c1 = useAppStore.getState().addChapter(null, '卷1')!;
      const c2 = useAppStore.getState().addChapter(null, '卷2')!;
      expect(c1.order).toBe(0);
      expect(c2.order).toBe(1);
    });

    it('指定 order 时把同父级 order>=newOrder 的章节 +1', () => {
      const c1 = useAppStore.getState().addChapter(null, '卷1')!;
      const c2 = useAppStore.getState().addChapter(null, '卷2')!;
      const c3 = useAppStore.getState().addChapter(null, '卷0插入', 0)!;
      // c3 占用 order=0，c1/c2 平移到 1/2
      const chapters = useAppStore.getState().chapters;
      expect(chapters.find(c => c.id === c3.id)!.order).toBe(0);
      expect(chapters.find(c => c.id === c1.id)!.order).toBe(1);
      expect(chapters.find(c => c.id === c2.id)!.order).toBe(2);
    });

    it('子章节：levelType 自动从父级推导', () => {
      const book = useAppStore.getState().addChapter(null, '书', undefined, 'book')!;
      const volume = useAppStore.getState().addChapter(book.id, '卷')!;
      expect(volume.level).toBe(2);
      expect(volume.levelType).toBe('volume');
      const section = useAppStore.getState().addChapter(volume.id, '节')!;
      expect(section.level).toBe(3);
      expect(section.levelType).toBe('part');
    });

    it('levelType 推导链：part → section → chapter（末级 cap 不越界）', () => {
      // 覆盖 levelOrder ['book','volume','part','section','chapter'] 的后三段推导
      const book = useAppStore.getState().addChapter(null, '书', undefined, 'book')!;
      const volume = useAppStore.getState().addChapter(book.id, '卷', undefined, 'volume')!;
      const part = useAppStore.getState().addChapter(volume.id, '部', undefined, 'part')!;
      // part → section
      const sectionCh = useAppStore.getState().addChapter(part.id, '节')!;
      expect(sectionCh.levelType).toBe('section');
      expect(sectionCh.level).toBe(4);
      // section → chapter
      const chapterCh = useAppStore.getState().addChapter(sectionCh.id, '正文章节')!;
      expect(chapterCh.levelType).toBe('chapter');
      expect(chapterCh.level).toBe(5);
      // chapter 是末级：min(4+1, 4)=4 → 仍为 chapter（cap 不越界）
      // 注意：chapterCh 已在第 5 层，再加子节点会触发 CHAPTER_MAX_LEVEL=5 拒绝（返回 null），
      // 因此用显式 'chapter' levelType 的浅层父节点来测 cap，避免与嵌套上限冲突
      const shallowChapterParent = useAppStore.getState().addChapter(null, '浅层章节父', undefined, 'chapter')!;
      const capped = useAppStore.getState().addChapter(shallowChapterParent.id, 'cap 子')!;
      expect(capped.levelType).toBe('chapter');
      expect(capped.level).toBe(2);
    });

    it('显式 levelType 优先于自动推导', () => {
      const book = useAppStore.getState().addChapter(null, '书', undefined, 'book')!;
      const ch = useAppStore.getState().addChapter(book.id, '特殊章节', undefined, 'chapter')!;
      expect(ch.levelType).toBe('chapter');
    });

    it('嵌套层级超过 CHAPTER_MAX_LEVEL (5) 时拒绝并返回 null', () => {
      // 构造 5 层深度的链
      let parent: Chapter | null = useAppStore.getState().addChapter(null, 'L1', undefined, 'book');
      for (let i = 2; i <= 5; i++) {
        parent = useAppStore.getState().addChapter(parent!.id, `L${i}`);
      }
      // 此时 parent 在第 5 层，再加一层会变第 6 层 → 拒绝
      const tooDeep = useAppStore.getState().addChapter(parent!.id, 'L6');
      expect(tooDeep).toBeNull();
    });

    it('无 currentProjectId 时抛错', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().addChapter(null, 'x')).toThrow('No project open');
    });
  });

  // -------------------- updateChapter --------------------
  describe('updateChapter', () => {
    it('合并 updates 字段并刷新 updatedAt', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      // 用 fake timer 确保 updatedAt 推进（同毫秒内 toISOString 会相同）
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      const beforeUpdate = new Date().toISOString();
      vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
      useAppStore.getState().updateChapter(ch.id, { title: '新标题', status: 'done' });
      const updated = useAppStore.getState().chapters.find(c => c.id === ch.id)!;
      expect(updated.title).toBe('新标题');
      expect(updated.status).toBe('done');
      expect(updated.updatedAt).not.toBe(beforeUpdate);
      vi.useRealTimers();
    });

    it('无 currentProjectId 时安全 noop', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateChapter(ch.id, { title: '不应更新' });
      expect(useAppStore.getState().chapters.find(c => c.id === ch.id)!.title).toBe('卷');
    });
  });

  // -------------------- batchUpdateChapterOrder --------------------
  describe('batchUpdateChapterOrder', () => {
    it('C1 性能修复：单次 set 批量更新多个章节 order', () => {
      const c1 = useAppStore.getState().addChapter(null, 'ch1')!;
      const c2 = useAppStore.getState().addChapter(null, 'ch2')!;
      const c3 = useAppStore.getState().addChapter(null, 'ch3')!;
      // 读取初始 order
      const initial = useAppStore.getState().chapters;
      expect(initial.map(c => c.order)).toEqual([0, 1, 2]);
      // 批量反转 order
      useAppStore.getState().batchUpdateChapterOrder([
        { id: c1.id, order: 2 },
        { id: c2.id, order: 1 },
        { id: c3.id, order: 0 },
      ]);
      const updated = useAppStore.getState().chapters;
      expect(updated.find(c => c.id === c1.id)!.order).toBe(2);
      expect(updated.find(c => c.id === c2.id)!.order).toBe(1);
      expect(updated.find(c => c.id === c3.id)!.order).toBe(0);
    });

    it('空 updates 数组安全 noop', () => {
      useAppStore.getState().addChapter(null, 'ch1')!;
      const before = useAppStore.getState().chapters;
      useAppStore.getState().batchUpdateChapterOrder([]);
      expect(useAppStore.getState().chapters).toBe(before);
    });

    it('无 currentProjectId 时安全 noop', () => {
      const ch = useAppStore.getState().addChapter(null, 'ch1')!;
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().batchUpdateChapterOrder([{ id: ch.id, order: 99 }]);
      expect(useAppStore.getState().chapters.find(c => c.id === ch.id)!.order).toBe(0);
    });
  });

  // -------------------- deleteChapter --------------------
  describe('deleteChapter', () => {
    it('删除根级章节：从 chapters 中移除', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      useAppStore.getState().deleteChapter(ch.id);
      expect(useAppStore.getState().chapters).toHaveLength(0);
    });

    it('级联删除所有子章节（多层）', () => {
      const root = useAppStore.getState().addChapter(null, 'L1', undefined, 'book')!;
      const c1 = useAppStore.getState().addChapter(root.id, 'L2-a')!;
      const c2 = useAppStore.getState().addChapter(root.id, 'L2-b')!;
      const grandchild = useAppStore.getState().addChapter(c1.id, 'L3')!;
      useAppStore.getState().deleteChapter(root.id);
      const ids = useAppStore.getState().chapters.map(c => c.id);
      expect(ids).not.toContain(root.id);
      expect(ids).not.toContain(c1.id);
      expect(ids).not.toContain(c2.id);
      expect(ids).not.toContain(grandchild.id);
    });

    it('删除中间章节后，同父级后续章节 order -1 回填', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.getState().addChapter(null, 'b');
      const c3 = useAppStore.getState().addChapter(null, 'c')!;
      // 删除 c1（order=0），c3 的 order 应从 2 → 1
      useAppStore.getState().deleteChapter(c1.id);
      const updated = useAppStore.getState().chapters.find(c => c.id === c3.id)!;
      expect(updated.order).toBe(1);
    });

    it('删除当前章节时 currentChapterId 切到首章', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      useAppStore.setState({ currentChapterId: c2.id });
      useAppStore.getState().deleteChapter(c2.id);
      // c1 是首章
      expect(useAppStore.getState().currentChapterId).toBe(c1.id);
    });

    it('删除全部章节后 currentChapterId 为 null', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.setState({ currentChapterId: c1.id });
      useAppStore.getState().deleteChapter(c1.id);
      expect(useAppStore.getState().currentChapterId).toBeNull();
    });

    it('级联清理伏笔中的章节引用（置空，不删除伏笔）', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      const foreshadow: Foreshadow = {
        id: 'f1', projectId: 'p1', title: '伏笔', description: '',
        status: 'planted', plantedChapterId: ch.id, payoffChapterId: ch.id,
        priority: 'medium', relatedCharacters: [], relatedSettings: [],
        chaptersSinceMention: 0, notes: '',
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      };
      useAppStore.setState({ foreshadows: [foreshadow] });
      useAppStore.getState().deleteChapter(ch.id);
      const f = useAppStore.getState().foreshadows[0];
      expect(f.plantedChapterId).toBeNull();
      expect(f.payoffChapterId).toBeNull();
    });

    it('级联清理支线中的章节引用', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      const subplot: Subplot = {
        id: 's1', projectId: 'p1', title: '支线', description: '',
        status: 'open', startChapterId: ch.id,
        lastProgressChapterId: ch.id, expectedCloseChapterId: ch.id,
        relatedCharacters: [], relatedForeshadows: [], notes: '',
        lastProgressAt: null,
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      };
      // subplots 通过 project.subplots 同步，需要同时在 project 与 store 顶层设置
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        subplots: [subplot],
        projects: [{ ...project, subplots: [subplot] }],
      });
      useAppStore.getState().deleteChapter(ch.id);
      const s = useAppStore.getState().subplots[0];
      expect(s.startChapterId).toBeNull();
      expect(s.lastProgressChapterId).toBeNull();
      expect(s.expectedCloseChapterId).toBeNull();
    });

    it('级联清理被删章节的版本快照与撤销历史', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      useAppStore.setState({
        versions: { [ch.id]: [{ id: 'v1', chapterId: ch.id, version: 1, content: 'x', wordCount: 1, snapshotTime: '', autoGenerated: false }] },
        histories: { [ch.id]: { past: ['x'], future: [], lastPush: 0 } },
      });
      useAppStore.getState().deleteChapter(ch.id);
      expect(useAppStore.getState().versions[ch.id]).toBeUndefined();
      expect(useAppStore.getState().histories[ch.id]).toBeUndefined();
    });

    it('删除不存在的章节：noop 不抛错', () => {
      expect(() => useAppStore.getState().deleteChapter('nonexistent')).not.toThrow();
    });
  });

  // -------------------- moveChapter --------------------
  describe('moveChapter', () => {
    it('同父级向前移动：被移动章节 order 变更，中间章节 +1', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      const c3 = useAppStore.getState().addChapter(null, 'c')!;
      // 把 c3 移到 order=0
      const ok = useAppStore.getState().moveChapter(c3.id, null, 0);
      expect(ok).toBe(true);
      const chapters = useAppStore.getState().chapters;
      expect(chapters.find(c => c.id === c3.id)!.order).toBe(0);
      expect(chapters.find(c => c.id === c1.id)!.order).toBe(1);
      expect(chapters.find(c => c.id === c2.id)!.order).toBe(2);
    });

    it('同父级向后移动：被移动章节 order 变更，中间章节 -1', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      const c3 = useAppStore.getState().addChapter(null, 'c')!;
      // 把 c1 移到 order=2
      const ok = useAppStore.getState().moveChapter(c1.id, null, 2);
      expect(ok).toBe(true);
      const chapters = useAppStore.getState().chapters;
      expect(chapters.find(c => c.id === c1.id)!.order).toBe(2);
      expect(chapters.find(c => c.id === c2.id)!.order).toBe(0);
      expect(chapters.find(c => c.id === c3.id)!.order).toBe(1);
    });

    it('跨父级移动：原父级后续 -1，新父级同 order +1', () => {
      const book1 = useAppStore.getState().addChapter(null, '书1', undefined, 'book')!;
      const book2 = useAppStore.getState().addChapter(null, '书2', undefined, 'book')!;
      const c1 = useAppStore.getState().addChapter(book1.id, 'a')!;
      useAppStore.getState().addChapter(book1.id, 'b');
      // 把 c1 移到 book2 下 order=0
      const ok = useAppStore.getState().moveChapter(c1.id, book2.id, 0);
      expect(ok).toBe(true);
      const chapters = useAppStore.getState().chapters;
      const moved = chapters.find(c => c.id === c1.id)!;
      expect(moved.parentId).toBe(book2.id);
      expect(moved.level).toBe(2);
      expect(moved.order).toBe(0);
    });

    it('循环检测：移动到自己的后代下返回 false', () => {
      const root = useAppStore.getState().addChapter(null, 'L1', undefined, 'book')!;
      const child = useAppStore.getState().addChapter(root.id, 'L2')!;
      const grandchild = useAppStore.getState().addChapter(child.id, 'L3')!;
      // root 不能移到 grandchild 下
      const ok = useAppStore.getState().moveChapter(root.id, grandchild.id, 0);
      expect(ok).toBe(false);
    });

    it('嵌套层级超限：移动后子树最深层级超过 5 返回 false', () => {
      // 构造 5 层深的链：root1（5层）→ root2（仅 1 层）
      let root1: Chapter | null = useAppStore.getState().addChapter(null, 'L1', undefined, 'book');
      for (let i = 2; i <= 5; i++) {
        root1 = useAppStore.getState().addChapter(root1!.id, `L${i}`);
      }
      // root1 现在是 5 层深节点（其本身 level=5）
      // 再加上其子树深度 1，若把它移到 root2（level=2）下，新 level=3，子树最深 3+1=4 < 5 OK
      // 但若把 root1 移到 level=5 的位置下，新 level=6，超限
      // 简化：把 root1（5层链根）移到一个 level=3 的父级下，新 level=4，子树深度 5 → 4+5-1=8 > 5 拒绝
      const deepChainRoot = useAppStore.getState().chapters.find(c => c.level === 1 && c.title === 'L1')!;
      // 构造一个 level=3 的目标父级
      const t1 = useAppStore.getState().addChapter(null, 'T1', undefined, 'book')!;
      const t2 = useAppStore.getState().addChapter(t1.id, 'T2', undefined, 'volume')!;
      const t3 = useAppStore.getState().addChapter(t2.id, 'T3', undefined, 'part')!;
      // deepChainRoot 子树深度=5（L1..L5），移到 t3 下新 level=4，4+5-1=8 > 5 → 拒绝
      const ok = useAppStore.getState().moveChapter(deepChainRoot.id, t3.id, 0);
      expect(ok).toBe(false);
    });

    it('跨父级移动时子树 level 递归更新', () => {
      const root1 = useAppStore.getState().addChapter(null, '书1', undefined, 'book')!;
      const root2 = useAppStore.getState().addChapter(null, '书2', undefined, 'book')!;
      const c1 = useAppStore.getState().addChapter(root1.id, '子', undefined, 'volume')!;
      const grandchild = useAppStore.getState().addChapter(c1.id, '孙', undefined, 'part')!;
      // root1.level=1, c1.level=2, grandchild.level=3
      // 把 c1 移到 root2（level=1）下，c1.level 变 2，grandchild.level 变 3
      // 仍是同样的相对深度，主要验证 level 递归更新逻辑被触发
      const ok = useAppStore.getState().moveChapter(c1.id, root2.id, 0);
      expect(ok).toBe(true);
      const chapters = useAppStore.getState().chapters;
      expect(chapters.find(c => c.id === c1.id)!.level).toBe(2);
      expect(chapters.find(c => c.id === grandchild.id)!.level).toBe(3);
    });

    it('无 currentProjectId 返回 false', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(useAppStore.getState().moveChapter('any', null, 0)).toBe(false);
    });

    it('章节不存在返回 false', () => {
      expect(useAppStore.getState().moveChapter('nonexistent', null, 0)).toBe(false);
    });
  });

  // -------------------- setCurrentChapter --------------------
  describe('setCurrentChapter', () => {
    it('切换 currentChapterId 并清空 aiSuggestions', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      useAppStore.setState({
        currentChapterId: c1.id,
        aiSuggestions: [{ id: 's1', type: 'continue', title: 't', content: 'c', reasoning: '', contextUsed: [], timestamp: '' }],
      });
      useAppStore.getState().setCurrentChapter(c2.id);
      expect(useAppStore.getState().currentChapterId).toBe(c2.id);
      expect(useAppStore.getState().aiSuggestions).toEqual([]);
    });

    it('isAIGenerating=true 时拒绝切换', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      useAppStore.setState({ currentChapterId: c1.id, isAIGenerating: true });
      useAppStore.getState().setCurrentChapter(c2.id);
      expect(useAppStore.getState().currentChapterId).toBe(c1.id);
    });

    it('传 null 清空 currentChapterId', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.setState({ currentChapterId: c1.id });
      useAppStore.getState().setCurrentChapter(null);
      expect(useAppStore.getState().currentChapterId).toBeNull();
    });
  });

  // -------------------- updateChapterContent --------------------
  describe('updateChapterContent', () => {
    it('更新 content 与 wordCount', () => {
      const ch = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.getState().updateChapterContent(ch.id, '<p>这是一段中文内容</p>');
      const updated = useAppStore.getState().chapters.find(c => c.id === ch.id)!;
      expect(updated.content).toBe('<p>这是一段中文内容</p>');
      expect(updated.wordCount).toBeGreaterThan(0);
    });

    it('同步更新 project.totalWords（多章节累计）', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      useAppStore.getState().updateChapterContent(c1.id, '<p>一二三四五</p>');
      useAppStore.getState().updateChapterContent(c2.id, '<p>六七八九十</p>');
      // 注意：c1/c2 引用是 addChapter 时的快照，wordCount=0；从 store 重新读取
      const updatedC1 = useAppStore.getState().chapters.find(c => c.id === c1.id)!;
      const updatedC2 = useAppStore.getState().chapters.find(c => c.id === c2.id)!;
      const project = useAppStore.getState().projects.find(p => p.id === 'p1')!;
      expect(project.totalWords).toBe(updatedC1.wordCount + updatedC2.wordCount);
      expect(project.totalWords).toBeGreaterThan(0);
    });

    it('当前章节更新时保存 recovery 草稿', () => {
      const ch = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.setState({ currentChapterId: ch.id });
      mockStorage.saveRecoveryDraft.mockClear();
      useAppStore.getState().updateChapterContent(ch.id, '<p>内容</p>');
      expect(mockStorage.saveRecoveryDraft).toHaveBeenCalledTimes(1);
    });

    it('非当前章节更新时不保存 recovery 草稿', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      useAppStore.setState({ currentChapterId: c1.id });
      mockStorage.saveRecoveryDraft.mockClear();
      useAppStore.getState().updateChapterContent(c2.id, '<p>内容</p>');
      expect(mockStorage.saveRecoveryDraft).not.toHaveBeenCalled();
    });

    it('无 currentProjectId 时 noop', () => {
      const ch = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateChapterContent(ch.id, '<p>新</p>');
      // 不抛错，content 未变（注意 chapters 仍在内存里但 currentProjectId 为 null 时直接 return）
      expect(useAppStore.getState().chapters.find(c => c.id === ch.id)!.content).toBe('');
    });

    it('saveRecoveryDraft 失败节流（C-M4）：首次立即 toast，5 分钟内再次失败跳过，超过 5 分钟再次 toast', async () => {
      // 覆盖 L350-358 saveRecoveryDraft.catch 节流分支：
      // - 首次失败 recoveryFailCount===1 → 立即 toast
      // - 5 分钟内再次失败 → now-lastRecoveryToastTime < 5min → 跳过 toast
      // - 推进 5 分钟以上再次失败 → 节流窗口过期 → 再次 toast
      // 注意：recoveryFailCount / lastRecoveryToastTime 为 chapterSlice 模块级私有变量，
      // 跨测试不重置。本文件仅此测试触发 saveRecoveryDraft 失败，故起始计数为 0。
      vi.useFakeTimers();
      try {
        const ch = useAppStore.getState().addChapter(null, 'a')!;
        useAppStore.setState({ currentChapterId: ch.id });
        mockStorage.saveRecoveryDraft.mockRejectedValue(new Error('disk full'));

        // 首次失败：立即 toast
        useAppStore.getState().updateChapterContent(ch.id, '<p>第一次</p>');
        await Promise.resolve(); // flush microtask 让 .catch 执行
        expect(toastMock.error).toHaveBeenCalledTimes(1);
        expect(toastMock.error).toHaveBeenCalledWith('崩溃恢复草稿写入失败，请检查磁盘空间');

        // 5 分钟内再次失败：节流跳过（recoveryFailCount>1 且 now-lastTime < 5min）
        useAppStore.getState().updateChapterContent(ch.id, '<p>第二次</p>');
        await Promise.resolve();
        expect(toastMock.error).toHaveBeenCalledTimes(1); // 仍只 1 次

        // 推进超过 5 分钟，再次失败：节流窗口过期 → 再次 toast
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
        useAppStore.getState().updateChapterContent(ch.id, '<p>第三次</p>');
        await Promise.resolve();
        expect(toastMock.error).toHaveBeenCalledTimes(2);
      } finally {
        // 还原 mock 实现，避免影响后续测试
        mockStorage.saveRecoveryDraft.mockResolvedValue(undefined);
        vi.useRealTimers();
      }
    });

    it('章节内容变更后防抖触发 recomputeForeshadowMentions（覆盖 foreshadowRecomputeTimer setTimeout 回调 L363-365）', async () => {
      vi.useFakeTimers();
      try {
        const ch = useAppStore.getState().addChapter(null, '第一章', undefined, 'chapter')!;
        useAppStore.setState({ currentChapterId: ch.id });
        // 设置伏笔：标题在章节正文中出现，chaptersSinceMention 初始为 99（将被重算）
        useAppStore.setState({
          foreshadows: [{
            id: 'f1', projectId: 'p1', title: '黑暗森林', description: '',
            status: 'planted', plantedChapterId: null, payoffChapterId: null,
            priority: 'medium', relatedCharacters: [], relatedSettings: [],
            chaptersSinceMention: 99, notes: '', createdAt: '', updatedAt: '',
          } as never],
        });

        // 更新章节内容含伏笔标题，触发防抖定时器（SEARCH_DEBOUNCE_DELAY=250ms）
        useAppStore.getState().updateChapterContent(ch.id, '正文出现黑暗森林法则');
        // 此时 recompute 尚未执行
        expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(99);

        // 推进 SEARCH_DEBOUNCE_DELAY(250ms) 触发回调 → recomputeForeshadowMentions 执行
        await vi.advanceTimersByTimeAsync(260);
        // 重算后当前章节提及了伏笔标题，距离应为 0
        expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------- 杂项 setter --------------------
  describe('杂项 setter', () => {
    it('setPendingEditorInsert 写入并清空', () => {
      const payload = { chapterId: 'ch1', content: '<p>x</p>', mode: 'cursor' as const };
      useAppStore.getState().setPendingEditorInsert(payload);
      expect(useAppStore.getState().pendingEditorInsert).toEqual(payload);
      useAppStore.getState().setPendingEditorInsert(null);
      expect(useAppStore.getState().pendingEditorInsert).toBeNull();
    });

    it('setPendingScrollTo 写入并清空', () => {
      const payload = { chapterId: 'ch1', timestamp: Date.now() };
      useAppStore.getState().setPendingScrollTo(payload);
      expect(useAppStore.getState().pendingScrollTo).toEqual(payload);
      useAppStore.getState().setPendingScrollTo(null);
      expect(useAppStore.getState().pendingScrollTo).toBeNull();
    });

    it('bumpContentEpoch 自增', () => {
      expect(useAppStore.getState().contentEpoch).toBe(0);
      useAppStore.getState().bumpContentEpoch();
      expect(useAppStore.getState().contentEpoch).toBe(1);
      useAppStore.getState().bumpContentEpoch();
      expect(useAppStore.getState().contentEpoch).toBe(2);
    });

    it('setAIGenerating 切换', () => {
      useAppStore.getState().setAIGenerating(true);
      expect(useAppStore.getState().isAIGenerating).toBe(true);
      useAppStore.getState().setAIGenerating(false);
      expect(useAppStore.getState().isAIGenerating).toBe(false);
    });
  });

  // -------------------- 分支覆盖补充（第二轮）--------------------
  describe('分支覆盖补充', () => {
    it('clearForeshadowRecomputeTimer：定时器存在时清除（覆盖 L36 truthy 分支）', () => {
      vi.useFakeTimers();
      try {
        const ch = useAppStore.getState().addChapter(null, 'ch')!;
        useAppStore.setState({ currentChapterId: ch.id });
        // 触发防抖定时器但不推进时间 → 定时器保持 pending
        useAppStore.getState().updateChapterContent(ch.id, '内容');
        // foreshadowRecomputeTimer 非 null → 进入 if 分支清除
        expect(() => clearForeshadowRecomputeTimer()).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });

    it('deleteChapter：无 currentProjectId 时 noop（覆盖 L122 守卫）', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().deleteChapter(ch.id)).not.toThrow();
      // currentProjectId 恢复后章节仍在
      useAppStore.setState({ currentProjectId: 'p1' });
      expect(useAppStore.getState().chapters).toHaveLength(1);
    });

    it('deleteChapter：currentChapterId 为 null 时删除不切换（覆盖 L153 currentChapterId || "" falsy）', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.getState().addChapter(null, 'b');
      useAppStore.setState({ currentChapterId: null });
      useAppStore.getState().deleteChapter(c1.id);
      // currentChapterId 保持 null
      expect(useAppStore.getState().currentChapterId).toBeNull();
    });

    it('deleteChapter：伏笔 plantedChapterId/payoffChapterId 为 null 时不清理（覆盖 L159-160 && falsy）', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      const foreshadow: Foreshadow = {
        id: 'f1', projectId: 'p1', title: '伏笔', description: '',
        status: 'planted', plantedChapterId: null, payoffChapterId: null,
        priority: 'medium', relatedCharacters: [], relatedSettings: [],
        chaptersSinceMention: 0, notes: '',
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      };
      useAppStore.setState({ foreshadows: [foreshadow] });
      useAppStore.getState().deleteChapter(ch.id);
      const f = useAppStore.getState().foreshadows[0];
      // plantedChapterId/payoffChapterId 原本为 null，走 && falsy 分支 → 保持 null
      expect(f.plantedChapterId).toBeNull();
      expect(f.payoffChapterId).toBeNull();
    });

    it('deleteChapter：支线部分章节引用为 null 时不清理（覆盖 L167-175 && falsy 分支）', () => {
      const ch = useAppStore.getState().addChapter(null, '卷')!;
      const subplot: Subplot = {
        id: 's1', projectId: 'p1', title: '支线', description: '',
        status: 'open', startChapterId: null, lastProgressChapterId: ch.id,
        expectedCloseChapterId: null,
        relatedCharacters: [], relatedForeshadows: [], notes: '',
        lastProgressAt: null,
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      };
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        subplots: [subplot],
        projects: [{ ...project, subplots: [subplot] }],
      });
      useAppStore.getState().deleteChapter(ch.id);
      const s = useAppStore.getState().subplots[0];
      // startChapterId/expectedCloseChapterId 原本为 null → 走 && falsy → 保持 null
      expect(s.startChapterId).toBeNull();
      expect(s.expectedCloseChapterId).toBeNull();
      // lastProgressChapterId 指向被删章节 → 走 && truthy → 置 null
      expect(s.lastProgressChapterId).toBeNull();
    });

    it('updateChapter：多章节时仅更新目标章节（覆盖 L99 三元 false 分支）', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      const c2 = useAppStore.getState().addChapter(null, 'b')!;
      useAppStore.getState().updateChapter(c1.id, { title: '更新后' });
      const chapters = useAppStore.getState().chapters;
      expect(chapters.find(c => c.id === c1.id)!.title).toBe('更新后');
      // c2 未匹配 → 走三元 false 分支 → 保持原值
      expect(chapters.find(c => c.id === c2.id)!.title).toBe('b');
    });

    it('batchUpdateChapterOrder：仅更新部分章节（覆盖 L114 三元 false 分支）', () => {
      const c1 = useAppStore.getState().addChapter(null, 'a')!;
      useAppStore.getState().addChapter(null, 'b');
      useAppStore.getState().addChapter(null, 'c');
      // 只更新 c1，其余章节不在 updates 中 → 走三元 false 分支
      useAppStore.getState().batchUpdateChapterOrder([{ id: c1.id, order: 2 }]);
      const chapters = useAppStore.getState().chapters;
      expect(chapters.find(c => c.id === c1.id)!.order).toBe(2);
      // c2/c3 走三元 false → order 不变
      expect(chapters.find(c => c.title === 'b')!.order).toBe(1);
      expect(chapters.find(c => c.title === 'c')!.order).toBe(2);
    });
  });
});
