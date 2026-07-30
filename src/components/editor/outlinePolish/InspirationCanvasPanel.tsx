/**
 * 灵感力导向连线画布（规格书阶段1-2）
 *
 * 节点是灵感卡，连线是 storyLinks（叙事脉络）。
 * 力导向布局：节点间斥力 + 连线弹簧引力，拖拽节点实时更新位置。
 * 框选一组关联卡片 → 一键生成大纲章节节点（带入骨架阶段）。
 *
 * 与原 InspirationPanel 内"连线沙盘"tab 的区别：
 *  - 原 tab 是列表式（选两张卡生成连线），无力导向、无节点拖拽
 *  - 本面板是 SVG 力导向画布，节点可拖拽、连线实时跟随、支持框选
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Sparkles, Network, Square, Check, X, RefreshCw, Lightbulb, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { InspirationCard, InspirationGap, InspirationGapKind } from '@/types';
import { Section, EmptyHint } from './shared';
import { toast } from '@/hooks/useToast';
import { detectInspirationGaps, expandStoryLinkVariants, type StoryLinkVariant } from '@/utils/aiService/polishTools';

interface SimNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  fixed: boolean;
}

const CANVAS_W = 560;
const CANVAS_H = 360;
const REPULSION = 4000;
const SPRING_K = 0.03;
const SPRING_LEN = 100;
const CENTER_K = 0.008;
const DAMPING = 0.85;
const ITERATIONS = 200;

const TYPE_COLOR: Record<InspirationCard['type'], string> = {
  concept: '#34d399',
  character: '#60a5fa',
  plot: '#fbbf24',
  scene: '#a78bfa',
  setting: '#22d3ee',
  dialogue: '#f472b6',
};

export function InspirationCanvasPanel() {
  const cards = useAppStore(s => s.inspirationCards);
  const links = useAppStore(s => s.storyLinks);
  const createStoryLink = useAppStore(s => s.createStoryLink);
  const deleteStoryLink = useAppStore(s => s.deleteStoryLink);
  const addChapter = useAppStore(s => s.addChapter);
  const updateChapter = useAppStore(s => s.updateChapter);
  // 灵感缺口：基于蓝图反向推断 + 回流到编辑器
  const chapters = useAppStore(s => s.chapters);
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const gaps = useAppStore(s => s.inspirationGaps);
  const setInspirationGaps = useAppStore(s => s.setInspirationGaps);
  const ignoreInspirationGap = useAppStore(s => s.ignoreInspirationGap);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ x: number; y: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ x: number; y: number } | null>(null);
  const [linking, setLinking] = useState(false);
  const [gapsLoading, setGapsLoading] = useState(false);
  // 连线变体扩展（规格书阶段1-2：点击连线展开 3 个变体方向）
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);
  const [linkVariants, setLinkVariants] = useState<StoryLinkVariant[] | null>(null);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // 力导向布局：仅当卡片集合变化时重算一次
  const layout = useMemo(() => {
    if (cards.length === 0) return new Map<string, SimNode>();
    const sim = new Map<string, SimNode>();
    const n = cards.length;
    cards.forEach((c, i) => {
      const angle = (i / n) * Math.PI * 2;
      const r = Math.min(CANVAS_W, CANVAS_H) / 3;
      sim.set(c.id, {
        id: c.id,
        label: c.title,
        x: CANVAS_W / 2 + Math.cos(angle) * r,
        y: CANVAS_H / 2 + Math.sin(angle) * r,
        vx: 0, vy: 0,
        color: TYPE_COLOR[c.type] || '#9ca3af',
        fixed: false,
      });
    });
    for (let iter = 0; iter < ITERATIONS; iter++) {
      // 斥力
      for (const a of sim.values()) {
        for (const b of sim.values()) {
          if (a.id === b.id) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = Math.max(100, dx * dx + dy * dy);
          const f = REPULSION / d2;
          const d = Math.sqrt(d2);
          a.vx += (dx / d) * f;
          a.vy += (dy / d) * f;
        }
      }
      // 弹簧引力
      for (const link of links) {
        const a = sim.get(link.sourceCardId);
        const b = sim.get(link.targetCardId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = SPRING_K * (d - SPRING_LEN);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      // 中心收敛 + 位置更新
      for (const node of sim.values()) {
        node.vx += (CANVAS_W / 2 - node.x) * CENTER_K;
        node.vy += (CANVAS_H / 2 - node.y) * CENTER_K;
        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x += node.vx;
        node.y += node.vy;
        // 边界约束
        node.x = Math.max(20, Math.min(CANVAS_W - 20, node.x));
        node.y = Math.max(20, Math.min(CANVAS_H - 20, node.y));
      }
    }
    return sim;
  }, [cards, links]);

  // 同步布局到 positions（拖拽时用 positions 覆盖）
  useEffect(() => {
    const next: Record<string, { x: number; y: number }> = {};
    for (const [id, node] of layout) {
      next[id] = positions[id] || { x: node.x, y: node.y };
    }
    setPositions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const getPos = useCallback((id: string) => {
    return positions[id] || layout.get(id) || { x: CANVAS_W / 2, y: CANVAS_H / 2 };
  }, [positions, layout]);

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }, []);

  const handleNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setDraggingId(id);
    setSelecting(false);
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingId) {
      const { x, y } = toSvg(e.clientX, e.clientY);
      setPositions(prev => ({ ...prev, [draggingId]: { x: Math.max(20, Math.min(CANVAS_W - 20, x)), y: Math.max(20, Math.min(CANVAS_H - 20, y)) } }));
    } else if (selecting && selStart) {
      const { x, y } = toSvg(e.clientX, e.clientY);
      setSelEnd({ x, y });
    }
  }, [draggingId, selecting, selStart, toSvg]);

  const handlePointerUp = useCallback(() => {
    if (selecting && selStart && selEnd) {
      // 计算框选范围内的节点
      const x1 = Math.min(selStart.x, selEnd.x);
      const x2 = Math.max(selStart.x, selEnd.x);
      const y1 = Math.min(selStart.y, selEnd.y);
      const y2 = Math.max(selStart.y, selEnd.y);
      const inBox: Set<string> = new Set();
      for (const card of cards) {
        const p = getPos(card.id);
        if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) inBox.add(card.id);
      }
      setSelectedIds(inBox);
    }
    setDraggingId(null);
    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
  }, [selecting, selStart, selEnd, cards, getPos]);

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    // 空白处按下：开始框选
    const { x, y } = toSvg(e.clientX, e.clientY);
    setSelecting(true);
    setSelStart({ x, y });
    setSelEnd({ x, y });
    setSelectedIds(new Set());
  };

  // 框选后一键生成大纲章节节点
  const handleGenerateOutlineNode = async () => {
    if (selectedIds.size < 2) {
      toast.error('至少框选 2 张卡片', '关联卡片太少，无法生成有意义的情节节点');
      return;
    }
    const selected = cards.filter(c => selectedIds.has(c.id));
    const title = selected.map(c => c.title).slice(0, 3).join(' + ');
    const summary = selected.map(c => `【${c.title}】${c.content.slice(0, 40)}`).join('\n');
    const chapter = addChapter(null, title || '新章节');
    if (chapter) {
      // 把关联卡片的要点写入章节摘要
      useAppStore.getState().updateChapter(chapter.id, { summary });
      toast.success('已生成大纲节点', `「${title}」已加入章节列表，关联 ${selected.length} 张灵感卡`);
      setSelectedIds(new Set());
    }
  };

  // 两点连线：选中两个节点后建立 storyLink
  const handleLinkSelected = async () => {
    if (selectedIds.size !== 2) {
      toast.error('请选中恰好 2 张卡片', '连线需要两个端点');
      return;
    }
    const [a, b] = [...selectedIds];
    setLinking(true);
    try {
      const link = await createStoryLink(a, b);
      if (link) toast.success('已建立连线', 'AI 已生成两张卡之间的叙事脉络');
    } finally {
      setLinking(false);
    }
  };

  // 点击连线展开 3 个变体方向（规格书阶段1-2：这个关联可以发展成什么情节）
  const handleLinkClick = async (linkId: string) => {
    if (expandedLinkId === linkId) {
      // 再次点击收起
      setExpandedLinkId(null);
      setLinkVariants(null);
      return;
    }
    const link = links.find(l => l.id === linkId);
    if (!link) return;
    const src = cards.find(c => c.id === link.sourceCardId);
    const tgt = cards.find(c => c.id === link.targetCardId);
    setExpandedLinkId(linkId);
    setLinkVariants(null);
    setVariantsLoading(true);
    try {
      const variants = await expandStoryLinkVariants({
        sourceTitle: src?.title || '卡A',
        targetTitle: tgt?.title || '卡B',
        narrative: link.narrative,
      });
      setLinkVariants(variants);
    } catch {
      toast.error('展开失败', '请检查 API 配置后重试');
      setExpandedLinkId(null);
    } finally {
      setVariantsLoading(false);
    }
  };

  // 把某个变体方向生成为大纲章节节点（带入骨架阶段）
  const handleVariantToOutline = (variant: StoryLinkVariant) => {
    const newCh = addChapter(null, variant.title, undefined, 'chapter');
    if (newCh) {
      updateChapter(newCh.id, { summary: variant.plotDirection });
    }
    toast.success('已生成大纲节点', `「${variant.title}」已带入骨架阶段，可到骨架打磨继续完善`);
  };

  // 灵感缺口检测：基于已锁定蓝图与主线反向推断缺口
  const handleDetectGaps = useCallback(async () => {
    setGapsLoading(true);
    try {
      const results = await detectInspirationGaps({ chapters, characters, foreshadows });
      const next: InspirationGap[] = results.map(r => ({
        id: r.id,
        kind: r.kind,
        description: r.description,
        suggestion: r.suggestion,
        relatedChapterId: r.relatedChapterId,
        relatedCharacterId: r.relatedCharacterId,
        ignored: false,
        source: 'blueprint' as const,
      }));
      setInspirationGaps(next);
      if (next.length === 0) {
        toast.success('未发现缺口', '当前蓝图素材覆盖较完整');
      } else {
        toast.info('发现 ' + next.length + ' 处缺口', '点击「去处理」可回流到对应章节/角色');
      }
    } catch {
      toast.error('缺口检测失败', '请检查 API 配置后重试');
    } finally {
      setGapsLoading(false);
    }
  }, [chapters, characters, foreshadows, setInspirationGaps]);

  // 编辑器缺口回流：定位到关联章节，便于直接处理
  const handleGapReflow = useCallback((gap: InspirationGap) => {
    if (gap.relatedChapterId) {
      setCurrentChapter(gap.relatedChapterId);
      const ch = chapters.find(c => c.id === gap.relatedChapterId);
      toast.info('已定位到关联章节', ch ? `《${ch.title}》` : '可在编辑器中查看');
    } else if (gap.relatedCharacterId) {
      const ch = characters.find(c => c.id === gap.relatedCharacterId);
      toast.info('已标记关联角色', ch ? `「${ch.name}」可在角色面板补充` : '请在角色面板查看');
    } else {
      toast.info('该缺口无具体关联', '请参考建议手动处理');
    }
  }, [setCurrentChapter, chapters, characters]);

  const visibleGaps = gaps.filter(g => !g.ignored);

  return (
    <div className="space-y-3">
    <Section
      icon={Network}
      title="力导向连线画布"
      desc="拖拽节点排关系 · 框选生成大纲节点 · 两点连线出情节脉络"
      action={
        <div className="flex items-center gap-1">
          {selectedIds.size >= 2 && (
            <>
              <button
                onClick={handleLinkSelected}
                disabled={linking}
                title="为选中的两张卡建立叙事连线"
                className="px-1.5 py-0.5 text-[10px] bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 rounded flex items-center gap-1 disabled:opacity-50"
              >
                {linking ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                连线
              </button>
              <button
                onClick={handleGenerateOutlineNode}
                title="把框选的关联卡片一键生成大纲章节"
                className="px-1.5 py-0.5 text-[10px] bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-1"
              >
                <Check className="w-2.5 h-2.5" /> 生成大纲节点
              </button>
            </>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              title="取消选择"
              className="p-0.5 text-ink-500 hover:text-ink-300 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      }
    >
      {cards.length === 0 ? (
        <EmptyHint
          icon={Network}
          hint="还没有灵感卡"
          subHint="先到「碎片捕获」积累几张灵感卡，再回来画关系网"
        />
      ) : (
        <>
          <div className="p-2 bg-ink-800/30 rounded-lg">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="block touch-none bg-ink-900/40 rounded w-full"
              style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
            >
              {/* 连线 */}
              {links.map(link => {
                const a = getPos(link.sourceCardId);
                const b = getPos(link.targetCardId);
                if (!a || !b) return null;
                return (
                  <g key={link.id}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#52525b" strokeWidth="1" />
                  </g>
                );
              })}
              {/* 框选矩形 */}
              {selecting && selStart && selEnd && (
                <rect
                  x={Math.min(selStart.x, selEnd.x)}
                  y={Math.min(selStart.y, selEnd.y)}
                  width={Math.abs(selEnd.x - selStart.x)}
                  height={Math.abs(selEnd.y - selStart.y)}
                  fill="rgba(251, 191, 36, 0.1)"
                  stroke="#fbbf24"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}
              {/* 节点 */}
              {cards.map(card => {
                const p = getPos(card.id);
                const isSelected = selectedIds.has(card.id);
                return (
                  <g
                    key={card.id}
                    onPointerDown={e => handleNodePointerDown(e, card.id)}
                    className="cursor-move"
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isSelected ? 9 : 7}
                      fill={TYPE_COLOR[card.type] || '#9ca3af'}
                      stroke={isSelected ? '#fbbf24' : '#1e293b'}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <text x={p.x} y={p.y - 12} fill="#a1a1aa" fontSize="9" textAnchor="middle">{card.title.slice(0, 8)}</text>
                  </g>
                );
              })}
            </svg>
            <div className="text-[10px] text-ink-500 mt-1 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1"><Square className="w-2.5 h-2.5 text-amber-400" />框选：空白处拖拽</span>
              <span className="flex items-center gap-1">· 拖节点：按住节点移动</span>
              <span>· {cards.length} 卡 · {links.length} 连线</span>
            </div>
          </div>

          {/* 已建立连线列表（点击连线展开 3 个情节变体方向） */}
          {links.length > 0 && (
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {links.map(link => {
                const src = cards.find(c => c.id === link.sourceCardId);
                const tgt = cards.find(c => c.id === link.targetCardId);
                const isExpanded = expandedLinkId === link.id;
                return (
                  <div key={link.id} className="rounded">
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
                      <button
                        onClick={() => handleLinkClick(link.id)}
                        className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:text-ink-200"
                        title="点击展开：这个关联可以发展成什么情节（3 个变体方向）"
                      >
                        <Sparkles className={`w-3 h-3 flex-shrink-0 ${isExpanded ? 'text-amber-400' : 'text-ink-600'}`} />
                        <span className="truncate">{src?.title || '?'}</span>
                        <span className="text-ink-600">→</span>
                        <span className="truncate">{tgt?.title || '?'}</span>
                        <span className="text-ink-600 truncate flex-1">：{link.narrative?.slice(0, 24)}</span>
                      </button>
                      <button
                        onClick={() => deleteStoryLink(link.id)}
                        className="text-red-400/60 hover:text-red-400 flex-shrink-0"
                        title="删除连线"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {/* 连线变体展开区：这个关联可以发展成什么情节，附带 3 个变体方向 */}
                    {isExpanded && (
                      <div className="mt-1 ml-4 p-2 bg-ink-800/40 border border-ink-700/50 rounded space-y-1.5">
                        <div className="text-[10px] text-amber-300/80 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" /> 这个关联可以发展成什么情节（3 个变体方向，选中可生成大纲节点）
                        </div>
                        {variantsLoading && (
                          <div className="text-[10px] text-ink-500 flex items-center gap-1">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> AI 正在推演情节方向…
                          </div>
                        )}
                        {!variantsLoading && linkVariants && linkVariants.map((v, idx) => (
                          <div key={idx} className="p-1.5 bg-ink-900/40 border border-ink-700/40 rounded">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-medium text-amber-200">{v.title}</span>
                              <button
                                onClick={() => handleVariantToOutline(v)}
                                className="ml-auto text-[9px] px-1.5 py-0.5 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-0.5"
                                title="把这个方向生成为大纲章节节点，带入骨架阶段"
                              >
                                <ArrowUpRight className="w-2.5 h-2.5" /> 生成大纲节点
                              </button>
                            </div>
                            <div className="text-[10px] text-ink-300 leading-relaxed mt-0.5">{v.plotDirection}</div>
                            <div className="text-[9px] text-ink-500 mt-0.5">风险：{v.risk}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Section>

    {/* ===== 灵感缺口智能提示（基于蓝图反向推断 + 编辑器回流）===== */}
    <Section
      icon={Lightbulb}
      title="灵感缺口智能提示"
      desc="基于蓝图反向推断缺什么 · 编辑器写作触发的缺口自动回流汇总"
      action={
        <button
          onClick={handleDetectGaps}
          disabled={gapsLoading || chapters.length === 0}
          className="px-1.5 py-0.5 text-[10px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-50"
        >
          {gapsLoading ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
          {gaps.length > 0 ? '重新检测' : '检测缺口'}
        </button>
      }
    >
      {visibleGaps.length === 0 ? (
        <EmptyHint
          icon={Lightbulb}
          hint={gaps.length === 0 ? '尚未检测缺口' : '缺口已全部忽略或处理'}
          subHint="点击「检测缺口」由蓝图反向推断；写作时编辑器触发的缺口会自动回流到此汇总"
        />
      ) : (
        <div className="space-y-1.5">
          {visibleGaps.map(gap => {
            const meta = GAP_KIND_META[gap.kind];
            const isEditor = gap.source === 'editor';
            return (
              <div key={gap.id} className={`p-2 bg-ink-800/30 rounded-lg border ${isEditor ? 'border-cyan-500/30' : 'border-ink-700/50'}`}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className={`w-3 h-3 ${meta.color}`} />
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                  {/* 来源标记：editor=编辑器写作时回流，blueprint=蓝图反向推断 */}
                  <span
                    className={`text-[9px] px-1 py-px rounded ${isEditor ? 'bg-cyan-400/10 text-cyan-300' : 'bg-ink-700/50 text-ink-500'}`}
                    title={isEditor ? '编辑器写作时触发回流' : '蓝图反向推断'}
                  >
                    {isEditor ? '回流' : '蓝图'}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => handleGapReflow(gap)}
                      title="回流到关联章节/角色处理"
                      className="p-0.5 text-cyan-300 hover:bg-cyan-400/10 rounded flex items-center gap-0.5 text-[10px]"
                    >
                      <ArrowUpRight className="w-3 h-3" /> 去处理
                    </button>
                    <button
                      onClick={() => ignoreInspirationGap(gap.id)}
                      title="忽略该缺口"
                      className="p-0.5 text-ink-500 hover:text-ink-300 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-ink-200 mt-1 leading-relaxed">{gap.description}</div>
                <div className="text-[11px] text-amber-300/80 mt-0.5">{gap.suggestion}</div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
    </div>
  );
}

// 缺口类型 → 标签与配色
const GAP_KIND_META: Record<InspirationGapKind, { label: string; cls: string; color: string }> = {
  'missing-character': { label: '缺角色', cls: 'text-blue-300 bg-blue-400/10', color: 'text-blue-300' },
  'missing-foreshadow': { label: '缺伏笔', cls: 'text-cyan-300 bg-cyan-400/10', color: 'text-cyan-300' },
  'missing-conflict': { label: '缺冲突', cls: 'text-red-300 bg-red-400/10', color: 'text-red-300' },
  'missing-setting': { label: '缺设定', cls: 'text-purple-300 bg-purple-400/10', color: 'text-purple-300' },
  'weak-motivation': { label: '动机单薄', cls: 'text-amber-300 bg-amber-400/10', color: 'text-amber-300' },
};
