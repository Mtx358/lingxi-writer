/**
 * 错误处理共享工具。
 *
 * 此前 `e instanceof Error ? e.message : String(e)` 在 21 个文件中出现 38 次，
 * 收敛到此处统一维护，便于未来加埋点/脱敏/分级等扩展。
 */

/**
 * 从任意 thrown 值中提取可读的错误消息字符串。
 *
 * - Error 实例：返回 `.message`
 * - 字符串/数字/对象：返回 `String(value)`
 * - null/undefined：返回占位字符串，避免 toast 显示空字符串让用户无从判断
 *
 * 仅做读取，不吞错也不重新抛出。
 */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e === null || e === undefined) return '未知错误';
  return String(e);
}
