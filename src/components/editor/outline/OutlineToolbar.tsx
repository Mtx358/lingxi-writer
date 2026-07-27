import { useRef } from 'react';
import { BookMarked, Filter, CheckSquare, Merge, Trash2 } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { Chapter } from '@/types';
import { CHAPTER_STATUS_LABELS } from '@/types';

/**
 * 大纲顶部统计栏 + 筛选/批量操作栏。
 *
 * 拆分自原 OutlinePanel.tsx 的两行 header：
 *   - 统计栏：BookMarked 图标 + "大纲" 标题 + 已选 N badge + 卷/部/章/字数
 *   - 筛选栏：状态下拉 + 批量操作菜单（合并/删除）
 *
 * 批量菜单的 clickOutside 关闭由本组件内部 useClickOutside 处理。
 */
export interface OutlineToolbarProps {
  selectedCount: number;
  filterStatus: Chapter['status'] | 'all';
  onFilterStatusChange: (status: Chapter['status'] | 'all') => void;
  stats: { volumes: number; parts: number; sections: number; chapters: number };
  totalWordCount: number;
  showBatchMenu: boolean;
  onToggleBatchMenu: () => void;
  onCloseBatchMenu: () => void;
  onBatchMerge: () => void;
  onBatchDelete: () => void;
}

export default function OutlineToolbar({
  selectedCount,
  filterStatus,
  onFilterStatusChange,
  stats,
  totalWordCount,
  showBatchMenu,
  onToggleBatchMenu,
  onCloseBatchMenu,
  onBatchMerge,
  onBatchDelete,
}: OutlineToolbarProps) {
  const batchMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(batchMenuRef, onCloseBatchMenu, showBatchMenu);

  return (
    <>
      {/* 统计栏 */}
      <div className="px-3 py-2 border-b border-ink-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookMarked className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-ink-100">大纲</span>
          {selectedCount > 0 && (
            <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              已选 {selectedCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-ink-500">
          <span>{stats.volumes}卷</span>
          <span>{stats.parts}部</span>
          <span>{stats.chapters}章</span>
          <span className="text-amber-400">{totalWordCount}字</span>
        </div>
      </div>

      {/* 筛选和批量操作栏 */}
      <div className="px-3 py-1.5 border-b border-ink-800/50 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-ink-500" />
          <select
            value={filterStatus}
            onChange={(e) => onFilterStatusChange(e.target.value as Chapter['status'] | 'all')}
            className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1.5 py-0.5 text-ink-300 outline-none focus:border-amber-400/50"
          >
            <option value="all">全部状态</option>
            {Object.entries(CHAPTER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        {selectedCount > 0 && (
          <div className="relative" ref={batchMenuRef}>
            <button
              onClick={onToggleBatchMenu}
              className="text-[10px] text-ink-400 hover:text-amber-400 flex items-center gap-1"
            >
              <CheckSquare className="w-3 h-3" />
              批量操作
            </button>
            {showBatchMenu && (
              <div className="absolute right-0 top-full mt-1 bg-ink-800 border border-ink-700 rounded-md shadow-medium py-1 z-20 min-w-28">
                {/* 批量移动入口暂时隐藏：批量多节点拖拽尚未实现，避免误导用户 */}
                <button
                  onClick={onBatchMerge}
                  className="w-full px-3 py-1.5 text-xs text-left text-ink-200 hover:bg-ink-700/50 flex items-center gap-2"
                >
                  <Merge className="w-3 h-3" />
                  合并章节
                </button>
                <div className="my-1 h-px bg-ink-700/50" />
                <button
                  onClick={onBatchDelete}
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
    </>
  );
}
