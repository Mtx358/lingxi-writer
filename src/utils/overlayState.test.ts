/**
 * overlayState 测试
 *
 * 重点验证：
 * 1. 计数器递增/递减基础语义
 * 2. 仅在 0↔N 边界变化时通知（避免中间状态抖动）
 * 3. 下限保护：popOverlay 不会让计数器变负
 * 4. onOverlayChange 订阅/取消订阅正确生效
 * 5. 监听器抛错被吞掉，不影响其他监听器
 */
import { pushOverlay, popOverlay, isOverlayOpen, onOverlayChange } from '@/utils/overlayState';

// 模块级 overlayCount 是私有状态，测试间通过 drainOverlay 清空到 0
async function drainOverlay() {
  while (isOverlayOpen()) {
    popOverlay();
  }
}

describe('overlayState', () => {
  // 每个测试前确保计数器归零，避免用例间串扰
  beforeEach(() => {
    drainOverlay();
  });

  afterEach(() => {
    drainOverlay();
  });

  describe('pushOverlay / isOverlayOpen', () => {
    it('初始状态 isOverlayOpen → false', () => {
      expect(isOverlayOpen()).toBe(false);
    });

    it('pushOverlay 一次 → isOverlayOpen true', () => {
      pushOverlay();
      expect(isOverlayOpen()).toBe(true);
    });

    it('pushOverlay 多次仍为 true（嵌套浮层场景）', () => {
      pushOverlay();
      pushOverlay();
      pushOverlay();
      expect(isOverlayOpen()).toBe(true);
    });
  });

  describe('popOverlay / 下限保护', () => {
    it('popOverlay 在 0 状态下不抛错（下限保护）', () => {
      expect(() => popOverlay()).not.toThrow();
      expect(isOverlayOpen()).toBe(false);
    });

    it('push 3 次 pop 3 次后归零', () => {
      pushOverlay();
      pushOverlay();
      pushOverlay();
      popOverlay();
      expect(isOverlayOpen()).toBe(true);
      popOverlay();
      expect(isOverlayOpen()).toBe(true);
      popOverlay();
      expect(isOverlayOpen()).toBe(false);
    });

    it('push 2 次 pop 3 次：仍为 false（不会负数）', () => {
      pushOverlay();
      pushOverlay();
      popOverlay();
      popOverlay();
      popOverlay(); // 多 pop 一次
      expect(isOverlayOpen()).toBe(false);
    });
  });

  describe('onOverlayChange 订阅', () => {
    it('0 → 1 时触发监听器一次', () => {
      const cb = vi.fn();
      const unsub = onOverlayChange(cb);
      pushOverlay();
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('1 → 2 时不再触发（避免中间状态抖动）', () => {
      const cb = vi.fn();
      pushOverlay();
      const unsub = onOverlayChange(cb);
      pushOverlay();
      expect(cb).not.toHaveBeenCalled();
      unsub();
    });

    it('2 → 1 时不再触发', () => {
      const cb = vi.fn();
      pushOverlay();
      pushOverlay();
      const unsub = onOverlayChange(cb);
      popOverlay();
      expect(cb).not.toHaveBeenCalled();
      unsub();
    });

    it('1 → 0 时触发监听器一次（最后一个浮层关闭）', () => {
      const cb = vi.fn();
      pushOverlay();
      const unsub = onOverlayChange(cb);
      popOverlay();
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsubscribe 后不再触发', () => {
      const cb = vi.fn();
      const unsub = onOverlayChange(cb);
      unsub();
      pushOverlay();
      expect(cb).not.toHaveBeenCalled();
    });

    it('unsubscribe 返回的函数移除监听器（重复 unsubscribe 无副作用）', () => {
      const cb = vi.fn();
      const unsub = onOverlayChange(cb);
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it('多个监听器同时订阅都会触发', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const cb3 = vi.fn();
      const u1 = onOverlayChange(cb1);
      const u2 = onOverlayChange(cb2);
      const u3 = onOverlayChange(cb3);
      pushOverlay();
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
      u1();
      u2();
      u3();
    });

    it('监听器抛错被吞掉且不影响后续监听器（防御式通知）', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const badCb = vi.fn(() => {
        throw new Error('listener crashed');
      });
      const goodCb = vi.fn();
      const u1 = onOverlayChange(badCb);
      const u2 = onOverlayChange(goodCb);
      pushOverlay();
      // badCb 抛错后 goodCb 仍被调用
      expect(badCb).toHaveBeenCalledTimes(1);
      expect(goodCb).toHaveBeenCalledTimes(1);
      // 控制台 warn 被调用（错误被记录但未冒泡）
      expect(consoleWarnSpy).toHaveBeenCalled();
      u1();
      u2();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('完整生命周期', () => {
    it('模拟浮层嵌套场景：ContextMenu → MentionPanel', () => {
      const events: string[] = [];
      const unsub = onOverlayChange(() => events.push('change'));

      // 用户右键打开 ContextMenu
      pushOverlay();
      expect(events).toEqual(['change']);
      expect(isOverlayOpen()).toBe(true);

      // 用户在 ContextMenu 中触发 MentionPanel
      pushOverlay();
      // 1→2 不通知
      expect(events).toEqual(['change']);

      // 关闭 MentionPanel
      popOverlay();
      // 2→1 不通知
      expect(events).toEqual(['change']);

      // 关闭 ContextMenu
      popOverlay();
      // 1→0 通知
      expect(events).toEqual(['change', 'change']);
      expect(isOverlayOpen()).toBe(false);

      unsub();
    });
  });
});
