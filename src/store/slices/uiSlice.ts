/**
 * UI / 搜索 / 冲突 / AI设置 / 恢复域 slice
 *
 * 面板折叠状态、右栏标签页、全局搜索（Web Worker 异步 + 主线程降级）、
 * 冲突检测、AI 建议队列、AI 设置（含密钥加密持久化）、崩溃恢复草稿。
 * 搜索会读取章节/角色/设定/伏笔/素材等多域数据，通过 get() 统一获取。
 */
import type { StateCreator } from 'zustand';
import type { AppState, SearchEntry } from '../appState';
import { DEFAULT_AI_SETTINGS } from '../appState';
import type { ConflictIssue, AISuggestion, AISettings } from '@/types';
import { storage, generateId, isElectron } from '@/utils/storage';
import { conflictDetector } from '@/utils/conflictDetector';
import { SEARCH_DEBOUNCE_DELAY } from '@/constants/config';

type UISlice = Pick<AppState,
  | 'leftPanelCollapsed' | 'rightPanelCollapsed' | 'rightPanelTab'
  | 'searchQuery' | 'searchResults' | 'searchHighlight'
  | 'conflicts' | 'aiSuggestions' | 'analysis' | 'aiSettings' | 'recoveryDraft'
  | 'setLeftPanelCollapsed' | 'setRightPanelCollapsed' | 'setRightPanelTab'
  | 'search' | 'clearSearch' | 'setSearchHighlight'
  | 'detectConflicts' | 'resolveConflict' | 'addAISuggestion' | 'clearAISuggestions'
  | 'loadAISettings' | 'updateAISettings'
  | 'checkForRecovery' | 'restoreRecoveryDraft' | 'discardRecoveryDraft'>;

// 转义正则元字符，防止用户输入触发 SyntaxError 或非预期匹配
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 搜索防抖计时器（模块级，避免每次渲染重建）
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Web Worker 实例（懒加载）：将搜索计算迁移到子线程，避免主线程卡顿
let searchWorker: Worker | null = null;
let searchRequestId = 0;
const getSearchWorker = (): Worker | null => {
  if (searchWorker) return searchWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    searchWorker = new Worker(new URL('../../workers/searchWorker.ts', import.meta.url), { type: 'module' });
    return searchWorker;
  } catch {
    return null; // Worker 创建失败时降级到主线程同步搜索
  }
};

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set, get) => ({
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  rightPanelTab: 'ai',
  searchQuery: '',
  searchResults: [],
  searchHighlight: null,
  conflicts: [],
  aiSuggestions: [],
  analysis: {},
  aiSettings: DEFAULT_AI_SETTINGS,
  recoveryDraft: null,

  setLeftPanelCollapsed: (collapsed: boolean) => set({ leftPanelCollapsed: collapsed }),
  setRightPanelCollapsed: (collapsed: boolean) => set({ rightPanelCollapsed: collapsed }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  search: (query: string) => {
    // 立即同步 query，保证输入框响应；空查询直接清空
    set({ searchQuery: query });
    if (!query.trim()) {
      if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
      set({ searchResults: [] });
      return;
    }

    // 防抖：连续输入时只对最后一次执行实际检索
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const { chapters, characters, settingItems, foreshadows, materials } = get();
      const worker = getSearchWorker();
      const currentRequestId = ++searchRequestId;

      // Worker 可用：异步搜索，不阻塞主线程
      if (worker) {
        const onMessage = (e: MessageEvent) => {
          if (currentRequestId !== searchRequestId) return; // 过期结果，丢弃
          worker.removeEventListener('message', onMessage);
          set({ searchResults: e.data });
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage({ query, chapters, characters, settingItems, foreshadows, materials });
        return;
      }

      // Worker 不可用：降级到主线程同步搜索
      const results: SearchEntry[] = [];
      const lowerQuery = query.toLowerCase();
      // 转义元字符，防止 ( [ * 等触发 SyntaxError
      const safePattern = new RegExp(escapeRegExp(lowerQuery), 'gi');

      chapters.forEach(c => {
        const plainContent = c.content.replace(/<[^>]*>/g, '');
        const titleMatches = (c.title.toLowerCase().match(safePattern) || []).length;
        const contentMatches = (plainContent.toLowerCase().match(safePattern) || []).length;
        const totalMatches = titleMatches * 3 + contentMatches;
        if (totalMatches > 0) {
          const idx = plainContent.toLowerCase().indexOf(lowerQuery);
          const preview = idx >= 0
            ? (idx > 20 ? '...' : '') + plainContent.slice(Math.max(0, idx - 20), idx + query.length + 30) + (idx + query.length + 30 < plainContent.length ? '...' : '')
            : c.summary;
          results.push({ type: 'chapter', id: c.id, title: c.title, preview, matchCount: totalMatches });
        }
      });

      characters.forEach(c => {
        const nameMatches = (c.name.toLowerCase().match(safePattern) || []).length;
        const profileStr = JSON.stringify(c.profile).toLowerCase();
        const profileMatches = (profileStr.match(safePattern) || []).length;
        const totalMatches = nameMatches * 5 + profileMatches;
        if (totalMatches > 0) {
          results.push({ type: 'character', id: c.id, title: c.name, preview: c.profile.personality || c.profile.background || '', matchCount: totalMatches });
        }
      });

      settingItems.forEach(s => {
        const nameMatches = (s.name.toLowerCase().match(safePattern) || []).length;
        const descMatches = (s.description.toLowerCase().match(safePattern) || []).length;
        const contentMatches = (s.content.toLowerCase().match(safePattern) || []).length;
        const totalMatches = nameMatches * 3 + descMatches * 2 + contentMatches;
        if (totalMatches > 0) {
          results.push({ type: 'setting', id: s.id, title: s.name, preview: s.description, matchCount: totalMatches });
        }
      });

      foreshadows.forEach(f => {
        const titleMatches = (f.title.toLowerCase().match(safePattern) || []).length;
        const descMatches = (f.description.toLowerCase().match(safePattern) || []).length;
        const totalMatches = titleMatches * 3 + descMatches;
        if (totalMatches > 0) {
          results.push({ type: 'foreshadow', id: f.id, title: f.title, preview: f.description, matchCount: totalMatches });
        }
      });

      materials.forEach(m => {
        const titleMatches = (m.title.toLowerCase().match(safePattern) || []).length;
        const contentMatches = (m.content.toLowerCase().match(safePattern) || []).length;
        const totalMatches = titleMatches * 3 + contentMatches;
        if (totalMatches > 0) {
          const idx = m.content.toLowerCase().indexOf(lowerQuery);
          const preview = idx >= 0
            ? (idx > 20 ? '...' : '') + m.content.slice(Math.max(0, idx - 20), idx + query.length + 30) + (idx + query.length + 30 < m.content.length ? '...' : '')
            : m.content.slice(0, 80) + '...';
          results.push({ type: 'material', id: m.id, title: m.title, preview, matchCount: totalMatches });
        }
      });

      results.sort((a, b) => b.matchCount - a.matchCount);
      set({ searchResults: results });
    }, SEARCH_DEBOUNCE_DELAY);
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),
  setSearchHighlight: (keyword: string | null) => set({ searchHighlight: keyword }),

  detectConflicts: () => {
    const { currentProjectId, chapters, characters, settingItems } = get();
    if (!currentProjectId) return;

    // 同步最新角色与设定到冲突检测器
    conflictDetector.setCharacters(characters);
    conflictDetector.setSettings(settingItems);

    const issues: ConflictIssue[] = [];
    // 扫描所有正文章节（level===2 且有内容）
    const mainChapters = chapters.filter(c => c.level === 2 && c.content && c.content.length > 0);
    mainChapters.forEach(ch => {
      issues.push(...conflictDetector.detectChapterConflicts(ch));
    });
    // 跨章节全局一致性检测
    issues.push(...conflictDetector.detectGlobalConflicts(mainChapters));

    set({ conflicts: issues });
  },

  resolveConflict: (issueId: string) => {
    set(state => ({
      conflicts: state.conflicts.map(i =>
        i.id === issueId ? { ...i, resolved: !i.resolved } : i
      ),
    }));
  },

  addAISuggestion: (suggestion: Omit<AISuggestion, 'id' | 'timestamp'>) => {
    const newSuggestion: AISuggestion = { ...suggestion, id: generateId(), timestamp: new Date().toISOString() };
    set(state => ({ aiSuggestions: [...state.aiSuggestions, newSuggestion] }));
  },

  clearAISuggestions: () => set({ aiSuggestions: [] }),

  loadAISettings: async () => {
    const settings = await storage.get<AISettings>('aiSettings', DEFAULT_AI_SETTINGS);
    if (settings.apiKey && settings.apiKey.length > 20 && isElectron()) {
      const decrypted = await storage.decrypt(settings.apiKey);
      if (decrypted) {
        settings.apiKey = decrypted;
      }
    }
    set({ aiSettings: { ...DEFAULT_AI_SETTINGS, ...settings } });
  },

  updateAISettings: async (updates: Partial<AISettings>) => {
    const aiSettings = { ...get().aiSettings, ...updates };
    const storedSettings = { ...aiSettings };
    if (storedSettings.apiKey && storedSettings.apiKey.length > 0 && isElectron()) {
      const encrypted = await storage.encrypt(storedSettings.apiKey);
      if (encrypted) {
        storedSettings.apiKey = encrypted;
      } else {
        // safeStorage 不可用或加密失败：拒绝落盘 apiKey，避免明文存储到磁盘
        // 内存中仍保留 apiKey 以供当前会话使用，但重启后需重新输入
        delete storedSettings.apiKey;
        console.warn('apiKey 加密不可用，已跳过持久化（仅当前会话有效）');
      }
    }
    try {
      await storage.set('aiSettings', storedSettings);
    } catch (e) {
      console.error('Failed to save AI settings:', e);
    }
    set({ aiSettings });
  },

  checkForRecovery: async () => {
    const draft = await storage.loadRecoveryDraft();
    if (draft) {
      set({ recoveryDraft: draft });
    }
  },

  restoreRecoveryDraft: () => {
    const { recoveryDraft, chapters } = get();
    if (!recoveryDraft) return;

    const updatedChapters = chapters.map(c =>
      c.id === recoveryDraft.chapterId ? { ...c, content: recoveryDraft.content } : c
    );
    set({ chapters: updatedChapters, recoveryDraft: null });
    // 外部替换内容，通知编辑器强制刷新
    get().bumpContentEpoch();
    void storage.clearRecoveryDraft();
  },

  discardRecoveryDraft: () => {
    set({ recoveryDraft: null });
    void storage.clearRecoveryDraft();
  },
});
