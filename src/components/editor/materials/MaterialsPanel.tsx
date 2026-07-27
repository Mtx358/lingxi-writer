import { useState, useRef, useMemo, useEffect } from 'react';
import { Plus, Lightbulb } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { MATERIAL_TYPE_LABELS, MATERIAL_TYPES, DEFAULT_MATERIAL_TYPE } from '@/types';
import type { Material } from '@/types';
import Empty from '@/components/Empty';
import { TYPE_COLORS, VIRTUALIZATION_THRESHOLD, INITIAL_BATCH, BATCH_SIZE } from './constants';
import { MemoizedMaterialItem } from './MaterialItem';
import { MaterialForm } from './MaterialForm';
import { QuestionDrawer } from './QuestionDrawer';
import { useMaterialsActions } from './useMaterialsActions';

export default function MaterialsPanel() {
  const materials = useAppStore(s => s.materials);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<'all' | Material['type']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<Material['type']>(DEFAULT_MATERIAL_TYPE);
  // 分批渲染状态：列表超阈值时仅挂载前 N 个，IntersectionObserver 触发后续批次
  const [renderCount, setRenderCount] = useState(INITIAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    questionTargetId,
    questions,
    asking,
    answers,
    onAnswerChange,
    closeQuestionDrawer,
    handleAskQuestion,
    handleSpawnChild,
    handleAdd,
    handleAddAttachment,
    handleOpenAttachment,
    handleRemoveAttachment,
    handleToggleExpand,
    handleTogglePinned,
  } = useMaterialsActions({
    newTitle,
    newType,
    setNewTitle,
    setShowAdd,
    setExpandedId,
  });

  // 注意：必须先复制再 sort，否则会原地修改 store 数组，引发 zustand 选择器引用不变
  // 从而导致下游组件无法感知变更、且污染全局状态。
  // M4 性能修复：useMemo 避免每次 render 重算 sort（O(M log M) per render）
  const filtered = useMemo(() => {
    const sortByPinnedAndTime = (a: Material, b: Material) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    };
    return filter === 'all'
      ? [...materials].sort(sortByPinnedAndTime)
      : materials.filter(m => m.type === filter).sort(sortByPinnedAndTime);
  }, [materials, filter]);

  // 筛选切换时重置分批渲染计数，避免新列表沿用旧的截断位置
  useEffect(() => {
    setRenderCount(INITIAL_BATCH);
  }, [filter]);

  // IntersectionObserver：列表超阈值时分批挂载后续批次（进入视口才渲染）
  // jsdom 等无 IntersectionObserver 的环境降级为全量渲染，不影响测试
  useEffect(() => {
    const total = filtered.length;
    if (total <= VIRTUALIZATION_THRESHOLD) return;
    if (renderCount >= total) return;
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setRenderCount(c => Math.min(c + BATCH_SIZE, total));
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [filtered.length, renderCount]);

  const isVirtualized = filtered.length > VIRTUALIZATION_THRESHOLD;
  const visibleItems = isVirtualized ? filtered.slice(0, Math.min(renderCount, filtered.length)) : filtered;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200">素材库</span>
        <button
          onClick={() => setShowAdd(true)}
          aria-label="新建素材"
          className="p-1 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {showAdd && (
        <MaterialForm
          title={newTitle}
          type={newType}
          onTitleChange={setNewTitle}
          onTypeChange={setNewType}
          onAdd={handleAdd}
          onCancel={() => { setShowAdd(false); setNewTitle(''); }}
        />
      )}

      {/* Type Filter */}
      <div className="flex gap-1 p-2 border-b border-ink-800/50 overflow-x-auto">
        <button
          onClick={() => setFilter('all')}
          className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
            filter === 'all'
              ? 'bg-ink-700 text-ink-200'
              : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800'
          }`}
        >
          全部 ({materials.length})
        </button>
        {MATERIAL_TYPES.map(type => {
          const count = materials.filter(m => m.type === type).length;
          if (count === 0) return null;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                filter === type
                  ? `${TYPE_COLORS[type]}`
                  : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800'
              }`}
            >
              {MATERIAL_TYPE_LABELS[type]} ({count})
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filtered.length === 0 ? (
          <Empty
            icon={<Lightbulb className="w-8 h-8 text-ink-600" />}
            title="暂无素材"
            description="收集灵感、参考、研究笔记"
            className="p-6"
          />
        ) : (
          <>
            {visibleItems.map(mat => (
              <MemoizedMaterialItem
                key={mat.id}
                mat={mat}
                isExpanded={expandedId === mat.id}
                onToggleExpand={handleToggleExpand}
                onTogglePinned={handleTogglePinned}
                onAsk={handleAskQuestion}
                onAddAttachment={handleAddAttachment}
                onOpenAttachment={handleOpenAttachment}
                onRemoveAttachment={handleRemoveAttachment}
              />
            ))}
            {isVirtualized && renderCount < filtered.length && (
              <div ref={sentinelRef} className="h-1" aria-hidden="true" />
            )}
          </>
        )}
      </div>

      {/* 卡片促活：深度提问 drawer */}
      <QuestionDrawer
        questionTargetId={questionTargetId}
        questions={questions}
        asking={asking}
        answers={answers}
        onAnswerChange={onAnswerChange}
        onClose={closeQuestionDrawer}
        onSpawnChild={handleSpawnChild}
      />
    </div>
  );
}
