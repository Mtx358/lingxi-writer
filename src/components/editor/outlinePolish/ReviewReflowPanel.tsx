/**
 * 读者评论回流域（规格书 3.3）
 *
 * 创作者粘贴读者评论摘要 → AI 自动归类 → 汇入对应打磨阶段。
 *  - "配角林清瑶太久没出现" → character（汇入骨架-角色活跃度）
 *  - "第15章反派动机不够充分" → pacing（汇入章节-节拍扩展）
 *  - "猜出了伏笔#7的走向" → foreshadow（汇入深度校验-伏笔）
 */
import { useState, useCallback } from 'react';
import { MessageSquare, Sparkles, RefreshCw, Check, Trash2, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { classifyReaderReview, type ReviewReflowResult } from '@/utils/aiService/polishTools';
import { Section, EmptyHint } from './shared';
import { toast } from '@/hooks/useToast';
import type { ReviewReflowTarget } from '@/types';
import type { TabId } from './types';

const TARGET_META: Record<ReviewReflowTarget, { label: string; cls: string; stage: string; jumpTab: TabId | null }> = {
  foreshadow: { label: '伏笔', cls: 'text-cyan-300 bg-cyan-400/10', stage: '深度校验→伏笔看板', jumpTab: 'foreshadowBoard' },
  character: { label: '角色', cls: 'text-blue-300 bg-blue-400/10', stage: '骨架→角色活跃度', jumpTab: 'characters' },
  pacing: { label: '节奏', cls: 'text-amber-300 bg-amber-400/10', stage: '章节→节拍扩展', jumpTab: 'pacing' },
  structure: { label: '结构', cls: 'text-purple-300 bg-purple-400/10', stage: '骨架→结构', jumpTab: 'skeleton' },
  other: { label: '其他', cls: 'text-ink-400 bg-ink-700/40', stage: '人工研判', jumpTab: null },
};

// 跨组件跳转：与 OutlinePolishPanel 的 storage 事件监听对齐
function jumpToTab(tabId: TabId) {
  localStorage.setItem('polish:targetTab', tabId);
  // 同窗口内 storage 事件不触发，需手动派发；OutlinePolishPanel 在 mount 时也会读取一次
  window.dispatchEvent(new StorageEvent('storage', { key: 'polish:targetTab', newValue: tabId }));
}

export function ReviewReflowPanel() {
  const chapters = useAppStore(s => s.chapters);
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const reflows = useAppStore(s => s.reviewReflows);
  const addReviewReflow = useAppStore(s => s.addReviewReflow);
  const resolveReviewReflow = useAppStore(s => s.resolveReviewReflow);
  const deleteReviewReflow = useAppStore(s => s.deleteReviewReflow);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const handleClassify = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const result: ReviewReflowResult = await classifyReaderReview({
        content: trimmed,
        chapters,
        characters,
        foreshadows,
      });
      addReviewReflow({
        content: trimmed,
        target: result.target,
        suggestion: result.suggestion,
        relatedChapterId: result.relatedChapterId,
        relatedCharacterId: result.relatedCharacterId,
        relatedForeshadowId: result.relatedForeshadowId,
      });
      const meta = TARGET_META[result.target];
      toast.success('已归类', `汇入：${meta.stage}`);
      setInput('');
    } catch {
      toast.error('归类失败', '请检查 API 配置后重试');
    } finally {
      setLoading(false);
    }
  }, [input, chapters, characters, foreshadows, addReviewReflow]);

  const visibleReflows = showResolved ? reflows : reflows.filter(r => !r.resolved);

  return (
    <Section
      icon={MessageSquare}
      title="读者评论回流"
      desc="粘贴读者评论 → AI 归类 → 汇入对应打磨阶段"
      action={
        <button
          onClick={() => setShowResolved(v => !v)}
          className="px-1.5 py-0.5 text-[10px] text-ink-400 hover:text-ink-200 rounded"
        >
          {showResolved ? '仅未处理' : '显示全部'}（{reflows.filter(r => !r.resolved).length}/{reflows.length}）
        </button>
      }
    >
      {/* 评论输入 */}
      <div className="flex gap-1.5">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading && input.trim()) {
              e.preventDefault();
              handleClassify();
            }
          }}
          placeholder="粘贴读者评论摘要，如：有读者提到配角林清瑶太久没出现（Ctrl+Enter 快捷归类）"
          className="input text-xs flex-1 resize-none"
          rows={2}
        />
        <button
          onClick={handleClassify}
          disabled={loading || !input.trim()}
          className="px-2 py-1 text-[11px] bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 rounded flex items-center gap-1 disabled:opacity-50 self-start whitespace-nowrap"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          归类
        </button>
      </div>

      {/* 回流列表 */}
      {visibleReflows.length === 0 ? (
        <EmptyHint
          icon={MessageSquare}
          hint={reflows.length === 0 ? '还没有评论回流' : '未处理的评论已清空'}
          subHint="粘贴读者评论后点「归类」，AI 会自动判断汇入哪个打磨阶段"
        />
      ) : (
        <div className="space-y-1.5">
          {visibleReflows.map(r => {
            const meta = TARGET_META[r.target];
            const handleReflow = () => {
              if (meta.jumpTab) jumpToTab(meta.jumpTab);
              if (r.relatedChapterId) {
                setCurrentChapter(r.relatedChapterId);
                const ch = chapters.find(c => c.id === r.relatedChapterId);
                toast.info('已定位到关联章节', ch ? `《${ch.title}》` : '可在对应阶段查看');
              } else if (meta.jumpTab) {
                toast.info('已跳转到对应阶段', meta.stage);
              }
            };
            return (
              <div key={r.id} className="p-2 bg-ink-800/30 rounded-lg border border-ink-700/50">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[10px] text-ink-500 flex items-center gap-0.5">
                    <ArrowRight className="w-2.5 h-2.5" /> {meta.stage}
                  </span>
                  {r.resolved && <span className="text-[10px] text-emerald-400">已处理</span>}
                  <div className="ml-auto flex items-center gap-1">
                    {!r.resolved && meta.jumpTab && (
                      <button
                        onClick={handleReflow}
                        title={`去处理：跳转到「${meta.stage}」`}
                        className="p-0.5 text-cyan-300 hover:bg-cyan-400/10 rounded flex items-center gap-0.5 text-[10px]"
                      >
                        <ArrowUpRight className="w-3 h-3" /> 去处理
                      </button>
                    )}
                    {!r.resolved && (
                      <button
                        onClick={() => resolveReviewReflow(r.id)}
                        title="标记为已处理"
                        className="p-0.5 text-emerald-400 hover:bg-emerald-400/10 rounded"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteReviewReflow(r.id)}
                      title="删除"
                      className="p-0.5 text-red-400/60 hover:text-red-400 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-ink-200 mt-1 leading-relaxed">「{r.content}」</div>
                <div className="text-[11px] text-amber-300/80 mt-0.5">{r.suggestion}</div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
