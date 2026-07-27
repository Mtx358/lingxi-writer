/**
 * 诊断 Tab：智能诊断结果展示
 *
 * 由原 OutlinePolishPanel.tsx 中 DiagnosisTab / FilterChip / IssueCard 三个
 * 内部组件原样搬迁而来。支持维度 + 严重度筛选、单条采纳 / 撤销 / 忽略、
 * 批量采纳、按章节跳转。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Target, CheckCircle, AlertTriangle, Info, Lightbulb, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type {
  OutlinePolishReport,
  OutlinePolishDimension,
  OutlineIssueSeverity,
  OutlineIssue,
} from '@/types';
import { DIMENSION_LABELS, DIMENSION_COLORS, SEVERITY_COLOR } from './constants';

export function DiagnosticsPanel({
  report,
  onJumpTo,
}: {
  report: OutlinePolishReport | null;
  onJumpTo: (chapterId: string | null) => void;
}) {
  const ignoreIssue = useAppStore(s => s.ignoreOutlineIssue);
  const resolveIssue = useAppStore(s => s.resolveOutlineIssue);
  const batchResolve = useAppStore(s => s.batchResolveOutlineIssues);
  const [filterDim, setFilterDim] = useState<OutlinePolishDimension | 'all'>('all');
  const [filterSev, setFilterSev] = useState<OutlineIssueSeverity | 'all'>('all');

  if (!report) {
    return (
      <div className="text-center py-8">
        <Target className="w-10 h-10 text-ink-600 mx-auto mb-2" />
        <p className="text-sm text-ink-500">点击"全面分析"</p>
        <p className="text-xs text-ink-600">生成多维度诊断报告</p>
      </div>
    );
  }

  const visibleIssues = report.issues.filter(i => {
    if (filterDim !== 'all' && i.dimension !== filterDim) return false;
    if (filterSev !== 'all' && i.severity !== filterSev) return false;
    return true;
  });

  const unresolvedCount = report.issues.filter(i => !i.ignored && !i.resolved).length;
  const dimensionsPresent = Array.from(new Set(report.issues.map(i => i.dimension)));

  return (
    <div className="space-y-3">
      <div className="p-2 bg-ink-800/30 rounded-lg text-[11px] text-ink-400 flex items-center justify-between">
        <span>共 {report.issues.length} 项 · 未解决 <span className="text-amber-300">{unresolvedCount}</span></span>
        {unresolvedCount > 0 && (
          <button
            onClick={() => batchResolve()}
            className="px-2 py-0.5 text-[10px] bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-1"
          >
            <CheckCircle className="w-3 h-3" />
            全部采纳
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <FilterChip active={filterDim === 'all'} onClick={() => setFilterDim('all')}>全部维度</FilterChip>
        {dimensionsPresent.map(d => (
          <FilterChip key={d} active={filterDim === d} onClick={() => setFilterDim(d)}>
            {DIMENSION_LABELS[d]}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <FilterChip active={filterSev === 'all'} onClick={() => setFilterSev('all')}>全部级别</FilterChip>
        <FilterChip active={filterSev === 'error'} onClick={() => setFilterSev('error')} color="text-red-300">严重</FilterChip>
        <FilterChip active={filterSev === 'warning'} onClick={() => setFilterSev('warning')} color="text-amber-300">警告</FilterChip>
        <FilterChip active={filterSev === 'info'} onClick={() => setFilterSev('info')} color="text-blue-300">提示</FilterChip>
      </div>

      {visibleIssues.length === 0 ? (
        <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-ink-300">当前筛选下无诊断项</div>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleIssues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onIgnore={() => ignoreIssue(issue.id)}
              onResolve={() => resolveIssue(issue.id)}
              onJumpTo={() => issue.chapterId && onJumpTo(issue.chapterId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
        active
          ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40'
          : `bg-ink-800/40 ${color || 'text-ink-400'} border border-ink-700/40 hover:bg-ink-700/40`
      }`}
    >
      {children}
    </button>
  );
}

function IssueCard({
  issue,
  onIgnore,
  onResolve,
  onJumpTo,
}: {
  issue: OutlineIssue;
  onIgnore: () => void;
  onResolve: () => void;
  onJumpTo: () => void;
}) {
  const sevIcon = issue.severity === 'error'
    ? <AlertTriangle className="w-4 h-4 text-red-400" />
    : issue.severity === 'warning'
    ? <AlertTriangle className="w-4 h-4 text-amber-400" />
    : <Info className="w-4 h-4 text-blue-400" />;

  return (
    <div
      className={`p-3 rounded-lg border ${
        issue.ignored ? 'opacity-50 border-ink-700/30 bg-ink-800/20'
        : issue.resolved ? 'opacity-70 border-emerald-500/30 bg-emerald-500/5'
        : SEVERITY_COLOR[issue.severity]
      }`}
    >
      <div className="flex items-start gap-2">
        {sevIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`px-1.5 py-px text-[9px] rounded border ${DIMENSION_COLORS[issue.dimension]}`}>
              {DIMENSION_LABELS[issue.dimension]}
            </span>
            {issue.chapterTitle && (
              <button
                onClick={onJumpTo}
                className="text-[10px] text-ink-300 hover:text-amber-300 underline truncate max-w-[140px]"
                title="跳转到该章节"
              >
                [{issue.chapterTitle}]
              </button>
            )}
            {issue.resolved && (
              <span className="text-[9px] text-emerald-300 flex items-center gap-0.5">
                <CheckCircle className="w-2.5 h-2.5" /> 已采纳
              </span>
            )}
            {issue.ignored && (
              <span className="text-[9px] text-ink-500">已忽略</span>
            )}
          </div>
          <div className="text-xs text-ink-100 mb-1.5 leading-relaxed">{issue.description}</div>
          <div className="text-[11px] text-ink-400 flex items-start gap-1 leading-relaxed">
            <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5 text-amber-400" />
            <span>{issue.suggestion}</span>
          </div>
          {!issue.ignored && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={onResolve}
                className="text-[10px] px-2 py-0.5 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-1"
              >
                <CheckCircle className="w-2.5 h-2.5" />
                {issue.resolved ? '撤销采纳' : '采纳'}
              </button>
              <button
                onClick={onIgnore}
                className="text-[10px] px-2 py-0.5 bg-ink-700/40 text-ink-400 hover:bg-ink-700/60 rounded flex items-center gap-1"
              >
                <X className="w-2.5 h-2.5" />
                忽略
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
