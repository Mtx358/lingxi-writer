import { contextBridge, ipcRenderer } from 'electron';

const DEFAULT_TIMEOUT = 30000;

// 通用 IPC 调用 + 超时核心：超时后 reject 并调用 onTimeout 钩子让调用方触发主进程取消
// （如长任务 fetch 的 AbortController.abort()），避免长任务在后台继续运行占用资源。
// 取消逻辑由调用方注入（onTimeout），core 不内置任何 channel 特殊处理，
// 保证 invokeWithTimeoutCore 可被任意长任务 IPC 复用
function invokeWithTimeoutCore<T>(
  channel: string,
  timeout: number,
  args: unknown[],
  onTimeout?: () => void,
): Promise<T> {
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
    // 超时后调用 onTimeout 让调用方触发主进程取消，避免长任务继续运行占用资源
    // onTimeout 失败不影响 reject 路径（调用方已收到 timeout 错误）
    if (timedOut && onTimeout) {
      try { onTimeout(); } catch { /* onTimeout 失败不影响 reject 路径 */ }
    }
  });
}

function invokeWithTimeout<T>(channel: string, timeout: number = DEFAULT_TIMEOUT, ...args: unknown[]): Promise<T> {
  return invokeWithTimeoutCore<T>(channel, timeout, args);
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
    // 已限定 materials 子目录，见 main.ts storage:readFileBase64
    read: (key: string) => invokeWithTimeout('storage:read', 10000, key),
    write: (key: string, value: unknown) => invokeWithTimeout('storage:write', 10000, key, value),
    remove: (key: string) => invokeWithTimeout('storage:remove', 10000, key),
    listProjectDirs: () => invokeWithTimeout('storage:listProjectDirs', 5000),
    backupProject: (projectId: string, keepCount?: number) =>
      invokeWithTimeout('storage:backupProject', 60000, projectId, keepCount),
    readFileBase64: (filePath: string) => invokeWithTimeout('storage:readFileBase64', 15000, filePath),
    // 原子 patch projects 数组（add/remove/update/clear）：避免 storage:write 全量覆盖竞态
    patchProjects: (op: unknown) => invokeWithTimeout('storage:patchProjects', 15000, op),
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

  // 渲染层日志上报：把 catch 块 / window.onerror / unhandledrejection 转发到主进程 logger，
  // 与主进程日志统一落盘到 userData/logs/main.log，方便用户报障时提供完整日志
  logger: {
    write: (level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) =>
      ipcRenderer.invoke('logger:write', level, message, fields),
  },

  // 导出文件专用 IPC：路径白名单为用户可访问目录（home/Documents/Desktop/Downloads/userData），
  // 扩展名白名单为已知导出格式。与 file.write/writeBuffer（仅限 userData 内部数据）分离，
  // 让用户选择的导出路径能正常写入，同时保持内部数据通道的严格限制
  exportFile: {
    write: (filePath: string, data: string, encoding?: string) =>
      invokeWithTimeout('export:writeFile', 30000, filePath, data, encoding) as Promise<boolean>,
    writeBuffer: (filePath: string, base64Data: string) =>
      invokeWithTimeout('export:writeFileBuffer', 30000, filePath, base64Data) as Promise<boolean>,
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

      // 用 core 版本注入超时取消钩子：超时后主动通知主进程中止进行中的 fetch，
      // 释放后端资源并防止密钥请求继续在后台执行
      const promise = invokeWithTimeoutCore<string>(
        'ai:proxyStream',
        300000,
        [params],
        () => {
          if (params.requestId) {
            ipcRenderer.invoke('ai:abort', params.requestId).catch(() => {});
          }
        },
      );
      return { promise, cleanup };
    },
    abort: (requestId: string) => invokeWithTimeout('ai:abort', 5000, requestId),
    // 非流式 AI 请求代理：普通 invoke（返回 Promise），密钥只在主进程使用。
    // 与 proxyStream 对称，但不是事件驱动——主进程一次性返回 { ok, content | error }。
    // 用 invokeWithTimeoutCore 注入超时取消钩子：超时后通知主进程 ai:abort 中止 fetch
    proxyLLM: (params: {
      provider: string;
      baseUrl?: string;
      model?: string;
      temperature: number;
      maxTokens: number;
      prompt: string;
      systemPrompt?: string;
      requestId: string;
    }): Promise<{ ok: true; content: string } | { ok: false; error: string; status?: number }> => {
      return invokeWithTimeoutCore<{ ok: true; content: string } | { ok: false; error: string; status?: number }>(
        'ai:proxyLLM',
        60000,
        [params],
        () => {
          // 超时后主动通知主进程中止进行中的 fetch，释放后端资源
          if (params.requestId) {
            ipcRenderer.invoke('ai:abort', params.requestId).catch(() => {});
          }
        },
      );
    },
    // 专用 aiSettings 持久化 IPC：主进程内部校验 provider + 加密 apiKey 后落盘，
    // 替代 storage.write('aiSettings', ...)，防止 XSS 后任意覆写 apiKey
    saveSettings: (settings: unknown) => invokeWithTimeout('ai:saveSettings', 15000, settings) as Promise<boolean>,
    // 专用 aiSettings 读取 IPC：主进程内部解密 apiKey 后返回明文，
    // 替代 storage.read('aiSettings') + storage.decrypt，
    // 收敛 decrypt 能力到主进程，防止 XSS 解密其他加密字段
    loadSettings: () => invokeWithTimeout('ai:loadSettings', 10000) as Promise<unknown>,
  },
});