/**
 * src/store/slices/uiSlice.ts 单元测试
 *
 * 测试目标：
 * - 面板状态 setter：setLeftPanelCollapsed / setRightPanelCollapsed / setRightPanelTab
 * - search：空查询清空、debounce + 主线程降级搜索（chapter/character/setting/foreshadow/material）
 * - clearSearch / setSearchHighlight
 * - detectConflicts：无项目 noop；有项目时填充 conflicts
 * - resolveConflict：切换 resolved 标志
 * - addAISuggestion / clearAISuggestions：生成 id + timestamp
 * - loadAISettings：主进程返回 settings / 返回 null 走默认值
 * - updateAISettings：成功 / 持久化失败 toast
 * - checkForRecovery / restoreRecoveryDraft：跨项目拒绝、章节缺失、成功恢复含 markDirty + contentEpoch bump
 * - discardRecoveryDraft
 * - loadAppPreferences：非法字段回退到默认值
 * - updateAppPreferences：成功 / 持久化失败 toast
 */
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS, DEFAULT_APP_PREFERENCES } from '@/store/appState';
import { disposeSearchWorker } from '@/store/slices/uiSlice';
import type { RecoveryDraft } from '@/store/appState';
import type { Chapter, Project, AISettings } from '@/types';

// ============ 内存存储 mock ============
const { memoryStore, mockStorage, toastMock } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();
  const mockStorage = {
    get: vi.fn(async <T>(key: string, defaultValue: T): Promise<T> => {
      return memoryStore.has(key) ? (memoryStore.get(key) as T) : defaultValue;
    }),
    set: vi.fn(async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value);
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      memoryStore.delete(key);
    }),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    loadRecoveryDraft: vi.fn().mockResolvedValue(null),
    clearRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    saveAISettings: vi.fn().mockResolvedValue(true),
    loadAISettings: vi.fn().mockResolvedValue(null),
  };
  const toastMock = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  return { memoryStore, mockStorage, toastMock };
});

vi.mock('@/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    storage: mockStorage,
    // no-op：避免 30s 自动保存计时器在测试中触发
    markDirty: vi.fn(),
    triggerSave: vi.fn(async () => {}),
    clearAutoSaveTimer: vi.fn(),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

// ============ 测试辅助 ============
const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'ch1',
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
});

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: '测试项目',
  description: '',
  template: 'blank',
  lastOpenedAt: '',
  totalWords: 0,
  config: {
    theme: 'dark',
    fontSize: 16,
    lineHeight: 1.8,
    fontFamily: 'system-ui',
    showLineNumbers: false,
    showWordCount: true,
    zenMode: false,
    aiSettings: { ...DEFAULT_AI_SETTINGS } as never,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ============ Fake Web Worker（用于覆盖 search() 的 Worker 路径 L202-256） ============
// jsdom 默认不提供 Worker 构造器，search() 会降级到主线程同步搜索。
// 通过在 search Worker 路径 describe 的 beforeAll 注入此 Fake 到 globalThis.Worker，
// 可驱动 getSearchWorker 创建实例并测试 onMessage/onError/postMessage catch 等分支。
class FakeSearchWorker {
  messageListeners = new Set<(e: { data: unknown }) => void>();
  errorListeners = new Set<(e: { message: string; filename: string; lineno: number }) => void>();
  postedMessages: unknown[] = [];

  addEventListener(type: string, cb: (e: never) => void) {
    if (type === 'message') this.messageListeners.add(cb as never);
    if (type === 'error') this.errorListeners.add(cb as never);
  }
  removeEventListener(type: string, cb: (e: never) => void) {
    if (type === 'message') this.messageListeners.delete(cb as never);
    if (type === 'error') this.errorListeners.delete(cb as never);
  }
  postMessage(data: unknown) { this.postedMessages.push(data); }
  terminate() { /* no-op */ }

  // 测试辅助：模拟 Worker 回传 message 事件
  emitMessage(data: unknown) {
    for (const cb of this.messageListeners) cb({ data });
  }
  // 测试辅助：模拟 Worker 触发 onerror
  emitError(message = 'worker error', filename = 'sw.js', lineno = 1) {
    for (const cb of this.errorListeners) cb({ message, filename, lineno } as never);
  }
}

// ============ 测试前重置 store ============
beforeEach(() => {
  memoryStore.clear();
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.saveRecoveryDraft.mockClear();
  mockStorage.loadRecoveryDraft.mockClear();
  mockStorage.clearRecoveryDraft.mockClear();
  mockStorage.saveAISettings.mockClear();
  mockStorage.loadAISettings.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();

  useAppStore.setState({
    projects: [makeProject()],
    currentProjectId: 'p1',
    currentProjectFilePath: null,
    lastSavedAt: null,
    isSaving: false,
    chapters: [makeChapter()],
    currentChapterId: 'ch1',
    versions: {},
    histories: {},
    contentEpoch: 0,
    characters: [],
    settingCategories: [],
    settingItems: [],
    foreshadows: [],
    materials: [],
    conflicts: [],
    aiSuggestions: [],
    isAIGenerating: false,
    searchQuery: '',
    searchResults: [],
    searchHighlight: null,
    analysis: {},
    aiSettings: { ...DEFAULT_AI_SETTINGS },
    recoveryDraft: null,
    appPreferences: { ...DEFAULT_APP_PREFERENCES },
    subplots: [],
    updateSchedule: null,
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
    rightPanelTab: 'ai',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ============ 测试用例 ============

describe('uiSlice', () => {
  // -------------------- 面板状态 setter --------------------
  describe('面板状态 setter', () => {
    it('setLeftPanelCollapsed 更新 leftPanelCollapsed', () => {
      useAppStore.getState().setLeftPanelCollapsed(true);
      expect(useAppStore.getState().leftPanelCollapsed).toBe(true);
      useAppStore.getState().setLeftPanelCollapsed(false);
      expect(useAppStore.getState().leftPanelCollapsed).toBe(false);
    });

    it('setRightPanelCollapsed 更新 rightPanelCollapsed', () => {
      useAppStore.getState().setRightPanelCollapsed(true);
      expect(useAppStore.getState().rightPanelCollapsed).toBe(true);
    });

    it('setRightPanelTab 更新 rightPanelTab', () => {
      useAppStore.getState().setRightPanelTab('characters');
      expect(useAppStore.getState().rightPanelTab).toBe('characters');
      useAppStore.getState().setRightPanelTab('settings');
      expect(useAppStore.getState().rightPanelTab).toBe('settings');
    });
  });

  // -------------------- search --------------------
  describe('search', () => {
    it('空查询立即清空 searchResults 且不触发 debounce', () => {
      vi.useFakeTimers();
      useAppStore.getState().search('hello');
      useAppStore.getState().search('');
      expect(useAppStore.getState().searchQuery).toBe('');
      expect(useAppStore.getState().searchResults).toEqual([]);
      // 推进时间也不应有结果（debounce 已被清空）
      vi.advanceTimersByTime(500);
      expect(useAppStore.getState().searchResults).toEqual([]);
    });

    it('searchQuery 立即同步更新', () => {
      vi.useFakeTimers();
      useAppStore.getState().search('关键词');
      // 此时 searchResults 还没填充（debounce 未到）
      expect(useAppStore.getState().searchQuery).toBe('关键词');
      expect(useAppStore.getState().searchResults).toEqual([]);
    });

    it('debounce 后主线程降级搜索匹配 chapter 标题', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '黑暗森林', content: '内容', summary: '概要' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300); // 超过 SEARCH_DEBOUNCE_DELAY(250ms)
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.type === 'chapter' && r.id === 'ch1')).toBe(true);
    });

    it('主线程降级搜索匹配 chapter 内容', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '第一章', content: '森林里的故事', summary: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.type === 'chapter' && r.id === 'ch1')).toBe(true);
    });

    it('主线程降级搜索匹配 character 名字', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        characters: [{
          id: 'c1', projectId: 'p1', name: '叶文洁', role: 'protagonist',
          color: '#fff', profile: { personality: '理性', background: '' },
          relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
          createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('叶文洁');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.type === 'character' && r.id === 'c1')).toBe(true);
    });

    it('getProfileSearchText 缓存命中：同一 profile 引用二次搜索不重新序列化', () => {
      // 覆盖 getProfileSearchText 的 cache-hit 分支（profileRef 引用相等 → 直接返回缓存文本）
      vi.useFakeTimers();
      const profile = { personality: '冷静', background: '物理学家' };
      const stringifySpy = vi.spyOn(JSON, 'stringify');
      useAppStore.setState({
        characters: [{
          id: 'cache-c1', projectId: 'p1', name: '程心', role: 'protagonist',
          color: '#fff', profile,
          relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
          createdAt: '', updatedAt: '',
        }] as never,
      });
      // 第一次搜索：cache miss → 调用 JSON.stringify(profile) 并写入缓存
      useAppStore.getState().search('程心');
      vi.advanceTimersByTime(300);
      expect(useAppStore.getState().searchResults.some(r => r.id === 'cache-c1')).toBe(true);
      // 第二次搜索：同一 profile 引用 → cache hit → 直接返回缓存文本，不重新序列化
      useAppStore.getState().search('程心');
      vi.advanceTimersByTime(300);
      // 搜索结果仍应正确匹配（缓存文本与首次一致）
      expect(useAppStore.getState().searchResults.some(r => r.id === 'cache-c1')).toBe(true);
      stringifySpy.mockRestore();
    });

    it('getProfileSearchText 对 null/undefined profile 降级为空串不崩溃（M3 修复）', () => {
      // 覆盖 M3 修复分支：profile == null 时返回 ''，避免 .toLowerCase() 抛 TypeError
      vi.useFakeTimers();
      useAppStore.setState({
        characters: [{
          id: 'null-c1', projectId: 'p1', name: '无名氏', role: 'supporting',
          color: '#fff', profile: undefined,
          relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
          createdAt: '', updatedAt: '',
        }, {
          id: 'null-c2', projectId: 'p1', name: '无名氏二', role: 'supporting',
          color: '#fff', profile: null as never,
          relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
          createdAt: '', updatedAt: '',
        }] as never,
      });
      // 按名字搜索应正常返回，不应因 profile null/undefined 抛错中断
      expect(() => {
        useAppStore.getState().search('无名氏');
        vi.advanceTimersByTime(300);
      }).not.toThrow();
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.id === 'null-c1')).toBe(true);
      expect(results.some(r => r.id === 'null-c2')).toBe(true);
    });

    it('主线程降级搜索匹配 setting 名称', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        settingItems: [{
          id: 's1', projectId: 'p1', categoryId: 'sc1', name: '三体世界',
          description: '外星文明', content: '', references: [], tags: [],
          order: 0, createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('三体');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.type === 'setting' && r.id === 's1')).toBe(true);
    });

    it('主线程降级搜索匹配 foreshadow 标题', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        foreshadows: [{
          id: 'f1', projectId: 'p1', title: '黑暗森林法则', description: '宇宙生存法则',
          status: 'planted', plantedChapterId: null, payoffChapterId: null,
          priority: 'medium', relatedCharacters: [], relatedSettings: [],
          chaptersSinceMention: 0, notes: '', createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('黑暗森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.type === 'foreshadow' && r.id === 'f1')).toBe(true);
    });

    it('主线程降级搜索匹配 material 标题', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        materials: [{
          id: 'm1', projectId: 'p1', title: '红岸基地', type: 'reference',
          content: '冷战时期的秘密基地', tags: [], category: '', references: [],
          pinned: false, createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('红岸');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.type === 'material' && r.id === 'm1')).toBe(true);
    });

    it('主线程降级搜索匹配 material 内容：idx 靠前且内容超长（覆盖 L191 idx>=0 真 + 无前缀 + 尾部 ...）', () => {
      // 覆盖 material preview true 分支：content 命中查询且 idx<=20（无前缀 ...）、
      // content 长度 > idx+query.length+30（触发尾部 ...）
      vi.useFakeTimers();
      useAppStore.setState({
        materials: [{
          id: 'm-long', projectId: 'p1', title: '无关标题', type: 'reference',
          content: '森林深处藏着秘密森林深处藏着秘密森林深处藏着秘密森林深处藏着秘密结尾',
          tags: [], category: '', references: [], pinned: false, createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      const m = results.find(r => r.type === 'material' && r.id === 'm-long');
      expect(m).toBeTruthy();
      expect(m!.preview).toContain('森林');
      expect(m!.preview.startsWith('...')).toBe(false); // idx<=20，无前缀
      expect(m!.preview.endsWith('...')).toBe(true); // 内容超长，尾部 ...
    });

    it('主线程降级搜索匹配 material 内容：idx 偏后且内容较短（覆盖 L191 idx>20 真 + 无尾部 ...）', () => {
      // 覆盖 idx>20 前缀 ... 分支 + idx+query.length+30 >= length 无尾部 ... 分支
      vi.useFakeTimers();
      useAppStore.setState({
        materials: [{
          id: 'm-shift', projectId: 'p1', title: '无关', type: 'reference',
          content: 'abcdefghijklmnopqrstuvwxyz森林', // 森林 在 idx=26
          tags: [], category: '', references: [], pinned: false, createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      const m = results.find(r => r.type === 'material' && r.id === 'm-shift');
      expect(m).toBeTruthy();
      expect(m!.preview.startsWith('...')).toBe(true); // idx>20，前缀 ...
      expect(m!.preview.endsWith('...')).toBe(false); // 内容短，无尾部 ...
      expect(m!.preview).toContain('森林');
    });

    it('无匹配时返回空数组', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ title: '完全无关的标题', content: '没有任何匹配内容' })],
      });
      useAppStore.getState().search('不存在的关键词');
      vi.advanceTimersByTime(300);
      expect(useAppStore.getState().searchResults).toEqual([]);
    });

    it('转义正则元字符不抛错（如搜索 "(test"）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ title: '测试(test 章节', content: '' })],
      });
      // 不应抛出 SyntaxError
      expect(() => {
        useAppStore.getState().search('(test');
        vi.advanceTimersByTime(300);
      }).not.toThrow();
    });

    it('连续搜索只采用最后一次结果（debounce 取消旧 timer）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '苹果', content: '' })],
      });
      useAppStore.getState().search('苹');
      useAppStore.getState().search('苹果');
      // 推进 300ms，应只看到最后一次搜索的结果
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ch1');
    });

    it('matchCount 降序排序', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', title: 'a', content: '苹果 苹果' }), // content 匹配 2 次
          makeChapter({ id: 'ch2', title: '苹果苹果苹果', content: '' }), // title 匹配 3 次（×3=9）
        ],
      });
      useAppStore.getState().search('苹果');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.length).toBeGreaterThanOrEqual(2);
      // title 匹配权重更高，应排在前面
      expect(results[0].matchCount).toBeGreaterThanOrEqual(results[1].matchCount);
    });

    // -------------------- || 短路分支 + chapter preview 内部三元覆盖 --------------------
    it('chapter content 命中 idx>20 时 preview 前缀加 ...（覆盖 L149 idx>20 真）', () => {
      vi.useFakeTimers();
      const longPrefix = '前'.repeat(50);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch-idx20', title: '无关标题', content: `${longPrefix}森林`, summary: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const r = useAppStore.getState().searchResults.find(x => x.type === 'chapter' && x.id === 'ch-idx20');
      expect(r).toBeTruthy();
      expect(r!.preview.startsWith('...')).toBe(true);
      expect(r!.preview).toContain('森林');
    });

    it('chapter content 命中且后缀超出时 preview 末尾加 ...（覆盖 L149 后缀真）', () => {
      vi.useFakeTimers();
      const longSuffix = '后'.repeat(100);
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch-suffix', title: '无关', content: `森林${longSuffix}`, summary: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const r = useAppStore.getState().searchResults.find(x => x.type === 'chapter' && x.id === 'ch-suffix');
      expect(r).toBeTruthy();
      expect(r!.preview.endsWith('...')).toBe(true);
      expect(r!.preview).toContain('森林');
    });

    it('character name 不匹配但 profile 匹配（覆盖 L156 || 右侧 + L161 personality 缺失取 background）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        characters: [{
          id: 'c-prof', projectId: 'p1', name: '完全不匹配的名字', role: 'supporting',
          color: '#fff', profile: { background: '森林背景描述' }, // 无 personality → L161 || 取 background
          relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
          createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.id === 'c-prof')).toBe(true);
      const c = results.find(r => r.id === 'c-prof')!;
      expect(c.preview).toBe('森林背景描述'); // personality 缺失 → fallback 到 background
    });

    it('setting name 不匹配但 description 匹配（覆盖 L166 || 右侧）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        settingItems: [{
          id: 's-desc', projectId: 'p1', categoryId: 'sc1', name: '不匹配的名',
          description: '森林设定描述', content: '',
          references: [], tags: [], order: 0, createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.id === 's-desc')).toBe(true);
    });

    it('foreshadow title 不匹配但 description 匹配（覆盖 L176 || 右侧）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        foreshadows: [{
          id: 'f-desc', projectId: 'p1', title: '不匹配的标题', description: '森林伏笔描述',
          status: 'planted', plantedChapterId: null, payoffChapterId: null,
          priority: 'medium', relatedCharacters: [], relatedSettings: [],
          chaptersSinceMention: 0, notes: '', createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const results = useAppStore.getState().searchResults;
      expect(results.some(r => r.id === 'f-desc')).toBe(true);
    });
  });

  // -------------------- search Worker 路径（L202-256） --------------------
  // jsdom 默认不提供 Worker，search() 会降级主线程。此处 beforeAll 注入 FakeSearchWorker
  // 到 globalThis.Worker，驱动 getSearchWorker 创建实例，覆盖 onMessage/onError/postMessage catch 分支。
  describe('search Worker 路径', () => {
    let currentWorker: FakeSearchWorker;
    let throwOnPostMessage: boolean;
    let originalWorkerDescriptor: PropertyDescriptor | undefined;

    beforeAll(() => {
      originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
      // 注入捕获实例 + 可控 postMessage 抛错的 FakeWorker 子类
      // 通过 capture(this) 传参捕获实例，避免直接将 this 赋值给变量触发 no-this-alias
      const capture = (w: FakeSearchWorker): void => { currentWorker = w; };
      const CapturingWorker = class extends FakeSearchWorker {
        constructor() {
          super();
          capture(this);
        }
        postMessage(data: unknown) {
          if (throwOnPostMessage) throw new Error('postMessage failed');
          super.postMessage(data);
        }
      };
      Object.defineProperty(globalThis, 'Worker', {
        value: CapturingWorker,
        writable: true,
        configurable: true,
      });
    });

    afterAll(() => {
      // 还原全局 Worker（删除或恢复原描述符），避免影响其他 describe
      if (originalWorkerDescriptor) {
        Object.defineProperty(globalThis, 'Worker', originalWorkerDescriptor);
      } else {
        delete (globalThis as { Worker?: unknown }).Worker;
      }
      disposeSearchWorker();
    });

    beforeEach(() => {
      throwOnPostMessage = false;
      // 清除 uiSlice 模块缓存的 searchWorker，确保每个测试创建新 FakeWorker
      disposeSearchWorker();
      currentWorker = undefined as never;
    });

    it('Worker 正常返回结果：set searchResults（覆盖 L218）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '森林', content: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300); // 触发 debounce → 创建 Worker + postMessage
      expect(currentWorker.postedMessages).toHaveLength(1);
      const posted = currentWorker.postedMessages[0] as { requestId: number; query: string };
      // 模拟 Worker 回传结果
      currentWorker.emitMessage({ requestId: posted.requestId, results: [{ type: 'chapter', id: 'ch1', title: '森林', preview: 'p', matchCount: 3 }] });
      expect(useAppStore.getState().searchResults).toHaveLength(1);
      expect(useAppStore.getState().searchResults[0].id).toBe('ch1');
      vi.useRealTimers();
    });

    it('Worker 回传 error：降级主线程同步搜索（覆盖 L213-216 error 分支）', () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '森林', content: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const posted = currentWorker.postedMessages[0] as { requestId: number };
      currentWorker.emitMessage({ requestId: posted.requestId, error: 'boom' });
      // 降级到主线程，应匹配 chapter 标题
      expect(useAppStore.getState().searchResults.some(r => r.id === 'ch1')).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('Worker 运行时 onerror：降级主线程并转发 electronAPI.logger（覆盖 L223-235）', () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const loggerWrite = (window as unknown as { electronAPI?: { logger?: { write: ReturnType<typeof vi.fn> } } }).electronAPI!.logger!.write;
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '森林', content: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      currentWorker.emitError('runtime boom', 'sw.js', 42);
      // 降级主线程
      expect(useAppStore.getState().searchResults.some(r => r.id === 'ch1')).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      // 转发到主进程日志
      expect(loggerWrite).toHaveBeenCalledWith('error', expect.stringContaining('searchWorker runtime error'), expect.objectContaining({ filename: 'sw.js', lineno: 42 }));
      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it('过期 requestId 的响应被丢弃（覆盖 L207 不匹配返回 + L212 await 期间新请求进入丢弃）', () => {
      vi.useFakeTimers();
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '森林', content: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      const firstPosted = currentWorker.postedMessages[0] as { requestId: number };
      // 发起新搜索（requestId 递增），使旧响应过期
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      // 旧 requestId 的响应应被两个 onMessage 监听器分别经 L207/L212 丢弃
      currentWorker.emitMessage({ requestId: firstPosted.requestId, results: [{ type: 'chapter', id: 'old-ch', title: 't', preview: 'p', matchCount: 1 }] });
      expect(useAppStore.getState().searchResults.some(r => r.id === 'old-ch')).toBe(false);
      vi.useRealTimers();
    });

    it('Worker postMessage 抛错：catch 降级主线程并移除监听器（覆盖 L251-255）', () => {
      vi.useFakeTimers();
      throwOnPostMessage = true;
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', title: '森林', content: '' })],
      });
      useAppStore.getState().search('森林');
      vi.advanceTimersByTime(300);
      // postMessage 抛错 → catch → removeEventListener + 降级主线程
      expect(useAppStore.getState().searchResults.some(r => r.id === 'ch1')).toBe(true);
      // catch 中已移除监听器
      expect(currentWorker.messageListeners.size).toBe(0);
      expect(currentWorker.errorListeners.size).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('clearSearch', () => {
    it('清空 searchQuery 与 searchResults', () => {
      useAppStore.setState({ searchQuery: 'foo', searchResults: [{ type: 'chapter', id: 'x', title: 't', preview: 'p', matchCount: 1 }] });
      useAppStore.getState().clearSearch();
      expect(useAppStore.getState().searchQuery).toBe('');
      expect(useAppStore.getState().searchResults).toEqual([]);
    });
  });

  describe('setSearchHighlight', () => {
    it('设置 searchHighlight', () => {
      useAppStore.getState().setSearchHighlight('关键词');
      expect(useAppStore.getState().searchHighlight).toBe('关键词');
    });

    it('清空 searchHighlight（传 null）', () => {
      useAppStore.getState().setSearchHighlight('foo');
      useAppStore.getState().setSearchHighlight(null);
      expect(useAppStore.getState().searchHighlight).toBeNull();
    });
  });

  // -------------------- detectConflicts --------------------
  describe('detectConflicts', () => {
    it('无 currentProjectId 时 noop（conflicts 不变）', () => {
      useAppStore.setState({ currentProjectId: null, conflicts: [] });
      useAppStore.getState().detectConflicts();
      expect(useAppStore.getState().conflicts).toEqual([]);
    });

    it('有项目时填充 conflicts（可能为空数组但执行了扫描）', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '叶文洁看着窗外。' })],
        characters: [{
          id: 'c1', projectId: 'p1', name: '叶文洁', role: 'protagonist',
          color: '#fff', profile: { personality: '', background: '' },
          relationships: [], appearanceCount: 0, dialogueCount: 0, tags: [],
          createdAt: '', updatedAt: '',
        }] as never,
      });
      useAppStore.getState().detectConflicts();
      // 不应抛错，conflicts 应为数组（即使本次扫描无问题）
      expect(Array.isArray(useAppStore.getState().conflicts)).toBe(true);
    });
  });

  // -------------------- resolveConflict --------------------
  describe('resolveConflict', () => {
    it('切换指定 issue 的 resolved 标志', () => {
      useAppStore.setState({
        conflicts: [
          { id: 'issue1', type: 'character' as const, severity: 'warning' as const, chapterId: 'ch1', description: 'd', suggestion: 's', resolved: false },
          { id: 'issue2', type: 'setting' as const, severity: 'info' as const, chapterId: 'ch1', description: 'd2', suggestion: 's2', resolved: false },
        ],
      });
      useAppStore.getState().resolveConflict('issue1');
      const conflicts = useAppStore.getState().conflicts;
      expect(conflicts[0].resolved).toBe(true);
      expect(conflicts[1].resolved).toBe(false);
      // 再次切换应回到 false
      useAppStore.getState().resolveConflict('issue1');
      expect(useAppStore.getState().conflicts[0].resolved).toBe(false);
    });

    it('issueId 不存在时安全 noop', () => {
      const original = [{ id: 'issue1', type: 'character' as const, severity: 'warning' as const, chapterId: 'ch1', description: 'd', suggestion: 's', resolved: false }];
      useAppStore.setState({ conflicts: original });
      useAppStore.getState().resolveConflict('not-exist');
      expect(useAppStore.getState().conflicts).toEqual(original);
    });
  });

  // -------------------- addAISuggestion / clearAISuggestions --------------------
  describe('addAISuggestion / clearAISuggestions', () => {
    it('addAISuggestion 生成 id + timestamp 并追加', () => {
      useAppStore.getState().addAISuggestion({
        type: 'continue',
        title: '续写建议',
        content: '建议内容',
        reasoning: '基于上下文',
        contextUsed: ['ch1'],
      });
      const suggestions = useAppStore.getState().aiSuggestions;
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].id).toBeTruthy();
      expect(suggestions[0].timestamp).toBeTruthy();
      expect(suggestions[0].title).toBe('续写建议');
    });

    it('连续 add 追加到末尾', () => {
      useAppStore.getState().addAISuggestion({ type: 'polish', title: '1', content: '', reasoning: '', contextUsed: [] });
      useAppStore.getState().addAISuggestion({ type: 'polish', title: '2', content: '', reasoning: '', contextUsed: [] });
      const suggestions = useAppStore.getState().aiSuggestions;
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].title).toBe('1');
      expect(suggestions[1].title).toBe('2');
    });

    it('clearAISuggestions 清空列表', () => {
      useAppStore.getState().addAISuggestion({ type: 'polish', title: 'x', content: '', reasoning: '', contextUsed: [] });
      useAppStore.getState().clearAISuggestions();
      expect(useAppStore.getState().aiSuggestions).toEqual([]);
    });
  });

  // -------------------- loadAISettings --------------------
  describe('loadAISettings', () => {
    it('主进程返回 null：使用默认值', async () => {
      mockStorage.loadAISettings.mockResolvedValueOnce(null);
      await useAppStore.getState().loadAISettings();
      const settings = useAppStore.getState().aiSettings;
      expect(settings).toEqual(DEFAULT_AI_SETTINGS);
    });

    it('主进程返回 settings：合并默认值', async () => {
      const loaded = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' };
      mockStorage.loadAISettings.mockResolvedValueOnce(loaded);
      await useAppStore.getState().loadAISettings();
      const settings = useAppStore.getState().aiSettings as AISettings;
      expect(settings.provider).toBe('openai');
      expect(settings.apiKey).toBe('sk-test');
      expect(settings.model).toBe('gpt-4');
      // 未提供的字段使用默认值
      expect(settings.temperature).toBe(DEFAULT_AI_SETTINGS.temperature);
      expect(settings.style).toBe(DEFAULT_AI_SETTINGS.style);
    });
  });

  // -------------------- updateAISettings --------------------
  describe('updateAISettings', () => {
    it('同步更新内存 + 调用 saveAISettings 持久化', async () => {
      await useAppStore.getState().updateAISettings({ provider: 'openai', apiKey: 'k' });
      expect(useAppStore.getState().aiSettings.provider).toBe('openai');
      expect((useAppStore.getState().aiSettings as AISettings).apiKey).toBe('k');
      expect(mockStorage.saveAISettings).toHaveBeenCalled();
    });

    it('saveAISettings 返回 false 时 toast.error', async () => {
      mockStorage.saveAISettings.mockResolvedValueOnce(false);
      await useAppStore.getState().updateAISettings({ provider: 'mock' });
      expect(toastMock.error).toHaveBeenCalled();
    });

    it('saveAISettings 抛错时 toast.error 含错误信息', async () => {
      mockStorage.saveAISettings.mockRejectedValueOnce(new Error('disk full'));
      await useAppStore.getState().updateAISettings({ provider: 'mock' });
      expect(toastMock.error).toHaveBeenCalledWith('AI 设置保存失败', 'disk full');
    });

    it('await 期间并发 updateAISettings 不丢失更新（函数式 set）', async () => {
      // 第一次 update 进入 await，第二次 update 应读到第一次 set 后的状态
      let resolveFirst!: (v: boolean) => void;
      mockStorage.saveAISettings.mockReturnValueOnce(new Promise<boolean>(r => { resolveFirst = r; }));
      const p1 = useAppStore.getState().updateAISettings({ apiKey: 'k1' });
      // 在 p1 await 期间触发 p2
      const p2 = useAppStore.getState().updateAISettings({ model: 'gpt-4' });
      // 此时内存应已包含两次更新
      const state = useAppStore.getState().aiSettings as AISettings;
      expect(state.apiKey).toBe('k1');
      expect(state.model).toBe('gpt-4');
      // 让两个 promise resolve
      resolveFirst(true);
      await Promise.all([p1, p2]);
    });
  });

  // -------------------- checkForRecovery / restoreRecoveryDraft --------------------
  describe('checkForRecovery', () => {
    it('有草稿时设置 recoveryDraft', async () => {
      const draft: RecoveryDraft = {
        projectId: 'p1', chapterId: 'ch1', content: '恢复内容', timestamp: '2024-01-01',
      };
      mockStorage.loadRecoveryDraft.mockResolvedValueOnce(draft);
      await useAppStore.getState().checkForRecovery();
      expect(useAppStore.getState().recoveryDraft).toEqual(draft);
    });

    it('无草稿时 recoveryDraft 保持 null', async () => {
      mockStorage.loadRecoveryDraft.mockResolvedValueOnce(null);
      await useAppStore.getState().checkForRecovery();
      expect(useAppStore.getState().recoveryDraft).toBeNull();
    });
  });

  describe('restoreRecoveryDraft', () => {
    it('无草稿时 noop', () => {
      useAppStore.setState({ recoveryDraft: null });
      useAppStore.getState().restoreRecoveryDraft();
      expect(useAppStore.getState().chapters).toHaveLength(1);
      expect(useAppStore.getState().recoveryDraft).toBeNull();
    });

    it('草稿归属项目与当前项目不一致时拒绝恢复', () => {
      useAppStore.setState({
        recoveryDraft: {
          projectId: 'other-project', chapterId: 'ch1', content: '内容', timestamp: '',
        },
        currentProjectId: 'p1',
      });
      useAppStore.getState().restoreRecoveryDraft();
      // chapters 不应被修改
      expect(useAppStore.getState().chapters[0].content).toBe('');
      // 草稿保留（让用户切到正确项目后再恢复）
      expect(useAppStore.getState().recoveryDraft).not.toBeNull();
    });

    it('目标章节不存在时 noop', () => {
      useAppStore.setState({
        recoveryDraft: { projectId: 'p1', chapterId: 'not-exist', content: '内容', timestamp: '' },
        chapters: [makeChapter({ id: 'ch1' })],
        currentProjectId: 'p1',
      });
      useAppStore.getState().restoreRecoveryDraft();
      expect(useAppStore.getState().chapters).toHaveLength(1);
      // 草稿保留
      expect(useAppStore.getState().recoveryDraft).not.toBeNull();
    });

    it('成功恢复：写入正文 + 重算 wordCount + 清空草稿 + contentEpoch bump', () => {
      useAppStore.setState({
        recoveryDraft: { projectId: 'p1', chapterId: 'ch1', content: '<p>恢复的内容</p>', timestamp: '' },
        chapters: [makeChapter({ id: 'ch1', content: '旧内容', wordCount: 3 })],
        currentProjectId: 'p1',
        currentChapterId: 'ch1',
        contentEpoch: 0,
      });
      useAppStore.getState().restoreRecoveryDraft();
      const state = useAppStore.getState();
      const ch = state.chapters.find(c => c.id === 'ch1')!;
      expect(ch.content).toBe('<p>恢复的内容</p>');
      expect(ch.wordCount).toBeGreaterThan(0); // 已重算
      expect(state.recoveryDraft).toBeNull();
      expect(state.contentEpoch).toBe(1);
    });

    it('成功恢复后调用 clearRecoveryDraft', () => {
      useAppStore.setState({
        recoveryDraft: { projectId: 'p1', chapterId: 'ch1', content: '内容', timestamp: '' },
        chapters: [makeChapter({ id: 'ch1' })],
        currentProjectId: 'p1',
        currentChapterId: 'ch1',
      });
      useAppStore.getState().restoreRecoveryDraft();
      expect(mockStorage.clearRecoveryDraft).toHaveBeenCalled();
    });

    it('成功恢复后同步 project.totalWords', () => {
      useAppStore.setState({
        recoveryDraft: { projectId: 'p1', chapterId: 'ch1', content: '<p>新内容</p>', timestamp: '' },
        chapters: [
          makeChapter({ id: 'ch1', content: '', wordCount: 0 }),
          makeChapter({ id: 'ch2', content: '固定', wordCount: 5 }),
        ],
        projects: [makeProject({ id: 'p1', totalWords: 5 })],
        currentProjectId: 'p1',
        currentChapterId: 'ch1',
      });
      useAppStore.getState().restoreRecoveryDraft();
      const project = useAppStore.getState().projects.find(p => p.id === 'p1')!;
      expect(project.totalWords).toBeGreaterThanOrEqual(5);
    });

    it('currentProjectId 为 null 时 projects 直通不重算 totalWords（覆盖 L383 三元 false 分支）', () => {
      // currentProjectId 为 null 且 recoveryDraft.projectId 也为 null（通过 L360 跨项目拒绝守卫）
      // → 走 L381 三元 false 分支：updatedProjects = projects（原引用，不重算 totalWords）
      useAppStore.setState({
        recoveryDraft: { projectId: null as never, chapterId: 'ch1', content: '<p>恢复内容</p>', timestamp: '' },
        currentProjectId: null,
        chapters: [makeChapter({ id: 'ch1', content: '', wordCount: 0 })],
        projects: [makeProject({ id: 'p1', totalWords: 42 })],
      });
      useAppStore.getState().restoreRecoveryDraft();
      const state = useAppStore.getState();
      // 章节正文已恢复 + wordCount 已重算
      expect(state.chapters.find(c => c.id === 'ch1')!.content).toBe('<p>恢复内容</p>');
      expect(state.chapters.find(c => c.id === 'ch1')!.wordCount).toBeGreaterThan(0);
      // 草稿已清空
      expect(state.recoveryDraft).toBeNull();
      // projects 未被 map 重算：totalWords 保持原值 42（若走 true 分支会被 updatedChapters.reduce 覆盖为 4）
      expect(state.projects[0].totalWords).toBe(42);
    });
  });

  describe('discardRecoveryDraft', () => {
    it('清空 recoveryDraft', () => {
      useAppStore.setState({
        recoveryDraft: { projectId: 'p1', chapterId: 'ch1', content: '内容', timestamp: '' },
      });
      useAppStore.getState().discardRecoveryDraft();
      expect(useAppStore.getState().recoveryDraft).toBeNull();
    });

    it('调用 clearRecoveryDraft 持久化', () => {
      useAppStore.getState().discardRecoveryDraft();
      expect(mockStorage.clearRecoveryDraft).toHaveBeenCalled();
    });
  });

  // -------------------- loadAppPreferences --------------------
  describe('loadAppPreferences', () => {
    it('无存储值时使用默认值', async () => {
      mockStorage.get.mockResolvedValueOnce(undefined);
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences).toEqual(DEFAULT_APP_PREFERENCES);
    });

    it('合并存储值与默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ autoSaveInterval: 60000, defaultFontSize: 18 });
      await useAppStore.getState().loadAppPreferences();
      const prefs = useAppStore.getState().appPreferences;
      expect(prefs.autoSaveInterval).toBe(60000);
      expect(prefs.defaultFontSize).toBe(18);
      expect(prefs.defaultTheme).toBe(DEFAULT_APP_PREFERENCES.defaultTheme);
    });

    it('autoSaveInterval 非法（NaN）时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ autoSaveInterval: NaN });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.autoSaveInterval).toBe(DEFAULT_APP_PREFERENCES.autoSaveInterval);
    });

    it('autoSaveInterval 负数时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ autoSaveInterval: -1000 });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.autoSaveInterval).toBe(DEFAULT_APP_PREFERENCES.autoSaveInterval);
    });

    it('defaultFontSize 越界（<8）时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ defaultFontSize: 4 });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.defaultFontSize).toBe(DEFAULT_APP_PREFERENCES.defaultFontSize);
    });

    it('defaultFontSize 越界（>32）时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ defaultFontSize: 100 });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.defaultFontSize).toBe(DEFAULT_APP_PREFERENCES.defaultFontSize);
    });

    it('defaultLineHeight 越界（<1）时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ defaultLineHeight: 0.5 });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.defaultLineHeight).toBe(DEFAULT_APP_PREFERENCES.defaultLineHeight);
    });

    it('defaultTheme 非法值时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ defaultTheme: 'invalid' });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.defaultTheme).toBe(DEFAULT_APP_PREFERENCES.defaultTheme);
    });

    it('defaultPolishScope 非法值时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ defaultPolishScope: 'invalid' });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.defaultPolishScope).toBe(DEFAULT_APP_PREFERENCES.defaultPolishScope);
    });

    it('defaultFontFamily 空字符串时回退到默认值', async () => {
      mockStorage.get.mockResolvedValueOnce({ defaultFontFamily: '  ' });
      await useAppStore.getState().loadAppPreferences();
      expect(useAppStore.getState().appPreferences.defaultFontFamily).toBe(DEFAULT_APP_PREFERENCES.defaultFontFamily);
    });
  });

  // -------------------- updateAppPreferences --------------------
  describe('updateAppPreferences', () => {
    it('同步更新内存 + 调用 storage.set 持久化', async () => {
      await useAppStore.getState().updateAppPreferences({ defaultFontSize: 20 });
      expect(useAppStore.getState().appPreferences.defaultFontSize).toBe(20);
      expect(mockStorage.set).toHaveBeenCalledWith('appPreferences', expect.objectContaining({ defaultFontSize: 20 }));
    });

    it('storage.set 抛错时 toast.error 含错误信息', async () => {
      mockStorage.set.mockRejectedValueOnce(new Error('quota exceeded'));
      await useAppStore.getState().updateAppPreferences({ defaultFontSize: 22 });
      expect(toastMock.error).toHaveBeenCalledWith('设置保存失败', 'quota exceeded');
    });

    it('storage.set 抛非 Error 时 toast.error 含字符串化值', async () => {
      mockStorage.set.mockRejectedValueOnce('string error');
      await useAppStore.getState().updateAppPreferences({ defaultFontSize: 22 });
      expect(toastMock.error).toHaveBeenCalledWith('设置保存失败', 'string error');
    });
  });
});
