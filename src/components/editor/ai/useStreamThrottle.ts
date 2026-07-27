import { useRef, useCallback } from 'react';
import { AI_STREAM_THROTTLE_MS } from './constants';

/**
 * 流式 chunk 节流 hook。
 *
 * 背景：SSE 流式响应每秒可触发 20-50 次 onChunk，若每次都 setStreamingContent
 * 会引发频繁重渲染。本 hook 攒入 buffer，由 timer 按 AI_STREAM_THROTTLE_MS
 * 间隔 flush。首个 chunk 立即 flush（leading edge）让流式卡片尽快显示。
 *
 * 模式参考 useEditorAI.ts 的 continueBufferRef + continueFlushTimerRef。
 *
 * @returns
 *   - appendChunk: onChunk 回调，将 chunk 写入 buffer 并按需启动节流 timer
 *   - flushStreamContent: 立即把 buffer 写入 streamingContent（流结束兜底也用）
 *   - resetStreamBuffer: 清理 buffer/timer（不触发 setState），用于流开始前/切章/卸载
 *   - streamFlushTimerRef / streamBufferRef: 暴露给调用方用于卸载清理（可选）
 */
export function useStreamThrottle(
  setStreamingContent: (updater: (prev: string) => string) => void,
) {
  const streamBufferRef = useRef('');
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // flush 攒入 buffer 的 chunk 到 streamingContent state
  const flushStreamContent = useCallback(() => {
    streamFlushTimerRef.current = null;
    const buffered = streamBufferRef.current;
    streamBufferRef.current = '';
    if (buffered) {
      setStreamingContent(prev => prev + buffered);
    }
  }, [setStreamingContent]);

  // 清理流式节流 buffer/timer（不触发 setState）：
  // 用于流开始前/切章/卸载，防止残留 chunk 污染新流或卸载后 timer 触发 setState
  const resetStreamBuffer = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  // onChunk 回调：首个 chunk 立即 flush（leading edge），后续 chunk 攒入 buffer 节流
  const appendChunk = useCallback((chunk: string) => {
    streamBufferRef.current += chunk;
    if (streamFlushTimerRef.current === null) {
      // 首个 chunk 立即 flush 让流式卡片尽快显示；
      // 后续 chunk 攒入 buffer，由 timer 节流 flush
      flushStreamContent();
      streamFlushTimerRef.current = setTimeout(flushStreamContent, AI_STREAM_THROTTLE_MS);
    }
  }, [flushStreamContent]);

  return {
    appendChunk,
    flushStreamContent,
    resetStreamBuffer,
    streamBufferRef,
    streamFlushTimerRef,
  };
}
