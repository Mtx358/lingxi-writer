"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAIProxyHandlers = registerAIProxyHandlers;
exports.registerAISettingsHandlers = registerAISettingsHandlers;
exports.abortAllAIRequests = abortAllAIRequests;
// AI 代理 IPC handler：流式/非流式 AI 请求代理 + AI 设置读写。
// 密钥只在主进程使用，渲染层不接触明文 apiKey。
// 依赖 ./shared、./security、./storage（resolveFilePath）、../logger，不依赖其他 handler。
// 请求构造与响应解析已抽离到 ./aiProxy.logic，便于单元测试。
const electron_1 = require("electron");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_crypto_1 = require("node:crypto");
const logger_1 = require("../logger");
const shared_1 = require("./shared");
const security_1 = require("./security");
const storage_1 = require("./storage");
const aiProxy_logic_1 = require("./aiProxy.logic");
const aiAbortControllers = new Map();
// 中止所有进行中的 AI 请求：before-quit 调用，避免 fetch 句柄悬挂
function abortAllAIRequests() {
    for (const controller of aiAbortControllers.values()) {
        try {
            controller.abort();
        }
        catch { /* 已中止的 controller 再次 abort 会抛错，忽略 */ }
    }
    aiAbortControllers.clear();
}
// 校验 AI 代理 baseUrl，防止渲染层被 XSS 后通过 baseUrl 走 SSRF
// 或把 API 密钥外传到攻击者控制的端点。
// 仅允许已知 AI 服务商域名（https）以及本地 loopback（http，自部署模型）。
// H-NEW-1 修复：按 provider 强制协议一致性——openai/deepseek 必须 https，
// local 必须 http+loopback。否则攻击者可用 provider=openai+baseUrl=http://127.0.0.1:xxxx
// 将 apiKey 通过 Authorization 头发送给本地恶意服务。
function isAllowedAiBaseUrl(baseUrl, provider) {
    if (typeof baseUrl !== 'string' || !baseUrl)
        return false;
    let url;
    try {
        url = new URL(baseUrl);
    }
    catch {
        return false;
    }
    const host = url.hostname;
    // 按 provider 强制协议与域名一致：防止 apiKey 泄漏给本地 HTTP 服务
    if (provider === 'openai') {
        return url.protocol === 'https:' && host === 'api.openai.com';
    }
    if (provider === 'deepseek') {
        return url.protocol === 'https:' && host === 'api.deepseek.com';
    }
    // local 或未指定 provider：仅允许 http + loopback（自部署模型如 ollama）
    if (provider === 'local') {
        return url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
    }
    // provider 未知时保持原有兜底：https 仅已知域名，http 仅 loopback
    if (url.protocol === 'https:') {
        return host === 'api.openai.com' || host === 'api.deepseek.com';
    }
    if (url.protocol === 'http:') {
        return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
}
async function loadStoredAISettings() {
    try {
        const filePath = (0, storage_1.resolveFilePath)('aiSettings');
        const data = await promises_1.default.readFile(filePath, 'utf-8');
        const settings = JSON.parse(data);
        let apiKey = '';
        if (settings.apiKey && electron_1.safeStorage.isEncryptionAvailable()) {
            try {
                apiKey = electron_1.safeStorage.decryptString(Buffer.from(settings.apiKey, 'base64'));
            }
            catch (e) {
                logger_1.logger.audit('security.crypto', 'apiKey decrypt failed in loadSettings', { error: e instanceof Error ? e.message : String(e) });
                apiKey = '';
            }
        }
        return {
            apiKey,
            provider: settings.provider || 'mock',
            baseUrl: settings.baseUrl || '',
            model: settings.model || '',
            temperature: settings.temperature ?? 0.7,
            maxTokens: settings.maxTokens ?? 2000,
        };
    }
    catch {
        return { apiKey: '', provider: 'mock', baseUrl: '', model: '', temperature: 0.7, maxTokens: 2000 };
    }
}
// ============================================================================
// 专用 ai:loadSettings IPC：替代 storage:read('aiSettings') + storage:decrypt
// 主进程内部解密 apiKey 验证可用性，但不再把明文返回到渲染层。
// 安全收益：渲染层被 XSS 后无法解密磁盘上其他加密字段（虽然当前仅 aiSettings 使用
// safeStorage，但收敛 decrypt 入口可防止未来误用——任何加密字段都不会被 XSS 读取）。
// 进一步：解密后的明文 apiKey 也不落渲染层内存——AI 调用走主进程代理（ai:proxyStream
// / ai:proxyLLM），主进程内部从加密存储取密钥。此处仅返回 'configured' 哨兵值
// （truthy，让 UI 的 `if (apiKey)` 检查仍工作）与 hasApiKey 布尔标志。
// 解密失败或无 apiKey 时返回空 apiKey + hasApiKey:false，UI 据此提示用户重新输入
// ============================================================================
function registerAISettingsHandlers() {
    (0, shared_1.safeIpcHandle)('ai:loadSettings', async () => {
        try {
            const filePath = (0, storage_1.resolveFilePath)('aiSettings');
            const exists = await (0, shared_1.pathExists)(filePath);
            if (!exists)
                return null;
            const raw = await promises_1.default.readFile(filePath, 'utf-8');
            const settings = JSON.parse(raw);
            // 解密 apiKey：仅在 apiKey 非空时尝试，避免空字符串误报 decrypt 失败。
            // 解密仅用于验证密钥可用性——明文不返回渲染层，返回 'configured' 哨兵
            if (settings.apiKey && typeof settings.apiKey === 'string') {
                try {
                    const encrypted = Buffer.from(settings.apiKey, 'base64');
                    electron_1.safeStorage.decryptString(encrypted);
                    // 解密成功：apiKey 已配置，返回哨兵值（truthy）让 UI 检查通过
                    settings.apiKey = 'configured';
                    settings.hasApiKey = true;
                }
                catch {
                    // 解密失败（密钥迁移、OS 用户切换、safeStorage backend 变化）：清空 apiKey
                    // 让用户重新输入，避免后续 AI 调用把加密串当 apiKey 用必然失败
                    logger_1.logger.audit('security.crypto', 'ai:loadSettings: decrypt apiKey failed', { provider: settings.provider });
                    settings.apiKey = '';
                    settings.hasApiKey = false;
                }
            }
            else {
                settings.apiKey = '';
                settings.hasApiKey = false;
            }
            return settings;
        }
        catch (e) {
            logger_1.logger.error('ai:loadSettings error', e instanceof Error ? e : { error: String(e) });
            return null;
        }
    });
    // 专用 ai:saveSettings IPC：替代 storage:write('aiSettings', ...)，主进程内部
    // 1) 校验 provider ∈ {mock,local,openai,deepseek}、temperature/maxTokens 是有限数字
    // 2) safeStorage.encryptString(apiKey) 加密 apiKey 后落盘
    // 3) withWriteMutex 保证原子性
    // 防止渲染层被 XSS 后任意覆写 aiSettings 把 apiKey 替换为 attacker-key
    (0, shared_1.safeIpcHandle)('ai:saveSettings', async (_event, settings) => {
        try {
            // 入参校验：防止渲染层被 XSS 后传入畸形 settings 写入磁盘
            if (!settings || typeof settings !== 'object')
                return false;
            const VALID_PROVIDERS = new Set(['mock', 'local', 'openai', 'deepseek']);
            if (typeof settings.provider !== 'string' || !VALID_PROVIDERS.has(settings.provider)) {
                logger_1.logger.audit('security.input', 'ai:saveSettings rejected: invalid provider', { provider: settings.provider });
                return false;
            }
            if (typeof settings.temperature !== 'number' || !Number.isFinite(settings.temperature)) {
                logger_1.logger.audit('security.input', 'ai:saveSettings rejected: invalid temperature');
                return false;
            }
            if (typeof settings.maxTokens !== 'number' || !Number.isFinite(settings.maxTokens)) {
                logger_1.logger.audit('security.input', 'ai:saveSettings rejected: invalid maxTokens');
                return false;
            }
            if (typeof settings.apiKey !== 'string' ||
                typeof settings.baseUrl !== 'string' ||
                typeof settings.model !== 'string') {
                logger_1.logger.audit('security.input', 'ai:saveSettings rejected: invalid field types');
                return false;
            }
            // 加密 apiKey：仅在 apiKey 非空且 safeStorage 可用时加密。
            // safeStorage 不可用时仍写入其他字段但 apiKey 字段为空字符串，
            // 与原 updateAISettings 行为一致（拒绝明文落盘）
            let encryptedBase64 = '';
            if (settings.apiKey && electron_1.safeStorage.isEncryptionAvailable()) {
                try {
                    const encrypted = electron_1.safeStorage.encryptString(settings.apiKey);
                    encryptedBase64 = encrypted.toString('base64');
                }
                catch {
                    logger_1.logger.audit('security.crypto', 'ai:saveSettings: encrypt apiKey failed', { provider: settings.provider });
                    // 加密失败：apiKey 字段为空字符串，避免明文落盘
                }
            }
            const storedSettings = { ...settings, apiKey: encryptedBase64 };
            const filePath = (0, storage_1.resolveFilePath)('aiSettings');
            return await (0, shared_1.withWriteMutex)(filePath, async () => {
                await (0, shared_1.ensureDir)(filePath);
                const tmp = `${filePath}.${(0, node_crypto_1.randomUUID)()}.tmp`;
                try {
                    await promises_1.default.writeFile(tmp, JSON.stringify(storedSettings), 'utf-8');
                    await promises_1.default.rename(tmp, filePath);
                    return true;
                }
                finally {
                    await promises_1.default.unlink(tmp).catch(() => { });
                }
            });
        }
        catch (e) {
            logger_1.logger.error('ai:saveSettings error', e instanceof Error ? e : { error: String(e) });
            return false;
        }
    });
}
function registerAIProxyHandlers() {
    (0, shared_1.safeIpcHandle)('ai:proxyStream', async (event, params) => {
        // 入参白名单校验：防止渲染层被 XSS 后传入畸形 params（DoS / SSRF / channel 名污染）
        const validationError = (0, security_1.validateAIProxyParams)(params);
        if (validationError) {
            logger_1.logger.audit('security.input', 'ai:proxyStream rejected: invalid params', { error: validationError });
            throw new Error(validationError);
        }
        const { provider, model, messages, temperature, maxTokens, requestId } = params;
        // 密钥从主进程存储读取，渲染层不传密钥
        const stored = await loadStoredAISettings();
        const baseUrl = params.baseUrl || stored.baseUrl;
        // SSRF 防御：baseUrl 必须通过白名单校验（已知 AI 服务商域名或本地 loopback）
        // H-NEW-1：传入 provider 强制协议一致性
        if (baseUrl && !isAllowedAiBaseUrl(baseUrl, provider)) {
            logger_1.logger.audit('security.ssrf', 'ai:proxyStream rejected: disallowed baseUrl', { baseUrl, provider });
            // 不回传 baseUrl 原值：错误消息一致性 + 避免回显用户输入便于探测白名单边界
            throw new Error('AI baseUrl 不在允许列表内');
        }
        const apiKey = stored.apiKey;
        // 请求构造：抽离为 buildAIProxyRequest 纯函数便于单元测试
        const built = (0, aiProxy_logic_1.buildAIProxyRequest)({ provider, baseUrl: params.baseUrl, model, messages, temperature, maxTokens, stream: true }, { apiKey, baseUrl: stored.baseUrl, model: stored.model });
        const url = built.url;
        const headers = built.headers;
        const abortController = new AbortController();
        aiAbortControllers.set(requestId, abortController);
        // 窗口关闭时中止 fetch，避免 event.sender.send 抛错且 fetch 句柄悬挂
        const onSenderDestroyed = () => abortController.abort();
        event.sender.once('destroyed', onSenderDestroyed);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: built.body,
                signal: abortController.signal,
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                logger_1.logger.audit('ai.http', 'AI provider returned non-2xx', { status: res.status, requestId });
                throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';
            let fullContent = '';
            // 流解析按 provider 分支（与 llmClient.ts callLLMStream 保持一致）：
            // - openai/deepseek: SSE 格式 `data: {...}` / `data: [DONE]`，字段 choices[0].delta.content
            // - local (Ollama): NDJSON 格式每行裸 JSON，字段 message.content，done:true 表示流结束
            const extractChunk = (data) => {
                if (data === '[DONE]')
                    return '';
                try {
                    const json = JSON.parse(data);
                    // openai/deepseek 格式: choices[0].delta.content
                    // ollama 格式: message.content
                    return json.choices?.[0]?.delta?.content ?? json.message?.content ?? '';
                }
                catch {
                    return '';
                }
            };
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    // OpenAI/DeepSeek 的 [DONE] 标记：立即完成
                    if (provider !== 'local' && trimmed === 'data: [DONE]') {
                        sseBuffer = '';
                        if (!event.sender.isDestroyed()) {
                            event.sender.send(`ai:stream:done:${requestId}`, fullContent);
                        }
                        return fullContent;
                    }
                    // Ollama 的 done:true 检测（NDJSON 中含 done 字段表示流结束）
                    if (provider === 'local' && trimmed.startsWith('{')) {
                        try {
                            const data = JSON.parse(trimmed);
                            if (data?.done) {
                                sseBuffer = '';
                                if (!event.sender.isDestroyed()) {
                                    event.sender.send(`ai:stream:done:${requestId}`, fullContent);
                                }
                                return fullContent;
                            }
                        }
                        catch {
                            // 忽略解析失败，继续走 extractChunk
                        }
                    }
                    // 按格式提取内容：local 解析裸 JSON 行；openai/deepseek 解析 `data: ` 前缀行
                    const dataStr = provider === 'local' ? trimmed : (trimmed.startsWith('data: ') ? trimmed.slice(6) : '');
                    if (!dataStr)
                        continue;
                    const chunk = extractChunk(dataStr);
                    if (chunk) {
                        fullContent += chunk;
                        if (!event.sender.isDestroyed()) {
                            event.sender.send(`ai:stream:chunk:${requestId}`, chunk);
                        }
                    }
                }
            }
            // flush 残留缓冲区
            const tail = sseBuffer.trim();
            if (tail) {
                if (provider !== 'local' && tail === 'data: [DONE]') {
                    if (!event.sender.isDestroyed()) {
                        event.sender.send(`ai:stream:done:${requestId}`, fullContent);
                    }
                    return fullContent;
                }
                const dataStr = provider === 'local' ? tail : (tail.startsWith('data: ') ? tail.slice(6) : '');
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
        }
        catch (e) {
            const isAbort = e instanceof Error && (e.name === 'AbortError' || abortController.signal.aborted);
            if (isAbort) {
                // abort 视为正常完成，保留已生成内容
                if (!event.sender.isDestroyed()) {
                    event.sender.send(`ai:stream:done:${requestId}`, '');
                }
                return '';
            }
            const msg = e instanceof Error ? e.message : String(e);
            if (!event.sender.isDestroyed()) {
                event.sender.send(`ai:stream:error:${requestId}`, msg);
            }
            // 失败落盘日志：不记录 messages/content/apiKey；provider/model 从闭包取
            logger_1.logger.error('ai:proxyStream failed', {
                requestId,
                provider,
                model,
                error: msg,
            });
            throw e;
        }
        finally {
            event.sender.off('destroyed', onSenderDestroyed);
            aiAbortControllers.delete(requestId);
        }
    });
    (0, shared_1.safeIpcHandle)('ai:abort', (_event, requestId) => {
        // 入参校验（M1）：requestId 必须是非空字符串且仅含字母数字+连字符，长度 ≤128。
        // 防止 XSS 后传入对象/超长字符串/特殊字符作为 Map key 探测或污染日志。
        // 渲染层 requestId 格式为 `ai-{timestamp}-{random}`，全部为字母数字+连字符
        if (typeof requestId !== 'string' || !requestId || requestId.length > 128 || !/^[a-zA-Z0-9-]+$/.test(requestId)) {
            logger_1.logger.audit('security.schema', 'ai:abort rejected: invalid requestId');
            return false;
        }
        const controller = aiAbortControllers.get(requestId);
        if (controller) {
            controller.abort();
            aiAbortControllers.delete(requestId);
        }
        return true;
    });
    // 非流式 AI 请求代理：与 ai:proxyStream 对称，密钥只在主进程使用。
    // 修复安全缺口：原 callLLM 在渲染层用明文 apiKey 直接 fetch，
    // 此 handler 让非流式调用也走主进程代理，apiKey 永不落渲染层内存。
    // 入参不含 apiKey，主进程内部调用 loadStoredAISettings() 解密取密钥。
    // 请求构造与 llmClient.callLLM 的 resolveEndpoint 完全一致（URL/headers/body 格式）。
    (0, shared_1.safeIpcHandle)('ai:proxyLLM', async (event, params) => {
        // 入参白名单校验：防止渲染层被 XSS 后传入畸形 params（DoS / SSRF / channel 名污染）
        const validationError = (0, security_1.validateAIProxyLLMParams)(params);
        if (validationError) {
            logger_1.logger.audit('security.input', 'ai:proxyLLM rejected: invalid params', { error: validationError });
            throw new Error(validationError);
        }
        const { provider, model, temperature, maxTokens, prompt, systemPrompt, requestId } = params;
        // 密钥从主进程存储读取，渲染层不传密钥
        const stored = await loadStoredAISettings();
        const baseUrl = params.baseUrl || stored.baseUrl;
        // SSRF 防御：baseUrl 必须通过白名单校验（已知 AI 服务商域名或本地 loopback）
        // 与 proxyStream 一致：按 provider 强制协议一致性，防止 apiKey 泄漏给本地 HTTP 服务
        if (baseUrl && !isAllowedAiBaseUrl(baseUrl, provider)) {
            logger_1.logger.audit('security.ssrf', 'ai:proxyLLM rejected: disallowed baseUrl', { baseUrl, provider });
            throw new Error('AI baseUrl 不在允许列表内');
        }
        const apiKey = stored.apiKey;
        // 构造 messages（与 llmClient.buildMessages 一致：system 在前，user 在后）
        const messages = [];
        if (systemPrompt)
            messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });
        // 请求构造：抽离为 buildAIProxyRequest 纯函数便于单元测试
        const built = (0, aiProxy_logic_1.buildAIProxyRequest)({ provider, baseUrl: params.baseUrl, model, messages, temperature, maxTokens, stream: false }, { apiKey, baseUrl: stored.baseUrl, model: stored.model });
        const url = built.url;
        const headers = built.headers;
        // 接入 AbortController：与 proxyStream 一致，存入 aiAbortControllers Map，
        // 供 ai:abort 中止（IPC 超时 / 窗口关闭 / 用户取消）
        const abortController = new AbortController();
        aiAbortControllers.set(requestId, abortController);
        const onSenderDestroyed = () => abortController.abort();
        event.sender.once('destroyed', onSenderDestroyed);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: built.body,
                signal: abortController.signal,
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                logger_1.logger.audit('ai.http', 'AI provider returned non-2xx (proxyLLM)', { status: res.status, requestId });
                return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}`, status: res.status };
            }
            const data = await res.json();
            // 响应解析：抽离为 parseAIProxyResponse 纯函数便于单元测试
            // 与 callLLM 一致：Ollama data.message.content；OpenAI/DeepSeek data.choices[0].message.content
            const parsed = (0, aiProxy_logic_1.parseAIProxyResponse)(data, provider);
            if (!parsed.ok) {
                logger_1.logger.audit('ai.http', 'AI provider returned empty content (proxyLLM)', { requestId });
                return { ok: false, error: parsed.error };
            }
            return { ok: true, content: parsed.content };
        }
        catch (e) {
            const isAbort = e instanceof Error && (e.name === 'AbortError' || abortController.signal.aborted);
            if (isAbort) {
                // abort 视为正常完成（与 proxyStream 一致）：返回空内容，不记录错误日志
                return { ok: true, content: '' };
            }
            const msg = e instanceof Error ? e.message : String(e);
            // 失败落盘日志：不记录 prompt/systemPrompt/apiKey；provider/model 从闭包取
            logger_1.logger.error('ai:proxyLLM failed', {
                requestId,
                provider,
                model,
                error: msg,
            });
            return { ok: false, error: msg };
        }
        finally {
            event.sender.off('destroyed', onSenderDestroyed);
            aiAbortControllers.delete(requestId);
        }
    });
}
