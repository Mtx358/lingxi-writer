/**
 * src/utils/llmClient.ts 单元测试
 *
 * 测试目标：
 *   - 纯函数（buildMessages/resolveModel/ensureHtmlParagraphs/clampScore/delay）
 *   - callLLM：3 种 provider happy path + HTTP 错误 + 超时 + 空响应 + mock provider 拒绝
 *   - callLLMStream Web 直连：SSE / NDJSON / 跨 chunk 缓冲 / 超时 / 用户中止 / 网络错误
 *   - callLLMStreamViaProxy：Electron IPC 代理 / 用户中止 / 错误转发
 *   - testConnection：mock / 真实 provider
 *
 * 测试策略：
 *   - 纯函数直接断言
 *   - callLLM：vi.spyOn(global, 'fetch') mock Response
 *   - callLLMStream Web 直连：用 ReadableStream 构造响应流，需临时移除 window.electronAPI!.ai.proxyStream
 *     让代码走 Web 直连分支
 *   - callLLMStreamViaProxy：tests/setup.ts 已 mock window.electronAPI!.ai.proxyStream，
 *     用 vi.mocked(...) 控制回调触发
 *   - 超时：vi.useFakeTimers() + advanceTimersByTime
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient, llmClient } from './llmClient';

// ============ 工具：构造 fetch Response ============
function makeJsonResponse(body: unknown, ok = true, status = 200, statusText = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  } as unknown as Response;
}

function makeStreamResponse(chunks: Uint8Array[], ok = true, status = 200, statusText = 'OK'): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    ok,
    status,
    statusText,
    body: stream,
  } as unknown as Response;
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// 构造 AbortError（模拟 fetch 被 signal 中止时抛出的 DOMException）
function makeAbortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

// ============ 纯函数测试 ============
describe('LLMClient 纯函数', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient();
  });

  describe('buildMessages', () => {
    it('无 systemPrompt 时只有 user 消息', () => {
      const msgs = client.buildMessages('hello');
      expect(msgs).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('有 systemPrompt 时 system 在前', () => {
      const msgs = client.buildMessages('hello', 'you are assistant');
      expect(msgs).toEqual([
        { role: 'system', content: 'you are assistant' },
        { role: 'user', content: 'hello' },
      ]);
    });
  });

  describe('resolveModel', () => {
    it('settings.model 优先', () => {
      client.updateSettings({ provider: 'openai', model: 'gpt-4' });
      expect(client.resolveModel()).toBe('gpt-4');
    });

    it('provider=local 默认 qwen2.5:7b', () => {
      client.updateSettings({ provider: 'local', model: undefined });
      expect(client.resolveModel()).toBe('qwen2.5:7b');
    });

    it('provider=openai 默认 gpt-4o-mini', () => {
      client.updateSettings({ provider: 'openai', model: undefined });
      expect(client.resolveModel()).toBe('gpt-4o-mini');
    });

    it('provider=deepseek 默认 deepseek-chat', () => {
      client.updateSettings({ provider: 'deepseek', model: undefined });
      expect(client.resolveModel()).toBe('deepseek-chat');
    });

    it('provider=mock 无映射，回退 gpt-4o-mini', () => {
      client.updateSettings({ provider: 'mock', model: undefined });
      expect(client.resolveModel()).toBe('gpt-4o-mini');
    });
  });

  describe('ensureHtmlParagraphs', () => {
    it('裸文本按换行分段为 <p>', () => {
      const result = client.ensureHtmlParagraphs('第一行\n第二行\n第三行');
      expect(result).toBe('<p>第一行</p><p>第二行</p><p>第三行</p>');
    });

    it('已是 <p> 包裹的 HTML 原样返回', () => {
      const html = '<p>已有段落</p>';
      expect(client.ensureHtmlParagraphs(html)).toBe(html);
    });

    it('已是 <p class="x"> 带属性的 HTML 原样返回', () => {
      const html = '<p class="x">内容</p>';
      expect(client.ensureHtmlParagraphs(html)).toBe(html);
    });

    it('```html 围栏被剥离', () => {
      const result = client.ensureHtmlParagraphs('```html\n裸文本\n```');
      expect(result).toBe('<p>裸文本</p>');
    });

    it('``` 围栏（无 lang）被剥离', () => {
      const result = client.ensureHtmlParagraphs('```\n裸文本\n```');
      expect(result).toBe('<p>裸文本</p>');
    });

    it('空字符串返回空', () => {
      expect(client.ensureHtmlParagraphs('')).toBe('');
    });

    it('仅空白返回空', () => {
      expect(client.ensureHtmlParagraphs('   \n  \n  ')).toBe('');
    });
  });

  describe('clampScore', () => {
    it('合法数字原样返回（整数）', () => {
      expect(client.clampScore(50)).toBe(50);
      expect(client.clampScore(0)).toBe(0);
      expect(client.clampScore(100)).toBe(100);
    });

    it('小数四舍五入', () => {
      expect(client.clampScore(50.4)).toBe(50);
      expect(client.clampScore(50.5)).toBe(51);
    });

    it('负数夹紧到 0', () => {
      expect(client.clampScore(-10)).toBe(0);
    });

    it('超 100 夹紧到 100', () => {
      expect(client.clampScore(200)).toBe(100);
    });

    it('NaN 返回 50（默认中位数）', () => {
      expect(client.clampScore(NaN)).toBe(50);
    });

    it('字符串数字被转换', () => {
      expect(client.clampScore('75')).toBe(75);
    });

    it('无效字符串返回 50', () => {
      expect(client.clampScore('abc')).toBe(50);
    });

    it('null 返回 0（Number(null)===0，非 NaN）', () => {
      // Number(null) === 0，所以 clampScore(null) === 0
      // 这是 JavaScript 语义，非 bug：null 被当作 0 处理
      expect(client.clampScore(null)).toBe(0);
    });

    it('undefined 返回 50（Number(undefined)===NaN）', () => {
      expect(client.clampScore(undefined)).toBe(50);
    });
  });

  describe('delay', () => {
    it('等待指定毫秒后 resolve', async () => {
      const start = Date.now();
      await client.delay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe('updateSettings / getSettings', () => {
    it('updateSettings 合并字段', () => {
      client.updateSettings({ temperature: 0.9 });
      expect(client.getSettings().temperature).toBe(0.9);
    });

    it('getSettings 返回副本（防外部篡改）', () => {
      const s1 = client.getSettings();
      s1.temperature = 999;
      const s2 = client.getSettings();
      expect(s2.temperature).not.toBe(999);
    });
  });

  describe('getTotalTokensUsed', () => {
    it('初始值为 0', () => {
      expect(client.getTotalTokensUsed()).toBe(0);
    });
  });
});

// ============ callLLM 测试 ============
describe('callLLM', () => {
  let client: LLMClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    client = new LLMClient();
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('openai provider 成功返回 content', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk-test' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: '你好' } }],
    }));
    const result = await client.callLLM('hi');
    expect(result).toBe('你好');
    // 验证请求 URL 与 headers
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions');
    const opts = callArgs[1] as RequestInit;
    expect(opts.method).toBe('POST');
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
  });

  it('deepseek provider 使用 deepseek baseUrl', async () => {
    client.updateSettings({ provider: 'deepseek', apiKey: 'sk-ds' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: 'hi' } }],
    }));
    await client.callLLM('hi');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('openai provider 自定义 baseUrl 优先', async () => {
    client.updateSettings({ provider: 'openai', baseUrl: 'https://my-proxy.com', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: 'hi' } }],
    }));
    await client.callLLM('hi');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://my-proxy.com/v1/chat/completions');
  });

  it('local (Ollama) provider 使用 message.content 路径', async () => {
    client.updateSettings({ provider: 'local', baseUrl: 'http://localhost:11434' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      message: { content: '本地响应' },
    }));
    const result = await client.callLLM('hi');
    expect(result).toBe('本地响应');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
    // local provider 无 Authorization header
    const opts = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('local provider 默认 localhost:11434', async () => {
    client.updateSettings({ provider: 'local', baseUrl: undefined });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      message: { content: 'hi' },
    }));
    await client.callLLM('hi');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
  });

  it('local provider body 用 options.temperature + num_predict 嵌套结构（M1 修复：maxTokens → num_predict）', async () => {
    client.updateSettings({ provider: 'local', temperature: 0.5, maxTokens: 2048 });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      message: { content: 'hi' },
    }));
    await client.callLLM('hi');
    const opts = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    // Ollama 不识别顶层 temperature/max_tokens，需放入 options
    expect(body.options).toEqual({ temperature: 0.5, num_predict: 2048 });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it('openai provider body 用顶层 temperature + max_tokens', async () => {
    client.updateSettings({ provider: 'openai', temperature: 0.7, maxTokens: 1000 });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: 'hi' } }],
    }));
    await client.callLLM('hi');
    const opts = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(1000);
    expect(body.options).toBeUndefined();
  });

  it('body 含 messages（system + user）', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: 'hi' } }],
    }));
    await client.callLLM('user prompt', 'system prompt');
    const opts = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('mock provider 抛错', async () => {
    client.updateSettings({ provider: 'mock' });
    await expect(client.callLLM('hi')).rejects.toThrow('Mock provider: should not call callLLM');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('未知 provider 在 callLLM 早期检查阶段抛错（不会进入 resolveEndpoint）', async () => {
    // callLLM 先检查 provider !== 'local' && !== 'openai' && !== 'deepseek'
    // 所以 'unknown' 会先抛 'Mock provider: should not call callLLM'，
    // 不会进入 resolveEndpoint（后者才抛 'Unsupported provider'）
    client.updateSettings({ provider: 'unknown' as never });
    await expect(client.callLLM('hi')).rejects.toThrow('Mock provider: should not call callLLM');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP 4xx 抛错含状态码', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({}, false, 401, 'Unauthorized'));
    await expect(client.callLLM('hi')).rejects.toThrow('openai API error: 401 Unauthorized');
  });

  it('HTTP 5xx 抛错含状态码', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({}, false, 500, 'Internal Server Error'));
    await expect(client.callLLM('hi')).rejects.toThrow('openai API error: 500 Internal Server Error');
  });

  it('空响应抛错', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: '' } }],
    }));
    await expect(client.callLLM('hi')).rejects.toThrow('empty content');
  });

  it('openai 响应缺 choices 字段抛错', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({}));
    await expect(client.callLLM('hi')).rejects.toThrow('empty content');
  });

  it('local 响应缺 message 字段抛错', async () => {
    client.updateSettings({ provider: 'local' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({}));
    await expect(client.callLLM('hi')).rejects.toThrow('empty content');
  });

  it('网络错误透传', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    await expect(client.callLLM('hi')).rejects.toThrow('network down');
  });

  it('30s 超时抛友好错误', async () => {
    vi.useFakeTimers();
    try {
      client.updateSettings({ provider: 'openai', apiKey: 'sk' });
      // fetch mock 需响应 signal abort：当 signal.aborted 时 reject with AbortError
      // 否则 fake timer 下 promise 永不 settle，测试会超时
      fetchSpy.mockImplementationOnce((_url: unknown, opts: RequestInit) => new Promise((_, reject) => {
        const signal = opts.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      }));
      const promise = client.callLLM('hi');
      // 同步附加 catch handler，避免 advanceTimersByTimeAsync 触发 reject 后
      // 在 await expect 之前出现 unhandledRejection
      const caughtPromise = promise.catch(e => e as Error);
      // 推进 30s 触发 timeoutController.abort()
      await vi.advanceTimersByTimeAsync(30_000);
      const err = await caughtPromise as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('AI 请求超时（30s）');
      // 清理 fake timer 期间注册但未执行的 pending timers，避免切换回 real timer 后触发 unhandled rejection
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============ callLLMViaProxy 测试（Electron 环境走主进程代理） ============
describe('callLLM ViaProxy（Electron IPC 代理）', () => {
  let client: LLMClient;
  let originalProxyLLM: unknown;

  beforeEach(() => {
    client = new LLMClient();
    client.updateSettings({ provider: 'openai', apiKey: 'should-not-be-used', model: 'gpt-4o-mini' });
    // 临时注入 proxyLLM mock，模拟 Electron 环境
    originalProxyLLM = window.electronAPI?.ai?.proxyLLM;
    if (window.electronAPI?.ai) {
      (window.electronAPI.ai as unknown as Record<string, unknown>).proxyLLM = vi.fn();
    }
  });

  afterEach(() => {
    // 恢复
    if (window.electronAPI?.ai) {
      (window.electronAPI.ai as unknown as Record<string, unknown>).proxyLLM = originalProxyLLM;
    }
    vi.restoreAllMocks();
  });

  it('Electron 环境走 proxyLLM 代理（不使用 apiKey 直接 fetch）', async () => {
    const proxyLLMMock = window.electronAPI!.ai.proxyLLM as ReturnType<typeof vi.fn>;
    proxyLLMMock.mockResolvedValue({ ok: true, content: '代理返回的内容' });

    const result = await client.callLLM('你好', '系统提示');

    expect(result).toBe('代理返回的内容');
    // proxyLLM 被调用，入参不含 apiKey
    expect(proxyLLMMock).toHaveBeenCalledTimes(1);
    const callArg = proxyLLMMock.mock.calls[0][0];
    expect(callArg.prompt).toBe('你好');
    expect(callArg.systemPrompt).toBe('系统提示');
    expect(callArg.provider).toBe('openai');
    expect(callArg.model).toBe('gpt-4o-mini');
    // 关键：入参中不含 apiKey
    expect(callArg.apiKey).toBeUndefined();
    expect(callArg).not.toHaveProperty('apiKey');
  });

  it('proxyLLM 返回 ok:false 时抛错', async () => {
    const proxyLLMMock = window.electronAPI!.ai.proxyLLM as ReturnType<typeof vi.fn>;
    proxyLLMMock.mockResolvedValue({ ok: false, error: 'API error 401', status: 401 });

    await expect(client.callLLM('hi')).rejects.toThrow('API error 401');
  });

  it('proxyLLM 自身抛错时向上传播', async () => {
    const proxyLLMMock = window.electronAPI!.ai.proxyLLM as ReturnType<typeof vi.fn>;
    proxyLLMMock.mockRejectedValue(new Error('IPC timeout'));

    await expect(client.callLLM('hi')).rejects.toThrow('IPC timeout');
  });

  it('无 proxyLLM 时回退到 web 直连（fetch）', async () => {
    // 移除 proxyLLM，模拟 web 环境
    delete (window.electronAPI!.ai as unknown as Record<string, unknown>).proxyLLM;

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: 'web 回退' } }],
    }));

    const result = await client.callLLM('hi');
    expect(result).toBe('web 回退');
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ============ testConnection 测试 ============
describe('testConnection', () => {
  let client: LLMClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    client = new LLMClient();
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('mock provider 直接返回成功', async () => {
    client.updateSettings({ provider: 'mock' });
    const result = await client.testConnection();
    expect(result.success).toBe(true);
    expect(result.message).toContain('Mock');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('真实 provider 成功', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({
      choices: [{ message: { content: '连接成功' } }],
    }));
    const result = await client.testConnection();
    expect(result.success).toBe(true);
    expect(result.message).toContain('连接成功');
  });

  it('真实 provider 失败返回 success:false', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeJsonResponse({}, false, 401, 'Unauthorized'));
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('连接失败');
    expect(result.message).toContain('401');
  });

  it('真实 provider 网络错误返回 success:false', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('network down');
  });
});

// ============ callLLMStream Web 直连测试 ============
// 这组测试需要临时移除 window.electronAPI!.ai.proxyStream，让代码走 Web 直连分支
describe('callLLMStream Web 直连', () => {
  let client: LLMClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  let savedProxyStream: unknown;

  beforeEach(() => {
    client = new LLMClient();
    fetchSpy = vi.spyOn(global, 'fetch');
    // 临时移除 proxyStream，强制走 Web 直连
    savedProxyStream = window.electronAPI!.ai.proxyStream;
    // 用 Object.defineProperty 确保覆盖 setup.ts 中的 mock
    Object.defineProperty(window.electronAPI!.ai, 'proxyStream', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    // 恢复 proxyStream
    Object.defineProperty(window.electronAPI!.ai, 'proxyStream', {
      value: savedProxyStream,
      writable: true,
      configurable: true,
    });
    vi.useRealTimers();
  });

  it('OpenAI SSE 格式：onChunk 多次触发，onComplete 一次', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
      'data: {"choices":[{"delta":{"content":"世界"}}]}\n',
      'data: [DONE]\n',
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(sseChunks.map(encode)));

    const chunks: string[] = [];
    let completeContent: string | null = null;
    const result = await client.callLLMStream('hi', undefined, {
      onChunk: c => chunks.push(c),
      onComplete: c => { completeContent = c; },
      onError: () => { /* 不应触发 */ },
    });

    expect(result).toBe('你好世界');
    expect(chunks).toEqual(['你好', '世界']);
    expect(completeContent).toBe('你好世界');
  });

  it('OpenAI SSE 跨 chunk 半行：sseBuffer 正确缓冲拼接', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    // 故意把一行 JSON 拆到两个 chunk 中
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"片段',
      'A"}}]}\ndata: {"choices":[{"delta":{"content":"片段B"}}]}\ndata: [DONE]\n',
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(sseChunks.map(encode)));

    const chunks: string[] = [];
    const result = await client.callLLMStream('hi', undefined, {
      onChunk: c => chunks.push(c),
      onComplete: () => {},
      onError: () => {},
    });

    expect(result).toBe('片段A片段B');
    expect(chunks).toEqual(['片段A', '片段B']);
  });

  it('OpenAI SSE 末尾无 [DONE] 也应正常完成（流结束触发 onComplete）', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"无"}}]}\n',
      'data: {"choices":[{"delta":{"content":"DONE"}}]}\n',
      // 没有 [DONE]，靠流关闭结束
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(sseChunks.map(encode)));

    let completeCalled = false;
    const result = await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    });

    expect(result).toBe('无DONE');
    expect(completeCalled).toBe(true);
  });

  it('Ollama NDJSON 格式：done:true 触发完成', async () => {
    client.updateSettings({ provider: 'local' });
    const ndjsonChunks = [
      '{"message":{"content":"第一段"},"done":false}\n',
      '{"message":{"content":"第二段"},"done":false}\n',
      '{"message":{"content":""},"done":true}\n',
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(ndjsonChunks.map(encode)));

    const chunks: string[] = [];
    const result = await client.callLLMStream('hi', undefined, {
      onChunk: c => chunks.push(c),
      onComplete: () => {},
      onError: () => {},
    });

    expect(result).toBe('第一段第二段');
    expect(chunks).toEqual(['第一段', '第二段']);
  });

  it('Ollama NDJSON keep-alive 空行被跳过', async () => {
    client.updateSettings({ provider: 'local' });
    const ndjsonChunks = [
      '\n',  // keep-alive 空行
      '{"message":{"content":"内容"}}\n',
      '\n',
      '{"done":true}\n',
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(ndjsonChunks.map(encode)));

    const result = await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    });

    expect(result).toBe('内容');
  });

  it('SSE 解析失败行被静默跳过', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    const sseChunks = [
      'data: {invalid json}\n',  // 解析失败
      'data: {"choices":[{"delta":{"content":"有效"}}]}\n',
      'data: [DONE]\n',
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(sseChunks.map(encode)));

    const result = await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    });

    expect(result).toBe('有效');
  });

  it('HTTP 错误触发 onError + throw', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce(makeStreamResponse([], false, 500, 'Internal'));

    let errorCaught: Error | null = null;
    await expect(client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: e => { errorCaught = e; },
    })).rejects.toThrow('API error: 500');

    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toContain('500');
  });

  it('无 response body 抛错', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
    } as unknown as Response);

    await expect(client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    })).rejects.toThrow('No response body');
  });

  it('网络错误触发 onError + throw', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    let errorCaught: Error | null = null;
    await expect(client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: e => { errorCaught = e; },
    })).rejects.toThrow('network down');

    expect(errorCaught!.message).toBe('network down');
  });

  it('用户主动 abort：保留已生成内容，触发 onComplete', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    const controller = new AbortController();
    // 第一个 chunk 正常，然后用户 abort
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"已生成"}}]}\n',
    ];
    fetchSpy.mockResolvedValueOnce(makeStreamResponse(sseChunks.map(encode)));

    let completeContent: string | null = null;
    let errorCalled = false;
    const promise = client.callLLMStream('hi', undefined, {
      onChunk: () => { controller.abort(); },
      onComplete: c => { completeContent = c; },
      onError: () => { errorCalled = true; },
    }, controller.signal);

    const result = await promise;
    expect(result).toBe('已生成');
    expect(completeContent).toBe('已生成');
    expect(errorCalled).toBe(false);
  });

  it('signal 已 aborted：立即返回空字符串', async () => {
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    const controller = new AbortController();
    controller.abort();

    let completeCalled = false;
    const result = await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    }, controller.signal);

    expect(result).toBe('');
    // signal 已 aborted 时早退，不触发 onComplete（直接 return）
    expect(completeCalled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mock provider 抛错（不支持流式）', async () => {
    client.updateSettings({ provider: 'mock' });
    await expect(client.callLLMStream('hi')).rejects.toThrow('Streaming not supported for provider: mock');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('30s 空闲超时（无 chunk 到达）：触发 onError + throw，消息含 30s（M2 修复）', async () => {
    vi.useFakeTimers();
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
    // fetch mock 需响应 signal abort，否则 fake timer 下 promise 永不 settle
    fetchSpy.mockImplementationOnce((_url: unknown, opts: RequestInit) => new Promise((_, reject) => {
      const signal = opts.signal as AbortSignal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    }));

    let errorCaught: Error | null = null;
    const promise = client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: e => { errorCaught = e; },
    });
    // 同步附加 catch handler，避免 advanceTimersByTimeAsync 触发 reject 后
    // 在 await expect 之前出现 unhandledRejection
    const caughtPromise = promise.catch(e => e as Error);

    // 无 chunk 到达时，30s 空闲超时先触发（M2 修复：timedOutBy='inactivity'，消息含 30s）
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await caughtPromise as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('AI 响应超时');
    expect(err.message).toContain('30s');
    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toContain('30s');
    // 清理 fake timer 期间注册但未执行的 pending timers
    vi.clearAllTimers();
  });
});

// ============ callLLMStreamViaProxy 测试 ============
describe('callLLMStreamViaProxy（Electron IPC 代理）', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient();
    client.updateSettings({ provider: 'openai', apiKey: 'sk' });
  });

  it('成功：onChunk 多次触发，onComplete 一次', async () => {
    const chunks: string[] = [];
    let completeContent: string | null = null;

    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      _params: unknown,
      onChunk: (c: string) => void,
      onDone: (c: string) => void,
      _onError: (e: string) => void,
    ) => ({
      promise: new Promise<string>(resolve => {
        // 模拟主进程：依次触发 chunk，最后 done
        setTimeout(() => {
          onChunk('第一');
          onChunk('第二');
          onDone('第一第二');
          resolve('第一第二');
        }, 0);
      }),
      cleanup: vi.fn(),
    }));

    const result = await client.callLLMStream('hi', undefined, {
      onChunk: c => chunks.push(c),
      onComplete: c => { completeContent = c; },
      onError: () => { /* 不应触发 */ },
    });

    expect(result).toBe('第一第二');
    expect(chunks).toEqual(['第一', '第二']);
    expect(completeContent).toBe('第一第二');
  });

  it('主进程 onError：handler.onError 触发 + throw', async () => {
    let errorCaught: Error | null = null;

    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      _params: unknown,
      _onChunk: (c: string) => void,
      _onDone: (c: string) => void,
      onError: (e: string) => void,
    ) => ({
      promise: new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          onError('主进程错误');
          reject(new Error('主进程错误'));
        }, 0);
      }),
      cleanup: vi.fn(),
    }));

    await expect(client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: e => { errorCaught = e; },
    })).rejects.toThrow('主进程错误');

    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toBe('主进程错误');
  });

  it('主进程 onError + promise reject：onError 只触发一次（M3 修复：不再重复调用）', async () => {
    let onErrorCallCount = 0;

    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      _params: unknown,
      _onChunk: (c: string) => void,
      _onDone: (c: string) => void,
      onError: (e: string) => void,
    ) => ({
      // 模拟主进程行为：先通过 IPC 发送 error 事件（触发 onError 回调），
      // 然后 throw 使 invoke promise reject（原实现会再次调用 onError）
      promise: new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          onError('主进程错误');
          reject(new Error('主进程错误'));
        }, 0);
      }),
      cleanup: vi.fn(),
    }));

    await expect(client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => { onErrorCallCount++; },
    })).rejects.toThrow('主进程错误');

    // M3 修复后：errorHandledViaIPC 标志阻止 catch 块重复调用 onError
    expect(onErrorCallCount).toBe(1);
  });

  it('signal 已 aborted：立即 onAbort + cleanup + onComplete', async () => {
    const controller = new AbortController();
    controller.abort();

    let completeCalled = false;
    let abortCalled = false;
    let cleanupCalled = false;

    vi.mocked(window.electronAPI!.ai.abort).mockImplementationOnce(() => { abortCalled = true; return Promise.resolve(true); });
    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce(() => ({
      promise: new Promise(() => {}), // 永不 resolve
      cleanup: () => { cleanupCalled = true; },
    }));

    const result = await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    }, controller.signal);

    expect(result).toBe('');
    expect(abortCalled).toBe(true);
    expect(cleanupCalled).toBe(true);
    expect(completeCalled).toBe(true);
  });

  it('signal 在流式中途 abort：触发 onAbort，主进程 promise 仍 resolve 时返回已生成内容', async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    let completeCalled = false;
    let abortCalled = false;

    vi.mocked(window.electronAPI!.ai.abort).mockImplementationOnce(() => { abortCalled = true; return Promise.resolve(true); });
    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      _params: unknown,
      onChunk: (c: string) => void,
      _onDone: (c: string) => void,
      _onError: (e: string) => void,
    ) => {
      return {
        promise: new Promise<string>(resolve => {
          setTimeout(() => {
            onChunk('已生成');
            // 用户在第一个 chunk 后 abort
            controller.abort();
            // 主进程收到 abort 信号后 resolve（不触发 onDone）
            setTimeout(() => resolve('已生成'), 0);
          }, 0);
        }),
        cleanup: vi.fn(),
      };
    });

    const result = await client.callLLMStream('hi', undefined, {
      onChunk: c => chunks.push(c),
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    }, controller.signal);

    // promise 正常 resolve 时走 try 分支，return fullContent='已生成'
    // 此时 signal.aborted=true 但 promise 未 reject，不会进入 catch 的 onComplete 路径
    // handler.onComplete 不会被触发（主进程没调 onDone）
    expect(result).toBe('已生成');
    expect(chunks).toEqual(['已生成']);
    expect(abortCalled).toBe(true);
    expect(completeCalled).toBe(false);
  });

  it('signal 在流式中途 abort 且主进程 reject：触发 onComplete 保留已生成内容', async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    let completeContent: string | null = null;
    let abortCalled = false;

    vi.mocked(window.electronAPI!.ai.abort).mockImplementationOnce(() => { abortCalled = true; return Promise.resolve(true); });
    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      _params: unknown,
      onChunk: (c: string) => void,
      _onDone: (c: string) => void,
      _onError: (e: string) => void,
    ) => {
      return {
        promise: new Promise<string>((_resolve, reject) => {
          setTimeout(() => {
            onChunk('已生成');
            controller.abort();
            // 主进程因 abort 抛出 AbortError
            setTimeout(() => reject(makeAbortError()), 0);
          }, 0);
        }),
        cleanup: vi.fn(),
      };
    });

    const result = await client.callLLMStream('hi', undefined, {
      onChunk: c => chunks.push(c),
      onComplete: c => { completeContent = c; },
      onError: () => {},
    }, controller.signal);

    // promise reject + signal.aborted → 走 catch 的 onComplete 路径，保留已生成内容
    expect(result).toBe('已生成');
    expect(chunks).toEqual(['已生成']);
    expect(abortCalled).toBe(true);
    expect(completeContent).toBe('已生成');
  });

  it('cleanup 在 finally 中一定被调用', async () => {
    const cleanupFn = vi.fn();
    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce(() => ({
      promise: Promise.resolve('ok'),
      cleanup: cleanupFn,
    }));

    await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    });

    expect(cleanupFn).toHaveBeenCalled();
  });

  it('requestId 格式：ai-{timestamp}-{random}', async () => {
    let capturedParams: Record<string, unknown> = {};
    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      params: unknown,
      _onChunk: (c: string) => void,
      _onDone: (c: string) => void,
      _onError: (e: string) => void,
    ) => {
      capturedParams = params as Record<string, unknown>;
      return { promise: Promise.resolve(''), cleanup: () => {} };
    });

    await client.callLLMStream('hi', undefined, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    });

    expect(capturedParams.requestId).toMatch(/^ai-\d+-[a-z0-9]+$/);
  });

  it('传给主进程的 params 含 provider/messages/temperature/maxTokens', async () => {
    let capturedParams: Record<string, unknown> = {};
    vi.mocked(window.electronAPI!.ai.proxyStream).mockImplementationOnce((
      params: unknown,
      _onChunk: (c: string) => void,
      _onDone: (c: string) => void,
      _onError: (e: string) => void,
    ) => {
      capturedParams = params as Record<string, unknown>;
      return { promise: Promise.resolve(''), cleanup: () => {} };
    });

    await client.callLLMStream('hi', 'system prompt', {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    });

    expect(capturedParams.provider).toBe('openai');
    expect(capturedParams.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hi' },
    ]);
    expect(capturedParams.temperature).toBe(0.7);
    expect(capturedParams.maxTokens).toBe(2000);
  });
});

// ============ 单例 llmClient 导出测试 ============
describe('单例 llmClient', () => {
  it('导出的 llmClient 是 LLMClient 实例', () => {
    expect(llmClient).toBeInstanceOf(LLMClient);
  });

  it('默认 settings provider 为 mock', () => {
    // 用一个新实例验证默认值，避免污染单例
    const fresh = new LLMClient();
    expect(fresh.getSettings().provider).toBe('mock');
  });
});
