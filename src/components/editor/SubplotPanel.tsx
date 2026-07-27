import { useState, useEffect, useMemo, useId, memo } from 'react';
import {
  GitBranch,
  Plus,
  Trash2,
  ChevronRight,
  AlertTriangle,
  Clock,
  CheckCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { confirm } from '@/hooks/useConfirm';
import {
  SUBPLOT_STATUS_LABELS,
  SUBPLOT_STATUS_COLORS,
  SUBPLOT_STATUSES,
  type Subplot,
  type SubplotStatus,
} from '@/types';
import Empty from '@/components/Empty';

/** 计算 ISO 时间串距今多少天；非法或空值返回 null */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
}

/** 格式化为 YYYY-MM-DD；空值返回 '—' */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 单条支线卡片 */
// C2 性能修复：chapterOptions/chapterIdSet 由父组件 SubplotPanel useMemo 计算后传入，
// 避免 N 张卡片各自订阅 chapters + 各自 filter + 各自 new Set。
// memo 包裹使 subplot 引用未变时不重渲染（父组件 chapters 变化时仅 chapterOptions prop 变化）。
const SubplotCard = memo(function SubplotCard({
  subplot,
  chapterOptions,
  chapterIdSet,
}: {
  subplot: Subplot;
  chapterOptions: Array<{ id: string; title: string }>;
  chapterIdSet: Set<string>;
}) {
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const updateSubplot = useAppStore(s => s.updateSubplot);
  const deleteSubplot = useAppStore(s => s.deleteSubplot);
  const progressSubplot = useAppStore(s => s.progressSubplot);
  const currentChapterId = useAppStore(s => s.currentChapterId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(subplot.title);
  const uid = useId();

  // 当外部 subplot.title 变化（如其他面板/AI 修改、跨设备同步、撤销重做）时，
  // 在未编辑态下同步本地草稿，避免点击编辑时显示过期文本
  useEffect(() => {
    if (!editingTitle) setTitleDraft(subplot.title);
  }, [subplot.title, editingTitle]);

  // 判断某 chapterId 是否引用了已删除的章节（仍在 store 中但不在 chapterOptions 里）
  const isOrphanChapter = (id: string | null): boolean => {
    return !!id && !chapterIdSet.has(id);
  };

  const getChapterTitle = (id: string | null): string => {
    if (!id) return '未指定';
    const found = chapterOptions.find(c => c.id === id);
    return found ? found.title : '已删除章节';
  };

  const isClosed = subplot.status === 'closed' || subplot.status === 'abandoned';

  // 状态预警
  const progressDays = daysSince(subplot.lastProgressAt);
  const createdDays = daysSince(subplot.createdAt);
  const showProgressStaleWarning =
    subplot.status === 'progressing' && progressDays !== null && progressDays > 14;
  const showOpenStaleWarning =
    subplot.status === 'open' && createdDays !== null && createdDays > 7;

  const handleTitleCommit = () => {
    const t = titleDraft.trim();
    if (t && t !== subplot.title) {
      updateSubplot(subplot.id, { title: t });
    } else {
      setTitleDraft(subplot.title);
    }
    setEditingTitle(false);
  };

  const handleToggleCharacter = (id: string) => {
    const list = subplot.relatedCharacters.includes(id)
      ? subplot.relatedCharacters.filter(x => x !== id)
      : [...subplot.relatedCharacters, id];
    updateSubplot(subplot.id, { relatedCharacters: list });
  };

  const handleToggleForeshadow = (id: string) => {
    const list = subplot.relatedForeshadows.includes(id)
      ? subplot.relatedForeshadows.filter(x => x !== id)
      : [...subplot.relatedForeshadows, id];
    updateSubplot(subplot.id, { relatedForeshadows: list });
  };

  const handleProgress = () => {
    if (!currentChapterId) return;
    progressSubplot(subplot.id, currentChapterId);
  };

  const handleDelete = async () => {
    if (await confirm(`删除支线「${subplot.title}」？`)) {
      deleteSubplot(subplot.id);
    }
  };

  return (
    <div
      className={`card p-3 space-y-3 transition-opacity ${
        isClosed ? 'opacity-60' : 'opacity-100'
      }`}
    >
      {/* 标题 + 状态徽章 + 状态切换 */}
      <div className="flex items-start gap-2">
        <GitBranch className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTitleCommit();
                if (e.key === 'Escape') {
                  setTitleDraft(subplot.title);
                  setEditingTitle(false);
                }
              }}
              className="input text-sm py-1"
              placeholder="支线标题…"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitleDraft(subplot.title);
                setEditingTitle(true);
              }}
              className="block w-full text-left text-sm text-ink-200 hover:text-amber-300 truncate"
              title="点击编辑标题"
            >
              {subplot.title || '（未命名支线）'}
            </button>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`inline-block w-2 h-2 rounded-full ${SUBPLOT_STATUS_COLORS[subplot.status]}`}
              aria-hidden="true"
            />
            <span className="text-[10px] text-ink-500">
              {SUBPLOT_STATUS_LABELS[subplot.status]}
            </span>
          </div>
        </div>
        <select
          value={subplot.status}
          onChange={e => updateSubplot(subplot.id, { status: e.target.value as SubplotStatus })}
          className="input text-[10px] py-1 w-auto"
          aria-label="切换支线状态"
        >
          {SUBPLOT_STATUSES.map(s => (
            <option key={s} value={s}>{SUBPLOT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* 状态预警 */}
      {showProgressStaleWarning && progressDays !== null && (
        <div className="flex items-center gap-1.5 text-[11px] text-orange-400 bg-orange-500/10 px-2 py-1 rounded">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          已 {progressDays} 天未推进
        </div>
      )}
      {showOpenStaleWarning && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-400/10 px-2 py-1 rounded">
          <Clock className="w-3 h-3" aria-hidden="true" />
          开启已久未推进
        </div>
      )}

      {/* 简介 */}
      <div>
        <label htmlFor={`${uid}-desc`} className="block text-[10px] text-ink-500 mb-1">简介</label>
        <textarea
          id={`${uid}-desc`}
          value={subplot.description}
          onChange={e => updateSubplot(subplot.id, { description: e.target.value })}
          rows={2}
          className="input text-xs py-1.5 resize-none"
          placeholder="一句话描述支线目标…"
        />
      </div>

      {/* 关联章节 */}
      <div className="space-y-1.5">
        <div id={`${uid}-chapter-group`} className="block text-[10px] text-ink-500">关联章节</div>
        {chapterOptions.length === 0 ? (
          <p className="text-[10px] text-ink-600">尚无章节可关联</p>
        ) : (
          <div className="space-y-1.5" role="group" aria-labelledby={`${uid}-chapter-group`}>
            <div>
              <div className="text-[10px] text-ink-600 mb-0.5">开启章节</div>
              <select
                value={subplot.startChapterId ?? ''}
                onChange={e => updateSubplot(subplot.id, { startChapterId: e.target.value || null })}
                className="input text-xs py-1"
              >
                <option value="">未指定</option>
                {/* 引用的章节已被删除时显示占位项，否则 select 会静默跳回"未指定"掩盖数据不一致 */}
                {isOrphanChapter(subplot.startChapterId) && (
                  <option value={subplot.startChapterId as string}>已删除章节</option>
                )}
                {chapterOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              {isOrphanChapter(subplot.startChapterId) && (
                <p className="text-[10px] text-red-400 mt-0.5">引用的章节已被删除，请重新选择</p>
              )}
            </div>
            <div>
              <div className="text-[10px] text-ink-600 mb-0.5">最近推进章节</div>
              <select
                value={subplot.lastProgressChapterId ?? ''}
                onChange={e => updateSubplot(subplot.id, { lastProgressChapterId: e.target.value || null })}
                className="input text-xs py-1"
              >
                <option value="">未指定</option>
                {isOrphanChapter(subplot.lastProgressChapterId) && (
                  <option value={subplot.lastProgressChapterId as string}>已删除章节</option>
                )}
                {chapterOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              {isOrphanChapter(subplot.lastProgressChapterId) && (
                <p className="text-[10px] text-red-400 mt-0.5">引用的章节已被删除，请重新选择</p>
              )}
            </div>
            <div>
              <div className="text-[10px] text-ink-600 mb-0.5">预计收束章节</div>
              <select
                value={subplot.expectedCloseChapterId ?? ''}
                onChange={e => updateSubplot(subplot.id, { expectedCloseChapterId: e.target.value || null })}
                className="input text-xs py-1"
              >
                <option value="">未指定</option>
                {isOrphanChapter(subplot.expectedCloseChapterId) && (
                  <option value={subplot.expectedCloseChapterId as string}>已删除章节</option>
                )}
                {chapterOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              {isOrphanChapter(subplot.expectedCloseChapterId) && (
                <p className="text-[10px] text-red-400 mt-0.5">引用的章节已被删除，请重新选择</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 关联角色（chips 多选） */}
      <div>
        <div id={`${uid}-char-group`} className="block text-[10px] text-ink-500 mb-1">关联角色</div>
        {characters.length === 0 ? (
          <p className="text-[10px] text-ink-600">尚无角色可关联</p>
        ) : (
          <div className="flex flex-wrap gap-1" role="group" aria-labelledby={`${uid}-char-group`}>
            {characters.map(c => {
              const active = subplot.relatedCharacters.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleToggleCharacter(c.id)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    active
                      ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                      : 'bg-ink-700/50 text-ink-400 border-transparent hover:bg-ink-700'
                  }`}
                  aria-pressed={active}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 关联伏笔（chips 多选） */}
      <div>
        <div id={`${uid}-foreshadow-group`} className="block text-[10px] text-ink-500 mb-1">关联伏笔</div>
        {foreshadows.length === 0 ? (
          <p className="text-[10px] text-ink-600">尚无伏笔可关联</p>
        ) : (
          <div className="flex flex-wrap gap-1" role="group" aria-labelledby={`${uid}-foreshadow-group`}>
            {foreshadows.map(f => {
              const active = subplot.relatedForeshadows.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleToggleForeshadow(f.id)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    active
                      ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                      : 'bg-ink-700/50 text-ink-400 border-transparent hover:bg-ink-700'
                  }`}
                  aria-pressed={active}
                >
                  {f.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 备注 */}
      <div>
        <label htmlFor={`${uid}-notes`} className="block text-[10px] text-ink-500 mb-1">备注</label>
        <textarea
          id={`${uid}-notes`}
          value={subplot.notes}
          onChange={e => updateSubplot(subplot.id, { notes: e.target.value })}
          rows={2}
          className="input text-xs py-1.5 resize-none"
          placeholder="支线推进要点、注意事项…"
        />
      </div>

      {/* 元信息 */}
      <div className="flex items-center gap-3 text-[10px] text-ink-500 pt-1 border-t border-ink-800/50">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" aria-hidden="true" />
          创建于 {formatDate(subplot.createdAt)}
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle className="w-3 h-3" aria-hidden="true" />
          最近推进 {formatDate(subplot.lastProgressAt)}
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleProgress}
          disabled={!currentChapterId}
          title={currentChapterId ? `推进到「${getChapterTitle(currentChapterId)}」` : '请先选择一个章节'}
          className="flex-1 btn btn-primary text-[11px] py-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-3 h-3" aria-hidden="true" />
          推进到本章
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="btn btn-secondary text-[11px] py-1 text-red-400 hover:text-red-300"
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          删除
        </button>
      </div>
      {!currentChapterId && (
        <p className="text-[10px] text-ink-600 text-center -mt-1">尚未选中章节，无法推进</p>
      )}
    </div>
  );
});

export default function SubplotPanel() {
  const subplots = useAppStore(s => s.subplots);
  const addSubplot = useAppStore(s => s.addSubplot);
  // C2 性能修复：chapterOptions/chapterIdSet 在父组件 useMemo 计算一次，
  // 通过 props 传入所有 SubplotCard，避免 N 张卡片各自订阅 chapters + 各自 filter + 各自 new Set
  const chapters = useAppStore(s => s.chapters);
  const chapterOptions = useMemo(
    () => chapters.filter(c => c.levelType === 'chapter').map(c => ({ id: c.id, title: c.title })),
    [chapters],
  );
  const chapterIdSet = useMemo(() => new Set(chapterOptions.map(c => c.id)), [chapterOptions]);

  const handleAdd = () => {
    addSubplot({ title: '新支线', description: '' });
  };

  return (
    <div className="h-full flex flex-col bg-ink-900/50">
      {/* 顶部 */}
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-amber-300" aria-hidden="true" />
          <span className="text-sm font-medium text-ink-200">支线管理</span>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="btn btn-primary text-[11px] py-1"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          新增支线
        </button>
      </div>

      {/* 列表 / 空状态 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {subplots.length === 0 ? (
          <Empty
            icon={<GitBranch className="w-8 h-8 text-ink-600" aria-hidden="true" />}
            title="暂无支线"
            description="支线可用于追踪副情节的开启、推进与收束"
            action={
              <button
                type="button"
                onClick={handleAdd}
                className="btn btn-primary text-xs mx-auto"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                创建第一条支线
              </button>
            }
            className="card p-6 space-y-2"
          />
        ) : (
          subplots.map(s => <SubplotCard key={s.id} subplot={s} chapterOptions={chapterOptions} chapterIdSet={chapterIdSet} />)
        )}
      </div>
    </div>
  );
}
