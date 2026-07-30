/**
 * 打磨扩展 slice：读者评论回流 + 灵感缺口 + 撤销栈 + 骨架时间轴
 *
 * 这四个域逻辑简单且独立，合并到一个 slice 避免文件碎片化。
 * 版本花园因逻辑较重，单独放在 branchSlice.ts。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { ReviewReflowEntry, InspirationGap, UndoEntry, SkeletonTimelineEvent, PacingPreset } from '@/types';
import { generateId, markDirty } from '@/utils/storage';
import { toast } from '@/hooks/useToast';
import { registerProjectCleanup } from '../projectCleanup';

type PolishExtrasSlice = Pick<AppState,
  | 'reviewReflows' | 'addReviewReflow' | 'resolveReviewReflow' | 'deleteReviewReflow'
  | 'inspirationGaps' | 'setInspirationGaps' | 'addInspirationGap' | 'ignoreInspirationGap'
  | 'undoStack' | 'pushUndo' | 'performUndo' | 'clearUndoStack'
  | 'skeletonEvents' | 'pacingPresets' | 'setSkeletonEvents' | 'setPacingPresets'
  | 'polishRecheckNeeded' | 'markPolishRecheckNeeded' | 'clearPolishRecheckNeeded'>;

const MAX_UNDO = 30;

// 项目切换时清空撤销栈：旧项目的 undo 闭包引用旧 chapters，跨项目执行会污染新项目数据。
// 通过 get() 访问 store（运行期已就绪），避免模块加载期的循环引用问题。
let undoCleanupRegistered = false;

export const createPolishExtrasSlice: StateCreator<AppState, [], [], PolishExtrasSlice> = (set, get) => {
  // 注册项目切换清理（仅注册一次，guard 防止 store 重建时重复注册）
  if (!undoCleanupRegistered) {
    undoCleanupRegistered = true;
    registerProjectCleanup(() => {
      try {
        get().clearUndoStack();
      } catch {
        // store 未就绪时静默
      }
    });
  }
  return {
  reviewReflows: [],
  inspirationGaps: [],
  undoStack: [],
  skeletonEvents: [],
  pacingPresets: [],
  polishRecheckNeeded: false,

  // ===== 读者评论回流 =====
  addReviewReflow: (entry) => {
    const { currentProjectId } = get();
    if (!currentProjectId) return null;
    const now = new Date().toISOString();
    const record: ReviewReflowEntry = {
      ...entry,
      id: generateId(),
      projectId: currentProjectId,
      createdAt: now,
      resolved: false,
    };
    set(state => ({ reviewReflows: [record, ...state.reviewReflows] }));
    markDirty();
    return record;
  },

  resolveReviewReflow: (entryId) => {
    set(state => ({
      reviewReflows: state.reviewReflows.map(r =>
        r.id === entryId ? { ...r, resolved: true } : r,
      ),
    }));
    markDirty();
  },

  deleteReviewReflow: (entryId) => {
    set(state => ({ reviewReflows: state.reviewReflows.filter(r => r.id !== entryId) }));
    markDirty();
  },

  // ===== 灵感缺口 =====
  setInspirationGaps: (gaps: InspirationGap[]) => {
    set({ inspirationGaps: gaps });
    markDirty();
  },

  /**
   * 追加单条灵感缺口（规格书 3.2 / 阶段1-3：编辑器写作时触发的缺口回流到打磨台汇总）。
   * 与 setInspirationGaps（整体替换，蓝图反向推断用）互补：编辑器侧逐条回流时调用。
   * 去重策略：按 kind + description 匹配，已存在且未忽略则不重复追加，避免高频回流刷屏。
   * source 默认 'editor'，标记来源便于打磨台区分展示。
   */
  addInspirationGap: (gap) => {
    const { currentProjectId } = get();
    if (!currentProjectId) return;
    const fullGap: InspirationGap = {
      ...gap,
      id: generateId(),
      ignored: false,
      source: gap.source ?? 'editor',
      createdAt: new Date().toISOString(),
    };
    set(state => {
      // 去重：同 kind + 同描述已存在（无论是否忽略）则不重复追加。
      // 含 ignored：已被创作者忽略的缺口不应因编辑器再次触发而复活。
      const dup = state.inspirationGaps.some(g =>
        g.kind === fullGap.kind && g.description === fullGap.description,
      );
      if (dup) return {};
      // editor 回流缺口置顶（最新触发最显眼），blueprint 缺口在后
      const editorGaps = state.inspirationGaps.filter(g => g.source === 'editor');
      const otherGaps = state.inspirationGaps.filter(g => g.source !== 'editor');
      return { inspirationGaps: [fullGap, ...editorGaps, ...otherGaps] };
    });
    markDirty();
  },

  ignoreInspirationGap: (gapId) => {
    set(state => ({
      inspirationGaps: state.inspirationGaps.map(g =>
        g.id === gapId ? { ...g, ignored: true } : g,
      ),
    }));
    markDirty();
  },

  // ===== 撤销栈 =====
  pushUndo: (entry) => {
    const fullEntry: UndoEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };
    set(state => ({ undoStack: [fullEntry, ...state.undoStack].slice(0, MAX_UNDO) }));
  },

  performUndo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    const [top, ...rest] = undoStack;
    try {
      top.undo();
    } catch (e) {
      // 撤销失败：保留栈项（用户可重试或人工处理），不静默丢弃
      toast.error('撤销失败', `${top.description}：${e instanceof Error ? e.message : '内部异常，该项已保留在栈中'}`);
      return null;
    }
    set({ undoStack: rest });
    toast.info('已撤销', top.description);
    return top.description;
  },

  clearUndoStack: () => set({ undoStack: [] }),

  // ===== 编辑器→打磨台自动复检标记 =====
  // 编辑器正文保存（updateChapterContent 防抖触发）时调用 markPolishRecheckNeeded，
  // 打磨台挂载或监听到 polishRecheckNeeded=true 时自动重跑健康度诊断，复检后清标记。
  // 项目切换时一并清空（见 PROJECT_SWITCH_RESET），避免跨项目误触发复检。
  markPolishRecheckNeeded: () => set({ polishRecheckNeeded: true }),
  clearPolishRecheckNeeded: () => set({ polishRecheckNeeded: false }),

  // ===== 骨架时间轴 =====
  setSkeletonEvents: (events: SkeletonTimelineEvent[]) => {
    set({ skeletonEvents: events });
    markDirty();
  },

  setPacingPresets: (presets: PacingPreset[]) => {
    set({ pacingPresets: presets });
    markDirty();
  },
  };
};
