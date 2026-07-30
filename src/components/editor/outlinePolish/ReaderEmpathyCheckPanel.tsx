/**
 * 读者共情校验面板（规格书第四阶段）
 *
 * 调用 runReaderEmpathyCheck 检测读者共情问题（动机断层 / 情感扁平 / 利益模糊 /
 * 视角漂移），以纯 CSS 柱状图呈现每章动机/情感/利益三维共情强度，并标注整体
 * 共情评分；问题卡片支持跳转章节。无图表库依赖。
 *
 * 数据来源：outlinePolishSlice.lastReaderEmpathyReport / runReaderEmpathyCheck。
 */
import { useState } from 'react';
import { Heart, RefreshCw, AlertCircle, AlertTriangle, Lightbulb, Info } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ReaderEmpathyIssue, ReaderEmpathyPoint } from '@/types';

const EMPATHY_ISSUE_TYPE_LABELS: Record<ReaderEmpathyIssue['type'], string> = {
  'motivation-gap': '动机断层',
  'emotion-flat': '情感扁平',
  'stakes-unclear': '利益模糊',
  'perspective-drift': '视角漂移',
  'suspense-forget': '悬念遗忘',
  'emotion-fatigue': '情感疲劳',
  'favorability-low': '好感走低',
  'drop-risk': '弃书风险',
};

const EMPATHY_ISSUE_TYPE_COLORS: Record<ReaderEmpathyIssue['type'], string> = {
  'motivation-gap': 'text-blue-300 bg-blue-400/10 border-blue-500/30',
  'emotion-flat': 'text-purple-300 bg-purple-400/10 border-purple-500/30',
  'stakes-unclear': 'text-amber-300 bg-amber-400/10 border-amber-500/30',
  'perspective-drift': 'text-cyan-300 bg-cyan-400/10 border-cyan-500/30',
  'suspense-forget': 'text-indigo-300 bg-indigo-400/10 border-indigo-500/30',
  'emotion-fatigue': 'text-orange-300 bg-orange-400/10 border-orange-500/30',
  'favorability-low': 'text-pink-300 bg-pink-400/10 border-pink-500/30',
  'drop-risk': 'text-red-300 bg-red-400/10 border-red-500/30',
};

/** 读者留存风险四项（规格书阶段4-6） */
const READER_RETENTION_TYPES: ReaderEmpathyIssue['type'][] = [
  'suspense-forget',
  'emotion-fatigue',
  'favorability-low',
  'drop-risk',
];

const CHART_HEIGHT = 120;

export function ReaderEmpathyCheckPanel() {
  const report = useAppStore(s => s.lastReaderEmpathyReport);
  const runReaderEmpathyCheck = useAppStore(s => s.runReaderEmpathyCheck);
  const chapters = useAppStore(s => s.chapters);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const [scope, setScope] = useState<'all' | string>('all');
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ReaderEmpathyIssue['type'] | null>(null);

  const mainChapters = chapters.filter(c => c.levelType === 'chapter');

  // 读者留存风险四项分组统计
  const retentionCounts = READER_RETENTION_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = (report?.issues ?? []).filter(i => i.type === t).length;
    return acc;
  }, {});
  const hasRetentionIssues = READER_RETENTION_TYPES.some(t => retentionCounts[t] > 0);
  const filteredIssues = report
    ? activeFilter
      ? report.issues.filter(i => i.type === activeFilter)
      : report.issues
    : [];

  const handleRun = async () => {
    setIsRunning(true);
    try {
      await runReaderEmpathyCheck(scope);
      setHasRun(true);
    } finally {
      setIsRunning(false);
    }
  };

  const showEmpty = !report && !hasRun;

  return (
    <div className="space-y-3">
      {/* 操作栏 */}
      <div className="p-2 bg-ink-800/30 rounded-lg flex items-center gap-2">
        <Heart className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
        <span className="text-xs text-ink-300">读者共情校验</span>
        <select
          aria-label="范围"
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
        >
          <option value="all">全量大纲</option>
          {mainChapters.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.title}</option>
          ))}
        </select>
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="ml-auto px-2 py-1 text-xs bg-rose-400/10 text-rose-300 hover:bg-rose-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {isRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />}
          {isRunning ? '校验中' : '运行共情校验'}
        </button>
      </div>

      {showEmpty ? (
        <div className="text-center py-8">
          <Heart className="w-10 h-10 text-ink-600 mx-auto mb-2" />
          <p className="text-sm text-ink-500">点击上方按钮运行读者共情校验</p>
          <p className="text-xs text-ink-600">逐章评估动机/情感/利益三维共情强度，发现读者难以代入的硬伤。</p>
        </div>
      ) : report ? (
        <>
          {/* 整体共情评分 + 三维曲线 */}
          <div className="p-3 bg-ink-800/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-ink-300 font-medium flex items-center gap-1.5">
                <Heart className="w-3 h-3 text-rose-400" />
                共情强度曲线
              </div>
              <EmpathyScoreBadge score={report.overallScore} />
            </div>
            <EmpathyChart points={report.points} />
            {/* 图例 */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-400 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-500/70 rounded-sm" />动机清晰度</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-purple-500/70 rounded-sm" />情感冲击力</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-500/70 rounded-sm" />利益清晰度</span>
            </div>
          </div>

          {/* 读者留存风险摘要区（四项分组 + 筛选） */}
          <div className="p-3 bg-ink-800/40 rounded-lg border border-ink-700/50">
            <div className="text-xs text-ink-300 font-medium mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              读者留存风险
            </div>
            {hasRetentionIssues ? (
              <div className="grid grid-cols-4 gap-1.5">
                {READER_RETENTION_TYPES.map(t => {
                  const count = retentionCounts[t] ?? 0;
                  const isActive = activeFilter === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setActiveFilter(isActive ? null : t)}
                      disabled={count === 0 && !isActive}
                      className={`px-1.5 py-1.5 rounded border text-[11px] transition-colors flex flex-col items-center gap-0.5 ${
                        isActive
                          ? `${EMPATHY_ISSUE_TYPE_COLORS[t]} ring-1 ring-white/20`
                          : count > 0
                            ? 'bg-ink-800/60 border-ink-700/50 text-ink-200 hover:bg-ink-700/40'
                            : 'bg-ink-800/30 border-ink-700/30 text-ink-500 cursor-not-allowed'
                      }`}
                    >
                      <span className="text-[10px]">{EMPATHY_ISSUE_TYPE_LABELS[t]}</span>
                      <span className="text-xs font-medium tabular-nums">{count} 处</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-emerald-300 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                未检测到读者留存风险
              </div>
            )}
          </div>

          {/* 问题清单 */}
          <div className="space-y-2">
            <div className="text-xs text-ink-300 font-medium flex items-center gap-1.5">
              <span>共情问题（{filteredIssues.length}{activeFilter ? `/${report.issues.length}` : ''}）</span>
              {activeFilter && (
                <span className="text-[10px] text-ink-400">
                  筛选：{EMPATHY_ISSUE_TYPE_LABELS[activeFilter]}
                </span>
              )}
            </div>
            {filteredIssues.length === 0 ? (
              <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                <Info className="w-4 h-4" />
                {activeFilter ? `未检测到${EMPATHY_ISSUE_TYPE_LABELS[activeFilter]}类型问题` : '未检测到共情问题'}
              </div>
            ) : (
              filteredIssues.map(issue => (
                <EmpathyIssueCard
                  key={issue.id}
                  issue={issue}
                  onJump={() => issue.chapterId && setCurrentChapter(issue.chapterId)}
                />
              ))
            )}
          </div>
        </>
      ) : hasRun ? (
        <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
          <Heart className="w-4 h-4" /> 未检测到共情问题
        </div>
      ) : null}
    </div>
  );
}

/** 整体共情评分徽章：按分数着色 */
function EmpathyScoreBadge({ score }: { score: number }) {
  const tone = score >= 70
    ? 'text-emerald-300 bg-emerald-400/10 border-emerald-500/30'
    : score >= 40
      ? 'text-amber-300 bg-amber-400/10 border-amber-500/30'
      : 'text-red-300 bg-red-400/10 border-red-500/30';
  const label = score >= 70 ? '共情良好' : score >= 40 ? '共情待加强' : '共情薄弱';
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded border ${tone} flex items-center gap-1`}>
      <span className="font-medium tabular-nums">{score}</span>
      <span>{label}</span>
    </span>
  );
}

/** 共情强度柱状图：每章并排三柱（动机/情感/利益） */
function EmpathyChart({ points }: { points: ReaderEmpathyPoint[] }) {
  if (points.length === 0) {
    return <div className="text-[11px] text-ink-500 text-center py-6">暂无章节数据</div>;
  }
  return (
    <div className="flex items-end gap-1" style={{ height: `${CHART_HEIGHT}px` }}>
      {points.map(p => (
        <div
          key={p.chapterId}
          className="flex-1 min-w-0 h-full flex items-end justify-center gap-px group relative"
          title={`${p.chapterTitle}：动机 ${p.motivation} / 情感 ${p.emotion} / 利益 ${p.stakes} / 综合 ${p.total}`}
          data-testid={`empathy-bar-${p.chapterId}`}
        >
          <EmpathyBar value={p.motivation} color="bg-blue-500/70" />
          <EmpathyBar value={p.emotion} color="bg-purple-500/70" />
          <EmpathyBar value={p.stakes} color="bg-amber-500/70" />
          {/* 章节标题（hover 显示） */}
          <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 text-ink-400 transition-opacity">
            {p.chapterTitle}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmpathyBar({ value, color }: { value: number; color: string }) {
  const h = (Math.min(Math.max(value, 0), 100) / 100) * CHART_HEIGHT;
  return (
    <div
      className={`w-1.5 ${color} rounded-t transition-all`}
      style={{ height: `${h}px` }}
    />
  );
}

function EmpathyIssueCard({ issue, onJump }: { issue: ReaderEmpathyIssue; onJump: () => void }) {
  const isDropRisk = issue.type === 'drop-risk';
  const sevIcon = (issue.severity === 'error' || isDropRisk)
    ? <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
    : <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />;
  const sevBorder = isDropRisk
    ? 'border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30'
    : issue.severity === 'error'
      ? 'border-red-500/30 bg-red-500/5'
      : 'border-amber-500/30 bg-amber-500/5';
  return (
    <div className={`p-3 rounded-lg border ${sevBorder}`}>
      <div className="flex items-start gap-2">
        {sevIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`px-1.5 py-px text-[9px] rounded border ${EMPATHY_ISSUE_TYPE_COLORS[issue.type]}`}>
              {EMPATHY_ISSUE_TYPE_LABELS[issue.type]}
            </span>
            <span className={`px-1 py-px text-[9px] rounded ${issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
              {issue.severity === 'error' ? '严重' : '警告'}
            </span>
            {issue.chapterTitle && (
              <button
                onClick={onJump}
                className="text-[10px] text-ink-300 hover:text-rose-300 underline truncate max-w-[140px]"
                title="跳转到该章节"
              >
                [{issue.chapterTitle}]
              </button>
            )}
          </div>
          <div className="text-xs text-ink-100 mb-1.5 leading-relaxed">{issue.description}</div>
          <div className="text-[11px] text-emerald-300 flex items-start gap-1 leading-relaxed">
            <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>{issue.suggestion}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
