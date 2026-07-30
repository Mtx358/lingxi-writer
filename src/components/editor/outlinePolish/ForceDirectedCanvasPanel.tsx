/**
 * 力导向画布面板（规格书第三档-13）
 *
 * 把角色 / 伏笔 / 关系铺成一张可拖拽的关系网，让创作者看出：
 *   - 谁是关系枢纽（连线最密的节点）
 *   - 哪些伏笔孤悬（没有关联角色/章节）
 *   - 角色之间的关系结构（主角群 vs 对手群的拓扑）
 *
 * 物理模拟：纯前端轻量力导向——节点间库仑斥力 + 边弹簧引力 + 中心收敛力，
 * 200 次迭代收敛后渲染。节点可手动拖拽微调，松手保持位置。
 * 不引入 d3-force 等依赖，保持自用工具的轻量。
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Network, Users, Flag, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Section, EmptyHint } from './shared';
import type { Character, Foreshadow } from '@/types';

// ==================== 类型 ====================

type NodeKind = 'character' | 'foreshadow';

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** 视觉半径 */
  radius: number;
  /** 颜色 */
  color: string;
  /** 关联数（度数），用于提示枢纽 */
  degree: number;
}

interface GraphEdge {
  source: string;
  target: string;
  /** 边类型：character-character / character-foreshadow */
  kind: 'cc' | 'cf';
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

// ==================== 常量 ====================

const CANVAS_W = 600;
const CANVAS_H = 400;
const SIM_ITERATIONS = 250;
const REPULSION = 6000; // 斥力强度
const SPRING_K = 0.04; // 弹簧弹性系数
const SPRING_LEN = 90; // 弹簧自然长度
const CENTER_K = 0.01; // 中心收敛力
const DAMPING = 0.85; // 阻尼

const ROLE_COLOR: Record<Character['role'], string> = {
  protagonist: '#34d399', // emerald
  antagonist: '#f87171', // red
  supporting: '#60a5fa', // blue
  minor: '#9ca3af', // gray
  narrator: '#a78bfa', // purple
};

const FORESHADOW_COLOR: Record<Foreshadow['status'], string> = {
  planted: '#22d3ee', // cyan
  progressing: '#fbbf24', // amber
  'paid-off': '#34d399', // emerald
  abandoned: '#6b7280', // gray
};

// ==================== 图构建 ====================

/**
 * 从角色/伏笔/章节构建关系图。
 * 节点：角色（按出场数 top N）+ 伏笔（top N）。
 * 边：角色间关系（CharacterRelationship）+ 角色↔伏笔（relatedCharacters）。
 */
function buildGraph(characters: Character[], foreshadows: Foreshadow[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // 角色：按出场数降序取前 12，避免节点过多
  const topChars = [...characters]
    .sort((a, b) => b.appearanceCount - a.appearanceCount)
    .slice(0, 12);
  // 伏笔：按优先级取前 15
  const prioOrder: Record<Foreshadow['priority'], number> = { high: 0, medium: 1, low: 2 };
  const topFore = [...foreshadows]
    .sort((a, b) => prioOrder[a.priority] - prioOrder[b.priority])
    .slice(0, 15);

  const charIds = new Set(topChars.map(c => c.id));
  const nodes: GraphNode[] = [
    ...topChars.map(c => ({
      id: c.id,
      label: c.name,
      kind: 'character' as const,
      radius: 6 + Math.min(8, Math.sqrt(c.appearanceCount) * 1.5),
      color: ROLE_COLOR[c.role],
      degree: 0,
    })),
    ...topFore.map(f => ({
      id: f.id,
      label: f.title,
      kind: 'foreshadow' as const,
      radius: 5,
      color: FORESHADOW_COLOR[f.status],
      degree: 0,
    })),
  ];

  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (source: string, target: string, kind: 'cc' | 'cf') => {
    if (source === target) return;
    const key = kind === 'cc' ? [source, target].sort().join('—') : `${source}→${target}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source, target, kind });
  };

  // 角色 ↔ 角色：来自 relationships（仅当双方都在 topChars 内）
  for (const c of topChars) {
    for (const rel of c.relationships) {
      if (charIds.has(rel.targetId)) {
        addEdge(c.id, rel.targetId, 'cc');
      }
    }
  }

  // 角色 ↔ 伏笔：来自 foreshadow.relatedCharacters
  for (const f of topFore) {
    for (const charId of f.relatedCharacters) {
      if (charIds.has(charId)) {
        addEdge(f.id, charId, 'cf');
      }
    }
  }

  // 计算度数
  for (const e of edges) {
    const s = nodes.find(n => n.id === e.source);
    const t = nodes.find(n => n.id === e.target);
    if (s) s.degree++;
    if (t) t.degree++;
  }

  return { nodes, edges };
}

// ==================== 力导向模拟 ====================

/**
 * 纯函数力导向布局：初始化环形位置 → 迭代施加斥力/引力/中心力 → 返回最终坐标。
 * 不依赖 rAF，一次性算完，避免渲染期间持续重绘消耗。
 */
function runForceLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, SimNode> {
  const sim = new Map<string, SimNode>();
  const n = nodes.length;
  // 初始化：环形分布，避免重叠在同一点导致斥力爆炸
  nodes.forEach((node, i) => {
    const angle = (i / n) * Math.PI * 2;
    const r = Math.min(CANVAS_W, CANVAS_H) / 3;
    sim.set(node.id, {
      ...node,
      x: CANVAS_W / 2 + Math.cos(angle) * r,
      y: CANVAS_H / 2 + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
      fixed: false,
    });
  });

  const edgeList = edges.map(e => ({
    s: sim.get(e.source),
    t: sim.get(e.target),
    kind: e.kind,
  })).filter(e => e.s && e.t) as { s: SimNode; t: SimNode; kind: GraphEdge['kind'] }[];

  for (let iter = 0; iter < SIM_ITERATIONS; iter++) {
    // 斥力：所有节点两两
    const simNodes = Array.from(sim.values());
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist2 = 0.01;
        }
        const dist = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // 引力：边弹簧
    for (const { s, t, kind } of edgeList) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const targetLen = kind === 'cf' ? SPRING_LEN * 0.8 : SPRING_LEN;
      const force = SPRING_K * (dist - targetLen);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // 中心收敛 + 速度衰减 + 位置更新
    for (const node of sim.values()) {
      if (node.fixed) continue;
      node.vx += (CANVAS_W / 2 - node.x) * CENTER_K;
      node.vy += (CANVAS_H / 2 - node.y) * CENTER_K;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
      // 边界约束
      node.x = Math.max(node.radius + 4, Math.min(CANVAS_W - node.radius - 4, node.x));
      node.y = Math.max(node.radius + 4, Math.min(CANVAS_H - node.radius - 4, node.y));
    }
  }

  return sim;
}

// ==================== 组件 ====================

export function ForceDirectedCanvasPanel() {
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);

  const [showCharacters, setShowCharacters] = useState(true);
  const [showForeshadows, setShowForeshadows] = useState(true);
  const [recomputeTick, setRecomputeTick] = useState(0);

  // 构建图（受可见性开关影响）
  const graph = useMemo(() => {
    const chars = showCharacters ? characters : [];
    const fores = showForeshadows ? foreshadows : [];
    // 至少要有一种节点，否则图无意义
    if (chars.length === 0 && fores.length === 0) return { nodes: [], edges: [] };
    return buildGraph(chars, fores);
  }, [characters, foreshadows, showCharacters, showForeshadows]);

  // 力导向布局：仅在图结构变化或手动重算时跑一次
  const layout = useMemo(() => {
    if (graph.nodes.length === 0) return new Map<string, SimNode>();
    return runForceLayout(graph.nodes, graph.edges);
    // recomputeTick 用于手动触发重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, recomputeTick]);

  // 拖拽覆盖位置：用户拖动后保持其位置，不被重算覆盖
  const [overrides, setOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  // 图结构变化时清空覆盖
  useEffect(() => {
    setOverrides(new Map());
  }, [graph]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // SVG 坐标转换：客户端坐标 → SVG 内部坐标
  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragId) return;
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    setOverrides(prev => {
      const next = new Map(prev);
      next.set(dragId, {
        x: Math.max(8, Math.min(CANVAS_W - 8, x)),
        y: Math.max(8, Math.min(CANVAS_H - 8, y)),
      });
      return next;
    });
  }, [dragId, clientToSvg]);

  const handlePointerUp = useCallback(() => {
    setDragId(null);
  }, []);

  // 合并布局结果与拖拽覆盖
  const renderedNodes = useMemo(() => {
    return Array.from(layout.values()).map(node => {
      const ov = overrides.get(node.id);
      return ov ? { ...node, x: ov.x, y: ov.y } : node;
    });
  }, [layout, overrides]);

  // 枢纽节点：度数 top 3
  const hubs = useMemo(() => {
    return [...renderedNodes].sort((a, b) => b.degree - a.degree).slice(0, 3);
  }, [renderedNodes]);

  if (characters.length === 0 && foreshadows.length === 0) {
    return <EmptyHint icon={Network} text="还没有角色或伏笔，关系网空空如也" />;
  }

  return (
    <Section
      icon={Network}
      title="力导向关系网"
      desc="角色 / 伏笔的拓扑结构 · 拖拽节点微调 · 连线越密越是枢纽"
      action={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCharacters(v => !v)}
            className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ${
              showCharacters ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            {showCharacters ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <Users className="w-3 h-3" />
            角色 {characters.length}
          </button>
          <button
            onClick={() => setShowForeshadows(v => !v)}
            className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ${
              showForeshadows ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            {showForeshadows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <Flag className="w-3 h-3" />
            伏笔 {foreshadows.length}
          </button>
          <button
            onClick={() => { setOverrides(new Map()); setRecomputeTick(t => t + 1); }}
            title="重新计算布局"
            className="text-[11px] px-2 py-1 text-ink-500 hover:text-amber-400 rounded flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            重排
          </button>
        </div>
      }
    >
      {/* SVG 画布 */}
      <div className="p-2 bg-ink-800/30 rounded-lg">
        <div className="flex items-center justify-between mb-1 text-[10px] text-ink-500">
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />主角
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400" />对手
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400" />配角
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2" style={{ backgroundColor: '#22d3ee' }} />伏笔·埋设
            </span>
          </span>
          <span>拖拽节点微调位置</span>
        </div>

        <div className="overflow-auto flex justify-center">
          <svg
            ref={svgRef}
            width={CANVAS_W}
            height={CANVAS_H}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="block touch-none bg-ink-900/40 rounded"
            role="img"
            aria-label="角色伏笔关系力导向图"
          >
            {/* 边 */}
            {graph.edges.map((e, idx) => {
              const s = layout.get(e.source);
              const t = layout.get(e.target);
              if (!s || !t) return null;
              const so = overrides.get(e.source);
              const to = overrides.get(e.target);
              const sx = so?.x ?? s.x;
              const sy = so?.y ?? s.y;
              const tx = to?.x ?? t.x;
              const ty = to?.y ?? t.y;
              return (
                <line
                  key={idx}
                  x1={sx} y1={sy} x2={tx} y2={ty}
                  stroke={e.kind === 'cc' ? 'rgb(100,160,200)' : 'rgb(120,100,160)'}
                  strokeWidth={e.kind === 'cc' ? 1.2 : 0.8}
                  opacity={0.4}
                />
              );
            })}

            {/* 节点 */}
            {renderedNodes.map(node => {
              const isHub = hubs.includes(node);
              return (
                <g
                  key={node.id}
                  onPointerDown={(ev) => { ev.preventDefault(); (ev.currentTarget as Element).setPointerCapture(ev.pointerId); setDragId(node.id); }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  {/* 枢纽光环 */}
                  {isHub && (
                    <circle cx={node.x} cy={node.y} r={node.radius + 4} fill="none" stroke={node.color} strokeWidth={1} opacity={0.3} strokeDasharray="2 2" />
                  )}
                  <circle
                    cx={node.x} cy={node.y} r={node.radius}
                    fill={node.color}
                    stroke="rgb(20,20,20)" strokeWidth={1.5}
                    opacity={dragId === node.id ? 0.6 : 1}
                  />
                  <text
                    x={node.x} y={node.y - node.radius - 4}
                    textAnchor="middle" fontSize={9}
                    fill="rgb(200,200,200)"
                    className="pointer-events-none select-none"
                  >
                    {node.label.length > 6 ? node.label.slice(0, 6) + '…' : node.label}
                  </text>
                  {node.degree > 0 && (
                    <text
                      x={node.x} y={node.y + 3}
                      textAnchor="middle" fontSize={8}
                      fill="rgb(20,20,20)" fontWeight="bold"
                      className="pointer-events-none select-none"
                    >
                      {node.degree}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* 枢纽节点榜 */}
      {hubs.length > 0 && hubs[0].degree > 0 && (
        <div className="p-2 bg-ink-800/30 rounded-lg">
          <div className="text-[10px] text-ink-400 mb-1.5">关系枢纽（度数最高）</div>
          <div className="flex flex-wrap gap-1.5">
            {hubs.filter(h => h.degree > 0).map(h => (
              <span
                key={h.id}
                className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1"
                style={{ backgroundColor: h.color + '20', color: h.color }}
              >
                {h.kind === 'character' ? <Users className="w-2.5 h-2.5" /> : <Flag className="w-2.5 h-2.5" />}
                {h.label} · {h.degree} 连接
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 空图提示 */}
      {graph.nodes.length === 0 && (
        <div className="text-[10px] text-ink-600 italic text-center">
          当前没有可见节点——打开角色/伏笔开关查看关系网
        </div>
      )}

      {/* 无关系提示 */}
      {graph.nodes.length > 0 && graph.edges.length === 0 && (
        <div className="text-[10px] text-ink-600 italic text-center">
          节点间暂无关系连线——在角色卡补充「关系」字段，或在伏笔卡补充「关联角色」，关系网会更丰满
        </div>
      )}
    </Section>
  );
}

export default ForceDirectedCanvasPanel;
