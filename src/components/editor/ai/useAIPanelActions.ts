import { useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import { useAIStream } from '@/hooks/useAIStream';
import { sanitizeAiHtml } from '@/hooks/useEditorAI';
import type { AISettings, Chapter, Character, ProjectSettingCard, BlueprintOverview } from '@/types';
import {
  AI_CONTEXT_AIPANEL_CONTINUATION_CHARS,
  AI_CONTEXT_EXPAND_CHARS,
  AI_CONTEXT_POLISH_CHARS,
  AI_CONTEXT_PERSPECTIVE_CHARS,
} from './constants';

/**
 * AIPanel 的 6 个生成 handler + 4 个应用/插入 handler 集中 hook。
 *
 * 6 个生成 handler（续写/扩写/润色/换视角/按指令/多版本）共享 useAIStream 的生命周期
 * 模板（AbortController / busy / try-catch toast / finally），差异通过 config 注入：
 *   - 4 个流式 handler 传 onChunk（经节流 hook 攒入 buffer）
 *   - 换视角/多版本非流式，不传 onChunk
 *
 * 4 个应用/插入 handler（采纳版本/插入版本到光标/采纳建议/插入建议到光标）通过
 * setPendingEditorInsert 经 store 传递给 TiptapEditor，避免读取防抖期内的陈旧 store。
 *
 * @param deps 当前章节/角色/设置/指令等运行时上下文
 */
export interface UseAIPanelActionsDeps {
  currentChapterId: string | null;
  currentChapter: Chapter | undefined;
  characters: Character[];
  aiSettings: AISettings;
  settingCard: ProjectSettingCard | null | undefined;
  blueprint: BlueprintOverview | null | undefined;
  instructionText: string;
  isGenerating: boolean;
  isGeneratingVersions: boolean;
  setIsGenerating: (v: boolean) => void;
  setIsGeneratingVersions: (v: boolean) => void;
  setStreamingContent: (updater: (prev: string) => string) => void;
  setVersions: (updater: string[] | ((prev: string[]) => string[])) => void;
  appendChunk: (chunk: string) => void;
  flushStreamContent: () => void;
  resetStreamBuffer: () => void;
}

export function useAIPanelActions(deps: UseAIPanelActionsDeps) {
  const {
    currentChapterId, currentChapter, characters, aiSettings,
    settingCard, blueprint, instructionText,
    isGenerating, isGeneratingVersions,
    setIsGenerating, setIsGeneratingVersions,
    setStreamingContent, setVersions,
    appendChunk, flushStreamContent, resetStreamBuffer,
  } = deps;

  const { run: runAIStream, abortRef } = useAIStream();
  const clearAISuggestions = useAppStore(s => s.clearAISuggestions);
  const setPendingEditorInsert = useAppStore(s => s.setPendingEditorInsert);

  // 同步 store 中的 aiSettings 到 aiService（生成前/testConnection 前调用）
  const syncSettings = useCallback(() => {
    aiService.updateSettings(aiSettings);
  }, [aiSettings]);

  const handleGenerateContinuation = useCallback(async () => {
    if (!currentChapterId || !currentChapter || isGenerating || isGeneratingVersions) return;
    const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
    await runAIStream(
      (handler, signal) => aiService.generateContinuationStream(
        plainText.slice(-AI_CONTEXT_AIPANEL_CONTINUATION_CHARS),
        currentChapter.summary,
        characters,
        aiSettings.style,
        handler,
        signal,
      ),
      {
        errorTitle: 'AI 续写失败',
        setBusy: setIsGenerating,
        onBefore: () => {
          resetStreamBuffer();
          setStreamingContent(() => '');
          syncSettings();
        },
        onChunk: appendChunk,
        onSuccess: (content) => {
          const store = useAppStore.getState();
          store.clearAISuggestions();
          store.addAISuggestion({
            type: 'continue',
            title: 'AI 续写',
            content,
            reasoning: '基于当前章节上下文、角色设定和风格偏好由 AI 生成，并经过真人化处理。',
            contextUsed: ['当前章节末尾', '角色设定', '风格偏好', '章节概要'],
          });
        },
        onFinally: () => {
          // 流结束兜底：清掉待执行 timer 并 flush 残留 buffer，确保内容完整
          resetStreamBuffer();
          flushStreamContent();
          setStreamingContent(() => '');
        },
      },
    );
  }, [currentChapterId, currentChapter, isGenerating, isGeneratingVersions, characters, aiSettings.style, setIsGenerating, resetStreamBuffer, setStreamingContent, syncSettings, appendChunk, runAIStream, flushStreamContent]);

  const handleExpand = useCallback(async (type: 'detail' | 'dialogue' | 'environment' | 'psychology') => {
    if (!currentChapterId || !currentChapter || isGenerating || isGeneratingVersions) return;
    const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
    const selectedText = plainText.slice(Math.max(0, plainText.length - AI_CONTEXT_EXPAND_CHARS));
    const typeMap: Record<typeof type, string> = {
      detail: '丰富细节',
      dialogue: '增加对话',
      environment: '环境描写',
      psychology: '心理活动',
    };
    await runAIStream(
      (handler, signal) => aiService.expandTextStream(selectedText, type, handler, signal),
      {
        errorTitle: 'AI 扩写失败',
        setBusy: setIsGenerating,
        onBefore: () => {
          resetStreamBuffer();
          setStreamingContent(() => '');
          syncSettings();
        },
        onChunk: appendChunk,
        onSuccess: (content) => {
          const store = useAppStore.getState();
          store.clearAISuggestions();
          store.addAISuggestion({
            type: 'expand',
            title: `扩写：${typeMap[type]}`,
            content,
            reasoning: `从${typeMap[type]}的角度扩展原文，让场景更立体。文字经过真人化处理。`,
            contextUsed: ['选中文本', '扩写方向', '真人写作风格'],
          });
        },
        onFinally: () => {
          resetStreamBuffer();
          flushStreamContent();
          setStreamingContent(() => '');
        },
      },
    );
  }, [currentChapterId, currentChapter, isGenerating, isGeneratingVersions, setIsGenerating, resetStreamBuffer, setStreamingContent, syncSettings, appendChunk, runAIStream, flushStreamContent]);

  const handlePolish = useCallback(async () => {
    if (!currentChapterId || !currentChapter || isGenerating || isGeneratingVersions) return;
    const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
    const selectedText = plainText.slice(Math.max(0, plainText.length - AI_CONTEXT_POLISH_CHARS));
    await runAIStream(
      (handler, signal) => aiService.polishTextStream(selectedText, aiSettings.style, handler, signal),
      {
        errorTitle: 'AI 润色失败',
        setBusy: setIsGenerating,
        onBefore: () => {
          resetStreamBuffer();
          setStreamingContent(() => '');
          syncSettings();
        },
        onChunk: appendChunk,
        onSuccess: (content) => {
          const store = useAppStore.getState();
          store.clearAISuggestions();
          store.addAISuggestion({
            type: 'polish',
            title: '润色优化',
            content,
            reasoning: '基于整体文风一致性和表达效果进行润色，在保留原意的基础上提升文学性和自然度。',
            contextUsed: ['选中文本', '全书风格', '角色语气特点', '真人写作质感'],
          });
        },
        onFinally: () => {
          resetStreamBuffer();
          flushStreamContent();
          setStreamingContent(() => '');
        },
      },
    );
  }, [currentChapterId, currentChapter, isGenerating, isGeneratingVersions, aiSettings.style, setIsGenerating, resetStreamBuffer, setStreamingContent, syncSettings, appendChunk, runAIStream, flushStreamContent]);

  const handleSwitchPerspective = useCallback(async () => {
    if (!currentChapterId || !currentChapter || characters.length === 0) return;
    // 与 handleGenerateContinuation/handleExpand/handlePolish 保持一致：
    // 进行中的 AI 请求应被拒绝，避免新旧请求竞态导致结果错位
    if (isGenerating || isGeneratingVersions) return;
    const mainChar = characters.find(c => c.role === 'protagonist') || characters[0];
    const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
    await runAIStream(
      // switchPerspective 非流式：handler/signal 均不使用（原代码未传入 signal，保持一致）
      (_handler, _signal) => aiService.switchPerspective(
        plainText.slice(-AI_CONTEXT_PERSPECTIVE_CHARS),
        mainChar.name,
      ),
      {
        errorTitle: '换视角失败',
        setBusy: setIsGenerating,
        onBefore: () => {
          resetStreamBuffer();
          setStreamingContent(() => '');
          syncSettings();
        },
        onSuccess: (suggestion) => {
          const store = useAppStore.getState();
          store.clearAISuggestions();
          store.addAISuggestion(suggestion);
        },
        onFinally: () => {
          resetStreamBuffer();
          flushStreamContent();
          setStreamingContent(() => '');
        },
      },
    );
  }, [currentChapterId, currentChapter, characters, isGenerating, isGeneratingVersions, setIsGenerating, resetStreamBuffer, setStreamingContent, syncSettings, runAIStream, flushStreamContent]);

  // 灵犀写作 3.1：按自由指令生成正文（流式）
  const handleGenerateByInstruction = useCallback(async () => {
    if (!currentChapterId || !currentChapter || isGenerating || isGeneratingVersions) return;
    const instruction = instructionText.trim();
    if (!instruction) {
      toast.error('请输入写作指令', '描述你希望 AI 生成的情节、对话或场景');
      return;
    }
    const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
    await runAIStream(
      (handler, signal) => aiService.generateWritingByInstruction(
        instruction,
        {
          chapterContent: plainText.slice(-AI_CONTEXT_AIPANEL_CONTINUATION_CHARS),
          chapterSummary: currentChapter.summary,
          characters,
          settingCard: settingCard || undefined,
          blueprint: blueprint || undefined,
        },
        handler,
        signal,
      ),
      {
        errorTitle: '按指令生成失败',
        setBusy: setIsGenerating,
        onBefore: () => {
          resetStreamBuffer();
          setStreamingContent(() => '');
          setVersions([]);
          syncSettings();
        },
        onChunk: appendChunk,
        onSuccess: (content) => {
          const store = useAppStore.getState();
          store.clearAISuggestions();
          store.addAISuggestion({
            type: 'continue',
            title: '按指令生成',
            content,
            reasoning: `按指令「${instruction.slice(0, 30)}${instruction.length > 30 ? '…' : ''}」生成，结合本章前文、角色设定与故事蓝图。`,
            contextUsed: ['写作指令', '本章前文', '角色设定', '故事蓝图', '设定卡'],
          });
        },
        onFinally: () => {
          resetStreamBuffer();
          flushStreamContent();
          setStreamingContent(() => '');
        },
      },
    );
  }, [currentChapterId, currentChapter, isGenerating, isGeneratingVersions, instructionText, characters, settingCard, blueprint, setIsGenerating, resetStreamBuffer, setStreamingContent, setVersions, syncSettings, appendChunk, runAIStream, flushStreamContent]);

  // 灵犀写作 3.2：并发生成多版本供选择
  const handleGenerateVersions = useCallback(async () => {
    if (!currentChapterId || !currentChapter || isGenerating || isGeneratingVersions) return;
    const instruction = instructionText.trim();
    if (!instruction) {
      toast.error('请输入写作指令', '描述你希望 AI 生成的情节、对话或场景');
      return;
    }
    const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
    await runAIStream(
      // generateMultipleVersions 非流式：handler 不使用
      (_handler, signal) => aiService.generateMultipleVersions(
        instruction,
        {
          chapterContent: plainText.slice(-AI_CONTEXT_AIPANEL_CONTINUATION_CHARS),
          chapterSummary: currentChapter.summary,
          characters,
          settingCard: settingCard || undefined,
          blueprint: blueprint || undefined,
        },
        3,
        signal,
      ),
      {
        errorTitle: '多版本生成失败',
        setBusy: setIsGeneratingVersions,
        onBefore: () => {
          resetStreamBuffer();
          setVersions([]);
          setStreamingContent(() => '');
          syncSettings();
        },
        // 多版本非流式，不传 onChunk
        onSuccess: (results) => {
          if (results.length === 0) {
            toast.error('多版本生成失败', '所有版本均生成失败，请重试');
          } else {
            setVersions(results);
            toast.success('已生成 ' + results.length + ' 个版本', '点击版本卡片下方的"采纳"应用对应版本');
          }
        },
        // 不传 onFinally：多版本 UI 不依赖 streamingContent，原代码 finally 也不清空
      },
    );
  }, [currentChapterId, currentChapter, isGenerating, isGeneratingVersions, instructionText, characters, settingCard, blueprint, setIsGeneratingVersions, resetStreamBuffer, setVersions, setStreamingContent, syncSettings, runAIStream]);

  // 采纳多版本中的某一版
  const handleApplyVersion = useCallback((content: string) => {
    if (!currentChapterId || !currentChapter) return;
    const cleanContent = sanitizeAiHtml(content);
    setPendingEditorInsert({ chapterId: currentChapterId, content: cleanContent, mode: 'end' });
    setVersions([]);
  }, [currentChapterId, currentChapter, setPendingEditorInsert, setVersions]);

  const handleInsertVersionAtCursor = useCallback((content: string) => {
    if (!currentChapterId || !currentChapter) return;
    const cleanContent = sanitizeAiHtml(content);
    setPendingEditorInsert({ chapterId: currentChapterId, content: cleanContent, mode: 'cursor' });
    setVersions([]);
  }, [currentChapterId, currentChapter, setPendingEditorInsert, setVersions]);

  const handleApplySuggestion = useCallback((content: string) => {
    if (!currentChapterId || !currentChapter) return;
    const cleanContent = sanitizeAiHtml(content.replace(/<p class="text-ink-500[\s\S]*?<\/p>|<ul class="text-ink-400[\s\S]*?<\/ul>/g, ''));
    // 通过 pendingEditorInsert 以"末尾追加"模式经编辑器执行，避免读取防抖期内的陈旧 store 内容
    setPendingEditorInsert({ chapterId: currentChapterId, content: cleanContent, mode: 'end' });
    clearAISuggestions();
  }, [currentChapterId, currentChapter, setPendingEditorInsert, clearAISuggestions]);

  const handleInsertAtCursor = useCallback((content: string) => {
    if (!currentChapterId || !currentChapter) return;
    const cleanContent = sanitizeAiHtml(content.replace(/<p class="text-ink-500[\s\S]*?<\/p>|<ul class="text-ink-400[\s\S]*?<\/ul>/g, ''));
    // 通过 store 传递插入请求，TiptapEditor 监听后在光标位置执行插入
    setPendingEditorInsert({ chapterId: currentChapterId, content: cleanContent, mode: 'cursor' });
    clearAISuggestions();
  }, [currentChapterId, currentChapter, setPendingEditorInsert, clearAISuggestions]);

  return {
    abortRef,
    syncSettings,
    handleGenerateContinuation,
    handleExpand,
    handlePolish,
    handleSwitchPerspective,
    handleGenerateByInstruction,
    handleGenerateVersions,
    handleApplyVersion,
    handleInsertVersionAtCursor,
    handleApplySuggestion,
    handleInsertAtCursor,
  };
}
