/**
 * 大纲拖拽排序的纯函数集合。
 *
 * 这些函数从 OutlinePanel 的 handleDragEnd 中抽取，将"判断逻辑"与"执行 set 操作"
 * 分离，使拖拽决策可独立单元测试。所有函数均为纯函数：不读取 store、不触发 toast、
 * 不修改入参，仅基于传入的 chapters 与参数返回计算结果。
 *
 * 行为与原 handleDragEnd 内联实现完全一致，handleDragEnd 改为调用这些函数后
 * 仅负责"判断 → 调 set / toast"。
 */
import { CHAPTER_MAX_LEVEL } from '@/constants/config';
import type { Chapter } from '@/types';

// 永不变化的空数组常量，作为无子节点时的稳定回退引用，避免每次创建新数组。
const EMPTY_CHILDREN: Chapter[] = [];

// 子树深度遍历的硬上限，防止数据中存在极端深嵌套或环时栈耗尽。
const MAX_SUBTREE_WALK_DEPTH = 50;

/**
 * 构建 id -> chapter 映射，将后续多次 O(n) 查找降为 O(1)。
 */
export function buildChapterMap(chapters: Chapter[]): Map<string, Chapter> {
  return new Map(chapters.map(c => [c.id, c]));
}

/**
 * 构建 parentId -> 直接子节点数组 映射（保持 chapters 中的原始顺序，未排序）。
 */
export function buildChildrenByParentId(chapters: Chapter[]): Map<string | null, Chapter[]> {
  const map = new Map<string | null, Chapter[]>();
  for (const c of chapters) {
    const arr = map.get(c.parentId);
    if (arr) arr.push(c);
    else map.set(c.parentId, [c]);
  }
  return map;
}

/**
 * 检查 descendantId 是否是 ancestorId 的后代（即 ancestorId 是否是 descendantId 的祖先）。
 * 沿 parentId 链自下而上迭代查找，若中途遇到 ancestorId 则存在祖先关系。
 *
 * 迭代实现避免极端嵌套层级下递归栈溢出。用于拖拽时防止把节点拖成自己的子孙导致环。
 *
 * @returns true 表示 descendantId 是 ancestorId 的后代（拖拽会创建环，应拒绝）
 */
export function isDescendant(chapters: Chapter[], ancestorId: string, descendantId: string): boolean {
  const chapterMap = buildChapterMap(chapters);
  let currentId: string | null = descendantId;
  while (currentId) {
    if (currentId === ancestorId) return true;
    const node = chapterMap.get(currentId);
    currentId = node?.parentId ?? null;
  }
  return false;
}

/**
 * 计算拖拽后节点的新 level（基于目标父节点的 level + 1）。
 *
 * - newParentId 为 null（移到根级）时返回 1：与根级 book 节点的 level 一致。
 * - 否则返回 newParent 节点的 level + 1；若 newParent 不存在则回退为 0 + 1 = 1。
 *
 * 该值用于子树深度预判（见 wouldExceedMaxDepth），并非直接写入 store——
 * 实际 level 调整由 moveChapter 内部按 parentId 递归完成。
 */
export function computeNewLevel(chapters: Chapter[], newParentId: string | null): number {
  if (!newParentId) return 1;
  const chapterMap = buildChapterMap(chapters);
  return (chapterMap.get(newParentId)?.level ?? 0) + 1;
}

/**
 * 计算以 rootId 为根的子树最大深度（含 rootId 自身，单节点返回 1）。
 *
 * - 加 visited Set 防止数据中存在环时无限递归
 * - 用 MAX_SUBTREE_WALK_DEPTH 硬限制兜底，避免极端深嵌套数据导致栈耗尽
 *
 * 返回值语义：rootId 自身深度为 1，每多一层子级深度 +1。
 */
export function getSubtreeMaxDepth(chapters: Chapter[], rootId: string): number {
  const childrenByParentId = buildChildrenByParentId(chapters);
  const visited = new Set<string>();
  const walk = (id: string, depth: number): number => {
    if (depth > MAX_SUBTREE_WALK_DEPTH) return depth;
    if (visited.has(id)) return depth; // 检测到环，立即返回避免无限递归
    visited.add(id);
    const kids = childrenByParentId.get(id) ?? EMPTY_CHILDREN;
    if (kids.length === 0) return 1;
    return 1 + Math.max(...kids.map(k => walk(k.id, depth + 1)));
  };
  return walk(rootId, 0);
}

/**
 * 检查把 sourceId 子树移动到 newParentId 下后，子树最深层级是否超过 maxDepth。
 *
 * 计算：最深层级 = targetLevel + subtreeDepth - 1
 *   - targetLevel: 移动后 sourceId 自身的新 level（computeNewLevel）
 *   - subtreeDepth: sourceId 子树的最大深度（含自身）
 *   - 减 1 是因为 targetLevel 已含 sourceId 自身一层，subtreeDepth 也含自身一层，需去重
 *
 * @param maxDepth 允许的最大层级，默认 CHAPTER_MAX_LEVEL
 * @returns true 表示会超限（应拒绝移动）
 */
export function wouldExceedMaxDepth(
  chapters: Chapter[],
  sourceId: string,
  newParentId: string | null,
  maxDepth: number = CHAPTER_MAX_LEVEL,
): boolean {
  const subtreeDepth = getSubtreeMaxDepth(chapters, sourceId);
  const targetLevel = computeNewLevel(chapters, newParentId);
  return targetLevel + subtreeDepth - 1 > maxDepth;
}

/**
 * 对指定父级下的同级 chapter 重排 order，确保从 0 开始连续递增。
 *
 * 仅返回 order 实际需要更新的 {id, order} 列表（与原 order 不同才纳入），
 * 供 batchUpdateChapterOrder 一次性提交，避免 N 次 updateChapter 触发 N 轮订阅广播。
 *
 * 注意：调用方应传入 moveChapter 之后的最新 chapters，以保证排序基于最新数据。
 */
export function recomputeSiblingOrder(
  chapters: Chapter[],
  parentId: string | null,
): Array<{ id: string; order: number }> {
  const sibs = chapters
    .filter(c => c.parentId === parentId)
    .sort((a, b) => a.order - b.order);
  const updates: Array<{ id: string; order: number }> = [];
  sibs.forEach((ch, idx) => {
    if (ch.order !== idx) {
      updates.push({ id: ch.id, order: idx });
    }
  });
  return updates;
}

/**
 * 计算拖拽后的新 parentId 与 order（纯判断，不修改 store）。
 *
 * 决策逻辑（与原 handleDragEnd 内联实现完全一致）：
 * 1. 当满足以下全部条件时，作为 overId 的子级（排在子级末尾）：
 *    - dropBelow（拖到目标节点下半部分，由 visibleIds 中索引位置判定）
 *    - overId 有子节点
 *    - 拖拽源不是 overId 的祖先（否则会创建环）
 *    - 拖拽源当前父级不是 overId（已经是其子级则无需重复挂载）
 *    此时 newParentId = overId，newOrder = overId 现有子节点数。
 * 2. 否则作为同级排序：
 *    newParentId = overChapter.parentId，
 *    newOrder = dropBelow ? overChapter.order + 1 : overChapter.order。
 *
 * @param visibleIds 当前可见（未折叠）的章节 id 序列，用于判定 dropBelow
 * @returns {newParentId, newOrder} 或 null（目标节点无效或不在可见序列中）
 */
export function computeDropTarget(
  chapters: Chapter[],
  draggedId: string,
  overId: string,
  visibleIds: string[],
): { newParentId: string | null; newOrder: number } | null {
  const chapterMap = buildChapterMap(chapters);
  const childrenByParentId = buildChildrenByParentId(chapters);

  const draggedChapter = chapterMap.get(draggedId);
  const overChapter = chapterMap.get(overId);
  if (!draggedChapter || !overChapter) return null;

  const activeIndex = visibleIds.indexOf(draggedId);
  const overIndex = visibleIds.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1) return null;

  // 判断拖拽意图：拖到目标节点下半部分作为子级，上半部分作为同级前驱
  const dropBelow = activeIndex < overIndex;

  // 迭代版祖先判断（避免极端嵌套层级下递归栈溢出）：
  // 自下而上沿 parentId 链查找，若中途遇到 draggedId 则说明拖拽源是目标节点的祖先
  const wouldCreateCycle = isDescendant(chapters, draggedId, overId);

  const overHasChildren = (childrenByParentId.get(overId)?.length ?? 0) > 0;

  if (dropBelow && overHasChildren && !wouldCreateCycle && draggedChapter.parentId !== overId) {
    // 作为目标节点的子级（放到子级末尾，避免破坏现有子级顺序）
    const childCount = childrenByParentId.get(overId)?.length ?? 0;
    return { newParentId: overId, newOrder: childCount };
  }

  // 作为同级排序
  return {
    newParentId: overChapter.parentId,
    newOrder: dropBelow ? overChapter.order + 1 : overChapter.order,
  };
}
