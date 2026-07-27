/**
 * useOutlineSelection 独立单元测试
 *
 * 测试范围（聚焦选择状态与批量操作，不重复 OutlinePanel.test.tsx 已覆盖的渲染）：
 *   - handleSelect 普通点击 → 单选
 *   - handleSelect Ctrl+点击 → toggle 多选（加入/移除）
 *   - handleBatchDelete 空选 → 直接 return
 *   - handleBatchDelete 祖先已选时过滤子节点（避免级联删除重复处理）
 *   - handleBatchDelete confirm true → 删除 + 清空选择
 *   - handleBatchDelete confirm false → 不删除
 *   - handleBatchMerge 选中 < MIN → return
 *   - handleBatchMerge 成功 → saveVersion + updateChapter(合并元数据) + deleteChapter 其余
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOutlineSelection } from './useOutlineSelection';
import { confirm } from '@/hooks/useConfirm';
import type { Chapter } from '@/types';

// ============ mock useConfirm ============
vi.mock('@/hooks/useConfirm', () => ({
  confirm: vi.fn(),
  ConfirmDialog: () => null,
}));

const confirmMock = vi.mocked(confirm);

function makeChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: 'ch',
    projectId: 'p1',
    parentId: null,
    title: '章',
    summary: '',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 0,
    content: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Chapter;
}

describe('useOutlineSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockReset();
  });

  it('handleSelect 普通点击 → 单选（新 Set 仅含该 id）', () => {
    const setSelectedIds = vi.fn();
    const setSelectedChapter = vi.fn();
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters: [],
        selectedIds: new Set(),
        setSelectedIds,
        setSelectedChapter,
        updateChapter: vi.fn(),
        deleteChapter: vi.fn(),
        saveVersion: vi.fn(),
        setShowBatchMenu: vi.fn(),
      }),
    );
    const chapter = makeChapter({ id: 'c1' });
    act(() => result.current.handleSelect(chapter, undefined));
    // updater 将 prev 替换为仅含 c1 的 Set
    const updater = setSelectedIds.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    expect(updater(new Set(['other']))).toEqual(new Set(['c1']));
    expect(setSelectedChapter).toHaveBeenCalledWith(chapter);
  });

  it('handleSelect Ctrl+点击未选中 → 加入多选', () => {
    const setSelectedIds = vi.fn();
    const setSelectedChapter = vi.fn();
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters: [],
        selectedIds: new Set(),
        setSelectedIds,
        setSelectedChapter,
        updateChapter: vi.fn(),
        deleteChapter: vi.fn(),
        saveVersion: vi.fn(),
        setShowBatchMenu: vi.fn(),
      }),
    );
    const chapter = makeChapter({ id: 'c2' });
    act(() => result.current.handleSelect(chapter, { ctrlKey: true } as unknown as React.MouseEvent));
    const updater = setSelectedIds.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    // 传入已含 other 的 Set，应追加 c2
    expect(updater(new Set(['other']))).toEqual(new Set(['other', 'c2']));
    expect(setSelectedChapter).toHaveBeenCalledWith(chapter);
  });

  it('handleSelect Ctrl+点击已选中 → 移除选中', () => {
    const setSelectedIds = vi.fn();
    const setSelectedChapter = vi.fn();
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters: [],
        selectedIds: new Set(),
        setSelectedIds,
        setSelectedChapter,
        updateChapter: vi.fn(),
        deleteChapter: vi.fn(),
        saveVersion: vi.fn(),
        setShowBatchMenu: vi.fn(),
      }),
    );
    const chapter = makeChapter({ id: 'c3' });
    act(() => result.current.handleSelect(chapter, { ctrlKey: true } as unknown as React.MouseEvent));
    const updater = setSelectedIds.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    // prev 含 c3 → 移除
    expect(updater(new Set(['c3', 'other']))).toEqual(new Set(['other']));
  });

  it('handleBatchDelete 空选 → 直接 return，不调 confirm', async () => {
    const deleteChapter = vi.fn();
    const confirmSpy = vi.fn().mockResolvedValue(true);
    confirmMock.mockImplementation(confirmSpy);
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters: [],
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setSelectedChapter: vi.fn(),
        updateChapter: vi.fn(),
        deleteChapter,
        saveVersion: vi.fn(),
        setShowBatchMenu: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.handleBatchDelete();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteChapter).not.toHaveBeenCalled();
  });

  it('handleBatchDelete 祖先已选时过滤子节点，confirm true 后仅删除非后代节点', async () => {
    // a 为根，b 为 a 的子级；均选中 → b 因祖先 a 已选被过滤
    const chapters = [
      makeChapter({ id: 'a', parentId: null, order: 0 }),
      makeChapter({ id: 'b', parentId: 'a', order: 0 }),
    ];
    const deleteChapter = vi.fn();
    const setSelectedIds = vi.fn();
    const setSelectedChapter = vi.fn();
    const setShowBatchMenu = vi.fn();
    confirmMock.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters,
        selectedIds: new Set(['a', 'b']),
        setSelectedIds,
        setSelectedChapter,
        updateChapter: vi.fn(),
        deleteChapter,
        saveVersion: vi.fn(),
        setShowBatchMenu,
      }),
    );
    await act(async () => {
      await result.current.handleBatchDelete();
    });
    // 只删 a（b 因祖先已选被过滤）
    expect(deleteChapter).toHaveBeenCalledTimes(1);
    expect(deleteChapter).toHaveBeenCalledWith('a');
    expect(deleteChapter).not.toHaveBeenCalledWith('b');
    // 清空选择 + 清空选中章节
    const clearUpdater = setSelectedIds.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    expect(clearUpdater(new Set(['a', 'b']))).toEqual(new Set());
    expect(setSelectedChapter).toHaveBeenCalledWith(null);
    expect(setShowBatchMenu).toHaveBeenCalledWith(false);
  });

  it('handleBatchDelete confirm false → 不删除但关闭批量菜单', async () => {
    const chapters = [makeChapter({ id: 'a', parentId: null })];
    const deleteChapter = vi.fn();
    const setShowBatchMenu = vi.fn();
    confirmMock.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters,
        selectedIds: new Set(['a']),
        setSelectedIds: vi.fn(),
        setSelectedChapter: vi.fn(),
        updateChapter: vi.fn(),
        deleteChapter,
        saveVersion: vi.fn(),
        setShowBatchMenu,
      }),
    );
    await act(async () => {
      await result.current.handleBatchDelete();
    });
    expect(deleteChapter).not.toHaveBeenCalled();
    expect(setShowBatchMenu).toHaveBeenCalledWith(false);
  });

  it('handleBatchMerge 选中 < MIN(2) → return，不调 confirm', async () => {
    const chapters = [makeChapter({ id: 'c1', parentId: null })];
    const updateChapter = vi.fn();
    confirmMock.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters,
        selectedIds: new Set(['c1']),
        setSelectedIds: vi.fn(),
        setSelectedChapter: vi.fn(),
        updateChapter,
        deleteChapter: vi.fn(),
        saveVersion: vi.fn(),
        setShowBatchMenu: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.handleBatchMerge();
    });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(updateChapter).not.toHaveBeenCalled();
  });

  it('handleBatchMerge 成功 → saveVersion + updateChapter(合并元数据) + deleteChapter 其余 + 选首章', async () => {
    const chapters = [
      makeChapter({
        id: 'c1',
        content: '<p>A</p>',
        status: 'draft',
        characterFocus: ['x'],
        keyEvents: ['e1'],
      }),
      makeChapter({
        id: 'c2',
        content: '<p>B</p>',
        status: 'done',
        characterFocus: ['y'],
        keyEvents: ['e2'],
      }),
    ];
    const updateChapter = vi.fn();
    const deleteChapter = vi.fn();
    const saveVersion = vi.fn();
    const setSelectedIds = vi.fn();
    const setSelectedChapter = vi.fn();
    const setShowBatchMenu = vi.fn();
    confirmMock.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useOutlineSelection({
        chapters,
        selectedIds: new Set(['c1', 'c2']),
        setSelectedIds,
        setSelectedChapter,
        updateChapter,
        deleteChapter,
        saveVersion,
        setShowBatchMenu,
      }),
    );
    await act(async () => {
      await result.current.handleBatchMerge();
    });
    // 合并前快照
    expect(saveVersion).toHaveBeenCalledWith('c1', '批量合并前快照');
    // 内容拼接 + characterFocus/keyEvents 取并集 + status 取最靠后(done)
    expect(updateChapter).toHaveBeenCalledWith('c1', expect.objectContaining({
      content: '<p>A</p><p>B</p>',
      characterFocus: ['x', 'y'],
      keyEvents: ['e1', 'e2'],
      status: 'done',
    }));
    // 其余章节删除
    expect(deleteChapter).toHaveBeenCalledWith('c2');
    expect(deleteChapter).not.toHaveBeenCalledWith('c1');
    // 选首章
    const selectUpdater = setSelectedIds.mock.calls[0][0] as (prev: Set<string>) => Set<string>;
    expect(selectUpdater(new Set())).toEqual(new Set(['c1']));
    expect(setSelectedChapter).toHaveBeenCalledWith(chapters[0]);
    expect(setShowBatchMenu).toHaveBeenCalledWith(false);
  });
});
