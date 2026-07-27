"use strict";
// aiProxy handler 的纯函数实现：AI 请求构造 + 响应解析。
// 本模块不依赖 electron（safeStorage/fs/ipcMain），可被单元测试直接 import。
//
// 抽离目的：ai:proxyLLM / ai:proxyStream handler 的请求构造（URL/headers/body）与
// 非流式响应解析此前因 app.whenReady 永不 resolve 而无测试覆盖。
// 此处抽离为纯函数供 handler 调用并由 *.logic.test.ts 直接测试。
// 入参 schema 校验仍由 handler 调用 validateAIProxyParams / validateAIProxyLLMParams 完成。
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_PROXY_DEFAULT_MODEL_MAP = void 0;
exports.buildAIProxyRequest = buildAIProxyRequest;
exports.parseAIProxyResponse = parseAIProxyResponse;
// provider → 默认模型映射：与 aiProxy.ts 的 modelMap 一致。
// 抽离到本模块作为单一来源，handler 与测试均从此处引用避免漂移。
exports.AI_PROXY_DEFAULT_MODEL_MAP = {
    local: 'qwen2.5:7b',
    openai: 'gpt-4o-mini',
    deepseek: 'deepseek-chat',
};
// provider → 默认 baseUrl 映射：与 aiProxy.ts handler 内联值一致。
const DEFAULT_BASE_URL_MAP = {
    local: 'http://localhost:11434',
    openai: 'https://api.openai.com',
    deepseek: 'https://api.deepseek.com',
};
// 构造 AI 代理请求：URL / headers / body。
// 抽离自 aiProxy.ts 的 ai:proxyStream / ai:proxyLLM handler 内联构造逻辑。
//
// 与原 handler 行为对齐：
// - model 解析优先级：params.model > settings.model > modelMap[provider] > 'gpt-4o-mini'
// - baseUrl 解析优先级：params.baseUrl > settings.baseUrl > DEFAULT_BASE_URL_MAP[provider]
// - provider=local：POST {baseUrl}/api/chat，headers 仅 Content-Type，
//   body 放入 options: { temperature, num_predict: maxTokens }（Ollama 不识别顶层 temperature/max_tokens）
// - provider=openai/deepseek：POST {baseUrl}/v1/chat/completions，headers 含 Authorization: Bearer {apiKey}，
//   body 顶层 temperature/max_tokens
// - provider 不支持：抛 `Unsupported provider: ${provider}`（与 handler 一致）
function buildAIProxyRequest(params, settings) {
    const { provider, messages, temperature, maxTokens, stream } = params;
    // model 解析：与 handler 内联逻辑一致
    const usedModel = params.model || settings.model || exports.AI_PROXY_DEFAULT_MODEL_MAP[provider] || 'gpt-4o-mini';
    // baseUrl 解析：与 handler 内联逻辑一致
    const baseUrl = params.baseUrl || settings.baseUrl || DEFAULT_BASE_URL_MAP[provider] || '';
    let url;
    let headers;
    if (provider === 'local') {
        url = `${baseUrl}/api/chat`;
        headers = { 'Content-Type': 'application/json' };
    }
    else if (provider === 'openai') {
        url = `${baseUrl}/v1/chat/completions`;
        headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` };
    }
    else if (provider === 'deepseek') {
        url = `${baseUrl}/v1/chat/completions`;
        headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` };
    }
    else {
        throw new Error(`Unsupported provider: ${provider}`);
    }
    // 请求体按 provider 分支（与 handler 一致）：
    // - openai/deepseek: { model, messages, temperature, max_tokens, stream }
    // - local (Ollama): { model, messages, stream, options: { temperature, num_predict } }
    //   Ollama 不识别顶层 temperature/max_tokens，需放入 options；max_tokens 对应 num_predict
    const bodyObj = provider === 'local'
        ? { model: usedModel, messages, stream, options: { temperature, num_predict: maxTokens } }
        : { model: usedModel, messages, temperature, max_tokens: maxTokens, stream };
    return {
        url,
        headers,
        body: JSON.stringify(bodyObj),
        model: usedModel,
    };
}
// 解析非流式 AI 响应 JSON：从 data 中按 provider 格式提取 content。
// 抽离自 aiProxy.ts 的 ai:proxyLLM handler 的响应解析逻辑。
//
// 与原 handler 行为对齐：
// - provider=local：data.message.content 路径
// - provider=openai/deepseek：data.choices[0].message.content 路径
// - content 缺失或空：返回 { ok: false, error: '${provider} API: empty content' }
// - content 非字符串（如数字/null）：返回 { ok: false, error: ... }（与 handler 的 if (!content) 一致）
function parseAIProxyResponse(data, provider) {
    const d = data;
    const content = provider === 'local'
        ? d?.message?.content
        : d?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
        return { ok: false, error: `${provider} API: empty content` };
    }
    return { ok: true, content };
}
