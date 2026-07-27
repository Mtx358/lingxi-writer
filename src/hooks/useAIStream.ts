import { useRef, useCallback } from 'react';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import type { StreamHandler } from '@/utils/aiService';

/**
 * 单次 AI 流式运行的配置。
 *
 * 设计目标：AIPanel 中 6 个 handler（续写/扩写/润色/换视角/按指令生成/多版本）
 * 共享同一套生命周期模板——分配 AbortController、切换 busy 状态、syncSettings、
 * try/catch toast.error、finally 收尾。本类型描述每次运行的可变部分。
 */
interface AIRunConfig<T> {
  /** 错误 toast 标题，如 "AI 续写失败" / "换视角失败" */
  errorTitle: string;
  /** busy 状态切换：setIsGenerating / setIsGeneratingVersions */
  setBusy: (busy: boolean) => void;
  /** 流式开始前调用：清空 streamingContent / versions、关闭菜单、syncSettings 等。
   *  在 setBusy(true) 之后、streamFn 之前执行，匹配原 handler 的顺序 */
  onBefore?: () => void;
  /** 流式 chunk 到达时的回调。仅 4 个流式 handler 提供（累积到 streamingContent）；
   *  换视角/多版本不传，handler.onChunk 退化为 no-op */
  onChunk?: (chunk: string) => void;
  /** 流式成功（且未被中止）后写入 store 等。参数为 streamFn 的返回值。
   *  原 handler 中的 `if (!abortRef.current?.signal.aborted) { ... }` 即由此实现 */
  onSuccess?: (result: T) => void;
  /** finally 收尾（无论成功/失败/中止均执行）。5 个非多版本 handler 传
   *  () => setStreamingContent('')；多版本生成不传（其 UI 不依赖 streamingContent，
   *  原代码 finally 也不清空） */
  onFinally?: () => void;
}

/**
 * 提取 AIPanel 6 个 AI handler 的公共流式生成逻辑。
 *
 * 消除的重复模板：
 *   1. abortRef = new AbortController()
 *   2. setBusy(true) + onBefore（setStreamingContent('') / syncSettings 等）
 *   3. 构造 StreamHandler（onChunk 累积、onError toast.error）
 *   4. try { await streamFn(handler, signal); if (!aborted) onSuccess() }
 *   5. catch { toast.error(errorTitle, msg) }
 *   6. finally { setBusy(false); onFinally(); abortRef = null }
 *
 * 调用方只需提供 streamFn（封装具体的 aiService.xxx 调用）和差异化的 config。
 *
 * @returns run 启动一次流式运行；abortRef 共享给组件用于中止/卸载清理
 */
export function useAIStream() {
  // 与组件共享：组件卸载/切章/点击"中止生成"时直接 abort
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async <T>(
    streamFn: (handler: StreamHandler, signal: AbortSignal) => Promise<T>,
    config: AIRunConfig<T>,
  ): Promise<void> => {
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    // 顺序与原 handler 一致：先切 busy，再清状态/syncSettings
    config.setBusy(true);
    config.onBefore?.();

    // 4 个流式 handler 共用的 StreamHandler。
    // onChunk 累积 chunk（调用方通过 onChunk 控制，通常 setStreamingContent(prev => prev + chunk)）；
    // onError 处理流式过程中的错误（不抛出，仅 toast）。换视角/多版本不会触发 onChunk/onError。
    const handler: StreamHandler = {
      onChunk: (chunk: string) => config.onChunk?.(chunk),
      onComplete: () => {},
      onError: (error: Error) => {
        console.error('AI stream error:', error);
        toast.error(config.errorTitle, error.message || '请检查网络或 API 配置');
      },
    };

    try {
      const result = await streamFn(handler, signal);
      // 被用户主动中止时不写入 store，避免残缺内容进入建议列表（与原逻辑一致）
      if (!signal.aborted && config.onSuccess) {
        config.onSuccess(result);
      }
    } catch (e) {
      // 用户主动中止不报错（与原 AIPanel handler 行为一致）
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) {
        const msg = getErrorMessage(e);
        console.error(`${config.errorTitle}:`, e);
        toast.error(config.errorTitle, msg);
      }
    } finally {
      config.setBusy(false);
      config.onFinally?.();
      abortRef.current = null;
    }
  }, []);

  return { run, abortRef };
}
