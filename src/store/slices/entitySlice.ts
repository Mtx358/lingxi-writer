/**
 * 实体域 slice（角色 / 设定 / 伏笔 / 素材）
 *
 * 这四类实体通过级联清理紧密耦合：删除角色会清理伏笔与章节中的引用，
 * 删除设定分类/设定项会清理伏笔中的引用。因此放在同一 slice 中，
 * 避免跨 slice 的状态写入碎片化。伏笔的 chaptersSinceMention 自动
 * 重算也在此实现，被章节域 setCurrentChapter / updateChapterContent 调用。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { Character, SettingCategory, SettingItem, Foreshadow, Material } from '@/types';
import { DEFAULT_CHARACTER_ROLE, DEFAULT_FORESHADOW_STATUS, DEFAULT_FORESHADOW_PRIORITY, DEFAULT_MATERIAL_TYPE } from '@/types';
import { generateId, markDirty, storage } from '@/utils/storage';
import { conflictDetector } from '@/utils/conflictDetector';
import { escapeRegExp } from '@/lib/regexUtils';
import { logError } from '@/utils/rendererLogger';
import { registerProjectCleanup } from '../projectCleanup';

type EntitySlice = Pick<AppState,
  | 'characters' | 'settingCategories' | 'settingItems' | 'foreshadows' | 'materials'
  | 'addCharacter' | 'updateCharacter' | 'deleteCharacter'
  | 'addSettingCategory' | 'updateSettingCategory' | 'deleteSettingCategory'
  | 'addSettingItem' | 'updateSettingItem' | 'deleteSettingItem'
  | 'addForeshadow' | 'updateForeshadow' | 'deleteForeshadow' | 'recomputeForeshadowMentions'
  | 'addMaterial' | 'updateMaterial' | 'deleteMaterial'>;

// 模块级缓存：chapterId -> { html, plain }，避免同一章节被多个伏笔重复去 HTML。
// F 个伏笔 × C 个章节时，去 HTML 至多执行 C 次（仅在章节内容变更时增量更新），而非 F*C 次。
// LRU 策略：命中时 bump 到队尾，超过上限淘汰队首（与 imageCache 一致）
const CHAPTER_PLAIN_TEXT_CACHE_MAX = 64;
const chapterPlainTextCache = new Map<string, { html: string; plain: string }>();

export function setChapterPlainTextCache(chapterId: string, value: { html: string; plain: string }): void {
  // LRU: 命中时先删再插（移到末尾）
  chapterPlainTextCache.delete(chapterId);
  chapterPlainTextCache.set(chapterId, value);
  // 超限时淘汰最老条目（Map 迭代顺序 = 插入顺序）
  if (chapterPlainTextCache.size > CHAPTER_PLAIN_TEXT_CACHE_MAX) {
    const oldest = chapterPlainTextCache.keys().next().value;
    if (oldest !== undefined) chapterPlainTextCache.delete(oldest);
  }
}

export function getChapterPlainTextCache(chapterId: string): { html: string; plain: string } | undefined {
  const value = chapterPlainTextCache.get(chapterId);
  if (value) {
    // LRU bump: 移到末尾
    chapterPlainTextCache.delete(chapterId);
    chapterPlainTextCache.set(chapterId, value);
  }
  return value;
}

// 清空章节纯文本缓存：项目切换/关闭时调用，避免上一项目的章节缓存残留导致伏笔重算基于过期文本
export const clearChapterPlainTextCache = (): void => {
  chapterPlainTextCache.clear();
};

// 项目切换时自动清理章节纯文本缓存
registerProjectCleanup(clearChapterPlainTextCache);

const getChapterPlainText = (chapterId: string, html: string): string => {
  const cached = getChapterPlainTextCache(chapterId);
  if (cached && cached.html === html) {
    return cached.plain; // 章节内容未变，复用已缓存的纯文本
  }
  const plain = (html || '').replace(/<[^>]*>/g, '');
  setChapterPlainTextCache(chapterId, { html, plain });
  return plain;
};

export const createEntitySlice: StateCreator<AppState, [], [], EntitySlice> = (set, get) => ({
  characters: [],
  settingCategories: [],
  settingItems: [],
  foreshadows: [],
  materials: [],

  // ========== 角色 ==========
  addCharacter: (character: Partial<Character>) => {
    const { characters, currentProjectId } = get();
    if (!currentProjectId) throw new Error('No project open');

    const now = new Date().toISOString();
    const newCharacter: Character = {
      id: generateId(), projectId: currentProjectId, name: character.name || '新角色', role: character.role || DEFAULT_CHARACTER_ROLE, color: character.color || '#d4a574', profile: character.profile || {}, relationships: character.relationships || [], appearanceCount: 0, dialogueCount: 0, tags: character.tags || [], createdAt: now, updatedAt: now,
    };

    const updated = [...characters, newCharacter];
    set({ characters: updated });
    markDirty();
    return newCharacter;
  },

  updateCharacter: (characterId: string, updates: Partial<Character>) => {
    const { characters, currentProjectId } = get();
    if (!currentProjectId) return;
    const updated = characters.map(c => c.id === characterId ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c);
    set({ characters: updated });
    markDirty();
  },

  deleteCharacter: (characterId: string) => {
    const { characters, foreshadows, chapters, subplots, currentProjectId, projects } = get();
    if (!currentProjectId) return;
    // 1. 删除角色本身 + 清理其他角色的关系引用
    const updatedCharacters = characters
      .filter(c => c.id !== characterId)
      .map(c => ({
        ...c,
        relationships: (c.relationships || []).filter(r => r.targetId !== characterId),
      }));
    // 2. 清理伏笔中的角色引用
    const updatedForeshadows = foreshadows.map(f => ({
      ...f,
      relatedCharacters: (f.relatedCharacters || []).filter(id => id !== characterId),
    }));
    // 3. 清理章节中的角色聚焦引用 + MentionExtension 节点（C3-02）
    //    mention 节点形如 <span data-mention data-id="characterId">角色名</span>，
    //    删除角色后未清理会形成悬空引用。用正则替换避免对每章做 DOM 解析
    const mentionPattern = new RegExp(
      `<span[^>]*data-mention[^>]*data-id="${escapeRegExp(characterId)}"[^>]*>[^<]*</span>`,
      'g'
    );
    const updatedChapters = chapters.map(c => {
      const characterFocus = c.characterFocus ? c.characterFocus.filter(id => id !== characterId) : c.characterFocus;
      if (!c.content || !c.content.includes(`data-id="${characterId}"`)) {
        return { ...c, characterFocus };
      }
      return { ...c, characterFocus, content: c.content.replace(mentionPattern, '') };
    });
    // 4. 清理支线中的角色引用：relatedCharacters 含被删角色 ID 会形成悬空引用
    let updatedSubplots = subplots;
    if (subplots.some(s => (s.relatedCharacters || []).includes(characterId))) {
      updatedSubplots = subplots.map(s => ({
        ...s,
        relatedCharacters: (s.relatedCharacters || []).filter(id => id !== characterId),
      }));
    }
    // M10 修复：将顶层 subplots 与 projects[].subplots 合并到单次 set，
    // 避免两次 set 之间订阅者观察到不一致中间态（顶层已更新、projects 未更新）
    const updatedProjects = updatedSubplots !== subplots
      ? projects.map(p => p.id === currentProjectId ? { ...p, subplots: updatedSubplots, updatedAt: new Date().toISOString() } : p)
      : projects;
    set({ characters: updatedCharacters, foreshadows: updatedForeshadows, chapters: updatedChapters, subplots: updatedSubplots, projects: updatedProjects });
    if (updatedSubplots !== subplots) {
      void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === currentProjectId)! })
        .catch(e => logError('patchProjects failed', e, { slice: 'entity', action: 'deleteCharacter', projectId: currentProjectId }));
    }
    markDirty();
  },

  // ========== 设定 ==========
  addSettingCategory: (name: string, icon: string) => {
    const { settingCategories, currentProjectId } = get();
    if (!currentProjectId) throw new Error('No project open');
    const newCategory: SettingCategory = { id: generateId(), projectId: currentProjectId, name, icon, color: '#6b7c93', order: settingCategories.length, parentId: null };
    const updated = [...settingCategories, newCategory];
    set({ settingCategories: updated });
    markDirty();
    return newCategory;
  },

  updateSettingCategory: (categoryId: string, updates: Partial<SettingCategory>) => {
    const { settingCategories, currentProjectId } = get();
    if (!currentProjectId) return;
    const updated = settingCategories.map(c => c.id === categoryId ? { ...c, ...updates } : c);
    set({ settingCategories: updated });
    markDirty();
  },

  deleteSettingCategory: (categoryId: string) => {
    const { settingCategories, settingItems, foreshadows, currentProjectId } = get();
    if (!currentProjectId) return;
    const updatedCategories = settingCategories.filter(c => c.id !== categoryId);
    // 被删分类下的所有设定项 ID，用于级联清理伏笔引用
    const deletedItemIds = new Set(settingItems.filter(i => i.categoryId === categoryId).map(i => i.id));
    const updatedItems = settingItems.filter(i => i.categoryId !== categoryId);
    // 清理伏笔中指向被删设定项的引用
    const updatedForeshadows = deletedItemIds.size > 0
      ? foreshadows.map(f => ({
          ...f,
          relatedSettings: (f.relatedSettings || []).filter(id => !deletedItemIds.has(id)),
        }))
      : foreshadows;
    set({ settingCategories: updatedCategories, settingItems: updatedItems, foreshadows: updatedForeshadows });
    // 同步 conflictDetector，避免冲突列表残留引用已删除设定项的陈旧 issue（C3-04）
    conflictDetector.setSettings(updatedItems);
    markDirty();
  },

  addSettingItem: (categoryId: string, name: string) => {
    const { settingItems, currentProjectId } = get();
    if (!currentProjectId) throw new Error('No project open');
    const categoryItems = settingItems.filter(i => i.categoryId === categoryId);
    const now = new Date().toISOString();
    const newItem: SettingItem = { id: generateId(), projectId: currentProjectId, categoryId, name, description: '', content: '', references: [], tags: [], order: categoryItems.length, createdAt: now, updatedAt: now };
    const updated = [...settingItems, newItem];
    set({ settingItems: updated });
    markDirty();
    return newItem;
  },

  updateSettingItem: (itemId: string, updates: Partial<SettingItem>) => {
    const { settingItems, currentProjectId } = get();
    if (!currentProjectId) return;
    const updated = settingItems.map(i => i.id === itemId ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i);
    set({ settingItems: updated });
    markDirty();
  },

  deleteSettingItem: (itemId: string) => {
    const { settingItems, foreshadows, currentProjectId } = get();
    if (!currentProjectId) return;
    const item = settingItems.find(i => i.id === itemId);
    if (!item) return;
    const updated = settingItems
      .filter(i => i.id !== itemId)
      .map(i => i.categoryId === item.categoryId && i.order > item.order ? { ...i, order: i.order - 1 } : i);
    // 级联清理伏笔中指向该设定项的引用
    const updatedForeshadows = foreshadows.map(f => ({
      ...f,
      relatedSettings: (f.relatedSettings || []).filter(id => id !== itemId),
    }));
    set({ settingItems: updated, foreshadows: updatedForeshadows });
    // 同步 conflictDetector，避免冲突列表残留引用已删除设定项的陈旧 issue（C3-04）
    conflictDetector.setSettings(updated);
    markDirty();
  },

  // ========== 伏笔 ==========
  addForeshadow: (foreshadow: Partial<Foreshadow>) => {
    const { foreshadows, currentProjectId } = get();
    if (!currentProjectId) throw new Error('No project open');
    const now = new Date().toISOString();
    const newForeshadow: Foreshadow = {
      id: generateId(),
      projectId: currentProjectId,
      title: foreshadow.title || '新伏笔',
      description: foreshadow.description || '',
      status: foreshadow.status || DEFAULT_FORESHADOW_STATUS,
      plantedChapterId: foreshadow.plantedChapterId || null,
      payoffChapterId: foreshadow.payoffChapterId || null,
      priority: foreshadow.priority || DEFAULT_FORESHADOW_PRIORITY,
      relatedCharacters: foreshadow.relatedCharacters || [],
      relatedSettings: foreshadow.relatedSettings || [],
      chaptersSinceMention: 0,
      notes: foreshadow.notes || '',
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...foreshadows, newForeshadow];
    set({ foreshadows: updated });
    markDirty();
    // 新增伏笔后重算 chaptersSinceMention（可能已有章节提及此标题）
    get().recomputeForeshadowMentions();
    return newForeshadow;
  },

  updateForeshadow: (foreshadowId: string, updates: Partial<Foreshadow>) => {
    const { foreshadows, currentProjectId } = get();
    if (!currentProjectId) return;
    const updated = foreshadows.map(f => f.id === foreshadowId ? { ...f, ...updates, updatedAt: new Date().toISOString() } : f);
    set({ foreshadows: updated });
    markDirty();
    // 标题或种植章节变更后重算 chaptersSinceMention
    if ('title' in updates || 'plantedChapterId' in updates) {
      get().recomputeForeshadowMentions();
    }
  },

  deleteForeshadow: (foreshadowId: string) => {
    const { foreshadows, subplots, currentProjectId, projects } = get();
    if (!currentProjectId) return;
    const updated = foreshadows.filter(f => f.id !== foreshadowId);
    // 级联清理支线中的伏笔引用：relatedForeshadows 含被删伏笔 ID 会形成悬空引用
    let updatedSubplots = subplots;
    if (subplots.some(s => (s.relatedForeshadows || []).includes(foreshadowId))) {
      updatedSubplots = subplots.map(s => ({
        ...s,
        relatedForeshadows: (s.relatedForeshadows || []).filter(id => id !== foreshadowId),
      }));
    }
    // M10 修复：将顶层 subplots 与 projects[].subplots 合并到单次 set，
    // 避免两次 set 之间订阅者观察到不一致中间态（顶层已更新、projects 未更新）
    const updatedProjects = updatedSubplots !== subplots
      ? projects.map(p => p.id === currentProjectId ? { ...p, subplots: updatedSubplots, updatedAt: new Date().toISOString() } : p)
      : projects;
    set({ foreshadows: updated, subplots: updatedSubplots, projects: updatedProjects });
    if (updatedSubplots !== subplots) {
      void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === currentProjectId)! })
        .catch(e => logError('patchProjects failed', e, { slice: 'entity', action: 'deleteForeshadow', projectId: currentProjectId }));
    }
    markDirty();
  },

  // 重算所有伏笔的 chaptersSinceMention：
  // 取章节正文中提及伏笔标题的最晚章节（不晚于当前章节）为"上次提及章节"，
  // 距离 = 当前章节序号 - 上次提及章节序号；从未提及时回退到种植章节距离。
  recomputeForeshadowMentions: () => {
    const { foreshadows, chapters, currentChapterId } = get();
    if (foreshadows.length === 0 || chapters.length === 0) return;

    // 按 DFS 全局阅读顺序展开章节：order 是兄弟内序号，多卷项目下不同父级的
    // chapter 的 order 会重叠（Book1 下 A/B order 0,1 与 Book2 下 C/D order 0,1），
    // 单纯 sort 后变 [A,C,B,D]，破坏阅读顺序。需从 root(parentId=null) 起按 order
    // 递归遍历整棵树，再取 levelType==='chapter' 的叶子，得到正确的全局阅读顺序。
    const childrenByParent = new Map<string | null, typeof chapters>();
    for (const c of chapters) {
      const key = c.parentId;
      const list = childrenByParent.get(key);
      if (list) list.push(c);
      else childrenByParent.set(key, [c]);
    }
    for (const list of childrenByParent.values()) {
      list.sort((a, b) => a.order - b.order);
    }
    const flatChapters: typeof chapters = [];
    const dfsVisit = (parentId: string | null) => {
      const children = childrenByParent.get(parentId) || [];
      for (const child of children) {
        if (child.levelType === 'chapter') flatChapters.push(child);
        dfsVisit(child.id);
      }
    };
    dfsVisit(null);
    if (flatChapters.length === 0) return;

    // 清理已被删除章节的缓存条目，避免缓存无限增长
    const currentChapterIds = new Set(chapters.map(c => c.id));
    for (const id of chapterPlainTextCache.keys()) {
      if (!currentChapterIds.has(id)) chapterPlainTextCache.delete(id);
    }

    const currentIndex = currentChapterId
      ? flatChapters.findIndex(c => c.id === currentChapterId)
      : flatChapters.length - 1;
    const effectiveCurrentIndex = currentIndex === -1 ? flatChapters.length - 1 : currentIndex;

    // 预取 0..effectiveCurrentIndex 范围内每章的纯文本（命中缓存时 O(1)），供所有伏笔复用
    const chapterTexts: string[] = [];
    for (let i = 0; i <= effectiveCurrentIndex; i++) {
      chapterTexts.push(getChapterPlainText(flatChapters[i].id, flatChapters[i].content || ''));
    }

    let changed = false;
    const updatedForeshadows = foreshadows.map(f => {
      const title = (f.title || '').trim();
      if (!title) return f;

      // 从当前章节向前找最晚一次提及，复用已缓存的纯文本
      let lastMentionIndex = -1;
      for (let i = effectiveCurrentIndex; i >= 0; i--) {
        if (chapterTexts[i].includes(title)) {
          lastMentionIndex = i;
          break;
        }
      }

      let distance: number;
      if (lastMentionIndex !== -1) {
        distance = Math.max(0, effectiveCurrentIndex - lastMentionIndex);
      } else if (f.plantedChapterId) {
        const plantedIndex = flatChapters.findIndex(c => c.id === f.plantedChapterId);
        distance = plantedIndex === -1 ? 0 : Math.max(0, effectiveCurrentIndex - plantedIndex);
      } else {
        distance = 0;
      }

      if (distance !== f.chaptersSinceMention) {
        changed = true;
        return { ...f, chaptersSinceMention: distance };
      }
      return f;
    });

    if (changed) {
      set({ foreshadows: updatedForeshadows });
    }
  },

  // ========== 素材 ==========
  addMaterial: (material: Partial<Material>) => {
    const { materials, currentProjectId } = get();
    if (!currentProjectId) throw new Error('No project open');
    const now = new Date().toISOString();
    const newMaterial: Material = {
      id: generateId(), projectId: currentProjectId, title: material.title || '新素材', type: material.type || DEFAULT_MATERIAL_TYPE, content: material.content || '', source: material.source || '', url: material.url || '', tags: material.tags || [], category: material.category || '未分类', references: material.references || [], pinned: material.pinned || false, createdAt: now, updatedAt: now,
    };
    const updated = [...materials, newMaterial];
    set({ materials: updated });
    markDirty();
    return newMaterial;
  },

  updateMaterial: (materialId: string, updates: Partial<Material>) => {
    const { materials, currentProjectId } = get();
    if (!currentProjectId) return;
    const updated = materials.map(m => m.id === materialId ? { ...m, ...updates, updatedAt: new Date().toISOString() } : m);
    set({ materials: updated });
    markDirty();
  },

  deleteMaterial: (materialId: string) => {
    const { materials, currentProjectId } = get();
    if (!currentProjectId) return;
    const updated = materials.filter(m => m.id !== materialId);
    set({ materials: updated });
    markDirty();
  },
});
