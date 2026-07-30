/**
 * 骨架 Tab：核心驱动锁定 + 冲突罗盘 + 结构变体预览
 *
 * 由原 OutlinePolishPanel.tsx 中 SkeletonTab 函数原样搬迁而来。
 * 自管理 draftType/draftDesc/conflictBusy/variantsBusy 等本地状态，
 * 通过 useAppStore 直接读写 coreDriver / conflictCompass / structureVariants。
 */
import { useState } from 'react';
import { Target, Compass, GitBranch, Loader2, Lock, Unlock, FlaskConical, Play } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { confirm } from '@/hooks/useConfirm';
import { toast } from '@/hooks/useToast';
import type { CoreDriver } from '@/types';
import { Section } from './shared';
import { DRIVER_TYPE_LABELS, CONFLICT_LAYER_LABELS } from './constants';
import { runHypothesisProjection, type HypothesisProjectionResult } from '@/utils/aiService/polishTools';

/** 假设式推演变化性质的展示配置 */
const HYPOTHESIS_KIND_META: Record<HypothesisProjectionResult['changes'][number]['kind'], { label: string; cls: string }> = {
  enhance: { label: '增强', cls: 'bg-emerald-400/15 text-emerald-300' },
  weaken: { label: '削弱', cls: 'bg-amber-400/15 text-amber-300' },
  reverse: { label: '反转', cls: 'bg-red-400/15 text-red-300' },
  add: { label: '新增', cls: 'bg-cyan-400/15 text-cyan-300' },
  remove: { label: '删除', cls: 'bg-ink-400/15 text-ink-300' },
};

export function SkeletonTab() {
  const coreDriver = useAppStore(s => s.coreDriver);
  const conflictCompass = useAppStore(s => s.conflictCompass);
  const structureVariants = useAppStore(s => s.structureVariants);
  const lockCoreDriver = useAppStore(s => s.lockCoreDriver);
  const unlockCoreDriver = useAppStore(s => s.unlockCoreDriver);
  const fetchConflictCompass = useAppStore(s => s.fetchConflictCompass);
  const updateConflictWeight = useAppStore(s => s.updateConflictWeight);
  const fetchStructureVariants = useAppStore(s => s.fetchStructureVariants);

  const [draftType, setDraftType] = useState<CoreDriver['type']>('character');
  const [draftDesc, setDraftDesc] = useState('');
  // 独立跟踪两类请求的 loading：原先用单值 busy，并发触发时后触发的会覆盖前者的状态，
  // 前者 finally 中 setBusy(null) 又会清掉后者的 loading，UI 显示错乱
  const [conflictBusy, setConflictBusy] = useState(false);
  const [variantsBusy, setVariantsBusy] = useState(false);

  // 假设式推演状态（规格书阶段2-2）
  const chapters = useAppStore(s => s.chapters);
  const mainChapters = chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order);
  const [hypothesis, setHypothesis] = useState('');
  const [anchorOrder, setAnchorOrder] = useState(1);
  const [hypoBusy, setHypoBusy] = useState(false);
  const [hypoResult, setHypoResult] = useState<HypothesisProjectionResult | null>(null);

  const handleRunHypothesis = async () => {
    const trimmed = hypothesis.trim();
    if (!trimmed) {
      toast.error('请输入假设', '例如：如果主角第 20 章选择和反派合作');
      return;
    }
    setHypoBusy(true);
    setHypoResult(null);
    try {
      const result = await runHypothesisProjection({
        hypothesis: trimmed,
        anchorChapterOrder: anchorOrder,
        chapters,
      });
      setHypoResult(result);
    } catch {
      toast.error('推演失败', '请检查 API 配置后重试');
    } finally {
      setHypoBusy(false);
    }
  };

  const handleLock = () => {
    if (!draftDesc.trim()) return;
    lockCoreDriver({
      type: draftType,
      description: draftDesc.trim(),
      lockedAt: new Date().toISOString(),
    });
  };

  const handleFetchConflict = async () => {
    setConflictBusy(true);
    try {
      await fetchConflictCompass();
    } finally {
      setConflictBusy(false);
    }
  };

  const handleFetchVariants = async () => {
    setVariantsBusy(true);
    try {
      await fetchStructureVariants();
    } finally {
      setVariantsBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 核心驱动锁定 */}
      <Section icon={Target} title="核心驱动锁定" desc="锚定整部作品的打磨基准线">
        {coreDriver ? (
          <div className="space-y-2">
            <div className="p-3 bg-amber-400/5 border border-amber-500/30 rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-amber-300 bg-amber-400/20 px-1.5 py-0.5 rounded">
                  {DRIVER_TYPE_LABELS[coreDriver.type]}
                </span>
                <button
                  onClick={async () => {
                    // 解锁会清空已生成的冲突罗盘，与其他删除操作一致地确认
                    if (conflictCompass.length > 0 && !(await confirm('解锁后已生成的冲突罗盘将被清空，确定吗？'))) return;
                    unlockCoreDriver();
                  }}
                  className="text-[10px] text-ink-500 hover:text-ink-300 flex items-center gap-0.5"
                >
                  <Unlock className="w-2.5 h-2.5" /> 解锁重选
                </button>
              </div>
              <div className="text-xs text-ink-200">{coreDriver.description}</div>
              <div className="text-[10px] text-ink-500 mt-1">
                锁定于 {new Date(coreDriver.lockedAt).toLocaleString()}
              </div>
            </div>
            <button
              onClick={handleFetchConflict}
              disabled={conflictBusy}
              className="w-full px-3 py-1.5 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {conflictBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Compass className="w-3 h-3" />}
              {conflictCompass.length > 0 ? '重新生成冲突罗盘' : '生成冲突罗盘'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1">
              {(['character', 'plot', 'theme'] as CoreDriver['type'][]).map(t => (
                <button
                  key={t}
                  onClick={() => setDraftType(t)}
                  className={`flex-1 px-2 py-1 text-[11px] rounded transition-colors ${
                    draftType === t
                      ? 'bg-amber-400/20 text-amber-300'
                      : 'bg-ink-800/50 text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {DRIVER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <textarea
              aria-label="核心驱动描述"
              value={draftDesc}
              onChange={e => setDraftDesc(e.target.value)}
              placeholder={
                draftType === 'character'
                  ? '例：主角核心弧光从"逃避过去"到"直面代价"'
                  : draftType === 'plot'
                  ? '例：核心冲突是"旧规则与新时代的对抗"'
                  : '例：核心表达"所有谎言最终都会反噬说谎者"'
              }
              rows={3}
              className="input text-xs py-1.5 w-full resize-none"
            />
            <button
              onClick={handleLock}
              disabled={!draftDesc.trim()}
              className="w-full px-3 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Lock className="w-3 h-3" />
              锁定核心驱动
            </button>
          </div>
        )}
      </Section>

      {/* 冲突罗盘（可拖拽调整权重，加重自动生成情节种子） */}
      {conflictCompass.length > 0 && (
        <Section icon={Compass} title="冲突罗盘" desc="4 层冲突体系，拖拽权重调整分量，加重自动生成情节种子">
          <div className="space-y-2">
            {conflictCompass.map(layer => {
              const weight = layer.weight ?? 50;
              const weightColor = weight >= 70 ? 'accent-red-500' : weight >= 40 ? 'accent-amber-400' : 'accent-emerald-400';
              const weightLabel = weight >= 70 ? '高压' : weight >= 40 ? '中压' : '低压';
              return (
                <div key={layer.layer} className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-purple-300 font-medium">
                      {CONFLICT_LAYER_LABELS[layer.layer]}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      weight >= 70 ? 'bg-red-400/10 text-red-300' : weight >= 40 ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'
                    }`}>
                      {weightLabel} · {weight}
                    </span>
                  </div>
                  <div className="text-xs text-ink-200 mb-2">{layer.description}</div>
                  {/* 权重拖拽条：拖动改分量，加重≥15 自动生成情节种子 */}
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={weight}
                      onChange={e => updateConflictWeight(layer.layer, Number(e.target.value))}
                      title="拖拽调整该层冲突在故事中的分量，加重会自动生成情节种子"
                      className={`flex-1 h-1.5 cursor-pointer ${weightColor}`}
                    />
                  </div>
                  {layer.seeds.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-ink-500">情节种子：</div>
                      {layer.seeds.map((seed, i) => (
                        <div key={i} className="text-[11px] text-ink-400 pl-2 border-l border-ink-700">
                          {seed}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 假设式推演（规格书阶段2-2：如果主角第20章选择…在时间轴上标注后续变化） */}
      <Section
        icon={FlaskConical}
        title="假设式推演"
        desc="提出「如果主角第 N 章选择和反派合作」这类假设，AI 在时间轴上标注后续连锁变化，不改原大纲"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-400 flex-shrink-0">如果</span>
            <input
              aria-label="假设式推演输入"
              value={hypothesis}
              onChange={e => setHypothesis(e.target.value)}
              placeholder="主角在第 20 章选择和反派合作 / 导师提前牺牲 / 女主身份暴露"
              className="flex-1 px-2 py-1.5 text-xs bg-ink-900/60 border border-ink-700 rounded text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-amber-400/50"
              onKeyDown={e => { if (e.key === 'Enter') handleRunHypothesis(); }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="hypo-anchor" className="text-[11px] text-ink-400 flex-shrink-0">生效章节</label>
            <select
              id="hypo-anchor"
              value={anchorOrder}
              onChange={e => setAnchorOrder(Number(e.target.value))}
              disabled={mainChapters.length === 0}
              className="px-2 py-1 text-xs bg-ink-900/60 border border-ink-700 rounded text-ink-100 focus:outline-none focus:border-amber-400/50"
            >
              {mainChapters.length === 0 ? (
                <option value={1}>（暂无章节）</option>
              ) : mainChapters.map(c => (
                <option key={c.id} value={c.order + 1}>第 {c.order + 1} 章 · {c.title.slice(0, 12)}</option>
              ))}
            </select>
            <button
              onClick={handleRunHypothesis}
              disabled={hypoBusy || !hypothesis.trim() || mainChapters.length === 0}
              className="ml-auto px-2.5 py-1 text-xs bg-purple-400/15 text-purple-300 hover:bg-purple-400/25 rounded flex items-center gap-1 disabled:opacity-50"
            >
              {hypoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              推演后续变化
            </button>
          </div>

          {/* 推演结果：在时间轴上标注后续变化 */}
          {hypoResult && (
            <div className="p-2.5 bg-ink-800/40 border border-purple-500/20 rounded space-y-2">
              <div className="text-[11px] text-purple-200 leading-relaxed">{hypoResult.summary}</div>
              {/* 时间轴标注：按章节序号升序展示连锁变化 */}
              <div className="space-y-1">
                <div className="text-[10px] text-ink-500 flex items-center gap-1">
                  <FlaskConical className="w-2.5 h-2.5" /> 时间轴标注（后续连锁变化）
                </div>
                {hypoResult.changes.length === 0 ? (
                  <div className="text-[10px] text-ink-600 pl-2">未推演出明显连锁变化</div>
                ) : hypoResult.changes.map((ch, idx) => {
                  const meta = HYPOTHESIS_KIND_META[ch.kind];
                  return (
                    <div key={idx} className="flex items-start gap-1.5 text-[10px] pl-2 border-l border-purple-500/30">
                      <span className="text-ink-500 flex-shrink-0">第{ch.chapterOrder}章</span>
                      <span className={`px-1 rounded text-[9px] flex-shrink-0 ${meta.cls}`}>{meta.label}</span>
                      <span className="text-ink-300 leading-relaxed">{ch.change}</span>
                    </div>
                  );
                })}
              </div>
              {/* 潜在风险 */}
              {hypoResult.risks.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[10px] text-amber-300/80">需补充的铺垫 / 风险</div>
                  {hypoResult.risks.map((r, idx) => (
                    <div key={idx} className="text-[10px] text-ink-400 pl-2 border-l border-amber-500/20">{r}</div>
                  ))}
                </div>
              )}
              <div className="text-[9px] text-ink-600 pt-1 border-t border-ink-700/40">
                此推演不改动原大纲，仅供评估代价。确认可行可到「颠覆修改」阶段用沙盒试运行落地。
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* 结构变体 */}
      <Section icon={GitBranch} title="结构变体预览" desc="3 套叙事结构方案并排对比，在时间轴上看节奏差异，选好了再往下搭">
        {structureVariants.length === 0 ? (
          <button
            onClick={handleFetchVariants}
            disabled={variantsBusy}
            className="w-full px-3 py-1.5 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {variantsBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
            生成 3 套结构变体
          </button>
        ) : (
          <div className="space-y-3">
            {/* 三套变体并排预览：grid-cols-3 让作者一眼对比优劣 */}
            <div className="grid grid-cols-3 gap-2">
              {structureVariants.map((v, idx) => (
                <div
                  key={v.id}
                  className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded flex flex-col"
                  style={{ borderTopColor: VARIANT_CURVE_COLORS[idx % VARIANT_CURVE_COLORS.length].stroke, borderTopWidth: 2 }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] font-medium flex items-center gap-1.5" style={{ color: VARIANT_CURVE_COLORS[idx % VARIANT_CURVE_COLORS.length].stroke }}>
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: VARIANT_CURVE_COLORS[idx % VARIANT_CURVE_COLORS.length].stroke }}
                        aria-hidden="true"
                      />
                      {v.name}
                    </div>
                  </div>
                  <div className="text-[9px] text-ink-500 mb-1.5">{v.suggestedHierarchy.join(' / ')}</div>
                  <div className="text-[11px] text-ink-300 mb-1.5 leading-relaxed">{v.description}</div>
                  <div className="space-y-0.5 text-[10px] mt-auto">
                    <div className="text-emerald-300">
                      <span className="text-ink-500">优势：</span>{v.pros}
                    </div>
                    <div className="text-amber-300">
                      <span className="text-ink-500">风险：</span>{v.cons}
                    </div>
                    <div className="text-cyan-300">
                      <span className="text-ink-500">适配：</span>{v.fitScenarios}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 节奏对比时间轴：三套变体的张力曲线叠加，直观看哪套节奏更合适 */}
            <VariantTensionComparison variants={structureVariants} />
          </div>
        )}
      </Section>
    </div>
  );
}

// ===== 三套变体张力曲线配色（与上方卡片顶部色条对应）=====
const VARIANT_CURVE_COLORS = [
  { stroke: 'rgb(96, 165, 250)', label: '变体A' },   // 蓝
  { stroke: 'rgb(248, 113, 113)', label: '变体B' },   // 红
  { stroke: 'rgb(192, 132, 252)', label: '变体C' },   // 紫
];

// ===== 节奏对比时间轴：三套变体张力曲线叠加 =====
// 规格书阶段2-1：「三套结构变体并排预览，在时间轴上对比节奏差异」
function VariantTensionComparison({
  variants,
}: {
  variants: Array<{ name: string; tensionCurve?: number[] }>;
}) {
  const curves = variants.map(v => v.tensionCurve ?? []);
  const hasAny = curves.some(c => c.length > 0);
  if (!hasAny) return null;

  const W = 480;
  const H = 140;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(...curves.map(c => c.length), 8);
  const xFor = (i: number) => (n > 1 ? padL + (i / (n - 1)) * innerW : W / 2);
  const yFor = (v: number) => padT + innerH - (Math.min(Math.max(v, 0), 100) / 100) * innerH;

  // 横轴刻度：开篇 / 1/4 / 中点 / 3/4 / 结尾
  const ticks = [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor(3 * (n - 1) / 4), n - 1];
  const tickLabels = ['开篇', '1/4', '中点', '3/4', '结尾'];

  return (
    <div className="p-2.5 bg-ink-800/30 border border-ink-700/50 rounded">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] text-ink-300 font-medium">节奏对比时间轴</div>
        <div className="flex items-center gap-2 text-[9px]">
          {variants.map((v, idx) => (
            <span key={idx} className="flex items-center gap-1 text-ink-400">
              <span
                className="w-2 h-0.5"
                style={{ backgroundColor: VARIANT_CURVE_COLORS[idx % VARIANT_CURVE_COLORS.length].stroke }}
                aria-hidden="true"
              />
              {v.name}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: `${H}px` }} preserveAspectRatio="none" role="img" aria-label="三套变体节奏张力对比">
        {/* Y 轴刻度（0/50/100） */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        {[0, 50, 100].map(v => {
          const y = yFor(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
              <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.4)">{v}</text>
            </g>
          );
        })}
        {/* X 轴刻度（开篇 / 1/4 / 中点 / 3/4 / 结尾） */}
        {ticks.map((t, idx) => (
          <text
            key={idx}
            x={xFor(t)}
            y={H - 6}
            textAnchor="middle"
            fontSize="9"
            fill="rgba(255,255,255,0.4)"
          >
            {tickLabels[idx]}
          </text>
        ))}
        {/* 三条张力曲线叠加 */}
        {curves.map((curve, idx) => {
          if (curve.length === 0) return null;
          const color = VARIANT_CURVE_COLORS[idx % VARIANT_CURVE_COLORS.length].stroke;
          const pts = curve.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
          return (
            <g key={idx}>
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {curve.map((v, i) => (
                <circle key={i} cx={xFor(i)} cy={yFor(v)} r="2" fill={color}>
                  <title>{variants[idx]?.name} · {tickLabels[ticks.indexOf(i)] || `点${i + 1}`}: 张力 {v}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-ink-500 mt-1 leading-relaxed">
        三条曲线叠加对比：哪套结构中段张力更高？哪套更平缓？哪套收尾更猛？按你想要的节奏感选一套。
      </div>
    </div>
  );
}
