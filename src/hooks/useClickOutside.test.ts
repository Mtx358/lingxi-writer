/**
 * useClickOutside 测试
 *
 * 测试范围：
 * 1. 点击 ref 外 → handler 调用
 * 2. 点击 ref 内 → handler 不调用
 * 3. enabled=false → 不监听
 * 4. enabled 从 false 切到 true → 重新监听
 * 5. handler 引用每次渲染更新（handlerRef 模式）
 * 6. 卸载后移除监听器
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { RefObject } from 'react';

describe('useClickOutside', () => {
  // 使用稳定的对象 ref（绕开 useRef）：renderHook 不会真正渲染 DOM，
  // 直接把真实的 div 赋给 ref.current，让 hook 内部 ref.current.contains() 生效
  function setup(enabled: boolean = true) {
    const handler = vi.fn();
    const inside = document.createElement('div');
    document.body.appendChild(inside);
    const ref = { current: inside } as RefObject<HTMLDivElement>;

    const { rerender, unmount } = renderHook(
      ({ enabled }) => useClickOutside(ref, handler, enabled),
      { initialProps: { enabled } },
    );
    return { handler, ref, inside, rerender, unmount };
  }

  function dispatchMouseDown(target: Node) {
    const event = new MouseEvent('mousedown', { bubbles: true });
    target.dispatchEvent(event);
    return event;
  }

  describe('点击边界', () => {
    it('点击 ref 外部 → handler 被调用', () => {
      const { handler, inside } = setup(true);
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      dispatchMouseDown(outside);
      expect(handler).toHaveBeenCalledTimes(1);

      document.body.removeChild(outside);
      document.body.removeChild(inside);
    });

    it('点击 ref 内部 → handler 不被调用', () => {
      const { handler, inside } = setup(true);
      const child = document.createElement('span');
      inside.appendChild(child);

      dispatchMouseDown(child);
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(inside);
    });

    it('点击 ref 自身 → handler 不被调用', () => {
      const { handler, inside } = setup(true);

      dispatchMouseDown(inside);
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(inside);
    });
  });

  describe('enabled 开关', () => {
    it('enabled=false → 不监听点击', () => {
      const { handler, inside } = setup(false);
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      dispatchMouseDown(outside);
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(outside);
      document.body.removeChild(inside);
    });

    it('从 false 切到 true → 开始监听', () => {
      const { handler, inside, rerender } = setup(false);
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      dispatchMouseDown(outside);
      expect(handler).not.toHaveBeenCalled();

      rerender({ enabled: true });
      dispatchMouseDown(outside);
      expect(handler).toHaveBeenCalledTimes(1);

      document.body.removeChild(outside);
      document.body.removeChild(inside);
    });

    it('从 true 切到 false → 停止监听', () => {
      const { handler, inside, rerender } = setup(true);
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      dispatchMouseDown(outside);
      expect(handler).toHaveBeenCalledTimes(1);

      rerender({ enabled: false });
      dispatchMouseDown(outside);
      expect(handler).toHaveBeenCalledTimes(1); // 仍是 1，未增加

      document.body.removeChild(outside);
      document.body.removeChild(inside);
    });
  });

  describe('handler 引用更新', () => {
    it('每次渲染使用最新的 handler（handlerRef 模式）', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const inside = document.createElement('div');
      document.body.appendChild(inside);
      const ref = { current: inside } as RefObject<HTMLDivElement>;

      const { rerender } = renderHook(
        ({ handler }) => useClickOutside(ref, handler, true),
        { initialProps: { handler: handler1 } },
      );
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      // 切换到 handler2 后再点击
      rerender({ handler: handler2 });
      dispatchMouseDown(outside);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);

      document.body.removeChild(outside);
      document.body.removeChild(inside);
    });
  });

  describe('卸载清理', () => {
    it('unmount 后移除监听器，点击不再触发 handler', () => {
      const { handler, inside, unmount } = setup(true);
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      unmount();
      dispatchMouseDown(outside);
      expect(handler).not.toHaveBeenCalled();

      document.body.removeChild(outside);
      document.body.removeChild(inside);
    });
  });
});
