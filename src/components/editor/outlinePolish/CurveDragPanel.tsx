/**
 * 曲线拖拽面板（规格书第三档-15）
 *
 * 让创作者"画"出想要的张力/情感曲线，再对照诊断实际值，一目了然哪里没达到预期。
 *   - 上方 SVG 曲线：实线=目标（可拖拽），虚线=实际（来自诊断报告，只读）
 *   - 拖动圆点上下移动即设定该章的目标值，松手写回 chapter.targetTension/targetEmotion
 *   - 下方差距条：目标 vs 实际的差值，正=实际不足需加强，负=实际过头需收束
 *
 * 设计意图：把"这章该有多紧张"从模糊感觉变成可量化的设计意图，
 * 写作时就有据可依，而非写到哪算哪。
 */
import { useState, useMemo, useRef, useCallback } from 'react';
import { Activity, TrendingUp, Heart, RotateCcw, Info } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Section, EmptyHint } from './shared';
import { toast } from '@/hooks/useToast';

type CurveKind = 'tension' | 'emotion';

const CURVE_META: Record<CurveKind, { label: string; icon: typeof Activity; color: string; field: 'targetTension' | 'targetEmotion'; actualKey: 'pacingCurve' | 'emotionCurve' }> = {
  tension: {
    label: '张力曲线', icon: TrendingUp, color: '#f59e0b',
    field: 'targetTension', actualKey: 'pacingCurve',
  },
  emotion: {
    label: '情感曲线', icon: Heart, color: '#ec4899',
    field: 'targetEmotion', actualKey: 'emotionCurve',
  },
};

const SVG_HEIGHT = 180;
const SVG_PADDING = { top: 16, right: 16, bottom: 28, left: 32 };

export function CurveDragPanel() {
  const chapters = useAppStore(s => s.chapters);
  const report = useAppStore(s => s.lastOutlineReport);
  const updateChapter = useAppStore(s => s.updateChapter);
  const recordPolishAction = useAppStore(s => s.recordPolishAction);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);

  const [curveKind, setCurveKind] = useState<CurveKind>('tension');
  const svgRef = useRef<SVGSVGElement>(null);

  const mainChapters = useMemo(
    () => chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order),
    [chapters],
  );

  // 实际值映射（来自诊断报告）
  const actualMap = useMemo(() => {
    const m = new Map<string, number>();
    if (report) {
      if (curveKind === 'tension') {
        for (const p of report.pacingCurve) m.set(p.chapterId, p.tension);
      } else {
        for (const p of report.emotionCurve) m.set(p.chapterId, p.emotion);
      }
    }
    return m;
  }, [report, curveKind]);

  // 目标值数组：未设置时用实际值兜底，都没有则 50
  const targetValues = useMemo(() => {
    return mainChapters.map(c => {
      const target = c[CURVE_META[curveKind].field];
      if (typeof target === 'number') return target;
      const actual = actualMap.get(c.id);
      if (typeof actual === 'number') return actual;
      return 50;
    });
  }, [mainChapters, curveKind, actualMap]);

  // 拖拽中：记录当前正在拖的章节下标，松手时写回
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // SVG 坐标 → 数值（0-100）：基于 SVG 高度与 padding 反算
  const pointToValue = useCallback((clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return 50;
    const rect = svg.getBoundingClientRect();
    const yInSvg = clientY - rect.top;
    const plotHeight = SVG_HEIGHT - SVG_PADDING.top - SVG_PADDING.bottom;
    const yInPlot = yInSvg - SVG_PADDING.top;
    // 顶部=100，底部=0
    const raw = 100 - (yInPlot / plotHeight) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingIdx === null) return;
    const val = pointToValue(e.clientY);
    const ch = mainChapters[draggingIdx];
    if (!ch) return;
    // 实时更新视觉：先写回 store，避免拖动卡顿（store 更新是同步的）
    updateChapter(ch.id, { [CURVE_META[curveKind].field]: val });
  }, [draggingIdx, mainChapters, pointToValue, updateChapter, curveKind]);

  const handlePointerUp = useCallback(() => {
    if (draggingIdx !== null) {
      recordPolishAction('pacing');
      setDraggingIdx(null);
    }
  }, [draggingIdx, recordPolishAction]);

  // 一键清空本曲线所有目标值，回到"未设计"状态
  const handleReset = useCallback(() => {
    const field = CURVE_META[curveKind].field;
    let count = 0;
    for (const c of mainChapters) {
      if (typeof c[field] === 'number') {
        updateChapter(c.id, { [field]: undefined });
        count++;
      }
    }
    if (count > 0) {
      toast.info('已清空目标曲线', `${CURVE_META[curveKind].label}已重置为未设计状态（${count} 章）`);
    }
  }, [mainChapters, curveKind, updateChapter]);

  if (mainChapters.length === 0) {
    return <EmptyHint icon={Activity} text="还没有正文章节，无法设计曲线" />;
  }

  const meta = CURVE_META[curveKind];
  const Icon = meta.icon;
  const plotWidth = Math.max(mainChapters.length * 48, 320);
  const plotHeight = SVG_HEIGHT - SVG_PADDING.top - SVG_PADDING.bottom;
  const usableWidth = plotWidth - SVG_PADDING.left - SVG_PADDING.right;
  const stepX = mainChapters.length > 1 ? usableWidth / (mainChapters.length - 1) : 0;

  // 计算每个点的 SVG 坐标
  const points = mainChapters.map((c, idx) => {
    const x = SVG_PADDING.left + idx * stepX;
    const targetVal = targetValues[idx];
    const yTarget = SVG_PADDING.top + plotHeight - (targetVal / 100) * plotHeight;
    const actualVal = actualMap.get(c.id);
    const yActual = typeof actualVal === 'number'
      ? SVG_PADDING.top + plotHeight - (actualVal / 100) * plotHeight
      : null;
    return { x, yTarget, yActual, targetVal, actualVal, chapter: c };
  });

  // 构造路径字符串
  const targetPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yTarget}`).join(' ');
  const actualPath = points.filter(p => p.yActual !== null).map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yActual}`).join(' ');

  // 差距统计
  const gaps = points.filter(p => typeof p.actualVal === 'number');
  const avgGap = gaps.length > 0
    ? Math.round(gaps.reduce((s, p) => s + Math.abs(p.targetVal - (p.actualVal || 0)), 0) / gaps.length)
    : null;

  return (
    <Section
      icon={Icon}
      title="曲线拖拽设计"
      desc="画出你想要的张力/情感走向，对照实际诊断值找差距"
      action={
        <div className="flex items-center gap-1">
          {/* 曲线切换 */}
          {(Object.keys(CURVE_META) as CurveKind[]).map(k => {
            const M = CURVE_META[k];
            const MIcon = M.icon;
            return (
              <button
                key={k}
                onClick={() => setCurveKind(k)}
                className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                  curveKind === k ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'
                }`}
              >
                <MIcon className="w-3 h-3" style={{ color: curveKind === k ? M.color : undefined }} />
                {M.label}
              </button>
            );
          })}
          <button
            onClick={handleReset}
            title="清空所有目标值"
            className="text-[11px] px-2 py-1 text-ink-500 hover:text-red-400 rounded flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            重置
          </button>
        </div>
      }
    >
      {/* SVG 曲线 */}
      <div className="p-2 bg-ink-800/30 rounded-lg">
        <div className="flex items-center justify-between mb-1 text-[10px] text-ink-500">
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: meta.color }} />
              目标（可拖拽）
            </span>
            {report && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 border-t border-dashed border-ink-500" />
                实际（诊断）
              </span>
            )}
          </span>
          {avgGap !== null && (
            <span className={avgGap > 20 ? 'text-amber-400' : 'text-emerald-400'}>
              平均差距 {avgGap}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <svg
            ref={svgRef}
            width={plotWidth}
            height={SVG_HEIGHT}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="block touch-none"
            role="img"
            aria-label={`${meta.label}拖拽编辑器`}
          >
            {/* 网格线 + Y 轴刻度 */}
            {[0, 25, 50, 75, 100].map(v => {
              const y = SVG_PADDING.top + plotHeight - (v / 100) * plotHeight;
              return (
                <g key={v}>
                  <line
                    x1={SVG_PADDING.left} y1={y}
                    x2={plotWidth - SVG_PADDING.right} y2={y}
                    stroke="rgb(50,50,50)" strokeWidth={0.5} strokeDasharray="2 3"
                  />
                  <text x={SVG_PADDING.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill="rgb(110,110,110)">
                    {v}
                  </text>
                </g>
              );
            })}

            {/* 实际曲线（虚线） */}
            {report && actualPath && (
              <path d={actualPath} fill="none" stroke="rgb(120,120,120)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
            )}

            {/* 目标曲线填充区域 */}
            <path
              d={`${targetPath} L ${points[points.length - 1].x} ${SVG_PADDING.top + plotHeight} L ${points[0].x} ${SVG_PADDING.top + plotHeight} Z`}
              fill={meta.color} opacity={0.1}
            />
            {/* 目标曲线（实线） */}
            <path d={targetPath} fill="none" stroke={meta.color} strokeWidth={2} />

            {/* 拖拽圆点 */}
            {points.map((p, idx) => (
              <g key={p.chapter.id}>
                {/* 实际值小方点（只读参考） */}
                {p.yActual !== null && (
                  <rect
                    x={p.x - 2.5} y={p.yActual - 2.5} width={5} height={5}
                    fill="rgb(120,120,120)" opacity={0.6}
                  />
                )}
                {/* 目标值圆点（可拖拽） */}
                <circle
                  cx={p.x} cy={p.yTarget} r={draggingIdx === idx ? 7 : 5}
                  fill={meta.color}
                  stroke="rgb(20,20,20)" strokeWidth={1.5}
                  className="cursor-ns-resize"
                  onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); setDraggingIdx(idx); }}
                  style={{ transition: 'r 0.1s' }}
                />
                {/* 章节序号 */}
                <text x={p.x} y={SVG_HEIGHT - 10} textAnchor="middle" fontSize={9} fill="rgb(110,110,110)">
                  {p.chapter.order + 1}
                </text>
                {/* 拖拽中显示数值 */}
                {draggingIdx === idx && (
                  <text x={p.x} y={p.yTarget - 12} textAnchor="middle" fontSize={11} fontWeight="bold" fill={meta.color}>
                    {p.targetVal}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* 差距列表 */}
      {report && gaps.length > 0 && (
        <div className="p-2 bg-ink-800/30 rounded-lg">
          <div className="text-[10px] text-ink-400 mb-1.5 flex items-center gap-1">
            <Info className="w-2.5 h-2.5" />
            目标 vs 实际差距（仅显示有诊断值的章节）
          </div>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {points.filter(p => typeof p.actualVal === 'number').map(p => {
              const gap = p.targetVal - (p.actualVal || 0);
              const absGap = Math.abs(gap);
              const tone = absGap <= 10 ? 'text-emerald-400' : absGap <= 25 ? 'text-amber-400' : 'text-red-400';
              return (
                <button
                  key={p.chapter.id}
                  onClick={() => setCurrentChapter(p.chapter.id)}
                  className="w-full flex items-center gap-2 text-[10px] hover:bg-ink-700/40 rounded px-1 py-0.5 transition-colors text-left"
                >
                  <span className="text-ink-600 w-6">{p.chapter.order + 1}</span>
                  <span className="text-ink-300 flex-1 truncate">{p.chapter.title}</span>
                  <span className="text-ink-400 tabular-nums">目标 {p.targetVal}</span>
                  <span className="text-ink-600">·</span>
                  <span className="text-ink-400 tabular-nums">实际 {p.actualVal}</span>
                  <span className={`tabular-nums w-12 text-right ${tone}`}>
                    {gap > 0 ? '+' : ''}{gap}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 无诊断报告提示 */}
      {!report && (
        <div className="text-[10px] text-ink-600 italic text-center">
          尚无诊断报告——可先拖拽设计目标曲线，再去「诊断」Tab 跑一次全面分析后回来对照
        </div>
      )}
    </Section>
  );
}

export default CurveDragPanel;
