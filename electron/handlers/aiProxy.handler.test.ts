/**
 * electron/handlers/aiProxy.ts IPC handler 注册层单元测试
 *
 * 测试目标：ai:proxyStream / ai:proxyLLM / ai:saveSettings / ai:loadSettings / ai:abort
 *   的 ipcMain.handle 注册层——参数校验包装、SSRF 防御、加密落盘、'configured' 哨兵返回、
 *   abort controller 控制。
 *
 * 测试策略（参考 main.test.ts 的 vi.hoisted + vi.mock('electron') 模式）：
 * - vi.mock('electron')：提供 ipcMain.handle 捕获注册的 listener 包装函数；safeStorage 可控
 * - vi.mock('../ipcRateLimit')：关闭限流（check 永远返回 null），避免单测间状态污染
 * - vi.mock('./aiProxy.logic')：替换 buildAIProxyRequest/parseAIProxyResponse
 *   （纯函数已在 aiProxy.logic.test.ts 充分覆盖，此处聚焦 handler 胶水层）
 * - vi.mock('node:fs/promises')：控制 aiSettings 文件读写
 * - vi.mock('../logger')：捕获 audit/error 调用，避免 console 噪音
 * - 真实触发 validateAIProxyParams / validateAIProxyLLMParams / isAllowedAiBaseUrl 校验
 *   （这是安全防线，不能 mock 整个 handler）
 *
 * 不修改业务代码，仅新建测试文件。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ============ vi.hoisted：mock 工厂可引用的共享对象 ============
const hoisted = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const fsMock = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
    copyFile: vi.fn(),
    rm: vi.fn(),
    cp: vi.fn(),
  };
  const safeStorageMock = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  };
  const loggerMock = {
    audit: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    write: vi.fn(),
  };
  const buildAIProxyRequestMock = vi.fn(() => ({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    model: 'gpt-4o-mini',
  }));
  const parseAIProxyResponseMock = vi.fn(() => ({ ok: true, content: 'parsed-content' }));
  return {
    TEST_USERDATA: '/tmp/lingxi-test-userdata-aiProxy-handler',
    handlers,
    fsMock,
    safeStorageMock,
    loggerMock,
    buildAIProxyRequestMock,
    parseAIProxyResponseMock,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return hoisted.TEST_USERDATA;
      if (name === 'home') return '/tmp/lingxi-test-home-aiProxy-handler';
      if (name === 'documents') return '/tmp/lingxi-test-home-aiProxy-handler/Documents';
      return '/tmp';
    }),
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      hoisted.handlers.set(channel, listener);
    }),
  },
  safeStorage: hoisted.safeStorageMock,
}));

vi.mock('../logger', () => ({ logger: hoisted.loggerMock }));
vi.mock('../ipcRateLimit', () => ({
  ipcRateLimiter: { check: vi.fn(() => null) },
  RateLimitError: class RateLimitError extends Error {
    constructor(
      public readonly channel: string,
      public readonly senderId: number,
      message: string,
    ) {
      super(message);
      this.name = 'RateLimitError';
    }
  },
}));
vi.mock('./aiProxy.logic', () => ({
  buildAIProxyRequest: hoisted.buildAIProxyRequestMock,
  parseAIProxyResponse: hoisted.parseAIProxyResponseMock,
  AI_PROXY_DEFAULT_MODEL_MAP: { local: 'qwen2.5:7b', openai: 'gpt-4o-mini', deepseek: 'deepseek-chat' },
}));
vi.mock('node:fs/promises', () => ({ default: hoisted.fsMock, ...hoisted.fsMock }));

import { registerAIProxyHandlers, registerAISettingsHandlers } from './aiProxy';

// ============ 测试辅助函数 ============
function makeEvent(overrides: { isDestroyed?: boolean } = {}): {
  sender: {
    id: number;
    isDestroyed: () => boolean;
    send: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
} {
  const sender = {
    id: 1,
    isDestroyed: vi.fn(() => overrides.isDestroyed ?? false),
    send: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  };
  return { sender };
}

function makeProxyStreamParams(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'mock',
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.7,
    maxTokens: 1000,
    requestId: 'ai-12345-abc',
    ...overrides,
  };
}

function makeProxyLLMParams(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    prompt: '请回复连接成功',
    temperature: 0.7,
    maxTokens: 1000,
    requestId: 'ai-12345-abc',
    ...overrides,
  };
}

// 构造 mock fetch 流式响应：chunks 为 SSE 文本块
function makeStreamResponse(chunks: Uint8Array[], opts: { ok?: boolean; status?: number; errText?: string } = {}) {
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  let chunkIdx = 0;
  const reader = {
    read: vi.fn(async () => {
      if (chunkIdx < chunks.length) {
        return { done: false, value: chunks[chunkIdx++] };
      }
      return { done: true, value: undefined };
    }),
  };
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(opts.errText ?? ''),
    body: { getReader: () => reader },
  };
}

function encodeSse(...lines: string[]): Uint8Array[] {
  // 每个 SSE 行以 \n 结尾，整体作为一个 chunk
  return [new TextEncoder().encode(lines.join('\n') + '\n')];
}

// 调用已注册的 handler
async function callHandler(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
  const fn = hoisted.handlers.get(channel);
  if (!fn) throw new Error(`handler not registered: ${channel}`);
  return fn(event, ...args);
}

// ============ 全局 setup ============
beforeAll(() => {
  registerAIProxyHandlers();
  registerAISettingsHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  // 重置 fs 默认行为：文件不存在
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  hoisted.fsMock.readFile.mockRejectedValue(enoent);
  hoisted.fsMock.access.mockRejectedValue(enoent);
  hoisted.fsMock.writeFile.mockResolvedValue(undefined);
  hoisted.fsMock.rename.mockResolvedValue(undefined);
  hoisted.fsMock.unlink.mockResolvedValue(undefined);
  hoisted.fsMock.mkdir.mockResolvedValue(undefined);
  hoisted.fsMock.stat.mockResolvedValue({ size: 0, mtimeMs: 0 });
  hoisted.fsMock.readdir.mockResolvedValue([]);
  hoisted.fsMock.copyFile.mockResolvedValue(undefined);
  hoisted.fsMock.rm.mockResolvedValue(undefined);
  hoisted.fsMock.cp.mockResolvedValue(undefined);
  // 重置 safeStorage 默认行为：可用，加解密为 Buffer/字符串互转
  hoisted.safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
  hoisted.safeStorageMock.encryptString.mockImplementation((s: string) => Buffer.from(s));
  hoisted.safeStorageMock.decryptString.mockImplementation((b: Buffer) => b.toString());
  // 重置 buildAIProxyRequest 默认返回
  hoisted.buildAIProxyRequestMock.mockReturnValue({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    model: 'gpt-4o-mini',
  });
  hoisted.parseAIProxyResponseMock.mockReturnValue({ ok: true, content: 'parsed-content' });
});

// ============ 测试用例 ============

describe('ai:proxyStream handler 注册层', () => {
  describe('参数校验（安全防线）', () => {
    it('params 非对象时抛错（null/undefined/字符串/数字）', async () => {
      const event = makeEvent();
      for (const bad of [null, undefined, 'string', 123]) {
        await expect(callHandler('ai:proxyStream', event, bad)).rejects.toThrow(/params must be/);
      }
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.input', 'ai:proxyStream rejected: invalid params',
        expect.objectContaining({ error: expect.stringMatching(/params must be/) }),
      );
    });

    it('provider 不在白名单时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ provider: 'claude' })))
        .rejects.toThrow(/invalid provider/);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.input', 'ai:proxyStream rejected: invalid params',
        expect.objectContaining({ error: expect.stringMatching(/invalid provider/) }),
      );
    });

    it('messages 空数组时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ messages: [] })))
        .rejects.toThrow(/messages must be/);
    });

    it('temperature 超出 [0,2] 范围时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ temperature: 3 })))
        .rejects.toThrow(/invalid temperature/);
    });

    it('maxTokens 非整数时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ maxTokens: 1.5 })))
        .rejects.toThrow(/invalid maxTokens/);
    });

    it('requestId 含特殊字符时抛错（防 channel 名污染）', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ requestId: 'has space' })))
        .rejects.toThrow(/invalid requestId/);
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ requestId: 'has.dot' })))
        .rejects.toThrow(/invalid requestId/);
    });
  });

  describe('SSRF 防御（isAllowedAiBaseUrl）', () => {
    it('openai provider + 非法 baseUrl（http://evil.com）抛错且不回显 baseUrl', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({
        provider: 'openai',
        baseUrl: 'http://evil.com',
      }))).rejects.toThrow('AI baseUrl 不在允许列表内');
      // 审计日志应记录 ssrf 类别
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.ssrf', 'ai:proxyStream rejected: disallowed baseUrl',
        expect.objectContaining({ baseUrl: 'http://evil.com', provider: 'openai' }),
      );
      // fetch 不应被调用（校验在 fetch 之前）
      // 注意：global.fetch 未 mock 时为 undefined，这里只验证未抛 fetch 相关错误
    });

    it('openai provider + http://127.0.0.1 loopback 也被拒绝（按 provider 强制协议一致）', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({
        provider: 'openai',
        baseUrl: 'http://127.0.0.1:8080',
      }))).rejects.toThrow('AI baseUrl 不在允许列表内');
    });

    it('local provider + https 协议被拒绝（local 必须 http+loopback）', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({
        provider: 'local',
        baseUrl: 'https://localhost:11434',
      }))).rejects.toThrow('AI baseUrl 不在允许列表内');
    });
  });

  describe('流式成功路径', () => {
    it('成功解析 SSE 流并通过 sender.send 推送 chunk/done 事件', async () => {
      const event = makeEvent();
      const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse(
        encodeSse('data: {"choices":[{"delta":{"content":"Hello"}}]}', 'data: [DONE]'),
      ));
      vi.stubGlobal('fetch', fetchMock);

      const result = await callHandler('ai:proxyStream', event, makeProxyStreamParams({ provider: 'openai' }));

      expect(result).toBe('Hello');
      // fetch 被调用一次，URL/headers 来自 buildAIProxyRequest mock
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // chunk 事件推送
      expect(event.sender.send).toHaveBeenCalledWith('ai:stream:chunk:ai-12345-abc', 'Hello');
      // done 事件推送
      expect(event.sender.send).toHaveBeenCalledWith('ai:stream:done:ai-12345-abc', 'Hello');
      // 注册了 destroyed 监听并在 finally 中 off
      expect(event.sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function));
      expect(event.sender.off).toHaveBeenCalledWith('destroyed', expect.any(Function));
      vi.unstubAllGlobals();
    });

    it('sender 已 destroyed 时不调用 send（避免抛错）', async () => {
      const event = makeEvent({ isDestroyed: true });
      const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse(
        encodeSse('data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'),
      ));
      vi.stubGlobal('fetch', fetchMock);

      const result = await callHandler('ai:proxyStream', event, makeProxyStreamParams({ provider: 'openai' }));

      expect(result).toBe('Hi');
      // sender.send 不应被调用（isDestroyed 返回 true）
      expect(event.sender.send).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe('fetch 失败路径', () => {
    it('fetch reject 时转发 ai:stream:error 事件并重新抛出', async () => {
      const event = makeEvent();
      const fetchErr = new Error('network down');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(fetchErr));

      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ provider: 'openai' })))
        .rejects.toThrow('network down');

      expect(event.sender.send).toHaveBeenCalledWith('ai:stream:error:ai-12345-abc', 'network down');
      // 失败日志不记录 messages/content/apiKey
      expect(hoisted.loggerMock.error).toHaveBeenCalledWith(
        'ai:proxyStream failed',
        expect.objectContaining({ requestId: 'ai-12345-abc', provider: 'openai', error: 'network down' }),
      );
      vi.unstubAllGlobals();
    });

    it('HTTP 非 2xx 时抛 HTTP 错误并转发 error 事件', async () => {
      const event = makeEvent();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse([], {
        ok: false, status: 500, errText: 'upstream error',
      })));

      await expect(callHandler('ai:proxyStream', event, makeProxyStreamParams({ provider: 'openai' })))
        .rejects.toThrow(/HTTP 500: upstream error/);

      expect(event.sender.send).toHaveBeenCalledWith(
        'ai:stream:error:ai-12345-abc',
        expect.stringMatching(/HTTP 500/),
      );
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'ai.http', 'AI provider returned non-2xx',
        expect.objectContaining({ status: 500, requestId: 'ai-12345-abc' }),
      );
      vi.unstubAllGlobals();
    });
  });
});

describe('ai:proxyLLM handler 注册层', () => {
  describe('参数校验', () => {
    it('params 非对象时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyLLM', event, null)).rejects.toThrow(/params must be/);
    });

    it('prompt 为空字符串时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyLLM', event, makeProxyLLMParams({ prompt: '' })))
        .rejects.toThrow(/non-empty string/);
    });

    it('provider 非法时抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyLLM', event, makeProxyLLMParams({ provider: 'claude' })))
        .rejects.toThrow(/invalid provider/);
    });
  });

  describe('SSRF 防御', () => {
    it('openai provider + 非法 baseUrl 抛错', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:proxyLLM', event, makeProxyLLMParams({
        baseUrl: 'http://evil.com',
      }))).rejects.toThrow('AI baseUrl 不在允许列表内');
    });
  });

  describe('非流式成功/失败路径', () => {
    it('成功返回 {ok:true, content}', async () => {
      const event = makeEvent();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'reply' } }] }),
      }));

      const result = await callHandler('ai:proxyLLM', event, makeProxyLLMParams());
      expect(result).toEqual({ ok: true, content: 'parsed-content' });
      // parseAIProxyResponse 被调用
      expect(hoisted.parseAIProxyResponseMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('HTTP 非 2xx 返回 {ok:false, error, status}', async () => {
      const event = makeEvent();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      }));

      const result = await callHandler('ai:proxyLLM', event, makeProxyLLMParams());
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/HTTP 429/), status: 429 });
      vi.unstubAllGlobals();
    });

    it('fetch reject 返回 {ok:false, error}（不抛出）', async () => {
      const event = makeEvent();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const result = await callHandler('ai:proxyLLM', event, makeProxyLLMParams());
      expect(result).toEqual({ ok: false, error: 'timeout' });
      expect(hoisted.loggerMock.error).toHaveBeenCalledWith(
        'ai:proxyLLM failed',
        expect.objectContaining({ requestId: 'ai-12345-abc', error: 'timeout' }),
      );
      vi.unstubAllGlobals();
    });
  });
});

describe('ai:saveSettings handler 注册层', () => {
  function makeSettings(overrides: Record<string, unknown> = {}) {
    return {
      apiKey: 'sk-test-key',
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      ...overrides,
    };
  }

  describe('参数校验', () => {
    it('settings 非对象返回 false', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:saveSettings', event, null)).resolves.toBe(false);
      await expect(callHandler('ai:saveSettings', event, 'string')).resolves.toBe(false);
    });

    it('provider 不在白名单返回 false', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:saveSettings', event, makeSettings({ provider: 'claude' })))
        .resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.input', 'ai:saveSettings rejected: invalid provider',
        expect.objectContaining({ provider: 'claude' }),
      );
    });

    it('temperature 非有限数字返回 false', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:saveSettings', event, makeSettings({ temperature: NaN })))
        .resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.input', 'ai:saveSettings rejected: invalid temperature',
      );
    });

    it('maxTokens 非有限数字返回 false', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:saveSettings', event, makeSettings({ maxTokens: Infinity })))
        .resolves.toBe(false);
    });

    it('apiKey/baseUrl/model 类型错返回 false', async () => {
      const event = makeEvent();
      await expect(callHandler('ai:saveSettings', event, makeSettings({ apiKey: 123 })))
        .resolves.toBe(false);
      await expect(callHandler('ai:saveSettings', event, makeSettings({ baseUrl: null })))
        .resolves.toBe(false);
      await expect(callHandler('ai:saveSettings', event, makeSettings({ model: {} })))
        .resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.input', 'ai:saveSettings rejected: invalid field types',
      );
    });
  });

  describe('加密落盘', () => {
    it('safeStorage 可用时加密 apiKey 并原子写盘返回 true', async () => {
      const event = makeEvent();
      hoisted.safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
      hoisted.safeStorageMock.encryptString.mockReturnValue(Buffer.from('encrypted-secret'));

      const result = await callHandler('ai:saveSettings', event, makeSettings({ apiKey: 'sk-plain-key' }));
      expect(result).toBe(true);

      // apiKey 被加密
      expect(hoisted.safeStorageMock.encryptString).toHaveBeenCalledWith('sk-plain-key');
      // 临时文件写入 + rename 原子落盘
      expect(hoisted.fsMock.writeFile).toHaveBeenCalledTimes(1);
      const writtenContent = hoisted.fsMock.writeFile.mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent);
      // 落盘的 apiKey 应是 base64 加密串，不是明文
      expect(written.apiKey).toBe(Buffer.from('encrypted-secret').toString('base64'));
      expect(written.apiKey).not.toBe('sk-plain-key');
      expect(written.provider).toBe('openai');
      expect(hoisted.fsMock.rename).toHaveBeenCalledTimes(1);
      // finally 中清理 tmp
      expect(hoisted.fsMock.unlink).toHaveBeenCalledTimes(1);
    });

    it('safeStorage 不可用时 apiKey 写空字符串（拒绝明文落盘）', async () => {
      const event = makeEvent();
      hoisted.safeStorageMock.isEncryptionAvailable.mockReturnValue(false);

      const result = await callHandler('ai:saveSettings', event, makeSettings({ apiKey: 'sk-plain-key' }));
      expect(result).toBe(true);

      expect(hoisted.safeStorageMock.encryptString).not.toHaveBeenCalled();
      const writtenContent = hoisted.fsMock.writeFile.mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent);
      // 明文 apiKey 被替换为空字符串
      expect(written.apiKey).toBe('');
      expect(written.provider).toBe('openai');
    });

    it('safeStorage 加密抛错时 apiKey 写空字符串', async () => {
      const event = makeEvent();
      hoisted.safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
      hoisted.safeStorageMock.encryptString.mockImplementation(() => {
        throw new Error('encrypt failed');
      });

      const result = await callHandler('ai:saveSettings', event, makeSettings({ apiKey: 'sk-plain-key' }));
      expect(result).toBe(true);

      const writtenContent = hoisted.fsMock.writeFile.mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent);
      expect(written.apiKey).toBe('');
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.crypto', 'ai:saveSettings: encrypt apiKey failed',
        expect.objectContaining({ provider: 'openai' }),
      );
    });
  });
});

describe('ai:loadSettings handler 注册层', () => {
  it('aiSettings 文件不存在时返回 null', async () => {
    const event = makeEvent();
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    hoisted.fsMock.access.mockRejectedValue(enoent);

    const result = await callHandler('ai:loadSettings', event);
    expect(result).toBeNull();
  });

  it('有 apiKey 且解密成功时返回 configured 哨兵 + hasApiKey:true，不返回明文', async () => {
    const event = makeEvent();
    hoisted.fsMock.access.mockResolvedValue(undefined);
    const encryptedB64 = Buffer.from('encrypted-api-key').toString('base64');
    hoisted.fsMock.readFile.mockResolvedValue(JSON.stringify({
      apiKey: encryptedB64,
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      temperature: 0.5,
      maxTokens: 2000,
    }));

    const result = await callHandler('ai:loadSettings', event) as Record<string, unknown>;
    expect(result.apiKey).toBe('configured');
    expect(result.hasApiKey).toBe(true);
    // 不应返回明文 apiKey
    expect(result.apiKey).not.toBe(encryptedB64);
    expect(hoisted.safeStorageMock.decryptString).toHaveBeenCalledTimes(1);
  });

  it('解密失败时返回 apiKey:"" + hasApiKey:false（让用户重新输入）', async () => {
    const event = makeEvent();
    hoisted.fsMock.access.mockResolvedValue(undefined);
    hoisted.fsMock.readFile.mockResolvedValue(JSON.stringify({
      apiKey: 'not-valid-base64-encrypted',
      provider: 'openai',
    }));
    hoisted.safeStorageMock.decryptString.mockImplementation(() => {
      throw new Error('decrypt failed');
    });

    const result = await callHandler('ai:loadSettings', event) as Record<string, unknown>;
    expect(result.apiKey).toBe('');
    expect(result.hasApiKey).toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.crypto', 'ai:loadSettings: decrypt apiKey failed',
      expect.objectContaining({ provider: 'openai' }),
    );
  });

  it('无 apiKey 字段时返回 apiKey:"" + hasApiKey:false', async () => {
    const event = makeEvent();
    hoisted.fsMock.access.mockResolvedValue(undefined);
    hoisted.fsMock.readFile.mockResolvedValue(JSON.stringify({
      provider: 'mock',
      baseUrl: '',
    }));

    const result = await callHandler('ai:loadSettings', event) as Record<string, unknown>;
    expect(result.apiKey).toBe('');
    expect(result.hasApiKey).toBe(false);
    expect(hoisted.safeStorageMock.decryptString).not.toHaveBeenCalled();
  });
});

describe('ai:abort handler 注册层', () => {
  it('requestId 非字符串返回 false', async () => {
    const event = makeEvent();
    await expect(callHandler('ai:abort', event, 123)).resolves.toBe(false);
    await expect(callHandler('ai:abort', event, null)).resolves.toBe(false);
    await expect(callHandler('ai:abort', event, {})).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.schema', 'ai:abort rejected: invalid requestId',
    );
  });

  it('requestId 空字符串返回 false', async () => {
    const event = makeEvent();
    await expect(callHandler('ai:abort', event, '')).resolves.toBe(false);
  });

  it('requestId 含特殊字符返回 false', async () => {
    const event = makeEvent();
    await expect(callHandler('ai:abort', event, 'has space')).resolves.toBe(false);
    await expect(callHandler('ai:abort', event, 'has.dot')).resolves.toBe(false);
    await expect(callHandler('ai:abort', event, 'has/slash')).resolves.toBe(false);
  });

  it('requestId 超长（>128）返回 false', async () => {
    const event = makeEvent();
    await expect(callHandler('ai:abort', event, 'a'.repeat(129))).resolves.toBe(false);
  });

  it('requestId 合法但无对应 controller 时返回 true（幂等）', async () => {
    const event = makeEvent();
    await expect(callHandler('ai:abort', event, 'ai-nonexistent-request-id')).resolves.toBe(true);
  });

  it('requestId 合法且有进行中 controller 时触发 abort（proxyStream 返回空内容）', async () => {
    // 用 signal-aware fetch：监听 abort 事件并 reject AbortError
    const event = makeEvent();
    const fetchMock = vi.fn().mockImplementation((_url: string, opts: { signal?: { aborted: boolean; addEventListener: (e: string, cb: () => void) => void } }) => {
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal;
        if (!signal) return;
        if (signal.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const requestId = 'ai-abort-test-001';
    // 启动 proxyStream（fetch 永不主动 resolve，等待 abort 触发）
    const proxyPromise = callHandler('ai:proxyStream', event, makeProxyStreamParams({
      provider: 'openai',
      requestId,
    }));

    // 等 fetch 被调用（说明 abortController 已注册到 Map）
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // 触发 abort
    const abortResult = await callHandler('ai:abort', event, requestId);
    expect(abortResult).toBe(true);

    // proxyStream 应以 abort 视为正常完成，返回空内容
    const proxyResult = await proxyPromise;
    expect(proxyResult).toBe('');
    // abort 路径发送 done 事件（空内容），不发送 error 事件
    expect(event.sender.send).toHaveBeenCalledWith(`ai:stream:done:${requestId}`, '');
    expect(event.sender.send).not.toHaveBeenCalledWith(
      `ai:stream:error:${requestId}`, expect.anything(),
    );
    vi.unstubAllGlobals();
  });
});
