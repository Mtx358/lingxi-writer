/// <reference types="vite/client" />

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
  remove: (key: string) => Promise<boolean>;
  listProjectDirs: () => Promise<string[]>;
  backupProject: (projectId: string, keepCount?: number) => Promise<boolean>;
  readFileBase64: (filePath: string) => Promise<string | null>;
  encrypt: (plainText: string) => Promise<string | null>;
  decrypt: (encryptedBase64: string) => Promise<string | null>;
}

interface ElectronDialogAPI {
  selectFile: () => Promise<{ path: string; name: string; size: number; ext: string } | null>;
  saveFile: (defaultName: string, data: string, filterExt: string) => Promise<string | null>;
}

interface ElectronFileAPI {
  write: (filePath: string, data: string, encoding?: string) => Promise<boolean>;
  writeBuffer: (filePath: string, base64Data: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
}

interface ElectronMaterialAPI {
  /** 复制源文件到项目数据目录，返回持久化后的绝对路径；失败返回 null */
  saveAttachment: (sourcePath: string, projectId: string, attachmentId: string) => Promise<string | null>;
}

interface ElectronSystemAPI {
  checkCrashRecovery: () => Promise<{ recovered: boolean; projects: string[] }>;
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
  abort: (requestId: string) => Promise<boolean>;
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
  ai: ElectronAIAPI;
}

interface Window {
  electronAPI?: ElectronAPI;
}