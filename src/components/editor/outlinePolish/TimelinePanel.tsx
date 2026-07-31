/**
 * 章节时间轴面板（规格书第三档-14）
 *
 * 把全部章节铺成一条横向时间轴，让创作者一眼看出：
 *   - 故事节拍的疏密（字数多寡决定列宽）
 *   - 章节状态的分布（草稿/写作/审阅/完成 的颜色带）
 *   - 关键事件的落点（keyEvents 以圆点标在章节顶部）
 *   - 伏笔埋设/回收的位置（planted/payoff 双色刻度）
 *
 * 设计意图：网格是"空间鸟瞰"，时间轴是"叙事流鸟瞰"——
 * 前者回答"有哪些章"，后者回答"故事怎么流"。
 */
import { useMemo } from 'react';
import { Clock, BookOpen, Flag, Anchor } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Section, EmptyHint } from './shared';
import type { Chapter, Foreshadow } from '@/types';
import { CHAPTER_STATUS_LABELS } from '@/types';
import { isPolishableChapter } from '@/utils/chapterUtils';

const STATUS_COLOR: Record<Chapter['status'], string> = {
  draft: 'bg-gray-500/60',
  writing: 'bg-amber-500/60',
  reviewing: 'bg-blue-500/60',
  done: 'bg-emerald-500/60',
};

const STATUS_BORDER: Record<Chapter['status'], string> = {
  draft: 'border-gray-500/40',
  writing: 'border-amber-500/40',
  reviewing: 'border-blue-500/40',
  done: 'border-emerald-500/40',
};

export function TimelinePanel() {
  const chapters = useAppStore(s => s.chapters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);

  const mainChapters = useMemo(
    () => chapters.filter(c => isPolishableChapter(c)).sort((a, b) => a.order - b.order),
    [chapters],
  );

  // 伏笔埋设/回收章节映射：用于在时间轴上标刻度
  const foreshadowMarks = useMemo(() => {
    const planted = new Map<string, Foreshadow[]>();
    const paidOff = new Map<string, Foreshadow[]>();
    for (const f of foreshadows) {
      if (f.plantedChapterId) {
        const arr = planted.get(f.plantedChapterId) || [];
        arr.push(f);
        planted.set(f.plantedChapterId, arr);
      }
      if (f.payoffChapterId) {
        const arr = paidOff.get(f.payoffChapterId) || [];
        arr.push(f);
        paidOff.set(f.payoffChapterId, arr);
      }
    }
    return { planted, paidOff };
  }, [foreshadows]);

  // 列宽按字数加权：保证最小宽度可读，最大宽度不挤占他人
  const layout = useMemo(() => {
    if (mainChapters.length === 0) return { items: [], totalWords: 0 };
    const totalWords = mainChapters.reduce((s, c) => s + Math.max(c.wordCount, 1), 0);
    const items = mainChapters.map(c => ({
      chapter: c,
      // 字数占比 → 百分比宽度，最小 4% 保证可点击，最大 18% 避免一章独占
      widthPercent: Math.min(18, Math.max(4, (Math.max(c.wordCount, 1) / totalWords) * 100)),
    }));
    return { items, totalWords };
  }, [mainChapters]);

  if (mainChapters.length === 0) {
    return <EmptyHint icon={Clock} text="还没有正文章节，时间轴空空如也" />;
  }

  const doneCount = mainChapters.filter(c => c.status === 'done').length;
  const totalEvents = mainChapters.reduce((s, c) => s + (c.keyEvents?.length || 0), 0);

  return (
    <Section
      icon={Clock}
      title="章节时间轴"
      desc="故事流的横向鸟瞰 · 列宽=字数 · 圆点=关键事件"
      action={
        <div className="flex items-center gap-2 text-[10px] text-ink-500">
          <span>{mainChapters.length} 章</span>
          <span>· {doneCount} 完成</span>
          <span>· {totalEvents} 事件</span>
        </div>
      }
    >
      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-500 px-1">
        {(Object.keys(STATUS_COLOR) as Chapter['status'][]).map(s => (
          <span key={s} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-sm ${STATUS_COLOR[s]}`} />
            {CHAPTER_STATUS_LABELS[s]}
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2">
          <Flag className="w-2.5 h-2.5 text-cyan-400" />伏笔埋设
        </span>
        <span className="flex items-center gap-1">
          <Anchor className="w-2.5 h-2.5 text-emerald-400" />伏笔回收
        </span>
      </div>

      {/* 时间轴主体：横向滚动，每章一列 */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-0.5 min-w-full" style={{ minWidth: `${mainChapters.length * 60}px` }}>
          {layout.items.map(({ chapter, widthPercent }) => {
            const isActive = chapter.id === currentChapterId;
            const events = chapter.keyEvents || [];
            const planted = foreshadowMarks.planted.get(chapter.id) || [];
            const paidOff = foreshadowMarks.paidOff.get(chapter.id) || [];
            return (
              <button
                key={chapter.id}
                onClick={() => setCurrentChapter(chapter.id)}
                className={`relative flex flex-col rounded-md border ${STATUS_BORDER[chapter.status]} ${isActive ? 'ring-1 ring-amber-400/60' : ''} bg-ink-800/30 hover:bg-ink-700/40 transition-colors overflow-hidden group`}
                style={{ width: `${widthPercent}%`, minWidth: '48px' }}
                title={`第${chapter.order + 1}章 · ${chapter.title}（${chapter.wordCount}字）`}
              >
                {/* 章节序号 */}
                <div className="text-[9px] text-ink-600 font-mono text-center pt-1">
                  {chapter.order + 1}
                </div>

                {/* 伏笔刻度行 */}
                <div className="flex items-center justify-center gap-0.5 h-3 px-0.5">
                  {planted.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[8px] text-cyan-400" title={`埋设 ${planted.length} 条伏笔`}>
                      <Flag className="w-2 h-2" />
                      {planted.length > 1 && planted.length}
                    </span>
                  )}
                  {paidOff.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[8px] text-emerald-400" title={`回收 ${paidOff.length} 条伏笔`}>
                      <Anchor className="w-2 h-2" />
                      {paidOff.length > 1 && paidOff.length}
                    </span>
                  )}
                </div>

                {/* 关键事件圆点 */}
                <div className="flex flex-wrap items-center justify-center gap-0.5 h-4 px-0.5">
                  {events.slice(0, 5).map((_, idx) => (
                    <span
                      key={idx}
                      className="w-1 h-1 rounded-full bg-amber-400/70"
                      title={events[idx]}
                    />
                  ))}
                  {events.length > 5 && (
                    <span className="text-[8px] text-ink-500">+{events.length - 5}</span>
                  )}
                </div>

                {/* 状态色带：高度按字数占比填充，直观反映"这章有多重" */}
                <div
                  className={`flex-1 ${STATUS_COLOR[chapter.status]} opacity-70 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-1`}
                  style={{ minHeight: '24px' }}
                >
                  <span className="text-[8px] text-ink-100/80 font-medium">
                    {chapter.wordCount > 0 ? `${(chapter.wordCount / 1000).toFixed(1)}k` : '—'}
                  </span>
                </div>

                {/* 章节标题（旋转 90° 省空间） */}
                <div className="px-1 py-1 text-[9px] text-ink-400 truncate text-center" title={chapter.title}>
                  {chapter.title}
                </div>

                {/* 当前章节高亮顶条 */}
                {isActive && (
                  <span className="absolute top-0 left-0 right-0 h-0.5 bg-amber-400" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 伏笔跨度概览：埋设 → 回收 的连线表 */}
      {foreshadows.length > 0 && layout.items.length > 0 && (
        <ForeshadowSpans
          foreshadows={foreshadows}
          chapters={mainChapters}
        />
      )}

      {/* 空态：有章节但无事件/伏笔 */}
      {totalEvents === 0 && foreshadows.length === 0 && (
        <div className="text-center text-[11px] text-ink-600 italic pt-2">
          <BookOpen className="w-4 h-4 inline-block mr-1" />
          尚未标记关键事件与伏笔——去节拍编辑器或伏笔看板补充，时间轴会更丰满
        </div>
      )}
    </Section>
  );
}

/**
 * 伏笔跨度表：列出每条伏笔从埋设章到回收章的跨度，按跨度降序。
 * 跨度越长（埋得越久）越需要关注读者记忆衰减。
 */
function ForeshadowSpans({ foreshadows, chapters }: { foreshadows: Foreshadow[]; chapters: Chapter[] }) {
  const idToOrder = useMemo(() => {
    const m = new Map<string, number>();
    chapters.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [chapters]);

  const spans = useMemo(() => {
    return foreshadows
      .map(f => {
        const from = f.plantedChapterId ? idToOrder.get(f.plantedChapterId) : undefined;
        const to = f.payoffChapterId ? idToOrder.get(f.payoffChapterId) : undefined;
        const span = from !== undefined && to !== undefined ? to - from : null;
        return { f, from, to, span };
      })
      .filter(s => s.span !== null)
      .sort((a, b) => (b.span! - a.span!))
      .slice(0, 8);
  }, [foreshadows, idToOrder]);

  if (spans.length === 0) return null;

  return (
    <div className="p-2 bg-ink-800/30 rounded-lg">
      <div className="text-[10px] text-ink-400 mb-1.5 flex items-center gap-1">
        <Flag className="w-2.5 h-2.5 text-cyan-400" />
        伏笔跨度（埋设 → 回收，跨度越长越考验读者记忆）
      </div>
      <div className="space-y-1">
        {spans.map(({ f, from, to, span }) => (
          <div key={f.id} className="flex items-center gap-1.5 text-[10px]">
            <span className="text-ink-300 w-24 truncate" title={f.title}>{f.title}</span>
            <span className="text-cyan-400 shrink-0">第{(from || 0) + 1}章</span>
            <span className="flex-1 h-px bg-gradient-to-r from-cyan-500/40 to-emerald-500/40 relative">
              {span! > 5 && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] text-amber-400">
                  {span}章
                </span>
              )}
            </span>
            <span className="text-emerald-400 shrink-0">第{(to || 0) + 1}章</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TimelinePanel;
