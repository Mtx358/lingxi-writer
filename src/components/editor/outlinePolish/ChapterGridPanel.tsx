/**
 * 章节卡片网格（规格书第三阶段 / 第三档-16 卡片拖拽）
 *
 * 以卡片网格形式鸟瞰全部章节，让创作者在进入单章节拍编辑前先把握全局：
 *   - 每张卡片展示：序号 / 标题 / 状态 / 字数 / 张力·情感指标 / 伏笔密度
 *   - 点击卡片选中章节（setCurrentChapter），高亮当前章节
 *   - 拖拽卡片可重排章节顺序（HTML5 DnD，松手后 batchUpdateChapterOrder）
 *   - 指标数据来自最近一次诊断报告（pacingCurve / emotionCurve / foreshadowDensity），
 *     无报告时仅展示基础信息（标题/状态/字数），不阻塞浏览
 *
 * 设计意图：把"选章节"从下拉框升级为可视网格，降低定位成本；拖拽重排让结构
 * 调整从"改 order 字段"升级为"伸手挪一张卡片"。
 */
import { useMemo, useState, useCallback } from 'react';
import { BookOpen, FileText, GripVertical } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import type { Chapter, OutlinePolishReport } from '@/types';
import { CHAPTER_STATUS_LABELS } from '@/types';

/** 章节状态对应的圆点颜色 */
const STATUS_DOT: Record<Chapter['status'], string> = {
  draft: 'bg-gray-400',
  writing: 'bg-amber-400',
  reviewing: 'bg-blue-400',
  done: 'bg-emerald-400',
};

export function ChapterGridPanel({
  chapters,
  currentChapterId,
  onSelectChapter,
  report,
}: {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (id: string) => void;
  report: OutlinePolishReport | null;
}) {
  const batchUpdateChapterOrder = useAppStore(s => s.batchUpdateChapterOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // 将报告中的曲线/密度数据按 chapterId 索引，便于卡片快速查找
  const metrics = useMemo(() => {
    const tensionMap = new Map<string, number>();
    const emotionMap = new Map<string, number>();
    const foreshadowMap = new Map<string, { planted: number; progressing: number; paidOff: number }>();
    if (report) {
      for (const p of report.pacingCurve) tensionMap.set(p.chapterId, p.tension);
      for (const e of report.emotionCurve) emotionMap.set(e.chapterId, e.emotion);
      for (const f of report.foreshadowDensity) {
        foreshadowMap.set(f.chapterId, { planted: f.planted, progressing: f.progressing, paidOff: f.paidOff });
      }
    }
    return { tensionMap, emotionMap, foreshadowMap };
  }, [report]);

  // 按章节 order 排序 + 总字数：useMemo 收敛，避免每次 render 重算 sort + reduce。
  // 必须在 early return 之前调用（Rules of Hooks）；chapters 为空时 sort 开销可忽略
  const sorted = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);
  const totalWords = useMemo(() => sorted.reduce((s, c) => s + c.wordCount, 0), [sorted]);

  // 拖拽落点：把 dragId 对应的章节挪到 overId 对应章节的位置，重排 order。
  // 使用 stable 排序避免相同 order 时位置抖动；松手时一次性 batchUpdateChapterOrder。
  const handleDrop = useCallback(() => {
    if (!dragId || !overId || dragId === overId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const fromIdx = sorted.findIndex(c => c.id === dragId);
    const toIdx = sorted.findIndex(c => c.id === overId);
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const next = [...sorted];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // 仅当 order 实际变化时提交，避免无谓的 markDirty
    const updates = next
      .map((c, idx) => ({ id: c.id, order: idx }))
      .filter(u => sorted.find(c => c.id === u.id)?.order !== u.order);
    if (updates.length > 0) {
      batchUpdateChapterOrder(updates);
      toast.success('章节顺序已更新', `「${moved.title}」已挪到第 ${toIdx + 1} 位`);
    }
    setDragId(null);
    setOverId(null);
  }, [dragId, overId, sorted, batchUpdateChapterOrder]);

  if (chapters.length === 0) {
    return (
      <div className="text-center py-8">
        <BookOpen className="w-10 h-10 text-ink-600 mx-auto mb-2" />
        <p className="text-sm text-ink-500">暂无章节</p>
        <p className="text-xs text-ink-600">在大纲编辑器中创建章节后，这里会以卡片网格展示全貌。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 全局统计条 */}
      <div className="p-2 bg-ink-800/30 rounded-lg flex items-center gap-2 text-[11px] flex-wrap">
        <span className="px-2 py-0.5 bg-ink-700/40 rounded flex items-center gap-1">
          <span className="text-ink-500">共</span>
          <span className="text-ink-100 font-medium">{sorted.length}</span>
          <span className="text-ink-500">章</span>
        </span>
        <span className="px-2 py-0.5 bg-ink-700/40 rounded flex items-center gap-1">
          <span className="text-ink-500">总字数</span>
          <span className="text-ink-100 font-medium">{totalWords.toLocaleString()}</span>
        </span>
        {report && (
          <span className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded text-cyan-300">
            含诊断指标
          </span>
        )}
        <span className="ml-auto text-ink-600">点击选中 · 拖拽手柄重排</span>
      </div>

      {/* 卡片网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {sorted.map(chapter => {
          const tension = metrics.tensionMap.get(chapter.id);
          const emotion = metrics.emotionMap.get(chapter.id);
          const fore = metrics.foreshadowMap.get(chapter.id);
          const isActive = chapter.id === currentChapterId;
          const isDragging = chapter.id === dragId;
          const isOver = chapter.id === overId;
          return (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              isActive={isActive}
              tension={tension}
              emotion={emotion}
              foreshadow={fore}
              isDragging={isDragging}
              isOver={isOver}
              onClick={() => onSelectChapter(chapter.id)}
              onDragStart={() => setDragId(chapter.id)}
              onDragOver={(e) => { e.preventDefault(); setOverId(chapter.id); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChapterCard({
  chapter,
  isActive,
  tension,
  emotion,
  foreshadow,
  isDragging,
  isOver,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  chapter: Chapter;
  isActive: boolean;
  tension?: number;
  emotion?: number;
  foreshadow?: { planted: number; progressing: number; paidOff: number };
  isDragging: boolean;
  isOver: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      aria-label={`第${chapter.order + 1}章 ${chapter.title}，按回车选中`}
      className={`relative text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
        isActive
          ? 'border-cyan-400/60 bg-cyan-500/10 ring-1 ring-cyan-400/40'
          : isOver
            ? 'border-amber-400/60 bg-amber-500/10'
            : 'border-ink-700/50 bg-ink-800/40 hover:bg-ink-700/40 hover:border-ink-600'
      } ${isDragging ? 'opacity-40' : ''}`}
      data-testid={`chapter-card-${chapter.id}`}
    >
      {/* 拖拽手柄：左上角竖纹，hover 时高亮，提示可拖 */}
      <span
        className="absolute top-1 right-1 text-ink-700 hover:text-ink-400 cursor-grab active:cursor-grabbing"
        aria-hidden="true"
        title="拖拽重排"
      >
        <GripVertical className="w-3 h-3" />
      </span>

      {/* 头部：序号 + 标题 + 状态 */}
      <div className="flex items-start gap-1.5 mb-1.5 pr-4">
        <span className="text-[10px] text-ink-600 font-mono mt-0.5 flex-shrink-0">
          {String(chapter.order).padStart(2, '0')}
        </span>
        <span className="text-xs text-ink-100 font-medium flex-1 line-clamp-2 leading-tight">
          {chapter.title}
        </span>
      </div>

      {/* 状态 + 字数 */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="flex items-center gap-1 text-[10px] text-ink-400">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[chapter.status]}`} />
          {CHAPTER_STATUS_LABELS[chapter.status]}
        </span>
        <span className="text-[10px] text-ink-500 flex items-center gap-0.5">
          <FileText className="w-2.5 h-2.5" />
          {chapter.wordCount.toLocaleString()}
        </span>
      </div>

      {/* 诊断指标：张力 / 情感（仅有报告时显示） */}
      {(tension !== undefined || emotion !== undefined) && (
        <div className="space-y-1 mb-1">
          {tension !== undefined && <MetricBar label="张力" value={tension} color="bg-amber-400" />}
          {emotion !== undefined && <MetricBar label="情感" value={emotion} color="bg-purple-400" />}
        </div>
      )}

      {/* 伏笔密度 */}
      {foreshadow && (foreshadow.planted + foreshadow.progressing + foreshadow.paidOff) > 0 && (
        <div className="flex items-center gap-1 text-[9px] text-ink-500">
          <span className="text-ink-600">伏笔：</span>
          {foreshadow.planted > 0 && <span className="text-ink-400">{foreshadow.planted}埋</span>}
          {foreshadow.progressing > 0 && <span className="text-cyan-400">{foreshadow.progressing}进</span>}
          {foreshadow.paidOff > 0 && <span className="text-emerald-400">{foreshadow.paidOff}收</span>}
        </div>
      )}
    </div>
  );
}

/** 指标条：0-100 数值可视化 */
function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-ink-500 w-6 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-ink-700/50 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="text-[9px] text-ink-400 w-6 text-right flex-shrink-0">{Math.round(value)}</span>
    </div>
  );
}
