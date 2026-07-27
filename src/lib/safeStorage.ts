// localStorage / sessionStorage 在隐私模式 / 禁用存储 / 配额满时可能抛错，
// 统一封装 try/catch 容错，避免调用方需要重复兜底。
// 注意：本模块只做"读取/写入失败时返回 null / 静默"的兜底，
// 不做 JSON 解析（调用方按需自行 JSON.parse 并处理 SyntaxError）。

/**
 * 安全读取 localStorage，存储不可用时返回 null。
 */
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 安全写入 localStorage，存储不可用时静默失败。
 */
export function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 忽略存储不可用 */
  }
}

/**
 * 安全删除 localStorage 键，存储不可用时静默失败。
 */
export function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略存储不可用 */
  }
}
