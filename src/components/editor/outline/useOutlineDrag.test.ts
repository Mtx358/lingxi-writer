/**
 * useOutlineDrag 独立单元测试
 *
 * 测试范围（聚焦 hook 行为，不重复 OutlinePanel.test.tsx 已覆盖的渲染）：
 *   - over 为 null / active.id === over.id → 直接 return
 *   - draggedChapter 不存在 → 直接 return
 *   - 拖拽导致子树超过 CHAPTER_MAX_LEVEL → toast.warning 拒绝，不调用 moveChapter
 *   - moveChapter 返回 false → toast.warning（目标位置无效）
 *   - 成功移动 → moveChapter + batchUpdateChapterOrder 重排受影响层级
 *   - 作为 overId 子级挂载时展开 overId（setCollapsedIds 删除 overId）
 *   - 同父级移动仅重排一个层级
 *
 * 纯函数（computeDropTarget/wouldExceedMaxDepth/recomputeSiblingOrder）保持真实，
 * 用真实 chapters 数据验证 hook 与纯函数的协作。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import { useOutlineDrag } from './useOutlineDrag';
import { toast } from '@/hooks/useToast';
import type { Chapter } from '@/types';

// ============ mock useAppStore（hook 内部用 useAppStore.getState 取最新 chapters + batchUpdateChapterOrder） ============
const { useAppStoreMock } = vi.hoisted(() => ({
  useAppStoreMock: {
    getState: vi.fn(() => ({ chapters: [] as Chapter[], batchUpdateChapterOrder: vi.fn() })),
  },
}));
vi.mock('@/store/useAppStore', () => ({ useAppStore: useAppStoreMock }));

// ============ mock toast ============
vi.mock('@/hooks/useToast', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

function makeChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: 'ch',
    projectId: 'p1',
    parentId: null,
    title: '章',
    summary: '',
    order: 0,
    level: 1,
    levelType: 'book',
    status: 'draft',
    wordCount: 0,
    content: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Chapter;
}

// 构造 DragEndEvent：active.id 必填，over 可为 null
function dragEvent(draggedId: string, overId: string | null) {
  return {
    active: { id: draggedId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
}

// 一棵 5 层树 + 一个独立根节点 x：
//   b(1) → v(2) → p(3) → s(4) → c(5)
//   x(1, 独立根)
function buildTreeChapters(): Chapter[] {
  return [
    makeChapter({ id: 'b', parentId: null, level: 1, order: 0, levelType: 'book' }),
    makeChapter({ id: 'v', parentId: 'b', level: 2, order: 0, levelType: 'volume' }),
    makeChapter({ id: 'p', parentId: 'v', level: 3, order: 0, levelType: 'part' }),
    makeChapter({ id: 's', parentId: 'p', level: 4, order: 0, levelType: 'section' }),
    makeChapter({ id: 'c', parentId: 's', level: 5, order: 0, levelType: 'chapter' }),
    makeChapter({ id: 'x', parentId: null, level: 1, order: 1, levelType: 'book', title: '独立' }),
  ];
}

describe('useOutlineDrag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('over 为 null 时直接 return，不调用 moveChapter', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['x', 'b'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('x', null)));
    expect(moveChapter).not.toHaveBeenCalled();
    expect(setCollapsedIds).not.toHaveBeenCalled();
  });

  it('active.id === over.id 时直接 return', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['x', 'b'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('x', 'x')));
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it('draggedChapter 不存在时直接 return', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['x', 'b'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('not-exist', 'b')));
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it('拖拽导致子树超过 CHAPTER_MAX_LEVEL → toast.warning 拒绝且不调用 moveChapter', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    // visibleIds 让 v 在 c 之前（dropBelow=true）；v 是 c 的祖先 → 退化为同级排序，
    // newParentId=c.parentId=s；s.level+1=5，v 子树深度 4，5+4-1=8>5 超限
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['b', 'v', 'p', 's', 'c'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('v', 'c')));
    expect(toast.warning).toHaveBeenCalledWith(
      '无法移动到该位置',
      expect.stringContaining('超过 5 级上限'),
    );
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it('moveChapter 返回 false → toast.warning（目标位置无效）', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(false);
    const setCollapsedIds = vi.fn();
    // x 拖到 b 下作为子级（dropBelow、b 有子、x 非祖先、x 父级非 b）
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['x', 'b', 'v'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('x', 'b')));
    expect(moveChapter).toHaveBeenCalledWith('x', 'b', 1);
    expect(toast.warning).toHaveBeenCalledWith(
      '无法移动到该位置',
      expect.stringContaining('超过 5 级上限'),
    );
  });

  it('成功移动 → 调用 moveChapter 并触发 batchUpdateChapterOrder 重排受影响层级', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    // moveChapter 后的 latestChapters：x 挂到 b 下，但 v 的 order 留了缺口（2）需重排
    const latestChapters = [
      makeChapter({ id: 'b', parentId: null, level: 1, order: 0 }),
      makeChapter({ id: 'v', parentId: 'b', level: 2, order: 2 }),
      makeChapter({ id: 'x', parentId: 'b', level: 2, order: 0, title: '独立' }),
      makeChapter({ id: 'p', parentId: 'v', level: 3, order: 0 }),
      makeChapter({ id: 's', parentId: 'p', level: 4, order: 0 }),
      makeChapter({ id: 'c', parentId: 's', level: 5, order: 0 }),
    ];
    const batchUpdateChapterOrder = vi.fn();
    useAppStoreMock.getState.mockReturnValue({ chapters: latestChapters, batchUpdateChapterOrder });
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['x', 'b', 'v'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('x', 'b')));
    expect(moveChapter).toHaveBeenCalledWith('x', 'b', 1);
    // recomputeSiblingOrder(latest, b)：v(order2→1) 需更新
    expect(batchUpdateChapterOrder).toHaveBeenCalledTimes(1);
    const updates = batchUpdateChapterOrder.mock.calls[0][0] as Array<{ id: string; order: number }>;
    expect(updates).toEqual(expect.arrayContaining([{ id: 'v', order: 1 }]));
  });

  it('作为 overId 子级挂载时展开 overId（setCollapsedIds 删除 overId）', () => {
    const chapters = buildTreeChapters();
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    useAppStoreMock.getState.mockReturnValue({ chapters: buildTreeChapters(), batchUpdateChapterOrder: vi.fn() });
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['x', 'b', 'v'], moveChapter, setCollapsedIds }),
    );
    act(() => result.current(dragEvent('x', 'b')));
    expect(setCollapsedIds).toHaveBeenCalledTimes(1);
    // 应用 updater：传入含 b 的 Set，应删除 b（展开）
    const updater = setCollapsedIds.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    const next = updater(new Set(['b', 'v']));
    expect(next.has('b')).toBe(false);
    expect(next.has('v')).toBe(true);
  });

  it('同父级移动仅重排一个层级（不触发旧父级重排）', () => {
    // b 下两个同级子节点 v1/v2；把 v2 拖到 v1 之上重排，oldParentId===newParentId===b
    const chapters = [
      makeChapter({ id: 'b', parentId: null, level: 1, order: 0, levelType: 'book' }),
      makeChapter({ id: 'v1', parentId: 'b', level: 2, order: 0, levelType: 'volume', title: '卷一' }),
      makeChapter({ id: 'v2', parentId: 'b', level: 2, order: 1, levelType: 'volume', title: '卷二' }),
    ];
    const moveChapter = vi.fn().mockReturnValue(true);
    const setCollapsedIds = vi.fn();
    // moveChapter 后 latestChapters：v2 移到 order 0，与 v1 冲突需重排
    const latestChapters = [
      makeChapter({ id: 'b', parentId: null, level: 1, order: 0 }),
      makeChapter({ id: 'v1', parentId: 'b', level: 2, order: 0 }),
      makeChapter({ id: 'v2', parentId: 'b', level: 2, order: 0 }),
    ];
    const batchUpdateChapterOrder = vi.fn();
    useAppStoreMock.getState.mockReturnValue({ chapters: latestChapters, batchUpdateChapterOrder });
    const { result } = renderHook(() =>
      useOutlineDrag({ chapters, visibleIds: ['b', 'v1', 'v2'], moveChapter, setCollapsedIds }),
    );
    // v2 拖到 v1 之上（dropAbove，同级排序 newParentId=b）
    act(() => result.current(dragEvent('v2', 'v1')));
    expect(moveChapter).toHaveBeenCalledWith('v2', 'b', 0);
    // 同父级：仅 recomputeSiblingOrder(b) 一次，batchUpdateChapterOrder 调一次
    expect(batchUpdateChapterOrder).toHaveBeenCalledTimes(1);
    const updates = batchUpdateChapterOrder.mock.calls[0][0] as Array<{ id: string; order: number }>;
    // 仅含 b 层级的更新（v2 order 0→1），不应含其他层级
    expect(updates.every(u => u.id === 'v2')).toBe(true);
  });
});
