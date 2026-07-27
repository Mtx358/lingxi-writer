/**
 * 三幕结构比例 + 伏笔密度热力图
 *
 * 由原 OutlinePolishPanel.tsx 中 PacingTab 的"三幕比例"与"伏笔密度热力图"
 * 两个 JSX 块原样搬迁而来。二者均属"结构分析"范畴，故合并在同一文件。
 *
 * 注意：在 RhythmPulsePanel 中，三幕比例与伏笔密度之间会穿插张力曲线 / 情感曲线，
 * 因此本组件仅渲染三幕比例；伏笔密度由 RhythmPulsePanel 在尾部自行渲染以保持原顺序。
 * 这里仅导出三幕比例部分；伏笔密度热力图作为命名导出 ForeshadowDensityHeatmap 供主面板按序调用。
 */
import { Target, Zap } from 'lucide-react';
import type { OutlinePolishReport } from '@/types';

type ForeshadowDensity = OutlinePolishReport['foreshadowDensity'][number];

/**
 * 三幕结构比例条：开端 / 发展 / 高潮与结局 的字数加权占比。
 */
export function StructureRatioPanel({ threeActRatio }: { threeActRatio: number[] }) {
  // 防御解构：若 threeActRatio 异常返回短数组，b/c 为 undefined 会让 width:`${b}%` 渲染为 "undefined%"，
  // 对应 div 宽度塌陷为 0，三幕比例条视觉缺失。提供默认值 0 保证视觉稳定
  const [a = 0, b = 0, c = 0] = threeActRatio;

  return (
    <div className="p-3 bg-ink-800/30 rounded-lg">
      <div className="text-xs text-ink-300 font-medium mb-2 flex items-center gap-1">
        <Target className="w-3.5 h-3.5 text-amber-400" />
        三幕结构比例
      </div>
      <div className="flex h-6 rounded overflow-hidden">
        <div className="bg-blue-500/60 flex items-center justify-center text-[10px] text-white" style={{ width: `${a}%` }}>
          {a > 8 ? `开端 ${a}%` : ''}
        </div>
        <div className="bg-amber-500/60 flex items-center justify-center text-[10px] text-white" style={{ width: `${b}%` }}>
          {b > 8 ? `发展 ${b}%` : ''}
        </div>
        <div className="bg-red-500/60 flex items-center justify-center text-[10px] text-white" style={{ width: `${c}%` }}>
          {c > 8 ? `高潮 ${c}%` : ''}
        </div>
      </div>
      <div className="text-[10px] text-ink-500 mt-1.5">
        理想参考：开端 25% · 发展 50% · 高潮与结局 25%。字数加权。
      </div>
    </div>
  );
}

/**
 * 伏笔密度热力图：按章节展示埋设 / 推进 / 回收 的分布，点击行跳转章节。
 */
export function ForeshadowDensityHeatmap({
  foreshadowDensity,
  onJumpTo,
}: {
  foreshadowDensity: ForeshadowDensity[];
  onJumpTo: (chapterId: string | null) => void;
}) {
  if (foreshadowDensity.length === 0) return null;

  return (
    <div className="p-3 bg-ink-800/30 rounded-lg">
      <div className="text-xs text-ink-300 font-medium mb-2 flex items-center gap-1">
        <Zap className="w-3.5 h-3.5 text-pink-400" />
        伏笔密度热力图
      </div>
      <div className="space-y-1">
        {foreshadowDensity.map(d => {
          const total = d.planted + d.progressing + d.paidOff;
          return (
            <button
              key={d.chapterId}
              onClick={() => onJumpTo(d.chapterId)}
              className="w-full flex items-center gap-2 text-[10px] hover:bg-ink-700/30 px-1 py-0.5 rounded"
            >
              <span className="text-ink-400 truncate flex-1 text-left">{d.chapterTitle}</span>
              <div className="flex gap-px h-3 w-32">
                <div className="bg-pink-500/60" style={{ width: `${total > 0 ? d.planted / total * 100 : 0}%` }} title={`埋设 ${d.planted}`} />
                <div className="bg-amber-500/60" style={{ width: `${total > 0 ? d.progressing / total * 100 : 0}%` }} title={`推进 ${d.progressing}`} />
                <div className="bg-emerald-500/60" style={{ width: `${total > 0 ? d.paidOff / total * 100 : 0}%` }} title={`回收 ${d.paidOff}`} />
              </div>
              <span className="text-ink-500 w-8 text-right">{total}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[9px] text-ink-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-pink-500/60 rounded-sm" />埋设</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500/60 rounded-sm" />推进</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/60 rounded-sm" />回收</span>
      </div>
    </div>
  );
}
