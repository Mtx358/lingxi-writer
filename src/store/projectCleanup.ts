/**
 * 项目切换时的模块级状态清理注册表。
 * 各模块通过 registerProjectCleanup 注册自己的清理函数，
 * 项目切换时只需调用 runProjectCleanup() 一次，避免在 5 个入口重复手写。
 */
type CleanupFn = () => void;
const cleanupFns: CleanupFn[] = [];

export function registerProjectCleanup(fn: CleanupFn): void {
  cleanupFns.push(fn);
}

export function runProjectCleanup(): void {
  for (const fn of cleanupFns) {
    try {
      fn();
    } catch {
      // 单个清理失败不应阻断其他清理
    }
  }
}
