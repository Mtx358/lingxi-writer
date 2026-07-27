import { useState, useRef, useEffect, memo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  MoreHorizontal,
  Trash2,
  Edit3,
  GripVertical,
  Sparkles,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import { useClickOutside } from '@/hooks/useClickOutside';
import { aiService } from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { confirm } from '@/hooks/useConfirm';
import { CHAPTER_MAX_LEVEL } from '@/constants/config';
import type { Chapter, ChapterLevelType } from '@/types';
import {
  CHAPTER_STATUS_COLORS,
  CHAPTER_STATUS_LABELS,
  CHAPTER_LEVEL_TYPE_LABELS,
  CHAPTER_LEVEL_TYPE_COLORS,
} from '@/types';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LEVEL_ICONS, EMPTY_CHILDREN } from './chapterConstants';

/**
 * 大纲树的单个章节节点。
 *
 * 自包含：拖拽手柄、折叠/展开三角、LevelIcon、标题（双击编辑）、字数、
 * 添加菜单（同级/子级）、更多菜单（重命名/AI 推荐标题/状态切换/删除）。
 *
 * 子节点由父组件（OutlinePanel）预先过滤并按 order 排序后传入，避免每个
 * ChapterNode 都订阅全量 chapters。全树共享的 childrenByParent 映射用于递归
 * 渲染深层子节点，引用稳定，配合 memo 跳过未变节点避免全树重渲染。
 */
function ChapterNodeComponent({
  chapter,
  depth = 0,
  collapsedIds,
  onToggleExpanded,
  onSelect,
  isSelected,
  isMultiSelected = false,
  children,
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
  // 4 个章节操作 action 集中订阅：useShallow 浅比较返回稳定引用，
  // 单次 store 变更只触发一次 selector 计算，避免 4 个独立订阅的开销。
  // 这些 action 是 Zustand 创建时即固化的稳定函数，浅比较永远命中缓存。
  const { updateChapter, deleteChapter, addChapter, setCurrentChapter } = useAppStore(
    useShallow(s => ({
      updateChapter: s.updateChapter,
      deleteChapter: s.deleteChapter,
      addChapter: s.addChapter,
      setCurrentChapter: s.setCurrentChapter,
    })),
  );
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chapter.title);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  // 灵犀写作：AI 章节标题推荐
  const [titleSuggestions, setTitleSuggestions] = useState<string[] | null>(null);
  const [titleLoading, setTitleLoading] = useState(false);
  // AI 标题请求 AbortController：菜单关闭/章节切换时主动中止，避免无用请求与卸载后 setState
  const titleAbortRef = useRef<AbortController | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(addMenuRef, () => setShowAddMenu(false), showAddMenu);
  useClickOutside(moreMenuRef, () => setShowMenu(false), showMenu);

  // 菜单关闭时清空 titleSuggestions：避免下次打开菜单时残留上次未应用的旧建议
  useEffect(() => {
    if (!showMenu) {
      setTitleSuggestions(null);
      // 菜单关闭时中止进行中的标题请求
      titleAbortRef.current?.abort();
      titleAbortRef.current = null;
    }
  }, [showMenu]);

  // 章节节点卸载时中止请求，防止 setState 落在已卸载组件
  useEffect(() => {
    return () => {
      titleAbortRef.current?.abort();
    };
  }, []);

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

  // 灵犀写作：AI 章节标题推荐——基于章节摘要/正文前 600 字生成 3 个候选
  const handleSuggestTitle = async () => {
    if (titleLoading) return;
    // 生成 abort token：菜单关闭/卸载时会 abort，本 token 也用于在 await 后判断是否仍有效
    titleAbortRef.current?.abort();
    const ac = new AbortController();
    titleAbortRef.current = ac;
    setTitleLoading(true);
    setTitleSuggestions(null);
    try {
      const suggestions = await aiService.generateChapterTitleSuggestions(chapter);
      // 菜单已关闭或组件已卸载，丢弃结果
      if (ac.signal.aborted) return;
      if (suggestions.length === 0) {
        toast.info('暂无推荐', '章节内容过少，无法生成标题建议');
      } else {
        setTitleSuggestions(suggestions);
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg = getErrorMessage(e);
      toast.error('AI 推荐标题失败', msg);
    } finally {
      if (!ac.signal.aborted) setTitleLoading(false);
    }
  };

  const handleApplyTitle = (title: string) => {
    updateChapter(chapter.id, { title });
    setTitleSuggestions(null);
    setShowMenu(false);
    toast.success('已应用新标题', title);
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
          aria-label="拖拽排序"
        >
          <GripVertical className="w-4 h-4" aria-hidden="true" />
        </button>

        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpanded(chapter.id); }}
            aria-label={expanded ? '折叠子章节' : '展开子章节'}
            aria-expanded={expanded}
            className="w-4 h-4 flex items-center justify-center text-ink-500 hover:text-ink-300 flex-shrink-0"
          >
            {expanded ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
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
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); setShowMenu(false); }}
              className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-700/50"
              title="添加"
              aria-label="添加章节"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
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
              aria-label="更多操作"
            >
              <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
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
                <button
                  onClick={(e) => { e.stopPropagation(); handleSuggestTitle(); }}
                  disabled={titleLoading}
                  className="w-full px-3 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50 flex items-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  {titleLoading ? '生成中…' : 'AI 推荐标题'}
                </button>
                {titleSuggestions && titleSuggestions.length > 0 && (
                  <div className="px-2 py-1 space-y-0.5">
                    {titleSuggestions.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => { e.stopPropagation(); handleApplyTitle(s); }}
                        className="w-full px-2 py-1 text-[11px] text-left text-amber-300 hover:bg-amber-400/10 rounded writing-font truncate"
                        title={s}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
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
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirm(`确定删除"${chapter.title}"吗？`)) {
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
        // content-visibility: auto 让浏览器跳过离屏子树的渲染与布局，
        // 显著降低 100+ 章展开时的绘制与 reflow 成本；containIntrinsicSize
        // 提供占位高度避免滚动条抖动，'auto' 前缀会记住上次实际尺寸以减少回跳。
        // 仅作用于子树容器，行本身始终渲染以保证 dnd-kit 拖拽测量准确。
        <div
          style={{
            contentVisibility: 'auto',
            containIntrinsicSize: 'auto 40px',
          }}
        >
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

export default ChapterNode;
