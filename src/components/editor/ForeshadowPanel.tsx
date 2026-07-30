import { useState, useMemo } from 'react';
import { Plus, Flag, AlertCircle, CheckCircle2, Clock, XCircle, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { FORESHADOW_STATUS_LABELS, FORESHADOW_STATUSES, DEFAULT_FORESHADOW_STATUS } from '@/types';
import type { Foreshadow } from '@/types';
import { FORESHADOW_STALE_THRESHOLD } from '@/constants/config';
import Empty from '@/components/Empty';

const STATUS_CONFIG: Record<Foreshadow['status'], { icon: typeof Flag; color: string; bgColor: string }> = {
  planted: { icon: Flag, color: 'text-amber-400', bgColor: 'bg-amber-400/10' },
  progressing: { icon: Clock, color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  'paid-off': { icon: CheckCircle2, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  abandoned: { icon: XCircle, color: 'text-ink-500', bgColor: 'bg-ink-700/50' },
};

export default function ForeshadowPanel() {
  const foreshadows = useAppStore(s => s.foreshadows);
  const addForeshadow = useAppStore(s => s.addForeshadow);
  const updateForeshadow = useAppStore(s => s.updateForeshadow);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<'all' | Foreshadow['status']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    addForeshadow({ title: newTitle.trim(), status: DEFAULT_FORESHADOW_STATUS });
    setNewTitle('');
    setShowAdd(false);
  };

  // H6 性能修复：useMemo 避免每次 render 重算 filter + 5 次 statusCounts filter（O(6F) per render）
  const { filteredForeshadows, statusCounts } = useMemo(() => {
    const filtered = filter === 'all'
      ? foreshadows
      : foreshadows.filter(f => f.status === filter);
    // 单次循环累加而非 5 次 filter
    const counts = { all: foreshadows.length, planted: 0, progressing: 0, 'paid-off': 0, abandoned: 0 };
    for (const f of foreshadows) {
      if (f.status in counts) (counts as Record<string, number>)[f.status]++;
    }
    return { filteredForeshadows: filtered, statusCounts: counts };
  }, [foreshadows, filter]);

  const cycleStatus = (id: string, current: Foreshadow['status']) => {
    const nextIndex = (FORESHADOW_STATUSES.indexOf(current) + 1) % FORESHADOW_STATUSES.length;
    updateForeshadow(id, { status: FORESHADOW_STATUSES[nextIndex] });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200">伏笔看板</span>
        <button
          onClick={() => setShowAdd(true)}
          aria-label="新建伏笔"
          className="p-1 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {showAdd && (
        <div className="p-3 border-b border-ink-800/50 bg-ink-800/30">
          <input
            aria-label="伏笔名称"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="伏笔名称..."
            className="input text-sm mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setNewTitle(''); }} className="flex-1 btn btn-secondary text-xs">
              取消
            </button>
            <button onClick={handleAdd} className="flex-1 btn btn-primary text-xs">
              添加
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex border-b border-ink-800/50 overflow-x-auto">
        {[
          { id: 'all', label: '全部' },
          { id: 'planted', label: '已埋' },
          { id: 'progressing', label: '推进' },
          { id: 'paid-off', label: '已收' },
          { id: 'abandoned', label: '废弃' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as typeof filter)}
            className={`flex-1 py-2 text-xs whitespace-nowrap transition-colors relative ${
              filter === tab.id
                ? 'text-amber-400'
                : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            {tab.label}
            <span className={`ml-1 ${
              filter === tab.id ? 'text-amber-400/70' : 'text-ink-600'
            }`}>
              {statusCounts[tab.id as keyof typeof statusCounts]}
            </span>
            {filter === tab.id && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-amber-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredForeshadows.length === 0 ? (
          <Empty
            icon={<Flag className="w-8 h-8 text-ink-600" />}
            title="暂无伏笔"
            className="p-6"
          />
        ) : (
          filteredForeshadows.map(f => {
            const config = STATUS_CONFIG[f.status];
            const isExpanded = expandedId === f.id;
            const chaptersSince = f.chaptersSinceMention;
            const isWarning = f.status === 'planted' && chaptersSince >= FORESHADOW_STALE_THRESHOLD;

            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-controls={`foreshadow-panel-${f.id}`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : f.id); } }}
                className={`card p-2.5 cursor-pointer transition-all ${
                  isWarning ? 'border-amber-500/30' : ''
                }`}
                onClick={() => setExpandedId(isExpanded ? null : f.id)}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); cycleStatus(f.id, f.status); }}
                    className={`w-6 h-6 rounded flex-shrink-0 flex items-center justify-center ${config.bgColor}`}
                    title={`点击切换状态：${FORESHADOW_STATUS_LABELS[f.status]}`}
                    aria-label={`切换伏笔状态，当前${FORESHADOW_STATUS_LABELS[f.status]}`}
                  >
                    <config.icon className={`w-3.5 h-3.5 ${config.color}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-200 truncate">{f.title}</span>
                      {isWarning && (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      )}
                    </div>
                    <div className="text-[10px] text-ink-500 mt-0.5">
                      {FORESHADOW_STATUS_LABELS[f.status]}
                      {chaptersSince > 0 && ` · ${chaptersSince}章未提`}
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-ink-500 flex-shrink-0 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`} />
                </div>

                {isExpanded && (
                  <div id={`foreshadow-panel-${f.id}`} role="region" aria-label={`${f.title}详情`}>
                    {f.description && (
                      <div className="mt-2 pt-2 border-t border-ink-700/50 text-xs text-ink-400 leading-relaxed animate-slide-down">
                        {f.description}
                      </div>
                    )}

                    {f.notes && (
                      <div className="mt-2 p-2 bg-ink-800/50 rounded text-[11px] text-ink-400">
                        <span className="text-ink-500">备注：</span>{f.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
