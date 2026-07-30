/**
 * src/store/slices/multiLineSlice.ts 单元测试
 *
 * 测试目标：
 *   - 故事线管理：addStoryline（默认颜色 / 自定义颜色 / 空 nodes）、
 *     updateStoryline、deleteStoryline（含交集目标引用清理）
 *   - 时间轴节点：addTimelineNode（storyline/chapter 校验）、removeTimelineNode
 *   - 交集点预警：addIntersectionTarget、deleteIntersectionTarget、
 *     checkIntersection（ok / warning / danger 三态 + message 非空）
 *
 * 测试策略：
 *   - useAppStore.getState() 触发 actions
 *   - vi.mock('@/utils/storage') 内存实现 + markDirty no-op，generateId 保留真实
 *   - beforeEach 中 createProject 确保 currentProjectId 存在
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { Project, Chapter } from '@/types';

// ============ 内存存储 mock ============
const { memoryStore, mockStorage } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();
  const mockStorage = {
    get: vi.fn(async <T>(key: string, defaultValue: T): Promise<T> =>
      memoryStore.has(key) ? (memoryStore.get(key) as T) : defaultValue),
    set: vi.fn(async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value);
    }),
    setMany: vi.fn(async (entries: Record<string, unknown>): Promise<void> => {
      for (const [k, v] of Object.entries(entries)) memoryStore.set(k, v);
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      memoryStore.delete(key);
    }),
    patchProjects: vi.fn(async (op: {
      type: 'add' | 'remove' | 'update' | 'clear';
      project?: Project;
      id?: string;
    }): Promise<Project[]> => {
      const cur = (memoryStore.get('projects') as Project[]) || [];
      let next = cur;
      if (op.type === 'add' && op.project) {
        next = cur.some(p => p.id === op.project!.id)
          ? cur.map(p => (p.id === op.project!.id ? op.project! : p))
          : [...cur, op.project];
      } else if (op.type === 'remove' && op.id) {
        next = cur.filter(p => p.id !== op.id);
      } else if (op.type === 'update' && op.project) {
        next = cur.some(p => p.id === op.project!.id)
          ? cur.map(p => (p.id === op.project!.id ? { ...p, ...op.project! } : p))
          : [...cur, op.project];
      } else if (op.type === 'clear') {
        next = [];
      }
      memoryStore.set('projects', next);
      return next;
    }),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
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

// ============ 测试 fixtures ============
const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'ch1', projectId: 'p1', parentId: null, title: '第一章',
  summary: '', order: 0, level: 1, levelType: 'chapter',
  status: 'draft', wordCount: 0, content: '',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ============ 测试前重置 store ============
beforeEach(async () => {
  vi.clearAllMocks();
  memoryStore.clear();

  useAppStore.setState({
    projects: [],
    currentProjectId: null,
    currentProjectFilePath: null,
    lastSavedAt: null,
    isSaving: false,
    chapters: [],
    currentChapterId: null,
    storylines: [],
    intersectionTargets: [],
  });

  // 创建项目，确保 currentProjectId 存在
  await useAppStore.getState().createProject('测试项目', 'blank');
});

// ============ 测试用例 ============
describe('multiLineSlice', () => {
  // -------------------- addStoryline --------------------
  describe('addStoryline', () => {
    it('添加 protagonist 类型 → 默认颜色 #3b82f6', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' });
      expect(sl).not.toBeNull();
      expect(sl!.color).toBe('#3b82f6');
      expect(sl!.type).toBe('protagonist');
      expect(sl!.name).toBe('主线');
    });

    it('添加 antagonist 类型 → 默认颜色 #ef4444', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'antagonist', name: '反派线' });
      expect(sl).not.toBeNull();
      expect(sl!.color).toBe('#ef4444');
    });

    it('添加 subplot 类型 → 默认颜色 #10b981', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'subplot', name: '支线' });
      expect(sl).not.toBeNull();
      expect(sl!.color).toBe('#10b981');
    });

    it('自定义颜色 → 使用自定义颜色', () => {
      const sl = useAppStore.getState().addStoryline({
        type: 'protagonist', name: '主线', color: '#abcdef',
      });
      expect(sl).not.toBeNull();
      expect(sl!.color).toBe('#abcdef');
    });

    it('返回的 Storyline nodes 为空数组', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' });
      expect(sl).not.toBeNull();
      expect(sl!.nodes).toEqual([]);
      expect(useAppStore.getState().storylines).toHaveLength(1);
    });

    it('无项目时返回 null', () => {
      useAppStore.setState({ currentProjectId: null });
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' });
      expect(sl).toBeNull();
    });
  });

  // -------------------- updateStoryline --------------------
  describe('updateStoryline', () => {
    it('更新已有 storyline 的 name/color → 字段更新', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      useAppStore.getState().updateStoryline(sl.id, { name: '改名为新主线', color: '#000000' });

      const updated = useAppStore.getState().storylines.find(s => s.id === sl.id)!;
      expect(updated.name).toBe('改名为新主线');
      expect(updated.color).toBe('#000000');
    });
  });

  // -------------------- deleteStoryline --------------------
  describe('deleteStoryline', () => {
    it('删除已有 storyline → storylines 减少', () => {
      const sl1 = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      useAppStore.getState().addStoryline({ type: 'antagonist', name: '反派线' });
      expect(useAppStore.getState().storylines).toHaveLength(2);

      useAppStore.getState().deleteStoryline(sl1.id);

      expect(useAppStore.getState().storylines).toHaveLength(1);
      expect(useAppStore.getState().storylines[0].id).not.toBe(sl1.id);
    });

    it('删除 storyline 同时从 intersectionTargets 的 storylineIds 中移除该 ID', () => {
      const sl1 = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const sl2 = useAppStore.getState().addStoryline({ type: 'antagonist', name: '反派线' })!;
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch1', description: '交集', storylineIds: [sl1.id, sl2.id],
      })!;

      useAppStore.getState().deleteStoryline(sl1.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(updated.storylineIds).toEqual([sl2.id]);
    });

    it('若 intersectionTargets 的 storylineIds 变空，删除该 target', () => {
      const sl1 = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch1', description: '交集', storylineIds: [sl1.id],
      })!;

      useAppStore.getState().deleteStoryline(sl1.id);

      // target 的 storylineIds 变空 → 整个 target 被删除
      expect(useAppStore.getState().intersectionTargets.find(t => t.id === target.id)).toBeUndefined();
    });
  });

  // -------------------- addTimelineNode --------------------
  describe('addTimelineNode', () => {
    it('storyline 存在 + chapter 存在 → 添加节点，order/title 来自 chapter', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '第一章', order: 0 })],
      });
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;

      const node = useAppStore.getState().addTimelineNode(sl.id, 'ch1');

      expect(node).not.toBeNull();
      expect(node!.storylineId).toBe(sl.id);
      expect(node!.chapterId).toBe('ch1');
      expect(node!.title).toBe('第一章');
      expect(node!.order).toBe(0);
      const updated = useAppStore.getState().storylines.find(s => s.id === sl.id)!;
      expect(updated.nodes).toHaveLength(1);
    });

    it('storyline 不存在 → 返回 null', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
      });
      const node = useAppStore.getState().addTimelineNode('nonexistent', 'ch1');
      expect(node).toBeNull();
    });

    it('chapter 不存在 → 返回 null', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const node = useAppStore.getState().addTimelineNode(sl.id, 'nonexistent');
      expect(node).toBeNull();
    });

    it('无项目时 → 返回 null', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
      });
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const originalProjectId = useAppStore.getState().currentProjectId;
      useAppStore.setState({ currentProjectId: null });

      const node = useAppStore.getState().addTimelineNode(sl.id, 'ch1');

      expect(node).toBeNull();
      // 恢复项目 ID 以免影响后续测试
      useAppStore.setState({ currentProjectId: originalProjectId });
    });
  });

  // -------------------- removeTimelineNode --------------------
  describe('removeTimelineNode', () => {
    it('移除已有节点 → storyline.nodes 减少', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', title: '第一章', order: 0 }),
          makeChapter({ id: 'ch2', title: '第二章', order: 1 }),
        ],
      });
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      // 添加第二条故事线，确保 map 的 else 分支（非匹配 storyline）被覆盖
      useAppStore.getState().addStoryline({ type: 'antagonist', name: '反派线' });
      const n1 = useAppStore.getState().addTimelineNode(sl.id, 'ch1')!;
      useAppStore.getState().addTimelineNode(sl.id, 'ch2');
      expect(useAppStore.getState().storylines.find(s => s.id === sl.id)!.nodes).toHaveLength(2);

      useAppStore.getState().removeTimelineNode(sl.id, n1.id);

      const updated = useAppStore.getState().storylines.find(s => s.id === sl.id)!;
      expect(updated.nodes).toHaveLength(1);
      expect(updated.nodes.find(n => n.id === n1.id)).toBeUndefined();
    });
  });

  // -------------------- addIntersectionTarget --------------------
  describe('addIntersectionTarget', () => {
    it('添加交集目标 → 返回 IntersectionTarget，status 初始为 null', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch1', description: '主角与反派交锋', storylineIds: [sl.id],
      });

      expect(target).not.toBeNull();
      expect(target!.chapterId).toBe('ch1');
      expect(target!.description).toBe('主角与反派交锋');
      expect(target!.storylineIds).toEqual([sl.id]);
      expect(target!.status).toBeNull();
      expect(useAppStore.getState().intersectionTargets).toHaveLength(1);
    });

    it('无项目时返回 null', () => {
      useAppStore.setState({ currentProjectId: null });
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch1', description: 'x', storylineIds: ['s1'],
      });
      expect(target).toBeNull();
    });

    it('storylineIds 为空时返回 null', () => {
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch1', description: 'x', storylineIds: [],
      });
      expect(target).toBeNull();
    });
  });

  // -------------------- deleteIntersectionTarget --------------------
  describe('deleteIntersectionTarget', () => {
    it('删除已有目标 → intersectionTargets 减少', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const t1 = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch1', description: 'a', storylineIds: [sl.id],
      })!;
      useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch2', description: 'b', storylineIds: [sl.id],
      });
      expect(useAppStore.getState().intersectionTargets).toHaveLength(2);

      useAppStore.getState().deleteIntersectionTarget(t1.id);

      expect(useAppStore.getState().intersectionTargets).toHaveLength(1);
      expect(useAppStore.getState().intersectionTargets[0].id).not.toBe(t1.id);
    });
  });

  // -------------------- checkIntersection --------------------
  describe('checkIntersection', () => {
    /**
     * 章节布局：ch1(0) ch2(1) ch3(2) ch4(3) ch5(4)，交集章节为 ch5(order=4)。
     * sortedChapterLevel = [ch1, ch2, ch3, ch4, ch5]，intersectionIdx = 4。
     * 前 3 章 = slice(max(0, 4-3), 4) = slice(1, 4) = [ch2, ch3, ch4]。
     */
    const setupChapters = () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', title: '第1章', order: 0 }),
          makeChapter({ id: 'ch2', title: '第2章', order: 1 }),
          makeChapter({ id: 'ch3', title: '第3章', order: 2 }),
          makeChapter({ id: 'ch4', title: '第4章', order: 3 }),
          makeChapter({ id: 'ch5', title: '第5章', order: 4 }),
        ],
      });
    };

    it('所有线索在交集前 3 章都有节点 → status=ok', () => {
      setupChapters();
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      // 节点在 ch3（属于前 3 章窗口 {ch2,ch3,ch4}，order 2 < 4）
      useAppStore.getState().addTimelineNode(sl.id, 'ch3');
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch5', description: '交集', storylineIds: [sl.id],
      })!;

      useAppStore.getState().checkIntersection(target.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(updated.status).toBe('ok');
      expect(updated.message).toBeTruthy();
    });

    it('部分线索节点不足（有铺垫但不在前 3 章窗口）→ status=warning', () => {
      setupChapters();
      const slA = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const slB = useAppStore.getState().addStoryline({ type: 'antagonist', name: '反派线' })!;
      // slA 节点在 ch3（窗口内）→ ok
      useAppStore.getState().addTimelineNode(slA.id, 'ch3');
      // slB 节点在 ch1（order 0 < 4 有铺垫，但 ch1 不在前 3 章窗口 {ch2,ch3,ch4}）→ 不足
      useAppStore.getState().addTimelineNode(slB.id, 'ch1');
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch5', description: '交集', storylineIds: [slA.id, slB.id],
      })!;

      useAppStore.getState().checkIntersection(target.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(updated.status).toBe('warning');
      expect(updated.message).toBeTruthy();
    });

    it('有线索完全无节点 → status=danger', () => {
      setupChapters();
      const slA = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const slB = useAppStore.getState().addStoryline({ type: 'antagonist', name: '反派线' })!;
      // slA 节点在 ch3 → ok
      useAppStore.getState().addTimelineNode(slA.id, 'ch3');
      // slB 无任何节点 → danger
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch5', description: '交集', storylineIds: [slA.id, slB.id],
      })!;

      useAppStore.getState().checkIntersection(target.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(updated.status).toBe('danger');
      expect(updated.message).toBeTruthy();
      // message 应提示缺失的线索名
      expect(updated.message).toContain('反派线');
    });

    it('message 字段非空（ok 场景）', () => {
      setupChapters();
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      useAppStore.getState().addTimelineNode(sl.id, 'ch3');
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch5', description: '交集', storylineIds: [sl.id],
      })!;

      useAppStore.getState().checkIntersection(target.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(typeof updated.message).toBe('string');
      expect(updated.message!.length).toBeGreaterThan(0);
    });

    it('交集章节不存在时 → status=danger', () => {
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'nonexistent', description: '交集', storylineIds: [sl.id],
      })!;
      // 添加第二个 target，确保 map 的 else 分支（非匹配 target）被覆盖
      useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch-other', description: '其他交集', storylineIds: [sl.id],
      });

      useAppStore.getState().checkIntersection(target.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(updated.status).toBe('danger');
      expect(updated.message).toContain('不存在');
    });

    it('target 不存在时 noop', () => {
      expect(() => useAppStore.getState().checkIntersection('nonexistent')).not.toThrow();
    });

    it('target.storylineIds 包含不存在的 storyline ID → status=danger（covers 线索缺失分支）', () => {
      setupChapters();
      const sl = useAppStore.getState().addStoryline({ type: 'protagonist', name: '主线' })!;
      useAppStore.getState().addTimelineNode(sl.id, 'ch3');
      const target = useAppStore.getState().addIntersectionTarget({
        chapterId: 'ch5', description: '交集', storylineIds: [sl.id],
      })!;
      // 手动注入一个不存在的 storylineId（绕过 addIntersectionTarget 的校验）
      useAppStore.setState({
        intersectionTargets: useAppStore.getState().intersectionTargets.map(t =>
          t.id === target.id
            ? { ...t, storylineIds: [sl.id, 'nonexistent-storyline-id'] }
            : t
        ),
      });

      useAppStore.getState().checkIntersection(target.id);

      const updated = useAppStore.getState().intersectionTargets.find(t => t.id === target.id)!;
      expect(updated.status).toBe('danger');
      // message 应包含缺失的 storyline ID（找不到 storyline 时 push 的是 sid 本身）
      expect(updated.message).toContain('nonexistent-storyline-id');
    });
  });
});
