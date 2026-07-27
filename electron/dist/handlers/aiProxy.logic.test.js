"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * electron/handlers/aiProxy.logic.ts 单元测试
 *
 * 测试目标：AI 请求构造（buildAIProxyRequest）+ 非流式响应解析（parseAIProxyResponse）
 * - buildAIProxyRequest：
 *   - provider 分支（local / openai / deepseek）的 URL / headers / body 格式
 *   - model 解析优先级：params.model > settings.model > modelMap > 'gpt-4o-mini'
 *   - baseUrl 解析优先级：params.baseUrl > settings.baseUrl > DEFAULT_BASE_URL_MAP
 *   - stream 字段透传
 *   - 不支持的 provider 抛错
 * - parseAIProxyResponse：
 *   - local: data.message.content 路径
 *   - openai/deepseek: data.choices[0].message.content 路径
 *   - content 缺失 / 空字符串 / 非字符串 → ok:false
 *
 * 本测试无需 mock electron：aiProxy.logic.ts 仅依赖 node 内置模块（无依赖）。
 */
const vitest_1 = require("vitest");
const aiProxy_logic_1 = require("./aiProxy.logic");
// 测试用公共参数：仅覆盖必填字段，各 case 按需覆盖 provider/model/baseUrl 等
function makeParams(overrides) {
    return {
        provider: 'openai',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        maxTokens: 2000,
        stream: false,
        ...overrides,
    };
}
// 测试用公共 settings
function makeSettings(overrides = {}) {
    return { apiKey: 'sk-test-key', ...overrides };
}
(0, vitest_1.describe)('aiProxy.logic / buildAIProxyRequest', () => {
    // -------------------- provider 分支：URL / headers / body --------------------
    (0, vitest_1.describe)('provider 分支', () => {
        (0, vitest_1.it)('local: URL={baseUrl}/api/chat，headers 仅 Content-Type，body 含 options.num_predict', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'local' }), makeSettings());
            (0, vitest_1.expect)(built.url).toBe('http://localhost:11434/api/chat');
            (0, vitest_1.expect)(built.headers).toEqual({ 'Content-Type': 'application/json' });
            // local 不应有 Authorization 头（Ollama 无需 apiKey）
            (0, vitest_1.expect)(built.headers.Authorization).toBeUndefined();
            const body = JSON.parse(built.body);
            (0, vitest_1.expect)(body.options).toEqual({ temperature: 0.7, num_predict: 2000 });
            // local body 顶层不应有 temperature/max_tokens（Ollama 不识别）
            (0, vitest_1.expect)(body.temperature).toBeUndefined();
            (0, vitest_1.expect)(body.max_tokens).toBeUndefined();
            (0, vitest_1.expect)(body.stream).toBe(false);
        });
        (0, vitest_1.it)('openai: URL={baseUrl}/v1/chat/completions，headers 含 Authorization Bearer', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai' }), makeSettings({ apiKey: 'sk-openai-key' }));
            (0, vitest_1.expect)(built.url).toBe('https://api.openai.com/v1/chat/completions');
            (0, vitest_1.expect)(built.headers).toEqual({
                'Content-Type': 'application/json',
                Authorization: 'Bearer sk-openai-key',
            });
            const body = JSON.parse(built.body);
            // openai body 顶层应有 temperature/max_tokens，不应有 options
            (0, vitest_1.expect)(body.temperature).toBe(0.7);
            (0, vitest_1.expect)(body.max_tokens).toBe(2000);
            (0, vitest_1.expect)(body.options).toBeUndefined();
            (0, vitest_1.expect)(body.stream).toBe(false);
        });
        (0, vitest_1.it)('deepseek: URL={baseUrl}/v1/chat/completions，headers 含 Authorization Bearer', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'deepseek' }), makeSettings({ apiKey: 'sk-deepseek-key' }));
            (0, vitest_1.expect)(built.url).toBe('https://api.deepseek.com/v1/chat/completions');
            (0, vitest_1.expect)(built.headers.Authorization).toBe('Bearer sk-deepseek-key');
            const body = JSON.parse(built.body);
            (0, vitest_1.expect)(body.model).toBe('deepseek-chat');
        });
        (0, vitest_1.it)('不支持的 provider 抛错（与 handler 一致）', () => {
            (0, vitest_1.expect)(() => (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'bogus' }), makeSettings())).toThrow(/Unsupported provider: bogus/);
        });
    });
    // -------------------- model 解析优先级 --------------------
    (0, vitest_1.describe)('model 解析优先级', () => {
        (0, vitest_1.it)('params.model 最优先', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai', model: 'gpt-4-custom' }), makeSettings({ model: 'settings-model' }));
            (0, vitest_1.expect)(built.model).toBe('gpt-4-custom');
            (0, vitest_1.expect)(JSON.parse(built.body).model).toBe('gpt-4-custom');
        });
        (0, vitest_1.it)('settings.model 次优先（params.model 缺失时）', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai' }), makeSettings({ model: 'settings-model' }));
            (0, vitest_1.expect)(built.model).toBe('settings-model');
        });
        (0, vitest_1.it)('modelMap[provider] 第三优先（params/settings 均无 model）', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai' }), makeSettings());
            (0, vitest_1.expect)(built.model).toBe(aiProxy_logic_1.AI_PROXY_DEFAULT_MODEL_MAP.openai);
            (0, vitest_1.expect)(built.model).toBe('gpt-4o-mini');
        });
        (0, vitest_1.it)('deepseek modelMap 回退到 deepseek-chat', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'deepseek' }), makeSettings());
            (0, vitest_1.expect)(built.model).toBe('deepseek-chat');
        });
        (0, vitest_1.it)('local modelMap 回退到 qwen2.5:7b', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'local' }), makeSettings());
            (0, vitest_1.expect)(built.model).toBe('qwen2.5:7b');
        });
        (0, vitest_1.it)('所有优先级均缺失时回退到 gpt-4o-mini（兜底）', () => {
            // 用未知 provider 触发兜底：modelMap[未知] === undefined → 回退 'gpt-4o-mini'
            // 但未知 provider 会抛 Unsupported provider 错误，故此处用已知 provider + 清空 modelMap
            // 改为验证 model 解析链的兜底：构造 modelMap 不含的 provider 不可行（会抛错），
            // 改测 settings/params 均无 model 时 openai 回退到 modelMap（已覆盖上一条）。
            // 此处验证 settings.model 为空字符串时（falsy）回退到 modelMap
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai' }), makeSettings({ model: '' }));
            (0, vitest_1.expect)(built.model).toBe('gpt-4o-mini');
        });
    });
    // -------------------- baseUrl 解析优先级 --------------------
    (0, vitest_1.describe)('baseUrl 解析优先级', () => {
        (0, vitest_1.it)('params.baseUrl 最优先', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai', baseUrl: 'https://custom.openai.proxy' }), makeSettings({ baseUrl: 'https://settings.base' }));
            (0, vitest_1.expect)(built.url).toBe('https://custom.openai.proxy/v1/chat/completions');
        });
        (0, vitest_1.it)('settings.baseUrl 次优先（params.baseUrl 缺失时）', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai' }), makeSettings({ baseUrl: 'https://settings.base' }));
            (0, vitest_1.expect)(built.url).toBe('https://settings.base/v1/chat/completions');
        });
        (0, vitest_1.it)('DEFAULT_BASE_URL_MAP 第三优先（params/settings 均无 baseUrl）', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'local' }), makeSettings());
            (0, vitest_1.expect)(built.url).toBe('http://localhost:11434/api/chat');
        });
    });
    // -------------------- stream / messages 透传 --------------------
    (0, vitest_1.describe)('stream / messages 透传', () => {
        (0, vitest_1.it)('stream=true 透传到 body', () => {
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai', stream: true }), makeSettings());
            (0, vitest_1.expect)(JSON.parse(built.body).stream).toBe(true);
        });
        (0, vitest_1.it)('messages 数组原样透传', () => {
            const messages = [
                { role: 'system', content: 'sys' },
                { role: 'user', content: 'hello' },
            ];
            const built = (0, aiProxy_logic_1.buildAIProxyRequest)(makeParams({ provider: 'openai', messages }), makeSettings());
            (0, vitest_1.expect)(JSON.parse(built.body).messages).toEqual(messages);
        });
    });
});
(0, vitest_1.describe)('aiProxy.logic / parseAIProxyResponse', () => {
    // -------------------- local provider --------------------
    (0, vitest_1.describe)('local (Ollama) 格式', () => {
        (0, vitest_1.it)('data.message.content 正确提取', () => {
            const data = { message: { content: 'Ollama reply' } };
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)(data, 'local');
            (0, vitest_1.expect)(result).toEqual({ ok: true, content: 'Ollama reply' });
        });
        (0, vitest_1.it)('message.content 缺失 → ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({ message: {} }, 'local');
            (0, vitest_1.expect)(result).toEqual({ ok: false, error: 'local API: empty content' });
        });
        (0, vitest_1.it)('message 缺失 → ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({}, 'local');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
        (0, vitest_1.it)('message.content 为空字符串 → ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({ message: { content: '' } }, 'local');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
        (0, vitest_1.it)('message.content 为非字符串（数字）→ ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({ message: { content: 42 } }, 'local');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
    });
    // -------------------- openai / deepseek provider --------------------
    (0, vitest_1.describe)('openai / deepseek 格式', () => {
        (0, vitest_1.it)('openai: data.choices[0].message.content 正确提取', () => {
            const data = { choices: [{ message: { content: 'OpenAI reply' } }] };
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)(data, 'openai');
            (0, vitest_1.expect)(result).toEqual({ ok: true, content: 'OpenAI reply' });
        });
        (0, vitest_1.it)('deepseek: data.choices[0].message.content 正确提取', () => {
            const data = { choices: [{ message: { content: 'DeepSeek reply' } }] };
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)(data, 'deepseek');
            (0, vitest_1.expect)(result).toEqual({ ok: true, content: 'DeepSeek reply' });
        });
        (0, vitest_1.it)('choices 数组为空 → ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({ choices: [] }, 'openai');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
        (0, vitest_1.it)('choices[0].message.content 缺失 → ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({ choices: [{ message: {} }] }, 'openai');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
        (0, vitest_1.it)('choices 缺失 → ok:false', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({}, 'openai');
            (0, vitest_1.expect)(result.ok).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('openai');
        });
        (0, vitest_1.it)('content 为空字符串 → ok:false', () => {
            const data = { choices: [{ message: { content: '' } }] };
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)(data, 'openai');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
        (0, vitest_1.it)('content 为 null → ok:false', () => {
            const data = { choices: [{ message: { content: null } }] };
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)(data, 'openai');
            (0, vitest_1.expect)(result.ok).toBe(false);
        });
    });
    // -------------------- 错误消息格式 --------------------
    (0, vitest_1.describe)('错误消息格式', () => {
        (0, vitest_1.it)('ok:false 时 error 包含 provider 名称', () => {
            const result = (0, aiProxy_logic_1.parseAIProxyResponse)({}, 'deepseek');
            (0, vitest_1.expect)(result.ok).toBe(false);
            (0, vitest_1.expect)(result.error).toBe('deepseek API: empty content');
        });
    });
});
