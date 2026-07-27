import type { ReactNode } from 'react';
import { cn } from '@/lib/utils'

/**
 * 通用空状态占位组件。
 *
 * 各 Panel（AIPanel / OutlinePanel / SearchModal 等）原先各自内联空状态，
 * 现统一收敛到此组件，确保 a11y（role="status" + aria-live="polite"）一致。
 *
 * 用法：
 *   <Empty icon={<Sparkles />} title="点击上方按钮" description="让 AI 帮你续写故事" />
 *   <Empty icon={<BookOpen />} title="还没有大纲" action={<button>创建大纲</button>} />
 */
export interface EmptyProps {
  /** 顶部图标节点（如 <Sparkles className="w-8 h-8 text-ink-600" />） */
  icon?: ReactNode;
  /** 主标题（必填，空状态至少要传达"空的是什么"） */
  title: ReactNode;
  /** 副标题/描述（可选，进一步说明操作引导） */
  description?: ReactNode;
  /** 动作节点（可选，如"创建大纲"按钮） */
  action?: ReactNode;
  /** 追加/覆盖根容器 class（与默认 flex h-full ... 合并） */
  className?: string;
}

export default function Empty({ icon, title, description, action, className }: EmptyProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex h-full flex-col items-center justify-center gap-2 text-center', className)}
    >
      {icon}
      <h3 className="text-sm font-medium text-ink-200">{title}</h3>
      {description && <p className="text-xs text-ink-500">{description}</p>}
      {action}
    </div>
  );
}
