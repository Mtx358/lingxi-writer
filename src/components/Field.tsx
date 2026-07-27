import { useId, Children, isValidElement, cloneElement, type ReactElement, type ReactNode } from 'react';

/**
 * 表单字段标签 + 控件包装。
 *
 * CoreSettingCardPanel 与 BlueprintPanel 原先各自内联相同的 Field 定义
 * （label + children 包装），现统一收敛到此组件。
 *
 * 用法：
 *   <Field label="书名"><input ... /></Field>
 *
 * 无障碍：自动用 useId 生成唯一 id，将 <label htmlFor> 与单个表单控件
 * （input/textarea/select）程序化关联。若传入 inputId 则用其指定关联
 * （用于 children 为多个元素、控件被 div 包裹等无法自动注入的情况）。
 * 当唯一子元素是非表单控件（如按钮组容器 div）时，改用 id + role=group
 * + aria-labelledby 的分组标注模式，避免 <label htmlFor> 指向非表单控件。
 */
const LABELABLE_TYPES = new Set(['input', 'textarea', 'select']);

export interface FieldProps {
  label: string;
  /** 显式指定关联控件的 id；用于 children 为多元素或控件被包裹的情况。 */
  inputId?: string;
  children: ReactNode;
}

export default function Field({ label, inputId, children }: FieldProps) {
  const autoId = useId();
  const childArray = Children.toArray(children);
  let rendered = children;
  let useGroupLabeling = false;

  if (!inputId && childArray.length === 1) {
    const child = childArray[0];
    if (isValidElement(child)) {
      const element = child as ReactElement<Record<string, unknown>>;
      const type = typeof element.type === 'string' ? element.type : '';
      if (LABELABLE_TYPES.has(type)) {
        rendered = cloneElement(element, { id: autoId });
      } else {
        // 非表单控件（如按钮组容器）：用 aria-labelledby 分组标注
        rendered = cloneElement(element, { role: 'group', 'aria-labelledby': autoId });
        useGroupLabeling = true;
      }
    }
  }

  const controlId = inputId ?? autoId;

  return (
    <div>
      {useGroupLabeling ? (
        <div id={autoId} className="block text-[11px] text-ink-400 mb-1">{label}</div>
      ) : (
        <label htmlFor={controlId} className="block text-[11px] text-ink-400 mb-1">{label}</label>
      )}
      {rendered}
    </div>
  );
}
