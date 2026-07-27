import { useEffect } from 'react';
import { X, HelpCircle, Loader2, MessageSquarePlus } from 'lucide-react';
import type { MaterialQuestion } from '@/types';
import { pushOverlay, popOverlay } from '@/utils/overlayState';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import Empty from '@/components/Empty';

interface QuestionDrawerProps {
  questionTargetId: string | null;
  questions: MaterialQuestion[];
  asking: boolean;
  answers: Record<number, string>;
  onAnswerChange: (index: number, value: string) => void;
  onClose: () => void;
  onSpawnChild: (question: MaterialQuestion, answer: string) => void;
}

export function QuestionDrawer({
  questionTargetId,
  questions,
  asking,
  answers,
  onAnswerChange,
  onClose,
  onSpawnChild,
}: QuestionDrawerProps) {
  // 焦点陷阱：抽屉打开时锁定 Tab 在模态内循环，关闭时恢复焦点
  const questionDrawerRef = useFocusTrap<HTMLDivElement>(!!questionTargetId);

  // 抽屉打开时注册浮层（屏蔽全局快捷键 Ctrl+S/K 等）+ ESC 关闭
  useEffect(() => {
    if (!questionTargetId) return;
    pushOverlay();
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      popOverlay();
      window.removeEventListener('keydown', handler, true);
    };
  }, [questionTargetId, onClose]);

  if (!questionTargetId) return null;

  return (
    <div
      ref={questionDrawerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="深度提问"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[80vh] bg-ink-900 border border-ink-700 rounded-xl shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-800/50">
          <div className="flex items-center gap-2 text-ink-100 text-sm font-medium">
            <HelpCircle className="w-4 h-4 text-cyan-400" />
            深度提问
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {asking ? (
            <div className="py-10 text-center text-ink-500 text-sm flex flex-col items-center gap-2" role="status" aria-live="polite">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              AI 正在为这张卡片深度提问...
            </div>
          ) : questions.length === 0 ? (
            <Empty title="暂无问题，可重试" className="py-8 text-sm" />
          ) : (
            questions.map((q, i) => (
              <div key={i} className="p-3 bg-ink-800/40 border border-ink-700/50 rounded">
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                    {q.dimension}
                  </span>
                </div>
                <div className="text-xs text-ink-200 mb-2">{q.question}</div>
                <textarea
                  value={answers[i] || ''}
                  onChange={e => onAnswerChange(i, e.target.value)}
                  placeholder="回答这个问题，会生成子卡片附着在主卡下方"
                  rows={2}
                  className="input text-xs py-1.5 w-full resize-none"
                />
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={() => onSpawnChild(q, answers[i] || '')}
                    disabled={!answers[i]?.trim()}
                    className="px-2 py-1 text-[10px] bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 rounded flex items-center gap-1 disabled:opacity-40"
                  >
                    <MessageSquarePlus className="w-3 h-3" />
                    生成子卡片
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
