import { useState, useEffect, useId, type ReactNode } from 'react';
import {
  X,
  Edit3,
  Flag,
  ScrollText,
  Target,
  FileText,
  Clock,
  Sparkles,
  Users,
  Lightbulb,
  ArrowRight,
  Link2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter, Character, Foreshadow } from '@/types';
import {
  CHAPTER_STATUS_COLORS,
  CHAPTER_STATUS_LABELS,
  CHAPTER_LEVEL_TYPE_LABELS,
  CHAPTER_LEVEL_TYPE_COLORS,
  FORESHADOW_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
} from '@/types';
import { LEVEL_ICONS } from './chapterConstants';

/**
 * 字段标题：editing 时渲染 <label htmlFor> 关联表单控件，
 * 非 editing 时渲染 <div>（无表单控件可关联，仅作可视标题）。
 * 避免 <label> 在非编辑态指向不存在的 id 或包裹纯展示内容。
 */
function Caption({
  htmlFor,
  className,
  children,
}: {
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  if (htmlFor) {
    return <label htmlFor={htmlFor} className={className}>{children}</label>;
  }
  return <div className={className}>{children}</div>;
}

/**
 * 章节详情侧边面板（选中章节后从右侧滑出）。
 *
 * 字段：标题 / 核心命题 / 概述 / 字数目标+进度 / 时间跨度 / 主题 /
 * 人物聚焦（联动角色库，兼容旧数据 ID/名字双路匹配）/ 关键事件 /
 * 关联伏笔（联动伏笔库）/ 状态 / 备注。
 *
 * 编辑保存前先 saveVersion 创建快照，使元数据修改可通过版本历史恢复。
 */
export interface OutlineDetailPanelProps {
  chapter: Chapter;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Chapter>) => void;
  characters: Character[];
  foreshadows: Foreshadow[];
}

export default function OutlineDetailPanel({
  chapter,
  onClose,
  onUpdate,
  characters,
  foreshadows,
}: OutlineDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [localData, setLocalData] = useState(chapter);
  const saveVersion = useAppStore(s => s.saveVersion);
  const uid = useId();

  // 父组件 selectedChapter 变化时同步 localData，否则 handleSave 会用新 chapter.id
  // 配合旧 localData，把 A 章的数据写到 B 章。仅在非编辑态同步，避免覆盖用户正在输入的草稿。
  useEffect(() => {
    if (!editing) setLocalData(chapter);
  }, [chapter, editing]);

  const handleSave = () => {
    // 保存编辑前先创建版本快照（含元数据），使标题/摘要/状态等修改可通过版本历史恢复
    saveVersion(chapter.id, '编辑章节信息前快照');
    onUpdate(chapter.id, localData);
    setEditing(false);
  };

  const LevelIcon = LEVEL_ICONS[chapter.levelType];
  const levelColor = CHAPTER_LEVEL_TYPE_COLORS[chapter.levelType];
  const levelLabel = CHAPTER_LEVEL_TYPE_LABELS[chapter.levelType];

  // characterFocus 统一存角色 ID；兼容旧数据（可能存名字）双路匹配
  const relatedCharacters = characters.filter(c =>
    chapter.characterFocus?.includes(c.id) ||
    chapter.characterFocus?.includes(c.name) ||
    chapter.content?.includes(c.name)
  );

  const relatedForeshadows = foreshadows.filter(f =>
    f.plantedChapterId === chapter.id || f.payoffChapterId === chapter.id
  );

  const wordProgress = chapter.wordTarget
    ? Math.min(100, Math.round((chapter.wordCount / chapter.wordTarget) * 100))
    : null;

  return (
    <div className="bg-ink-900 border-l border-ink-800 w-80 flex flex-col">
      <div className="p-3 border-b border-ink-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LevelIcon className={`w-4 h-4 ${levelColor.split(' ')[0]}`} />
          <span className="text-sm font-medium text-ink-100">{levelLabel}详情</span>
        </div>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-300" aria-label="关闭详情面板">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 标题 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-title` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Edit3 className="w-3 h-3" />
            标题
          </Caption>
          {editing ? (
            <input
              id={`${uid}-title`}
              value={localData.title}
              onChange={(e) => setLocalData({ ...localData, title: e.target.value })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50"
            />
          ) : (
            <div className="text-base text-ink-100 font-medium">{chapter.title}</div>
          )}
        </div>

        {/* 核心命题 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-core-prop` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Flag className="w-3 h-3" />
            核心命题
          </Caption>
          {editing ? (
            <textarea
              id={`${uid}-core-prop`}
              value={localData.coreProposition || ''}
              onChange={(e) => setLocalData({ ...localData, coreProposition: e.target.value })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50 resize-none h-14"
              placeholder="本层级要探讨的核心问题..."
            />
          ) : (
            <div className="text-xs text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
              {chapter.coreProposition || <span className="text-ink-600">未设置</span>}
            </div>
          )}
        </div>

        {/* 概述 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-summary` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <ScrollText className="w-3 h-3" />
            概述
          </Caption>
          {editing ? (
            <textarea
              id={`${uid}-summary`}
              value={localData.summary || ''}
              onChange={(e) => setLocalData({ ...localData, summary: e.target.value })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50 resize-none h-20"
              placeholder="简要描述本层级内容..."
            />
          ) : (
            <div className="text-xs text-ink-300 whitespace-pre-wrap bg-ink-800/30 rounded px-2 py-1.5">
              {chapter.summary || <span className="text-ink-600">未设置</span>}
            </div>
          )}
        </div>

        {/* 字数目标与进度 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Caption htmlFor={editing ? `${uid}-word-target` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" />
              字数目标
            </Caption>
            {editing ? (
              <input
                id={`${uid}-word-target`}
                type="number"
                value={localData.wordTarget || ''}
                onChange={(e) => setLocalData({ ...localData, wordTarget: Number(e.target.value) || undefined })}
                className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50"
                placeholder="0"
              />
            ) : (
              <div className="text-xs text-ink-300">{chapter.wordTarget ? `${chapter.wordTarget} 字` : '-'}</div>
            )}
          </div>
          <div>
            <div className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              当前字数
            </div>
            <div className="text-xs text-ink-300">{chapter.wordCount} 字</div>
          </div>
        </div>

        {/* 进度条 */}
        {wordProgress !== null && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-ink-500">进度</span>
              <span className={`text-[10px] font-mono ${wordProgress >= 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {wordProgress}%
              </span>
            </div>
            <div className="h-1.5 bg-ink-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${wordProgress >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${wordProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* 时间跨度 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-time-span` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            时间跨度
          </Caption>
          {editing ? (
            <input
              id={`${uid}-time-span`}
              value={localData.timeSpan || ''}
              onChange={(e) => setLocalData({ ...localData, timeSpan: e.target.value })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50"
              placeholder="如：建安六年冬 — 建安十三年冬"
            />
          ) : (
            <div className="text-xs text-ink-300">{chapter.timeSpan || <span className="text-ink-600">未设置</span>}</div>
          )}
        </div>

        {/* 主题 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-theme` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            主题
          </Caption>
          {editing ? (
            <input
              id={`${uid}-theme`}
              value={localData.theme || ''}
              onChange={(e) => setLocalData({ ...localData, theme: e.target.value })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50"
              placeholder="本层级的核心主题..."
            />
          ) : (
            <div className="text-xs text-ink-300">{chapter.theme || <span className="text-ink-600">未设置</span>}</div>
          )}
        </div>

        {/* 人物聚焦（联动角色库） */}
        <div>
          <div className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Users className="w-3 h-3" />
            人物聚焦
            <span className="text-ink-600 ml-1">（联动角色库）</span>
          </div>
          {editing ? (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {characters.length === 0 ? (
                <span className="text-xs text-ink-600">角色库为空，请先在角色面板添加角色</span>
              ) : characters.map(char => {
                const checked = localData.characterFocus?.includes(char.id) || false;
                return (
                  <label key={char.id} className="flex items-center gap-2 text-xs text-ink-200 cursor-pointer hover:bg-ink-800/50 rounded px-1.5 py-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = localData.characterFocus || [];
                        const next = e.target.checked
                          ? [...current, char.id]
                          : current.filter(id => id !== char.id);
                        setLocalData({ ...localData, characterFocus: next });
                      }}
                      className="accent-amber-400"
                    />
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: char.color }} />
                    <span>{char.name}</span>
                    <span className="text-ink-500 ml-auto">{CHARACTER_ROLE_LABELS[char.role]}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {relatedCharacters.length > 0 ? (
                relatedCharacters.map(char => (
                  <div key={char.id} className="flex items-center gap-2 text-xs text-ink-300 bg-ink-800/30 rounded px-2 py-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: char.color }} />
                    <span>{char.name}</span>
                    <span className="text-ink-500 ml-auto">{CHARACTER_ROLE_LABELS[char.role]}</span>
                  </div>
                ))) : chapter.characterFocus && chapter.characterFocus.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {chapter.characterFocus.map((cf, i) => {
                    // 兼容旧数据：cf 可能是 ID 也可能是名字
                    const char = characters.find(c => c.id === cf || c.name === cf);
                    return (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-ink-700/50 rounded text-ink-300">
                        {char?.name || cf}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-ink-600">未设置</span>
              )}
            </div>
          )}
        </div>

        {/* 关键事件 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-key-events` : undefined} className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" />
            关键事件
          </Caption>
          {editing ? (
            <textarea
              id={`${uid}-key-events`}
              value={localData.keyEvents?.join('\n') || ''}
              onChange={(e) => setLocalData({ ...localData, keyEvents: e.target.value.split('\n').filter(Boolean) })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50 resize-none h-24"
              placeholder="每行一个关键事件..."
            />
          ) : (
            <ul className="space-y-1">
              {chapter.keyEvents?.map((event, i) => (
                <li key={i} className="text-xs text-ink-300 flex items-start gap-1.5 bg-ink-800/20 rounded px-2 py-1">
                  <ArrowRight className="w-3 h-3 text-amber-500/50 flex-shrink-0 mt-0.5" />
                  {event}
                </li>
              )) || <li className="text-xs text-ink-600">未设置</li>}
            </ul>
          )}
        </div>

        {/* 关联伏笔（联动伏笔库） */}
        {relatedForeshadows.length > 0 && (
          <div>
            <div className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              关联伏笔
              <span className="text-ink-600 ml-1">（联动伏笔库）</span>
            </div>
            <div className="space-y-1">
              {relatedForeshadows.map(f => (
                <div key={f.id} className="text-xs text-ink-300 bg-ink-800/30 rounded px-2 py-1 flex items-center justify-between">
                  <span>{f.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    f.status === 'paid-off' ? 'bg-emerald-500/20 text-emerald-400' :
                    f.status === 'progressing' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-ink-700/50 text-ink-400'
                  }`}>
                    {FORESHADOW_STATUS_LABELS[f.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 状态 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-status` : undefined} className="block text-[10px] text-ink-500 mb-1">
            状态
          </Caption>
          {editing ? (
            <select
              id={`${uid}-status`}
              value={localData.status}
              onChange={(e) => setLocalData({ ...localData, status: e.target.value as Chapter['status'] })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50"
            >
              {Object.entries(CHAPTER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${CHAPTER_STATUS_COLORS[chapter.status]}`} />
              <span className="text-xs text-ink-300">{CHAPTER_STATUS_LABELS[chapter.status]}</span>
            </div>
          )}
        </div>

        {/* 备注 */}
        <div>
          <Caption htmlFor={editing ? `${uid}-notes` : undefined} className="block text-[10px] text-ink-500 mb-1">
            备注
          </Caption>
          {editing ? (
            <textarea
              id={`${uid}-notes`}
              value={localData.notes || ''}
              onChange={(e) => setLocalData({ ...localData, notes: e.target.value })}
              className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-amber-400/50 resize-none h-16"
              placeholder="其他备注信息..."
            />
          ) : (
            <div className="text-xs text-ink-300 whitespace-pre-wrap bg-ink-800/20 rounded px-2 py-1.5">
              {chapter.notes || <span className="text-ink-600">无</span>}
            </div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="p-3 border-t border-ink-800 flex gap-2">
        {editing ? (
          <>
            <button onClick={handleSave} className="flex-1 btn btn-primary text-xs">保存</button>
            <button onClick={() => { setEditing(false); setLocalData(chapter); }} className="btn btn-secondary text-xs">取消</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)} className="w-full btn btn-primary text-xs">编辑</button>
        )}
      </div>
    </div>
  );
}
