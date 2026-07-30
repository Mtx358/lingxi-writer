/**
 * 版本花园面板（规格书第五阶段-4：多分支并行试错）
 *
 * 三块功能区：
 * 1. 分叉入口：选一个快照作为分叉点 → 输入分支名 → 创建独立分支
 * 2. 分支列表：每条分支显示来源/状态/章节数，提供「对比主干」「合并回主干」「归档」「删除」
 * 3. 对比报告：双栏章节差异 + 关键指标变化（章节数/结构改动/预估字数）
 *
 * 与 VersionDiffPanel 的区别：VersionDiffPanel 对比两个静态快照；
 * 本面板面向"多分支并行发展"，分支是可独立编辑、可合并回主干的活体。
 */
import { useState } from 'react';
import { GitBranch, Plus, GitMerge, GitCompare, Archive, Trash2, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { OutlineBranch, BranchDiffReport, BranchMetricDelta } from '@/types';
import { Section, EmptyHint } from './shared';
import { toast } from '@/hooks/useToast';

const STATUS_META: Record<OutlineBranch['status'], { label: string; cls: string }> = {
  active: { label: '活跃', cls: 'text-emerald-400 bg-emerald-400/10' },
  merged: { label: '已合并', cls: 'text-cyan-400 bg-cyan-400/10' },
  archived: { label: '已归档', cls: 'text-ink-500 bg-ink-700/40' },
};

export function BranchGardenPanel() {
  const branches = useAppStore(s => s.branches);
  const snapshots = useAppStore(s => s.outlineSnapshots);
  const createBranch = useAppStore(s => s.createBranch);
  const deleteBranch = useAppStore(s => s.deleteBranch);
  const archiveBranch = useAppStore(s => s.archiveBranch);
  const mergeBranchToMain = useAppStore(s => s.mergeBranchToMain);
  const compareBranchWithMain = useAppStore(s => s.compareBranchWithMain);

  const [showCreate, setShowCreate] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [branchName, setBranchName] = useState('');
  const [diffReport, setDiffReport] = useState<BranchDiffReport | null>(null);
  const [activeDiffId, setActiveDiffId] = useState<string | null>(null);

  const handleCreate = () => {
    if (!sourceId) {
      toast.error('请选择分叉来源', '从哪个快照分叉出独立分支？');
      return;
    }
    const branch = createBranch(sourceId, branchName);
    if (branch) {
      setShowCreate(false);
      setSourceId('');
      setBranchName('');
    }
  };

  const handleCompare = (branchId: string) => {
    // compareBranchWithMain 是同步纯计算，无需 loading 态
    const report = compareBranchWithMain(branchId);
    if (!report) {
      toast.error('对比失败', '找不到该分支');
      return;
    }
    setDiffReport(report);
    setActiveDiffId(branchId);
  };

  const handleMerge = (branch: OutlineBranch) => {
    if (!confirm(`确认把分支「${branch.name}」的结构合并回主干？\n\n仅合并章节结构（标题/顺序/层级），不覆盖正文。合并后该分支状态变为"已合并"，不可再次合并。`)) return;
    mergeBranchToMain(branch.id);
    setDiffReport(null);
  };

  return (
    <Section
      icon={GitBranch}
      title="版本花园"
      desc="从快照分叉独立分支 · 并行试错 · 满意合并回主干"
      action={
        <button
          onClick={() => setShowCreate(v => !v)}
          disabled={snapshots.length === 0}
          title={snapshots.length === 0 ? '请先生成至少一个快照' : '从快照分叉新分支'}
          className="px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> 分叉新分支
        </button>
      }
    >
      {/* 分叉创建表单 */}
      {showCreate && (
        <div className="p-2 bg-ink-800/40 rounded-lg space-y-2">
          <div className="text-[11px] text-ink-400">选择分叉来源（快照）</div>
          <select
            value={sourceId}
            onChange={e => setSourceId(e.target.value)}
            className="input text-xs w-full"
          >
            <option value="">— 选择快照 —</option>
            {snapshots.map(s => (
              <option key={s.id} value={s.id}>{s.label}（{new Date(s.createdAt).toLocaleString('zh-CN')}）</option>
            ))}
          </select>
          <input
            value={branchName}
            onChange={e => setBranchName(e.target.value)}
            placeholder="分支名（如：反派洗白线、悲剧结局线）"
            className="input text-xs w-full"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowCreate(false)} className="px-2 py-1 text-[11px] text-ink-500 hover:text-ink-300 rounded">取消</button>
            <button onClick={handleCreate} className="px-2 py-1 text-[11px] bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 rounded">创建分支</button>
          </div>
        </div>
      )}

      {/* 分支列表 */}
      {branches.length === 0 ? (
        <EmptyHint
          icon={GitBranch}
          hint="还没有分支"
          subHint="先生成一份快照，再从快照分叉出独立分支，可并行探索多种走向"
        />
      ) : (
        <div className="space-y-1.5">
          {branches.map(b => {
            const meta = STATUS_META[b.status];
            return (
              <div key={b.id} className="p-2 bg-ink-800/30 rounded-lg border border-ink-700/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <GitBranch className="w-3 h-3 text-amber-400 flex-shrink-0" />
                  <span className="text-xs text-ink-100 font-medium">{b.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[10px] text-ink-500">{b.chapters.length} 章</span>
                  <span className="text-[10px] text-ink-600">· {new Date(b.updatedAt).toLocaleDateString('zh-CN')}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => handleCompare(b.id)}
                      title="对比分支与主干差异"
                      className={`p-1 rounded ${
                        activeDiffId === b.id
                          ? 'bg-cyan-400/20 text-cyan-300'
                          : 'text-cyan-400 hover:bg-cyan-400/10'
                      }`}
                    >
                      <GitCompare className="w-3 h-3" />
                    </button>
                    {b.status === 'active' && (
                      <>
                        <button
                          onClick={() => handleMerge(b)}
                          title="合并回主干"
                          className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded"
                        >
                          <GitMerge className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => archiveBranch(b.id)}
                          title="归档（停用但保留）"
                          className="p-1 text-ink-500 hover:text-ink-300 rounded"
                        >
                          <Archive className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`删除分支「${b.name}」？此操作不可撤销。`)) {
                          deleteBranch(b.id);
                          if (diffReport?.branchId === b.id) setDiffReport(null);
                        }
                      }}
                      title="删除分支"
                      className="p-1 text-red-400/70 hover:text-red-400 hover:bg-red-400/10 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {b.notes && <div className="text-[11px] text-ink-400 mt-1">{b.notes}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* 对比报告：双栏展示 + 质量指标变化对比 */}
      {diffReport && (
        <div className="mt-2 p-2 bg-ink-800/40 rounded-lg space-y-2">
          <div className="text-xs text-ink-200 font-medium flex items-center gap-1.5">
            <GitCompare className="w-3.5 h-3.5 text-cyan-400" />
            分支对比
          </div>

          {/* 双栏章节结构对比：左主干 / 右分支 */}
          <DualColumnChapterDiff report={diffReport} />

          {/* 质量指标变化对比表 */}
          <div className="mt-2">
            <div className="text-[10px] text-ink-400 mb-1 px-1">质量指标变化对比</div>
            <div className="space-y-0.5">
              {diffReport.metrics.map(m => <MetricRow key={m.label} metric={m} />)}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

// ===== 双栏章节结构对比 =====
// 规格书阶段5-4：「分支对比：双栏展示 + 质量指标变化对比」
// 左栏 = 主干（baseLabel），右栏 = 分支（branchLabel）
// 中间用增/删/改标记串起同一章节 ID 的差异
function DualColumnChapterDiff({ report }: { report: BranchDiffReport }) {
  // 按章节标题聚合：同一行同时显示主干/分支两侧的标题
  type Row = { id: string; changeType: 'added' | 'removed' | 'modified' | 'same'; main: string; branch: string };
  const rows: Row[] = [];

  for (const d of report.diffs) {
    // d.field 是 main 或 branch 标题（已在 slice 中按存在性填充）
    // 用 oldValue/newValue 区分：modified 时 oldValue=mainTitle, newValue=branchTitle
    if (d.changeType === 'added') {
      rows.push({ id: d.field, changeType: 'added', main: '—', branch: d.newValue });
    } else if (d.changeType === 'removed') {
      rows.push({ id: d.field, changeType: 'removed', main: d.oldValue, branch: '—' });
    } else if (d.changeType === 'modified') {
      rows.push({ id: d.field, changeType: 'modified', main: d.oldValue, branch: d.newValue });
    }
  }

  return (
    <div>
      {/* 双栏表头 */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-1 mb-1 px-1">
        <div className="text-[10px] text-ink-400 font-medium">{report.baseLabel}</div>
        <div className="w-4" />
        <div className="text-[10px] text-amber-300 font-medium">{report.branchLabel}</div>
      </div>
      {/* 双栏内容 */}
      {rows.length === 0 ? (
        <div className="text-[11px] text-emerald-300 px-1 py-1">无章节结构差异，分支与主干一致</div>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {rows.map((row, i) => {
            const changeMeta = row.changeType === 'added'
              ? { tag: '增', cls: 'bg-emerald-500/10 text-emerald-300' }
              : row.changeType === 'removed'
              ? { tag: '删', cls: 'bg-red-500/10 text-red-300' }
              : { tag: '改', cls: 'bg-amber-500/10 text-amber-300' };
            return (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-1 items-center text-[11px] px-1 py-0.5 rounded hover:bg-ink-800/40">
                <div className={`truncate ${row.changeType === 'removed' ? 'text-red-300/80 line-through' : 'text-ink-200'}`} title={row.main}>
                  {row.main}
                </div>
                <div className={`px-1 rounded text-[9px] text-center ${changeMeta.cls}`} title={`${changeMeta.tag} 改动`}>
                  {changeMeta.tag}
                </div>
                <div className={`truncate ${row.changeType === 'added' ? 'text-emerald-300' : row.changeType === 'modified' ? 'text-amber-200' : 'text-ink-500'}`} title={row.branch}>
                  {row.branch}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricRow({ metric }: { metric: BranchMetricDelta }) {
  const dirColor = metric.direction === 'same'
    ? 'text-ink-500'
    : metric.positive ? 'text-emerald-400' : 'text-red-400';
  const arrow = metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : '→';
  // 质量指标（节奏均方差/伏笔回收率/章末钩子强度）特别标识，呼应文档示例表
  const isQualityMetric = metric.label === '节奏均方差' || metric.label === '伏笔回收率' || metric.label === '章末钩子强度';
  return (
    <div className={`flex items-center gap-2 text-[11px] px-1 py-0.5 rounded ${isQualityMetric ? 'bg-ink-800/60' : ''}`}>
      <span className="text-ink-400 w-20 flex-shrink-0 truncate" title={metric.label}>{metric.label}</span>
      <span className="text-ink-300 tabular-nums">{metric.baseValue}</span>
      <ArrowRight className="w-3 h-3 text-ink-600" />
      <span className={`tabular-nums ${dirColor}`}>{metric.branchValue} {arrow}</span>
      {isQualityMetric && (
        <span className={`ml-auto text-[9px] px-1 rounded ${dirColor} bg-ink-900/50`}>
          {metric.direction === 'same' ? '持平' : metric.positive ? '改善' : '下降'}
        </span>
      )}
    </div>
  );
}
