/**
 * useStreamThrottle 独立单元测试
 *
 * 测试范围（聚焦节流时序，不重复 AIPanel.test.tsx 已覆盖的渲染/交互）：
 *   - 首 chunk 立即 flush（leading edge）
 *   - 节流窗口（AI_STREAM_THROTTLE_MS=120ms）内后续 chunk 累积，到期一次性 flush
 *   - resetStreamBuffer 清理 timer + buffer
 *   - resetStreamBuffer 后新 chunk 重新触发 leading edge
 *   - flushStreamContent 手动立即 flush 攒入的 buffer
 *   - 卸载后推进 timer 不再调用 setStreamingContent（resetStreamBuffer 兜底）
 *
 * 用 vi.useFakeTimers + advanceTimersByTime 控制时序；
 * setStreamingContent 用闭包追踪累积内容，便于断言 flush 的实际拼接结果。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStreamThrottle } from './useStreamThrottle';

describe('useStreamThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 渲染 hook 并以闭包累积 streamingContent：每次 setStreamingContent 调用
  // 将 updater 应用到累积值，便于断言 flush 拼接出的完整内容
  function renderThrottle() {
    let content = '';
    const setStreamingContent = vi.fn((updater: (prev: string) => string) => {
      content = updater(content);
    });
    const result = renderHook(() => useStreamThrottle(setStreamingContent));
    return {
      ...result,
      getContent: () => content,
      setStreamingContent,
      callCount: () => setStreamingContent.mock.calls.length,
    };
  }

  it('首 chunk 立即 flush（leading edge），无需等待节流窗口', () => {
    const { result, getContent, callCount } = renderThrottle();
    act(() => result.current.appendChunk('片段A'));
    expect(callCount()).toBe(1);
    expect(getContent()).toBe('片段A');
  });

  it('120ms 内的后续 chunk 累积到 buffer，timer 到期后一次性 flush', () => {
    const { result, getContent, callCount } = renderThrottle();
    act(() => result.current.appendChunk('A')); // leading flush
    act(() => result.current.appendChunk('B')); // 累积
    act(() => result.current.appendChunk('C')); // 累积
    // 仍只有 leading 一次 flush
    expect(callCount()).toBe(1);
    expect(getContent()).toBe('A');
    // 推进节流窗口，buffer 中的 BC 一次性 flush
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(callCount()).toBe(2);
    expect(getContent()).toBe('ABC');
  });

  it('resetStreamBuffer 清理 timer 与 buffer，之后推进时间不再触发 flush', () => {
    const { result, getContent, callCount } = renderThrottle();
    act(() => result.current.appendChunk('A')); // leading flush
    act(() => result.current.appendChunk('B')); // 累积到 buffer
    expect(getContent()).toBe('A');
    act(() => result.current.resetStreamBuffer());
    // 推进节流窗口，不应再 flush
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(callCount()).toBe(1);
    expect(getContent()).toBe('A');
    // timer ref 已被清理
    expect(result.current.streamFlushTimerRef.current).toBeNull();
    // buffer 已被清空
    expect(result.current.streamBufferRef.current).toBe('');
  });

  it('resetStreamBuffer 后新的 chunk 重新触发 leading edge（timer 复位）', () => {
    const { result, getContent, callCount } = renderThrottle();
    act(() => result.current.appendChunk('A')); // leading flush + 调度 timer
    act(() => result.current.resetStreamBuffer()); // 清掉 timer
    act(() => {
      vi.advanceTimersByTime(120);
    }); // 旧 timer 已清，无 flush
    expect(callCount()).toBe(1);
    // 新 chunk：timer 已为 null，重新 leading flush
    act(() => result.current.appendChunk('D'));
    expect(callCount()).toBe(2);
    expect(getContent()).toBe('AD');
  });

  it('flushStreamContent 手动立即 flush 攒入的 buffer（流结束兜底）', () => {
    const { result, getContent, callCount } = renderThrottle();
    act(() => result.current.appendChunk('A')); // leading flush -> content=A, 调度 timer
    act(() => result.current.appendChunk('B')); // 累积
    act(() => result.current.appendChunk('C')); // 累积 buffer=BC
    expect(getContent()).toBe('A');
    // 手动 flush 兜底（流结束），立即写入 BC
    act(() => result.current.flushStreamContent());
    expect(callCount()).toBe(2);
    expect(getContent()).toBe('ABC');
    // flush 后 timer ref 已清空（避免重复触发）
    expect(result.current.streamFlushTimerRef.current).toBeNull();
  });

  it('卸载后推进 timer 不再调用 setStreamingContent（resetStreamBuffer 兜底）', () => {
    const { result, unmount, callCount } = renderThrottle();
    act(() => result.current.appendChunk('A')); // leading flush + 调度 timer
    act(() => result.current.appendChunk('B')); // 累积
    // 卸载前清理（调用方在 useEffect cleanup 中应这样做）
    act(() => result.current.resetStreamBuffer());
    unmount();
    // 推进时间：因 timer 已清理，不会触发 setState（避免卸载后 setState 警告）
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(callCount()).toBe(1); // 仍只有 leading 那次
  });
});
