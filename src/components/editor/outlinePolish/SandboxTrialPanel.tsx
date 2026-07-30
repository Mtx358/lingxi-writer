/**
 * 沙盒试运行前后对比面板（规格书第五阶段：验证闭环）
 *
 * 闭环流程：发现问题 → 拿到方案 → 就地修改 → 验证闭环。
 *   1. 创作者先在"诊断"Tab 跑一次诊断，看到问题清单
 *   2. 回到本面板点击"开始试运行"，锁定修改前基线快照
 *   3. 去编辑器/其他 Tab 就地修改大纲
 *   4. 修改完成回到本面板点击"验证闭环"，重新诊断并对比前后状态
 *   5. 报告展示：已解决/新增/仍存问题 + 关键指标变化 + 验证结论
 *
 * 数据来源：outlinePolishSlice.sandboxBaseline / lastSandboxReport /
 *           captureSandboxBaseline / runSandboxVerification。
 */
import { useState } from 'react';
import {
  FlaskConical, RefreshCw, CheckCircle2, PlusCircle, AlertCircle,
  TrendingUp, TrendingDown, Minus, ArrowRight, Flag, X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type {
  SandboxTrialReport, SandboxTrialIssueDigest, SandboxTrialMetricDelta,
  OutlinePolishDimension, OutlineIssueSeverity,
} from '@/types';

const DIMENSION_LABELS: Record<OutlinePolishDimension, string> = {
  theme: '主题', structure: '结构', character: '人物',
  logic: '逻辑', pacing: '节奏', foreshadow: '伏笔', style: '文风',
};

const SEVERITY_LABELS: Record<OutlineIssueSeverity, string> = {
  error: '必修', warning: '建议', info: '提示',
};

export function SandboxTrialPanel() {
  const baseline = useAppStore(s => s.sandboxBaseline);
  const report = useAppStore(s => s.lastSandboxReport);
  const lastOutlineReport = useAppStore(s => s.lastOutlineReport);
  const captureSandboxBaseline = useAppStore(s => s.captureSandboxBaseline);
  const clearSandboxBaseline = useAppStore(s => s.clearSandboxBaseline);
  const restoreSandboxBaseline = useAppStore(s => s.restoreSandboxBaseline);
  const runSandboxVerification = useAppStore(s => s.runSandboxVerification);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const [isVerifying, setIsVerifying] = useState(false);

  const canCapture = !!lastOutlineReport;
  const hasBaseline = !!baseline;
  const hasReport = !!report;

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      await runSandboxVerification('all');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 操作栏 */}
      <div className="p-2 bg-ink-800/30 rounded-lg flex items-center gap-2 flex-wrap">
        <FlaskConical className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
        <span className="text-xs text-ink-300">沙盒试运行</span>
        {!hasBaseline ? (
          <button
            onClick={captureSandboxBaseline}
            disabled={!canCapture}
            title={canCapture ? '锁定当前诊断为修改前基线 + 大纲副本' : '请先在"诊断"Tab 跑一次诊断'}
            className="ml-auto px-2 py-1 text-xs bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <Flag className="w-3 h-3" /> 开始试运行
          </button>
        ) : (
          <>
            <span className="text-[10px] text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />基线已锁定（含大纲副本）
            </span>
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="ml-auto px-2 py-1 text-xs bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {isVerifying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {isVerifying ? '验证中' : '验证闭环'}
            </button>
            <button
              onClick={restoreSandboxBaseline}
              disabled={isVerifying}
              title="不满意修改？一键回退到基线状态（可 Ctrl+Z 撤销回退）"
              className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <ArrowRight className="w-3 h-3 rotate-180" />回退基线
            </button>
            <button
              onClick={clearSandboxBaseline}
              disabled={isVerifying}
              title="放弃本次试运行基线"
              className="px-2 py-1 text-xs text-ink-500 hover:text-ink-300 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <X className="w-3 h-3" />放弃
            </button>
          </>
        )}
      </div>

      {/* 无基线引导 */}
      {!hasBaseline && (
        <div className="text-center py-8">
          <FlaskConical className="w-10 h-10 text-ink-600 mx-auto mb-2" />
          <p className="text-sm text-ink-500">发现问题 → 拿到方案 → 就地修改 → 验证闭环</p>
          <p className="text-xs text-ink-600 mt-1">
            {canCapture
              ? '点击"开始试运行"锁定当前诊断为基线并保存大纲副本，修改大纲后再点"验证闭环"对比前后状态，不满意可一键回退。'
              : '请先到"诊断"Tab 运行一次全面诊断，再回来开始试运行。'}
          </p>
        </div>
      )}

      {/* 基线已锁定但无报告 */}
      {hasBaseline && !hasReport && (
        <div className="p-3 bg-cyan-500/5 border border-cyan-500/30 rounded-lg text-xs text-cyan-300 flex items-start gap-2">
          <Flag className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>
            <div>基线已锁定：{baseline!.totalIssues} 个问题（必修 {baseline!.errorCount}·建议 {baseline!.warningCount}），大纲副本已保存</div>
            <div className="text-[11px] text-ink-400 mt-1">现在去修改大纲（编辑章节/补伏笔/调结构…），完成后回来点"验证闭环"。不满意可点"回退基线"恢复到此刻状态。</div>
          </div>
        </div>
      )}

      {/* 对比报告 */}
      {hasReport && report && (
        <SandboxReportView report={report} onJump={id => setCurrentChapter(id)} />
      )}
    </div>
  );
}

function SandboxReportView({
  report,
  onJump,
}: {
  report: SandboxTrialReport;
  onJump: (chapterId: string) => void;
}) {
  const verdictMeta = VERDICT_META[report.verdict];
  return (
    <>
      {/* 验证结论 */}
      <div className={`p-3 rounded-lg border ${verdictMeta.border} ${verdictMeta.bg} flex items-center gap-2`}>
        <verdictMeta.Icon className={`w-5 h-5 ${verdictMeta.icon}`} />
        <div className="flex-1">
          <div className={`text-sm font-medium ${verdictMeta.text}`}>{verdictMeta.label}</div>
          <div className="text-[11px] text-ink-400">
            解决 {report.resolvedIssues.length} · 新增 {report.newIssues.length} · 仍存 {report.remainingIssues.length}
          </div>
        </div>
      </div>

      {/* 指标变化 */}
      <div className="p-3 bg-ink-800/30 rounded-lg space-y-1.5">
        <div className="text-xs text-ink-300 font-medium mb-1">指标变化</div>
        {report.metricDeltas.map(m => (
          <MetricDeltaRow key={m.label} delta={m} />
        ))}
      </div>

      {/* 已解决问题 */}
      {report.resolvedIssues.length > 0 && (
        <IssueGroup
          title="已解决"
          count={report.resolvedIssues.length}
          issues={report.resolvedIssues}
          onJump={onJump}
          tone="resolved"
        />
      )}

      {/* 新增问题 */}
      {report.newIssues.length > 0 && (
        <IssueGroup
          title="新增"
          count={report.newIssues.length}
          issues={report.newIssues}
          onJump={onJump}
          tone="new"
        />
      )}

      {/* 仍存问题 */}
      {report.remainingIssues.length > 0 && (
        <IssueGroup
          title="仍存在"
          count={report.remainingIssues.length}
          issues={report.remainingIssues}
          onJump={onJump}
          tone="remaining"
        />
      )}

      {/* 全部解决且无新增 */}
      {report.resolvedIssues.length > 0 && report.newIssues.length === 0 && report.remainingIssues.length === 0 && (
        <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> 所有问题已解决，未引入新问题，闭环完成
        </div>
      )}
    </>
  );
}

const VERDICT_META: Record<SandboxTrialReport['verdict'], {
  label: string; Icon: typeof TrendingUp; border: string; bg: string; text: string; icon: string;
}> = {
  improved: {
    label: '已改善 — 修改有效',
    Icon: TrendingUp, border: 'border-emerald-500/30', bg: 'bg-emerald-500/5',
    text: 'text-emerald-300', icon: 'text-emerald-400',
  },
  regressed: {
    label: '已退步 — 需复核修改',
    Icon: TrendingDown, border: 'border-red-500/30', bg: 'bg-red-500/5',
    text: 'text-red-300', icon: 'text-red-400',
  },
  neutral: {
    label: '无净变化 — 问题置换',
    Icon: Minus, border: 'border-amber-500/30', bg: 'bg-amber-500/5',
    text: 'text-amber-300', icon: 'text-amber-400',
  },
};

function MetricDeltaRow({ delta }: { delta: SandboxTrialMetricDelta }) {
  const dirIcon = delta.direction === 'up'
    ? <TrendingUp className="w-3 h-3" />
    : delta.direction === 'down'
      ? <TrendingDown className="w-3 h-3" />
      : <Minus className="w-3 h-3" />;
  const dirColor = delta.direction === 'same'
    ? 'text-ink-500'
    : delta.positive ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-ink-400 w-16 flex-shrink-0">{delta.label}</span>
      <span className="text-ink-300 tabular-nums w-12 text-right">{delta.before}</span>
      <ArrowRight className="w-3 h-3 text-ink-600 flex-shrink-0" />
      <span className={`tabular-nums w-12 ${delta.direction === 'same' ? 'text-ink-300' : 'text-ink-100 font-medium'}`}>{delta.after}</span>
      <span className={`flex items-center gap-0.5 ${dirColor}`}>{dirIcon}</span>
    </div>
  );
}

const TONE_META: Record<'resolved' | 'new' | 'remaining', {
  Icon: typeof CheckCircle2; color: string; badge: string; dot: string;
}> = {
  resolved: { Icon: CheckCircle2, color: 'text-emerald-300', badge: 'bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400' },
  new: { Icon: PlusCircle, color: 'text-red-300', badge: 'bg-red-400/10 text-red-300', dot: 'bg-red-400' },
  remaining: { Icon: AlertCircle, color: 'text-amber-300', badge: 'bg-amber-400/10 text-amber-300', dot: 'bg-amber-400' },
};

function IssueGroup({
  title, count, issues, onJump, tone,
}: {
  title: string;
  count: number;
  issues: SandboxTrialIssueDigest[];
  onJump: (chapterId: string) => void;
  tone: 'resolved' | 'new' | 'remaining';
}) {
  const meta = TONE_META[tone];
  return (
    <div className="space-y-2">
      <div className={`text-xs font-medium flex items-center gap-1.5 ${meta.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        {title}（{count}）
      </div>
      {issues.map(issue => (
        <DigestCard key={issue.id} issue={issue} onJump={onJump} tone={tone} />
      ))}
    </div>
  );
}

function DigestCard({
  issue, onJump, tone,
}: {
  issue: SandboxTrialIssueDigest;
  onJump: (chapterId: string) => void;
  tone: 'resolved' | 'new' | 'remaining';
}) {
  const meta = TONE_META[tone];
  return (
    <div className={`p-2.5 rounded-lg border ${tone === 'new' ? 'border-red-500/20 bg-red-500/5' : tone === 'resolved' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className={`px-1.5 py-px text-[9px] rounded ${meta.badge}`}>
          {DIMENSION_LABELS[issue.dimension]}
        </span>
        <span className="px-1 py-px text-[9px] rounded text-ink-400 bg-ink-700/40">
          {SEVERITY_LABELS[issue.severity]}
        </span>
        {issue.chapterTitle && (
          <button
            onClick={() => issue.chapterId && onJump(issue.chapterId)}
            className="text-[10px] text-ink-300 hover:text-cyan-300 underline truncate max-w-[140px]"
            title="跳转到该章节"
          >
            [{issue.chapterTitle}]
          </button>
        )}
      </div>
      <div className={`text-[11px] leading-relaxed ${tone === 'resolved' ? 'text-ink-400 line-through' : 'text-ink-100'}`}>
        {issue.description}
      </div>
    </div>
  );
}
