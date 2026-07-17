import { contextBridge, ipcRenderer } from 'electron';

const DEFAULT_TIMEOUT = 30000;

function invokeWithTimeout<T>(channel: string, timeout: number = DEFAULT_TIMEOUT, ...args: unknown[]): Promise<T> {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error(`IPC timeout: ${channel}`));
    }, timeout);
  });
  const invokePromise = ipcRenderer.invoke(channel, ...args) as Promise<T>;
  return Promise.race([invokePromise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
    // 超时后主动取消主进程进行中的 IPC 操作，
    // 否则 ai:proxyStream 这类长任务会继续运行占用资源并泄露密钥请求
    if (timedOut && channel === 'ai:proxyStream') {
      const params = args[0] as { requestId?: string } | undefined;
      if (params?.requestId) {
        ipcRenderer.invoke('ai:abort', params.requestId).catch(() => {});
      }
    }
  });
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
    // TODO 安全收敛：readFileBase64 当前允许读取 userData 下任意文件，
    // 后续应限定为 materials/ 子目录或显式 token 化，防止读取其他模块的敏感配置
    read: (key: string) => invokeWithTimeout('storage:read', 10000, key),
    write: (key: string, value: unknown) => invokeWithTimeout('storage:write', 10000, key, value),
    remove: (key: string) => invokeWithTimeout('storage:remove', 10000, key),
    listProjectDirs: () => invokeWithTimeout('storage:listProjectDirs', 5000),
    backupProject: (projectId: string, keepCount?: number) =>
      invokeWithTimeout('storage:backupProject', 60000, projectId, keepCount),
    readFileBase64: (filePath: string) => invokeWithTimeout('storage:readFileBase64', 15000, filePath),
    // TODO 安全收敛：encrypt/decrypt 当前未限定用途，
    // 后续应限定为 aiSettings 相关字段（apiKey），避免渲染层用它加密任意数据落盘
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
    // 读取素材附件为 data URL（主进程校验路径须位于 userData 内），供 <img src> 渲染
    readDataURL: (filePath: string) => invokeWithTimeout('file:readDataURL', 15000, filePath) as Promise<string>,
  },

  // 素材附件：复制源文件到项目数据目录，返回持久化路径
  material: {
    saveAttachment: (sourcePath: string, projectId: string, attachmentId: string) =>
      invokeWithTimeout('material:saveAttachment', 60000, sourcePath, projectId, attachmentId) as Promise<string | null>,
    // 删除磁盘副本；主进程会校验路径必须位于 materials/ 子目录内，越权路径返回 false
    deleteAttachment: (targetPath: string) =>
      invokeWithTimeout('material:deleteAttachment', 15000, targetPath) as Promise<boolean>,
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
        // 主动通知主进程中止进行中的 fetch，释放后端资源，
        // 避免 cleanup 后流仍在后台写入 chunk 通道
        ipcRenderer.invoke('ai:abort', requestId).catch(() => {});
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