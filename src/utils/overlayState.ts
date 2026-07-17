/**
 * 浮层状态追踪（O3：浮层打开时屏蔽编辑器与全局快捷键）
 *
 * 背景：搜索弹窗、提及面板、右键菜单等浮层打开时，方向键、Enter、Ctrl+Z 等
 * 按键可能透传到编辑器或触发全局快捷键，造成"按一下方向键既移动浮层选中项
 * 又移动编辑器光标"的交互混乱。
 *
 * 方案：用模块级计数器记录当前打开的浮层数量。所有浮层在 mount/unmount 时
 * 调用 pushOverlay/popOverlay；useGlobalHotkeys 与 TiptapEditor 通过
 * isOverlayOpen 判断是否需要屏蔽按键。
 *
 * 计数器而非布尔：多个浮层可能嵌套打开（如 MentionPanel 触发自 ContextMenu），
 * 只有全部关闭后才解除屏蔽。
 */

let overlayCount = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try {
      cb();
    } catch (e) {
      console.warn('overlayState listener error:', e);
    }
  }
}

/** 浮层 mount 时调用，标记有浮层打开 */
export function pushOverlay(): void {
  overlayCount++;
  if (overlayCount === 1) notify();
}

/** 浮层 unmount 时调用，标记浮层关闭。计数器有下限保护，不会出现负数 */
export function popOverlay(): void {
  if (overlayCount > 0) {
    overlayCount--;
    if (overlayCount === 0) notify();
  }
}

/** 当前是否有任意浮层打开 */
export function isOverlayOpen(): boolean {
  return overlayCount > 0;
}

/** 订阅浮层状态变化，返回取消订阅函数 */
export function onOverlayChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
