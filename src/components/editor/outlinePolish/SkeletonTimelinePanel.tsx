/**
 * 骨架可交互结构时间轴（规格书阶段2-1）
 *
 * 横轴=卷/部进度(0-100%)，纵轴=情节强度(0-100)。
 * 关键事件是可拖拽节点：拖动节点后，系统自动标红逻辑断层点并给出补充方案。
 * 三套结构变体并排预览节奏差异。手动标记大高潮位，AI 据此校验可达性。
 *
 * 交互：
 *  - 拖拽节点：水平改位置、垂直改强度，松手写回 skeletonEvents
 *  - 双击节点：标记/取消高潮位（星标）
 *  - 点击断层节点：展开断层原因与补充建议
 *  - 套用节奏预设：把预设的高潮位分布叠加到当前事件，自动填中间事件
 */
import { useState, useMemo, useRef, useCallback } from 'react';
import { Activity, Zap, Star, AlertCircle, Plus } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { SkeletonTimelineEvent, PacingPreset } from '@/types';
import { Section, EmptyHint } from './shared';
import { toast } from '@/hooks/useToast';

const CANVAS_W = 560;
const CANVAS_H = 200;
const PAD = { top: 16, right: 20, bottom: 28, left: 32 };

// 默认节奏预设（文档示例：高潮位分布）
const DEFAULT_PRESETS: PacingPreset[] = [
  { id: 'p-three-act', label: '三幕式', climaxPositions: [25, 75, 95], description: '建置→对抗→结局，两个小高潮+一个大高潮' },
  { id: 'p-five-act', label: '五幕式', climaxPositions: [12, 38, 62, 85, 98], description: '起承转合+尾声，节奏更密' },
  { id: 'p-serial', label: '连载爽文', climaxPositions: [15, 35, 55, 75, 92], description: '每卷一爽点，高频回报' },
];

export function SkeletonTimelinePanel() {
  const events = useAppStore(s => s.skeletonEvents);
  const setSkeletonEvents = useAppStore(s => s.setSkeletonEvents);
  const presets = useAppStore(s => s.pacingPresets);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 初始化默认预设
  const effectivePresets = presets.length > 0 ? presets : DEFAULT_PRESETS;

  // 断层检测：相邻节点间距过大或强度跳变过大 → 标红
  const analyzedEvents = useMemo(() => {
    if (events.length < 2) return events;
    const sorted = [...events].sort((a, b) => a.position - b.position);
    return sorted.map((e, i) => {
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      let isFault = false;
      let faultReason = '';
      if (prev) {
        const posGap = e.position - prev.position;
        const intensityJump = Math.abs(e.intensity - prev.intensity);
        if (posGap > 35) {
          isFault = true;
          faultReason = `与上一事件间距 ${posGap.toFixed(0)}%，进度跨度过大，读者可能迷失`;
        } else if (intensityJump > 50 && !e.isClimax) {
          isFault = true;
          faultReason = `强度从 ${prev.intensity} 跳到 ${e.intensity}，缺乏过渡`;
        }
      }
      if (next && next.position - e.position > 35 && !isFault) {
        isFault = true;
        faultReason = `与下一事件间距 ${(next.position - e.position).toFixed(0)}%，中间缺铺垫`;
      }
      return { ...e, isFault, faultReason };
    });
  }, [events]);

  // SVG 坐标 → 数据值
  const toData = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { position: 50, intensity: 50 };
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const plotW = CANVAS_W - PAD.left - PAD.right;
    const plotH = CANVAS_H - PAD.top - PAD.bottom;
    const position = Math.max(0, Math.min(100, ((x - PAD.left) / plotW) * 100));
    const intensity = Math.max(0, Math.min(100, 100 - ((y - PAD.top) / plotH) * 100));
    return { position: Math.round(position), intensity: Math.round(intensity) };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingId) return;
    const { position, intensity } = toData(e.clientX, e.clientY);
    setSkeletonEvents(events.map(ev => ev.id === draggingId ? { ...ev, position, intensity } : ev));
  }, [draggingId, events, toData, setSkeletonEvents]);

  const handlePointerUp = useCallback(() => setDraggingId(null), []);

  const handleDoubleClick = (id: string) => {
    setSkeletonEvents(events.map(ev => ev.id === id ? { ...ev, isClimax: !ev.isClimax } : ev));
  };

  const handleAddEvent = () => {
    const newEvent: SkeletonTimelineEvent = {
      id: `evt-${Date.now()}`,
      title: `事件 ${events.length + 1}`,
      position: 50,
      intensity: 50,
      isClimax: false,
      isFault: false,
    };
    setSkeletonEvents([...events, newEvent]);
  };

  // 套用节奏预设：在高潮位生成/对齐事件
  const applyPreset = (preset: PacingPreset) => {
    const existingClimaxes = events.filter(e => e.isClimax);
    const newEvents: SkeletonTimelineEvent[] = [...events];
    for (const pos of preset.climaxPositions) {
      // 找最近的高潮位事件
      const nearest = existingClimaxes
        .map(e => ({ e, dist: Math.abs(e.position - pos) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearest && nearest.dist < 8) {
        // 对齐到预设位置
        const idx = newEvents.findIndex(e => e.id === nearest.e.id);
        if (idx >= 0) newEvents[idx] = { ...newEvents[idx], position: pos };
      } else {
        // 新增一个高潮位事件
        newEvents.push({
          id: `evt-${Date.now()}-${pos}`,
          title: `高潮位`,
          position: pos,
          intensity: 85,
          isClimax: true,
          isFault: false,
        });
      }
    }
    setSkeletonEvents(newEvents);
    toast.success('已套用节奏预设', `「${preset.label}」：${preset.description}`);
  };

  const selected = analyzedEvents.find(e => e.id === selectedId);

  return (
    <Section
      icon={Activity}
      title="可交互结构时间轴"
      desc="拖事件改节奏 · 双击标高潮 · 自动标红断层 · 套用节奏预设"
      action={
        <button onClick={handleAddEvent} className="px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1">
          <Plus className="w-3 h-3" /> 加事件
        </button>
      }
    >
      {events.length === 0 ? (
        <EmptyHint
          icon={Activity}
          hint="还没有事件节点"
          subHint="点击「加事件」放置关键节点，拖拽可调整位置与强度，双击标记高潮位"
        />
      ) : (
        <>
          {/* SVG 时间轴画布 */}
          <div className="p-2 bg-ink-800/30 rounded-lg">
            <svg
              ref={svgRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="block touch-none bg-ink-900/40 rounded w-full"
              style={{ maxWidth: '100%' }}
            >
              {/* 网格线 */}
              {[0, 25, 50, 75, 100].map(v => {
                const x = PAD.left + (v / 100) * (CANVAS_W - PAD.left - PAD.right);
                return (
                  <g key={v}>
                    <line x1={x} y1={PAD.top} x2={x} y2={CANVAS_H - PAD.bottom} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 3" />
                    <text x={x} y={CANVAS_H - PAD.bottom + 14} fill="#71717a" fontSize="9" textAnchor="middle">{v}%</text>
                  </g>
                );
              })}
              {[0, 50, 100].map(v => {
                const y = PAD.top + (1 - v / 100) * (CANVAS_H - PAD.top - PAD.bottom);
                return (
                  <g key={v}>
                    <line x1={PAD.left} y1={y} x2={CANVAS_W - PAD.right} y2={y} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 3" />
                    <text x={PAD.left - 6} y={y + 3} fill="#71717a" fontSize="9" textAnchor="end">{v}</text>
                  </g>
                );
              })}
              {/* 强度曲线连线 */}
              {analyzedEvents.length > 1 && (() => {
                const sorted = [...analyzedEvents].sort((a, b) => a.position - b.position);
                const pts = sorted.map(e => {
                  const x = PAD.left + (e.position / 100) * (CANVAS_W - PAD.left - PAD.right);
                  const y = PAD.top + (1 - e.intensity / 100) * (CANVAS_H - PAD.top - PAD.bottom);
                  return `${x},${y}`;
                }).join(' ');
                return <polyline points={pts} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeOpacity="0.6" />;
              })()}
              {/* 事件节点 */}
              {analyzedEvents.map(e => {
                const x = PAD.left + (e.position / 100) * (CANVAS_W - PAD.left - PAD.right);
                const y = PAD.top + (1 - e.intensity / 100) * (CANVAS_H - PAD.top - PAD.bottom);
                const color = e.isFault ? '#ef4444' : e.isClimax ? '#fbbf24' : '#34d399';
                return (
                  <g
                    key={e.id}
                    onPointerDown={() => { setDraggingId(e.id); setSelectedId(e.id); }}
                    onDoubleClick={() => handleDoubleClick(e.id)}
                    className="cursor-move"
                  >
                    {e.isClimax && <Star x={x} y={y - 10} width={10} height={10} fill="#fbbf24" />}
                    <circle cx={x} cy={y} r={e.isClimax ? 6 : 5} fill={color} stroke="#1e293b" strokeWidth="1.5" />
                    <text x={x} y={y - 14} fill="#a1a1aa" fontSize="9" textAnchor="middle">{e.title}</text>
                  </g>
                );
              })}
            </svg>
            <div className="text-[10px] text-ink-500 mt-1 flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />普通事件</span>
              <span className="flex items-center gap-1"><Star className="w-2.5 h-2.5 text-amber-400 inline" fill="currentColor" />高潮位</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />断层点</span>
            </div>
          </div>

          {/* 节奏预设 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-ink-500">节奏预设：</span>
            {effectivePresets.map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                title={p.description}
                className="px-1.5 py-0.5 text-[10px] bg-ink-700/40 text-ink-300 hover:bg-ink-700/70 rounded"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 选中节点详情 / 断层说明 */}
          {selected && (
            <div className="p-2 bg-ink-800/40 rounded-lg space-y-1">
              <div className="flex items-center gap-1.5">
                {selected.isClimax && <Star className="w-3 h-3 text-amber-400" fill="currentColor" />}
                <span className="text-xs text-ink-100">{selected.title}</span>
                <span className="text-[10px] text-ink-500">位置 {selected.position}% · 强度 {selected.intensity}</span>
              </div>
              {selected.isFault ? (
                <div className="text-[11px] text-red-300 flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">逻辑断层：{selected.faultReason}</div>
                    <div className="text-ink-400 mt-0.5">建议：在此处补充过渡事件，或在前后章节增加铺垫，让节奏曲线平滑过渡。</div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-emerald-300 flex items-center gap-1">
                  <Zap className="w-3 h-3" /> 节奏连贯，无断层
                </div>
              )}
              <button
                onClick={() => {
                  setSkeletonEvents(events.filter(e => e.id !== selected.id));
                  setSelectedId(null);
                }}
                className="text-[10px] text-red-400/70 hover:text-red-400"
              >
                删除此事件
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
