import { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import DOMPurify from 'dompurify';
import { aiService, type StreamHandler } from '@/utils/aiService';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import { AI_STREAM_THROTTLE_MS, AI_CONTEXT_CONTINUATION_CHARS } from '@/constants/config';
import type { Chapter } from '@/types';

// AI 生成内容统一消毒入口：允许富文本标签但移除 script/事件处理器等危险节点
// 导出供 TiptapEditor 的 pendingEditorInsert 插入路径复用，确保所有 AI 内容走同一消毒逻辑
export const sanitizeAiHtml = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span', 'div', 'hr'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'color'],
  });

interface UseEditorAIOptions {
  editor: Editor | null;
  currentChapterId: string | null;
  currentChapter: Chapter | undefined;
  currentChapterIdRef: React.MutableRefObject<string | null>;
  // 由调用方创建并在 useEditor 之前声明的生成态 ref，供 onUpdate 闭包同步读取，
  // 避免 ref 在 useEditor 之后才初始化导致的时序问题。
  isGeneratingRef: React.MutableRefObject<boolean>;
  saveVersion: (chapterId: string, note: string) => void;
  setAIGenerating: (v: boolean) => void;
}

/**
 * 编辑器 AI 续写/润色逻辑（O1 从 TiptapEditor 拆分）
 *
 * 封装流式生成的完整生命周期：
 *   - 续写：onChunk 攒入 buffer 由节流 timer flush，末尾由 onComplete 兜底 flush
 *   - 润色：onChunk 仅缓存，onComplete 一次性原子替换选区或全章
 *   - 防串章：generatingChapterIdRef 与 currentChapterIdRef 二次校验（S2）
 *   - 中止：abortGeneration 供章节切换、取消按钮、组件卸载统一调用
 *
 * 拆分后 TiptapEditor 不再持有流式细节，仅负责编辑器实例、工具栏与章节同步。
 */
export function useEditorAI({
  editor,
  currentChapterId,
  currentChapter,
  currentChapterIdRef,
  isGeneratingRef,
  saveVersion,
  setAIGenerating,
}: UseEditorAIOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 组件挂载状态：卸载后置 false，防止 abort 后的 onComplete/onError/finally 触发 setState
  const mountedRef = useRef(true);
  // 续写流式节流：onChunk 攒入 buffer，由 timer 定时 flush 到编辑器
  const continueBufferRef = useRef('');
  const continueFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 润色流式缓存：onChunk 攒入 buffer，onComplete 一次性替换
  const streamingBufferRef = useRef('');
  // 当前 AI 生成所绑定的章节 id，用于流式期间防串章
  const generatingChapterIdRef = useRef<string | null>(null);
  // 润色选区缓存，避免流过程中光标移动导致错位
  const selectionRangeRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating, isGeneratingRef]);

  // 组件卸载时清理所有异步资源：流式节流定时器、进行中的 AI 请求，并标记已卸载
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (continueFlushTimerRef.current) clearTimeout(continueFlushTimerRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  /**
   * 中止进行中的 AI 生成并清理所有 buffer/timer/状态。
   * 用于章节切换、取消按钮、组件卸载三处统一清理入口。
   */
  const abortGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (continueFlushTimerRef.current) {
      clearTimeout(continueFlushTimerRef.current);
      continueFlushTimerRef.current = null;
    }
    continueBufferRef.current = '';
    streamingBufferRef.current = '';
    if (isGeneratingRef.current) {
      setIsGenerating(false);
      setAIGenerating(false);
      if (editor && !editor.isDestroyed) editor.setEditable(true);
      generatingChapterIdRef.current = null;
    }
  }, [editor, setAIGenerating]);

  const handleContinue = useCallback(async () => {
    if (!editor || !currentChapterId || !currentChapter || isGenerating) return;

    abortControllerRef.current = new AbortController();
    generatingChapterIdRef.current = currentChapterId;
    setIsGenerating(true);
    setAIGenerating(true);
    // 生成期间禁用编辑器交互，防止用户输入与流式插入交错造成内容混乱
    editor.setEditable(false);

    try {
      const characters = useAppStore.getState().characters;
      const aiSettings = useAppStore.getState().aiSettings;

      aiService.updateSettings(aiSettings);

      const handler: StreamHandler = {
        onChunk: (chunk: string) => {
          if (!editor || editor.isDestroyed) return;
          // 防串章：若生成期间章节已被切换则中止
          if (generatingChapterIdRef.current !== currentChapterIdRef.current) {
            abortControllerRef.current?.abort();
            return;
          }
          // 节流：chunk 先攒入 buffer，由定时器按 AI_STREAM_THROTTLE_MS 间隔 flush，
          // 避免逐 chunk 插入触发频繁重渲染与字数统计；最后一个 chunk 由 onComplete 兜底 flush
          continueBufferRef.current += chunk;
          if (continueFlushTimerRef.current) return;
          continueFlushTimerRef.current = setTimeout(() => {
            continueFlushTimerRef.current = null;
            // S2 兜底校验：章节切换 useEffect 已 abort，但定时器回调可能在 abort 前已入队，
            // 这里再次确认生成章节与当前章节一致后才写入编辑器，杜绝串章
            if (!editor || editor.isDestroyed || !continueBufferRef.current) return;
            if (generatingChapterIdRef.current !== currentChapterIdRef.current) {
              continueBufferRef.current = '';
              return;
            }
            const endPos = Math.max(0, editor.state.doc.content.size - 1);
            editor.chain().insertContentAt(endPos, sanitizeAiHtml(continueBufferRef.current)).run();
            continueBufferRef.current = '';
            const dom = editor.view.dom;
            dom.scrollTop = dom.scrollHeight;
          }, AI_STREAM_THROTTLE_MS);
        },
        onComplete: () => {
          if (!editor || editor.isDestroyed) return;
          // S2 兜底校验：章节已切换则丢弃残留 buffer，避免把旧章节的 AI 内容写到新章节
          if (generatingChapterIdRef.current !== currentChapterIdRef.current) {
            continueBufferRef.current = '';
            if (continueFlushTimerRef.current) {
              clearTimeout(continueFlushTimerRef.current);
              continueFlushTimerRef.current = null;
            }
            return;
          }
          // 兜底 flush：清掉待执行的 timer 并立即写入残留 buffer
          if (continueFlushTimerRef.current) {
            clearTimeout(continueFlushTimerRef.current);
            continueFlushTimerRef.current = null;
          }
          if (continueBufferRef.current) {
            const endPos = Math.max(0, editor.state.doc.content.size - 1);
            editor.chain().insertContentAt(endPos, sanitizeAiHtml(continueBufferRef.current)).run();
            continueBufferRef.current = '';
            const dom = editor.view.dom;
            dom.scrollTop = dom.scrollHeight;
          }
          editor.setEditable(true);
          editor.commands.focus();
          // 生成期间 onUpdate 被屏蔽，此处显式 flush 编辑器内容到 store，避免版本保存读到陈旧内容
          const cid = generatingChapterIdRef.current;
          if (cid) {
            useAppStore.getState().updateChapterContent(cid, editor.getHTML());
          }
        },
        onError: (error: Error) => {
          console.error('AI stream error:', error);
          toast.error('AI 续写失败', error.message || '请检查网络或 API 配置');
          // 清理节流 timer 与残留 buffer，避免脏数据后续写入
          if (continueFlushTimerRef.current) {
            clearTimeout(continueFlushTimerRef.current);
            continueFlushTimerRef.current = null;
          }
          continueBufferRef.current = '';
          // 出错时也需把已流式插入的部分保留到 store
          const cid = generatingChapterIdRef.current;
          if (cid && editor && !editor.isDestroyed) {
            useAppStore.getState().updateChapterContent(cid, editor.getHTML());
          }
        },
      };

      await aiService.generateContinuationStream(
        currentChapter.content.slice(-AI_CONTEXT_CONTINUATION_CHARS),
        currentChapter.summary,
        characters,
        aiSettings.style,
        handler,
        abortControllerRef.current.signal
      );

      saveVersion(currentChapterId, 'AI 续写');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('AI continue error:', e);
      toast.error('AI 续写失败', msg);
    } finally {
      // 卸载后不再 setState；非主动中止且编辑器未销毁时才恢复可编辑状态
      if (!mountedRef.current) return;
      if (!abortControllerRef.current?.signal.aborted && !editor.isDestroyed) {
        editor.setEditable(true);
      }
      setIsGenerating(false);
      setAIGenerating(false);
      abortControllerRef.current = null;
      generatingChapterIdRef.current = null;
    }
  }, [editor, currentChapterId, currentChapter, saveVersion, isGenerating, setAIGenerating, currentChapterIdRef]);

  const handlePolish = useCallback(async () => {
    if (!editor || !currentChapterId || isGenerating) return;

    abortControllerRef.current = new AbortController();
    generatingChapterIdRef.current = currentChapterId;
    setIsGenerating(true);
    setAIGenerating(true);
    editor.setEditable(false);

    try {
      const { state } = editor;
      const { selection } = state;
      const isTextSelected = !selection.empty;

      let selectedText = '';
      if (isTextSelected) {
        const { from, to } = selection;
        selectedText = state.doc.textBetween(from, to);
      }

      const aiSettings = useAppStore.getState().aiSettings;
      aiService.updateSettings(aiSettings);

      // 缓存选区范围，避免流过程中光标移动导致错位
      if (isTextSelected) {
        const { from, to } = editor.state.selection;
        selectionRangeRef.current = { from, to };
      }

      const handler: StreamHandler = {
        onChunk: (chunk: string) => {
          if (!editor || editor.isDestroyed) return;
          if (generatingChapterIdRef.current !== currentChapterIdRef.current) {
            abortControllerRef.current?.abort();
            return;
          }
          // 流式阶段仅缓存内容，不操作编辑器，避免选区错位和频繁重绘
          streamingBufferRef.current += chunk;
        },
        onComplete: () => {
          if (!editor || editor.isDestroyed) return;
          if (isTextSelected && selectionRangeRef.current) {
            // 流结束后一次性原子替换选中文本
            const { from, to } = selectionRangeRef.current;
            editor.chain().focus().deleteRange({ from, to }).insertContent(sanitizeAiHtml(streamingBufferRef.current)).run();
            selectionRangeRef.current = null;
          } else {
            // 全章润色：流结束后一次性替换
            editor.commands.setContent(sanitizeAiHtml(streamingBufferRef.current));
            editor.commands.focus();
          }
          streamingBufferRef.current = '';
          editor.setEditable(true);
          // flush 到 store
          const cid = generatingChapterIdRef.current;
          if (cid) {
            useAppStore.getState().updateChapterContent(cid, editor.getHTML());
          }
        },
        onError: (error: Error) => {
          console.error('AI stream error:', error);
          toast.error('AI 润色失败', error.message || '请检查网络或 API 配置');
          streamingBufferRef.current = '';
          selectionRangeRef.current = null;
        },
      };

      await aiService.polishTextStream(
        selectedText || currentChapter?.content || '',
        aiSettings.style,
        handler,
        abortControllerRef.current.signal
      );

      saveVersion(currentChapterId, 'AI 润色');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('AI polish error:', e);
      toast.error('AI 润色失败', msg);
    } finally {
      // 卸载后不再 setState；非主动中止且编辑器未销毁时才恢复可编辑状态
      if (!mountedRef.current) return;
      if (!abortControllerRef.current?.signal.aborted && !editor.isDestroyed) {
        editor.setEditable(true);
      }
      setIsGenerating(false);
      setAIGenerating(false);
      abortControllerRef.current = null;
      generatingChapterIdRef.current = null;
    }
  }, [editor, currentChapterId, currentChapter, saveVersion, isGenerating, setAIGenerating, currentChapterIdRef]);

  return {
    isGenerating,
    handleContinue,
    handlePolish,
    abortGeneration,
  };
}
