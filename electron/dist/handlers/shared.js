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
var shared_exports = {};
__export(shared_exports, {
  ALLOWED_GLOBAL_STORAGE_KEYS: () => ALLOWED_GLOBAL_STORAGE_KEYS,
  FILE_VERSION: () => FILE_VERSION,
  MAX_STORAGE_VALUE_SIZE: () => MAX_STORAGE_VALUE_SIZE,
  RATE_LIMIT_AUDIT_WINDOW_MS: () => RATE_LIMIT_AUDIT_WINDOW_MS,
  READ_ONLY_STORAGE_KEYS: () => READ_ONLY_STORAGE_KEYS,
  awaitPendingWrites: () => awaitPendingWrites,
  clearRateLimitAuditTimers: () => clearRateLimitAuditTimers,
  copyDir: () => copyDir,
  ensureDir: () => ensureDir,
  generateChecksum: () => generateChecksum,
  getBackupsDir: () => getBackupsDir,
  getDataDir: () => getDataDir,
  getMainWindow: () => getMainWindow,
  getProjectsDir: () => getProjectsDir,
  isValidStorageKey: () => isValidStorageKey,
  pathExists: () => pathExists,
  safeIpcHandle: () => safeIpcHandle,
  setMainWindow: () => setMainWindow,
  setQuitting: () => setQuitting,
  validatePathAndAudit: () => validatePathAndAudit,
  withWriteMutex: () => withWriteMutex
});
module.exports = __toCommonJS(shared_exports);
var import_electron = require("electron");
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_node_crypto = require("node:crypto");
var import_logger = require("../logger");
var import_ipcRateLimit = require("../ipcRateLimit");
var import_security = require("./security");
const FILE_VERSION = "1.0.0";
const MAX_STORAGE_VALUE_SIZE = 50 * 1024 * 1024;
const RATE_LIMIT_AUDIT_WINDOW_MS = 6e4;
const rateLimitAuditState = /* @__PURE__ */ new Map();
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
    import_electron.ipcMain.removeHandler(channel);
  } catch {
  }
  import_electron.ipcMain["handle"](channel, (event, ...args) => {
    const rateLimitError = import_ipcRateLimit.ipcRateLimiter.check(channel, event.sender.id);
    if (rateLimitError) {
      const existing = rateLimitAuditState.get(channel);
      if (existing && existing.timer) {
        existing.count++;
      } else {
        import_logger.logger.audit("security.rate_limit", "IPC rejected: rate limit exceeded", {
          channel,
          senderId: rateLimitError.senderId
        });
        const entry = { count: 1, timer: null };
        entry.timer = setTimeout(() => {
          if (entry.count > 1) {
            import_logger.logger.audit("security.rate_limit", `rate limit suppressed (\xD7${entry.count} in last 60s)`, { channel });
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
const ALLOWED_GLOBAL_STORAGE_KEYS = /* @__PURE__ */ new Set([
  "projects",
  "recovery_draft",
  "app_migration_version",
  "lastOpenedProject"
]);
const READ_ONLY_STORAGE_KEYS = /* @__PURE__ */ new Set([
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
  return import_electron.app.getPath("userData");
}
function getProjectsDir() {
  return import_node_path.default.join(getDataDir(), "projects");
}
function getBackupsDir() {
  return import_node_path.default.join(getDataDir(), "backups");
}
function ensureDir(filePath) {
  return import_promises.default.mkdir(import_node_path.default.dirname(filePath), { recursive: true }).then(() => void 0);
}
function pathExists(p) {
  try {
    return import_promises.default.access(p).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
const writeMutex = /* @__PURE__ */ new Map();
let isQuitting = false;
function setQuitting(value) {
  isQuitting = value;
}
async function awaitPendingWrites() {
  const pending = Array.from(writeMutex.values());
  if (pending.length === 0) return;
  import_logger.logger.info("Quit: awaiting pending writes", { count: pending.length });
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
        import_logger.logger.warn?.(`withWriteMutex ${key} held for ${heldMs}ms, possible resource leak`);
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
  await import_promises.default.mkdir(dest, { recursive: true });
  const entries = await import_promises.default.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = import_node_path.default.join(src, entry.name);
    const destPath = import_node_path.default.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await import_promises.default.copyFile(srcPath, destPath);
    }
  }
}
function generateChecksum(data) {
  return (0, import_node_crypto.createHash)("sha256").update(data, "utf-8").digest("hex");
}
let mainWindowRef = null;
function getMainWindow() {
  return mainWindowRef;
}
function setMainWindow(win) {
  mainWindowRef = win;
}
async function validatePathAndAudit(channel, filePath, validator, roots, options) {
  if (!validator(filePath)) {
    import_logger.logger.audit("security.path", `${channel} rejected: invalid path`, { filePath: String(filePath) });
    return { ok: false, error: options?.invalidError ?? "\u975E\u6CD5\u7684\u8DEF\u5F84" };
  }
  const fp = filePath;
  if (!await (0, import_security.assertRealPathInside)(fp, roots)) {
    import_logger.logger.audit("security.path", `${channel} rejected: realpath outside allowed roots (symlink?)`, { filePath: fp });
    return { ok: false, error: options?.outsideError ?? "\u8DEF\u5F84\u89E3\u6790\u5931\u8D25\u6216\u4F4D\u4E8E\u5141\u8BB8\u76EE\u5F55\u5916\uFF08\u53EF\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\uFF09" };
  }
  return { ok: true };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALLOWED_GLOBAL_STORAGE_KEYS,
  FILE_VERSION,
  MAX_STORAGE_VALUE_SIZE,
  RATE_LIMIT_AUDIT_WINDOW_MS,
  READ_ONLY_STORAGE_KEYS,
  awaitPendingWrites,
  clearRateLimitAuditTimers,
  copyDir,
  ensureDir,
  generateChecksum,
  getBackupsDir,
  getDataDir,
  getMainWindow,
  getProjectsDir,
  isValidStorageKey,
  pathExists,
  safeIpcHandle,
  setMainWindow,
  setQuitting,
  validatePathAndAudit,
  withWriteMutex
});
