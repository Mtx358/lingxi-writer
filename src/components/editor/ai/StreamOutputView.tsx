import { memo } from 'react';
import { Check, X, Send, Loader2, Layers, Sparkles } from 'lucide-react';
import { sanitizeAiHtml } from '@/hooks/useEditorAI';
import Empty from '@/components/Empty';
import type { AISuggestion } from '@/types';

/**
 * AIPanel 主输出区：流式生成中卡片 / 多版本生成中卡片 / 版本列表 / 建议卡片 / 空状态。
 *
 * 拆分自原 AIPanel.tsx 的 Suggestions List 区块。所有 handler 通过 props 注入，
 * 组件本身只负责渲染，状态由父组件 AIPanel 持有。
 *
 * 空状态使用统一的 <Empty> 组件（带 role="status" + aria-live="polite"），
 * 替代原先散落的内联 `<div className="text-center py-8">` 占位。
 *
 * memo：父组件 AIPanel 在 instructionText 按键等无关状态变化时频繁重渲染；本组件
 * 所有 props 均为稳定引用（state 值 + store 选择器 + useCallback 回调），memo 可在
 * 非流式期间跳过无关重渲染。流式期间 streamingContent 变化仍正常触发重渲染。
 */
export interface StreamOutputViewProps {
  isGenerating: boolean;
  isGeneratingVersions: boolean;
  streamingContent: string;
  versions: string[];
  aiSuggestions: AISuggestion[];
  /** 中止进行中的请求（点击流式卡片/多版本卡片的 X） */
  onAbort: () => void;
  /** 清空多版本结果 */
  onClearVersions: () => void;
  /** 清空 AI 建议列表（建议卡片右上角 X） */
  onClearAISuggestions: () => void;
  /** 采纳多版本中的某一版（追加到章节末尾） */
  onApplyVersion: (content: string) => void;
  /** 把多版本中的某一版插入到光标位置 */
  onInsertVersionAtCursor: (content: string) => void;
  /** 采纳 AI 建议（追加到章节末尾） */
  onApplySuggestion: (content: string) => void;
  /** 把 AI 建议插入到光标位置 */
  onInsertAtCursor: (content: string) => void;
}

const StreamOutputView = memo(function StreamOutputView({
  isGenerating,
  isGeneratingVersions,
  streamingContent,
  versions,
  aiSuggestions,
  onAbort,
  onClearVersions,
  onClearAISuggestions,
  onApplyVersion,
  onInsertVersionAtCursor,
  onApplySuggestion,
  onInsertAtCursor,
}: StreamOutputViewProps) {
  const isEmpty =
    !isGenerating && !isGeneratingVersions && aiSuggestions.length === 0 && versions.length === 0;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {isGenerating && streamingContent && (
        <div className="card p-3 animate-slide-up">
          <div className="flex items-center justify-between mb-2">
            <span role="status" aria-live="polite" className="text-sm font-medium text-amber-300 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              AI 生成中...
            </span>
            <button
              onClick={onAbort}
              aria-label="关闭"
              className="p-0.5 text-ink-500 hover:text-ink-300"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {/* 流式逐 chunk 拼接，atomic=false 避免整段重读 */}
          <div
            aria-live="polite"
            aria-atomic="false"
            className="text-sm text-ink-300 max-h-40 overflow-y-auto writing-font leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(streamingContent) }}
          />
        </div>
      )}
      {isGeneratingVersions && (
        <div className="card p-3 animate-slide-up">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-amber-300 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              正在并发生成多个版本...
            </span>
            <button
              onClick={onAbort}
              aria-label="关闭多版本"
              className="p-0.5 text-ink-500 hover:text-ink-300"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="text-[11px] text-ink-500">使用不同温度偏移生成 3 个版本，便于横向比较后采纳。</p>
        </div>
      )}
      {versions.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-300 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />
              已生成 {versions.length} 个版本
            </span>
            <button
              onClick={onClearVersions}
              aria-label="清空版本"
              className="p-0.5 text-ink-500 hover:text-ink-300"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {versions.map((v, idx) => (
            <div key={idx} className="card p-3 animate-slide-up">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-amber-300">版本 {idx + 1}</span>
                <span className="text-[10px] text-ink-500">
                  {idx === 0 ? '基准温度' : idx === 1 ? '温度 -0.2（保守）' : '温度 +0.2（创意）'}
                </span>
              </div>
              <div
                className="text-sm text-ink-300 mb-3 max-h-32 overflow-y-auto writing-font leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(v) }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onApplyVersion(v)}
                  className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  采纳
                </button>
                <button
                  onClick={() => onInsertVersionAtCursor(v)}
                  className="flex-1 py-1.5 text-xs bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded transition-colors flex items-center justify-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  插入光标处
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {isEmpty ? (
        <Empty
          icon={<Sparkles className="w-8 h-8 text-ink-600" />}
          title="点击上方按钮"
          description="让 AI 帮你续写故事"
          className="py-8"
        />
      ) : !isGenerating && !isGeneratingVersions && (
        aiSuggestions.map((suggestion, index) => (
          <div
            key={suggestion.id}
            className="card p-3 animate-slide-up"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-300">{suggestion.title}</span>
              <button
                onClick={onClearAISuggestions}
                aria-label="清空建议"
                className="p-0.5 text-ink-500 hover:text-ink-300"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
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
                onClick={() => onApplySuggestion(suggestion.content)}
                className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors flex items-center justify-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                采纳
              </button>
              <button
                onClick={() => onInsertAtCursor(suggestion.content)}
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
  );
});

export default StreamOutputView;
