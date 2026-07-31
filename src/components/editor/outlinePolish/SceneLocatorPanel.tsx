/**
 * 场景定位仪面板（规格书第二档-7）
 *
 * 为每章标记四要素：视点人物 / 开场情绪 / 收尾情绪 / 信息释放量 / 关联伏笔。
 * AI 负责批量推断，人类负责逐章判断与修正——改完即时写回 chapter.sceneLocator。
 */
import { useState, useCallback, useMemo } from 'react';
import { Crosshair, Sparkles, RefreshCw, Check, Gauge } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { suggestSceneLocators, scoreSceneLocator, type SceneLocatorSuggestion } from '@/utils/aiService/polishTools';
import { toast } from '@/hooks/useToast';
import { Section, EmptyHint } from './shared';
import type { SceneLocator } from '@/types';
import { isPolishableChapter } from '@/utils/chapterUtils';

export function SceneLocatorPanel() {
  const chapters = useAppStore(s => s.chapters);
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const updateChapter = useAppStore(s => s.updateChapter);
  const recordPolishAction = useAppStore(s => s.recordPolishAction);

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, SceneLocatorSuggestion>>({});

  const mainChapters = chapters.filter(c => isPolishableChapter(c));

  const handleAutoSuggest = useCallback(async () => {
    if (mainChapters.length === 0) return;
    setLoading(true);
    try {
      const result = await suggestSceneLocators({ chapters: mainChapters, characters, foreshadows });
      const map: Record<string, SceneLocatorSuggestion> = {};
      for (const s of result) map[s.chapterId] = s;
      setSuggestions(map);
      toast.success('场景定位已推断', `${result.length} 章的四要素已生成，请逐章确认或修正`);
    } catch {
      toast.error('推断失败', '请检查 API 配置后重试');
    } finally {
      setLoading(false);
    }
  }, [mainChapters, characters, foreshadows]);

  const handleApply = useCallback((chapterId: string, locator: SceneLocator) => {
    // 填完自动生成本章评分（规格书阶段3-4）：基于四要素完整度计算 0-100
    const { score, breakdown } = scoreSceneLocator(locator);
    updateChapter(chapterId, { sceneLocator: { ...locator, score, scoreBreakdown: breakdown } });
    recordPolishAction('pacing');
  }, [updateChapter, recordPolishAction]);

  /** 就地编辑四要素后立即重算评分（无需重新打开 AI 推断） */
  const handleFieldEdit = useCallback((chapterId: string, current: SceneLocator | undefined, patch: Partial<SceneLocator>) => {
    const merged: SceneLocator = { ...current, ...patch };
    const { score, breakdown } = scoreSceneLocator(merged);
    updateChapter(chapterId, { sceneLocator: { ...merged, score, scoreBreakdown: breakdown } });
    recordPolishAction('pacing');
  }, [updateChapter, recordPolishAction]);

  /** 全部章节评分汇总 */
  const scoreSummary = useMemo(() => {
    const scored = mainChapters
      .map(ch => ch.sceneLocator?.score)
      .filter((s): s is number => typeof s === 'number');
    if (scored.length === 0) return null;
    const avg = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
    const max = Math.max(...scored);
    const min = Math.min(...scored);
    return { avg, max, min, count: scored.length };
  }, [mainChapters]);

  /** 评分 → 配色 */
  const scoreColor = (score: number): string => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 50) return 'text-amber-400';
    return 'text-red-400';
  };

  if (mainChapters.length === 0) {
    return <EmptyHint icon={Crosshair} text="还没有正文章节，无法标记场景定位" />;
  }

  return (
    <Section
      icon={Crosshair}
      title="场景定位仪"
      desc="每场戏的视点 / 情绪起止 / 信息释放 / 伏笔关联 · 填完自动评分"
      action={
        <button
          onClick={handleAutoSuggest}
          disabled={loading}
          className="text-[11px] px-2 py-1 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 rounded flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          AI 推断全部
        </button>
      }
    >
      {/* 评分汇总条 */}
      {scoreSummary && (
        <div className="mb-2 p-2 bg-ink-800/40 rounded-lg flex items-center gap-3 text-[10px]">
          <Gauge className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-ink-400">本章评分汇总（{scoreSummary.count}/{mainChapters.length} 章已标记）</span>
          <span className={scoreColor(scoreSummary.avg)}>均分 {scoreSummary.avg}</span>
          <span className={scoreColor(scoreSummary.max)}>最高 {scoreSummary.max}</span>
          <span className={scoreColor(scoreSummary.min)}>最低 {scoreSummary.min}</span>
        </div>
      )}

      <div className="space-y-2">
        {mainChapters.map(ch => {
          const current = ch.sceneLocator;
          const suggestion = suggestions[ch.id];
          const score = current?.score;
          const breakdown = current?.scoreBreakdown;
          return (
            <div key={ch.id} className="p-2.5 rounded-lg bg-ink-800/40 border border-ink-700/50">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs font-medium text-ink-200">
                  第{ch.order + 1}章 · {ch.title}
                </div>
                <div className="flex items-center gap-1.5">
                  {typeof score === 'number' && (
                    <span className={`flex items-center gap-0.5 text-[10px] font-medium ${scoreColor(score)}`} title={`视点${breakdown?.povClarity ?? 0}·情绪${breakdown?.emotionArc ?? 0}·信息${breakdown?.infoRhythm ?? 0}·伏笔${breakdown?.foreshadowDensity ?? 0}`}>
                      <Gauge className="w-3 h-3" />
                      {score}
                    </span>
                  )}
                  {suggestion && (!current || JSON.stringify(current) !== JSON.stringify({ ...suggestion.locator, score, scoreBreakdown: breakdown })) && (
                    <button
                      onClick={() => handleApply(ch.id, suggestion.locator)}
                      className="text-[10px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 rounded flex items-center gap-1"
                    >
                      <Check className="w-2.5 h-2.5" />
                      采纳 AI
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {/* 视点：可就地选择 */}
                <select
                  aria-label="视点人物"
                  value={current?.povCharacterId || ''}
                  onChange={e => handleFieldEdit(ch.id, current, { povCharacterId: e.target.value || undefined })}
                  className="bg-ink-900/60 text-blue-400 text-[10px] px-1 py-0.5 rounded border border-ink-700/50 max-w-[80px]"
                >
                  <option value="">视点 —</option>
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {/* 情绪起止：可就地输入 */}
                <input
                  aria-label="开场情绪"
                  value={current?.emotionStart || ''}
                  onChange={e => handleFieldEdit(ch.id, current, { emotionStart: e.target.value })}
                  placeholder="起"
                  className="bg-ink-900/60 text-amber-400 text-[10px] px-1 py-0.5 rounded border border-ink-700/50 w-14 placeholder:text-ink-600"
                />
                <input
                  aria-label="收尾情绪"
                  value={current?.emotionEnd || ''}
                  onChange={e => handleFieldEdit(ch.id, current, { emotionEnd: e.target.value })}
                  placeholder="止"
                  className="bg-ink-900/60 text-amber-400 text-[10px] px-1 py-0.5 rounded border border-ink-700/50 w-14 placeholder:text-ink-600"
                />
                {/* 信息释放：可就地选择 */}
                <select
                  aria-label="信息释放量"
                  value={current?.infoRelease || ''}
                  onChange={e => handleFieldEdit(ch.id, current, { infoRelease: (e.target.value || undefined) as SceneLocator['infoRelease'] })}
                  className="bg-ink-900/60 text-purple-400 text-[10px] px-1 py-0.5 rounded border border-ink-700/50"
                >
                  <option value="">释放 —</option>
                  <option value="reader-more">信息+</option>
                  <option value="reader-same">信息=</option>
                  <option value="reader-less">信息−</option>
                </select>
                <LocatorChip
                  label="伏笔"
                  value={String((current?.foreshadowLinks || suggestion?.locator.foreshadowLinks || []).length)}
                  color="text-emerald-400"
                />
              </div>

              {/* 评分维度细分条 */}
              {breakdown && (
                <div className="flex items-center gap-1.5 mt-1.5 text-[9px]">
                  <ScoreBar label="视点" value={breakdown.povClarity} />
                  <ScoreBar label="情绪" value={breakdown.emotionArc} />
                  <ScoreBar label="信息" value={breakdown.infoRhythm} />
                  <ScoreBar label="伏笔" value={breakdown.foreshadowDensity} />
                </div>
              )}

              {suggestion?.reason && !current && (
                <div className="text-[10px] text-ink-500 mt-1.5 italic">AI：{suggestion.reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** 评分维度细分条（0-25，按比例填充） */
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 25) * 100);
  const color = value >= 20 ? 'bg-emerald-400/60' : value >= 10 ? 'bg-amber-400/60' : 'bg-red-400/60';
  return (
    <div className="flex items-center gap-0.5 flex-1 min-w-0">
      <span className="text-ink-600">{label}</span>
      <div className="flex-1 h-1 bg-ink-900/60 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-ink-500 w-5 text-right">{value}</span>
    </div>
  );
}

function LocatorChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink-900/50">
      <span className="text-ink-600">{label}</span>
      <span className={color}>{value}</span>
    </span>
  );
}

export default SceneLocatorPanel;
