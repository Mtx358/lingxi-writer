/**
 * 多线作战指挥台 slice（规格书第三阶段）
 *
 * 承载"多线作战指挥台"功能的全部状态与逻辑：
 *   - 故事线管理（storylines）：主线/反派线/支线的增删改，每条线带颜色与时间轴节点
 *   - 时间轴节点（TimelineNode）：章节级锚点，order 与章节 order 对齐
 *   - 交集点预警（intersectionTargets + checkIntersection）：设定多条线索在某章
 *     交汇，系统按"交集前 3 章"是否有节点判定 ok / warning / danger
 *
 * 与其他 slice 的耦合：
 *   - 读 currentProjectId（projectSlice）确定线索归属
 *   - 读 chapters（chapterSlice）取章节 order/title，作为时间轴节点与预警窗口基准
 *   - closeProject 时通过 registerProjectCleanup 清空 storylines/targets
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { Storyline, StorylineType, IntersectionTarget, TimelineNode, MultiLineConflict } from '@/types';
import { generateId, markDirty } from '@/utils/storage';
import { registerProjectCleanup } from '../projectCleanup';

/** 线索类型默认颜色：主线蓝 / 反派红 / 支线绿 */
const DEFAULT_STORYLINE_COLOR: Record<StorylineType, string> = {
  protagonist: '#3b82f6',
  antagonist: '#ef4444',
  subplot: '#10b981',
};

/**
 * 模块级 store state 清理句柄。
 *
 * registerProjectCleanup 在模块加载时注册，此时 store 尚未创建、set 不在作用域内。
 * 故在 slice creator 中捕获 set 引用，清理回调据此清空 store 内的 storylines/targets。
 */
let runStoreCleanup: (() => void) | null = null;

registerProjectCleanup(() => {
  runStoreCleanup?.();
});

type MultiLineSlice = Pick<AppState,
  | 'storylines' | 'intersectionTargets' | 'multiLineConflicts'
  | 'addStoryline' | 'updateStoryline' | 'deleteStoryline'
  | 'addTimelineNode' | 'removeTimelineNode' | 'moveTimelineNode'
  | 'addIntersectionTarget' | 'deleteIntersectionTarget' | 'checkIntersection'
  | 'detectMultiLineConflicts'>;

export const createMultiLineSlice: StateCreator<AppState, [], [], MultiLineSlice> = (set, get) => {
  // 捕获 set 引用供模块级清理回调使用
  runStoreCleanup = () => set({ storylines: [], intersectionTargets: [] });

  return {
    storylines: [],
    intersectionTargets: [],
    multiLineConflicts: [],

    addStoryline: (input) => {
      const projectId = get().currentProjectId;
      if (!projectId) return null;
      const storyline: Storyline = {
        id: generateId(),
        projectId,
        type: input.type,
        name: input.name,
        color: input.color || DEFAULT_STORYLINE_COLOR[input.type],
        nodes: [],
      };
      set({ storylines: [...get().storylines, storyline] });
      markDirty();
      return storyline;
    },

    updateStoryline: (storylineId, updates) => {
      set({
        storylines: get().storylines.map(s =>
          s.id === storylineId ? { ...s, ...updates } : s
        ),
      });
      markDirty();
    },

    deleteStoryline: (storylineId) => {
      set({
        storylines: get().storylines.filter(s => s.id !== storylineId),
        // 从交集目标中移除该线索引用；若某目标的 storylineIds 因此变空则整体删除
        intersectionTargets: get().intersectionTargets
          .map(t => {
            if (!t.storylineIds.includes(storylineId)) return t;
            return { ...t, storylineIds: t.storylineIds.filter(id => id !== storylineId) };
          })
          .filter(t => t.storylineIds.length > 0),
      });
      markDirty();
    },

    addTimelineNode: (storylineId, chapterId) => {
      const { storylines, chapters, currentProjectId } = get();
      if (!currentProjectId) return null;
      const chapter = chapters.find(c => c.id === chapterId);
      if (!chapter) return null;
      const storyline = storylines.find(s => s.id === storylineId);
      if (!storyline) return null;
      const node: TimelineNode = {
        id: generateId(),
        storylineId,
        chapterId,
        title: chapter.title,
        order: chapter.order,
      };
      set({
        storylines: get().storylines.map(s =>
          s.id === storylineId
            ? { ...s, nodes: [...s.nodes, node].sort((a, b) => a.order - b.order) }
            : s
        ),
      });
      markDirty();
      return node;
    },

    removeTimelineNode: (storylineId, nodeId) => {
      set({
        storylines: get().storylines.map(s =>
          s.id === storylineId
            ? { ...s, nodes: s.nodes.filter(n => n.id !== nodeId) }
            : s
        ),
      });
      markDirty();
    },

    addIntersectionTarget: (input) => {
      const projectId = get().currentProjectId;
      if (!projectId) return null;
      if (input.storylineIds.length === 0) return null;
      const target: IntersectionTarget = {
        id: generateId(),
        projectId,
        chapterId: input.chapterId,
        description: input.description,
        storylineIds: [...input.storylineIds],
        status: null,
      };
      set({ intersectionTargets: [...get().intersectionTargets, target] });
      markDirty();
      return target;
    },

    deleteIntersectionTarget: (targetId) => {
      set({ intersectionTargets: get().intersectionTargets.filter(t => t.id !== targetId) });
      markDirty();
    },

    checkIntersection: (targetId) => {
      const { intersectionTargets, storylines, chapters } = get();
      const target = intersectionTargets.find(t => t.id === targetId);
      if (!target) return;

      const intersectionChapter = chapters.find(c => c.id === target.chapterId);
      if (!intersectionChapter) {
        set({
          intersectionTargets: get().intersectionTargets.map(t =>
            t.id === targetId
              ? { ...t, status: 'danger', message: '交集章节不存在，无法汇合' }
              : t
          ),
        });
        return;
      }

      // 按 order 排序的章节级节点，用于确定"交集前 3 章"窗口
      const sortedChapterLevel = chapters
        .filter(c => c.levelType === 'chapter')
        .sort((a, b) => a.order - b.order);
      const intersectionIdx = sortedChapterLevel.findIndex(c => c.id === target.chapterId);
      // 前 3 章：交集章节之前的至多 3 个章节级节点
      const prevThreeChapterIds = new Set(
        sortedChapterLevel
          .slice(Math.max(0, intersectionIdx - 3), intersectionIdx)
          .map(c => c.id)
      );

      let hasDanger = false; // 有线索完全无节点
      let hasWarning = false; // 有线索节点不足（前 3 章窗口内无节点）
      const missingStorylines: string[] = [];
      const insufficientStorylines: string[] = [];

      for (const sid of target.storylineIds) {
        const storyline = storylines.find(s => s.id === sid);
        if (!storyline) {
          hasDanger = true;
          missingStorylines.push(sid);
          continue;
        }
        const nodesBefore = storyline.nodes.filter(n => n.order < intersectionChapter.order);
        if (nodesBefore.length === 0) {
          // 完全无节点：该线索在交集章节前没有任何铺垫，无法汇合
          hasDanger = true;
          missingStorylines.push(storyline.name);
          continue;
        }
        const nodesInWindow = storyline.nodes.filter(n =>
          prevThreeChapterIds.has(n.chapterId)
        );
        if (nodesInWindow.length === 0) {
          // 节点不足：有铺垫但不在交集前 3 章窗口内，需提前铺垫
          hasWarning = true;
          insufficientStorylines.push(storyline.name);
        }
      }

      let status: IntersectionTarget['status'];
      let message: string;
      if (hasDanger) {
        status = 'danger';
        message = missingStorylines.length > 0
          ? `无法汇合：${missingStorylines.join('、')} 在交集前无节点`
          : '无法汇合：存在线索在交集前无节点';
      } else if (hasWarning) {
        status = 'warning';
        message = insufficientStorylines.length > 0
          ? `需提前铺垫：${insufficientStorylines.join('、')} 在交集前 3 章无节点`
          : '需提前铺垫：存在线索在交集前 3 章无节点';
      } else {
        status = 'ok';
        message = '按时汇合：所有线索在交集前 3 章均有节点';
      }

      set({
        intersectionTargets: get().intersectionTargets.map(t =>
          t.id === targetId ? { ...t, status, message } : t
        ),
      });
      markDirty();
    },

    /**
     * 自动巡检所有线索的时间矛盾与行程冲突（文档：智能错位检测）。
     * 检测项：
     *   - order-inversion 顺序倒置：同一线索节点 order 非单调递增（时间倒流）
     *   - node-gap 节点真空：相邻节点章节跨度 ≥5 章（线索长时间无推进）
     *   - time-paradox 时间矛盾：同一章节被同一线索的多个节点占用（分身）
     *   - travel-conflict 行程冲突：同一章节被不同线索的节点占用且线索类型互斥
     */
    detectMultiLineConflicts: () => {
      const { storylines, chapters } = get();
      const conflicts: MultiLineConflict[] = [];
      const chapterById = new Map(chapters.map(c => [c.id, c]));

      for (const sl of storylines) {
        const nodes = [...sl.nodes].sort((a, b) => a.order - b.order);
        // 顺序倒置检测
        for (let i = 1; i < nodes.length; i++) {
          if (nodes[i].order < nodes[i - 1].order) {
            conflicts.push({
              id: generateId(),
              type: 'order-inversion',
              storylineId: sl.id,
              storylineName: sl.name,
              chapterId: nodes[i].chapterId,
              description: `线索「${sl.name}」节点顺序倒置：第${nodes[i - 1].order}章之后出现第${nodes[i].order}章节点，时间倒流`,
              suggestion: '调整节点章节归属，让线索按章节顺序推进',
              severity: 'error',
            });
          }
        }
        // 节点真空检测：相邻节点章节跨度 ≥5
        for (let i = 1; i < nodes.length; i++) {
          const gap = nodes[i].order - nodes[i - 1].order;
          if (gap >= 5) {
            conflicts.push({
              id: generateId(),
              type: 'node-gap',
              storylineId: sl.id,
              storylineName: sl.name,
              chapterId: nodes[i].chapterId,
              description: `线索「${sl.name}」在 第${nodes[i - 1].order}章 到 第${nodes[i].order}章 之间跨度 ${gap} 章无节点，线索长时间停滞`,
              suggestion: `在第${nodes[i - 1].order + 1}~${nodes[i].order - 1}章之间补充 1-2 个推进节点，避免读者遗忘该线索`,
              severity: 'warning',
            });
          }
        }
        // 时间矛盾检测：同一章节被同一线索多个节点占用（分身）
        const chapterCount = new Map<string, number>();
        for (const n of nodes) {
          chapterCount.set(n.chapterId, (chapterCount.get(n.chapterId) || 0) + 1);
        }
        for (const [chId, cnt] of chapterCount) {
          if (cnt > 1) {
            const ch = chapterById.get(chId);
            conflicts.push({
              id: generateId(),
              type: 'time-paradox',
              storylineId: sl.id,
              storylineName: sl.name,
              chapterId: chId,
              description: `线索「${sl.name}」在第${ch?.order ?? '?'}章《${ch?.title ?? ''}》有 ${cnt} 个节点，同一章节多处出现可能导致时间矛盾`,
              suggestion: '合并同章节点，或拆分到相邻章节',
              severity: 'error',
            });
          }
        }
      }

      // 行程冲突检测：主角线与反派线在同一章节都有节点（可能行程冲突）
      const protagonist = storylines.find(s => s.type === 'protagonist');
      const antagonist = storylines.find(s => s.type === 'antagonist');
      if (protagonist && antagonist) {
        const pChapters = new Set(protagonist.nodes.map(n => n.chapterId));
        for (const aNode of antagonist.nodes) {
          if (pChapters.has(aNode.chapterId)) {
            const ch = chapterById.get(aNode.chapterId);
            // 仅当该章节非交集目标时才报行程冲突（交集目标已在 checkIntersection 处理）
            const isIntersection = get().intersectionTargets.some(t => t.chapterId === aNode.chapterId);
            if (!isIntersection) {
              conflicts.push({
                id: generateId(),
                type: 'travel-conflict',
                storylineId: antagonist.id,
                storylineName: antagonist.name,
                chapterId: aNode.chapterId,
                description: `主角线与反派线在第${ch?.order ?? '?'}章《${ch?.title ?? ''}》同时出现节点，但该章节未设为交集点，可能存在行程冲突`,
                suggestion: '确认两条线索在此章的交互意图：若为交汇点，请添加交集目标；否则错开章节避免行程冲突',
                severity: 'warning',
              });
            }
          }
        }
      }

      set({ multiLineConflicts: conflicts });
    },

    /**
     * 拖拽对齐：把某节点移动到新章节位置（文档：节点拖拽对齐）。
     * 更新节点的 chapterId 和 order，同步重算冲突。
     */
    moveTimelineNode: (storylineId, nodeId, targetChapterId) => {
      const { storylines, chapters } = get();
      const targetChapter = chapters.find(c => c.id === targetChapterId);
      if (!targetChapter) return;
      const updated = storylines.map(sl => {
        if (sl.id !== storylineId) return sl;
        return {
          ...sl,
          nodes: sl.nodes.map(n =>
            n.id === nodeId
              ? { ...n, chapterId: targetChapterId, order: targetChapter.order, title: targetChapter.title }
              : n
          ),
        };
      });
      set({ storylines: updated });
      markDirty();
      // 拖拽后自动重算冲突
      get().detectMultiLineConflicts();
    },
  };
};
