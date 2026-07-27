"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var aiProxy_logic_exports = {};
__export(aiProxy_logic_exports, {
  AI_PROXY_DEFAULT_MODEL_MAP: () => AI_PROXY_DEFAULT_MODEL_MAP,
  buildAIProxyRequest: () => buildAIProxyRequest,
  parseAIProxyResponse: () => parseAIProxyResponse
});
module.exports = __toCommonJS(aiProxy_logic_exports);
const AI_PROXY_DEFAULT_MODEL_MAP = {
  local: "qwen2.5:7b",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat"
};
const DEFAULT_BASE_URL_MAP = {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AI_PROXY_DEFAULT_MODEL_MAP,
  buildAIProxyRequest,
  parseAIProxyResponse
});
