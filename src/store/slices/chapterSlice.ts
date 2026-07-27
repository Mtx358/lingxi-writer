/**
 * 章节域 slice
 *
 * 负责章节的增删改查、层级移动、当前章节切换、正文更新、编辑器插入协调。
 * 章节切换与正文更新会联动伏笔域（重算 chaptersSinceMention），
 * 章节删除会级联清理伏笔中的章节引用——均通过 get()/set() 跨域完成。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { Chapter, ChapterLevelType } from '@/types';
import { DEFAULT_CHAPTER_STATUS, levelToLevelType } from '@/types';
import { storage, generateId, countWords, markDirty } from '@/utils/storage';
import { SEARCH_DEBOUNCE_DELAY, CHAPTER_MAX_LEVEL } from '@/constants/config';
import { toast } from '@/hooks/useToast';
import { logError } from '@/utils/rendererLogger';
import { registerProjectCleanup } from '../projectCleanup';

type ChapterSlice = Pick<AppState,
  | 'chapters' | 'currentChapterId' | 'pendingEditorInsert' | 'pendingScrollTo' | 'contentEpoch' | 'isAIGenerating'
  | 'addChapter' | 'updateChapter' | 'batchUpdateChapterOrder' | 'deleteChapter' | 'moveChapter' | 'setCurrentChapter'
  | 'updateChapterContent' | 'setPendingEditorInsert' | 'setPendingScrollTo' | 'bumpContentEpoch' | 'setAIGenerating'>;

// 伏笔提及计数重算防抖计时器（避免每次按键都全量扫描章节）
let foreshadowRecomputeTimer: ReturnType<typeof setTimeout> | null = null;

// saveRecoveryDraft 失败计数器与节流时间戳（C-M4 修复）：
// 编辑器每次按键防抖触发 saveRecoveryDraft，磁盘错误时会连续失败。
// 不节流会每秒刷屏 toast；节流策略：首次失败立即提示，之后每 5 分钟提示一次
let recoveryFailCount = 0;
let lastRecoveryToastTime = 0;

/** 测试隔离用：重置模块级 recovery 状态，避免跨用例泄漏 */
export function _resetRecoveryState(): void {
  recoveryFailCount = 0;
  lastRecoveryToastTime = 0;
}

/**
 * 清除伏笔提及重算防抖计时器。在项目切换入口（createProject/openProject/
 * openProjectFile/loadSampleProject/closeProject）调用，避免上一项目残留的
 * 防抖回调在新项目加载后立即触发一次无意义的全量扫描（O(chapters × foreshadows)）。
 */
export function clearForeshadowRecomputeTimer(): void {
  if (foreshadowRecomputeTimer) {
    clearTimeout(foreshadowRecomputeTimer);
    foreshadowRecomputeTimer = null;
  }
}

// 项目切换时自动清理伏笔重算防抖计时器
registerProjectCleanup(clearForeshadowRecomputeTimer);

export const createChapterSlice: StateCreator<AppState, [], [], ChapterSlice> = (set, get) => ({
  chapters: [],
  currentChapterId: null,
  pendingEditorInsert: null,
  pendingScrollTo: null,
  contentEpoch: 0,
  isAIGenerating: false,

  addChapter: (parentId: string | null, title: string, order?: number, levelType?: ChapterLevelType) => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) throw new Error('No project open');

    const parent = parentId ? chapters.find(c => c.id === parentId) : null;
    const level = parent ? parent.level + 1 : 1;

    // 嵌套层级上限保护：levelType 仅 5 种，超过后类型重复、语义模糊
    if (level > CHAPTER_MAX_LEVEL) {
      console.warn(`[addChapter] 已达最大嵌套层级 ${CHAPTER_MAX_LEVEL}，拒绝继续嵌套`);
      return null;
    }

    const levelOrder: ChapterLevelType[] = ['book', 'volume', 'part', 'section', 'chapter'];
    let resolvedLevelType = levelType;
    if (!resolvedLevelType) {
      if (parent) {
        const parentTypeIndex = levelOrder.indexOf(parent.levelType);
        resolvedLevelType = levelOrder[Math.min(parentTypeIndex + 1, levelOrder.length - 1)];
      } else {
        resolvedLevelType = level === 1 ? 'book' : 'chapter';
      }
    }

    const siblings = chapters.filter(c => c.parentId === parentId);
    const newOrder = order !== undefined ? order : siblings.length;

    const now = new Date().toISOString();
    const newChapter: Chapter = {
      id: generateId(), projectId: currentProjectId, parentId, title, summary: '', order: newOrder, level, levelType: resolvedLevelType, status: DEFAULT_CHAPTER_STATUS, wordCount: 0, content: '', createdAt: now, updatedAt: now,
    };

    // 原地对 order >= newOrder 的兄弟章节 +1，避免把 siblings 副本追加到末尾导致同一章节出现两次
    const updatedChapters = [
      ...chapters.map(c => c.parentId === parentId && c.order >= newOrder ? { ...c, order: c.order + 1 } : c),
      newChapter,
    ];
    set({ chapters: updatedChapters, currentChapterId: newChapter.id });
    markDirty();
    // 章节结构变化后立即重算伏笔提及距离，避免 chaptersSinceMention 与阅读顺序错位
    get().recomputeForeshadowMentions();
    return newChapter;
  },

  updateChapter: (chapterId: string, updates: Partial<Chapter>) => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return;

    const updatedChapters = chapters.map(c =>
      c.id === chapterId ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
    );
    set({ chapters: updatedChapters });
    markDirty();
  },

  // C1 性能修复：批量更新章节 order，单次 set + 单次 markDirty。
  // 拖拽重排时 rerank 对每个兄弟章节单独 updateChapter 会触发 N 次 set（N 轮订阅广播）+ N 次 markDirty。
  // 50 个兄弟章节 = 50 次全量 chapters 数组替换，主线程可感知卡顿。
  batchUpdateChapterOrder: (updates: Array<{ id: string; order: number }>) => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId || updates.length === 0) return;
    const orderMap = new Map(updates.map(u => [u.id, u.order]));
    const now = new Date().toISOString();
    const updatedChapters = chapters.map(c =>
      orderMap.has(c.id) ? { ...c, order: orderMap.get(c.id)!, updatedAt: now } : c
    );
    set({ chapters: updatedChapters });
    markDirty();
  },

  deleteChapter: (chapterId: string) => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return;

    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    // H3 性能修复：旧 getAllChildren 每层递归 filter 全量 chapters（O(n) per level）→ O(n×D)。
    // 改为先构建 parentId → children 索引一次，DFS 收集所有后代 ID，O(n)。
    // toDelete.includes 也是 O(n) 线性查找，改用 Set.has O(1)。
    const childrenByParent = new Map<string | null, Chapter[]>();
    for (const c of chapters) {
      const arr = childrenByParent.get(c.parentId);
      if (arr) arr.push(c);
      else childrenByParent.set(c.parentId, [c]);
    }
    const toDeleteSet = new Set<string>([chapterId]);
    const stack: string[] = [chapterId];
    while (stack.length > 0) {
      const pid = stack.pop()!;
      const children = childrenByParent.get(pid);
      if (!children) continue;
      for (const child of children) {
        toDeleteSet.add(child.id);
        stack.push(child.id);
      }
    }

    const updatedChapters = chapters
      .filter(c => !toDeleteSet.has(c.id))
      .map(c => c.parentId === chapter.parentId && c.order > chapter.order ? { ...c, order: c.order - 1 } : c);

    const { currentChapterId, foreshadows, subplots } = get();
    const newCurrent = toDeleteSet.has(currentChapterId || '') ? updatedChapters[0]?.id || null : currentChapterId;

    // 级联清理伏笔中指向被删章节的引用（置空而非删除伏笔）
    const deletedChapterSet = toDeleteSet;
    const updatedForeshadows = foreshadows.map(f => ({
      ...f,
      plantedChapterId: f.plantedChapterId && deletedChapterSet.has(f.plantedChapterId) ? null : f.plantedChapterId,
      payoffChapterId: f.payoffChapterId && deletedChapterSet.has(f.payoffChapterId) ? null : f.payoffChapterId,
    }));

    // 级联清理支线中指向被删章节的引用：startChapterId / lastProgressChapterId / expectedCloseChapterId
    // 不清理会让支线面板的章节 <select> 跳到"未指定"，掩盖数据不一致
    let updatedSubplots = subplots;
    if (subplots.some(s =>
      (s.startChapterId && deletedChapterSet.has(s.startChapterId)) ||
      (s.lastProgressChapterId && deletedChapterSet.has(s.lastProgressChapterId)) ||
      (s.expectedCloseChapterId && deletedChapterSet.has(s.expectedCloseChapterId))
    )) {
      updatedSubplots = subplots.map(s => ({
        ...s,
        startChapterId: s.startChapterId && deletedChapterSet.has(s.startChapterId) ? null : s.startChapterId,
        lastProgressChapterId: s.lastProgressChapterId && deletedChapterSet.has(s.lastProgressChapterId) ? null : s.lastProgressChapterId,
        expectedCloseChapterId: s.expectedCloseChapterId && deletedChapterSet.has(s.expectedCloseChapterId) ? null : s.expectedCloseChapterId,
      }));
    }

    // 级联清理被删章节（含子章节）的版本快照与撤销历史，避免留下孤儿数据
    const { versions, histories } = get();
    const updatedVersions = { ...versions };
    const updatedHistories = { ...histories };
    for (const id of toDeleteSet) {
      delete updatedVersions[id];
      delete updatedHistories[id];
    }

    set({
      chapters: updatedChapters,
      currentChapterId: newCurrent,
      foreshadows: updatedForeshadows,
      subplots: updatedSubplots,
      versions: updatedVersions,
      histories: updatedHistories,
    });

    // subplots 变更需同步回 project 才能持久化（subplots 顶层字段是从 project.subplots 同步来的）
    if (updatedSubplots !== subplots) {
      get().updateProject(currentProjectId, { subplots: updatedSubplots });
    }
    markDirty();
    // 章节结构变化后立即重算伏笔提及距离，避免 chaptersSinceMention 与阅读顺序错位
    get().recomputeForeshadowMentions();
  },

  moveChapter: (chapterId: string, newParentId: string | null, newOrder: number): boolean => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return false;

    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return false;

    const newParent = newParentId ? chapters.find(c => c.id === newParentId) : null;
    const newLevel = newParent ? newParent.level + 1 : 1;

    // H4 性能修复：旧 isDescendant/getSubtreeMaxDepth 每层递归 filter 全量 chapters → O(n×D)。
    // 改为先构建 parentId → children 索引一次，两个递归都复用索引，O(n) 总开销。
    const childrenByParent = new Map<string | null, Chapter[]>();
    for (const c of chapters) {
      const arr = childrenByParent.get(c.parentId);
      if (arr) arr.push(c);
      else childrenByParent.set(c.parentId, [c]);
    }
    const isDescendant = (parentId: string, childId: string): boolean => {
      const children = childrenByParent.get(parentId) || [];
      return children.some(c => c.id === childId || isDescendant(c.id, childId));
    };
    if (newParentId && isDescendant(chapterId, newParentId)) return false;

    // 计算子树最大深度，预判移动后是否超过最大嵌套层级
    const getSubtreeMaxDepth = (rootId: string): number => {
      const children = childrenByParent.get(rootId) || [];
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map(c => getSubtreeMaxDepth(c.id)));
    };
    const subtreeMaxDepth = getSubtreeMaxDepth(chapterId);
    if (newLevel + subtreeMaxDepth - 1 > CHAPTER_MAX_LEVEL) {
      console.warn(`[moveChapter] 移动后子树最深层级将超过 ${CHAPTER_MAX_LEVEL}，拒绝移动`);
      return false;
    }

    let updatedChapters: Chapter[];
    if (newParentId === chapter.parentId) {
      // 同父级移动：先把被移动章节摘出，对中间章节统一平移，再插入新位置。
      // 避免“原父级 -1”与“新父级 +1”对同一批章节同时生效导致 order 空洞或重复。
      const siblingsAfterRemoval = chapters
        .filter(c => c.parentId === chapter.parentId && c.id !== chapterId)
        .sort((a, b) => a.order - b.order);
      const clampedNewOrder = Math.max(0, Math.min(newOrder, siblingsAfterRemoval.length));
      const oldOrder = chapter.order;
      updatedChapters = chapters.map(c => {
        if (c.id === chapterId) {
          return { ...c, parentId: newParentId, order: clampedNewOrder, level: newLevel, levelType: levelToLevelType(newLevel) };
        }
        if (c.parentId !== chapter.parentId) return c;
        if (oldOrder < clampedNewOrder) {
          // 向后移动：order 在 (oldOrder, clampedNewOrder] 的章节统一 -1
          if (c.order > oldOrder && c.order <= clampedNewOrder) return { ...c, order: c.order - 1 };
        } else if (oldOrder > clampedNewOrder) {
          // 向前移动：order 在 [clampedNewOrder, oldOrder) 的章节统一 +1
          if (c.order >= clampedNewOrder && c.order < oldOrder) return { ...c, order: c.order + 1 };
        }
        return c;
      });
    } else {
      // 跨父级移动：原父级 order > chapter.order 的章节 -1，新父级 order >= newOrder 的章节 +1
      updatedChapters = chapters.map(c => {
        if (c.id === chapterId) return { ...c, parentId: newParentId, order: newOrder, level: newLevel, levelType: levelToLevelType(newLevel) };
        if (c.parentId === chapter.parentId && c.order > chapter.order) return { ...c, order: c.order - 1 };
        if (c.parentId === newParentId && c.order >= newOrder) return { ...c, order: c.order + 1 };
        return c;
      });
    }

    // 递归更新子章节的 level 与 levelType，保持两者一致
    // 优化：旧实现每次递归 filter+map 全量数组，深层级移动时 O(n²)；
    // 改为先构建 parentId → children 索引一次，递归只更新 Map，最后统一重建数组，复杂度 O(n)
    const levelDiff = newLevel - chapter.level;
    if (levelDiff !== 0) {
      const childrenByParent = new Map<string, Chapter[]>();
      for (const c of updatedChapters) {
        if (c.parentId) {
          const arr = childrenByParent.get(c.parentId);
          if (arr) arr.push(c);
          else childrenByParent.set(c.parentId, [c]);
        }
      }
      const affectedIds = new Set<string>([chapterId]);
      const stack: string[] = [chapterId];
      while (stack.length > 0) {
        const pid = stack.pop()!;
        const children = childrenByParent.get(pid);
        if (!children) continue;
        for (const child of children) {
          affectedIds.add(child.id);
          stack.push(child.id);
        }
      }
      updatedChapters = updatedChapters.map(c => {
        if (!affectedIds.has(c.id) || c.id === chapterId) return c; // chapterId 已在上一步更新
        const childNewLevel = c.level + levelDiff;
        return { ...c, level: childNewLevel, levelType: levelToLevelType(childNewLevel) };
      });
    }

    set({ chapters: updatedChapters });
    markDirty();
    // 章节结构变化后立即重算伏笔提及距离，避免 chaptersSinceMention 与阅读顺序错位
    get().recomputeForeshadowMentions();
    return true;
  },

  setCurrentChapter: (chapterId: string | null) => {
    // AI 生成期间锁定章节切换，避免串章与流式内容污染
    if (get().isAIGenerating) return;
    set({ currentChapterId: chapterId, aiSuggestions: [] });
    // 当前章节变化后，立即重算伏笔的 chaptersSinceMention
    get().recomputeForeshadowMentions();
  },

  updateChapterContent: (chapterId: string, content: string) => {
    const { chapters, currentProjectId, currentChapterId, projects } = get();
    if (!currentProjectId) return;

    // P-H1 修复：增量计算 totalWords，避免每次按键都全量 reduce 扫描所有章节
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    const now = new Date().toISOString();
    const newWordCount = countWords(content);
    const wordCountDiff = newWordCount - (chapter.wordCount || 0);
    const updatedChapters = chapters.map(c =>
      c.id === chapterId ? { ...c, content, wordCount: newWordCount, updatedAt: now } : c
    );

    // 同步 project.totalWords：用增量差值，避免全量 reduce。
    // 原实现仅在 openProject/saveProject 时计算 totalWords，编辑章节时不刷新，
    // 导致 Home.tsx / EditorPage 顶栏显示陈旧字数。saveProject 仍会定期全量重算纠偏。
    const updatedProjects = projects.map(p =>
      p.id === currentProjectId ? { ...p, totalWords: Math.max(0, (p.totalWords || 0) + wordCountDiff) } : p
    );

    set({ chapters: updatedChapters, projects: updatedProjects });
    markDirty();

    if (currentChapterId === chapterId) {
      // saveRecoveryDraft 是崩溃恢复关键路径：失败时节流 toast 提示（C-M4 修复）。
      // 编辑器按键防抖会频繁触发，磁盘错误时连续失败；节流策略：
      // 首次失败立即提示，之后每 5 分钟提示一次，避免刷屏又能让用户感知问题
      void storage.saveRecoveryDraft(currentProjectId, chapterId, content).catch(e => {
        // 崩溃恢复关键路径：用 error 级转发主进程落盘，便于报障定位
        logError('saveRecoveryDraft failed', e, { projectId: currentProjectId, chapterId });
        recoveryFailCount++;
        const now = Date.now();
        if (recoveryFailCount === 1 || now - lastRecoveryToastTime > 5 * 60 * 1000) {
          lastRecoveryToastTime = now;
          toast.error('崩溃恢复草稿写入失败，请检查磁盘空间');
        }
      });
    }

    // 章节内容变更后，防抖重算伏笔的 chaptersSinceMention
    if (foreshadowRecomputeTimer) clearTimeout(foreshadowRecomputeTimer);
    foreshadowRecomputeTimer = setTimeout(() => {
      get().recomputeForeshadowMentions();
      foreshadowRecomputeTimer = null;
    }, SEARCH_DEBOUNCE_DELAY);
  },

  setPendingEditorInsert: (content) => {
    set({ pendingEditorInsert: content });
  },

  setPendingScrollTo: (payload) => {
    set({ pendingScrollTo: payload });
  },

  bumpContentEpoch: () => {
    set({ contentEpoch: get().contentEpoch + 1 });
  },

  setAIGenerating: (v: boolean) => {
    set({ isAIGenerating: v });
  },
});
