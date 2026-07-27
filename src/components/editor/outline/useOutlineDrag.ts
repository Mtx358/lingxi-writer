import { useCallback } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import {
  computeDropTarget,
  wouldExceedMaxDepth,
  recomputeSiblingOrder,
  getSubtreeMaxDepth,
  computeNewLevel,
} from '@/utils/outlineDrag';
import { CHAPTER_MAX_LEVEL } from '@/constants/config';
import type { Chapter } from '@/types';

/**
 * 大纲拖拽结束处理 hook。
 *
 * 拆分自原 OutlinePanel.tsx 的 handleDragEnd。负责：
 *   1. 计算拖拽目标位置（computeDropTarget，含环检测、不在可见序列等边界）
 *   2. 嵌套到 over 节点下时自动展开 over 节点
 *   3. 跨层级移动时预判子树最大深度，超限时 toast.warning 拒绝
 *   4. moveChapter 后对受影响的两个层级 recomputeSiblingOrder + batchUpdateChapterOrder
 *
 * @returns handleDragEnd 传给 DndContext.onDragEnd
 */
export interface UseOutlineDragDeps {
  chapters: Chapter[];
  visibleIds: string[];
  moveChapter: (id: string, parentId: string | null, order: number) => boolean;
  setCollapsedIds: (updater: (prev: Set<string>) => Set<string>) => void;
}

export function useOutlineDrag({ chapters, visibleIds, moveChapter, setCollapsedIds }: UseOutlineDragDeps) {
  return useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedId = String(active.id);
    const overId = String(over.id);

    // 拖拽目标的判断逻辑（newParentId / newOrder、环检测、深度预判）已抽取为纯函数，
    // 见 src/utils/outlineDrag.ts。这里只负责"判断 → 调 set / toast"。
    const chapterMap = new Map(chapters.map(c => [c.id, c]));
    const draggedChapter = chapterMap.get(draggedId);
    if (!draggedChapter) return;

    // 计算拖拽后的目标位置（纯判断，不修改 store）。
    // computeDropTarget 内部已处理：目标节点无效、不在可见序列中、环检测等边界。
    const dropTarget = computeDropTarget(chapters, draggedId, overId, visibleIds);
    if (!dropTarget) return;

    const { newParentId, newOrder } = dropTarget;
    const oldParentId = draggedChapter.parentId;

    // 当作为 overId 的子级挂载（且此前不是其子级）时，展开目标节点以便用户看到结果。
    // newParentId === overId 仅在 computeDropTarget 的"作为子级"分支出现；
    // oldParentId !== overId 与原条件 draggedChapter.parentId !== overId 等价。
    if (newParentId === overId && oldParentId !== overId) {
      setCollapsedIds(prev => {
        const next = new Set(prev);
        next.delete(overId);
        return next;
      });
    }

    // I4: 拖拽父章节时，预判整个子树移动后的最大深度，避免子节点超过 CHAPTER_MAX_LEVEL。
    // moveChapter 内部也有同样校验（getSubtreeMaxDepth），但提前预判可在不修改 store 的情况下
    // 给出明确的中文提示，避免用户重复尝试。
    if (newParentId !== oldParentId) {
      if (wouldExceedMaxDepth(chapters, draggedId, newParentId)) {
        // 复用纯函数计算 toast 文案所需的数值，与原逻辑数值完全一致
        const subtreeDepth = getSubtreeMaxDepth(chapters, draggedId);
        const targetLevel = computeNewLevel(chapters, newParentId);
        toast.warning(
          '无法移动到该位置',
          `移动后子树最深层级将达到 ${targetLevel + subtreeDepth - 1}，超过 ${CHAPTER_MAX_LEVEL} 级上限。请先扁平化子章节或选择更浅的目标层级。`,
        );
        return;
      }
    }

    const moved = moveChapter(draggedId, newParentId, newOrder);
    if (!moved) {
      toast.warning('无法移动到该位置', `移动后子树层级将超过 ${CHAPTER_MAX_LEVEL} 级上限，或目标位置无效`);
      return;
    }

    // 拖拽完成后对受影响的两个层级（原父级、新父级）统一重排 order，
    // 确保从 0 开始连续递增，避免历史 order 不连续或跨层级拖拽累积导致的断层/重复。
    // C1 性能修复：收集所有需更新的 {id, order} 后一次性 batchUpdateChapterOrder，
    // 避免 N 次 updateChapter 触发 N 次 set + N 轮订阅广播。
    // 注意：moveChapter 已更新 store，必须读取最新 chapters，避免使用陈旧闭包。
    const latestChapters = useAppStore.getState().chapters;
    const batchUpdateChapterOrder = useAppStore.getState().batchUpdateChapterOrder;
    const pendingUpdates: Array<{ id: string; order: number }> = [
      ...recomputeSiblingOrder(latestChapters, newParentId),
    ];
    if (oldParentId !== newParentId) {
      pendingUpdates.push(...recomputeSiblingOrder(latestChapters, oldParentId));
    }
    if (pendingUpdates.length > 0) {
      batchUpdateChapterOrder(pendingUpdates);
    }
  }, [chapters, visibleIds, moveChapter, setCollapsedIds]);
}
