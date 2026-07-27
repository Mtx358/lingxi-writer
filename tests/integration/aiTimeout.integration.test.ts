/**
 * 网络超时集成测试（B1）
 *
 * 验证 LLMClient 的超时保护机制（端到端 fake-timer + mock fetch）：
 *   - callLLMStream 总超时：chunks 持续到达（重置空闲计时器）但总时长超 60s → "60s" 消息
 *   - callLLMStream 空闲超时（无 chunk）：fetch 永不 resolve → 30s 空闲超时先触发 → "30s" 消息
 *   - callLLMStream 空闲超时（有 chunk 后 hang）：先发一个 chunk 然后流 hang → 30s 空闲超时
 *   - 超时后 AbortController.signal.aborted === true（fetch 真正被中止）
 *   - 超时错误消息含 "超时" 字样
 *   - 超时时 handler.onError 被调用
 *   - callLLM 非流式 30s 超时
 *
 * 测试策略：
 *   - vi.useFakeTimers() 控制时间推进
 *   - vi.stubGlobal('fetch', ...) 返回可控的 ReadableStream
 *   - fetch mock 监听 signal.abort 事件，abort 时让流 controller.error() 或 reject promise
 *   - 临时移除 window.electronAPI.ai.proxyStream 让代码走 Web 直连分支
 *
 * 注意：本测试与 src/utils/llmClient.test.ts 的超时单元测试互补——
 * 单元测试聚焦边界条件（消息格式、timedOutBy 标记），本测试聚焦端到端
 * "fetch 永不 settle → timer 触发 → signal abort → fetch reject → catch 抛超时错" 完整链路。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '@/utils/llmClient';
import type { StreamHandler } from '@/utils/llmClient';

// ============ fetch mock 工厂 ============

/**
 * 永不 resolve 的 fetch：模拟连接 hang 住（TCP 已连接但无 HTTP 响应）。
 * 响应 signal.abort：reject with AbortError，让 await fetch(...) 抛错。
 */
function makeNeverResolvingFetch() {
  return vi.fn((_url: unknown, opts: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = opts.signal as AbortSignal;
    if (signal) {
      signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }
    // 永不 resolve：模拟连接 hang 住
  }));
}

/**
 * 先发一个 chunk 然后永不 close 的流：模拟"连接已建立、服务端发了一帧后 hang"。
 * 关键：流必须响应 signal.abort → controller.error()，否则 reader.read() 永不 settle，
 * fake timer 下 advanceTimersByTimeAsync 无法让 await reader.read() 抛错。
 */
function makeOneChunkThenHangFetch(chunk: string) {
  const encoder = new TextEncoder();
  return vi.fn((_url: unknown, opts: RequestInit) => {
    const signal = opts.signal as AbortSignal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 立即入队一个 chunk
        controller.enqueue(encoder.encode(chunk));
        // 不 close、不 enqueue 更多：模拟服务端 hang
        // 监听 abort：error controller 让 pending reader.read() reject
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            try { controller.error(err); } catch { /* controller 已 closed/errored */ }
          }, { once: true });
        }
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, statusText: 'OK' }));
  });
}

/**
 * 周期性发送 chunk 的流：每 intervalMs 发一个 SSE chunk，持续不断。
 * 用于测试总超时（60s）：chunks 持续到达重置空闲计时器，但总时长到达 60s 触发总超时。
 * 响应 signal.abort：清除 interval + error controller。
 */
function makePeriodicChunkFetch(intervalMs: number) {
  const encoder = new TextEncoder();
  return vi.fn((_url: unknown, opts: RequestInit) => {
    const signal = opts.signal as AbortSignal;
    let count = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        intervalId = setInterval(() => {
          count++;
          const sseLine = `data: {"choices":[{"delta":{"content":"chunk${count}"}}]}\n\n`;
          try { controller.enqueue(encoder.encode(sseLine)); } catch { /* stream 已 cancelled */ }
        }, intervalMs);

        if (signal) {
          signal.addEventListener('abort', () => {
            if (intervalId) clearInterval(intervalId);
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            try { controller.error(err); } catch { /* already errored */ }
          }, { once: true });
        }
      },
      cancel() {
        if (intervalId) clearInterval(intervalId);
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, statusText: 'OK' }));
  });
}

// 捕获传给 fetch 的 signal，供测试断言 signal.aborted
let capturedSignal: AbortSignal | undefined;
function makeSignalCapturingFetch(innerFetch: ReturnType<typeof vi.fn>) {
  return vi.fn((url: unknown, opts: RequestInit) => {
    capturedSignal = opts.signal as AbortSignal | undefined;
    return innerFetch(url, opts);
  });
}

describe('网络超时集成测试（B1）', () => {
  let client: LLMClient;
  let originalProxyStream: unknown;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new LLMClient();
    client.updateSettings({ provider: 'openai', apiKey: 'sk-test' });

    // 临时移除 proxyStream，强制走 Web 直连（fetch）分支
    originalProxyStream = window.electronAPI?.ai?.proxyStream;
    if (window.electronAPI?.ai) {
      Object.defineProperty(window.electronAPI.ai, 'proxyStream', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    }
    capturedSignal = undefined;
  });

  afterEach(() => {
    if (window.electronAPI?.ai) {
      Object.defineProperty(window.electronAPI.ai, 'proxyStream', {
        value: originalProxyStream,
        writable: true,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ============ 总超时（60s） ============
  it('总超时：chunks 持续到达但总时长超 60s → 60s 总超时错误', async () => {
    vi.useFakeTimers();
    // 每 7s 发一个 chunk：7,14,21,28,35,42,49,56 → 持续重置空闲计时器
    // 60s 时总超时 timer 触发（最后一次 chunk 在 56s，空闲计时器重置到 86s，不干扰）
    fetchMock = makeSignalCapturingFetch(makePeriodicChunkFetch(7_000));
    vi.stubGlobal('fetch', fetchMock);

    let errorCaught: Error | null = null;
    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: (e: Error) => { errorCaught = e; },
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    // 推进 60s 触发总超时
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await caughtPromise as Error;

    expect(err).toBeInstanceOf(Error);
    // 错误消息含 "超时" 与 "60s"
    expect(err.message).toContain('超时');
    expect(err.message).toContain('60s');
    // onError 也被调用，传入同一错误
    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toContain('60s');

    vi.clearAllTimers();
  });

  // ============ 空闲超时（30s，无 chunk） ============
  it('空闲超时（无 chunk）：fetch 永不 resolve，advance 30s 触发空闲超时', async () => {
    vi.useFakeTimers();
    fetchMock = makeSignalCapturingFetch(makeNeverResolvingFetch());
    vi.stubGlobal('fetch', fetchMock);

    let errorCaught: Error | null = null;
    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: (e: Error) => { errorCaught = e; },
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    // 无 chunk 到达时，30s 空闲超时先触发（总超时 60s 尚未到期）
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await caughtPromise as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('超时');
    expect(err.message).toContain('30s');
    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toContain('30s');

    vi.clearAllTimers();
  });

  // ============ 空闲超时（30s，有 chunk 后 hang） ============
  it('空闲超时（有 chunk 后 hang）：fetch 先发一个 chunk 然后 hang，advance 30s 触发空闲超时', async () => {
    vi.useFakeTimers();
    const sseChunk = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
    fetchMock = makeSignalCapturingFetch(makeOneChunkThenHangFetch(sseChunk));
    vi.stubGlobal('fetch', fetchMock);

    const chunks: string[] = [];
    let errorCaught: Error | null = null;
    const handler: StreamHandler = {
      onChunk: (c: string) => { chunks.push(c); },
      onComplete: vi.fn(),
      onError: (e: Error) => { errorCaught = e; },
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    // 先让 microtask 跑完，让首个 chunk 被消费（resetInactivity 在 chunk 到达时重置 30s timer）
    await vi.advanceTimersByTimeAsync(1);
    // 首个 chunk 已到达
    expect(chunks).toEqual(['hello']);

    // 再推进 30s：自首个 chunk 后无新 chunk → 空闲超时触发
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await caughtPromise as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('超时');
    expect(err.message).toContain('30s');
    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toContain('30s');

    vi.clearAllTimers();
  });

  // ============ 超时后 AbortController 被触发 ============
  it('总超时后 AbortController.signal.aborted === true（fetch 真正被中止）', async () => {
    vi.useFakeTimers();
    fetchMock = makeSignalCapturingFetch(makePeriodicChunkFetch(7_000));
    vi.stubGlobal('fetch', fetchMock);

    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    // 超时前 signal 未 aborted
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // 推进 60s 触发总超时 → timeoutController.abort()
    await vi.advanceTimersByTimeAsync(60_000);
    await caughtPromise;

    // 超时后 signal 已 aborted（fetch 已被中止）
    expect(capturedSignal!.aborted).toBe(true);

    vi.clearAllTimers();
  });

  it('空闲超时后 AbortController.signal.aborted === true', async () => {
    vi.useFakeTimers();
    const sseChunk = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n';
    fetchMock = makeSignalCapturingFetch(makeOneChunkThenHangFetch(sseChunk));
    vi.stubGlobal('fetch', fetchMock);

    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    // 消费首个 chunk
    await vi.advanceTimersByTimeAsync(1);
    expect(capturedSignal!.aborted).toBe(false);

    // 推进 30s 触发空闲超时
    await vi.advanceTimersByTimeAsync(30_000);
    await caughtPromise;

    expect(capturedSignal!.aborted).toBe(true);

    vi.clearAllTimers();
  });

  // ============ 超时错误消息含 "超时" 字样 ============
  it('总超时错误消息包含 "超时" 字样', async () => {
    vi.useFakeTimers();
    fetchMock = makeSignalCapturingFetch(makePeriodicChunkFetch(7_000));
    vi.stubGlobal('fetch', fetchMock);

    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    await vi.advanceTimersByTimeAsync(60_000);
    const err = await caughtPromise as Error;

    // 显式断言 "超时" 关键字（用户可识别的错误类型）
    expect(err.message).toMatch(/超时/);

    vi.clearAllTimers();
  });

  it('空闲超时错误消息包含 "超时" 字样', async () => {
    vi.useFakeTimers();
    const sseChunk = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n';
    fetchMock = makeSignalCapturingFetch(makeOneChunkThenHangFetch(sseChunk));
    vi.stubGlobal('fetch', fetchMock);

    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await caughtPromise as Error;

    expect(err.message).toMatch(/超时/);

    vi.clearAllTimers();
  });

  // ============ 超时时 onError 被调用 ============
  it('超时时 handler.onError 被调用并接收超时错误', async () => {
    vi.useFakeTimers();
    fetchMock = makeSignalCapturingFetch(makeNeverResolvingFetch());
    vi.stubGlobal('fetch', fetchMock);

    let onErrorArg: Error | null = null;
    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: (e: Error) => { onErrorArg = e; },
    };

    const promise = client.callLLMStream('hi', undefined, handler);
    const caughtPromise = promise.catch(e => e as Error);

    await vi.advanceTimersByTimeAsync(30_000);
    const thrown = await caughtPromise as Error;

    // onError 被调用，且接收的错误与 throw 的一致（都是超时错误）
    expect(onErrorArg).not.toBeNull();
    expect(onErrorArg!.message).toBe(thrown.message);
    expect(onErrorArg!.message).toContain('超时');

    vi.clearAllTimers();
  });

  // ============ callLLM 非流式 30s 超时 ============
  it('callLLM 非流式：30s 超时抛 "AI 请求超时（30s）"', async () => {
    vi.useFakeTimers();
    fetchMock = makeSignalCapturingFetch(makeNeverResolvingFetch());
    vi.stubGlobal('fetch', fetchMock);

    const promise = client.callLLM('hi');
    const caughtPromise = promise.catch(e => e as Error);

    // 推进 30s 触发 callLLM 的超时
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await caughtPromise as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('超时');
    expect(err.message).toContain('30s');
    // callLLM 超时后 signal 也已 aborted
    expect(capturedSignal!.aborted).toBe(true);

    vi.clearAllTimers();
  });

  // ============ 用户传入的 signal 与超时 signal 联动 ============
  it('用户传入 AbortSignal + 总超时：超时触发后传给 fetch 的 signal 已 aborted', async () => {
    vi.useFakeTimers();
    fetchMock = makeSignalCapturingFetch(makePeriodicChunkFetch(7_000));
    vi.stubGlobal('fetch', fetchMock);

    const userController = new AbortController();
    const handler: StreamHandler = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const promise = client.callLLMStream('hi', undefined, handler, userController.signal);
    const caughtPromise = promise.catch(e => e as Error);

    // 推进 60s 触发总超时
    await vi.advanceTimersByTimeAsync(60_000);
    await caughtPromise;

    // timeoutController 的 signal（即传给 fetch 的 signal）已 aborted
    expect(capturedSignal!.aborted).toBe(true);

    vi.clearAllTimers();
  });
});
