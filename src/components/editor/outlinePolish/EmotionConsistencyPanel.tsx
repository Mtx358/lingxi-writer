/**
 * 情感一致性面板（规格书第二档-10）
 *
 * 跨章情感强度曲线 + 情绪断裂点告警。AI 负责分析，人类负责判断哪里该加过渡。
 * 点击曲线柱或断裂点可跳转到对应章节。
 */
import { useState, useCallback } from 'react';
import { Activity, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { analyzeEmotionConsistency, type EmotionConsistencyReport } from '@/utils/aiService/polishTools';
import { toast } from '@/hooks/useToast';
import { Section, EmptyHint, CurveCard } from './shared';

export function EmotionConsistencyPanel() {
  const chapters = useAppStore(s => s.chapters);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const recordPolishAction = useAppStore(s => s.recordPolishAction);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<EmotionConsistencyReport | null>(null);

  const mainChapters = chapters.filter(c => c.levelType === 'chapter');

  const handleAnalyze = useCallback(async () => {
    if (mainChapters.length === 0) return;
    setLoading(true);
    try {
      const r = await analyzeEmotionConsistency({ chapters: mainChapters });
      setReport(r);
      recordPolishAction('pacing');
      if (r.inconsistencies.length > 0) {
        toast.warning('发现情感断裂', `${r.inconsistencies.length} 处情绪跳跃过大，建议增加过渡`);
      } else {
        toast.success('情感走向连贯', '未发现明显断裂点');
      }
    } catch {
      toast.error('分析失败', '请检查 API 配置后重试');
    } finally {
      setLoading(false);
    }
  }, [mainChapters, recordPolishAction]);

  const handleJump = useCallback((chapterId: string) => {
    setCurrentChapter(chapterId);
  }, [setCurrentChapter]);

  if (mainChapters.length === 0) {
    return <EmptyHint icon={Activity} text="还没有正文章节，无法分析情感走向" />;
  }

  return (
    <Section
      icon={Activity}
      title="情感一致性"
      desc="跨章情感强度曲线 + 断裂点告警"
      action={
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="text-[11px] px-2 py-1 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 rounded flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {report ? '重新分析' : '开始分析'}
        </button>
      }
    >
      {report ? (
        <div className="space-y-3">
          {/* 概述 */}
          <div className="p-2.5 rounded-lg bg-ink-800/40 border border-ink-700/50">
            <div className="text-[10px] text-ink-500 mb-0.5">整体走向</div>
            <div className="text-xs text-ink-300 leading-relaxed">{report.overview}</div>
          </div>

          {/* 情感曲线 */}
          <CurveCard
            title="情感强度曲线"
            data={report.curve}
            valueKey="intensity"
            color="from-pink-600 to-pink-400"
            onJumpTo={handleJump}
          />

          {/* 情感标签条 */}
          {report.curve.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {report.curve.map(p => (
                <button
                  key={p.chapterId}
                  onClick={() => handleJump(p.chapterId)}
                  className="text-[9px] px-1.5 py-0.5 bg-ink-800/50 text-ink-400 hover:text-ink-200 rounded transition-colors"
                  title={`第${p.order + 1}章 ${p.chapterTitle}`}
                >
                  {p.emotion}
                </button>
              ))}
            </div>
          )}

          {/* 断裂点 */}
          {report.inconsistencies.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[11px] text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                情感断裂点（{report.inconsistencies.length}）
              </div>
              {report.inconsistencies.map((inc, idx) => {
                const ch = chapters.find(c => c.id === inc.chapterId);
                return (
                  <div key={idx} className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <button
                      onClick={() => handleJump(inc.chapterId)}
                      className="text-[11px] font-medium text-amber-300 hover:underline text-left"
                    >
                      {ch ? `第${ch.order + 1}章 · ${ch.title}` : '未知章节'}
                    </button>
                    <div className="text-[10px] text-ink-500 mt-0.5">{inc.description}</div>
                    <div className="text-[10px] text-ink-400 mt-0.5">建议：{inc.suggestion}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <EmptyHint icon={Activity} text="点击「开始分析」生成跨章情感曲线与断裂点" />
      )}
    </Section>
  );
}

export default EmotionConsistencyPanel;
