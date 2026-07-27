/**
 * 情感强度曲线
 *
 * 由原 OutlinePolishPanel.tsx 中 PacingTab 内"情感强度曲线"的 CurveCard 调用
 * 原样搬迁而来。复用 shared 中的 CurveCard 通用曲线组件。
 */
import type { OutlinePolishReport } from '@/types';
import { CurveCard } from './shared';

type EmotionPoint = OutlinePolishReport['emotionCurve'][number];

export function EmotionCurvePanel({
  emotionCurve,
  onJumpTo,
}: {
  emotionCurve: EmotionPoint[];
  onJumpTo: (chapterId: string | null) => void;
}) {
  return (
    <CurveCard
      title="情感强度曲线"
      data={emotionCurve}
      valueKey="emotion"
      color="from-pink-600 to-pink-400"
      onJumpTo={onJumpTo}
    />
  );
}
