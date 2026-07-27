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
import { describe, it, expect } from 'vitest';
import {
  buildAIProxyRequest,
  parseAIProxyResponse,
  AI_PROXY_DEFAULT_MODEL_MAP,
  type AIProxyRequestParams,
  type AIProxyRequestSettings,
} from './aiProxy.logic';

// 测试用公共参数：仅覆盖必填字段，各 case 按需覆盖 provider/model/baseUrl 等
function makeParams(overrides: Partial<AIProxyRequestParams>): AIProxyRequestParams {
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
function makeSettings(overrides: Partial<AIProxyRequestSettings> = {}): AIProxyRequestSettings {
  return { apiKey: 'sk-test-key', ...overrides };
}

describe('aiProxy.logic / buildAIProxyRequest', () => {
  // -------------------- provider 分支：URL / headers / body --------------------
  describe('provider 分支', () => {
    it('local: URL={baseUrl}/api/chat，headers 仅 Content-Type，body 含 options.num_predict', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'local' }),
        makeSettings(),
      );
      expect(built.url).toBe('http://localhost:11434/api/chat');
      expect(built.headers).toEqual({ 'Content-Type': 'application/json' });
      // local 不应有 Authorization 头（Ollama 无需 apiKey）
      expect(built.headers.Authorization).toBeUndefined();
      const body = JSON.parse(built.body);
      expect(body.options).toEqual({ temperature: 0.7, num_predict: 2000 });
      // local body 顶层不应有 temperature/max_tokens（Ollama 不识别）
      expect(body.temperature).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      expect(body.stream).toBe(false);
    });

    it('openai: URL={baseUrl}/v1/chat/completions，headers 含 Authorization Bearer', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai' }),
        makeSettings({ apiKey: 'sk-openai-key' }),
      );
      expect(built.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(built.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-openai-key',
      });
      const body = JSON.parse(built.body);
      // openai body 顶层应有 temperature/max_tokens，不应有 options
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(2000);
      expect(body.options).toBeUndefined();
      expect(body.stream).toBe(false);
    });

    it('deepseek: URL={baseUrl}/v1/chat/completions，headers 含 Authorization Bearer', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'deepseek' }),
        makeSettings({ apiKey: 'sk-deepseek-key' }),
      );
      expect(built.url).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(built.headers.Authorization).toBe('Bearer sk-deepseek-key');
      const body = JSON.parse(built.body);
      expect(body.model).toBe('deepseek-chat');
    });

    it('不支持的 provider 抛错（与 handler 一致）', () => {
      expect(() =>
        buildAIProxyRequest(makeParams({ provider: 'bogus' }), makeSettings()),
      ).toThrow(/Unsupported provider: bogus/);
    });
  });

  // -------------------- model 解析优先级 --------------------
  describe('model 解析优先级', () => {
    it('params.model 最优先', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai', model: 'gpt-4-custom' }),
        makeSettings({ model: 'settings-model' }),
      );
      expect(built.model).toBe('gpt-4-custom');
      expect(JSON.parse(built.body).model).toBe('gpt-4-custom');
    });

    it('settings.model 次优先（params.model 缺失时）', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai' }),
        makeSettings({ model: 'settings-model' }),
      );
      expect(built.model).toBe('settings-model');
    });

    it('modelMap[provider] 第三优先（params/settings 均无 model）', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai' }),
        makeSettings(),
      );
      expect(built.model).toBe(AI_PROXY_DEFAULT_MODEL_MAP.openai);
      expect(built.model).toBe('gpt-4o-mini');
    });

    it('deepseek modelMap 回退到 deepseek-chat', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'deepseek' }),
        makeSettings(),
      );
      expect(built.model).toBe('deepseek-chat');
    });

    it('local modelMap 回退到 qwen2.5:7b', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'local' }),
        makeSettings(),
      );
      expect(built.model).toBe('qwen2.5:7b');
    });

    it('所有优先级均缺失时回退到 gpt-4o-mini（兜底）', () => {
      // 用未知 provider 触发兜底：modelMap[未知] === undefined → 回退 'gpt-4o-mini'
      // 但未知 provider 会抛 Unsupported provider 错误，故此处用已知 provider + 清空 modelMap
      // 改为验证 model 解析链的兜底：构造 modelMap 不含的 provider 不可行（会抛错），
      // 改测 settings/params 均无 model 时 openai 回退到 modelMap（已覆盖上一条）。
      // 此处验证 settings.model 为空字符串时（falsy）回退到 modelMap
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai' }),
        makeSettings({ model: '' }),
      );
      expect(built.model).toBe('gpt-4o-mini');
    });
  });

  // -------------------- baseUrl 解析优先级 --------------------
  describe('baseUrl 解析优先级', () => {
    it('params.baseUrl 最优先', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai', baseUrl: 'https://custom.openai.proxy' }),
        makeSettings({ baseUrl: 'https://settings.base' }),
      );
      expect(built.url).toBe('https://custom.openai.proxy/v1/chat/completions');
    });

    it('settings.baseUrl 次优先（params.baseUrl 缺失时）', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai' }),
        makeSettings({ baseUrl: 'https://settings.base' }),
      );
      expect(built.url).toBe('https://settings.base/v1/chat/completions');
    });

    it('DEFAULT_BASE_URL_MAP 第三优先（params/settings 均无 baseUrl）', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'local' }),
        makeSettings(),
      );
      expect(built.url).toBe('http://localhost:11434/api/chat');
    });
  });

  // -------------------- stream / messages 透传 --------------------
  describe('stream / messages 透传', () => {
    it('stream=true 透传到 body', () => {
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai', stream: true }),
        makeSettings(),
      );
      expect(JSON.parse(built.body).stream).toBe(true);
    });

    it('messages 数组原样透传', () => {
      const messages = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ];
      const built = buildAIProxyRequest(
        makeParams({ provider: 'openai', messages }),
        makeSettings(),
      );
      expect(JSON.parse(built.body).messages).toEqual(messages);
    });
  });
});

describe('aiProxy.logic / parseAIProxyResponse', () => {
  // -------------------- local provider --------------------
  describe('local (Ollama) 格式', () => {
    it('data.message.content 正确提取', () => {
      const data = { message: { content: 'Ollama reply' } };
      const result = parseAIProxyResponse(data, 'local');
      expect(result).toEqual({ ok: true, content: 'Ollama reply' });
    });

    it('message.content 缺失 → ok:false', () => {
      const result = parseAIProxyResponse({ message: {} }, 'local');
      expect(result).toEqual({ ok: false, error: 'local API: empty content' });
    });

    it('message 缺失 → ok:false', () => {
      const result = parseAIProxyResponse({}, 'local');
      expect(result.ok).toBe(false);
    });

    it('message.content 为空字符串 → ok:false', () => {
      const result = parseAIProxyResponse({ message: { content: '' } }, 'local');
      expect(result.ok).toBe(false);
    });

    it('message.content 为非字符串（数字）→ ok:false', () => {
      const result = parseAIProxyResponse({ message: { content: 42 } }, 'local');
      expect(result.ok).toBe(false);
    });
  });

  // -------------------- openai / deepseek provider --------------------
  describe('openai / deepseek 格式', () => {
    it('openai: data.choices[0].message.content 正确提取', () => {
      const data = { choices: [{ message: { content: 'OpenAI reply' } }] };
      const result = parseAIProxyResponse(data, 'openai');
      expect(result).toEqual({ ok: true, content: 'OpenAI reply' });
    });

    it('deepseek: data.choices[0].message.content 正确提取', () => {
      const data = { choices: [{ message: { content: 'DeepSeek reply' } }] };
      const result = parseAIProxyResponse(data, 'deepseek');
      expect(result).toEqual({ ok: true, content: 'DeepSeek reply' });
    });

    it('choices 数组为空 → ok:false', () => {
      const result = parseAIProxyResponse({ choices: [] }, 'openai');
      expect(result.ok).toBe(false);
    });

    it('choices[0].message.content 缺失 → ok:false', () => {
      const result = parseAIProxyResponse({ choices: [{ message: {} }] }, 'openai');
      expect(result.ok).toBe(false);
    });

    it('choices 缺失 → ok:false', () => {
      const result = parseAIProxyResponse({}, 'openai');
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain('openai');
    });

    it('content 为空字符串 → ok:false', () => {
      const data = { choices: [{ message: { content: '' } }] };
      const result = parseAIProxyResponse(data, 'openai');
      expect(result.ok).toBe(false);
    });

    it('content 为 null → ok:false', () => {
      const data = { choices: [{ message: { content: null } }] };
      const result = parseAIProxyResponse(data, 'openai');
      expect(result.ok).toBe(false);
    });
  });

  // -------------------- 错误消息格式 --------------------
  describe('错误消息格式', () => {
    it('ok:false 时 error 包含 provider 名称', () => {
      const result = parseAIProxyResponse({}, 'deepseek');
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toBe('deepseek API: empty content');
    });
  });
});
