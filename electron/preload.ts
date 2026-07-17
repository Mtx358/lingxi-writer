import { contextBridge, ipcRenderer } from 'electron';

const DEFAULT_TIMEOUT = 30000;

function invokeWithTimeout<T>(channel: string, timeout: number = DEFAULT_TIMEOUT, ...args: unknown[]): Promise<T> {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args) as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout: ${channel}`)), timeout)
    ),
  ]);
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  
  projectFile: {
    read: (filePath: string) => invokeWithTimeout('projectFile:read', 30000, filePath),
    write: (filePath: string, data: unknown) => invokeWithTimeout('projectFile:write', 60000, filePath, data),
    validate: (filePath: string) => invokeWithTimeout('projectFile:validate', 10000, filePath),
    backup: (filePath: string, keepCount?: number) => invokeWithTimeout('projectFile:backup', 60000, filePath, keepCount),
    listBackups: (filePath: string) => invokeWithTimeout('projectFile:listBackups', 10000, filePath),
    restoreBackup: (backupPath: string, targetPath: string) => invokeWithTimeout('projectFile:restoreBackup', 30000, backupPath, targetPath),
    openDialog: () => invokeWithTimeout('projectFile:openDialog', 60000),
    saveDialog: (defaultName: string) => invokeWithTimeout('projectFile:saveDialog', 60000, defaultName),
  },
  
  storage: {
    read: (key: string) => invokeWithTimeout('storage:read', 10000, key),
    write: (key: string, value: unknown) => invokeWithTimeout('storage:write', 10000, key, value),
    remove: (key: string) => invokeWithTimeout('storage:remove', 10000, key),
    listProjectDirs: () => invokeWithTimeout('storage:listProjectDirs', 5000),
    backupProject: (projectId: string, keepCount?: number) =>
      invokeWithTimeout('storage:backupProject', 60000, projectId, keepCount),
    readFileBase64: (filePath: string) => invokeWithTimeout('storage:readFileBase64', 15000, filePath),
    encrypt: (plainText: string) => invokeWithTimeout('storage:encrypt', 5000, plainText),
    decrypt: (encryptedBase64: string) => invokeWithTimeout('storage:decrypt', 5000, encryptedBase64),
  },
  
  dialog: {
    selectFile: () => invokeWithTimeout('dialog:selectFile', 60000),
    saveFile: (defaultName: string, data: string, filterExt: string) =>
      invokeWithTimeout('dialog:saveFile', 60000, defaultName, data, filterExt),
  },
  
  file: {
    write: (filePath: string, data: string, encoding?: string) =>
      invokeWithTimeout('storage:writeFile', 30000, filePath, data, encoding),
    writeBuffer: (filePath: string, base64Data: string) =>
      invokeWithTimeout('storage:writeFileBuffer', 30000, filePath, base64Data),
    openExternal: (filePath: string) => invokeWithTimeout('file:openExternal', 10000, filePath),
  },

  // 素材附件：复制源文件到项目数据目录，返回持久化路径
  material: {
    saveAttachment: (sourcePath: string, projectId: string, attachmentId: string) =>
      invokeWithTimeout('material:saveAttachment', 60000, sourcePath, projectId, attachmentId) as Promise<string | null>,
  },

  system: {
    checkCrashRecovery: () => invokeWithTimeout('system:checkCrashRecovery', 15000),
  },

  // AI 请求代理：密钥只在主进程使用，渲染层通过 IPC 调用
  ai: {
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
    ): { promise: Promise<string>; cleanup: () => void } => {
      const { requestId } = params;
      const chunkChannel = `ai:stream:chunk:${requestId}`;
      const doneChannel = `ai:stream:done:${requestId}`;
      const errorChannel = `ai:stream:error:${requestId}`;

      const chunkHandler = (_e: unknown, data: string) => onChunk(data);
      const doneHandler = (_e: unknown, data: string) => {
        cleanup();
        onDone(data);
      };
      const errorHandler = (_e: unknown, data: string) => {
        cleanup();
        onError(data);
      };
      const cleanup = () => {
        ipcRenderer.removeListener(chunkChannel, chunkHandler);
        ipcRenderer.removeListener(doneChannel, doneHandler);
        ipcRenderer.removeListener(errorChannel, errorHandler);
      };

      ipcRenderer.on(chunkChannel, chunkHandler);
      ipcRenderer.on(doneChannel, doneHandler);
      ipcRenderer.on(errorChannel, errorHandler);

      const promise = invokeWithTimeout<string>('ai:proxyStream', 300000, params);
      return { promise, cleanup };
    },
    abort: (requestId: string) => invokeWithTimeout('ai:abort', 5000, requestId),
  },
});