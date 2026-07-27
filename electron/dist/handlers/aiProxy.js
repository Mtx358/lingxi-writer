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
var aiProxy_exports = {};
__export(aiProxy_exports, {
  abortAllAIRequests: () => abortAllAIRequests,
  registerAIProxyHandlers: () => registerAIProxyHandlers,
  registerAISettingsHandlers: () => registerAISettingsHandlers
});
module.exports = __toCommonJS(aiProxy_exports);
var import_electron = require("electron");
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_node_crypto = require("node:crypto");
var import_logger = require("../logger");
var import_shared = require("./shared");
var import_security = require("./security");
var import_storage = require("./storage");
var import_aiProxy = require("./aiProxy.logic");
const aiAbortControllers = /* @__PURE__ */ new Map();
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
    const filePath = (0, import_storage.resolveFilePath)("aiSettings");
    const data = await import_promises.default.readFile(filePath, "utf-8");
    const settings = JSON.parse(data);
    let apiKey = "";
    if (settings.apiKey && import_electron.safeStorage.isEncryptionAvailable()) {
      try {
        apiKey = import_electron.safeStorage.decryptString(Buffer.from(settings.apiKey, "base64"));
      } catch (e) {
        import_logger.logger.audit("security.crypto", "apiKey decrypt failed in loadSettings", { error: e instanceof Error ? e.message : String(e) });
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
  (0, import_shared.safeIpcHandle)("ai:loadSettings", async () => {
    try {
      const filePath = (0, import_storage.resolveFilePath)("aiSettings");
      const exists = await (0, import_shared.pathExists)(filePath);
      if (!exists) return null;
      const raw = await import_promises.default.readFile(filePath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.apiKey && typeof settings.apiKey === "string") {
        try {
          const encrypted = Buffer.from(settings.apiKey, "base64");
          import_electron.safeStorage.decryptString(encrypted);
          settings.apiKey = "configured";
          settings.hasApiKey = true;
        } catch {
          import_logger.logger.audit("security.crypto", "ai:loadSettings: decrypt apiKey failed", { provider: settings.provider });
          settings.apiKey = "";
          settings.hasApiKey = false;
        }
      } else {
        settings.apiKey = "";
        settings.hasApiKey = false;
      }
      return settings;
    } catch (e) {
      import_logger.logger.error("ai:loadSettings error", e instanceof Error ? e : { error: String(e) });
      return null;
    }
  });
  (0, import_shared.safeIpcHandle)("ai:saveSettings", async (_event, settings) => {
    try {
      if (!settings || typeof settings !== "object") return false;
      const VALID_PROVIDERS = /* @__PURE__ */ new Set(["mock", "local", "openai", "deepseek"]);
      if (typeof settings.provider !== "string" || !VALID_PROVIDERS.has(settings.provider)) {
        import_logger.logger.audit("security.input", "ai:saveSettings rejected: invalid provider", { provider: settings.provider });
        return false;
      }
      if (typeof settings.temperature !== "number" || !Number.isFinite(settings.temperature)) {
        import_logger.logger.audit("security.input", "ai:saveSettings rejected: invalid temperature");
        return false;
      }
      if (typeof settings.maxTokens !== "number" || !Number.isFinite(settings.maxTokens)) {
        import_logger.logger.audit("security.input", "ai:saveSettings rejected: invalid maxTokens");
        return false;
      }
      if (typeof settings.apiKey !== "string" || typeof settings.baseUrl !== "string" || typeof settings.model !== "string") {
        import_logger.logger.audit("security.input", "ai:saveSettings rejected: invalid field types");
        return false;
      }
      let encryptedBase64 = "";
      if (settings.apiKey && import_electron.safeStorage.isEncryptionAvailable()) {
        try {
          const encrypted = import_electron.safeStorage.encryptString(settings.apiKey);
          encryptedBase64 = encrypted.toString("base64");
        } catch {
          import_logger.logger.audit("security.crypto", "ai:saveSettings: encrypt apiKey failed", { provider: settings.provider });
        }
      }
      const storedSettings = { ...settings, apiKey: encryptedBase64 };
      const filePath = (0, import_storage.resolveFilePath)("aiSettings");
      return await (0, import_shared.withWriteMutex)(filePath, async () => {
        await (0, import_shared.ensureDir)(filePath);
        const tmp = `${filePath}.${(0, import_node_crypto.randomUUID)()}.tmp`;
        try {
          await import_promises.default.writeFile(tmp, JSON.stringify(storedSettings), "utf-8");
          await import_promises.default.rename(tmp, filePath);
          return true;
        } finally {
          await import_promises.default.unlink(tmp).catch(() => {
          });
        }
      });
    } catch (e) {
      import_logger.logger.error("ai:saveSettings error", e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}
function registerAIProxyHandlers() {
  (0, import_shared.safeIpcHandle)("ai:proxyStream", async (event, params) => {
    const validationError = (0, import_security.validateAIProxyParams)(params);
    if (validationError) {
      import_logger.logger.audit("security.input", "ai:proxyStream rejected: invalid params", { error: validationError });
      throw new Error(validationError);
    }
    const { provider, model, messages, temperature, maxTokens, requestId } = params;
    const stored = await loadStoredAISettings();
    const baseUrl = params.baseUrl || stored.baseUrl;
    if (baseUrl && !isAllowedAiBaseUrl(baseUrl, provider)) {
      import_logger.logger.audit("security.ssrf", "ai:proxyStream rejected: disallowed baseUrl", { baseUrl, provider });
      throw new Error("AI baseUrl \u4E0D\u5728\u5141\u8BB8\u5217\u8868\u5185");
    }
    const apiKey = stored.apiKey;
    const built = (0, import_aiProxy.buildAIProxyRequest)(
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
        import_logger.logger.audit("ai.http", "AI provider returned non-2xx", { status: res.status, requestId });
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
      import_logger.logger.error("ai:proxyStream failed", {
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
  (0, import_shared.safeIpcHandle)("ai:abort", (_event, requestId) => {
    if (typeof requestId !== "string" || !requestId || requestId.length > 128 || !/^[a-zA-Z0-9-]+$/.test(requestId)) {
      import_logger.logger.audit("security.schema", "ai:abort rejected: invalid requestId");
      return false;
    }
    const controller = aiAbortControllers.get(requestId);
    if (controller) {
      controller.abort();
      aiAbortControllers.delete(requestId);
    }
    return true;
  });
  (0, import_shared.safeIpcHandle)("ai:proxyLLM", async (event, params) => {
    const validationError = (0, import_security.validateAIProxyLLMParams)(params);
    if (validationError) {
      import_logger.logger.audit("security.input", "ai:proxyLLM rejected: invalid params", { error: validationError });
      throw new Error(validationError);
    }
    const { provider, model, temperature, maxTokens, prompt, systemPrompt, requestId } = params;
    const stored = await loadStoredAISettings();
    const baseUrl = params.baseUrl || stored.baseUrl;
    if (baseUrl && !isAllowedAiBaseUrl(baseUrl, provider)) {
      import_logger.logger.audit("security.ssrf", "ai:proxyLLM rejected: disallowed baseUrl", { baseUrl, provider });
      throw new Error("AI baseUrl \u4E0D\u5728\u5141\u8BB8\u5217\u8868\u5185");
    }
    const apiKey = stored.apiKey;
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const built = (0, import_aiProxy.buildAIProxyRequest)(
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
        import_logger.logger.audit("ai.http", "AI provider returned non-2xx (proxyLLM)", { status: res.status, requestId });
        return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}`, status: res.status };
      }
      const data = await res.json();
      const parsed = (0, import_aiProxy.parseAIProxyResponse)(data, provider);
      if (!parsed.ok) {
        import_logger.logger.audit("ai.http", "AI provider returned empty content (proxyLLM)", { requestId });
        return { ok: false, error: parsed.error };
      }
      return { ok: true, content: parsed.content };
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === "AbortError" || abortController.signal.aborted);
      if (isAbort) {
        return { ok: true, content: "" };
      }
      const msg = e instanceof Error ? e.message : String(e);
      import_logger.logger.error("ai:proxyLLM failed", {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  abortAllAIRequests,
  registerAIProxyHandlers,
  registerAISettingsHandlers
});
