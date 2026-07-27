/**
 * 节奏 Tab：节奏脉搏主面板
 *
 * 由原 OutlinePolishPanel.tsx 中 PacingTab 函数原样搬迁而来，重命名为
 * RhythmPulsePanel。组合三幕比例（StructureRatioPanel）+ 剧情张力曲线
 * （节奏脉搏本体，直接用 CurveCard）+ 情感曲线（EmotionCurvePanel）
 * + 伏笔密度热力图（ForeshadowDensityHeatmap），保持原 PacingTab 渲染顺序。
 *
 * 无报告时返回空态。
 */
import { TrendingUp } from 'lucide-react';
import type { OutlinePolishReport } from '@/types';
import { CurveCard } from './shared';
import { StructureRatioPanel, ForeshadowDensityHeatmap } from './StructureRatioPanel';
import { EmotionCurvePanel } from './EmotionCurvePanel';

export function RhythmPulsePanel({
  report,
  onJumpTo,
}: {
  report: OutlinePolishReport | null;
  onJumpTo: (chapterId: string | null) => void;
}) {
  if (!report) {
    return (
      <div className="text-center py-8">
        <TrendingUp className="w-10 h-10 text-ink-600 mx-auto mb-2" />
        <p className="text-sm text-ink-500">点击"全面分析"</p>
        <p className="text-xs text-ink-600">查看节奏与情感曲线</p>
      </div>
    );
  }

  const { pacingCurve, emotionCurve, threeActRatio, foreshadowDensity } = report;

  return (
    <div className="space-y-3">
      {/* 三幕比例 */}
      <StructureRatioPanel threeActRatio={threeActRatio} />

      {/* 张力曲线（节奏脉搏本体） */}
      <CurveCard title="剧情张力曲线" data={pacingCurve} valueKey="tension" color="from-amber-600 to-amber-400" onJumpTo={onJumpTo} />

      {/* 情感曲线 */}
      <EmotionCurvePanel emotionCurve={emotionCurve} onJumpTo={onJumpTo} />

      {/* 伏笔密度热力图 */}
      <ForeshadowDensityHeatmap foreshadowDensity={foreshadowDensity} onJumpTo={onJumpTo} />
    </div>
  );
}
