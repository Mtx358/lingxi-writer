/**
 * AI 率检测面板
 *
 * 显示当前章节或全书的 AI 痕迹检测结果：
 * - AI 率总分（0-100，越低越好）
 * - 真人质感分（0-100，越高越好）
 * - 困惑度 / 突发度（近似指标）
 * - 句长分布统计
 * - 各发布平台标准对照（通过/未通过）
 * - 各维度问题清单（含定位与修改建议）
 * - 一键"降 AI 改写"按钮（基于 deAIRewriter 定向修复）
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Shield, ShieldCheck, ShieldAlert, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { detectAITrace, generateDeAISuggestions, STRICTEST_THRESHOLD, type AITraceReport, type AITraceIssue } from '@/utils/aiTraceDetector';
import { deAIByReport } from '@/utils/deAIRewriter';
import { toast } from '@/hooks/useToast';
import Empty from '@/components/Empty';

interface AITracePanelProps {
  /** 检测范围：当前章节或全书 */
  scope: 'chapter' | 'book';
}

const SEVERITY_CONFIG = {
  high: { color: 'text-red-400 bg-red-500/10 border-red-500/30', label: '高' },
  medium: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', label: '中' },
  low: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', label: '低' },
};

export default function AITracePanel({ scope }: AITracePanelProps) {
  const chapters = useAppStore(s => s.chapters);
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const updateChapterContent = useAppStore(s => s.updateChapterContent);

  const [report, setReport] = useState<AITraceReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [deAIInProgress, setDeAIInProgress] = useState(false);
  // 标记 report 对应的文本指纹，用于检测 targetText 变化后 report 是否过期
  const [reportTextHash, setReportTextHash] = useState('');

  // 组件挂载状态 ref，防止卸载后 setTimeout 回调调用 setState
  const isMountedRef = useRef(true);
  // 跟踪 runDetection / handleDeAI 的延迟定时器，卸载时清理避免泄漏
  const runDetectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deAiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (runDetectionTimerRef.current) {
        clearTimeout(runDetectionTimerRef.current);
        runDetectionTimerRef.current = null;
      }
      if (deAiTimerRef.current) {
        clearTimeout(deAiTimerRef.current);
        deAiTimerRef.current = null;
      }
    };
  }, []);

  // 获取待检测文本
  const targetText = useMemo(() => {
    if (scope === 'chapter') {
      const ch = chapters.find(c => c.id === currentChapterId);
      return ch?.content || '';
    }
    // 全书：拼接所有正文章节
    return chapters
      .filter(c => c.levelType === 'chapter' || c.levelType === 'part')
      .map(c => c.content || '')
      .join('\n\n');
  }, [chapters, currentChapterId, scope]);

  // 简单文本指纹：targetText 变化时让 report 失效，避免显示过时数据
  const targetHash = useMemo(() => {
    return `${targetText.length}:${targetText.slice(0, 50)}:${targetText.slice(-50)}`;
  }, [targetText]);

  const isReportStale = report !== null && reportTextHash !== targetHash;

  const runDetection = useCallback(() => {
    if (!targetText.trim()) {
      setReport(null);
      setReportTextHash('');
      return;
    }
    setAnalyzing(true);
    // 用微任务延迟，让 UI 先渲染 loading 态
    if (runDetectionTimerRef.current) clearTimeout(runDetectionTimerRef.current);
    runDetectionTimerRef.current = setTimeout(() => {
      runDetectionTimerRef.current = null;
      if (!isMountedRef.current) return;
      // try/finally 确保 detectAITrace 抛错时 analyzing 状态被重置，
      // 否则按钮永久卡在"检测中..."，用户无法重试
      try {
        const r = detectAITrace(targetText);
        setReport(r);
        setReportTextHash(targetHash);
      } catch (e) {
        console.error('detectAITrace failed:', e);
        // 检测失败时提示用户，否则按钮恢复但无结果，用户不知发生了什么
        toast.error('AI 率检测失败', e instanceof Error ? e.message : '请重试');
        setReport(null);
        setReportTextHash('');
      } finally {
        if (isMountedRef.current) setAnalyzing(false);
      }
    }, 50);
  }, [targetText, targetHash]);

  // 一键降 AI 改写（仅当前章节）
  const handleDeAI = useCallback(() => {
    if (!report || scope !== 'chapter' || !currentChapterId) return;
    setDeAIInProgress(true);
    if (deAiTimerRef.current) clearTimeout(deAiTimerRef.current);
    deAiTimerRef.current = setTimeout(() => {
      deAiTimerRef.current = null;
      if (!isMountedRef.current) return;
      // try/finally 确保 deAIByReport/detectAITrace 抛错时 deAIInProgress 被重置，
      // 否则按钮永久卡在"降 AI 改写中..."
      try {
        const rewritten = deAIByReport(targetText, report);
        updateChapterContent(currentChapterId, rewritten);
        // 重新检测
        const newReport = detectAITrace(rewritten);
        setReport(newReport);
        setReportTextHash(`${rewritten.length}:${rewritten.slice(0, 50)}:${rewritten.slice(-50)}`);
      } catch (e) {
        console.error('deAIByReport failed:', e);
        toast.error('降 AI 改写失败', e instanceof Error ? e.message : '请重试');
      } finally {
        if (isMountedRef.current) setDeAIInProgress(false);
      }
    }, 50);
  }, [report, scope, currentChapterId, targetText, updateChapterContent]);

  // AI 率颜色
  const aiRateColor = report
    ? report.aiRate <= STRICTEST_THRESHOLD
      ? 'text-emerald-400'
      : report.aiRate <= 30
        ? 'text-amber-400'
        : 'text-red-400'
    : 'text-ink-400';

  const aiRateBg = report
    ? report.aiRate <= STRICTEST_THRESHOLD
      ? 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30'
      : report.aiRate <= 30
        ? 'from-amber-500/20 to-amber-500/5 border-amber-500/30'
        : 'from-red-500/20 to-red-500/5 border-red-500/30'
    : 'from-ink-700/20 to-ink-700/5 border-ink-700/30';

  return (
    <div className="space-y-4">
      {/* 标题与操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className={`w-5 h-5 ${report ? (report.aiRate <= STRICTEST_THRESHOLD ? 'text-emerald-400' : 'text-amber-400') : 'text-ink-400'}`} />
          <h3 className="text-sm font-semibold text-ink-100">
            AI 率检测{scope === 'chapter' ? '（当前章节）' : '（全书）'}
          </h3>
        </div>
        <button
          onClick={runDetection}
          disabled={analyzing || !targetText.trim()}
          className="btn btn-secondary text-xs py-1 px-2.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
          {analyzing ? '检测中...' : report ? '重新检测' : '开始检测'}
        </button>
      </div>

      {!targetText.trim() && (
        <Empty
          title={scope === 'chapter' ? '当前章节无内容' : '全书无正文内容'}
          className="card p-4 h-auto justify-start"
        />
      )}

      {targetText.trim() && !report && !analyzing && (
        <div className="card p-4 text-center text-sm text-ink-500">
          点击"开始检测"分析 AI 痕迹
        </div>
      )}

      {report && (
        <>
          {/* 内容已修改，检测结果过期提示 */}
          {isReportStale && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>内容已修改，检测结果可能过期</span>
              <button
                onClick={runDetection}
                disabled={analyzing}
                className="ml-auto text-amber-200 hover:text-amber-100 underline disabled:opacity-50 disabled:no-underline"
              >
                重新检测
              </button>
            </div>
          )}

          {/* AI 率总分卡 */}
          <div className={`p-4 rounded-xl bg-gradient-to-br ${aiRateBg} border`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${aiRateColor}`}>{report.aiRate.toFixed(1)}</span>
                  <span className="text-sm text-ink-400">% AI 痕迹</span>
                </div>
                <p className="text-xs text-ink-500 mt-0.5">
                  真人质感分 {report.humanScore.toFixed(0)} / 100
                </p>
              </div>
              <div className="text-right">
                {report.aiRate <= STRICTEST_THRESHOLD ? (
                  <div className="flex items-center gap-1 text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                    <span className="text-xs font-medium">通过最严格标准</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-amber-400">
                    <ShieldAlert className="w-5 h-5" />
                    <span className="text-xs font-medium">超出最严格标准</span>
                  </div>
                )}
                <p className="text-[10px] text-ink-600 mt-0.5">阈值 ≤ {STRICTEST_THRESHOLD}%</p>
              </div>
            </div>

            {/* 困惑度 / 突发度 指标条 */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="bg-black/20 rounded-lg p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-ink-500">困惑度</span>
                  <span className="text-xs font-medium text-ink-300">{report.perplexity.toFixed(0)}</span>
                </div>
                <div className="h-1 bg-ink-700/50 rounded-full mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${report.perplexity >= 40 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    style={{ width: `${report.perplexity}%` }}
                  />
                </div>
                <p className="text-[9px] text-ink-600 mt-0.5">{report.perplexity >= 40 ? '用词多样' : '用词重复'}</p>
              </div>
              <div className="bg-black/20 rounded-lg p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-ink-500">突发度</span>
                  <span className="text-xs font-medium text-ink-300">{report.burstiness.toFixed(0)}</span>
                </div>
                <div className="h-1 bg-ink-700/50 rounded-full mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${report.burstiness >= 30 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    style={{ width: `${report.burstiness}%` }}
                  />
                </div>
                <p className="text-[9px] text-ink-600 mt-0.5">{report.burstiness >= 30 ? '句长多变' : '句长均匀'}</p>
              </div>
            </div>

            {/* 句长分布 */}
            <div className="mt-3 bg-black/20 rounded-lg p-2">
              <div className="flex items-center justify-between text-[10px] text-ink-500 mb-1">
                <span>句长分布</span>
                <span>均值 {report.sentenceLengthStats.avg} 字 · 标准差 {report.sentenceLengthStats.stdDev}</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-ink-700/50">
                <div className="bg-blue-400" style={{ width: `${(report.sentenceLengthStats.short / (report.sentenceLengthStats.short + report.sentenceLengthStats.medium + report.sentenceLengthStats.long || 1)) * 100}%` }} />
                <div className="bg-emerald-400" style={{ width: `${(report.sentenceLengthStats.medium / (report.sentenceLengthStats.short + report.sentenceLengthStats.medium + report.sentenceLengthStats.long || 1)) * 100}%` }} />
                <div className="bg-amber-400" style={{ width: `${(report.sentenceLengthStats.long / (report.sentenceLengthStats.short + report.sentenceLengthStats.medium + report.sentenceLengthStats.long || 1)) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[9px] text-ink-600 mt-1">
                <span>短句 {report.sentenceLengthStats.short}</span>
                <span>中句 {report.sentenceLengthStats.medium}</span>
                <span>长句 {report.sentenceLengthStats.long}</span>
              </div>
            </div>
          </div>

          {/* 平台标准对照 */}
          <div>
            <h4 className="text-xs font-medium text-ink-300 mb-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              发布平台标准对照
            </h4>
            <div className="space-y-1">
              {report.verdicts.map(v => (
                <div
                  key={v.platform}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs ${
                    v.passed ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-red-500/5 border border-red-500/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {v.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-ink-200">{v.platform}</span>
                    <span className="text-ink-600">≤{v.threshold}%</span>
                  </div>
                  <span className={v.passed ? 'text-emerald-400' : 'text-red-400'}>
                    {v.passed ? `余量 ${Math.abs(v.margin).toFixed(1)}%` : `超 ${v.margin.toFixed(1)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 一键降 AI（仅当前章节，且 report 未过期） */}
          {scope === 'chapter' && report.aiRate > STRICTEST_THRESHOLD && (
            <button
              onClick={handleDeAI}
              disabled={deAIInProgress || isReportStale}
              title={isReportStale ? '内容已修改，请先重新检测' : undefined}
              className="btn btn-primary w-full text-xs"
            >
              {deAIInProgress ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  降 AI 改写中...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  一键降 AI 改写（定向修复 {report.dimensions.filter(d => d.issues.length > 0).length} 项问题）
                </>
              )}
            </button>
          )}

          {/* 各维度问题清单 */}
          <div>
            <h4 className="text-xs font-medium text-ink-300 mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              检测维度明细
            </h4>
            <div className="space-y-1">
              {report.dimensions
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((dim, dimIdx) => {
                  const hasIssues = dim.issues.length > 0;
                  const isExpanded = expandedDim === dim.name;
                  return (
                    <div
                      key={dim.name}
                      className={`rounded-lg border ${
                        dim.score > 50 ? 'border-red-500/20 bg-red-500/5'
                          : dim.score > 30 ? 'border-amber-500/20 bg-amber-500/5'
                          : 'border-ink-700/30 bg-ink-800/20'
                      }`}
                    >
                      <button
                        onClick={() => hasIssues && setExpandedDim(isExpanded ? null : dim.name)}
                        aria-expanded={hasIssues ? isExpanded : undefined}
                        aria-controls={hasIssues ? `aitrace-dim-panel-${dimIdx}` : undefined}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-left"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {hasIssues ? (
                            isExpanded ? <ChevronDown className="w-3 h-3 text-ink-500 flex-shrink-0" />
                                      : <ChevronRight className="w-3 h-3 text-ink-500 flex-shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                          )}
                          <span className="text-xs text-ink-200 truncate">{dim.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {hasIssues && (
                            <span className="text-[10px] text-ink-500">{dim.issues.length} 项</span>
                          )}
                          <span className={`text-xs font-medium ${
                            dim.score > 50 ? 'text-red-400'
                              : dim.score > 30 ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}>
                            {dim.score.toFixed(0)}
                          </span>
                        </div>
                      </button>
                      {isExpanded && hasIssues && (
                        <div id={`aitrace-dim-panel-${dimIdx}`} role="region" className="px-2.5 pb-2 space-y-1.5">
                          {dim.issues.map((issue: AITraceIssue, idx) => {
                            const sev = SEVERITY_CONFIG[issue.severity];
                            return (
                              <div key={idx} className="bg-black/20 rounded p-2 text-xs">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] border ${sev.color}`}>
                                    {sev.label}
                                  </span>
                                  <span className="text-ink-600 text-[10px]">{issue.snippet}</span>
                                </div>
                                <p className="text-ink-400 mb-1">{issue.description}</p>
                                <p className="text-emerald-400/80 text-[11px]">建议：{issue.suggestion}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* 降 AI 建议汇总 */}
          {report.aiRate > STRICTEST_THRESHOLD && (
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <h4 className="text-xs font-medium text-amber-300 mb-2 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                降 AI 优化建议
              </h4>
              <ul className="space-y-1">
                {generateDeAISuggestions(report).map((s, i) => (
                  <li key={i} className="text-xs text-ink-400 flex gap-1.5">
                    <span className="text-amber-400 flex-shrink-0">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
