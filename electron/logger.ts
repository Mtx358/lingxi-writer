// 结构化日志器：支持级别过滤、文件落盘（带轮转）、敏感字段脱敏、审计日志。
//
// 设计目标：
// - 不直接依赖 electron：通过 setLogDir 注入日志目录，主进程在 app.whenReady 后传入
//   userData/logs。未调用 setLogDir 时降级为 console-only，便于单测和未初始化场景使用
// - 敏感字段脱敏：apiKey/token/secret/password 等键名的值统一替换为 [REDACTED]，
//   防止日志文件泄露密钥（日志文件可能被用户主动导出或在崩溃报告中被收集）
// - 文件轮转：单文件 5MB，保留 3 个备份（main.log.1 / .2 / .3），避免无限增长占满磁盘
// - 审计日志：audit(category, message, fields) 用于安全相关事件（路径校验失败、IPC 入参
//   拒绝、加解密失败等），category 字段方便后续按类别筛选
// - 同步写入：日志量低（IPC 调用每分钟 10-50 次），同步写入避免退出时序问题
//   （异步写入可能在 before-quit 时丢失缓冲）

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_BACKUPS = 3;

// 敏感字段名（大小写不敏感）：值会被替换为 [REDACTED]，防止日志文件泄露密钥
// 命名常见 key：apiKey / api_key / secret / token / password / authorization
const SENSITIVE_KEY_RE = /^(apikey|api_key|secret|token|password|passwd|auth|authorization|access_token|refresh_token)$/i;

// 字段值截断阈值：超长字符串截断到 100 字符 + "…"，防止巨型 content 撑爆日志文件
const MAX_FIELD_VALUE_LEN = 100;

class Logger {
  private level: LogLevel = 'info';
  private logFilePath: string | null = null;
  private initialized = false;

  // 注入日志目录（主进程在 app.whenReady 后调用）。
  // 调用后日志会同步写入 <logDir>/main.log；未调用时仅输出到 console
  setLogDir(logDir: string): void {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      this.logFilePath = path.join(logDir, 'main.log');
      this.initialized = true;
    } catch (e) {
      // 创建目录失败（权限/磁盘满）：降级到 console-only
      console.error('logger.setLogDir failed', e);
    }
  }

  // 重置内部状态：仅供单测隔离使用
  reset(): void {
    this.level = 'info';
    this.logFilePath = null;
    this.initialized = false;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  debug(msg: string, fields?: LogFields): void {
    this.write('debug', msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.write('info', msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.write('warn', msg, fields);
  }

  // error 接受 Error 实例或 LogFields：传 Error 时自动提取 message + stack
  error(msg: string, fields?: LogFields | Error): void {
    const f = fields instanceof Error
      ? { error: fields.message, stack: fields.stack }
      : fields;
    this.write('error', msg, f);
  }

  // 审计日志：记录安全相关事件（路径校验失败、IPC 入参拒绝、加解密失败等）。
  // 输出级别为 info（生产默认级别即可看到），单独的 [AUDIT] 前缀 + category 字段
  // 方便后续从日志文件按类别筛选安全事件
  audit(category: string, message: string, fields?: LogFields): void {
    this.write('info', `[AUDIT] [${category}] ${message}`, fields);
  }

  // public write：供 IPC logger:write handler 转发渲染层日志使用。
  // 渲染层 catch 块通过 window.electronAPI.logger.write(...) 把错误统一到主进程日志文件，
  // 解决渲染层 console.error 仅出现在 devtools、生产环境用户无法提供日志的问题
  write(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const line = this.formatLine(level, msg, fields);
    // 总是输出到 console：dev 主进程可见；prod 至少 stderr 可见
    const consoleFn = level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
    consoleFn(line);
    // 文件落盘：未 setLogDir 时跳过
    if (this.logFilePath) {
      try {
        this.maybeRotate();
        fs.appendFileSync(this.logFilePath, line + '\n', 'utf-8');
      } catch (e) {
        // 落盘失败不阻断业务：console.error 提示一次（避免循环 log）
        console.error('logger.write to file failed', e);
      }
    }
  }

  private formatLine(level: LogLevel, msg: string, fields?: LogFields): string {
    const ts = new Date().toISOString();
    const levelTag = level.toUpperCase().padEnd(5);
    let line = `[${ts}] [${levelTag}] ${msg}`;
    if (fields && Object.keys(fields).length > 0) {
      const sanitized = this.sanitizeFields(fields);
      const kv = Object.entries(sanitized)
        .map(([k, v]) => `${k}=${this.formatValue(v)}`)
        .join(' ');
      line += ` { ${kv} }`;
    }
    return line;
  }

  private sanitizeFields(fields: LogFields): LogFields {
    const out: LogFields = {};
    for (const [k, v] of Object.entries(fields)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private formatValue(v: string | number | boolean | null | undefined): string {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    // string
    if (v.length === 0) return '""';
    // 长字符串截断
    const truncated = v.length > MAX_FIELD_VALUE_LEN
      ? v.slice(0, MAX_FIELD_VALUE_LEN) + '…'
      : v;
    // 含空格或特殊字符的字符串加引号（便于解析）
    if (/[\s"'={}|]/.test(truncated)) {
      return `"${truncated.replace(/"/g, '\\"')}"`;
    }
    return truncated;
  }

  // 文件轮转：main.log 超过 MAX_LOG_SIZE 时，
  // main.log.3 删除，main.log.2 -> .3，main.log.1 -> .2，main.log -> .1
  // 从最老的备份开始处理，避免覆盖
  private maybeRotate(): void {
    if (!this.logFilePath) return;
    try {
      const stats = fs.statSync(this.logFilePath);
      if (stats.size < MAX_LOG_SIZE) return;
    } catch {
      // stat 失败（文件不存在）：跳过轮转
      return;
    }
    for (let i = MAX_BACKUPS; i >= 1; i--) {
      const src = i === 1 ? this.logFilePath : `${this.logFilePath}.${i - 1}`;
      const dst = `${this.logFilePath}.${i}`;
      try {
        if (i === MAX_BACKUPS) {
          try { fs.unlinkSync(dst); } catch { /* dst 不存在则忽略 */ }
        }
        fs.renameSync(src, dst);
      } catch {
        // src 不存在则跳过
      }
    }
  }
}

export const logger = new Logger();

// 仅供单测：暴露内部常量以便验证
export const __test__ = {
  MAX_LOG_SIZE,
  MAX_BACKUPS,
  SENSITIVE_KEY_RE,
};
