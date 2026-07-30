/**
 * 诊断 Tab：《故事体检报告》三色分组视图
 *
 * 规格书阶段4：一键全身体检，按 🔴必修 → 🟡建议 → 🟢已通过 排序。
 * 每个问题项含位置/原因/修改建议/跳转按钮，支持批量采纳同类型问题。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Target, CheckCircle, AlertTriangle, Info, Lightbulb, X, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type {
  OutlinePolishReport,
  OutlinePolishDimension,
  OutlineIssue,
} from '@/types';
import { DIMENSION_LABELS, DIMENSION_COLORS, SEVERITY_COLOR } from './constants';

/** 全部诊断维度（用于计算"已通过"区） */
const ALL_DIMENSIONS: OutlinePolishDimension[] = ['theme', 'structure', 'character', 'logic', 'pacing', 'foreshadow', 'style'];

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
  const [collapsedMustFix, setCollapsedMustFix] = useState(false);
  const [collapsedSuggest, setCollapsedSuggest] = useState(false);
  const [collapsedPassed, setCollapsedPassed] = useState(false);
  const [collapsedResolved, setCollapsedResolved] = useState(false);

  if (!report) {
    return (
      <div className="text-center py-8">
        <Target className="w-10 h-10 text-ink-600 mx-auto mb-2" />
        <p className="text-sm text-ink-500">点击"全面分析"</p>
        <p className="text-xs text-ink-600">生成多维度诊断报告</p>
      </div>
    );
  }

  // 活跃问题：未忽略、未解决
  const activeIssues = report.issues.filter(i => !i.ignored && !i.resolved);
  // 已采纳问题：未忽略、已解决
  const resolvedIssues = report.issues.filter(i => !i.ignored && i.resolved);

  // 三色分组
  const mustFixIssues = activeIssues.filter(i => i.severity === 'error');
  const suggestIssues = activeIssues.filter(i => i.severity === 'warning' || i.severity === 'info');

  // 已通过维度：该维度下无任何活跃问题（error/warning/info 均无）
  const dimensionsWithIssues = new Set(activeIssues.map(i => i.dimension));
  const passedDimensions = ALL_DIMENSIONS.filter(d => !dimensionsWithIssues.has(d));

  // 维度筛选
  const dimFilter = (issues: OutlineIssue[]) =>
    filterDim === 'all' ? issues : issues.filter(i => i.dimension === filterDim);

  const filteredMustFix = dimFilter(mustFixIssues);
  const filteredSuggest = dimFilter(suggestIssues);
  const filteredResolved = dimFilter(resolvedIssues);
  const filteredPassed = filterDim === 'all' ? passedDimensions : (dimensionsWithIssues.has(filterDim) ? [] : [filterDim]);

  const dimensionsPresent = Array.from(new Set(report.issues.map(i => i.dimension)));

  return (
    <div className="space-y-3" role="region" aria-live="polite" aria-label="故事体检报告">
      {/* 报告头 */}
      <div className="p-3 bg-ink-800/30 border border-ink-700/50 rounded-lg">
        <div className="flex items-center gap-1.5 mb-2">
          <FileText className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-ink-100">故事体检报告</span>
          <span className="text-[10px] text-ink-500 ml-auto">
            {new Date(report.generatedAt).toLocaleString('zh-CN')} · 范围：{report.scope === 'all' ? '全量大纲' : '局部'}
          </span>
        </div>
        {/* 三色统计 */}
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-red-300 font-medium">{mustFixIssues.length}</span>
            <span className="text-ink-500">必修</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-amber-300 font-medium">{suggestIssues.length}</span>
            <span className="text-ink-500">建议</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-300 font-medium">{passedDimensions.length}</span>
            <span className="text-ink-500">已通过</span>
          </span>
          {resolvedIssues.length > 0 && (
            <span className="flex items-center gap-1 text-ink-500">
              · 已采纳 {resolvedIssues.length}
            </span>
          )}
          {mustFixIssues.length + suggestIssues.length > 0 && (
            <button
              onClick={() => batchResolve()}
              className="ml-auto px-2 py-0.5 text-[10px] bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-1"
            >
              <CheckCircle className="w-3 h-3" />
              全部采纳
            </button>
          )}
        </div>
      </div>

      {/* 维度筛选 */}
      <div className="flex flex-wrap gap-1">
        <FilterChip active={filterDim === 'all'} onClick={() => setFilterDim('all')}>全部维度</FilterChip>
        {dimensionsPresent.map(d => (
          <FilterChip key={d} active={filterDim === d} onClick={() => setFilterDim(d)}>
            {DIMENSION_LABELS[d]}
          </FilterChip>
        ))}
      </div>

      {/* 🔴 必须修 */}
      {filteredMustFix.length > 0 && (
        <ReportSection
          title="必须修"
          color="red"
          icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          count={filteredMustFix.length}
          collapsed={collapsedMustFix}
          onToggle={() => setCollapsedMustFix(c => !c)}
        >
          {filteredMustFix.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onIgnore={() => ignoreIssue(issue.id)}
              onResolve={() => resolveIssue(issue.id)}
              onJumpTo={() => issue.chapterId && onJumpTo(issue.chapterId)}
            />
          ))}
        </ReportSection>
      )}

      {/* 🟡 建议修 */}
      {filteredSuggest.length > 0 && (
        <ReportSection
          title="建议修"
          color="amber"
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          count={filteredSuggest.length}
          collapsed={collapsedSuggest}
          onToggle={() => setCollapsedSuggest(c => !c)}
        >
          {filteredSuggest.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onIgnore={() => ignoreIssue(issue.id)}
              onResolve={() => resolveIssue(issue.id)}
              onJumpTo={() => issue.chapterId && onJumpTo(issue.chapterId)}
            />
          ))}
        </ReportSection>
      )}

      {/* 🟢 已通过 */}
      {filteredPassed.length > 0 && (
        <ReportSection
          title="已通过"
          color="emerald"
          icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
          count={filteredPassed.length}
          collapsed={collapsedPassed}
          onToggle={() => setCollapsedPassed(c => !c)}
        >
          <div className="flex flex-wrap gap-1.5 p-1">
            {filteredPassed.map(d => (
              <span key={d} className={`px-2 py-1 text-[11px] rounded border ${DIMENSION_COLORS[d]} flex items-center gap-1`}>
                <CheckCircle className="w-3 h-3" />
                {DIMENSION_LABELS[d]}
              </span>
            ))}
          </div>
        </ReportSection>
      )}

      {/* 已采纳（折叠在最后） */}
      {filteredResolved.length > 0 && (
        <ReportSection
          title="已采纳"
          color="ink"
          icon={<CheckCircle className="w-4 h-4 text-ink-400" />}
          count={filteredResolved.length}
          collapsed={collapsedResolved}
          onToggle={() => setCollapsedResolved(c => !c)}
        >
          {filteredResolved.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onIgnore={() => ignoreIssue(issue.id)}
              onResolve={() => resolveIssue(issue.id)}
              onJumpTo={() => issue.chapterId && onJumpTo(issue.chapterId)}
            />
          ))}
        </ReportSection>
      )}

      {/* 全部通过时的鼓励态 */}
      {mustFixIssues.length === 0 && suggestIssues.length === 0 && (
        <div className="p-4 bg-emerald-400/5 border border-emerald-400/20 rounded-lg flex items-start gap-2">
          <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-emerald-300 font-medium">本轮体检全部通过</div>
            <div className="text-[11px] text-ink-400 mt-0.5">所有维度检查均无问题，可以放心继续创作。</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 报告分组区块（可折叠） */
function ReportSection({
  title,
  color,
  icon,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  color: 'red' | 'amber' | 'emerald' | 'ink';
  icon: ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const headerColor = {
    red: 'text-red-300 bg-red-500/5 border-red-500/20',
    amber: 'text-amber-300 bg-amber-500/5 border-amber-500/20',
    emerald: 'text-emerald-300 bg-emerald-500/5 border-emerald-500/20',
    ink: 'text-ink-400 bg-ink-800/30 border-ink-700/40',
  }[color];
  return (
    <div className={`rounded-lg border ${headerColor} overflow-hidden`}>
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? '展开' : '折叠'}${title}（${count} 项）`}
        className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-white/5 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
        {icon}
        <span className="text-xs font-medium">{title}</span>
        <span className="text-[10px] opacity-80">({count})</span>
      </button>
      {!collapsed && (
        <div className="px-2 pb-2 space-y-2">{children}</div>
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
