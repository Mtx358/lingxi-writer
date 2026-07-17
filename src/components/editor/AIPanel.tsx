import DOMPurify from 'dompurify';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, SlidersHorizontal, X, Check, RefreshCw, ChevronDown, UserRound, Wifi, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useClickOutside } from '@/hooks/useClickOutside';
import { aiService, type StreamHandler } from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import { sanitizeAiHtml } from '@/hooks/useEditorAI';
import {
  AI_CONTEXT_AIPANEL_CONTINUATION_CHARS,
  AI_CONTEXT_EXPAND_CHARS,
  AI_CONTEXT_POLISH_CHARS,
  AI_CONTEXT_PERSPECTIVE_CHARS,
} from '@/constants/config';
import type { AISettings } from '@/types';

export default function AIPanel() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showExpandMenu, setShowExpandMenu] = useState(false);
  const expandMenuRef = useRef<HTMLDivElement>(null);
  const closeExpandMenu = useCallback(() => setShowExpandMenu(false), []);
  useClickOutside(expandMenuRef, closeExpandMenu, showExpandMenu);
  // AbortController：用于中止进行中的流式 AI 请求，组件卸载时统一 abort
  const abortRef = useRef<AbortController | null>(null);
  // 防抖：文本类 AI 设置（baseUrl/model/apiKey）输入时累积更新，300ms 后批量写入 store
  const debouncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Partial<AISettings>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const currentChapterId = useAppStore(s => s.currentChapterId);
  const currentChapter = useAppStore(s => s.chapters.find(c => c.id === s.currentChapterId));
  const aiSuggestions = useAppStore(s => s.aiSuggestions);
  const characters = useAppStore(s => s.characters);
  const clearAISuggestions = useAppStore(s => s.clearAISuggestions);
  const aiSettings = useAppStore(s => s.aiSettings);
  const updateAISettings = useAppStore(s => s.updateAISettings);

  // 同步 store 中的 aiSettings 到 aiService
  const syncSettings = () => {
    aiService.updateSettings(aiSettings);
  };

  // 文本类设置防抖写入：合并短时间内多次输入，避免每次按键都触发 store 更新与持久化
  const debouncedUpdateAISettings = useCallback((updates: Partial<AISettings>) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    if (debouncedTimerRef.current) clearTimeout(debouncedTimerRef.current);
    debouncedTimerRef.current = setTimeout(() => {
      updateAISettings(pendingUpdatesRef.current);
      pendingUpdatesRef.current = {};
    }, 300);
  }, [updateAISettings]);

  // 组件卸载时中止进行中的 AI 请求并清理防抖定时器，防止卸载后 setState
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debouncedTimerRef.current) clearTimeout(debouncedTimerRef.current);
    };
  }, []);

  const handleGenerateContinuation = async () => {
    if (!currentChapterId || !currentChapter || isGenerating) return;
    abortRef.current = new AbortController();
    setIsGenerating(true);
    setStreamingContent('');
    syncSettings();

    try {
      const plainText = currentChapter.content.replace(/<[^>]*>/g, '');

      const handler: StreamHandler = {
        onChunk: (chunk: string) => {
          setStreamingContent(prev => prev + chunk);
        },
        onComplete: () => {},
        onError: (error: Error) => {
          console.error('AI stream error:', error);
          toast.error('AI 续写失败', error.message || '请检查网络或 API 配置');
        },
      };

      const content = await aiService.generateContinuationStream(
        plainText.slice(-AI_CONTEXT_AIPANEL_CONTINUATION_CHARS),
        currentChapter.summary,
        characters,
        aiSettings.style,
        handler,
        abortRef.current.signal
      );

      // 被用户主动中止时不写入建议，避免把残缺内容加入列表
      if (!abortRef.current?.signal.aborted) {
        const store = useAppStore.getState();
        store.clearAISuggestions();
        store.addAISuggestion({
          type: 'continue',
          title: 'AI 续写',
          content,
          reasoning: '基于当前章节上下文、角色设定和风格偏好由 AI 生成，并经过真人化处理。',
          contextUsed: ['当前章节末尾', '角色设定', '风格偏好', '章节概要'],
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('AI continuation error:', e);
      toast.error('AI 续写失败', msg);
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  };

  const handleExpand = async (type: 'detail' | 'dialogue' | 'environment' | 'psychology') => {
    if (!currentChapterId || !currentChapter || isGenerating) return;
    abortRef.current = new AbortController();
    setIsGenerating(true);
    setStreamingContent('');
    setShowExpandMenu(false);
    syncSettings();

    try {
      const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
      const selectedText = plainText.slice(Math.max(0, plainText.length - AI_CONTEXT_EXPAND_CHARS));

      const handler: StreamHandler = {
        onChunk: (chunk: string) => {
          setStreamingContent(prev => prev + chunk);
        },
        onComplete: () => {},
        onError: (error: Error) => {
          console.error('AI stream error:', error);
          toast.error('AI 扩写失败', error.message || '请检查网络或 API 配置');
        },
      };

      const content = await aiService.expandTextStream(selectedText, type, handler, abortRef.current.signal);

      const typeMap: Record<typeof type, string> = {
        detail: '丰富细节',
        dialogue: '增加对话',
        environment: '环境描写',
        psychology: '心理活动',
      };

      if (!abortRef.current?.signal.aborted) {
        const store = useAppStore.getState();
        store.clearAISuggestions();
        store.addAISuggestion({
          type: 'expand',
          title: `扩写：${typeMap[type]}`,
          content,
          reasoning: `从${typeMap[type]}的角度扩展原文，让场景更立体。文字经过真人化处理。`,
          contextUsed: ['选中文本', '扩写方向', '真人写作风格'],
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('AI expand error:', e);
      toast.error('AI 扩写失败', msg);
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  };

  const handlePolish = async () => {
    if (!currentChapterId || !currentChapter || isGenerating) return;
    abortRef.current = new AbortController();
    setIsGenerating(true);
    setStreamingContent('');
    syncSettings();

    try {
      const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
      const selectedText = plainText.slice(Math.max(0, plainText.length - AI_CONTEXT_POLISH_CHARS));

      const handler: StreamHandler = {
        onChunk: (chunk: string) => {
          setStreamingContent(prev => prev + chunk);
        },
        onComplete: () => {},
        onError: (error: Error) => {
          console.error('AI stream error:', error);
          toast.error('AI 润色失败', error.message || '请检查网络或 API 配置');
        },
      };

      const content = await aiService.polishTextStream(selectedText, aiSettings.style, handler, abortRef.current.signal);

      if (!abortRef.current?.signal.aborted) {
        const store = useAppStore.getState();
        store.clearAISuggestions();
        store.addAISuggestion({
          type: 'polish',
          title: '润色优化',
          content,
          reasoning: '基于整体文风一致性和表达效果进行润色，在保留原意的基础上提升文学性和自然度。',
          contextUsed: ['选中文本', '全书风格', '角色语气特点', '真人写作质感'],
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('AI polish error:', e);
      toast.error('AI 润色失败', msg);
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  };

  const handleSwitchPerspective = async () => {
    if (!currentChapterId || !currentChapter || characters.length === 0) return;
    abortRef.current = new AbortController();
    setIsGenerating(true);
    setStreamingContent('');
    syncSettings();

    try {
      const mainChar = characters.find(c => c.role === 'protagonist') || characters[0];
      const plainText = currentChapter.content.replace(/<[^>]*>/g, '');
      const suggestion = await aiService.switchPerspective(plainText.slice(-AI_CONTEXT_PERSPECTIVE_CHARS), mainChar.name);

      if (!abortRef.current?.signal.aborted) {
        const store = useAppStore.getState();
        store.clearAISuggestions();
        store.addAISuggestion(suggestion);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('AI switch perspective error:', e);
      toast.error('换视角失败', msg);
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  };

  const handleApplySuggestion = (content: string) => {
    if (!currentChapterId || !currentChapter) return;
    const cleanContent = DOMPurify.sanitize(content.replace(/<p class="text-ink-500[\s\S]*?<\/p>|<ul class="text-ink-400[\s\S]*?<\/ul>/g, ''));
    // 通过 pendingEditorInsert 以“末尾追加”模式经编辑器执行，避免读取防抖期内的陈旧 store 内容
    useAppStore.getState().setPendingEditorInsert({ chapterId: currentChapterId, content: cleanContent, mode: 'end' });
    clearAISuggestions();
  };

  const handleInsertAtCursor = (content: string) => {
    if (!currentChapterId || !currentChapter) return;
    const cleanContent = DOMPurify.sanitize(content.replace(/<p class="text-ink-500[\s\S]*?<\/p>|<ul class="text-ink-400[\s\S]*?<\/ul>/g, ''));
    // 通过 store 传递插入请求，TiptapEditor 监听后在光标位置执行插入
    useAppStore.getState().setPendingEditorInsert({ chapterId: currentChapterId, content: cleanContent, mode: 'cursor' });
    clearAISuggestions();
  };

  const handleProviderChange = (provider: AISettings['provider']) => {
    const updates: Partial<AISettings> = { provider };
    if (provider === 'local') {
      if (!aiSettings.baseUrl) updates.baseUrl = 'http://localhost:11434';
      if (!aiSettings.model) updates.model = 'qwen2.5:7b';
    } else if (provider === 'openai') {
      if (!aiSettings.baseUrl) updates.baseUrl = 'https://api.openai.com';
      if (!aiSettings.model) updates.model = 'gpt-4o-mini';
    } else if (provider === 'deepseek') {
      if (!aiSettings.baseUrl) updates.baseUrl = 'https://api.deepseek.com';
      if (!aiSettings.model) updates.model = 'deepseek-chat';
    }
    updateAISettings(updates);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    syncSettings();
    try {
      const result = await aiService.testConnection();
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div data-tour="ai-panel" className="h-full flex flex-col">
      {/* Settings Toggle */}
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          AI 助手
        </span>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-1.5 rounded-md transition-colors ${
            showSettings ? 'text-amber-400 bg-amber-400/10' : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* AI Settings */}
      {showSettings && (
        <div className="p-3 border-b border-ink-800/50 space-y-4 bg-ink-800/30 animate-slide-down">
          {/* AI 模型配置区 */}
          <div className="space-y-3 pb-3 border-b border-ink-700/50">
            <div>
              <label className="text-xs text-ink-400 block mb-1.5">AI 提供商</label>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { id: 'mock', label: 'Mock' },
                  { id: 'local', label: 'Ollama' },
                  { id: 'openai', label: 'OpenAI' },
                  { id: 'deepseek', label: 'DeepSeek' },
                ] as const).map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    className={`py-1 text-xs rounded transition-colors ${
                      aiSettings.provider === p.id
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                        : 'bg-ink-700/50 text-ink-400 border border-transparent hover:text-ink-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {aiSettings.provider !== 'mock' && (
              <>
                <div>
                  <label className="text-xs text-ink-400 block mb-1">服务地址</label>
                  <input
                    type="text"
                    value={aiSettings.baseUrl || ''}
                    onChange={(e) => debouncedUpdateAISettings({ baseUrl: e.target.value })}
                    placeholder={
                      aiSettings.provider === 'local' ? 'http://localhost:11434' :
                      aiSettings.provider === 'deepseek' ? 'https://api.deepseek.com' :
                      'https://api.openai.com'
                    }
                    className="w-full px-2 py-1 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
                  />
                </div>

                <div>
                  <label className="text-xs text-ink-400 block mb-1">模型名称</label>
                  <input
                    type="text"
                    value={aiSettings.model || ''}
                    onChange={(e) => debouncedUpdateAISettings({ model: e.target.value })}
                    placeholder={
                      aiSettings.provider === 'local' ? 'qwen2.5:7b' :
                      aiSettings.provider === 'deepseek' ? 'deepseek-chat' :
                      'gpt-4o-mini'
                    }
                    className="w-full px-2 py-1 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
                  />
                </div>

                {(aiSettings.provider === 'openai' || aiSettings.provider === 'deepseek') && (
                  <div>
                    <label className="text-xs text-ink-400 block mb-1">API Key</label>
                    <input
                      type="password"
                      value={aiSettings.apiKey || ''}
                    onChange={(e) => debouncedUpdateAISettings({ apiKey: e.target.value })}
                      placeholder={aiSettings.provider === 'deepseek' ? 'sk-...' : 'sk-...'}
                      className="w-full px-2 py-1 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
                    />
                  </div>
                )}

                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="w-full py-1.5 text-xs bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {testing ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      测试中...
                    </>
                  ) : (
                    <>
                      <Wifi className="w-3 h-3" />
                      测试连接
                    </>
                  )}
                </button>

                {testResult && (
                  <div className={`text-xs p-2 rounded break-all ${testResult.success ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                    {testResult.message}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 写作风格参数 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ink-400">描写浓度</label>
              <span className="text-xs text-amber-400">{aiSettings.descriptionDensity}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={aiSettings.descriptionDensity}
              onChange={(e) => updateAISettings({ descriptionDensity: Number(e.target.value) })}
              className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ink-400">对话浓度</label>
              <span className="text-xs text-amber-400">{aiSettings.dialogueDensity}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={aiSettings.dialogueDensity}
              onChange={(e) => updateAISettings({ dialogueDensity: Number(e.target.value) })}
              className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ink-400">严守设定</label>
              <span className="text-xs text-amber-400">{aiSettings.strictness}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={aiSettings.strictness}
              onChange={(e) => updateAISettings({ strictness: Number(e.target.value) })}
              className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
            />
          </div>

          <div>
            <label className="text-xs text-ink-400 block mb-1.5">最大生成长度 (maxTokens)</label>
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={aiSettings.maxTokens}
              onChange={(e) => updateAISettings({ maxTokens: Number(e.target.value) })}
              className="w-full px-2 py-1.5 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50"
              placeholder="2000"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ink-400">创造性 (Temperature)</label>
              <span className="text-[10px] text-amber-400 font-mono">{aiSettings.temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={aiSettings.temperature}
              onChange={(e) => updateAISettings({ temperature: Number(e.target.value) })}
              className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
            />
            <div className="flex justify-between text-[9px] text-ink-600 mt-1">
              <span>保守</span>
              <span>均衡</span>
              <span>创意</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-ink-400 block mb-1.5">风格偏好</label>
            <div className="grid grid-cols-4 gap-1">
              {([
                { id: 'balanced', label: '均衡' },
                { id: 'action', label: '动作' },
                { id: 'psychology', label: '心理' },
                { id: 'description', label: '环境' },
              ] as const).map(style => (
                <button
                  key={style.id}
                  onClick={() => updateAISettings({ style: style.id })}
                  className={`py-1 text-xs rounded transition-colors ${
                    aiSettings.style === style.id
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-ink-700/50 text-ink-400 border border-transparent hover:text-ink-200'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="p-3 border-b border-ink-800/50">
        <button
          onClick={handleGenerateContinuation}
          disabled={isGenerating || !currentChapter}
          className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              智能续写
            </>
          )}
        </button>

        <div className="grid grid-cols-3 gap-1.5 mt-2">
          <div className="relative" ref={expandMenuRef}>
            <button
              onClick={() => setShowExpandMenu(!showExpandMenu)}
              disabled={!currentChapter || isGenerating}
              className="w-full py-1.5 text-xs text-ink-400 hover:text-ink-200 bg-ink-800/50 hover:bg-ink-700/50 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-0.5"
            >
              扩写
              <ChevronDown className="w-3 h-3" />
            </button>
            {showExpandMenu && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-ink-800 border border-ink-700 rounded-md shadow-medium py-1 z-20">
                <button
                  onClick={() => handleExpand('detail')}
                  disabled={isGenerating}
                  className="w-full px-2 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50"
                >
                  丰富细节
                </button>
                <button
                  onClick={() => handleExpand('dialogue')}
                  disabled={isGenerating}
                  className="w-full px-2 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50"
                >
                  增加对话
                </button>
                <button
                  onClick={() => handleExpand('environment')}
                  disabled={isGenerating}
                  className="w-full px-2 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50"
                >
                  环境描写
                </button>
                <button
                  onClick={() => handleExpand('psychology')}
                  disabled={isGenerating}
                  className="w-full px-2 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50"
                >
                  心理活动
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handlePolish}
            disabled={!currentChapter || isGenerating}
            className="py-1.5 text-xs text-ink-400 hover:text-ink-200 bg-ink-800/50 hover:bg-ink-700/50 rounded transition-colors disabled:opacity-50"
          >
            润色
          </button>
          <button
            onClick={handleSwitchPerspective}
            disabled={!currentChapter || isGenerating || characters.length === 0}
            className="py-1.5 text-xs text-ink-400 hover:text-ink-200 bg-ink-800/50 hover:bg-ink-700/50 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-0.5"
          >
            <UserRound className="w-3 h-3" />
            换视角
          </button>
        </div>
      </div>

      {/* Suggestions List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isGenerating && streamingContent && (
          <div className="card p-3 animate-slide-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-300 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                AI 生成中...
              </span>
              <button
                onClick={() => {
                  abortRef.current?.abort();
                }}
                className="p-0.5 text-ink-500 hover:text-ink-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div
              className="text-sm text-ink-300 max-h-40 overflow-y-auto writing-font leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(streamingContent) }}
            />
          </div>
        )}
        {!isGenerating && aiSuggestions.length === 0 ? (
          <div className="text-center py-8">
            <Sparkles className="w-8 h-8 text-ink-600 mx-auto mb-2" />
            <p className="text-sm text-ink-500">点击上方按钮</p>
            <p className="text-xs text-ink-600">让 AI 帮你续写故事</p>
          </div>
        ) : !isGenerating && (
          aiSuggestions.map((suggestion, index) => (
            <div
              key={suggestion.id}
              className="card p-3 animate-slide-up"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-amber-300">{suggestion.title}</span>
                <button
                  onClick={clearAISuggestions}
                  className="p-0.5 text-ink-500 hover:text-ink-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div
                className="text-sm text-ink-300 mb-3 max-h-40 overflow-y-auto writing-font leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(suggestion.content) }}
              />

              <div className="flex items-start gap-2 mb-3 p-2 bg-ink-800/50 rounded text-[11px] text-ink-500">
                <span className="text-amber-400 flex-shrink-0 mt-0.5">💡</span>
                <div>
                  <span className="text-ink-400">生成依据：</span>
                  {suggestion.contextUsed.join('、')}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleApplySuggestion(suggestion.content)}
                  className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  采纳
                </button>
                <button
                  onClick={() => handleInsertAtCursor(suggestion.content)}
                  className="flex-1 py-1.5 text-xs bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded transition-colors flex items-center justify-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  插入光标处
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
