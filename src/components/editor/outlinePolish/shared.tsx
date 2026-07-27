/**
 * 大纲打磨面板：通用展示组件
 *
 * 由原 OutlinePolishPanel.tsx 中 Section / EmptyHint / CurveCard 三个内部组件
 * 原样搬迁而来，供各功能域子面板复用。
 */
import type { ReactNode } from 'react';
import { Target } from 'lucide-react';

/**
 * 带图标 + 标题 + 描述 + 右上角 action 的通用 Section 容器。
 */
export function Section({
  icon: Icon,
  title,
  desc,
  action,
  children,
}: {
  icon: typeof Target;
  title: string;
  desc?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-amber-400" />
          <div>
            <div className="text-xs font-medium text-ink-200">{title}</div>
            {desc && <div className="text-[10px] text-ink-500">{desc}</div>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * 空态提示：大图标 + 一行说明文本。
 */
export function EmptyHint({ icon: Icon, text }: { icon: typeof Target; text: string }) {
  return (
    <div className="p-6 text-center">
      <Icon className="w-8 h-8 text-ink-600 mx-auto mb-2" />
      <div className="text-xs text-ink-500">{text}</div>
    </div>
  );
}

/**
 * 通用曲线卡片：渲染一组按章节维度的纵向柱状曲线（张力 / 情感 等）。
 * 每根柱可点击跳转到对应章节。
 */
export function CurveCard<T extends { chapterId: string; chapterTitle: string }>({
  title,
  data,
  valueKey,
  color,
  onJumpTo,
}: {
  title: string;
  data: T[];
  valueKey: keyof T;
  color: string;
  onJumpTo: (id: string) => void;
}) {
  if (data.length === 0) {
    return (
      <div className="p-3 bg-ink-800/30 rounded-lg text-center" role="status" aria-live="polite">
        <p className="text-[11px] text-ink-500">暂无数据</p>
      </div>
    );
  }
  return (
    <div className="p-3 bg-ink-800/30 rounded-lg">
      <div className="text-xs text-ink-300 font-medium mb-2">{title}</div>
      <div className="flex items-end gap-1 h-24">
        {data.map(d => {
          const val = Number(d[valueKey]) || 0;
          return (
            <button
              key={d.chapterId}
              onClick={() => onJumpTo(d.chapterId)}
              className={`flex-1 bg-gradient-to-t ${color} rounded-t transition-all hover:brightness-110 relative group min-w-0`}
              style={{ height: `${Math.max(val, 3)}%` }}
              title={`${d.chapterTitle}: ${val}%`}
            >
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-ink-700 px-1.5 py-0.5 rounded text-[10px] text-ink-200 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                {val}%
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-ink-600">
        <span>开篇</span>
        <span>中段</span>
        <span>结尾</span>
      </div>
    </div>
  );
}
