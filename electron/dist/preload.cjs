"use strict";

// electron/preload.ts
var import_electron = require("electron");
var DEFAULT_TIMEOUT = 3e4;
function invokeWithTimeoutCore(channel, timeout, args, onTimeout) {
  let timedOut = false;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error(`IPC timeout: ${channel}`));
    }, timeout);
  });
  const invokePromise = import_electron.ipcRenderer.invoke(channel, ...args);
  return Promise.race([invokePromise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
    if (timedOut && onTimeout) {
      try {
        onTimeout();
      } catch {
      }
    }
  });
}
function invokeWithTimeout(channel, timeout = DEFAULT_TIMEOUT, ...args) {
  return invokeWithTimeoutCore(channel, timeout, args);
}
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  projectFile: {
    read: (filePath) => invokeWithTimeout("projectFile:read", 3e4, filePath),
    write: (filePath, data) => invokeWithTimeout("projectFile:write", 6e4, filePath, data),
    validate: (filePath) => invokeWithTimeout("projectFile:validate", 1e4, filePath),
    backup: (filePath, keepCount) => invokeWithTimeout("projectFile:backup", 6e4, filePath, keepCount),
    listBackups: (filePath) => invokeWithTimeout("projectFile:listBackups", 1e4, filePath),
    restoreBackup: (backupPath, targetPath) => invokeWithTimeout("projectFile:restoreBackup", 3e4, backupPath, targetPath),
    openDialog: () => invokeWithTimeout("projectFile:openDialog", 6e4),
    saveDialog: (defaultName) => invokeWithTimeout("projectFile:saveDialog", 6e4, defaultName)
  },
  storage: {
    // 已限定 materials 子目录，见 main.ts storage:readFileBase64
    read: (key) => invokeWithTimeout("storage:read", 1e4, key),
    write: (key, value) => invokeWithTimeout("storage:write", 1e4, key, value),
    remove: (key) => invokeWithTimeout("storage:remove", 1e4, key),
    listProjectDirs: () => invokeWithTimeout("storage:listProjectDirs", 5e3),
    backupProject: (projectId, keepCount) => invokeWithTimeout("storage:backupProject", 6e4, projectId, keepCount),
    readFileBase64: (filePath) => invokeWithTimeout("storage:readFileBase64", 15e3, filePath),
    // 原子 patch projects 数组（add/remove/update/clear）：避免 storage:write 全量覆盖竞态
    patchProjects: (op) => invokeWithTimeout("storage:patchProjects", 15e3, op)
  },
  dialog: {
    selectFile: () => invokeWithTimeout("dialog:selectFile", 6e4),
    saveFile: (defaultName, data, filterExt) => invokeWithTimeout("dialog:saveFile", 6e4, defaultName, data, filterExt)
  },
  file: {
    write: (filePath, data, encoding) => invokeWithTimeout("storage:writeFile", 3e4, filePath, data, encoding),
    writeBuffer: (filePath, base64Data) => invokeWithTimeout("storage:writeFileBuffer", 3e4, filePath, base64Data),
    openExternal: (filePath) => invokeWithTimeout("file:openExternal", 1e4, filePath),
    // 读取素材附件为 data URL（主进程校验路径须位于 userData 内），供 <img src> 渲染
    readDataURL: (filePath) => invokeWithTimeout("file:readDataURL", 15e3, filePath)
  },
  // 素材附件：复制源文件到项目数据目录，返回持久化路径
  material: {
    saveAttachment: (sourcePath, projectId, attachmentId) => invokeWithTimeout("material:saveAttachment", 6e4, sourcePath, projectId, attachmentId),
    // 删除磁盘副本；主进程会校验路径必须位于 materials/ 子目录内，越权路径返回 false
    deleteAttachment: (targetPath) => invokeWithTimeout("material:deleteAttachment", 15e3, targetPath)
  },
  system: {
    checkCrashRecovery: () => invokeWithTimeout("system:checkCrashRecovery", 15e3)
  },
  // 渲染层日志上报：把 catch 块 / window.onerror / unhandledrejection 转发到主进程 logger，
  // 与主进程日志统一落盘到 userData/logs/main.log，方便用户报障时提供完整日志
  logger: {
    write: (level, message, fields) => import_electron.ipcRenderer.invoke("logger:write", level, message, fields)
  },
  // 导出文件专用 IPC：路径白名单为用户可访问目录（home/Documents/Desktop/Downloads/userData），
  // 扩展名白名单为已知导出格式。与 file.write/writeBuffer（仅限 userData 内部数据）分离，
  // 让用户选择的导出路径能正常写入，同时保持内部数据通道的严格限制
  exportFile: {
    write: (filePath, data, encoding) => invokeWithTimeout("export:writeFile", 3e4, filePath, data, encoding),
    writeBuffer: (filePath, base64Data) => invokeWithTimeout("export:writeFileBuffer", 3e4, filePath, base64Data)
  },
  // AI 请求代理：密钥只在主进程使用，渲染层通过 IPC 调用
  ai: {
    proxyStream: (params, onChunk, onDone, onError) => {
      const { requestId } = params;
      const chunkChannel = `ai:stream:chunk:${requestId}`;
      const doneChannel = `ai:stream:done:${requestId}`;
      const errorChannel = `ai:stream:error:${requestId}`;
      const chunkHandler = (_e, data) => onChunk(data);
      const doneHandler = (_e, data) => {
        cleanup();
        onDone(data);
      };
      const errorHandler = (_e, data) => {
        cleanup();
        onError(data);
      };
      const cleanup = () => {
        import_electron.ipcRenderer.removeListener(chunkChannel, chunkHandler);
        import_electron.ipcRenderer.removeListener(doneChannel, doneHandler);
        import_electron.ipcRenderer.removeListener(errorChannel, errorHandler);
        import_electron.ipcRenderer.invoke("ai:abort", requestId).catch(() => {
        });
      };
      import_electron.ipcRenderer.on(chunkChannel, chunkHandler);
      import_electron.ipcRenderer.on(doneChannel, doneHandler);
      import_electron.ipcRenderer.on(errorChannel, errorHandler);
      const promise = invokeWithTimeoutCore(
        "ai:proxyStream",
        3e5,
        [params],
        () => {
          if (params.requestId) {
            import_electron.ipcRenderer.invoke("ai:abort", params.requestId).catch(() => {
            });
          }
        }
      );
      return { promise, cleanup };
    },
    abort: (requestId) => invokeWithTimeout("ai:abort", 5e3, requestId),
    // 非流式 AI 请求代理：普通 invoke（返回 Promise），密钥只在主进程使用。
    // 与 proxyStream 对称，但不是事件驱动——主进程一次性返回 { ok, content | error }。
    // 用 invokeWithTimeoutCore 注入超时取消钩子：超时后通知主进程 ai:abort 中止 fetch
    proxyLLM: (params) => {
      return invokeWithTimeoutCore(
        "ai:proxyLLM",
        6e4,
        [params],
        () => {
          if (params.requestId) {
            import_electron.ipcRenderer.invoke("ai:abort", params.requestId).catch(() => {
            });
          }
        }
      );
    },
    // 专用 aiSettings 持久化 IPC：主进程内部校验 provider + 加密 apiKey 后落盘，
    // 替代 storage.write('aiSettings', ...)，防止 XSS 后任意覆写 apiKey
    saveSettings: (settings) => invokeWithTimeout("ai:saveSettings", 15e3, settings),
    // 专用 aiSettings 读取 IPC：主进程内部解密 apiKey 后返回明文，
    // 替代 storage.read('aiSettings') + storage.decrypt，
    // 收敛 decrypt 能力到主进程，防止 XSS 解密其他加密字段
    loadSettings: () => invokeWithTimeout("ai:loadSettings", 1e4)
  }
});
