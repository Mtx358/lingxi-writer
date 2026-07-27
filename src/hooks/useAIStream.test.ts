/**
 * useAIStream 测试
 *
 * 测试范围：
 * 1. 成功路径：run → streamFn 调用 → onBefore/onChunk/onSuccess/onFinally 按序调用
 * 2. 错误路径：streamFn reject 非 AbortError → toast.error 调用 → onFinally 仍调用
 * 3. 中止路径：streamFn reject AbortError → 跳过 toast.error，onFinally 仍调用
 * 4. setBusy 切换：run 开始 setBusy(true)，finally 时 setBusy(false)
 * 5. abortRef：run 期间 abortRef.current 非 null，结束后置 null
 *
 * Mock 策略：
 *   - @/hooks/useToast：mock toast 各方法为 vi.fn，便于断言调用参数
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAIStream } from '@/hooks/useAIStream';
import { toast } from '@/hooks/useToast';
import type { StreamHandler } from '@/utils/aiService';

// ============ mock toast ============
// 捕获 error 等调用参数以断言；streamFn 出错路径会调用 toast.error
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// 辅助：构造带类型的 streamFn mock
function makeStreamFn<T>(
  impl: (handler: StreamHandler, signal: AbortSignal) => Promise<T>,
) {
  return vi.fn(impl);
}

describe('useAIStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功路径：streamFn 调用 → onBefore/onChunk/onSuccess/onFinally 按序调用', async () => {
    const { result } = renderHook(() => useAIStream());

    const onBefore = vi.fn();
    const onChunk = vi.fn();
    const onSuccess = vi.fn();
    const onFinally = vi.fn();
    const setBusy = vi.fn();

    // 记录调用顺序以校验生命周期顺序
    const order: string[] = [];
    onBefore.mockImplementation(() => order.push('onBefore'));
    onChunk.mockImplementation((c: string) => order.push(`onChunk:${c}`));
    onSuccess.mockImplementation(() => order.push('onSuccess'));
    onFinally.mockImplementation(() => order.push('onFinally'));
    setBusy.mockImplementation((b: boolean) => order.push(`setBusy:${b}`));

    const streamFn = makeStreamFn(async (handler, _signal) => {
      order.push('streamFn:start');
      // 模拟流式 chunk 到达
      handler.onChunk('Hello ');
      handler.onChunk('World');
      order.push('streamFn:end');
      return 'final-result';
    });

    await act(async () => {
      await result.current.run(streamFn, {
        errorTitle: 'AI 失败',
        setBusy,
        onBefore,
        onChunk,
        onSuccess,
        onFinally,
      });
    });

    expect(streamFn).toHaveBeenCalledTimes(1);
    // 顺序：setBusy(true) → onBefore → streamFn(内含 onChunk 多次) → onSuccess → setBusy(false) → onFinally
    expect(order).toEqual([
      'setBusy:true',
      'onBefore',
      'streamFn:start',
      'onChunk:Hello ',
      'onChunk:World',
      'streamFn:end',
      'onSuccess',
      'setBusy:false',
      'onFinally',
    ]);
    expect(onSuccess).toHaveBeenCalledWith('final-result');
    // 成功路径不调用 toast.error
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('错误路径：streamFn reject 非 AbortError → toast.error 调用 → onFinally 仍调用', async () => {
    const { result } = renderHook(() => useAIStream());

    const onSuccess = vi.fn();
    const onFinally = vi.fn();
    const setBusy = vi.fn();

    const streamFn = makeStreamFn(async () => {
      throw new Error('网络异常');
    });

    await act(async () => {
      await result.current.run(streamFn, {
        errorTitle: 'AI 续写失败',
        setBusy,
        onSuccess,
        onFinally,
      });
    });

    // toast.error 被调用，参数为 (errorTitle, errorMsg)
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('AI 续写失败', '网络异常');
    // 出错时不调用 onSuccess
    expect(onSuccess).not.toHaveBeenCalled();
    // onFinally 仍调用
    expect(onFinally).toHaveBeenCalledTimes(1);
    // setBusy 切回 false
    expect(setBusy).toHaveBeenCalledWith(false);
  });

  it('中止路径：streamFn reject AbortError → 跳过 toast.error，onFinally 仍调用', async () => {
    const { result } = renderHook(() => useAIStream());

    const onSuccess = vi.fn();
    const onFinally = vi.fn();
    const setBusy = vi.fn();

    // AbortError 标准构造方式（DOMException with name 'AbortError'）
    const streamFn = makeStreamFn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });

    await act(async () => {
      await result.current.run(streamFn, {
        errorTitle: 'AI 续写失败',
        setBusy,
        onSuccess,
        onFinally,
      });
    });

    // 用户主动中止（AbortError）不视为错误，不调用 toast.error
    expect(toast.error).not.toHaveBeenCalled();
    // 被中止时不调用 onSuccess
    expect(onSuccess).not.toHaveBeenCalled();
    // onFinally 仍调用
    expect(onFinally).toHaveBeenCalledTimes(1);
    // setBusy 切回 false
    expect(setBusy).toHaveBeenCalledWith(false);
  });

  it('setBusy 切换：run 开始时 setBusy(true)，finally 时 setBusy(false)', async () => {
    const { result } = renderHook(() => useAIStream());

    const setBusy = vi.fn();
    const streamFn = makeStreamFn(async () => 'ok');

    await act(async () => {
      await result.current.run(streamFn, {
        errorTitle: 'x',
        setBusy,
      });
    });

    // 两次调用：先 true 后 false
    expect(setBusy).toHaveBeenCalledTimes(2);
    expect(setBusy.mock.calls[0]).toEqual([true]);
    expect(setBusy.mock.calls[1]).toEqual([false]);
  });

  it('abortRef：run 期间 abortRef.current 非 null，结束后置 null', async () => {
    const { result } = renderHook(() => useAIStream());

    // 捕获 controller 值本身（而非 ref 对象），因为 finally 会把 abortRef.current 置 null，
    // 若捕获 ref 对象则其 .current 在 run 结束后也会变为 null，无法验证"run 期间非 null"。
    let capturedController: AbortController | null = null;
    let capturedSignal: AbortSignal | null = null;

    const streamFn = makeStreamFn(async (_handler, signal) => {
      capturedController = result.current.abortRef.current;
      capturedSignal = signal;
      // run 期间 abortRef.current 非 null，且其 signal 与传入 streamFn 的一致
      expect(result.current.abortRef.current).not.toBeNull();
      expect(result.current.abortRef.current?.signal).toBe(signal);
      return 'ok';
    });

    await act(async () => {
      await result.current.run(streamFn, {
        errorTitle: 'x',
        setBusy: vi.fn(),
      });
    });

    // run 期间捕获到的 controller 非 null（证明 run 时分配了 AbortController）
    expect(capturedController).not.toBeNull();
    expect(capturedSignal).not.toBeNull();
    // expect().not.toBeNull() 的类型定义会把 capturedController 窄化为 never（vitest 副作用），
    // 此处用 as 显式恢复类型；运行时值确为 AbortController（上方已断言非 null）
    expect((capturedController as AbortController | null)?.signal).toBe(capturedSignal);
    // run 结束后 abortRef.current 被置 null
    expect(result.current.abortRef.current).toBeNull();
  });

  it('signal.aborted 时不调用 onSuccess（避免残缺内容写入 store）', async () => {
    const { result } = renderHook(() => useAIStream());

    const onSuccess = vi.fn();
    const onFinally = vi.fn();

    // 模拟用户在 streamFn 执行期间触发 abort：signal.aborted 变为 true
    const streamFn = makeStreamFn(async (_handler, signal) => {
      result.current.abortRef.current?.abort();
      expect(signal.aborted).toBe(true);
      return 'partial';
    });

    await act(async () => {
      await result.current.run(streamFn, {
        errorTitle: 'x',
        setBusy: vi.fn(),
        onSuccess,
        onFinally,
      });
    });

    // streamFn resolve 但 signal.aborted → 跳过 onSuccess
    expect(onSuccess).not.toHaveBeenCalled();
    // 且因未抛错，不调用 toast.error
    expect(toast.error).not.toHaveBeenCalled();
    // onFinally 仍调用
    expect(onFinally).toHaveBeenCalledTimes(1);
  });
});
