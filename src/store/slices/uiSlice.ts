/**
 * UI / 搜索 / 冲突 / AI设置 / 恢复域 slice
 *
 * 面板折叠状态、右栏标签页、全局搜索（Web Worker 异步 + 主线程降级）、
 * 冲突检测、AI 建议队列、AI 设置（含密钥加密持久化）、崩溃恢复草稿。
 * 搜索会读取章节/角色/设定/伏笔/素材等多域数据，通过 get() 统一获取。
 */
import type { StateCreator } from 'zustand';
import type { AppState, SearchEntry } from '../appState';
import { DEFAULT_AI_SETTINGS, DEFAULT_APP_PREFERENCES } from '../appState';
import type { ConflictIssue, AISuggestion, AISettings, AppPreferences } from '@/types';
import { storage, generateId, countWords, markDirty } from '@/utils/storage';
import { conflictDetector } from '@/utils/conflictDetector';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { logError, logWarn } from '@/utils/rendererLogger';
import { SEARCH_DEBOUNCE_DELAY } from '@/constants/config';
import { escapeRegExp } from '@/lib/regexUtils';
import { registerProjectCleanup } from '../projectCleanup';

type UISlice = Pick<AppState,
  | 'leftPanelCollapsed' | 'rightPanelCollapsed' | 'rightPanelTab'
  | 'searchQuery' | 'searchResults' | 'searchHighlight'
  | 'conflicts' | 'aiSuggestions' | 'analysis' | 'aiSettings' | 'recoveryDraft'
  | 'setLeftPanelCollapsed' | 'setRightPanelCollapsed' | 'setRightPanelTab'
  | 'search' | 'clearSearch' | 'setSearchHighlight'
  | 'detectConflicts' | 'resolveConflict' | 'addAISuggestion' | 'clearAISuggestions'
  | 'loadAISettings' | 'updateAISettings'
  | 'checkForRecovery' | 'restoreRecoveryDraft' | 'discardRecoveryDraft'
  | 'appPreferences' | 'loadAppPreferences' | 'updateAppPreferences'>;

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

// 关闭项目时终止搜索 Worker 并清空状态，释放子线程资源、防止监听器泄漏。
// 需在 closeProject 中调用（projectSlice 不在本任务范围，故在此导出供其调用）。
export const disposeSearchWorker = (): void => {
  if (searchWorker) {
    try {
      searchWorker.terminate();
    } catch {
      // ignore terminate errors
    }
    searchWorker = null;
  }
  searchRequestId = 0;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  // P-M3: 与 profileSearchCache 一致，关闭项目时清空章节纯文本缓存，避免上一项目缓存残留
  chapterPlainCache.clear();
};

// 模块级缓存：characterId -> { profileRef, text }，避免每次搜索都对每个角色 JSON.stringify(profile)。
// character 增删改后 profile 引用变化，缓存自动失效（引用比较），无需跨 slice 主动更新。
const profileSearchCache = new Map<string, { profileRef: unknown; text: string }>();
const PROFILE_SEARCH_CACHE_MAX = 200;
// 容量上限保护：角色数过多或跨项目累积时淘汰最旧条目，避免内存无界增长。
// Map 按插入序遍历，keys().next() 取最旧 key 做 FIFO 淘汰；不影响引用比较失效逻辑。
function pruneProfileSearchCache(): void {
  while (profileSearchCache.size > PROFILE_SEARCH_CACHE_MAX) {
    const firstKey = profileSearchCache.keys().next().value;
    if (firstKey) profileSearchCache.delete(firstKey);
  }
}

// 清空角色搜索文本缓存：项目切换/关闭时调用，避免上一项目的角色缓存残留
export const clearProfileSearchCache = (): void => {
  profileSearchCache.clear();
};

// 项目切换时自动终止搜索 Worker 并清空搜索相关缓存
registerProjectCleanup(disposeSearchWorker);
registerProjectCleanup(clearProfileSearchCache);

const getProfileSearchText = (characterId: string, profile: unknown): string => {
  const cached = profileSearchCache.get(characterId);
  if (cached && cached.profileRef === profile) {
    return cached.text;
  }
  // profile 可能为 undefined（旧版本迁移/损坏数据）：JSON.stringify(undefined) 返回 undefined（非字符串），
  // 后续 .toLowerCase() 会抛 TypeError 并中断整个搜索回调。降级为空串保证搜索不崩溃。
  const text = (profile == null ? '' : JSON.stringify(profile)).toLowerCase();
  profileSearchCache.set(characterId, { profileRef: profile, text });
  pruneProfileSearchCache();
  return text;
};

// P-M3: 章节纯文本缓存（主线程降级搜索路径专用），与 searchWorker 内的 workerChapterCache 对称。
// 避免每次搜索都对每章做 c.content.replace(/<[^>]*>/g, '')。content 变化时缓存自动失效。
const chapterPlainCache = new Map<string, { content: string; plain: string }>();
const CHAPTER_PLAIN_CACHE_MAX = 200;
// 容量上限保护：章节过多或跨项目累积时淘汰最旧条目，避免内存无界增长。
function pruneChapterPlainCache(): void {
  while (chapterPlainCache.size > CHAPTER_PLAIN_CACHE_MAX) {
    const firstKey = chapterPlainCache.keys().next().value;
    if (firstKey) chapterPlainCache.delete(firstKey);
  }
}
const getChapterPlain = (id: string, content: string): string => {
  const cached = chapterPlainCache.get(id);
  if (cached && cached.content === content) return cached.plain;
  const plain = (content || '').replace(/<[^>]*>/g, '');
  chapterPlainCache.set(id, { content, plain });
  pruneChapterPlainCache();
  return plain;
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
  appPreferences: DEFAULT_APP_PREFERENCES,

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

      // 主线程同步搜索（Worker 不可用 / postMessage 失败 / Worker 运行时异常时降级）
      // 提取为局部函数以便 Worker onerror 时复用，避免请求静默丢失让用户误以为"无匹配结果"
      const runMainThreadSearch = (): void => {
        const results: SearchEntry[] = [];
        const lowerQuery = query.toLowerCase();
        // 转义元字符，防止 ( [ * 等触发 SyntaxError
        const safePattern = new RegExp(escapeRegExp(lowerQuery), 'gi');

        chapters.forEach(c => {
          const plainContent = getChapterPlain(c.id, c.content);
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
          const profileStr = getProfileSearchText(c.id, c.profile);
          const profileMatches = (profileStr.match(safePattern) || []).length;
          const totalMatches = nameMatches * 5 + profileMatches;
          if (totalMatches > 0) {
            results.push({ type: 'character', id: c.id, title: c.name, preview: c.profile?.personality || c.profile?.background || '', matchCount: totalMatches });
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
      };

      // Worker 可用：异步搜索，不阻塞主线程
      if (worker) {
        const onMessage = (e: MessageEvent) => {
          // 共享 Worker 下多个并发搜索请求的监听器并存：先校验响应是否属于本请求。
          // 不匹配时直接返回且不移除监听器，否则会错误消费其他请求的响应并让本请求错过自己的响应
          if (!e.data || typeof e.data !== 'object' || !('requestId' in e.data)) return;
          if (e.data.requestId !== currentRequestId) return; // 过期/不匹配结果，丢弃
          // 匹配本请求的响应，移除自身监听器
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          // await 期间若有更新的搜索请求进入，丢弃本结果避免显示过期内容覆盖新请求
          if (currentRequestId !== searchRequestId) return;
          if (e.data.error) {
            console.error('[searchWorker] returned error:', e.data.error);
            runMainThreadSearch();
            return;
          }
          set({ searchResults: e.data.results });
        };
        // Worker 运行时错误处理（M3）：Worker 内部未捕获异常时 onMessage 永远不会触发，
        // 若不处理 onerror 当前请求会静默丢失（用户看到"无结果"误以为确实无匹配）。
        // 此处降级到主线程同步搜索，并转发错误到主进程日志便于定位
        const onError = (e: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          if (currentRequestId !== searchRequestId) return; // 过期请求，丢弃
          console.error('[searchWorker] runtime error, falling back to main thread:', e.message, e);
          // 转发到主进程日志：生产环境用户无 devtools，需通过日志定位 Worker 异常
          try {
            window.electronAPI?.logger?.write('error', `searchWorker runtime error: ${e.message || 'unknown'}`, {
              filename: e.filename,
              lineno: e.lineno,
            })?.catch(() => { /* 静默 */ });
          } catch { /* 静默 */ }
          runMainThreadSearch();
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        try {
          // H2 性能修复：postMessage 前对数据做投影，只取搜索需要的字段。
          // store 中的 Chapter/Character 等含大量搜索无关字段（parentId/order/level/
          // status/wordCount/createdAt/updatedAt/beats/relationships/...），全量结构化
          // 克隆会传输数 MB 无用数据。投影后百章项目克隆量减少约 60-80%。
          const projectedChapters = chapters.map(c => ({ id: c.id, title: c.title, content: c.content, summary: c.summary }));
          const projectedCharacters = characters.map(c => ({ id: c.id, name: c.name, profile: c.profile }));
          const projectedSettingItems = settingItems.map(s => ({ id: s.id, name: s.name, description: s.description, content: s.content }));
          const projectedForeshadows = foreshadows.map(f => ({ id: f.id, title: f.title, description: f.description }));
          const projectedMaterials = materials.map(m => ({ id: m.id, title: m.title, content: m.content }));
          worker.postMessage({ query, requestId: currentRequestId, chapters: projectedChapters, characters: projectedCharacters, settingItems: projectedSettingItems, foreshadows: projectedForeshadows, materials: projectedMaterials });
          return; // 异步等待 Worker 响应
        } catch {
          // postMessage 失败：移除监听器并降级到主线程同步搜索
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        }
      }

      // Worker 不可用或 postMessage 失败：降级到主线程同步搜索
      runMainThreadSearch();
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
    // 扫描所有正文章节（levelType === 'chapter' 且有内容），与 entitySlice 的判定保持一致
    const mainChapters = chapters.filter(c => c.levelType === 'chapter' && c.content && c.content.length > 0);
    mainChapters.forEach(ch => {
      issues.push(...conflictDetector.detectChapterConflicts(ch));
    });
    // 跨章节全局一致性检测
    issues.push(...conflictDetector.detectGlobalConflicts(mainChapters));

    set({ conflicts: issues });

    // 规格书 3.2 / 阶段1-3：编辑器写作时触发的缺口提示，自动回流到打磨台灵感缺口汇总。
    // detectConflicts 在编辑器侧触发（写作后冲突检测），其中"缺口类"冲突映射为灵感缺口，
    // 通过 addInspirationGap 去重追加到 inspirationGaps，打磨台 InspirationCanvasPanel 统一展示。
    // 映射规则（仅 info 级、明确属于"缺素材"语义的冲突才回流，避免噪音）：
    //   setting/info「设定引用但关键词未出现」→ missing-setting（缺世界观设定）
    //   character/info「角色长期未出场」→ missing-character（缺关键角色戏份）
    // addInspirationGap 内部按 kind+description 去重，重复触发不会堆积。
    const addInspirationGap = get().addInspirationGap;
    if (typeof addInspirationGap === 'function') {
      for (const issue of issues) {
        if (issue.resolved) continue;
        if (issue.type === 'setting' && issue.severity === 'info') {
          addInspirationGap({
            kind: 'missing-setting',
            description: issue.description,
            suggestion: issue.suggestion,
            relatedChapterId: issue.chapterId,
            source: 'editor',
          });
        } else if (issue.type === 'character' && issue.severity === 'info'
          && /没有出场|连续.*章/.test(issue.description)) {
          addInspirationGap({
            kind: 'missing-character',
            description: issue.description,
            suggestion: issue.suggestion,
            relatedChapterId: issue.chapterId,
            source: 'editor',
          });
        }
      }
    }
  },

  resolveConflict: (issueId: string) => {
    set(state => ({
      conflicts: state.conflicts.map(i =>
        i.id === issueId ? { ...i, resolved: !i.resolved } : i
      ),
    }));
  },

  addAISuggestion: (suggestion: Omit<AISuggestion, 'id' | 'timestamp'>) => {
    // 空内容防御：stream 函数失败时吞错返回 ''，若上游未正确拦截会触发 onSuccess('')
    // 写入空建议卡片。此处作为最后防线过滤空内容，避免误导用户"采纳"空内容到编辑器。
    if (!suggestion.content || suggestion.content.trim() === '') {
      console.warn('addAISuggestion: 已过滤空内容建议', { type: suggestion.type, title: suggestion.title });
      return;
    }
    const newSuggestion: AISuggestion = { ...suggestion, id: generateId(), timestamp: new Date().toISOString() };
    set(state => ({ aiSuggestions: [...state.aiSuggestions, newSuggestion] }));
  },

  clearAISuggestions: () => set({ aiSuggestions: [] }),

  loadAISettings: async () => {
    // 走专用 ai:loadSettings IPC：主进程内部解密 apiKey 后返回明文，
    // 不再调用 storage.get('aiSettings') + storage.decrypt，
    // 收敛 decrypt 能力到主进程，防止渲染层被 XSS 后解密其他加密字段。
    // 主进程解密失败时返回空 apiKey（与其他字段一同落盘），UI 据此提示用户重新输入
    let settings: AISettings;
    const loaded = await storage.loadAISettings();
    if (loaded) {
      // 主进程解密失败的信号：apiKey 为空字符串且原本应有值（无法区分"未设置"与"解密失败"，
      // 与原实现一致——用户在 SettingsModal 看到空 apiKey 即会重新输入）
      settings = { ...DEFAULT_AI_SETTINGS, ...loaded } as AISettings;
    } else {
      // 文件不存在或读取失败：用默认值，让用户首次设置流程正常进入
      settings = { ...DEFAULT_AI_SETTINGS };
    }
    set({ aiSettings: settings });
  },

  updateAISettings: async (updates: Partial<AISettings>) => {
    // 函数式 set：在 await 前同步更新内存，避免 await 期间触发的第二次 updateAISettings
    // 读到旧快照导致两次 set 互相覆盖丢失更新
    set(state => ({ aiSettings: { ...state.aiSettings, ...updates } }));
    // 专用 ai:saveSettings IPC 持久化：主进程内部校验 provider + 加密 apiKey 后落盘，
    // 不再调用 storage.encrypt + storage.set('aiSettings', ...)，
    // 防止 XSS 后通过 storage:write 任意覆写 aiSettings 把 apiKey 替换为 attacker-key。
    // updates 中的 apiKey 是明文，saveAISettings 接受明文由主进程加密
    try {
      const ok = await storage.saveAISettings({ ...get().aiSettings, ...updates } as {
        apiKey: string;
        provider: string;
        baseUrl: string;
        model: string;
        temperature: number;
        maxTokens: number;
        [key: string]: unknown;
      });
      if (!ok) {
        // 持久化失败：内存值保留（用户当前会话仍可用），仅提示用户
        toast.error('AI 设置保存失败', '主进程写入失败，请检查磁盘空间或文件权限');
      } else if (updates.apiKey) {
        // 安全加固：保存成功后立即把 store 中的明文 apiKey 重置为 'configured' 哨兵，
        // 避免明文密钥长期驻留渲染层内存（XSS 后可通过 useAppStore.getState().aiSettings.apiKey 读到）。
        // hasApiKey 标志保留为 true 供 UI 判断"已配置"。
        set(state => ({ aiSettings: { ...state.aiSettings, apiKey: 'configured', hasApiKey: true } }));
      }
    } catch (e) {
      logError('Failed to save AI settings', e);
      toast.error('AI 设置保存失败', getErrorMessage(e));
    }
  },

  checkForRecovery: async () => {
    const draft = await storage.loadRecoveryDraft();
    if (draft) {
      set({ recoveryDraft: draft });
    }
  },

  restoreRecoveryDraft: () => {
    const { recoveryDraft, currentProjectId, chapters, projects, contentEpoch } = get();
    if (!recoveryDraft) return;

    // 草稿归属项目与当前打开项目不一致时拒绝恢复，避免把草稿内容写到错误章节造成数据污染。
    // 不清除草稿，让用户先打开正确项目后再恢复。
    if (recoveryDraft.projectId !== currentProjectId) {
      console.warn('Recovery draft belongs to a different project');
      return;
    }
    const targetChapter = chapters.find(c => c.id === recoveryDraft.chapterId);
    if (!targetChapter) {
      console.warn('Recovery draft target chapter not found');
      return; // 不清除草稿
    }

    // 重算 wordCount：恢复的内容可能比原章节多/少很多字，不重算会让字数统计面板、
    // 章节列表显示陈旧值（与 updateChapterContent / restoreVersion 行为对齐）
    const newWordCount = countWords(recoveryDraft.content.replace(/<[^>]*>/g, ''));
    const updatedChapters = chapters.map(c =>
      c.id === recoveryDraft.chapterId
        ? { ...c, content: recoveryDraft.content, wordCount: newWordCount, updatedAt: new Date().toISOString() }
        : c
    );
    // 同步 project.totalWords：顶栏字数显示依赖该字段，不同步会与实际不一致
    // （参考 chapterSlice.updateChapterContent 与 versionHistorySlice.restoreVersion）
    const totalWords = updatedChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    const updatedProjects = currentProjectId
      ? projects.map(p => p.id === currentProjectId ? { ...p, totalWords } : p)
      : projects;
    // 把 bumpContentEpoch 内联到单次 set，避免独立 set 产生中间订阅状态
    set({
      chapters: updatedChapters,
      projects: updatedProjects,
      recoveryDraft: null,
      contentEpoch: contentEpoch + 1,
    });
    // markDirty + recomputeForeshadowMentions：恢复内容含伏笔标题字符串时需重算距离，
    // 且必须 markDirty 触发持久化，否则用户恢复后未编辑就关闭，恢复的内容会丢失
    // （原实现遗漏 markDirty 是 HIGH 严重 bug：等于"恢复了但又丢了"）
    markDirty();
    get().recomputeForeshadowMentions();
    void storage.clearRecoveryDraft().catch(e => logWarn('clearRecoveryDraft failed', { error: getErrorMessage(e) }));
  },

  discardRecoveryDraft: () => {
    set({ recoveryDraft: null });
    void storage.clearRecoveryDraft().catch(e => logWarn('clearRecoveryDraft failed', { error: getErrorMessage(e) }));
  },

  loadAppPreferences: async () => {
    const stored = await storage.get<Partial<AppPreferences>>('appPreferences', {});
    // 校验加载值：旧版本/异常写入可能产生越界或类型不符的字段，
    // 直接合并会让 UI 拿到非法值（如 autoSaveInterval=0 导致定时器永不触发）
    const merged: AppPreferences = { ...DEFAULT_APP_PREFERENCES, ...stored };
    if (typeof merged.autoSaveInterval !== 'number' || !Number.isFinite(merged.autoSaveInterval) || merged.autoSaveInterval < 0) {
      merged.autoSaveInterval = DEFAULT_APP_PREFERENCES.autoSaveInterval;
    }
    if (typeof merged.defaultFontSize !== 'number' || merged.defaultFontSize < 8 || merged.defaultFontSize > 32) {
      merged.defaultFontSize = DEFAULT_APP_PREFERENCES.defaultFontSize;
    }
    if (typeof merged.defaultLineHeight !== 'number' || merged.defaultLineHeight < 1 || merged.defaultLineHeight > 3) {
      merged.defaultLineHeight = DEFAULT_APP_PREFERENCES.defaultLineHeight;
    }
    if (merged.defaultTheme !== 'dark' && merged.defaultTheme !== 'light') {
      merged.defaultTheme = DEFAULT_APP_PREFERENCES.defaultTheme;
    }
    if (merged.defaultPolishScope !== 'all' && merged.defaultPolishScope !== 'current') {
      merged.defaultPolishScope = DEFAULT_APP_PREFERENCES.defaultPolishScope;
    }
    if (typeof merged.defaultFontFamily !== 'string' || !merged.defaultFontFamily.trim()) {
      merged.defaultFontFamily = DEFAULT_APP_PREFERENCES.defaultFontFamily;
    }
    set({ appPreferences: merged });
  },

  // 改为 async：调用方（如 SettingsModal.handleSave）需要确认持久化完成后
  // 再关闭弹窗，否则用户立即关闭窗口可能丢失最后一次写入。
  updateAppPreferences: async (updates: Partial<AppPreferences>) => {
    const appPreferences = { ...get().appPreferences, ...updates };
    set({ appPreferences });
    try {
      await storage.set('appPreferences', appPreferences);
    } catch (e) {
      logError('Failed to save app preferences', e);
      // 与 updateAISettings 保持一致：持久化失败时 toast 提示用户
      toast.error('设置保存失败', getErrorMessage(e));
    }
  },
});
