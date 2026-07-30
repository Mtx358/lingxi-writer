/**
 * 灵感打磨域 slice（规格书第一阶段）
 *
 * 承载"灵感打磨"功能的全部状态与逻辑：
 *   - 碎片捕获（inspirationCards）：灵感卡的增删改，支持按章节关联
 *   - 卡片促活（askInspirationCard / addInspirationChildCard）：对主卡深度提问，
 *     创作者的问答沉淀为子卡，主卡/子卡在面板形成树状关联（childCount 维护）
 *   - 连线沙盘（storyLinks）：两张卡之间生成叙事脉络，串联散落灵感
 *
 * 与其他 slice 的耦合：
 *   - 读 currentProjectId（projectSlice）确定卡片归属
 *   - closeProject 时通过 registerProjectCleanup 清空 cards/links 与并发守卫
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { InspirationCard, StoryLink, MaterialQuestion } from '@/types';
import { generateId, markDirty } from '@/utils/storage';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { deepAskInspirationCard, generateStoryLink } from '@/utils/aiService';
import { registerProjectCleanup } from '../projectCleanup';

/**
 * 异步 action 并发守卫：以 action 维度记录最新一次请求 ID。
 *
 * 场景：用户对同一张卡连续触发"深度提问/生成脉络"，早先的 LLM 请求可能晚于
 * 最新的请求返回；若不守卫，旧响应会覆盖新响应。每次进入异步 action 时 ++ 自增
 * 并写入 Map，await 后比对——若不一致说明期间有新请求进入，本次结果作废。
 */
const lastRequestIds = new Map<string, number>();
let requestCounter = 0;

function beginRequest(key: string): { isStale: () => boolean } {
  const id = ++requestCounter;
  lastRequestIds.set(key, id);
  return { isStale: () => lastRequestIds.get(key) !== id };
}

/**
 * 清空所有并发守卫的请求 ID 记录。
 *
 * 项目切换时调用：让所有在飞的请求 isStale() 返回 true（lastRequestIds.get(key)
 * 为 undefined，与本次 id !== undefined 比较为 true），相当于强制取消。
 * 同时避免 'askInspirationCard:${cardId}' 这类 key 跨项目累积。
 */
export function clearInspirationRequests(): void {
  lastRequestIds.clear();
}

/** 测试隔离用：重置模块级请求守卫状态，避免跨用例泄漏 */
export function _resetInspirationRequestState(): void {
  lastRequestIds.clear();
  requestCounter = 0;
}

/**
 * 模块级 store state 清理句柄。
 *
 * registerProjectCleanup 在模块加载时注册，此时 store 尚未创建、set 不在作用域内。
 * 故在 slice creator 中捕获 set 引用，清理回调据此清空 store 内的 cards/links。
 * 生产环境 store 为单例，覆盖赋值无副作用；测试若多实例化则最后一次赋值生效。
 */
let runStoreCleanup: (() => void) | null = null;

// 项目切换时：清空并发守卫 + 清空 store 内的 cards/links
registerProjectCleanup(() => {
  clearInspirationRequests();
  runStoreCleanup?.();
});

type InspirationSlice = Pick<AppState,
  | 'inspirationCards' | 'storyLinks' | 'isInspirationBusy'
  | 'addInspirationCard' | 'updateInspirationCard' | 'deleteInspirationCard'
  | 'askInspirationCard' | 'addInspirationChildCard'
  | 'createStoryLink' | 'deleteStoryLink' | 'getRelatedInspirationCards'>;

export const createInspirationSlice: StateCreator<AppState, [], [], InspirationSlice> = (set, get) => {
  // 捕获 set 引用供模块级清理回调使用
  runStoreCleanup = () => set({ inspirationCards: [], storyLinks: [] });

  return {
    inspirationCards: [],
    storyLinks: [],
    isInspirationBusy: false,

    addInspirationCard: (input) => {
      const projectId = get().currentProjectId;
      if (!projectId) {
        toast.error('添加失败', '当前没有打开的项目');
        return {} as InspirationCard;
      }
      const card: InspirationCard = {
        id: generateId(),
        projectId,
        type: input.type,
        title: input.title,
        content: input.content,
        createdAt: new Date().toISOString(),
        relatedChapterId: input.relatedChapterId,
        childCount: 0,
        status: 'pending',
      };
      set({ inspirationCards: [card, ...get().inspirationCards] });
      markDirty();
      return card;
    },

    updateInspirationCard: (cardId, updates) => {
      set({
        inspirationCards: get().inspirationCards.map(c =>
          c.id === cardId ? { ...c, ...updates } : c
        ),
      });
      markDirty();
    },

    deleteInspirationCard: (cardId) => {
      // 收集被删除的卡片 ID：主卡 + 其直接子卡（parentId===cardId）
      const deletedIds = new Set<string>([cardId]);
      get().inspirationCards.forEach(c => {
        if (c.parentId === cardId) deletedIds.add(c.id);
      });
      set({
        inspirationCards: get().inspirationCards.filter(c => !deletedIds.has(c.id)),
        // 清理关联的 storyLinks：任一端在被删卡片集合中即移除
        storyLinks: get().storyLinks.filter(
          l => !deletedIds.has(l.sourceCardId) && !deletedIds.has(l.targetCardId)
        ),
      });
      markDirty();
    },

    askInspirationCard: async (cardId): Promise<MaterialQuestion[]> => {
      const { inspirationCards, currentProjectId } = get();
      const card = inspirationCards.find(c => c.id === cardId);
      if (!card) return [];
      // 并发守卫：连续触发深度提问时，旧请求晚于新请求返回会覆盖新结果
      const req = beginRequest(`askInspirationCard:${cardId}`);
      set({ isInspirationBusy: true });
      try {
        const questions = await deepAskInspirationCard(card);
        // 期间若有新请求进入或项目已切换，丢弃本次结果
        if (req.isStale()) return [];
        if (get().currentProjectId !== currentProjectId) return [];
        // 卡片可能已被删除
        if (!get().inspirationCards.find(c => c.id === cardId)) return [];
        return questions;
      } catch (e) {
        console.warn('askInspirationCard failed:', e);
        if (!req.isStale() && get().currentProjectId === currentProjectId) {
          toast.error('深度提问失败', getErrorMessage(e));
        }
        return [];
      } finally {
        // 仅当本次仍是最新请求时才复位 busy：否则会把后续请求的 busy 清掉
        if (!req.isStale()) set({ isInspirationBusy: false });
      }
    },

    addInspirationChildCard: (parentId, dimension, question, answer) => {
      const { inspirationCards, currentProjectId } = get();
      const parent = inspirationCards.find(c => c.id === parentId);
      if (!parent || !currentProjectId) return null;
      const child: InspirationCard = {
        id: generateId(),
        projectId: currentProjectId,
        type: parent.type,
        title: question,
        content: answer,
        createdAt: new Date().toISOString(),
        parentId,
        dimension,
      };
      set({
        inspirationCards: [
          child,
          ...inspirationCards.map(c =>
            c.id === parentId
              ? { ...c, childCount: (c.childCount || 0) + 1 }
              : c
          ),
        ],
      });
      markDirty();
      return child;
    },

    createStoryLink: async (sourceCardId, targetCardId) => {
      const { inspirationCards, currentProjectId } = get();
      if (!currentProjectId) return null;
      const source = inspirationCards.find(c => c.id === sourceCardId);
      const target = inspirationCards.find(c => c.id === targetCardId);
      if (!source || !target) return null;
      // 并发守卫：以"源-目标"对为 key，避免同一对连续生成的旧响应覆盖新响应
      const req = beginRequest(`storyLink:${sourceCardId}:${targetCardId}`);
      try {
        const { narrative, note } = await generateStoryLink(source, target);
        if (req.isStale()) return null;
        if (get().currentProjectId !== currentProjectId) return null;
        // 卡片可能已被删除
        const stillExists = get().inspirationCards;
        if (!stillExists.find(c => c.id === sourceCardId) || !stillExists.find(c => c.id === targetCardId)) {
          return null;
        }
        const link: StoryLink = {
          id: generateId(),
          projectId: currentProjectId,
          sourceCardId,
          targetCardId,
          narrative,
          note,
          createdAt: new Date().toISOString(),
        };
        set({ storyLinks: [link, ...get().storyLinks] });
        markDirty();
        return link;
      } catch (e) {
        console.warn('createStoryLink failed:', e);
        if (!req.isStale() && get().currentProjectId === currentProjectId) {
          toast.error('生成脉络失败', getErrorMessage(e));
        }
        return null;
      }
    },

    deleteStoryLink: (linkId) => {
      set({ storyLinks: get().storyLinks.filter(l => l.id !== linkId) });
      markDirty();
    },

    getRelatedInspirationCards: (chapterId) =>
      get().inspirationCards.filter(c => c.relatedChapterId === chapterId),
  };
};
