/**
 * 版本对比面板
 *
 * 对应规格书第五阶段"修改版本留痕"。
 *
 * 三块功能区：
 * 1. 顶部操作栏：保存当前为快照（点击展开 label 输入框，调用 saveOutlineSnapshot）
 * 2. 双栏对比区：选择旧/新快照 → 生成对比 → 双栏展示 VersionDiffReport
 *    （added/removed/modified 三种变更类型分别用绿/红/双色高亮）
 * 3. 快照管理区：列出所有快照，提供恢复（带确认）/删除按钮
 *
 * 与 VersionGardenPanel 的区别：VersionGardenPanel 仅做快照列表 + 恢复/删除，
 * 本面板额外提供双版本对比能力（compareSnapshots），用于在改动前后做差异留痕。
 */
import { useState } from 'react';
import { Camera, GitCompare, RotateCcw, Trash2, ChevronDown, Plus, History } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { OutlineSnapshot, VersionDiffReport, VersionDiffEntry } from '@/types';
import { Section } from './shared';
import Empty from '@/components/Empty';

const CHANGE_TYPE_LABELS: Record<VersionDiffEntry['changeType'], string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
};

export function VersionDiffPanel() {
  const snapshots = useAppStore(s => s.outlineSnapshots);
  const chapters = useAppStore(s => s.chapters);
  const saveOutlineSnapshot = useAppStore(s => s.saveOutlineSnapshot);
  const deleteOutlineSnapshot = useAppStore(s => s.deleteOutlineSnapshot);
  const restoreOutlineSnapshot = useAppStore(s => s.restoreOutlineSnapshot);
  const compareSnapshots = useAppStore(s => s.compareSnapshots);

  // 保存快照：点击按钮后展开输入框，提交后清空并收起
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // 双栏对比：旧/新快照 ID + 当前对比报告
  const [oldId, setOldId] = useState('');
  const [newId, setNewId] = useState('');
  const [diffReport, setDiffReport] = useState<VersionDiffReport | null>(null);

  const handleSave = () => {
    if (!saveLabel.trim()) return;
    setSaving(true);
    try {
      saveOutlineSnapshot(saveLabel.trim());
      setSaveLabel('');
      setShowSaveInput(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCompare = () => {
    if (!oldId || !newId || oldId === newId) return;
    const report = compareSnapshots(oldId, newId);
    setDiffReport(report);
  };

  const handleRestore = (snapshotId: string) => {
    if (!window.confirm('恢复将覆盖当前大纲结构（不影响正文），是否继续？')) return;
    restoreOutlineSnapshot(snapshotId);
  };

  const handleDelete = (snapshotId: string) => {
    if (!window.confirm('删除该快照后无法找回，是否继续？')) return;
    deleteOutlineSnapshot(snapshotId);
    // 若删除的快照正参与对比，清空对比结果避免悬空引用
    if (oldId === snapshotId || newId === snapshotId) {
      setOldId('');
      setNewId('');
      setDiffReport(null);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="space-y-4">
      {/* ===== 1. 顶部操作栏：保存当前为快照 ===== */}
      <Section
        icon={Camera}
        title="保存当前为快照"
        desc="将当前大纲结构保存为可回退的版本节点"
      >
        <div className="space-y-2">
          {!showSaveInput ? (
            <button
              onClick={() => setShowSaveInput(true)}
              disabled={chapters.length === 0}
              className="w-full px-3 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              保存当前为快照
            </button>
          ) : (
            <div className="flex gap-1">
              <input
                aria-label="快照标签"
                value={saveLabel}
                onChange={e => setSaveLabel(e.target.value)}
                placeholder="快照标签，如：第一轮打磨后"
                autoFocus
                className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50 placeholder-ink-600"
              />
              <button
                onClick={handleSave}
                disabled={saving || !saveLabel.trim()}
                className="px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded disabled:opacity-50 flex items-center gap-1"
              >
                <Camera className="w-3 h-3" />
                保存
              </button>
              <button
                onClick={() => {
                  setShowSaveInput(false);
                  setSaveLabel('');
                }}
                className="px-2 py-1 text-[11px] text-ink-500 hover:text-ink-300"
              >
                取消
              </button>
            </div>
          )}
          {chapters.length === 0 && (
            <p className="text-[10px] text-ink-500">当前项目暂无大纲节点，无法保存快照</p>
          )}
        </div>
      </Section>

      {/* ===== 2. 双栏对比区 ===== */}
      <Section
        icon={GitCompare}
        title="双栏对比"
        desc="选择两个快照生成差异报告"
      >
        {snapshots.length < 2 ? (
          <p className="text-[11px] text-ink-500 leading-relaxed">
            至少需要 2 个快照才能生成对比。当前快照数：{snapshots.length}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <SnapshotSelect
                value={oldId}
                onChange={setOldId}
                snapshots={snapshots}
                placeholder="选择旧版本"
                tone="old"
              />
              <SnapshotSelect
                value={newId}
                onChange={setNewId}
                snapshots={snapshots}
                placeholder="选择新版本"
                tone="new"
              />
            </div>
            <button
              onClick={handleCompare}
              disabled={!oldId || !newId || oldId === newId}
              className="w-full px-3 py-1.5 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GitCompare className="w-3 h-3" />
              生成对比
            </button>
            {oldId && newId && oldId === newId && (
              <p className="text-[10px] text-amber-300">请选择两个不同的快照</p>
            )}
          </div>
        )}

        {diffReport && <DiffView report={diffReport} snapshots={snapshots} formatTime={formatTime} />}
      </Section>

      {/* ===== 3. 快照管理区 ===== */}
      <Section
        icon={History}
        title="快照管理"
        desc={`${snapshots.length} 个快照`}
      >
        {snapshots.length === 0 ? (
          <Empty
            icon={<Camera className="w-8 h-8 text-ink-400" aria-hidden="true" />}
            title="暂无快照"
            description="保存第一个快照后，即可对比不同版本的大纲结构，改崩了一键回退。"
            className="py-6 h-auto justify-start"
          />
        ) : (
          <div className="space-y-1.5">
            {snapshots.map(snap => (
              <SnapshotRow
                key={snap.id}
                snapshot={snap}
                formatTime={formatTime}
                onRestore={() => handleRestore(snap.id)}
                onDelete={() => handleDelete(snap.id)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** 快照下拉选择器：tone 控制标签配色（旧=红 / 新=绿） */
function SnapshotSelect({
  value,
  onChange,
  snapshots,
  placeholder,
  tone,
}: {
  value: string;
  onChange: (v: string) => void;
  snapshots: OutlineSnapshot[];
  placeholder: string;
  tone: 'old' | 'new';
}) {
  const labelColor = tone === 'old' ? 'text-red-300' : 'text-emerald-300';
  return (
    <div>
      <div className={`text-[10px] ${labelColor} mb-0.5`}>
        {tone === 'old' ? '旧版本' : '新版本'}
      </div>
      <div className="relative">
        <select
          aria-label="选择快照"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 pr-6 rounded border border-ink-700/50"
        >
          <option value="">{placeholder}</option>
          {snapshots.map(snap => (
            <option key={snap.id} value={snap.id}>
              {snap.label} · {snap.chapters.length} 节点
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-ink-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
      </div>
    </div>
  );
}

/** 对比结果视图：双栏布局，按 changeType 分别高亮 */
function DiffView({
  report,
  snapshots,
  formatTime,
}: {
  report: VersionDiffReport;
  snapshots: OutlineSnapshot[];
  formatTime: (iso: string) => string;
}) {
  const oldSnap = snapshots.find(s => s.id === report.oldSnapshotId);
  const newSnap = snapshots.find(s => s.id === report.newSnapshotId);

  return (
    <div className="mt-3 p-2.5 bg-ink-800/30 rounded-lg border border-ink-700/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-ink-400">
          共 {report.diffs.length} 项差异
        </div>
        <div className="text-[10px] text-ink-500">
          生成于 {formatTime(report.generatedAt)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] font-medium">
        <div className="text-red-300 truncate">
          旧版：{oldSnap?.label ?? '已删除'}
        </div>
        <div className="text-emerald-300 truncate">
          新版：{newSnap?.label ?? '已删除'}
        </div>
      </div>

      {report.diffs.length === 0 ? (
        <div className="text-[11px] text-ink-500 text-center py-3">
          两个快照结构完全一致，无差异
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {report.diffs.map((diff, i) => (
            <DiffRow key={`${diff.field}-${i}`} diff={diff} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单条差异行：双栏展示 oldValue / newValue，按 changeType 高亮 */
function DiffRow({ diff }: { diff: VersionDiffEntry }) {
  const { field, oldValue, newValue, changeType } = diff;

  return (
    <div className="border border-ink-700/40 rounded overflow-hidden">
      {/* 字段名 + 变更类型徽章 */}
      <div className="flex items-center justify-between px-2 py-1 bg-ink-800/60 border-b border-ink-700/40">
        <span className="text-[11px] text-ink-200 truncate">{field}</span>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded ${CHANGE_TYPE_BADGE[changeType]}`}
        >
          {CHANGE_TYPE_LABELS[changeType]}
        </span>
      </div>

      {/* 双栏：左=旧（红调）/ 右=新（绿调） */}
      <div className="grid grid-cols-2">
        <div className={`p-1.5 border-r border-ink-700/40 ${LEFT_CELL_STYLE[changeType]}`}>
          {changeType === 'added' ? (
            <span className="text-[10px] text-ink-600 italic">—</span>
          ) : (
            <span
              className={
                changeType === 'modified'
                  ? 'text-[10px] text-red-300 line-through'
                  : 'text-[10px] text-red-300'
              }
            >
              {oldValue || <span className="text-ink-600 italic">空</span>}
            </span>
          )}
        </div>
        <div className={`p-1.5 ${RIGHT_CELL_STYLE[changeType]}`}>
          {changeType === 'removed' ? (
            <span className="text-[10px] text-ink-600 italic">—</span>
          ) : (
            <span className="text-[10px] text-emerald-300">
              {newValue || <span className="text-ink-600 italic">空</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 变更类型 → 徽章配色 */
const CHANGE_TYPE_BADGE: Record<VersionDiffEntry['changeType'], string> = {
  added: 'bg-emerald-500/15 text-emerald-300',
  removed: 'bg-red-500/15 text-red-300',
  modified: 'bg-amber-500/15 text-amber-300',
};

/** 左栏单元格背景：removed 高亮红，其他淡底 */
const LEFT_CELL_STYLE: Record<VersionDiffEntry['changeType'], string> = {
  added: 'bg-ink-800/20',
  removed: 'bg-red-500/10',
  modified: 'bg-red-500/5',
};

/** 右栏单元格背景：added 高亮绿，其他淡底 */
const RIGHT_CELL_STYLE: Record<VersionDiffEntry['changeType'], string> = {
  added: 'bg-emerald-500/10',
  removed: 'bg-ink-800/20',
  modified: 'bg-emerald-500/5',
};

/** 快照行：label + 时间 + 节点数 + 恢复/删除按钮 */
function SnapshotRow({
  snapshot,
  formatTime,
  onRestore,
  onDelete,
}: {
  snapshot: OutlineSnapshot;
  formatTime: (iso: string) => string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="p-2 bg-ink-800/30 rounded border border-ink-700/40 flex items-center gap-1.5">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink-200 truncate">{snapshot.label}</div>
        <div className="text-[9px] text-ink-500">
          {formatTime(snapshot.createdAt)} · {snapshot.chapters.length} 个节点
        </div>
      </div>
      <button
        onClick={onRestore}
        title="恢复结构（不影响正文）"
        className="p-1 text-ink-400 hover:text-emerald-300"
        aria-label={`恢复快照 ${snapshot.label}`}
      >
        <RotateCcw className="w-3 h-3" aria-hidden="true" />
      </button>
      <button
        onClick={onDelete}
        title="删除快照"
        className="p-1 text-ink-400 hover:text-red-300"
        aria-label={`删除快照 ${snapshot.label}`}
      >
        <Trash2 className="w-3 h-3" aria-hidden="true" />
      </button>
    </div>
  );
}
