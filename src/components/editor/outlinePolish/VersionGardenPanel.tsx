/**
 * 版本花园 Tab
 *
 * 由原 OutlinePolishPanel.tsx 中 SnapshotsTab / SnapshotItem 两个内部组件
 * 原样搬迁而来。保存当前大纲结构快照（仅结构，不含正文），可随时回退到
 * 大纲的历史版本。底部保留伏笔速查（兼容旧版入口）。
 */
import { useState } from 'react';
import { Camera, Trash2, RotateCcw, ChevronRight, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Foreshadow, Chapter, OutlineSnapshot } from '@/types';
import { FORESHADOW_STATUS_LABELS } from '@/types';
import Empty from '@/components/Empty';

export function VersionGardenPanel({
  foreshadows,
  chapters,
}: {
  foreshadows: Foreshadow[];
  chapters: Chapter[];
}) {
  const snapshots = useAppStore(s => s.outlineSnapshots);
  const saveSnapshot = useAppStore(s => s.saveOutlineSnapshot);
  const deleteSnapshot = useAppStore(s => s.deleteOutlineSnapshot);
  const restoreSnapshot = useAppStore(s => s.restoreOutlineSnapshot);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    try {
      saveSnapshot(label);
      setLabel('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="p-3 bg-ink-800/30 rounded-lg">
        <div className="text-xs text-ink-300 font-medium mb-1 flex items-center gap-1">
          <Camera className="w-3.5 h-3.5 text-amber-400" />
          版本花园
        </div>
        <p className="text-[11px] text-ink-500 mb-2">
          保存当前大纲结构快照（仅结构，不含正文），可随时回退到大纲的历史版本
        </p>
        <div className="flex gap-1">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="快照标签，如：第一轮打磨后"
            className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50 placeholder-ink-600"
          />
          <button
            onClick={handleSave}
            disabled={saving || chapters.length === 0}
            className="px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded disabled:opacity-50 flex items-center gap-1"
          >
            <Camera className="w-3 h-3" />
            保存
          </button>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <Empty
          icon={<Camera className="w-8 h-8 text-ink-400" aria-hidden="true" />}
          title="暂无快照"
          description="保存后将在此处回溯"
          className="py-6 h-auto justify-start"
        />
      ) : (
        <div className="space-y-1.5">
          {snapshots.map(snap => (
            <SnapshotItem
              key={snap.id}
              snapshot={snap}
              onDelete={() => deleteSnapshot(snap.id)}
              onRestore={() => restoreSnapshot(snap.id)}
            />
          ))}
        </div>
      )}

      {/* 兼容旧版伏笔检查：保留一个简化入口 */}
      <details className="border-t border-ink-800/50 pt-3 mt-3">
        <summary className="text-xs text-ink-400 cursor-pointer hover:text-ink-200">伏笔速查（{foreshadows.length}）</summary>
        <div className="mt-2 space-y-1">
          {foreshadows.length === 0 && <div className="text-[11px] text-ink-500" role="status" aria-live="polite">暂无伏笔</div>}
          {foreshadows.map(f => (
            <div key={f.id} className="text-[10px] text-ink-400">
              <span className="text-amber-300">《{f.title}》</span>
              <span className="text-ink-500"> · {FORESHADOW_STATUS_LABELS[f.status]}</span>
              {f.chaptersSinceMention > 0 && <span className="text-ink-500"> · {f.chaptersSinceMention} 章未提及</span>}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function SnapshotItem({
  snapshot,
  onDelete,
  onRestore,
}: {
  snapshot: OutlineSnapshot;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(snapshot.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="p-2 bg-ink-800/30 rounded border border-ink-700/40">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-ink-500 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-ink-500 flex-shrink-0" />}
          <span className="text-xs text-ink-200 truncate flex-1">{snapshot.label}</span>
        </button>
        <span className="text-[9px] text-ink-500 flex-shrink-0">{time}</span>
        <button
          onClick={onRestore}
          title="恢复结构（不影响正文）"
          className="p-1 text-ink-400 hover:text-emerald-300"
          aria-label="恢复结构"
        >
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
        </button>
        <button
          onClick={onDelete}
          title="删除快照"
          className="p-1 text-ink-400 hover:text-red-300"
          aria-label="删除快照"
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
      <div className="text-[9px] text-ink-500 mt-0.5 ml-4">{snapshot.chapters.length} 个节点</div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-ink-700/50 space-y-0.5 max-h-40 overflow-y-auto">
          {snapshot.chapters.slice(0, 30).map(c => (
            <div key={c.id} className="text-[10px] text-ink-400 truncate">
              <span className="text-ink-500">[{c.levelType}]</span> {c.title}
            </div>
          ))}
          {snapshot.chapters.length > 30 && (
            <div className="text-[9px] text-ink-600">+{snapshot.chapters.length - 30} 个...</div>
          )}
        </div>
      )}
    </div>
  );
}
