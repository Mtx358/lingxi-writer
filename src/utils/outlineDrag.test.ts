/**
 * outlineDrag 纯函数单元测试
 *
 * 覆盖从 OutlinePanel.handleDragEnd 抽取的拖拽判断逻辑：
 *   - isDescendant：环检测（防止把节点拖成自己的子孙）
 *   - computeNewLevel：移动后新 level 计算（含根级）
 *   - getSubtreeMaxDepth：子树最大深度
 *   - wouldExceedMaxDepth：跨父级移动深度预判
 *   - recomputeSiblingOrder：同级 order 重算
 *   - computeDropTarget：拖拽目标决策（子级 / 同级）
 *   - 空 chapters 安全回退
 */
import { describe, it, expect } from 'vitest';
import {
  isDescendant,
  computeNewLevel,
  getSubtreeMaxDepth,
  wouldExceedMaxDepth,
  recomputeSiblingOrder,
  computeDropTarget,
} from './outlineDrag';
import { CHAPTER_MAX_LEVEL } from '@/constants/config';
import type { Chapter } from '@/types';

// ============ 测试 fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 0,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 0,
    content: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * 构建一棵 5 级完整嵌套树用于深度/层级测试：
 *   book-1 (level 1, root)
 *     └─ vol-1 (level 2)
 *          └─ part-1 (level 3)
 *               └─ sec-1 (level 4)
 *                    └─ ch-1 (level 5)
 */
function makeDeepTree(): Chapter[] {
  return [
    makeChapter({ id: 'book-1', title: '书', levelType: 'book', level: 1, parentId: null, order: 0 }),
    makeChapter({ id: 'vol-1', title: '卷', levelType: 'volume', level: 2, parentId: 'book-1', order: 0 }),
    makeChapter({ id: 'part-1', title: '部', levelType: 'part', level: 3, parentId: 'vol-1', order: 0 }),
    makeChapter({ id: 'sec-1', title: '节', levelType: 'section', level: 4, parentId: 'part-1', order: 0 }),
    makeChapter({ id: 'ch-1', title: '章', levelType: 'chapter', level: 5, parentId: 'sec-1', order: 0 }),
  ];
}

describe('outlineDrag 纯函数', () => {
  // ============ 1. isDescendant：环检测 ============
  describe('isDescendant（环检测）', () => {
    it('拖到自身后代上 → 返回 true（应拒绝以避免环）', () => {
      const chapters = makeDeepTree();
      // book-1 是 vol-1 的祖先；把 book-1 拖到 vol-1 下会创建环
      expect(isDescendant(chapters, 'book-1', 'vol-1')).toBe(true);
      // 多层后代同样应识别
      expect(isDescendant(chapters, 'book-1', 'ch-1')).toBe(true);
      expect(isDescendant(chapters, 'vol-1', 'sec-1')).toBe(true);
    });

    it('非后代关系 → 返回 false', () => {
      const chapters = makeDeepTree();
      // vol-1 不是 book-1 的祖先
      expect(isDescendant(chapters, 'vol-1', 'book-1')).toBe(false);
      // 兄弟节点之间无祖先关系
      expect(isDescendant(chapters, 'ch-1', 'sec-1')).toBe(false);
    });

    it('自身与自身 → 返回 true（沿 parentId 链起点即匹配）', () => {
      const chapters = makeDeepTree();
      expect(isDescendant(chapters, 'book-1', 'book-1')).toBe(true);
    });

    it('不存在的 id → 返回 false（安全回退，不抛错）', () => {
      const chapters = makeDeepTree();
      expect(isDescendant(chapters, 'book-1', 'not-exist')).toBe(false);
      expect(isDescendant(chapters, 'not-exist', 'vol-1')).toBe(false);
    });
  });

  // ============ 3 & 5. computeNewLevel：跨父级 level 与根级 level ============
  describe('computeNewLevel（新 level 计算）', () => {
    it('跨父级移动 → level = 目标父节点 level + 1', () => {
      const chapters = makeDeepTree();
      // 移到 vol-1（level 2）下 → 新 level = 3
      expect(computeNewLevel(chapters, 'vol-1')).toBe(3);
      // 移到 sec-1（level 4）下 → 新 level = 5
      expect(computeNewLevel(chapters, 'sec-1')).toBe(6 - 1);
      // 移到 book-1（level 1）下 → 新 level = 2
      expect(computeNewLevel(chapters, 'book-1')).toBe(2);
    });

    it('移到根级（newParentId = null）→ level = 1（与根级 book 节点一致），parentId 为 null', () => {
      const chapters = makeDeepTree();
      // 根级约定 level = 1（与原 handleDragEnd 中 targetLevel = 1 完全一致），
      // 实际 parentId = null 由 moveChapter 写入，computeNewLevel 仅返回 level 数值。
      expect(computeNewLevel(chapters, null)).toBe(1);
    });

    it('目标父节点不存在 → 回退为 0 + 1 = 1', () => {
      const chapters = makeDeepTree();
      expect(computeNewLevel(chapters, 'not-exist')).toBe(1);
    });

    it('空 chapters + null parent → 返回 1（根级约定）', () => {
      expect(computeNewLevel([], null)).toBe(1);
    });
  });

  // ============ getSubtreeMaxDepth ============
  describe('getSubtreeMaxDepth（子树最大深度）', () => {
    it('单节点（无子节点）→ 深度 1', () => {
      const chapters = makeDeepTree();
      expect(getSubtreeMaxDepth(chapters, 'ch-1')).toBe(1);
    });

    it('多级子树 → 深度 = 层级数', () => {
      const chapters = makeDeepTree();
      // book-1 -> vol-1 -> part-1 -> sec-1 -> ch-1，共 5 层
      expect(getSubtreeMaxDepth(chapters, 'book-1')).toBe(5);
      // vol-1 子树 4 层
      expect(getSubtreeMaxDepth(chapters, 'vol-1')).toBe(4);
    });

    it('多分支子树 → 取最大分支深度', () => {
      const chapters: Chapter[] = [
        makeChapter({ id: 'root', parentId: null, level: 1, order: 0 }),
        // 短分支：root -> short（深度 2）
        makeChapter({ id: 'short', parentId: 'root', level: 2, order: 0 }),
        // 长分支：root -> a -> b -> c（深度 4）
        makeChapter({ id: 'a', parentId: 'root', level: 2, order: 1 }),
        makeChapter({ id: 'b', parentId: 'a', level: 3, order: 0 }),
        makeChapter({ id: 'c', parentId: 'b', level: 4, order: 0 }),
      ];
      expect(getSubtreeMaxDepth(chapters, 'root')).toBe(4);
    });

    it('不存在的 rootId → 返回 1（安全回退，不抛错）', () => {
      expect(getSubtreeMaxDepth(makeDeepTree(), 'not-exist')).toBe(1);
    });

    it('空 chapters → 返回 1（安全回退）', () => {
      expect(getSubtreeMaxDepth([], 'anything')).toBe(1);
    });
  });

  // ============ 4. wouldExceedMaxDepth：跨父级移动深度预判 ============
  describe('wouldExceedMaxDepth（深度超限预判）', () => {
    it('跨父级移动导致子树深度超限 → 返回 true（应拒绝）', () => {
      // 构造：source 为 book-1（level 1）带 3 层子树（深度 4：book-1->vol-1->part-1->sec-1）
      const chapters: Chapter[] = [
        makeChapter({ id: 'book-1', levelType: 'book', level: 1, parentId: null, order: 0 }),
        makeChapter({ id: 'vol-1', levelType: 'volume', level: 2, parentId: 'book-1', order: 0 }),
        makeChapter({ id: 'part-1', levelType: 'part', level: 3, parentId: 'vol-1', order: 0 }),
        makeChapter({ id: 'sec-1', levelType: 'section', level: 4, parentId: 'part-1', order: 0 }),
        // 目标父节点：deep-parent（level 4），其下放 source 后最深层级 = 5 + 4 - 1 = 8 > 5
        makeChapter({ id: 'deep-parent', levelType: 'section', level: 4, parentId: null, order: 1 }),
      ];
      // source 子树深度 4，目标 level = deep-parent.level + 1 = 5
      // 最深 = 5 + 4 - 1 = 8 > CHAPTER_MAX_LEVEL(5) → 超限
      expect(wouldExceedMaxDepth(chapters, 'book-1', 'deep-parent')).toBe(true);
    });

    it('跨父级移动未超限 → 返回 false（应放行）', () => {
      const chapters = makeDeepTree();
      // 把 ch-1（单节点，深度 1）移到 book-1（level 1）下
      // 目标 level = 2，最深 = 2 + 1 - 1 = 2 ≤ 5 → 放行
      expect(wouldExceedMaxDepth(chapters, 'ch-1', 'book-1')).toBe(false);
    });

    it('移到根级 → 按根级 level=1 计算', () => {
      const chapters = makeDeepTree();
      // 把 vol-1 子树（深度 4）移到根级
      // 目标 level = 1，最深 = 1 + 4 - 1 = 4 ≤ 5 → 放行
      expect(wouldExceedMaxDepth(chapters, 'vol-1', null)).toBe(false);
      // 但把 book-1 整树（深度 5）移到根级：1 + 5 - 1 = 5 ≤ 5 → 放行
      expect(wouldExceedMaxDepth(chapters, 'book-1', null)).toBe(false);
    });

    it('边界：恰好等于 maxDepth → 不超限（> 才超限）', () => {
      const chapters = makeDeepTree();
      // book-1 整树深度 5，移到根级 level=1：1 + 5 - 1 = 5 == 5 → 不超限
      expect(wouldExceedMaxDepth(chapters, 'book-1', null, 5)).toBe(false);
      // 把深度 5 的子树移到 level 2 父节点：2 + 5 - 1 = 6 > 5 → 超限
      expect(wouldExceedMaxDepth(chapters, 'book-1', 'vol-1', 5)).toBe(true);
    });

    it('支持自定义 maxDepth 参数', () => {
      const chapters = makeDeepTree();
      // 在 maxDepth=3 下，把 vol-1 子树（深度 4）移到根级：1 + 4 - 1 = 4 > 3 → 超限
      expect(wouldExceedMaxDepth(chapters, 'vol-1', null, 3)).toBe(true);
    });

    it('空 chapters → 返回 false（安全回退）', () => {
      expect(wouldExceedMaxDepth([], 'x', null)).toBe(false);
    });
  });

  // ============ 2. recomputeSiblingOrder：同级 order 重算 ============
  describe('recomputeSiblingOrder（同级 order 重算）', () => {
    it('同级重排 → order 正确重算为 0..n 连续递增', () => {
      // 故意制造 order 断层：[order=5, order=0, order=10]
      const chapters: Chapter[] = [
        makeChapter({ id: 'a', parentId: null, order: 5 }),
        makeChapter({ id: 'b', parentId: null, order: 0 }),
        makeChapter({ id: 'c', parentId: null, order: 10 }),
      ];
      const updates = recomputeSiblingOrder(chapters, null);
      // 按 order 排序后为 b(0), a(5), c(10) → 重排 idx 0,1,2
      // b: 0→0 无变化（跳过），a: 5→1 变化，c: 10→2 变化
      expect(updates).toEqual([
        { id: 'a', order: 1 },
        { id: 'c', order: 2 },
      ]);
    });

    it('order 已连续正确 → 返回空数组（无需更新）', () => {
      const chapters: Chapter[] = [
        makeChapter({ id: 'a', parentId: null, order: 0 }),
        makeChapter({ id: 'b', parentId: null, order: 1 }),
        makeChapter({ id: 'c', parentId: null, order: 2 }),
      ];
      expect(recomputeSiblingOrder(chapters, null)).toEqual([]);
    });

    it('仅重算指定父级下的同级，不影响其他父级的节点', () => {
      const chapters: Chapter[] = [
        makeChapter({ id: 'root', parentId: null, order: 0 }),
        // p1 下的子节点 order 断层
        makeChapter({ id: 'a', parentId: 'p1', order: 5 }),
        makeChapter({ id: 'b', parentId: 'p1', order: 0 }),
        // p2 下的子节点 order 也乱序，但不应被纳入
        makeChapter({ id: 'c', parentId: 'p2', order: 9 }),
      ];
      // p1 下排序 b(0), a(5) → idx 0,1；b:0→0 跳过，a:5→1 变化
      expect(recomputeSiblingOrder(chapters, 'p1')).toEqual([
        { id: 'a', order: 1 },
      ]);
    });

    it('仅返回 order 实际变化的节点（部分已正确的跳过）', () => {
      // a(0)、b(1) 排序后仍位于 idx 0、1，order 不变；仅 c 需更新
      const chapters: Chapter[] = [
        makeChapter({ id: 'a', parentId: null, order: 0 }),
        makeChapter({ id: 'b', parentId: null, order: 1 }),
        makeChapter({ id: 'c', parentId: null, order: 10 }),
      ];
      // 排序后 a(0)->idx0, b(1)->idx1, c(10)->idx2
      // a: 0→0 不变（跳过），b: 1→1 不变（跳过），c: 10→2 变化
      expect(recomputeSiblingOrder(chapters, null)).toEqual([
        { id: 'c', order: 2 },
      ]);
    });

    it('指定父级下无子节点 → 返回空数组', () => {
      const chapters = makeDeepTree();
      expect(recomputeSiblingOrder(chapters, 'ch-1')).toEqual([]);
      // ch-1 是叶子节点，无子节点
    });

    it('空 chapters → 返回空数组（安全回退）', () => {
      expect(recomputeSiblingOrder([], null)).toEqual([]);
      expect(recomputeSiblingOrder([], 'any')).toEqual([]);
    });
  });

  // ============ computeDropTarget：拖拽目标决策 ============
  describe('computeDropTarget（拖拽目标决策）', () => {
    it('拖到自身后代上 → 不作为后代子级（避免环），降级为同级', () => {
      // book-1 拖到自己的后代 vol-1 上：wouldCreateCycle = true
      const chapters = makeDeepTree();
      // visibleIds 中 book-1 在 vol-1 之前（dropBelow = true）
      const visibleIds = ['book-1', 'vol-1', 'part-1', 'sec-1', 'ch-1'];
      const result = computeDropTarget(chapters, 'book-1', 'vol-1', visibleIds);
      expect(result).not.toBeNull();
      // 不应把 book-1 挂到 vol-1 下（那会创建环）；应降级为同级排序
      expect(result!.newParentId).not.toBe('vol-1');
      // 同级分支：newParentId = overChapter.parentId = book-1（vol-1 的父是 book-1）
      expect(result!.newParentId).toBe('book-1');
    });

    it('dropBelow 且目标有子节点 → 作为目标子级（newParentId = overId）', () => {
      const chapters: Chapter[] = [
        makeChapter({ id: 'book-1', parentId: null, level: 1, order: 0 }),
        makeChapter({ id: 'vol-1', parentId: 'book-1', level: 2, order: 0 }),
        // ch-mover 当前是根级节点，拖到 book-1 下
        makeChapter({ id: 'ch-mover', parentId: null, level: 1, order: 1 }),
      ];
      // visibleIds: ch-mover 在 book-1 之后 → dropBelow = false（activeIndex > overIndex）
      // 为触发 dropBelow=true，让 ch-mover 排在 book-1 之前
      const visibleIds = ['ch-mover', 'book-1', 'vol-1'];
      const result = computeDropTarget(chapters, 'ch-mover', 'book-1', visibleIds);
      expect(result).not.toBeNull();
      // book-1 有子节点 vol-1，dropBelow=true，无环，ch-mover 当前父不是 book-1 → 作为 book-1 子级
      expect(result!.newParentId).toBe('book-1');
      // order = book-1 现有子节点数 = 1（vol-1）
      expect(result!.newOrder).toBe(1);
    });

    it('拖到目标上半部分（dropBelow=false）→ 作为同级前驱', () => {
      const chapters: Chapter[] = [
        makeChapter({ id: 'a', parentId: null, level: 1, order: 0 }),
        makeChapter({ id: 'b', parentId: null, level: 1, order: 1 }),
      ];
      // b 拖到 a 上：visibleIds 中 b 在 a 之后 → activeIndex > overIndex → dropBelow = false
      const visibleIds = ['a', 'b'];
      const result = computeDropTarget(chapters, 'b', 'a', visibleIds);
      expect(result).not.toBeNull();
      // a 无子节点 → 走同级分支
      expect(result!.newParentId).toBe(null); // a.parentId = null
      expect(result!.newOrder).toBe(0); // dropBelow ? order+1 : order → a.order = 0
    });

    it('拖到目标下半部分（dropBelow=true）且目标无子节点 → 作为同级后继', () => {
      const chapters: Chapter[] = [
        makeChapter({ id: 'a', parentId: 'p1', level: 2, order: 0 }),
        makeChapter({ id: 'b', parentId: 'p1', level: 2, order: 1 }),
      ];
      // a 拖到 b 上：a 在 b 之前 → dropBelow = true
      const visibleIds = ['a', 'b'];
      const result = computeDropTarget(chapters, 'a', 'b', visibleIds);
      expect(result).not.toBeNull();
      // b 无子节点 → 同级分支
      expect(result!.newParentId).toBe('p1'); // b.parentId = p1
      expect(result!.newOrder).toBe(2); // dropBelow ? b.order+1 : b.order → 1+1=2
    });

    it('已经是目标的子级 → 不重复挂载，降级为同级排序', () => {
      // ch-mover 已经是 book-1 的子级，再拖到 book-1 上不应重复挂载为子级
      const chapters: Chapter[] = [
        makeChapter({ id: 'book-1', parentId: null, level: 1, order: 0 }),
        makeChapter({ id: 'vol-1', parentId: 'book-1', level: 2, order: 0 }),
        makeChapter({ id: 'ch-mover', parentId: 'book-1', level: 2, order: 1 }),
      ];
      // 构造 dropBelow=true 的场景：ch-mover 在 visibleIds 中排在 book-1 之前
      const visibleIds = ['ch-mover', 'book-1', 'vol-1'];
      const result = computeDropTarget(chapters, 'ch-mover', 'book-1', visibleIds);
      expect(result).not.toBeNull();
      // ch-mover.parentId === book-1 → 不满足"draggedChapter.parentId !== overId"，降级同级
      expect(result!.newParentId).toBe(null); // book-1.parentId = null
    });

    it('拖拽源或目标节点不存在 → 返回 null', () => {
      const chapters = makeDeepTree();
      expect(computeDropTarget(chapters, 'not-exist', 'book-1', ['book-1'])).toBeNull();
      expect(computeDropTarget(chapters, 'book-1', 'not-exist', ['book-1'])).toBeNull();
    });

    it('拖拽源或目标不在 visibleIds 中 → 返回 null', () => {
      const chapters = makeDeepTree();
      // visibleIds 不含 book-1
      expect(computeDropTarget(chapters, 'book-1', 'vol-1', ['vol-1'])).toBeNull();
      expect(computeDropTarget(chapters, 'book-1', 'vol-1', ['book-1'])).toBeNull();
    });

    it('空 chapters → 返回 null（安全回退）', () => {
      expect(computeDropTarget([], 'a', 'b', ['a', 'b'])).toBeNull();
    });
  });

  // ============ 6. 空 chapters 数组安全回退（汇总） ============
  describe('空 chapters 数组安全回退', () => {
    it('所有纯函数在空 chapters 下不抛错并返回安全默认值', () => {
      const empty: Chapter[] = [];
      expect(isDescendant(empty, 'a', 'b')).toBe(false);
      expect(computeNewLevel(empty, null)).toBe(1);
      expect(computeNewLevel(empty, 'a')).toBe(1);
      expect(getSubtreeMaxDepth(empty, 'a')).toBe(1);
      expect(wouldExceedMaxDepth(empty, 'a', null)).toBe(false);
      expect(recomputeSiblingOrder(empty, null)).toEqual([]);
      expect(recomputeSiblingOrder(empty, 'a')).toEqual([]);
      expect(computeDropTarget(empty, 'a', 'b', ['a', 'b'])).toBeNull();
    });
  });

  // ============ 与 CHAPTER_MAX_LEVEL 常量一致性 ============
  describe('与 CHAPTER_MAX_LEVEL 一致', () => {
    it('wouldExceedMaxDepth 默认 maxDepth 等于 CHAPTER_MAX_LEVEL', () => {
      // 构造恰好触发默认上限的边界：深度 5 的子树移到 level 2 父节点 → 2+5-1=6 > 5
      const chapters = makeDeepTree();
      // book-1 子树深度 5，移到 vol-1（level 2）下：targetLevel=3, 3+5-1=7 > 5
      expect(wouldExceedMaxDepth(chapters, 'book-1', 'vol-1')).toBe(true);
      // 显式传 CHAPTER_MAX_LEVEL 应与默认结果一致
      expect(wouldExceedMaxDepth(chapters, 'book-1', 'vol-1', CHAPTER_MAX_LEVEL)).toBe(true);
    });
  });
});
