/**
 * 正则转义公共工具
 *
 * 统一收敛散落在 outlineParser / uiSlice / entitySlice 中的 escapeRegExp 实现。
 * 转义正则元字符，避免人名/字段名/用户输入含 `.` `*` `+` `?` 等字符时误匹配或 SyntaxError。
 *
 * 注：searchWorker.ts 因 Worker 隔离上下文保留独立副本，不引入本模块。
 */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
