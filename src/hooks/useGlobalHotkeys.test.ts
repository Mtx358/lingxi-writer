/**
 * useGlobalHotkeys 测试
 *
 * 测试范围：
 * 1. 匹配的快捷键 → handler 调用 + preventDefault
 * 2. 不匹配的快捷键 → 不调用
 * 3. 无修饰键的纯字符 → 不遍历 hotkeys 数组（早返回）
 * 4. isComposing / keyCode=229 → 不拦截
 * 5. isOverlayOpen → 屏蔽所有快捷键
 * 6. 输入框聚焦时：仅 Ctrl+S/Ctrl+K 放行
 * 7. 多个 hotkeys：仅匹配的触发
 * 8. useAppHotkeys：Ctrl+S 调用 saveVersion + saveProject
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGlobalHotkeys, useAppHotkeys, type HotkeyHandler } from '@/hooks/useGlobalHotkeys';
import { pushOverlay, popOverlay, isOverlayOpen } from '@/utils/overlayState';
import { useAppStore } from '@/store/useAppStore';

function dispatchKey(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  target?: HTMLElement;
}) {
  const event = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'isComposing', { value: !!opts.isComposing, configurable: true });
  Object.defineProperty(event, 'keyCode', { value: opts.keyCode ?? 0, configurable: true });
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target, configurable: true });
  }
  document.dispatchEvent(event);
  return event;
}

function drainOverlay() {
  while (isOverlayOpen()) popOverlay();
}

describe('useGlobalHotkeys', () => {
  beforeEach(() => {
    drainOverlay();
  });

  describe('匹配与触发', () => {
    it('Ctrl+S 匹配 → handler 调用 + preventDefault', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      const event = dispatchKey({ key: 's', ctrlKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('Ctrl+K 匹配（key 大小写不敏感）', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 'k', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 'K', ctrlKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Cmd+S（macOS metaKey）等价于 Ctrl+S', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 's', metaKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Shift+A 匹配 shift 修饰键', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 'a', shift: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 'a', shiftKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Alt+X 匹配 alt 修饰键', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 'x', alt: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 'x', altKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('不匹配场景', () => {
    it('无修饰键的纯字符 → 直接返回（不调用任何 handler）', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 's' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('Ctrl+S 但 hotkey 未声明 ctrl → 不匹配', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 's', ctrlKey: true });
      expect(handler).not.toHaveBeenCalled();
    });

    it('key 不匹配 → 不调用', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 'x', ctrlKey: true });
      expect(handler).not.toHaveBeenCalled();
    });

    it('多个 hotkeys 仅匹配的触发', () => {
      const sHandler = vi.fn();
      const kHandler = vi.fn();
      const hotkeys: HotkeyHandler[] = [
        { key: 's', ctrl: true, handler: sHandler },
        { key: 'k', ctrl: true, handler: kHandler },
      ];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 'k', ctrlKey: true });
      expect(sHandler).not.toHaveBeenCalled();
      expect(kHandler).toHaveBeenCalledTimes(1);
    });

    it('hotkeys 数组为空 → 不抛错', () => {
      const { unmount } = renderHook(() => useGlobalHotkeys([]));
      expect(() => dispatchKey({ key: 's', ctrlKey: true })).not.toThrow();
      unmount();
    });
  });

  describe('输入法组合状态', () => {
    it('isComposing=true → 不拦截', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 's', ctrlKey: true, isComposing: true });
      expect(handler).not.toHaveBeenCalled();
    });

    it('keyCode=229（输入法选字阶段）→ 不拦截', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      dispatchKey({ key: 's', ctrlKey: true, keyCode: 229 });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('浮层打开时屏蔽', () => {
    it('isOverlayOpen=true → 所有快捷键被屏蔽', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));

      pushOverlay();
      try {
        dispatchKey({ key: 's', ctrlKey: true });
        expect(handler).not.toHaveBeenCalled();
      } finally {
        popOverlay();
      }
    });
  });

  describe('输入框聚焦时的白名单', () => {
    it('输入框内 Ctrl+S → 仍触发（白名单）', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      const input = document.createElement('input');
      document.body.appendChild(input);
      dispatchKey({ key: 's', ctrlKey: true, target: input });
      expect(handler).toHaveBeenCalledTimes(1);
      document.body.removeChild(input);
    });

    it('输入框内 Ctrl+K → 仍触发（白名单）', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 'k', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      const input = document.createElement('input');
      document.body.appendChild(input);
      dispatchKey({ key: 'k', ctrlKey: true, target: input });
      expect(handler).toHaveBeenCalledTimes(1);
      document.body.removeChild(input);
    });

    it('输入框内 Ctrl+X（非白名单）→ 不触发', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 'x', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      const input = document.createElement('input');
      document.body.appendChild(input);
      dispatchKey({ key: 'x', ctrlKey: true, target: input });
      expect(handler).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('textarea 内 Ctrl+S → 仍触发', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      dispatchKey({ key: 's', ctrlKey: true, target: textarea });
      expect(handler).toHaveBeenCalledTimes(1);
      document.body.removeChild(textarea);
    });

    it('contentEditable 元素内 Ctrl+S → 仍触发', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      renderHook(() => useGlobalHotkeys(hotkeys));
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);
      dispatchKey({ key: 's', ctrlKey: true, target: div });
      expect(handler).toHaveBeenCalledTimes(1);
      document.body.removeChild(div);
    });
  });

  describe('卸载清理', () => {
    it('unmount 后移除监听器，按键不再触发 handler', () => {
      const handler = vi.fn();
      const hotkeys: HotkeyHandler[] = [{ key: 's', ctrl: true, handler }];
      const { unmount } = renderHook(() => useGlobalHotkeys(hotkeys));
      unmount();
      dispatchKey({ key: 's', ctrlKey: true });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('useAppHotkeys', () => {
  beforeEach(() => {
    drainOverlay();
    // 重置 store 状态：清空 currentChapterId，mock saveVersion/saveProject
    useAppStore.setState({
      currentChapterId: null,
      saveVersion: vi.fn(),
      saveProject: vi.fn().mockResolvedValue(true),
    });
  });

  it('Ctrl+S → 调用 saveVersion（仅当 currentChapterId 非空）+ saveProject', () => {
    const saveVersionMock = vi.fn();
    const saveProjectMock = vi.fn().mockResolvedValue(true);
    useAppStore.setState({
      currentChapterId: 'ch1',
      saveVersion: saveVersionMock,
      saveProject: saveProjectMock,
    });
    renderHook(() => useAppHotkeys());
    dispatchKey({ key: 's', ctrlKey: true });
    expect(saveVersionMock).toHaveBeenCalledWith('ch1', '手动保存快照');
    expect(saveProjectMock).toHaveBeenCalledTimes(1);
  });

  it('currentChapterId 为 null 时 → 不调用 saveVersion，但仍调用 saveProject', () => {
    const saveVersionMock = vi.fn();
    const saveProjectMock = vi.fn().mockResolvedValue(true);
    useAppStore.setState({
      currentChapterId: null,
      saveVersion: saveVersionMock,
      saveProject: saveProjectMock,
    });
    renderHook(() => useAppHotkeys());
    dispatchKey({ key: 's', ctrlKey: true });
    expect(saveVersionMock).not.toHaveBeenCalled();
    expect(saveProjectMock).toHaveBeenCalledTimes(1);
  });

  it('extraHotkeys 中的 Ctrl+K → 触发对应 handler', () => {
    const extraHandler = vi.fn();
    const extra: HotkeyHandler[] = [{ key: 'k', ctrl: true, handler: extraHandler }];
    renderHook(() => useAppHotkeys(extra));
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(extraHandler).toHaveBeenCalledTimes(1);
  });
});

// 引入以避免 "unused import" lint 警告，同时验证 drainOverlay 工具函数
void isOverlayOpen;
