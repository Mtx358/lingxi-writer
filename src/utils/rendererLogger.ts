// 渲染层日志：同时输出 console + 转发到主进程 logger 落盘
//
// 背景：生产构建 devTools=isDev，用户无 devtools，console.error 不可见；
// main.tsx 的 forwardLog 只能捕获 unhandledrejection / window.error 全局事件，
// catch 块内的 console.error 不会触发全局事件被"吞掉"。本模块把 catch 块内的
// 错误显式转发到主进程 logger，与主进程日志统一落盘到 userData/logs/main.log，
// 方便用户报障时提供完整日志。
//
// 设计约束：
// - logger.write 返回 Promise<void>，必须接 .catch 防 unhandledrejection（与 main.tsx 一致）
// - 失败时静默：日志转发本身不应成为新的错误源（如主进程未启动时 IPC 会 reject）
// - LogLevel 取 'error' | 'warn' | 'info'（业务侧使用），是 ElectronLoggerAPI
//   'debug' | 'info' | 'warn' | 'error' 的子集，类型兼容
type LogLevel = 'error' | 'warn' | 'info';

function forward(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(message, extra ?? '');
  try {
    // ?.catch 静默：避免主进程未就绪时 IPC reject 又产生新的 unhandledrejection
    window.electronAPI?.logger?.write(level, message, extra)?.catch(() => { /* 静默 */ });
  } catch {
    /* 静默 */
  }
}

/**
 * 记录 error 级别日志：同时输出 console.error 并转发到主进程 logger 落盘。
 * @param message 简短描述（如 'Failed to save project'）
 * @param error  捕获的异常对象（unknown，内部归一化为 message + stack）
 * @param extra  额外字段（如 { projectId }），便于在主进程日志中定位上下文
 */
export function logError(
  message: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errStack = error instanceof Error ? error.stack || '' : '';
  forward('error', message, {
    ...extra,
    error: errMessage,
    stack: errStack,
  });
}

/**
 * 记录 warn 级别日志：同时输出 console.warn 并转发到主进程 logger 落盘。
 * @param message 简短描述（如 'clearRecoveryDraft failed'）
 * @param extra  额外字段（如 { error: '...' }），便于在主进程日志中定位上下文
 */
export function logWarn(
  message: string,
  extra?: Record<string, unknown>,
): void {
  forward('warn', message, extra);
}
