/**
 * 多线作战指挥台（规格书第三阶段）
 *
 * 管理多线叙事的时间轴对齐与交集预警：
 *   - 故事线管理（storylines）：主线 / 反派线 / 支线的增删
 *   - 时间轴对齐视图：每条故事线一行，章节列按 order 排序，格子点击增删节点
 *   - 交集点预警（intersectionTargets + checkIntersection）：多条线索在某章
 *     交汇，按"交集前 3 章"节点数判定 ok / warning / danger
 *
 * Store 依赖（multiLineSlice + chapterSlice）：
 *   storylines / intersectionTargets / chapters
 *   addStoryline / updateStoryline / deleteStoryline
 *   addTimelineNode / removeTimelineNode
 *   addIntersectionTarget / deleteIntersectionTarget / checkIntersection
 */
import { useMemo, useState } from 'react';
import {
  GitBranch, Plus, Trash2, Crosshair, AlertTriangle,
  CheckCircle, AlertCircle, Circle, Loader2, Search,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Storyline, StorylineType, IntersectionTarget, Chapter } from '@/types';
import { isPolishableChapter } from '@/utils/chapterUtils';

/** 故事线类型中文标签 */
const STORYLINE_TYPE_LABELS: Record<StorylineType, string> = {
  protagonist: '主角线',
  antagonist: '反派线',
  subplot: '支线',
};

/** 故事线类型配色（标签用） */
const STORYLINE_TYPE_COLORS: Record<StorylineType, string> = {
  protagonist: 'text-blue-300 bg-blue-400/10 border-blue-500/30',
  antagonist: 'text-red-300 bg-red-400/10 border-red-500/30',
  subplot: 'text-emerald-300 bg-emerald-400/10 border-emerald-500/30',
};

const STORYLINE_TYPES: StorylineType[] = ['protagonist', 'antagonist', 'subplot'];

/** 交集预警状态徽章配置 */
const INTERSECTION_STATUS: Record<NonNullable<IntersectionTarget['status']>, {
  label: string;
  cls: string;
  icon: typeof CheckCircle;
}> = {
  ok: { label: '按时汇合', cls: 'text-emerald-300 bg-emerald-400/10 border-emerald-500/30', icon: CheckCircle },
  warning: { label: '需提前铺垫', cls: 'text-amber-300 bg-amber-400/10 border-amber-500/30', icon: AlertTriangle },
  danger: { label: '无法汇合', cls: 'text-red-300 bg-red-400/10 border-red-500/30', icon: AlertCircle },
};

export default function MultiLineCommandPanel() {
  return (
    <div className="space-y-3">
      <StorylineSection />
      <TimelineSection />
      <IntersectionSection />
    </div>
  );
}

// ============================================================================
// 故事线管理
// ============================================================================

function StorylineSection() {
  const storylines = useAppStore(s => s.storylines);
  const addStoryline = useAppStore(s => s.addStoryline);
  const deleteStoryline = useAppStore(s => s.deleteStoryline);

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<StorylineType>('protagonist');
  const [formName, setFormName] = useState('');

  const handleCreate = () => {
    if (!formName.trim()) return;
    addStoryline({ type: formType, name: formName.trim() });
    setFormName('');
    setFormType('protagonist');
    setShowForm(false);
  };

  const handleDelete = (s: Storyline) => {
    if (!window.confirm(`确定删除故事线「${s.name}」？其下 ${s.nodes.length} 个时间轴节点将一并移除。`)) return;
    deleteStoryline(s.id);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-ink-200 font-medium">
          <GitBranch className="w-3.5 h-3.5 text-amber-400" />
          故事线
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-2 py-0.5 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          添加故事线
        </button>
      </div>

      {showForm && (
        <div className="p-2.5 bg-ink-800/40 border border-amber-500/20 rounded-lg space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-ink-400">类型</span>
            <select
              aria-label="类型"
              value={formType}
              onChange={e => setFormType(e.target.value as StorylineType)}
              className="input text-[11px] py-1 flex-1"
            >
              {STORYLINE_TYPES.map(t => (
                <option key={t} value={t}>{STORYLINE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <input
            aria-label="名称"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="故事线名称，如：主角复仇线 / 反派布局线"
            className="input text-[11px] py-1 w-full"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowForm(false)} className="px-2 py-1 text-[11px] text-ink-400 hover:text-ink-200">
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!formName.trim()}
              className="px-2 py-1 text-[11px] bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 rounded disabled:opacity-40"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {storylines.length === 0 ? (
        <div className="p-4 text-center">
          <GitBranch className="w-7 h-7 text-ink-600 mx-auto mb-1.5" />
          <p className="text-[11px] text-ink-500">还没有故事线，添加主角线 / 反派线 / 支线开始排兵布阵</p>
        </div>
      ) : (
        <div className="space-y-1">
          {storylines.map(s => (
            <div key={s.id} className="group flex items-center gap-2 p-2 bg-ink-800/30 border border-ink-700/40 rounded">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[11px] text-ink-100 truncate flex-1">{s.name}</span>
              <span className={`px-1 py-px text-[9px] rounded border ${STORYLINE_TYPE_COLORS[s.type]}`}>
                {STORYLINE_TYPE_LABELS[s.type]}
              </span>
              <span className="text-[9px] text-ink-500">{s.nodes.length} 节点</span>
              <button
                onClick={() => handleDelete(s)}
                className="text-ink-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                title="删除故事线"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 时间轴对齐视图（核心）
// ============================================================================

function TimelineSection() {
  const storylines = useAppStore(s => s.storylines);
  const chapters = useAppStore(s => s.chapters);
  const addTimelineNode = useAppStore(s => s.addTimelineNode);
  const removeTimelineNode = useAppStore(s => s.removeTimelineNode);
  const moveTimelineNode = useAppStore(s => s.moveTimelineNode);
  const detectMultiLineConflicts = useAppStore(s => s.detectMultiLineConflicts);
  const multiLineConflicts = useAppStore(s => s.multiLineConflicts);
  const [dragInfo, setDragInfo] = useState<{ storylineId: string; nodeId: string } | null>(null);

  const chapterColumns = useMemo(
    () => chapters
      .filter(c => isPolishableChapter(c))
      .sort((a, b) => a.order - b.order),
    [chapters],
  );

  const handleCellClick = (storyline: Storyline, chapter: Chapter) => {
    const node = storyline.nodes.find(n => n.chapterId === chapter.id);
    if (node) {
      removeTimelineNode(storyline.id, node.id);
    } else {
      addTimelineNode(storyline.id, chapter.id);
    }
  };

  const CONFLICT_META: Record<string, { label: string; cls: string }> = {
    'time-paradox': { label: '时间矛盾', cls: 'text-red-300 bg-red-400/10' },
    'travel-conflict': { label: '行程冲突', cls: 'text-orange-300 bg-orange-400/10' },
    'node-gap': { label: '节点真空', cls: 'text-amber-300 bg-amber-400/10' },
    'order-inversion': { label: '顺序倒置', cls: 'text-red-300 bg-red-400/10' },
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-ink-200 font-medium">
        <Crosshair className="w-3.5 h-3.5 text-amber-400" />
        时间轴对齐视图
        <button
          onClick={detectMultiLineConflicts}
          className="ml-auto px-1.5 py-0.5 text-[10px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1"
          title="自动巡检所有线索的时间矛盾、行程冲突、节点真空、顺序倒置"
        >
          <Search className="w-2.5 h-2.5" /> 错位巡检
          {multiLineConflicts.length > 0 && (
            <span className="ml-0.5 px-1 bg-red-500/30 text-red-200 rounded-full text-[9px]">{multiLineConflicts.length}</span>
          )}
        </button>
      </div>
      <p className="text-[10px] text-ink-500">点击格子增 / 删节点；拖拽节点到其他列可对齐章节；点「错位巡检」自动检测时间矛盾与行程冲突</p>

      {storylines.length === 0 ? (
        <div className="p-3 bg-ink-800/30 rounded-lg text-center">
          <p className="text-[11px] text-ink-500">先添加故事线，再在此对齐章节节点</p>
        </div>
      ) : chapterColumns.length === 0 ? (
        <div className="p-3 bg-ink-800/30 rounded-lg text-center">
          <p className="text-[11px] text-ink-500">尚无章节级节点，先去大纲面板创建章节</p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="inline-block min-w-full">
            {/* 表头：章节列 */}
            <div className="flex items-center gap-px mb-1">
              <div className="w-20 flex-shrink-0 text-[10px] text-ink-500 text-right pr-2">章节＼线索</div>
              {chapterColumns.map(ch => (
                <div
                  key={ch.id}
                  className="w-8 flex-shrink-0 text-[9px] text-ink-500 text-center truncate"
                  title={ch.title}
                >
                  {ch.order}
                </div>
              ))}
            </div>

            {/* 每条故事线一行 */}
            {storylines.map(s => (
              <div key={s.id} className="flex items-center gap-px mb-1">
                <div className="w-20 flex-shrink-0 flex items-center gap-1 pr-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-[10px] text-ink-200 truncate" title={s.name}>{s.name}</span>
                </div>
                {chapterColumns.map(ch => {
                  const node = s.nodes.find(n => n.chapterId === ch.id);
                  const hasNode = !!node;
                  const isDragOver = dragInfo && hasNode === false;
                  return (
                    <div
                      key={ch.id}
                      onDragOver={e => { if (dragInfo) { e.preventDefault(); } }}
                      onDrop={e => {
                        if (dragInfo && dragInfo.storylineId === s.id) {
                          e.preventDefault();
                          moveTimelineNode(s.id, dragInfo.nodeId, ch.id);
                          setDragInfo(null);
                        }
                      }}
                      className="w-8 h-6 flex-shrink-0"
                    >
                      <button
                        draggable={hasNode}
                        onDragStart={e => {
                          if (node) {
                            setDragInfo({ storylineId: s.id, nodeId: node.id });
                            e.dataTransfer.effectAllowed = 'move';
                          }
                        }}
                        onDragEnd={() => setDragInfo(null)}
                        onClick={() => handleCellClick(s, ch)}
                        title={hasNode ? `${s.name} · ${ch.title}（点击移除·可拖拽对齐到其他章节）` : `${ch.title}（点击添加节点）`}
                        className={`w-full h-full rounded flex items-center justify-center transition-transform hover:scale-110 ${
                          hasNode ? 'cursor-move' : 'border border-dashed border-ink-700/60 hover:border-ink-500'
                        } ${isDragOver ? 'ring-2 ring-cyan-400' : ''}`}
                        style={hasNode ? { backgroundColor: s.color } : undefined}
                      >
                        {hasNode && <span className="w-1.5 h-1.5 rounded-full bg-white/80" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 错位冲突列表 */}
      {multiLineConflicts.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[10px] text-ink-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            检测到 {multiLineConflicts.length} 处错位：
          </div>
          {multiLineConflicts.map(c => {
            const meta = CONFLICT_META[c.type] || { label: c.type, cls: 'text-ink-300 bg-ink-700/40' };
            return (
              <div key={c.id} className={`p-1.5 rounded text-[10px] ${c.severity === 'error' ? 'bg-red-500/5' : 'bg-amber-500/5'}`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={`px-1 py-px rounded ${meta.cls}`}>{meta.label}</span>
                  <span className="text-ink-400">{c.storylineName}</span>
                </div>
                <div className="text-ink-300">{c.description}</div>
                <div className="text-emerald-300/80 mt-0.5">建议：{c.suggestion}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 交集点预警区
// ============================================================================

function IntersectionSection() {
  const storylines = useAppStore(s => s.storylines);
  const chapters = useAppStore(s => s.chapters);
  const targets = useAppStore(s => s.intersectionTargets);
  const addTarget = useAppStore(s => s.addIntersectionTarget);
  const deleteTarget = useAppStore(s => s.deleteIntersectionTarget);
  const checkIntersection = useAppStore(s => s.checkIntersection);

  const [showForm, setShowForm] = useState(false);
  const [formChapterId, setFormChapterId] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStorylineIds, setFormStorylineIds] = useState<string[]>([]);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const chapterOptions = useMemo(
    () => chapters
      .filter(c => isPolishableChapter(c))
      .sort((a, b) => a.order - b.order),
    [chapters],
  );

  const storylineName = (id: string) => storylines.find(s => s.id === id)?.name || '（已删除）';
  const chapterTitle = (id: string) => chapters.find(c => c.id === id)?.title || '（已删除）';

  const toggleStoryline = (id: string) => {
    setFormStorylineIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const handleCreate = () => {
    if (!formChapterId || !formDesc.trim() || formStorylineIds.length === 0) return;
    addTarget({
      chapterId: formChapterId,
      description: formDesc.trim(),
      storylineIds: formStorylineIds,
    });
    setFormChapterId('');
    setFormDesc('');
    setFormStorylineIds([]);
    setShowForm(false);
  };

  const handleDelete = (t: IntersectionTarget) => {
    if (!window.confirm(`确定删除交集目标「${chapterTitle(t.chapterId)}」？`)) return;
    deleteTarget(t.id);
  };

  const handleCheck = (id: string) => {
    setCheckingId(id);
    // checkIntersection 为同步操作，用微任务复位 spinner 便于视觉反馈
    Promise.resolve().then(() => {
      checkIntersection(id);
      setCheckingId(null);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-ink-200 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          交集点预警
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          disabled={storylines.length === 0}
          className="px-2 py-0.5 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-40"
          title={storylines.length === 0 ? '先添加故事线' : undefined}
        >
          <Plus className="w-3 h-3" />
          添加交集目标
        </button>
      </div>

      {showForm && (
        <div className="p-2.5 bg-ink-800/40 border border-amber-500/20 rounded-lg space-y-2">
          {storylines.length === 0 ? (
            <p className="text-[10px] text-ink-500">请先添加至少两条故事线</p>
          ) : (
            <>
              <div>
                <label className="text-[10px] text-ink-500 block mb-0.5">交集章节</label>
                <select
                  aria-label="交集章节"
                  value={formChapterId}
                  onChange={e => setFormChapterId(e.target.value)}
                  className="input text-[11px] py-1 w-full"
                >
                  <option value="">选择章节…</option>
                  {chapterOptions.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-ink-500 block mb-0.5">交集描述</label>
                <input
                  aria-label="交集描述"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder="如：第10章主角与反派第一次正面交锋"
                  className="input text-[11px] py-1 w-full"
                />
              </div>
              <div>
                <label className="text-[10px] text-ink-500 block mb-0.5">参与线索（多选）</label>
                <div className="flex flex-wrap gap-1.5" aria-label="参与线索（多选）">
                  {storylines.map(s => {
                    const checked = formStorylineIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleStoryline(s.id)}
                        className={`px-2 py-0.5 text-[10px] rounded-full border flex items-center gap-1 transition-colors ${
                          checked
                            ? 'bg-amber-400/20 text-amber-200 border-amber-400/40'
                            : 'bg-ink-800/40 text-ink-400 border-ink-700/40 hover:bg-ink-700/40'
                        }`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setShowForm(false)} className="px-2 py-1 text-[11px] text-ink-400 hover:text-ink-200">
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!formChapterId || !formDesc.trim() || formStorylineIds.length === 0}
                  className="px-2 py-1 text-[11px] bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 rounded disabled:opacity-40"
                >
                  创建
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {targets.length === 0 ? (
        <div className="p-4 text-center">
          <AlertTriangle className="w-7 h-7 text-ink-600 mx-auto mb-1.5" />
          <p className="text-[11px] text-ink-500">还没有交集目标，设定多条线索在某章交汇并预警汇合风险</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {targets.map(t => {
            const status = t.status ? INTERSECTION_STATUS[t.status] : null;
            const StatusIcon = status?.icon || Circle;
            return (
              <div key={t.id} className="group p-2 bg-ink-800/30 border border-ink-700/40 rounded">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] text-ink-100 font-medium truncate">
                    {chapterTitle(t.chapterId)}
                  </span>
                  {status ? (
                    <span className={`px-1.5 py-px text-[9px] rounded border flex items-center gap-0.5 ${status.cls}`}>
                      <StatusIcon className="w-2.5 h-2.5" />
                      {status.label}
                    </span>
                  ) : (
                    <span className="px-1.5 py-px text-[9px] rounded border border-ink-700/40 text-ink-500 flex items-center gap-0.5">
                      <Circle className="w-2.5 h-2.5" />
                      未检查
                    </span>
                  )}
                  <button
                    onClick={() => handleCheck(t.id)}
                    disabled={checkingId === t.id}
                    className="ml-auto px-1.5 py-0.5 text-[10px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-50"
                  >
                    {checkingId === t.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Crosshair className="w-2.5 h-2.5" />}
                    检查
                  </button>
                  <button
                    onClick={() => handleDelete(t)}
                    className="text-ink-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                    title="删除交集目标"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[11px] text-ink-300 leading-relaxed mb-1">{t.description}</div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[9px] text-ink-500">参与线索：</span>
                  {t.storylineIds.map(sid => (
                    <span
                      key={sid}
                      className="px-1 py-px text-[9px] rounded bg-ink-700/40 text-ink-300 border border-ink-700/40"
                    >
                      {storylineName(sid)}
                    </span>
                  ))}
                </div>
                {t.message && (
                  <div className={`mt-1 text-[10px] leading-relaxed ${
                    t.status === 'ok' ? 'text-emerald-300/80'
                    : t.status === 'warning' ? 'text-amber-300/80'
                    : t.status === 'danger' ? 'text-red-300/80'
                    : 'text-ink-500'
                  }`}>
                    {t.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
