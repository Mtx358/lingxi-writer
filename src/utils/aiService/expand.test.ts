/**
 * src/utils/aiService/expand.ts 单元测试
 *
 * 覆盖 aiService.test.ts 未覆盖的非 mock provider 路径：
 *   - expandTextStream openai provider 成功路径：callLLMStream → humanize → onComplete
 *   - expandTextStream openai provider 抛错路径：catch → onError → 返回 ''
 *   - expandTextStream openai provider + abort：signal.aborted → 跳过 humanize
 *   - expandText openai provider 成功路径：callLLM → humanize → AISuggestion
 *
 * 测试策略：
 *   - setLLMClient 注入 mock LLMClient（provider='openai'），控制 callLLM/callLLMStream 返回值
 *   - mock ensureHtmlParagraphs / humanizeWithAITraceCheck 的上游依赖（llmClient.ensureHtmlParagraphs）
 *   - 测试后恢复默认 client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLLMClient, getLLMClient } from './core';
import { expandText, expandTextStream } from './expand';
import { type LLMClient } from '../llmClient';

describe('expandText / expandTextStream 非 mock provider 路径', () => {
  let originalClient: LLMClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    originalClient = getLLMClient();
    mockClient = {
      getSettings: vi.fn(() => ({ provider: 'openai', apiKey: 'sk-test', strictness: 50, temperature: 0.7 })),
      callLLM: vi.fn(),
      callLLMStream: vi.fn(),
      ensureHtmlParagraphs: vi.fn((s: string) => `<p>${s}</p>`),
      clampScore: vi.fn(() => 50),
      delay: vi.fn(() => Promise.resolve()),
      updateSettings: vi.fn(),
      getTotalTokensUsed: vi.fn(() => 0),
      testConnection: vi.fn(),
    };
    setLLMClient(mockClient);
  });

  afterEach(() => {
    setLLMClient(originalClient);
    vi.restoreAllMocks();
  });

  // ============ expandTextStream 非 mock 路径 ============
  it('openai provider：callLLMStream 成功 → humanize 后回调 onComplete', async () => {
    const streamResult = '<p>扩写内容</p>';
    mockClient.callLLMStream = vi.fn().mockResolvedValue(streamResult);

    const chunks: string[] = [];
    let completeContent: string | null = null;
    let errorArg: Error | null = null;
    const result = await expandTextStream('原文', 'detail', {
      onChunk: (c: string) => { chunks.push(c); },
      onComplete: (full: string) => { completeContent = full; },
      onError: (e: Error) => { errorArg = e; },
    });

    // callLLMStream 被调用（非 mock 路径）
    expect(mockClient.callLLMStream).toHaveBeenCalledTimes(1);
    // ensureHtmlParagraphs 被调用（对结果做 HTML 规整）
    expect(mockClient.ensureHtmlParagraphs).toHaveBeenCalledWith(streamResult);
    // onComplete 被回调，传入 humanize 后的内容
    expect(completeContent).not.toBeNull();
    // onError 未被调用
    expect(errorArg).toBeNull();
    // 返回值是 humanize 后的内容
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('openai provider：callLLMStream 抛错 → catch → onError + 返回空字符串', async () => {
    const error = new Error('API 超时');
    mockClient.callLLMStream = vi.fn().mockRejectedValue(error);

    let errorArg: Error | null = null;
    let completeCalled = false;
    const result = await expandTextStream('原文', 'dialogue', {
      onChunk: () => {},
      onComplete: () => { completeCalled = true; },
      onError: (e: Error) => { errorArg = e; },
    });

    // catch 块：onError 被调用
    expect(errorArg).not.toBeNull();
    expect(errorArg!.message).toBe('API 超时');
    // onComplete 不被调用
    expect(completeCalled).toBe(false);
    // 返回空字符串
    expect(result).toBe('');
  });

  it('openai provider：signal.aborted → 跳过 humanize，直接返回 stream 结果', async () => {
    const streamResult = '<p>部分内容</p>';
    mockClient.callLLMStream = vi.fn().mockResolvedValue(streamResult);

    const controller = new AbortController();
    controller.abort();

    let completeCalled = false;
    const result = await expandTextStream('原文', 'environment', {
      onChunk: () => {},
      onComplete: () => { completeCalled = true; },
      onError: () => {},
    }, controller.signal);

    // signal.aborted 时跳过 humanize（不调用 ensureHtmlParagraphs）
    expect(mockClient.ensureHtmlParagraphs).not.toHaveBeenCalled();
    // onComplete 不被调用（abort 路径直接返回）
    expect(completeCalled).toBe(false);
    // 返回 stream 的原始结果
    expect(result).toBe(streamResult);
  });

  it('openai provider：wrappedHandler 抑制内部 onComplete/onError（由外层统一处理）', async () => {
    // 验证 expandTextStream 对传入 handler 的包装：
    // 内部 callLLMStream 收到的 wrappedHandler.onComplete 是 no-op（延迟到 humanize 后），
    // wrappedHandler.onError 也是 no-op（由外层 catch 统一回调）
    const streamResult = '<p>内容</p>';
    mockClient.callLLMStream = vi.fn().mockImplementation(async (
      _prompt: string, _sys: string, handler: { onChunk: (c: string) => void; onComplete: (c: string) => void; onError: (e: Error) => void } | undefined,
    ) => {
      // 模拟 callLLMStream 内部回调
      handler?.onChunk('chunk1');
      handler?.onComplete(streamResult);
      return streamResult;
    });

    let outerCompleteCalled = false;
    let outerErrorCalled = false;
    await expandTextStream('原文', 'psychology', {
      onChunk: () => {},
      onComplete: () => { outerCompleteCalled = true; },
      onError: () => { outerErrorCalled = true; },
    });

    // 外层 onComplete 被调用（humanize 后）
    expect(outerCompleteCalled).toBe(true);
    // 外层 onError 不被调用（成功路径）
    expect(outerErrorCalled).toBe(false);
  });

  // ============ expandText 非 mock 路径 ============
  it('openai provider：expandText 成功 → 返回含 humanize 内容的 AISuggestion', async () => {
    const llmResult = '扩写后的正文内容';
    mockClient.callLLM = vi.fn().mockResolvedValue(llmResult);

    const suggestion = await expandText('原文', 'detail');

    expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
    expect(suggestion.type).toBe('expand');
    expect(suggestion.title).toContain('丰富细节');
    expect(suggestion.content).toContain('扩写后的正文内容');
    expect(suggestion.contextUsed).toContain('选中文本');
  });

  it('openai provider：expandText callLLM 抛错 → 降级到 mock 路径', async () => {
    mockClient.callLLM = vi.fn().mockRejectedValue(new Error('API error'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const suggestion = await expandText('原文', 'dialogue');

    // 降级到 mock：仍返回有效 suggestion
    expect(suggestion.type).toBe('expand');
    expect(suggestion.title).toContain('增加对话');
    expect(suggestion.content.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(
      'AI expandText failed, falling back to mock:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
