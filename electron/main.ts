// Electron 主进程入口：应用生命周期、安全初始化、handler 注册编排。
// 各业务 handler 已拆分到 ./handlers/* 模块，本文件仅负责顶层常量、安全初始化、
// 主流程调用，以及为兼容 main.test.ts 的 `from './main'` 导入做 re-export。
//
// 拆分原则：shared.ts 不依赖其他 handler；security.ts 仅依赖 shared；
// 其他 handler 依赖 shared/security；本入口依赖所有 handler 与 shared。
import { app, BrowserWindow, session, crashReporter } from 'electron';
import path from 'node:path';
import { logger } from './logger';
import {
  clearRateLimitAuditTimers,
  setQuitting,
  awaitPendingWrites,
  getMainWindow,
} from './handlers/shared';
import {
  registerProjectFileHandlers,
} from './handlers/projectFile';
import {
  registerStorageHandlers,
} from './handlers/storage';
import {
  registerAIProxyHandlers,
  registerAISettingsHandlers,
  abortAllAIRequests,
} from './handlers/aiProxy';
import { registerLoggerHandlers } from './handlers/logger';
import { registerExportFileHandlers } from './handlers/exportFile';
import {
  registerBackupHandlers,
  startAutoBackup,
  stopAutoBackup,
  cleanupAllTmpSync,
} from './handlers/backup';
import { createMenu, createWindow } from './handlers/window';

// ============ 测试用 API re-export ============
// main.test.ts 通过 `from './main'` 导入下列 10 个纯函数。这些函数的实现已迁至
// ./handlers/security.ts，此处 re-export 保持外部导入路径不变，避免修改测试。
export {
  isSafeIdentifier,
  isInsideDataDir,
  isValidProjectFileData,
  isSafeProjectFilePath,
  isSafeExportFilePath,
  isSafeBackupPath,
  resolveRealPath,
  assertRealPathInside,
  validateAIProxyParams,
  validateAIProxyLLMParams,
} from './handlers/security';

// CommonJS 模式下 __dirname 由 Node 原生提供，无需 fileURLToPath(import.meta.url)。
// 后者在 asar 内行为不稳定，且 ESM preload 在 sandbox:true 下会加载失败导致应用白屏。

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_ELECTRON = path.join(__dirname, '..');
const DIST_RENDERER = path.join(DIST_ELECTRON, '..', 'dist');

// 单实例锁：防止多实例同时写入 userData 造成数据损坏或备份竞争
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 已有实例运行，直接退出当前进程
  app.quit();
} else {
  app.on('second-instance', () => {
    // 用户尝试启动第二个实例：聚焦到主窗口
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ============ 顶层错误兜底（H1 + H3）============
  // 主进程未捕获的同步异常与 Promise rejection：Electron 默认仅打印到 stderr，
  // 生产环境用户机器无 devtools 可见，发生崩溃后无法定位。
  // 此处统一捕获到 logger（落盘 userData/logs/main.log，5MB × 3 轮转），
  // 让用户报障时能提供日志文件辅助定位。
  //
  // 不主动 app.exit(1)：非致命异常（如某个 IPC handler 内 await 链未兜底）不应让整个应用崩溃，
  // 用户仍可继续操作其他功能；致命异常（如主窗口销毁）由 Electron 自身处理。
  //
  // 必须在 app.whenReady 之前注册：whenReady 是异步的，注册期间抛错也需要被捕获
  process.on('uncaughtException', (err) => {
    try {
      logger.error('uncaughtException', err);
    } catch {
      // logger 自身失败（如磁盘满）时回退到 stderr，避免兜底路径再次抛错
      console.error('[FALLBACK] uncaughtException:', err);
    }
  });
  process.on('unhandledRejection', (reason) => {
    try {
      // reason 可能是任意值（含 Error / 对象 / 原始类型），统一字符串化避免 logger.formatValue 出错
      logger.error('unhandledRejection', {
        reason: reason instanceof Error
          ? `${reason.name}: ${reason.message}\n${reason.stack || ''}`
          : String(reason),
      });
    } catch {
      console.error('[FALLBACK] unhandledRejection:', reason);
    }
  });

  // ============ 原生崩溃上报（crashReporter）============
  // uncaughtException / unhandledRejection 仅能捕获 JS 层异常，native crash
  // （主进程 segfault / 渲染进程 OOM 或 native 模块崩溃）不会被 process.on 捕获，
  // 需要 Electron 内置的 crashReporter 把 minidump 落盘。
  //
  // dump 目录设为 userData/logs/crashes，与 main.log 同级，方便用户报障时一次性打包
  // logs 目录（含 main.log + crashes/*.dmp）。
  //
  // 必须在 app.whenReady 之前调用：crashReporter.start 越早注册越能捕获启动早期崩溃；
  // app.setPath('crashDumps', ...) 同样可在 ready 前调用。用 try/catch 包裹防止
  // crashReporter 自身在某些平台/环境下抛错导致应用无法启动（如无 dump 写权限）。
  try {
    app.setPath('crashDumps', path.join(app.getPath('userData'), 'logs', 'crashes'));
    // 本地写作应用无自建 crash 收集服务，仅本地落盘，不上传远端
    crashReporter.start({ uploadToServer: false });
  } catch (err) {
    console.error('[FALLBACK] crashReporter.start failed:', err);
  }

  app.whenReady().then(() => {
    // 初始化结构化日志器：写入 userData/logs/main.log（带 5MB × 3 份轮转）
    // 在注册 IPC handler 之前完成，确保后续 audit 日志能落盘
    logger.setLogDir(path.join(app.getPath('userData'), 'logs'));
    logger.info('app ready', { platform: process.platform, version: app.getVersion() });
    // 记录 native crash dump 落盘路径，方便报障时指引用户提交该目录下的 .dmp 文件
    logger.info('crashDumps path', { path: app.getPath('crashDumps') });

    registerProjectFileHandlers();
    registerStorageHandlers();
    registerAIProxyHandlers();
    registerAISettingsHandlers();
    registerBackupHandlers();
    registerLoggerHandlers();
    registerExportFileHandlers();
    createMenu();
    createWindow({ devServerUrl: VITE_DEV_SERVER_URL, distRenderer: DIST_RENDERER });

    // 启动自动备份（每 5 分钟备份一次所有项目）
    startAutoBackup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow({ devServerUrl: VITE_DEV_SERVER_URL, distRenderer: DIST_RENDERER });
      }
    });
  });
}

// 应用退出前清理：等待 pending writes 完成，避免用户最后一条 save 还在 mutex 队列里
// 就被进程退出截断，导致 .tmp 残留 / 主文件未 rename / 数据丢失。
// event.preventDefault 让 Electron 暂停退出流程，await 完成后再 app.exit(0) 主动触发。
// 注：app.exit 不再触发 before-quit / will-quit，故 tmp 清理在 finally 内同步完成。
// 安全超时 5s：极端情况（NFS 慢盘 / fs.rename 卡死）下避免应用永远退不出
let isQuittingInProgress = false;
let forceQuitTimer: ReturnType<typeof setTimeout> | null = null;
app.on('before-quit', (event) => {
  // 已进入退出流程（本次 before-quit 由 app.exit(0) 触发或外部再次调用）：放行
  if (isQuittingInProgress) return;
  isQuittingInProgress = true;
  setQuitting(true);

  // 清理自动备份计时器
  stopAutoBackup();
  // 清理 rate-limit audit 节流 timers，防内存泄漏
  clearRateLimitAuditTimers();
  // 中止所有进行中的 AI 请求，避免 fetch 句柄悬挂
  abortAllAIRequests();

  // 清理 session 缓存数据（NEW-11 MEDIUM）：defaultSession 默认持久化到 userData/Cache、
  // Cookies、Local Storage 等。AI 接口返回的 Set-Cookie 会持久化并在下次启动自动携带，
  // 可能被用作追踪标识；缓存中可能含 AI 响应片段等敏感数据。
  // clearStorageData 异步，但在 app.exit(0) 之前 await pending writes 期间可完成。
  // 不清理 indexdb / localstorage / filesystem：应用自身持久化数据（recovery_draft 等）
  // 通过 storage:write 落盘到 userData/ 根目录，与 session 的 Local Storage 是不同存储
  void session.defaultSession.clearStorageData({
    storages: ['cookies', 'shadercache', 'serviceworkers', 'cachestorage'],
  }).catch((e) => {
    logger.warn('Quit: clearStorageData failed', { error: (e as Error).message });
  });

  // 阻止默认退出，等 pending writes 完成
  event.preventDefault();

  // 安全超时：5s 后强制退出，避免写入卡死导致应用无法退出
  forceQuitTimer = setTimeout(() => {
    logger.warn('Quit: force exit after 5s timeout, pending writes may be lost');
    cleanupAllTmpSync();
    app.exit(0);
  }, 5000);

  void awaitPendingWrites().finally(() => {
    if (forceQuitTimer) { clearTimeout(forceQuitTimer); forceQuitTimer = null; }
    // 同步清理本会话残留 .tmp：app.exit 不触发 will-quit，cleanup 必须在此完成
    cleanupAllTmpSync();
    app.exit(0);
  });
});

// will-quit：进程即将退出的最后一刻（仅 normal quit 路径会触发，app.exit 不触发）。
// 作为兜底：若外部代码（如 auto updater restart）走 app.quit() 而非 app.exit()，
// 此处仍能清理 tmp。before-quit 内的 cleanupAllTmpSync 是主路径
app.on('will-quit', () => {
  cleanupAllTmpSync();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
