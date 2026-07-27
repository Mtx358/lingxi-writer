import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { Sparkles, Send, SlidersHorizontal, RefreshCw, ChevronDown, UserRound, Loader2, Compass, Layers } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { AISettings } from '@/types';
import GenerateModeSelector from './GenerateModeSelector';
import StreamOutputView from './StreamOutputView';
import { useStreamThrottle } from './useStreamThrottle';
import { useAIPanelActions } from './useAIPanelActions';

/**
 * AI 助手面板（灵犀写作）。
 *
 * 主组件负责：
 *   - 顶部标题栏 + 设置齿轮
 *   - 设定巡航简版（折叠/展开主角/世界观/故事主线）
 *   - 自由指令输入 + 多版本生成入口 + 中止按钮
 *   - 快捷动作（智能续写 / 扩写菜单 / 润色 / 换视角）
 *   - 输出区委托给 <StreamOutputView>
 *   - 设置面板委托给 <GenerateModeSelector>
 *
 * 6 个生成 handler + 4 个应用/插入 handler 抽到 useAIPanelActions；
 * 流式 chunk 节流抽到 useStreamThrottle。
 */
export default function AIPanel() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showExpandMenu, setShowExpandMenu] = useState(false);
  const instructionId = useId();
  const expandMenuRef = useRef<HTMLDivElement>(null);
  const closeExpandMenu = useCallback(() => setShowExpandMenu(false), []);
  useClickOutside(expandMenuRef, closeExpandMenu, showExpandMenu);

  // 防抖：文本类 AI 设置（baseUrl/model/apiKey）输入时累积更新，300ms 后批量写入 store
  const debouncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Partial<AISettings>>({});

  // 灵犀写作：自由指令生成 + 多版本生成 + 设定巡航
  const [instructionText, setInstructionText] = useState('');
  const [versions, setVersions] = useState<string[]>([]);
  const [isGeneratingVersions, setIsGeneratingVersions] = useState(false);
  const [showCruise, setShowCruise] = useState(true);

  // 流式 chunk 节流：onChunk 攒入 buffer，由 timer 按 AI_STREAM_THROTTLE_MS 间隔 flush
  const { appendChunk, flushStreamContent, resetStreamBuffer } = useStreamThrottle(setStreamingContent);

  // 9 个字段集中订阅：useShallow 浅比较，任一字段变化才触发重渲染。
  // currentChapterId/chapters/aiSuggestions/characters/aiSettings 为数据字段，
  // clearAISuggestions/updateAISettings/getSettingCard/getBlueprint 为稳定 action。
  const {
    currentChapterId,
    chapters,
    aiSuggestions,
    characters,
    clearAISuggestions,
    aiSettings,
    updateAISettings,
    getSettingCard,
    getBlueprint,
  } = useAppStore(
    useShallow(s => ({
      currentChapterId: s.currentChapterId,
      chapters: s.chapters,
      aiSuggestions: s.aiSuggestions,
      characters: s.characters,
      clearAISuggestions: s.clearAISuggestions,
      aiSettings: s.aiSettings,
      updateAISettings: s.updateAISettings,
      getSettingCard: s.getSettingCard,
      getBlueprint: s.getBlueprint,
    })),
  );
  // 派生 currentChapter 用 useMemo 收敛：避免在 selector 内执行 find 派生对象
  const currentChapter = useMemo(() => chapters.find(c => c.id === currentChapterId), [chapters, currentChapterId]);
  const settingCard = useMemo(() => getSettingCard(), [getSettingCard]);
  const blueprint = useMemo(() => getBlueprint(), [getBlueprint]);

  const {
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
  } = useAIPanelActions({
    currentChapterId,
    currentChapter,
    characters,
    aiSettings,
    settingCard,
    blueprint,
    instructionText,
    isGenerating,
    isGeneratingVersions,
    setIsGenerating,
    setIsGeneratingVersions,
    setStreamingContent,
    setVersions,
    appendChunk,
    flushStreamContent,
    resetStreamBuffer,
  });

  // 文本类设置防抖写入：合并短时间内多次输入，避免每次按键都触发 store 更新与持久化
  const debouncedUpdateAISettings = useCallback((updates: Partial<AISettings>) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    if (debouncedTimerRef.current) clearTimeout(debouncedTimerRef.current);
    debouncedTimerRef.current = setTimeout(() => {
      updateAISettings(pendingUpdatesRef.current);
      pendingUpdatesRef.current = {};
    }, 300);
  }, [updateAISettings]);

  // 切换 provider：填充对应默认 baseUrl/model
  const handleProviderChange = useCallback((provider: AISettings['provider']) => {
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
  }, [aiSettings.baseUrl, aiSettings.model, updateAISettings]);

  // 组件卸载时中止进行中的 AI 请求并清理防抖定时器，防止卸载后 setState
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debouncedTimerRef.current) clearTimeout(debouncedTimerRef.current);
      // 清理流式节流 timer，防止卸载后 timer 回调触发 setState
      resetStreamBuffer();
      // flush 未落盘的防抖更新：用户在 baseUrl/model/apiKey 输入后 300ms 内卸载面板，
      // pendingUpdatesRef 中的内容会丢失，导致用户输入未保存。此处同步写入 store
      const pending = pendingUpdatesRef.current;
      if (Object.keys(pending).length > 0) {
        pendingUpdatesRef.current = {};
        try { updateAISettings(pending); } catch (e) { console.warn('flush pendingAISettings on unmount failed:', e); }
      }
    };
  }, [updateAISettings, abortRef, resetStreamBuffer]);

  // 切换章节时清空多版本结果与流式内容：避免 A 章的 versions 被错插到 B 章
  useEffect(() => {
    setVersions([]);
    setStreamingContent('');
    // 清理流式节流 buffer/timer，防止切章后残留 chunk 写入新章
    resetStreamBuffer();
    // 切章时若有进行中的请求，主动中止（旧请求结果不应落到新章）
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setIsGeneratingVersions(false);
  }, [currentChapterId, abortRef, resetStreamBuffer]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, [abortRef]);

  // 稳定引用：StreamOutputView 已 memo 化，内联箭头函数会使每次父渲染都生成新引用从而失效 memo
  const handleClearVersions = useCallback(() => setVersions([]), []);

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
          aria-label="AI 设置"
          className={`p-1.5 rounded-md transition-colors ${
            showSettings ? 'text-amber-400 bg-amber-400/10' : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* AI Settings */}
      <GenerateModeSelector
        showSettings={showSettings}
        aiSettings={aiSettings}
        updateAISettings={updateAISettings}
        debouncedUpdateAISettings={debouncedUpdateAISettings}
        onProviderChange={handleProviderChange}
        syncSettings={syncSettings}
      />

      {/* 灵犀写作：设定巡航简版 */}
      {settingCard && (
        <div className="border-b border-ink-800/50">
          <button
            onClick={() => setShowCruise(!showCruise)}
            className="w-full px-3 py-2 flex items-center justify-between text-xs text-ink-300 hover:bg-ink-800/30 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              设定巡航
            </span>
            <ChevronDown className={`w-3 h-3 text-ink-500 transition-transform ${showCruise ? 'rotate-180' : ''}`} />
          </button>
          {showCruise && (
            <div className="px-3 pb-2.5 space-y-2 text-[11px] bg-ink-800/20">
              {/* 主角卡 */}
              <div className="p-2 bg-ink-800/40 rounded">
                <div className="text-amber-300/80 mb-1">主角 · {settingCard.protagonist.name || '未命名'}</div>
                {settingCard.protagonist.personalityKeywords.length > 0 && (
                  <div className="text-ink-400 mb-1">
                    性格：{settingCard.protagonist.personalityKeywords.join('、')}
                  </div>
                )}
                {settingCard.protagonist.coreDesire && (
                  <div className="text-ink-400 mb-1">核心欲望：{settingCard.protagonist.coreDesire}</div>
                )}
                {settingCard.protagonist.goldenFinger && (
                  <div className="text-ink-400">金手指：{settingCard.protagonist.goldenFinger}</div>
                )}
              </div>
              {/* 世界观简版 */}
              {(settingCard.worldview.powerSystem || settingCard.worldview.basicRules) && (
                <div className="p-2 bg-ink-800/40 rounded">
                  <div className="text-amber-300/80 mb-1">世界观</div>
                  {settingCard.worldview.powerSystem && (
                    <div className="text-ink-400 mb-1">力量体系：{settingCard.worldview.powerSystem}</div>
                  )}
                  {settingCard.worldview.basicRules && (
                    <div className="text-ink-400">基础规则：{settingCard.worldview.basicRules}</div>
                  )}
                </div>
              )}
              {/* 蓝图主线一句话 */}
              {blueprint?.mainline && (
                <div className="p-2 bg-ink-800/40 rounded">
                  <div className="text-amber-300/80 mb-1">故事主线</div>
                  <div className="text-ink-400 leading-relaxed">{blueprint.mainline}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 灵犀写作：自由指令输入 + 多版本生成 */}
      <div className="p-3 border-b border-ink-800/50 space-y-2">
        <label htmlFor={instructionId} className="text-xs text-ink-400 flex items-center gap-1.5">
          <Send className="w-3 h-3 text-amber-400" />
          写作指令
        </label>
        <textarea
          id={instructionId}
          value={instructionText}
          onChange={(e) => setInstructionText(e.target.value)}
          placeholder="例：写一段主角与反派在城市天台的对峙，要紧张感强，结尾留一个反转伏笔"
          rows={3}
          className="w-full px-2 py-1.5 text-xs bg-ink-700/50 text-ink-200 border border-ink-600/50 rounded focus:outline-none focus:border-amber-400/50 resize-none writing-font"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={handleGenerateByInstruction}
            disabled={!currentChapter || isGenerating || isGeneratingVersions || !instructionText.trim()}
            className="py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                生成中
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3" />
                按指令生成
              </>
            )}
          </button>
          <button
            onClick={handleGenerateVersions}
            disabled={!currentChapter || isGenerating || isGeneratingVersions || !instructionText.trim()}
            className="py-1.5 text-xs bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            {isGeneratingVersions ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                多版本中
              </>
            ) : (
              <>
                <Layers className="w-3 h-3" />
                生成多版本
              </>
            )}
          </button>
        </div>
        {(isGenerating || isGeneratingVersions) && (
          <button
            onClick={handleAbort}
            className="w-full py-1 text-[11px] text-ink-500 hover:text-red-300 transition-colors"
          >
            中止生成
          </button>
        )}
      </div>

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
              disabled={!currentChapter || isGenerating || isGeneratingVersions}
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
            disabled={!currentChapter || isGenerating || isGeneratingVersions || characters.length === 0}
            className="py-1.5 text-xs text-ink-400 hover:text-ink-200 bg-ink-800/50 hover:bg-ink-700/50 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-0.5"
          >
            <UserRound className="w-3 h-3" />
            换视角
          </button>
        </div>
      </div>

      {/* Suggestions / Versions / Streaming */}
      <StreamOutputView
        isGenerating={isGenerating}
        isGeneratingVersions={isGeneratingVersions}
        streamingContent={streamingContent}
        versions={versions}
        aiSuggestions={aiSuggestions}
        onAbort={handleAbort}
        onClearVersions={handleClearVersions}
        onClearAISuggestions={clearAISuggestions}
        onApplyVersion={handleApplyVersion}
        onInsertVersionAtCursor={handleInsertVersionAtCursor}
        onApplySuggestion={handleApplySuggestion}
        onInsertAtCursor={handleInsertAtCursor}
      />
    </div>
  );
}
