import { useState, useMemo, useCallback } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter } from '@/types';
import { CHAPTER_STATUS_LABELS } from '@/types';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import Empty from '@/components/Empty';
import ChapterNode from './ChapterNode';
import { EMPTY_CHILDREN } from './chapterConstants';
import OutlineDetailPanel from './OutlineDetailPanel';
import OutlineToolbar from './OutlineToolbar';
import { useOutlineDrag } from './useOutlineDrag';
import { useOutlineSelection } from './useOutlineSelection';

/**
 * 大纲面板（灵犀写作）。
 *
 * 主组件负责：
 *   - chapters/characters/foreshadows 的 store 订阅
 *   - childrenByParent 全树共享映射（useMemo 稳定引用，避免 ChapterNode memo 失效）
 *   - visibleIds 计算（折叠态过滤）
 *   - collapsedIds / selectedChapter / selectedIds / filterStatus / showBatchMenu 状态
 *   - DndContext 包裹的树容器 + 空状态 + 底部新建按钮
 *   - 选中章节时右侧 OutlineDetailPanel 滑出
 *
 * 子组件：ChapterNode（树节点）/ OutlineDetailPanel（详情面板）/ OutlineToolbar（统计+筛选+批量）。
 * 拖拽逻辑抽到 useOutlineDrag；选择/批量抽到 useOutlineSelection。
 */
export default function OutlinePanel() {
  // 8 个字段集中订阅：useShallow 浅比较，任一字段变化才触发重渲染。
  // chapters/characters/foreshadows 为数据字段（数组引用变化时重渲染），
  // 其余 5 个为 Zustand 创建即固化的稳定 action，浅比较命中缓存不触发多余渲染。
  const {
    chapters,
    addChapter,
    moveChapter,
    updateChapter,
    deleteChapter,
    saveVersion,
    characters,
    foreshadows,
  } = useAppStore(
    useShallow(s => ({
      chapters: s.chapters,
      addChapter: s.addChapter,
      moveChapter: s.moveChapter,
      updateChapter: s.updateChapter,
      deleteChapter: s.deleteChapter,
      saveVersion: s.saveVersion,
      characters: s.characters,
      foreshadows: s.foreshadows,
    })),
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<Chapter['status'] | 'all'>('all');
  const [showBatchMenu, setShowBatchMenu] = useState(false);

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

  const handleDragEnd = useOutlineDrag({
    chapters,
    visibleIds,
    moveChapter,
    setCollapsedIds,
  });

  const { handleSelect, handleBatchDelete, handleBatchMerge } = useOutlineSelection({
    chapters,
    selectedIds,
    setSelectedIds,
    setSelectedChapter,
    updateChapter,
    deleteChapter,
    saveVersion,
    setShowBatchMenu,
  });

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

  const isEmpty = rootChapters.length === 0;
  const emptyTitle = filterStatus === 'all'
    ? '还没有大纲'
    : `没有${CHAPTER_STATUS_LABELS[filterStatus]}的章节`;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <OutlineToolbar
          selectedCount={selectedIds.size}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          stats={stats}
          totalWordCount={getTotalWordCount}
          showBatchMenu={showBatchMenu}
          onToggleBatchMenu={() => setShowBatchMenu(!showBatchMenu)}
          onCloseBatchMenu={() => setShowBatchMenu(false)}
          onBatchMerge={handleBatchMerge}
          onBatchDelete={handleBatchDelete}
        />

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

              {isEmpty && (
                <Empty
                  icon={<BookOpen className="w-10 h-10 text-ink-700" />}
                  title={emptyTitle}
                  className="p-6"
                  action={
                    <button
                      onClick={() => addChapter(null, '全书', 0, 'book')}
                      className="btn btn-secondary text-xs"
                    >
                      <Plus className="w-3 h-3" />
                      创建大纲
                    </button>
                  }
                />
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
