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

type ChapterSlice = Pick<AppState,
  | 'chapters' | 'currentChapterId' | 'pendingEditorInsert' | 'contentEpoch' | 'isAIGenerating'
  | 'addChapter' | 'updateChapter' | 'deleteChapter' | 'moveChapter' | 'setCurrentChapter'
  | 'updateChapterContent' | 'setPendingEditorInsert' | 'bumpContentEpoch' | 'setAIGenerating'>;

// 伏笔提及计数重算防抖计时器（避免每次按键都全量扫描章节）
let foreshadowRecomputeTimer: ReturnType<typeof setTimeout> | null = null;

export const createChapterSlice: StateCreator<AppState, [], [], ChapterSlice> = (set, get) => ({
  chapters: [],
  currentChapterId: null,
  pendingEditorInsert: null,
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

    const adjustedChapters = siblings
      .filter(c => c.order >= newOrder)
      .map(c => ({ ...c, order: c.order + 1 }));

    const now = new Date().toISOString();
    const newChapter: Chapter = {
      id: generateId(), projectId: currentProjectId, parentId, title, summary: '', order: newOrder, level, levelType: resolvedLevelType, status: DEFAULT_CHAPTER_STATUS, wordCount: 0, content: '', createdAt: now, updatedAt: now,
    };

    const updatedChapters = [...chapters, ...adjustedChapters, newChapter];
    set({ chapters: updatedChapters, currentChapterId: newChapter.id });
    markDirty();
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

  deleteChapter: (chapterId: string) => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return;

    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    const getAllChildren = (id: string): string[] => {
      const children = chapters.filter(c => c.parentId === id).map(c => c.id);
      return [...children, ...children.flatMap(getAllChildren)];
    };

    const toDelete = [chapterId, ...getAllChildren(chapterId)];
    const updatedChapters = chapters
      .filter(c => !toDelete.includes(c.id))
      .map(c => c.parentId === chapter.parentId && c.order > chapter.order ? { ...c, order: c.order - 1 } : c);

    const { currentChapterId, foreshadows } = get();
    const newCurrent = toDelete.includes(currentChapterId || '') ? updatedChapters[0]?.id || null : currentChapterId;

    // 级联清理伏笔中指向被删章节的引用（置空而非删除伏笔）
    const deletedChapterSet = new Set(toDelete);
    const updatedForeshadows = foreshadows.map(f => ({
      ...f,
      plantedChapterId: f.plantedChapterId && deletedChapterSet.has(f.plantedChapterId) ? null : f.plantedChapterId,
      payoffChapterId: f.payoffChapterId && deletedChapterSet.has(f.payoffChapterId) ? null : f.payoffChapterId,
    }));

    set({ chapters: updatedChapters, currentChapterId: newCurrent, foreshadows: updatedForeshadows });
    markDirty();
  },

  moveChapter: (chapterId: string, newParentId: string | null, newOrder: number): boolean => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return false;

    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return false;

    const newParent = newParentId ? chapters.find(c => c.id === newParentId) : null;
    const newLevel = newParent ? newParent.level + 1 : 1;

    const isDescendant = (parentId: string, childId: string): boolean => {
      const children = chapters.filter(c => c.parentId === parentId);
      return children.some(c => c.id === childId || isDescendant(c.id, childId));
    };
    if (newParentId && isDescendant(chapterId, newParentId)) return false;

    // 计算子树最大深度，预判移动后是否超过最大嵌套层级
    const getSubtreeMaxDepth = (rootId: string): number => {
      const children = chapters.filter(c => c.parentId === rootId);
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map(c => getSubtreeMaxDepth(c.id)));
    };
    const subtreeMaxDepth = getSubtreeMaxDepth(chapterId);
    if (newLevel + subtreeMaxDepth - 1 > CHAPTER_MAX_LEVEL) {
      console.warn(`[moveChapter] 移动后子树最深层级将超过 ${CHAPTER_MAX_LEVEL}，拒绝移动`);
      return false;
    }

    let updatedChapters = chapters.map(c => {
      if (c.id === chapterId) return { ...c, parentId: newParentId, order: newOrder, level: newLevel, levelType: levelToLevelType(newLevel) };
      if (c.parentId === chapter.parentId && c.order > chapter.order) return { ...c, order: c.order - 1 };
      if (c.parentId === newParentId && c.order >= newOrder && c.id !== chapterId) return { ...c, order: c.order + 1 };
      return c;
    });

    // 递归更新子章节的 level 与 levelType，保持两者一致
    const updateChildrenLevel = (parentId: string, levelOffset: number) => {
      const children = updatedChapters.filter(c => c.parentId === parentId);
      children.forEach(child => {
        const childNewLevel = child.level + levelOffset;
        updatedChapters = updatedChapters.map(c =>
          c.id === child.id ? { ...c, level: childNewLevel, levelType: levelToLevelType(childNewLevel) } : c
        );
        updateChildrenLevel(child.id, levelOffset);
      });
    };
    const levelDiff = newLevel - chapter.level;
    if (levelDiff !== 0) updateChildrenLevel(chapterId, levelDiff);

    set({ chapters: updatedChapters });
    markDirty();
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
    const { chapters, currentProjectId, currentChapterId } = get();
    if (!currentProjectId) return;

    const now = new Date().toISOString();
    const wordCount = countWords(content.replace(/<[^>]*>/g, ''));
    const updatedChapters = chapters.map(c =>
      c.id === chapterId ? { ...c, content, wordCount, updatedAt: now } : c
    );

    set({ chapters: updatedChapters });
    markDirty();

    if (currentChapterId === chapterId) {
      void storage.saveRecoveryDraft(currentProjectId, chapterId, content);
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

  bumpContentEpoch: () => {
    set({ contentEpoch: get().contentEpoch + 1 });
  },

  setAIGenerating: (v: boolean) => {
    set({ isAIGenerating: v });
  },
});
