import { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  BookOpen,
  Layers,
  FolderOpen,
  MoreHorizontal,
  Trash2,
  Edit3,
  GripVertical,
  BookMarked,
  Target,
  Users,
  Lightbulb,
  ScrollText,
  X,
  Link2,
  Flag,
  Clock,
  Sparkles,
  ArrowRight,
  Filter,
  CheckSquare,
  Merge,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import { CHAPTER_MAX_LEVEL, CHAPTER_BATCH_MERGE_MIN } from '@/constants/config';
import type { Chapter, ChapterLevelType, Character, Foreshadow } from '@/types';
import {
  CHAPTER_STATUS_COLORS,
  CHAPTER_STATUS_LABELS,
  CHAPTER_LEVEL_TYPE_LABELS,
  CHAPTER_LEVEL_TYPE_COLORS,
  FORESHADOW_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
} from '@/types';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const LEVEL_ICONS: Record<ChapterLevelType, React.ComponentType<{ className?: string }>> = {
  book: BookOpen,
  volume: BookMarked,
  part: Layers,
  section: FolderOpen,
  chapter: FileText,
};

// 永不变化的空数组常量，作为无子节点时的稳定回退引用，
// 避免每次渲染 `?? []` 创建新数组使 memo 失效。
const EMPTY_CHILDREN: Chapter[] = [];

function ChapterNodeComponent({
  chapter,
  depth = 0,
  collapsedIds,
  onToggleExpanded,
  onSelect,
  isSelected,
  isMultiSelected = false,
  // 父组件预先过滤并排序好的直接子节点，避免每个 ChapterNode 都订阅全量 chapters。
  // 此前每节点 useAppStore(s => s.chapters) 在任意章节变更时都会生成新数组引用，
  // 使 memo 失效触发全树重渲染，>100 章时拖拽/折叠明显卡顿。
  children,
  // 全树共享的 childrenByParent 映射，用于递归渲染深层子节点。
  // 由 OutlinePanel 用 useMemo 一次性计算并稳定引用，避免每节点重新过滤。
  childrenByParent,
}: {
  chapter: Chapter;
  depth?: number;
  collapsedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onSelect: (chapter: Chapter, e?: React.MouseEvent) => void;
  isSelected: boolean;
  isMultiSelected?: boolean;
  children: Chapter[];
  childrenByParent: Map<string | null, Chapter[]>;
}) {
  const updateChapter = useAppStore(s => s.updateChapter);
  const deleteChapter = useAppStore(s => s.deleteChapter);
  const addChapter = useAppStore(s => s.addChapter);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chapter.title);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(addMenuRef, () => setShowAddMenu(false), showAddMenu);
  useClickOutside(moreMenuRef, () => setShowMenu(false), showMenu);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: chapter.id });

  const expanded = !collapsedIds.has(chapter.id);

  const hasChildren = children.length > 0;
  const LevelIcon = LEVEL_ICONS[chapter.levelType];
  const levelColor = CHAPTER_LEVEL_TYPE_COLORS[chapter.levelType];
  const levelLabel = CHAPTER_LEVEL_TYPE_LABELS[chapter.levelType];

  const handleClick = (e: React.MouseEvent) => {
    // 行点击仅负责选中；折叠/展开统一交给三角按钮，避免点击与折叠行为耦合
    onSelect(chapter, e);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
    setEditTitle(chapter.title);
  };

  const handleSaveTitle = () => {
    if (editTitle.trim()) {
      updateChapter(chapter.id, { title: editTitle.trim() });
    }
    setEditing(false);
  };

  const getNextLevelType = (parentType: ChapterLevelType): ChapterLevelType => {
    const order: ChapterLevelType[] = ['book', 'volume', 'part', 'section', 'chapter'];
    const idx = order.indexOf(parentType);
    return idx < order.length - 1 ? order[idx + 1] : 'chapter';
  };

  const handleAddChapter = (isSub: boolean) => {
    const parentId = isSub ? chapter.id : chapter.parentId;
    const levelType = isSub ? getNextLevelType(chapter.levelType) : chapter.levelType;
    const newChapter = addChapter(parentId, '新' + CHAPTER_LEVEL_TYPE_LABELS[levelType], isSub ? 0 : chapter.order + 1, levelType);
    if (!newChapter) {
      toast.warning('已达最大嵌套层级', `最多支持 ${CHAPTER_MAX_LEVEL} 级嵌套，无法继续添加子章节`);
      setShowAddMenu(false);
      return;
    }
    setCurrentChapter(newChapter.id);
    if (isSub && !expanded) onToggleExpanded(chapter.id);
    setShowAddMenu(false);
  };

  const totalWords = hasChildren ? children.reduce((sum, c) => sum + c.wordCount, 0) + chapter.wordCount : chapter.wordCount;

  const handleStatusChange = (status: Chapter['status']) => {
    updateChapter(chapter.id, { status });
    setShowMenu(false);
  };

  return (
    <div className="select-none">
      <div
        ref={setNodeRef}
        style={{
          paddingLeft: `${depth * 12 + 4}px`,
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isSortableDragging ? 0.3 : undefined,
          zIndex: isSortableDragging ? 100 : undefined,
          boxShadow: isSortableDragging ? '0 4px 20px rgba(0,0,0,0.4)' : undefined,
        }}
        className={`group flex items-center gap-1.5 py-1.5 px-2 mx-1 rounded cursor-pointer transition-colors relative ${
          isMultiSelected
            ? 'bg-amber-400/20 border-l-2 border-amber-400'
            : isSelected
            ? 'bg-amber-400/15 border-l-2 border-amber-400'
            : 'hover:bg-ink-800/50'
        }`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-ink-600 hover:text-amber-400 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto cursor-grab active:cursor-grabbing ${
            isSortableDragging ? 'opacity-100 pointer-events-auto' : ''
          }`}
          title="拖拽排序"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpanded(chapter.id); }}
            className="w-4 h-4 flex items-center justify-center text-ink-500 hover:text-ink-300 flex-shrink-0"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {chapter.levelType === 'chapter' && (
              <span className={`w-1.5 h-1.5 rounded-full ${CHAPTER_STATUS_COLORS[chapter.status]}`} />
            )}
          </div>
        )}

        <LevelIcon className={`w-4 h-4 flex-shrink-0 ${isMultiSelected || isSelected ? 'text-amber-400' : 'text-ink-500'}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="flex-1 bg-ink-800 border border-amber-400/30 rounded px-1.5 py-0.5 text-sm outline-none text-ink-100 min-w-0"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className={`text-sm truncate flex-1 min-w-0 ${isMultiSelected || isSelected ? 'text-amber-300 font-medium' : 'text-ink-200'}`}>
                {chapter.title}
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${levelColor} flex-shrink-0`}>
              {levelLabel}
            </span>
          </div>
          {chapter.summary && !editing && (
            <p className="text-[10px] text-ink-500 truncate mt-0.5">{chapter.summary}</p>
          )}
        </div>

        {totalWords > 0 && (
          <span className="text-[10px] text-ink-500 flex-shrink-0">{totalWords}字</span>
        )}

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); setShowMenu(false); }}
              className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-700/50"
              title="添加"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {showAddMenu && (
              <div className="absolute right-0 top-full mt-1 bg-ink-800 border border-ink-700 rounded-md shadow-medium py-1 z-20 min-w-32">
                <button
                  onClick={(e) => { e.stopPropagation(); handleAddChapter(false); }}
                  className="w-full px-3 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50 flex items-center gap-2"
                >
                  <FileText className="w-3 h-3" />
                  同级插入
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAddChapter(true); }}
                  className="w-full px-3 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50 flex items-center gap-2"
                >
                  <ChevronRight className="w-3 h-3" />
                  添加子级
                </button>
              </div>
            )}
          </div>

          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); setShowAddMenu(false); }}
              className="p-0.5 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-700/50"
              title="更多"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-ink-800 border border-ink-700 rounded-md shadow-medium py-1 z-20 min-w-28">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(true); setShowMenu(false); }}
                  className="w-full px-3 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50 flex items-center gap-2"
                >
                  <Edit3 className="w-3 h-3" />
                  重命名
                </button>
                <div className="my-1 h-px bg-ink-700/50" />
                <div className="text-[10px] px-3 py-1 text-ink-500">状态</div>
                {Object.entries(CHAPTER_STATUS_LABELS).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={(e) => { e.stopPropagation(); handleStatusChange(value as Chapter['status']); }}
                    className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 ${
                      chapter.status === value ? 'text-amber-400 bg-amber-400/10' : 'text-ink-200 hover:bg-ink-700/50'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${CHAPTER_STATUS_COLORS[value as Chapter['status']]}`} />
                    {label}
                  </button>
                ))}
                <div className="my-1 h-px bg-ink-700/50" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`确定删除"${chapter.title}"吗？`)) {
                      deleteChapter(chapter.id);
                    }
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                >
                  <Trash2 className="w-3 h-3" />
                  删除
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {hasChildren && expanded && (
        <div>
          {children.map(child => (
            <ChapterNode
              key={child.id}
              chapter={child}
              depth={depth + 1}
              collapsedIds={collapsedIds}
              onToggleExpanded={onToggleExpanded}
              onSelect={onSelect}
              isSelected={isSelected}
              isMultiSelected={isMultiSelected}
              children={childrenByParent.get(child.id) ?? EMPTY_CHILDREN}
              childrenByParent={childrenByParent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// memo 比较：仅在当前节点自身 props 变化时才重渲染；
// 父级回调已用 useCallback 稳定，children 与 childrenByParent 由父组件 useMemo 稳定引用，
// 避免每次 OutlinePanel 重渲染生成新引用使 memo 失效。
const ChapterNode = memo(ChapterNodeComponent, (prev, next) => {
  if (prev.chapter !== next.chapter) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isMultiSelected !== next.isMultiSelected) return false;
  if (prev.onToggleExpanded !== next.onToggleExpanded) return false;
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.children !== next.children) return false;
  if (prev.childrenByParent !== next.childrenByParent) return false;
  if (prev.collapsedIds !== next.collapsedIds) {
    const prevHas = prev.collapsedIds.has(prev.chapter.id);
    const nextHas = next.collapsedIds.has(next.chapter.id);
    if (prevHas !== nextHas) return false;
  }
  return true;
});

function OutlineDetailPanel({ 
  chapter, 
  onClose, 
  onUpdate,
  characters,
  foreshadows,
}: { 
  chapter: Chapter; 
  onClose: () => void; 
  onUpdate: (id: string, updates: Partial<Chapter>) => void;
  characters: Character[];
  foreshadows: Foreshadow[];
}) {
  const [editing, setEditing] = useState(false);
  const [localData, setLocalData] = useState(chapter);
  const saveVersion = useAppStore(s => s.saveVersion);

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
        <button onClick={onClose} className="text-ink-500 hover:text-ink-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 标题 */}
        <div>
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Edit3 className="w-3 h-3" />
            标题
          </label>
          {editing ? (
            <input
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
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Flag className="w-3 h-3" />
            核心命题
          </label>
          {editing ? (
            <textarea
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
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <ScrollText className="w-3 h-3" />
            概述
          </label>
          {editing ? (
            <textarea
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
            <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" />
              字数目标
            </label>
            {editing ? (
              <input
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
            <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              当前字数
            </label>
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
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            时间跨度
          </label>
          {editing ? (
            <input
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
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            主题
          </label>
          {editing ? (
            <input
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
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Users className="w-3 h-3" />
            人物聚焦
            <span className="text-ink-600 ml-1">（联动角色库）</span>
          </label>
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
          <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" />
            关键事件
          </label>
          {editing ? (
            <textarea
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
            <label className="block text-[10px] text-ink-500 mb-1 flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              关联伏笔
              <span className="text-ink-600 ml-1">（联动伏笔库）</span>
            </label>
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
          <label className="block text-[10px] text-ink-500 mb-1">状态</label>
          {editing ? (
            <select
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
          <label className="block text-[10px] text-ink-500 mb-1">备注</label>
          {editing ? (
            <textarea
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

export default function OutlinePanel() {
  const chapters = useAppStore(s => s.chapters);
  const addChapter = useAppStore(s => s.addChapter);
  const moveChapter = useAppStore(s => s.moveChapter);
  const updateChapter = useAppStore(s => s.updateChapter);
  const deleteChapter = useAppStore(s => s.deleteChapter);
  const saveVersion = useAppStore(s => s.saveVersion);
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<Chapter['status'] | 'all'>('all');
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const batchMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(batchMenuRef, () => setShowBatchMenu(false), showBatchMenu);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const filteredChapters = useMemo(() => filterStatus === 'all'
    ? chapters
    : chapters.filter(c => c.status === filterStatus),
    [chapters, filterStatus]);

  // 全树共享的 parentId -> 已排序子节点数组映射。
  // 通过 useMemo 在 chapters/filterStatus 变更时才重新计算，引用稳定，
  // 传给所有 ChapterNode 后 memo 比较能精准跳过未变节点，避免全树重渲染。
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Chapter[]>();
    for (const ch of filteredChapters) {
      const key = ch.parentId;
      let arr = map.get(key);
      if (!arr) {
        arr = [];
        map.set(key, arr);
      }
      arr.push(ch);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.order - b.order);
    }
    return map;
  }, [filteredChapters]);

  const rootChapters = childrenByParent.get(null) ?? EMPTY_CHILDREN;

  const visibleIds = useMemo(() => {
    const result: string[] = [];
    const walk = (parentId: string | null) => {
      const siblings = childrenByParent.get(parentId) ?? EMPTY_CHILDREN;
      for (const ch of siblings) {
        result.push(ch.id);
        if (!collapsedIds.has(ch.id)) {
          walk(ch.id);
        }
      }
    };
    walk(null);
    return result;
  }, [childrenByParent, collapsedIds]);

  const handleToggleExpanded = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedId = String(active.id);
    const overId = String(over.id);

    const draggedChapter = chapters.find(c => c.id === draggedId);
    const overChapter = chapters.find(c => c.id === overId);
    if (!draggedChapter || !overChapter) return;

    const activeIndex = visibleIds.indexOf(draggedId);
    const overIndex = visibleIds.indexOf(overId);
    if (activeIndex === -1 || overIndex === -1) return;

    // 判断拖拽意图：
    // 1. 拖到目标节点上半部分 -> 作为目标节点的前一个同级
    // 2. 拖到目标节点下半部分 -> 作为目标节点的子级（设为子级时排在最前）
    //    或者：如果目标节点已是父节点且有展开，下半部分作为后一个同级
    // 这里采用简化策略：通过 dnd-kit 的 over 位置无法直接获取，
    // 因此当目标节点有子节点且拖到其上时，作为子级；否则作为同级排序。
    const dropBelow = activeIndex < overIndex;

    // 迭代版祖先判断（避免极端嵌套层级下递归栈溢出）：
    // 自下而上沿 parentId 链查找，若中途遇到 parentId 则说明存在祖先关系
    const isAncestor = (ancestorId: string, childId: string): boolean => {
      let currentId: string | null = childId;
      while (currentId) {
        if (currentId === ancestorId) return true;
        const node = chapters.find(c => c.id === currentId);
        currentId = node?.parentId ?? null;
      }
      return false;
    };

    // 判断是否应作为子级：目标节点有子节点，且拖拽源不是目标节点的祖先
    const overHasChildren = chapters.some(c => c.parentId === overId);
    const wouldCreateCycle = isAncestor(draggedId, overId);

    const oldParentId = draggedChapter.parentId;

    let newParentId: string | null;
    let newOrder: number;

    if (dropBelow && overHasChildren && !wouldCreateCycle && draggedChapter.parentId !== overId) {
      // 作为目标节点的子级（排在子级最前）
      newParentId = overId;
      const childCount = chapters.filter(c => c.parentId === overId).length;
      newOrder = childCount; // 放到最后，避免破坏现有子级顺序
      // 展开目标节点以便用户看到结果
      setCollapsedIds(prev => {
        const next = new Set(prev);
        next.delete(overId);
        return next;
      });
    } else {
      // 作为同级排序
      newParentId = overChapter.parentId;
      newOrder = dropBelow ? overChapter.order + 1 : overChapter.order;
    }

    // I4: 拖拽父章节时，预判整个子树移动后的最大深度，避免子节点超过 CHAPTER_MAX_LEVEL。
    // moveChapter 内部也有同样校验（getSubtreeMaxDepth），但提前预判可在不修改 store 的情况下
    // 给出明确的中文提示，避免用户重复尝试。
    if (newParentId !== oldParentId) {
      // 递归计算子树最大深度：加 visited Set 防止数据中存在环时栈溢出。
      // 同时用 maxDepth 硬限制（50）兜底，避免极端深嵌套数据导致栈耗尽。
      const getSubtreeMaxDepth = (rootId: string): number => {
        const visited = new Set<string>();
        const MAX_DEPTH = 50;
        const walk = (id: string, depth: number): number => {
          if (depth > MAX_DEPTH) return depth;
          if (visited.has(id)) return depth; // 检测到环，立即返回避免无限递归
          visited.add(id);
          const kids = chapters.filter(c => c.parentId === id);
          if (kids.length === 0) return 1;
          return 1 + Math.max(...kids.map(k => walk(k.id, depth + 1)));
        };
        return walk(rootId, 0);
      };
      const subtreeDepth = getSubtreeMaxDepth(draggedId);
      const targetLevel = newParentId
        ? (chapters.find(c => c.id === newParentId)?.level ?? 0) + 1
        : 1;
      if (targetLevel + subtreeDepth - 1 > CHAPTER_MAX_LEVEL) {
        toast.warning(
          '无法移动到该位置',
          `移动后子树最深层级将达到 ${targetLevel + subtreeDepth - 1}，超过 ${CHAPTER_MAX_LEVEL} 级上限。请先扁平化子章节或选择更浅的目标层级。`,
        );
        return;
      }
    }

    const moved = moveChapter(draggedId, newParentId, newOrder);
    if (!moved) {
      toast.warning('无法移动到该位置', `移动后子树层级将超过 ${CHAPTER_MAX_LEVEL} 级上限，或目标位置无效`);
      return;
    }

    // 拖拽完成后对受影响的两个层级（原父级、新父级）统一重排 order，
    // 确保从 0 开始连续递增，避免历史 order 不连续或跨层级拖拽累积导致的断层/重复。
    // 注意：moveChapter 已更新 store，必须读取最新 chapters，避免使用陈旧闭包。
    const latestChapters = useAppStore.getState().chapters;
    const rerank = (parentId: string | null) => {
      const sibs = latestChapters
        .filter(c => c.parentId === parentId)
        .sort((a, b) => a.order - b.order);
      sibs.forEach((ch, idx) => {
        if (ch.order !== idx) {
          updateChapter(ch.id, { order: idx });
        }
      });
    };
    rerank(newParentId);
    if (oldParentId !== newParentId) rerank(oldParentId);
  }, [chapters, visibleIds, moveChapter, updateChapter]);

  const handleSelect = useCallback((chapter: Chapter, e?: React.MouseEvent) => {
    if (e && e.ctrlKey) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(chapter.id)) next.delete(chapter.id);
        else next.add(chapter.id);
        return next;
      });
    } else {
      setSelectedIds(new Set([chapter.id]));
    }
    setSelectedChapter(chapter);
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    // 父子关系防护：若某节点的祖先已在选中集合中，删除父节点时子节点会一并被级联删除，
    // 此处再次单独删除会造成 store 重复处理或找不到节点。先过滤掉"祖先已被选中"的节点。
    const hasSelectedAncestor = (id: string): boolean => {
      let currentId: string | null = id;
      const seen = new Set<string>();
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const node = chapters.find(c => c.id === currentId);
        currentId = node?.parentId ?? null;
        if (currentId && selectedIds.has(currentId)) return true;
      }
      return false;
    };
    const idsToDelete = Array.from(selectedIds).filter(id => !hasSelectedAncestor(id));
    if (idsToDelete.length === 0) return;
    if (confirm(`确定删除选中的 ${selectedIds.size} 个章节吗？\n（含子级将一并级联删除）`)) {
      idsToDelete.forEach(id => deleteChapter(id));
      setSelectedIds(new Set());
      setSelectedChapter(null);
    }
    setShowBatchMenu(false);
  }, [selectedIds, chapters, deleteChapter]);

  const handleBatchMerge = useCallback(() => {
    if (selectedIds.size < CHAPTER_BATCH_MERGE_MIN) return;
    const selectedChapters = chapters.filter(c => selectedIds.has(c.id));
    if (selectedChapters.length < CHAPTER_BATCH_MERGE_MIN) return;
    const firstChapter = selectedChapters[0];
    if (!confirm(`确定合并选中的 ${selectedChapters.length} 个章节吗？\n\n内容将按顺序拼接到首个章节"${firstChapter.title}"中，其余章节将被删除。`)) {
      return;
    }
    // 合并前为首个章节创建版本快照，便于误操作后恢复
    saveVersion(firstChapter.id, '批量合并前快照');
    // HTML 直接拼接：用 '\n' 拼接多段 HTML 会产生破损 HTML（多余文本节点、未闭合标签交错）
    const mergedContent = selectedChapters.map(c => c.content || '').join('');
    // 元数据合并策略：
    //   - characterFocus / foreshadows：取并集并去重（ID 维度），保留所有被合并章节涉及的角色与伏笔
    //   - keyEvents：按章节顺序拼接，保留时间线脉络
    //   - summary / perspective / theme / notes：以首章节为准，避免主观描述相互覆盖
    //   - status：取"最靠后"的状态（draft < writing < reviewing < done），反映合并后整体进度
    const statusOrder: Record<Chapter['status'], number> = { draft: 0, writing: 1, reviewing: 2, done: 3 };
    const mergeStringArray = (key: 'characterFocus' | 'keyEvents' | 'foreshadows') => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const c of selectedChapters) {
        for (const v of c[key] || []) {
          if (!seen.has(v)) { seen.add(v); out.push(v); }
        }
      }
      return out.length > 0 ? out : undefined;
    };
    const mergedStatus = selectedChapters.reduce<Chapter['status']>(
      (acc, c) => statusOrder[c.status] > statusOrder[acc] ? c.status : acc,
      firstChapter.status,
    );
    updateChapter(firstChapter.id, {
      content: mergedContent,
      characterFocus: mergeStringArray('characterFocus'),
      keyEvents: mergeStringArray('keyEvents'),
      foreshadows: mergeStringArray('foreshadows'),
      status: mergedStatus,
    });
    selectedIds.forEach(id => {
      if (id !== firstChapter.id) deleteChapter(id);
    });
    setSelectedIds(new Set([firstChapter.id]));
    setSelectedChapter(firstChapter);
    setShowBatchMenu(false);
  }, [selectedIds, chapters, updateChapter, deleteChapter, saveVersion]);

  const getTotalWordCount = useMemo(() => chapters.reduce((sum, ch) => sum + ch.wordCount, 0),
    [chapters]);

  const stats = useMemo(() => {
    const s = { volumes: 0, parts: 0, sections: 0, chapters: 0 };
    chapters.forEach(ch => {
      if (ch.levelType === 'volume') s.volumes++;
      else if (ch.levelType === 'part') s.parts++;
      else if (ch.levelType === 'section') s.sections++;
      else if (ch.levelType === 'chapter') s.chapters++;
    });
    return s;
  }, [chapters]);

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {/* 统计栏 */}
        <div className="px-3 py-2 border-b border-ink-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-ink-100">大纲</span>
            {selectedIds.size > 0 && (
              <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                已选 {selectedIds.size}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-ink-500">
            <span>{stats.volumes}卷</span>
            <span>{stats.parts}部</span>
            <span>{stats.chapters}章</span>
            <span className="text-amber-400">{getTotalWordCount}字</span>
          </div>
        </div>

        {/* 筛选和批量操作栏 */}
        <div className="px-3 py-1.5 border-b border-ink-800/50 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-ink-500" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as Chapter['status'] | 'all')}
              className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1.5 py-0.5 text-ink-300 outline-none focus:border-amber-400/50"
            >
              <option value="all">全部状态</option>
              {Object.entries(CHAPTER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {selectedIds.size > 0 && (
            <div className="relative" ref={batchMenuRef}>
              <button
                onClick={() => setShowBatchMenu(!showBatchMenu)}
                className="text-[10px] text-ink-400 hover:text-amber-400 flex items-center gap-1"
              >
                <CheckSquare className="w-3 h-3" />
                批量操作
              </button>
              {showBatchMenu && (
                <div className="absolute right-0 top-full mt-1 bg-ink-800 border border-ink-700 rounded-md shadow-medium py-1 z-20 min-w-28">
                  {/* 批量移动入口暂时隐藏：批量多节点拖拽尚未实现，避免误导用户 */}
                  <button
                    onClick={handleBatchMerge}
                    className="w-full px-3 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50 flex items-center gap-2"
                  >
                    <Merge className="w-3 h-3" />
                    合并章节
                  </button>
                  <div className="my-1 h-px bg-ink-700/50" />
                  <button
                    onClick={handleBatchDelete}
                    className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                  >
                    <Trash2 className="w-3 h-3" />
                    批量删除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 大纲树 */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            <div className="flex-1 overflow-y-auto py-2">
              {rootChapters.map(chapter => (
                <ChapterNode
                  key={chapter.id}
                  chapter={chapter}
                  collapsedIds={collapsedIds}
                  onToggleExpanded={handleToggleExpanded}
                  onSelect={handleSelect}
                  isSelected={selectedChapter?.id === chapter.id}
                  isMultiSelected={selectedIds.has(chapter.id)}
                  children={childrenByParent.get(chapter.id) ?? EMPTY_CHILDREN}
                  childrenByParent={childrenByParent}
                />
              ))}

              {rootChapters.length === 0 && (
                <div className="p-6 text-center">
                  <BookOpen className="w-10 h-10 text-ink-700 mx-auto mb-3" />
                  <p className="text-sm text-ink-500 mb-3">
                    {filterStatus === 'all' ? '还没有大纲' : `没有${CHAPTER_STATUS_LABELS[filterStatus]}的章节`}
                  </p>
                  <button
                    onClick={() => addChapter(null, '全书', 0, 'book')}
                    className="btn btn-secondary text-xs"
                  >
                    <Plus className="w-3 h-3" />
                    创建大纲
                  </button>
                </div>
              )}

              {/* 新建按钮 */}
              <div className="px-2 mt-2 pb-2">
                <button
                  onClick={() => addChapter(null, '新章节', 0, 'chapter')}
                  className="w-full py-1.5 text-xs text-ink-500 hover:text-amber-400 hover:bg-ink-800/30 rounded border border-dashed border-ink-700/50 hover:border-amber-400/30 transition-colors flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  新建
                </button>
              </div>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* 详情面板 */}
      {selectedChapter && (
        <OutlineDetailPanel
          chapter={selectedChapter}
          onClose={() => { setSelectedChapter(null); setSelectedIds(new Set()); }}
          onUpdate={updateChapter}
          characters={characters}
          foreshadows={foreshadows}
        />
      )}
    </div>
  );
}