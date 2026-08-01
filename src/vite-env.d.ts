/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

interface ElectronProjectFileAPI {
  read: (filePath: string) => Promise<{
    success: boolean;
    error?: string;
    data?: {
      project: unknown;
      chapters: unknown[];
      characters: unknown[];
      settingCategories: unknown[];
      settingItems: unknown[];
      foreshadows: unknown[];
      materials: unknown[];
      versions: Record<string, unknown[]>;
    };
  }>;
  write: (filePath: string, data: unknown) => Promise<{ success: boolean; error?: string }>;
  validate: (filePath: string) => Promise<{ valid: boolean; error?: string }>;
  backup: (filePath: string, keepCount?: number) => Promise<{ success: boolean; error?: string }>;
  listBackups: (filePath: string) => Promise<{ success: boolean; backups?: { name: string; path: string; timestamp: string }[]; error?: string }>;
  restoreBackup: (backupPath: string, targetPath: string) => Promise<{ success: boolean; error?: string }>;
  openDialog: () => Promise<string | null>;
  saveDialog: (defaultName: string) => Promise<string | null>;
}

interface ElectronStorageAPI {
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<boolean>;
  // 批量写入：一次 IPC 写入多个 key，把 8 次 storage:write 合并成 1 次，
  // 避免触发令牌桶限流。返回 Record<key, boolean> 标识每个 key 的结果
  writeBatch: (entries: Record<string, unknown>) => Promise<Record<string, boolean>>;
  // 批量读取：一次 IPC 读取多个 key，把 openProject 的 14 次 storage:read 合并成 1 次，
  // 避免触发 storage:read 令牌桶限流（capacity=10 < 14）。返回 Record<key, value>，失败 key 值为 null
  readBatch: (keys: string[]) => Promise<Record<string, unknown>>;
  remove: (key: string) => Promise<boolean>;
  listProjectDirs: () => Promise<string[]>;
  backupProject: (projectId: string, keepCount?: number) => Promise<boolean>;
  readFileBase64: (filePath: string) => Promise<string | null>;
  // 原子 patch projects 数组：add/remove/update/clear，返回新数组让渲染层同步内存
  // op.project 用 unknown：vite-env.d.ts 是全局声明文件不便 import 业务类型，
  // storage.ts 的 StorageAPI.patchProjects 提供带 Project 类型的精确签名
  patchProjects: (op:
    | { type: 'add'; project: unknown }
    | { type: 'remove'; id: string }
    | { type: 'update'; project: unknown }
    | { type: 'clear' }
  ) => Promise<unknown[] | null>;
}

interface ElectronDialogAPI {
  selectFile: () => Promise<{ path: string; name: string; size: number; ext: string } | null>;
  saveFile: (defaultName: string, data: string, filterExt: string) => Promise<string | null>;
}

interface ElectronFileAPI {
  write: (filePath: string, data: string, encoding?: string) => Promise<boolean>;
  writeBuffer: (filePath: string, base64Data: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
  /** 读取素材附件为 data URL（主进程校验路径须位于 userData 内） */
  readDataURL: (filePath: string) => Promise<string>;
}

interface ElectronMaterialAPI {
  /** 复制源文件到项目数据目录，返回持久化后的绝对路径；失败返回 null */
  saveAttachment: (sourcePath: string, projectId: string, attachmentId: string) => Promise<string | null>;
  /** 删除磁盘副本；主进程校验路径必须位于 materials/ 子目录内，越权或失败返回 false */
  deleteAttachment: (targetPath: string) => Promise<boolean>;
}

interface ElectronSystemAPI {
  checkCrashRecovery: () => Promise<{ recovered: boolean; projects: string[] }>;
}

interface ElectronLoggerAPI {
  /** 渲染层日志转发到主进程 logger（落盘 userData/logs/main.log） */
  write: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    fields?: Record<string, unknown>,
  ) => Promise<void>;
}

interface ElectronExportFileAPI {
  /** 写入文本导出文件（路径须位于用户可访问目录 + 扩展名在白名单内） */
  write: (filePath: string, data: string, encoding?: string) => Promise<boolean>;
  /** 写入二进制导出文件（base64 编码，路径须位于用户可访问目录 + 扩展名在白名单内） */
  writeBuffer: (filePath: string, base64Data: string) => Promise<boolean>;
}

interface ElectronAIAPI {
  proxyStream: (
    params: {
      provider: string;
      baseUrl?: string;
      model?: string;
      messages: { role: string; content: string }[];
      temperature: number;
      maxTokens: number;
      requestId: string;
    },
    onChunk: (chunk: string) => void,
    onDone: (fullContent: string) => void,
    onError: (error: string) => void,
  ) => { promise: Promise<string>; cleanup: () => void };
  // 非流式 AI 请求代理：普通 invoke（返回 Promise），密钥只在主进程使用。
  // 入参不含 apiKey，主进程内部从加密存储解密取密钥
  proxyLLM: (params: {
    provider: string;
    baseUrl?: string;
    model?: string;
    temperature: number;
    maxTokens: number;
    prompt: string;
    systemPrompt?: string;
    requestId: string;
  }) => Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }>;
  abort: (requestId: string) => Promise<boolean>;
  // 专用 aiSettings 持久化：主进程校验 provider + 加密 apiKey 后落盘
  // settings 用精确的 6 字段签名，AISettings 的额外 UI 偏好字段可结构子类型传入
  saveSettings: (settings: {
    apiKey: string;
    provider: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    [key: string]: unknown;
  }) => Promise<boolean>;
  // 专用 aiSettings 读取：主进程内部解密 apiKey 后返回明文，收敛 decrypt 能力
  // 返回 unknown：vite-env.d.ts 是全局声明文件不便 import AISettings 类型，
  // storage.ts 的 StorageAPI.loadAISettings 提供带 AISettings 类型的精确签名
  loadSettings: () => Promise<unknown>;
}

interface ElectronAPI {
  platform: string;
  versions: { node: string; chrome: string; electron: string };
  projectFile: ElectronProjectFileAPI;
  storage: ElectronStorageAPI;
  dialog: ElectronDialogAPI;
  file: ElectronFileAPI;
  material: ElectronMaterialAPI;
  system: ElectronSystemAPI;
  logger: ElectronLoggerAPI;
  exportFile: ElectronExportFileAPI;
  ai: ElectronAIAPI;
}

interface Window {
  electronAPI?: ElectronAPI;
}