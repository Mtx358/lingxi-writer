// 渲染层日志上报 IPC：渲染层错误统一到主进程日志文件。
// 依赖 ./shared（safeIpcHandle）与 ../logger，不依赖其他 handler。
import { logger } from '../logger';
import { safeIpcHandle } from './shared';

// 渲染层 console.error / console.warn 仅出现在 devtools console，生产环境用户无法提供。
// 通过此 IPC 让渲染层把关键错误（unhandledrejection / error / catch 块）转发到主进程
// logger，与主进程日志统一落盘到 userData/logs/main.log，方便用户报障时提供完整日志。
//
// 不做入参严格校验：渲染层被 XSS 后此处最多被刷日志（已有 IPC 限流：logger:write
// capacity=10 refillPerSec=1），不会造成 DoS；message 与 fields 都按 unknown 接收，
// logger 内部有 sanitizeFields（敏感字段 redaction）+ formatValue（长度截断）兜底
function registerLoggerHandlers() {
  safeIpcHandle('logger:write', (_event, level: unknown, message: unknown, fields: unknown) => {
    // level 必须是 logger 支持的四种之一，否则降级到 info
    const allowedLevels = new Set(['debug', 'info', 'warn', 'error']);
    const lvl = typeof level === 'string' && allowedLevels.has(level) ? level : 'info';
    const msg = typeof message === 'string' ? message : String(message ?? '');
    // fields 必须是对象，否则忽略
    const f = fields && typeof fields === 'object' && !Array.isArray(fields)
      ? fields as Record<string, string | number | boolean | null | undefined>
      : undefined;
    // 标记来源：区分主进程自有日志与渲染层转发日志，便于排查"渲染层报障但日志无对应记录"
    const taggedFields = { ...f, source: 'renderer' };
    try {
      logger.write(lvl as 'debug' | 'info' | 'warn' | 'error', msg, taggedFields);
    } catch {
      // logger 自身失败时静默：渲染层不应因日志上报失败而崩溃
    }
  });
}

export { registerLoggerHandlers };
