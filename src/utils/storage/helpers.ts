import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';

/**
 * storage 模块的纯工具函数与类型定义。
 *
 * 这些函数/类型无副作用、不依赖 storage 单例，可被 localStorageAdapter /
 * electronBridge / projectsStore 等子模块自由引用，避免循环依赖。
 */

// 判断是否为 localStorage 配额超限错误（不同浏览器抛出 DOMException 或 QuotaExceededError）
export const isQuotaError = (e: unknown): boolean => {
  if (e instanceof DOMException) {
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22;
  }
  return e instanceof Error && /quota/i.test(e.name);
};

// recoveryDraft 过期时间：7 天（毫秒）。
// 超过此时间的草稿视为陈旧（用户可能已切换项目或不再需要），加载时自动清除。
// 7 天平衡：覆盖长假/出差场景，又不会让数月前的草稿无限残留占用存储
export const RECOVERY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 校验 recoveryDraft 是否过期：timestamp 是 ISO 字符串，解析后与当前时间比较。
// 解析失败（非法格式）视为过期，触发清除避免脏数据残留
export const isRecoveryDraftExpired = (timestamp: unknown): boolean => {
  if (typeof timestamp !== 'string') return true;
  try {
    const ts = new Date(timestamp).getTime();
    if (isNaN(ts)) return true;
    return Date.now() - ts > RECOVERY_DRAFT_TTL_MS;
  } catch {
    return true;
  }
};

// 模块级计数器，保证短时间批量调用也不会冲突
let idCounter = 0;

export const generateId = (): string => {
  // 优先使用原生 UUID（唯一性最佳，且不依赖时间戳）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 回退：时间戳 + 随机 + 自增计数器，避免 .substr 废弃 API 与批量调用冲突
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + (idCounter++).toString(36);
};

export const formatDate = (date: string): string => {
  const d = new Date(date);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const countWords = (html: string): number => {
  // 去除 HTML 标签与空白；按中英文混合场景统一统计：
  // - 中日韩字符（含全角标点）每个字符计 1 字
  // - 英文/数字按单词计（连续字母数字序列视为一个单词）
  // 与常规写作字数统计习惯一致，避免英文被拆成单字母导致字数虚高。
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  let count = 0;
  // CJK 统一表意文字、扩展 A 区、日文假名、全角标点等
  const cjkRe = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFFEF]/g;
  const cjkMatches = text.match(cjkRe);
  if (cjkMatches) count += cjkMatches.length;
  // 去掉 CJK 后剩余部分按拉丁字母/数字单词计数
  const nonCjk = text.replace(cjkRe, '');
  const wordMatches = nonCjk.match(/[A-Za-z0-9]+/g);
  if (wordMatches) count += wordMatches.length;
  return count;
};

export const isElectron = (): boolean => {
  return window.electronAPI !== undefined;
};

/**
 * Storage 后端统一接口。
 *
 * ElectronStorage 与 LocalStorage 均实现此接口，上层通过 storage 单例调用，
 * 不感知具体后端。新增存储能力时优先扩展此接口而非具体类，保持后端可替换。
 */
export interface StorageAPI {
  get: <T>(key: string, defaultValue: T) => Promise<T>;
  set: <T>(key: string, value: T) => Promise<void>;
  // 批量写入：一次 IPC 写入多个 key，把一次项目保存的 8 次 storage.set 合并为 1 次 IPC，
  // 既减少往返延迟，又从根本上避免触发 storage:write 令牌桶限流。
  // 任一 key 写入失败时通过 toast 告知用户，但不会中断其他 key 的写入
  setMany: (entries: Record<string, unknown>) => Promise<void>;
  // 批量读取：一次 IPC 读取多个 key，把 openProject 的 14 次 storage.get 合并为 1 次 IPC，
  // 避免触发 storage:read 令牌桶限流（capacity=10 < 14）。返回 Record<key, value>，
  // 读取失败或 key 不存在的值为 null，由调用方按 key 取值并用默认值回退
  getMany: (keys: string[]) => Promise<Record<string, unknown>>;
  remove: (key: string) => Promise<void>;

  readProjectFile: (filePath: string) => Promise<{
    project: Project;
    chapters: Chapter[];
    characters: Character[];
    settingCategories: SettingCategory[];
    settingItems: SettingItem[];
    foreshadows: Foreshadow[];
    materials: Material[];
    versions: Record<string, ChapterVersion[]>;
  } | null>;

  writeProjectFile: (
    filePath: string,
    project: Project,
    chapters: Chapter[],
    characters: Character[],
    settingCategories: SettingCategory[],
    settingItems: SettingItem[],
    foreshadows: Foreshadow[],
    materials: Material[],
    versions: Record<string, ChapterVersion[]>
  ) => Promise<boolean>;

  backupProjectFile: (filePath: string, keepCount?: number) => Promise<boolean>;
  listBackups: (filePath: string) => Promise<{ name: string; path: string; timestamp: string }[]>;
  restoreBackup: (backupPath: string, targetPath: string) => Promise<boolean>;

  openFileDialog: () => Promise<string | null>;
  saveFileDialog: (defaultName: string) => Promise<string | null>;

  checkForRecovery: () => Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null>;
  saveRecoveryDraft: (projectId: string, chapterId: string, content: string) => Promise<void>;
  loadRecoveryDraft: () => Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null>;
  clearRecoveryDraft: () => Promise<void>;

  // 专用 aiSettings 持久化：主进程内部校验 provider + 加密 apiKey 后落盘，
  // 替代 storage.set('aiSettings', ...)，防止 XSS 后任意覆写 apiKey
  // settings 入参为明文 apiKey（主进程内部加密），AISettings 额外 UI 偏好字段可一并传入
  saveAISettings: (settings: {
    apiKey: string;
    provider: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    [key: string]: unknown;
  }) => Promise<boolean>;

  // 专用 aiSettings 读取：主进程内部解密 apiKey 后返回明文，替代
  // storage.get('aiSettings') + storage.decrypt，收敛 decrypt 能力到主进程，
  // 防止渲染层被 XSS 后解密其他加密字段（虽然当前仅 aiSettings 用 safeStorage，
  // 但 decrypt 入口收敛可防止未来误用）。返回 null 表示文件不存在或读取失败
  loadAISettings: () => Promise<{
    apiKey: string;
    provider: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    [key: string]: unknown;
  } | null>;

  // 原子 patch projects 数组：add/remove/update/clear，返回新数组让渲染层同步内存。
  // 替代 storage.set('projects', ...) 全量覆盖，避免 read → push → write 竞态丢失项目
  patchProjects: (op:
    | { type: 'add'; project: Project }
    | { type: 'remove'; id: string }
    | { type: 'update'; project: Project }
    | { type: 'clear' }
  ) => Promise<Project[] | null>;
}
