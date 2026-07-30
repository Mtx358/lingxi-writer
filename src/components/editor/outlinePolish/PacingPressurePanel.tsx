/**
 * 节奏压力测试面板（规格书第四阶段）
 *
 * 调用 runPacingPressureTest 生成节奏压力报告，以纯 CSS 柱状图呈现每章
 * 外部能量 + 情感能量堆叠，并标注缓冲段；同时列出连续低/高能量等节奏
 * 问题与落地建议。无图表库依赖。
 *
 * 可交互节奏调校：点击柱子展开调校面板，拖动滑块微调 external/emotional，
 * 勾选缓冲段，曲线实时更新。人工判断不被 AI 覆盖（仅修改 lastPacingReport，
 * 不触发重新检测）。
 *
 * 数据来源：outlinePolishSlice.lastPacingReport / runPacingPressureTest。
 */
import { useState, useRef, useEffect } from 'react';
import { Activity, RefreshCw, AlertTriangle, Info, Lightbulb, Sliders, RotateCcw, X, Sparkles, Loader2, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import type { PacingPressurePoint, PacingIssue } from '@/types';

const ISSUE_TYPE_LABELS: Record<PacingIssue['type'], string> = {
  'low-streak': '连续低能量',
  'high-streak': '连续高能量',
  'flat': '平铺',
  'spike': '尖峰',
};

const ISSUE_TYPE_COLORS: Record<PacingIssue['type'], string> = {
  'low-streak': 'text-blue-300 bg-blue-400/10 border-blue-500/30',
  'high-streak': 'text-red-300 bg-red-400/10 border-red-500/30',
  'flat': 'text-ink-300 bg-ink-700/40 border-ink-600/40',
  'spike': 'text-amber-300 bg-amber-400/10 border-amber-500/30',
};

const CHART_HEIGHT = 120;

export function PacingPressurePanel() {
  const report = useAppStore(s => s.lastPacingReport);
  const runPacingPressureTest = useAppStore(s => s.runPacingPressureTest);
  const chapters = useAppStore(s => s.chapters);
  const [scope, setScope] = useState<'all' | string>('all');
  const [isRunning, setIsRunning] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);

  const mainChapters = chapters.filter(c => c.levelType === 'chapter');

  const handleRun = async () => {
    setIsRunning(true);
    setEditingChapterId(null);
    try {
      await runPacingPressureTest(scope);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 顶部操作栏 */}
      <div className="p-2 bg-ink-800/30 rounded-lg flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {isRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
          {isRunning ? '检测中' : '运行节奏检测'}
        </button>
        <select
          aria-label="范围"
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
        >
          <option value="all">全量大纲</option>
          {mainChapters.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.title}</option>
          ))}
        </select>
      </div>

      {!report ? (
        <div className="text-center py-8">
          <Activity className="w-10 h-10 text-ink-600 mx-auto mb-2" />
          <p className="text-sm text-ink-500">点击上方按钮运行节奏检测</p>
          <p className="text-xs text-ink-600">会生成类似心电图的节奏曲线，并标注连续低能量或高能量的问题段落。</p>
        </div>
      ) : (
        <>
          {/* 节奏曲线图 */}
          <div className="p-3 bg-ink-800/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-ink-300 font-medium">节奏能量曲线</div>
              <div className="text-[10px] text-ink-500">{report.points.length} 章 · 范围 {report.scope === 'all' ? '全量' : report.scope.slice(0, 6)}</div>
            </div>
            <PacingChart
              points={report.points}
              editingChapterId={editingChapterId}
              onSelectChapter={setEditingChapterId}
            />
            {/* 图例 */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-400 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-500/70 rounded-sm" />外部能量</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-orange-500/70 rounded-sm" />情感能量</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-ink-700/40 rounded-sm border border-ink-600/50" />缓冲段</span>
              <span className="flex items-center gap-1 text-cyan-400">
                <Sliders className="w-2.5 h-2.5" />点击柱子可调校
              </span>
            </div>
          </div>

          {/* 调校面板：点击柱子后展开 */}
          {editingChapterId && (
            <PacingAdjuster
              point={report.points.find(p => p.chapterId === editingChapterId)}
              onClose={() => setEditingChapterId(null)}
            />
          )}

          {/* 问题清单 */}
          <div className="space-y-2">
            <div className="text-xs text-ink-300 font-medium">节奏问题（{report.issues.length}）</div>
            {report.issues.length === 0 ? (
              <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                <Info className="w-4 h-4" /> 未检测到节奏问题
              </div>
            ) : (
              report.issues.map(issue => <PacingIssueCard key={issue.id} issue={issue} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PacingChart({
  points,
  editingChapterId,
  onSelectChapter,
}: {
  points: PacingPressurePoint[];
  editingChapterId: string | null;
  onSelectChapter: (id: string | null) => void;
}) {
  if (points.length === 0) {
    return <div className="text-[11px] text-ink-500 text-center py-6">暂无章节数据</div>;
  }
  return (
    <div className="flex items-end gap-1" style={{ height: `${CHART_HEIGHT}px` }}>
      {points.map(p => {
        const barHeight = (Math.min(Math.max(p.total, 0), 100) / 100) * CHART_HEIGHT;
        const sum = p.external + p.emotional;
        const externalHeight = sum > 0 ? barHeight * (p.external / sum) : 0;
        const emotionalHeight = sum > 0 ? barHeight * (p.emotional / sum) : 0;
        const isActive = editingChapterId === p.chapterId;
        return (
          <button
            key={p.chapterId}
            onClick={() => onSelectChapter(isActive ? null : p.chapterId)}
            className={`flex-1 min-w-0 h-full flex flex-col justify-end relative group cursor-pointer rounded-t transition-all ${
              isActive ? 'ring-1 ring-cyan-400 ring-offset-0' : 'hover:ring-1 hover:ring-ink-500'
            }`}
            title={`${p.chapterTitle}：外部 ${p.external} / 情感 ${p.emotional} / 综合 ${p.total}${p.isBuffer ? '（缓冲段）' : ''}`}
            data-testid={`pacing-bar-${p.chapterId}`}
          >
            {p.isBuffer && <div className="absolute inset-0 bg-ink-700/30 rounded" />}
            <div
              className="relative w-full flex flex-col rounded-t overflow-hidden"
              style={{ height: `${barHeight}px` }}
            >
              <div className="w-full bg-orange-500/70" style={{ height: `${emotionalHeight}px` }} />
              <div className="w-full bg-blue-500/70" style={{ height: `${externalHeight}px` }} />
            </div>
            {/* 章节序号（hover/active 显示） */}
            <div className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] whitespace-nowrap transition-opacity ${isActive ? 'opacity-100 text-cyan-300' : 'opacity-0 group-hover:opacity-100 text-ink-400'}`}>
              {p.chapterTitle}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 调校面板：滑块微调 external/emotional，勾选缓冲段；调整后可请求 AI 建议，一键应用 */
function PacingAdjuster({
  point,
  onClose,
}: {
  point: PacingPressurePoint | undefined;
  onClose: () => void;
}) {
  const updatePacingPoint = useAppStore(s => s.updatePacingPoint);
  const resetPacingPoint = useAppStore(s => s.resetPacingPoint);
  const requestPacingAdvice = useAppStore(s => s.requestPacingAdvice);
  const applyPacingAdvice = useAppStore(s => s.applyPacingAdvice);
  const clearPacingAdvice = useAppStore(s => s.clearPacingAdvice);
  const advice = useAppStore(s => s.lastPacingAdvice);

  const [adviceLoading, setAdviceLoading] = useState(false);
  // 缓存打开调校面板时的初始 external/emotional 值，用于计算调整 delta
  const initialValuesRef = useRef<{ external: number; emotional: number } | null>(null);

  // 切换章节时重置缓存并清空建议（避免串章）；卸载时也清空
  useEffect(() => {
    if (!point) {
      initialValuesRef.current = null;
      return;
    }
    initialValuesRef.current = { external: point.external, emotional: point.emotional };
    setAdviceLoading(false);
    clearPacingAdvice?.();
    return () => {
      clearPacingAdvice?.();
    };
    // 仅依赖 chapterId，避免每次拖动滑块都重置缓存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.chapterId]);

  if (!point) return null;

  const handleRequestAdvice = async (dimension: 'external' | 'emotional') => {
    const initial = initialValuesRef.current;
    if (!initial) return;
    const current = dimension === 'external' ? point.external : point.emotional;
    const oldValue = dimension === 'external' ? initial.external : initial.emotional;
    const delta = current - oldValue;
    if (Math.abs(delta) < 15) {
      toast.info(
        '调整幅度不足',
        `${dimension === 'external' ? '外部' : '情感'}能量较初始值变化 ${delta > 0 ? '+' : ''}${delta}，需 ≥15 才触发 AI 建议`,
      );
      return;
    }
    const direction: 'raise' | 'lower' = delta > 0 ? 'raise' : 'lower';
    setAdviceLoading(true);
    try {
      await requestPacingAdvice?.(point.chapterId, dimension, direction, Math.abs(delta));
    } finally {
      setAdviceLoading(false);
    }
  };

  const handleApplyAdvice = () => {
    applyPacingAdvice?.();
    toast.success('已采纳建议', '节奏调校建议已应用');
  };

  const handleCloseAdvice = () => {
    clearPacingAdvice?.();
  };

  // 仅展示属于当前章节的建议（避免异步串章）
  const visibleAdvice = advice && advice.chapterId === point.chapterId ? advice : null;

  return (
    <div className="p-3 bg-cyan-500/5 border border-cyan-500/30 rounded-lg space-y-2" data-testid="pacing-adjuster">
      <div className="flex items-center gap-1.5">
        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-xs text-cyan-300 font-medium flex-1">调校：{point.chapterTitle}</span>
        <button
          onClick={() => {
            resetPacingPoint(point.chapterId);
          }}
          className="text-[10px] text-ink-500 hover:text-ink-300 flex items-center gap-0.5"
          title="清零该章数值（重新检测可恢复 AI 原始值）"
        >
          <RotateCcw className="w-2.5 h-2.5" />清零
        </button>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-300">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="text-[10px] text-ink-500">
        综合 <span className="text-ink-200 font-medium">{point.total}</span>（人工微调不触发 AI 重新检测）
      </div>

      {/* 外部能量滑块 */}
      <SliderRow
        label="外部能量"
        value={point.external}
        color="bg-blue-500"
        onChange={(v) => updatePacingPoint(point.chapterId, { external: v })}
        dimension="external"
        onRequestAdvice={handleRequestAdvice}
        adviceLoading={adviceLoading}
      />

      {/* 情感能量滑块 */}
      <SliderRow
        label="情感能量"
        value={point.emotional}
        color="bg-orange-500"
        onChange={(v) => updatePacingPoint(point.chapterId, { emotional: v })}
        dimension="emotional"
        onRequestAdvice={handleRequestAdvice}
        adviceLoading={adviceLoading}
      />

      {/* 缓冲段勾选 */}
      <label className="flex items-center gap-1.5 text-[11px] text-ink-300 cursor-pointer">
        <input
          type="checkbox"
          checked={point.isBuffer}
          onChange={(e) => updatePacingPoint(point.chapterId, { isBuffer: e.target.checked })}
          className="w-3 h-3 accent-cyan-400"
        />
        标记为缓冲段（日常过渡/信息铺垫/文戏）
      </label>

      {/* AI 调校建议展示区（滑块下方） */}
      {(adviceLoading || visibleAdvice) && (
        <div className="mt-1 p-2 bg-ink-800/40 border border-cyan-500/20 rounded space-y-1.5" data-testid="pacing-advice">
          {adviceLoading ? (
            <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              AI 正在生成调校建议…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span className="text-[11px] text-cyan-300 font-medium">AI 调校建议</span>
                <span className="text-[9px] text-ink-500">
                  {visibleAdvice!.dimension === 'external' ? '外部能量' : '情感能量'}·{visibleAdvice!.direction === 'raise' ? `拉高 ${visibleAdvice!.delta}` : `压低 ${visibleAdvice!.delta}`}
                </span>
              </div>
              <div className="text-[11px] text-ink-200 leading-relaxed">{visibleAdvice!.advice}</div>
              {visibleAdvice!.variants.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-ink-500">备选方向</div>
                  <ul className="space-y-1">
                    {visibleAdvice!.variants.map((v, i) => (
                      <li key={i} className="text-[11px] text-ink-300 leading-relaxed flex gap-1">
                        <span className="text-cyan-400 flex-shrink-0">{i + 1}.</span>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleApplyAdvice}
                  className="px-2 py-1 text-[11px] bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25 rounded transition-colors flex items-center gap-1"
                >
                  <Check className="w-3 h-3" />一键应用
                </button>
                <button
                  onClick={handleCloseAdvice}
                  className="px-2 py-1 text-[11px] text-ink-400 hover:text-ink-200 rounded transition-colors"
                >
                  关闭
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 滑块行：标签 + range input + 数值 + （可选）获取 AI 建议按钮 */
function SliderRow({
  label,
  value,
  color,
  onChange,
  dimension,
  onRequestAdvice,
  adviceLoading,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
  dimension?: 'external' | 'emotional';
  onRequestAdvice?: (dimension: 'external' | 'emotional') => void;
  adviceLoading?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-ink-400 w-14 flex-shrink-0">{label}</span>
      <div className={`w-1.5 h-1.5 rounded-full ${color} flex-shrink-0`} />
      <input
        type="range"
        aria-label={label}
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-cyan-400 cursor-pointer"
        data-testid={`pacing-slider-${label}`}
      />
      <span className="text-[11px] text-ink-200 w-8 text-right tabular-nums">{value}</span>
      {onRequestAdvice && dimension && (
        <button
          onClick={() => onRequestAdvice(dimension)}
          disabled={adviceLoading}
          className="text-[10px] px-1.5 py-0.5 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-0.5 flex-shrink-0"
          title="基于本次调整幅度请求 AI 给出落地操作建议"
        >
          {adviceLoading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
          获取 AI 建议
        </button>
      )}
    </div>
  );
}

function PacingIssueCard({ issue }: { issue: PacingIssue }) {
  const sevIcon = issue.severity === 'warning'
    ? <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
    : <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />;
  const sevBorder = issue.severity === 'warning'
    ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-blue-500/30 bg-blue-500/5';
  return (
    <div className={`p-3 rounded-lg border ${sevBorder}`}>
      <div className="flex items-start gap-2">
        {sevIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`px-1.5 py-px text-[9px] rounded border ${ISSUE_TYPE_COLORS[issue.type]}`}>
              {ISSUE_TYPE_LABELS[issue.type]}
            </span>
            <span className={`px-1 py-px text-[9px] rounded ${issue.severity === 'warning' ? 'text-amber-300' : 'text-blue-300'}`}>
              {issue.severity === 'warning' ? '警告' : '提示'}
            </span>
          </div>
          <div className="text-xs text-ink-100 mb-1.5 leading-relaxed">{issue.description}</div>
          <div className="text-[11px] text-emerald-300 flex items-start gap-1 leading-relaxed">
            <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>{issue.suggestion}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
