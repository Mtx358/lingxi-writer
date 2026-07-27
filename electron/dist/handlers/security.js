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
var security_exports = {};
__export(security_exports, {
  EXPORT_ALLOWED_EXTENSIONS: () => EXPORT_ALLOWED_EXTENSIONS,
  MAX_IDENTIFIER_LENGTH: () => MAX_IDENTIFIER_LENGTH,
  assertRealPathInside: () => assertRealPathInside,
  getAllowedProjectFileRoots: () => getAllowedProjectFileRoots,
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
module.exports = __toCommonJS(security_exports);
var import_electron = require("electron");
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_shared = require("./shared");
function getAllowedProjectFileRoots() {
  const home = import_electron.app.getPath("home");
  const roots = [
    home,
    import_node_path.default.join(home, "Documents"),
    import_node_path.default.join(home, "Desktop"),
    import_node_path.default.join(home, "Downloads"),
    import_electron.app.getPath("userData")
  ];
  return Array.from(new Set(roots.map((p) => import_node_path.default.resolve(p))));
}
function isSafeProjectFilePath(filePath) {
  if (typeof filePath !== "string" || !filePath) return false;
  if (filePath.includes("\0") || filePath.includes("\n") || filePath.includes("\r")) return false;
  if (!import_node_path.default.isAbsolute(filePath)) return false;
  if (!filePath.toLowerCase().endsWith(".cwp")) return false;
  const normalized = import_node_path.default.normalize(filePath);
  if (!normalized.toLowerCase().endsWith(".cwp")) return false;
  const allowedRoots = getAllowedProjectFileRoots();
  const isInsideAllowed = allowedRoots.some(
    (root) => normalized === root || normalized.startsWith(root + import_node_path.default.sep)
  );
  if (!isInsideAllowed) return false;
  return true;
}
function isSafeBackupPath(p) {
  if (typeof p !== "string" || !p || p.includes("\0")) return false;
  const resolved = import_node_path.default.resolve(p);
  const backupsRoot = (0, import_shared.getBackupsDir)();
  return resolved === backupsRoot || resolved.startsWith(backupsRoot + import_node_path.default.sep);
}
const EXPORT_ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([
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
  if (!import_node_path.default.isAbsolute(filePath)) return false;
  const lower = filePath.toLowerCase();
  const ext = import_node_path.default.extname(lower);
  if (!EXPORT_ALLOWED_EXTENSIONS.has(ext)) return false;
  const normalized = import_node_path.default.normalize(filePath);
  const normalizedExt = import_node_path.default.extname(normalized.toLowerCase());
  if (!EXPORT_ALLOWED_EXTENSIONS.has(normalizedExt)) return false;
  const allowedRoots = getAllowedProjectFileRoots();
  const isInsideAllowed = allowedRoots.some(
    (root) => normalized === root || normalized.startsWith(root + import_node_path.default.sep)
  );
  if (!isInsideAllowed) return false;
  return true;
}
function isInsideDataDir(filePath) {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) return false;
  const resolved = import_node_path.default.resolve(filePath);
  const dataDir = (0, import_shared.getDataDir)();
  return resolved === dataDir || resolved.startsWith(dataDir + import_node_path.default.sep);
}
async function resolveRealPath(filePath) {
  try {
    return await import_promises.default.realpath(filePath);
  } catch (e) {
    const code = e.code;
    if (code === "ENOENT") {
      const parent = import_node_path.default.dirname(filePath);
      const base = import_node_path.default.basename(filePath);
      try {
        const realParent = await import_promises.default.realpath(parent);
        return import_node_path.default.join(realParent, base);
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
    (root) => real === root || real.startsWith(root + import_node_path.default.sep)
  );
}
const MAX_IDENTIFIER_LENGTH = 256;
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
const AI_PROXY_VALID_PROVIDERS = /* @__PURE__ */ new Set(["mock", "local", "openai", "deepseek"]);
const AI_PROXY_VALID_ROLES = /* @__PURE__ */ new Set(["system", "user", "assistant"]);
const AI_PROXY_MAX_MESSAGES = 200;
const AI_PROXY_MAX_CONTENT_LEN = 2e5;
const AI_PROXY_MAX_BASEURL_LEN = 1024;
const AI_PROXY_MAX_MODEL_LEN = 128;
const AI_PROXY_MAX_TOKENS = 8192;
const AI_PROXY_REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPORT_ALLOWED_EXTENSIONS,
  MAX_IDENTIFIER_LENGTH,
  assertRealPathInside,
  getAllowedProjectFileRoots,
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
