/**
 * useTheme 测试
 *
 * 测试范围：
 * 1. 初始主题：localStorage 优先 / prefers-color-scheme 兜底
 * 2. localStorage 抛 SecurityError（Safari 隐私模式）→ fallback 到系统主题
 * 3. toggleTheme 切换 light↔dark
 * 4. isDark 派生布尔值正确
 * 5. useLayoutEffect 应用 class 到 document.documentElement
 * 6. useLayoutEffect 持久化到 localStorage
 * 7. localStorage.setItem 抛 QuotaExceededError → 静默忽略不崩溃
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useTheme } from '@/hooks/useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    // 默认 prefers-color-scheme: light
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: /dark/.test(query) ? false : true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  describe('初始主题', () => {
    it('localStorage 有 theme=dark → 初始化为 dark', () => {
      localStorage.setItem('theme', 'dark');
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('dark');
      expect(result.current.isDark).toBe(true);
    });

    it('localStorage 有 theme=light → 初始化为 light', () => {
      localStorage.setItem('theme', 'light');
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');
      expect(result.current.isDark).toBe(false);
    });

    it('localStorage 无 theme → 回退到 prefers-color-scheme', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');
    });

    it('prefers-color-scheme: dark → 初始化为 dark', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: /dark/.test(query) ? true : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('dark');
    });

    it('localStorage.getItem 抛错 → fallback 到系统主题且不崩溃', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
        throw new DOMException('SecurityError', 'SecurityError');
      });
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('toggleTheme', () => {
    it('light → dark', () => {
      localStorage.setItem('theme', 'light');
      const { result } = renderHook(() => useTheme());
      act(() => result.current.toggleTheme());
      expect(result.current.theme).toBe('dark');
      expect(result.current.isDark).toBe(true);
    });

    it('dark → light', () => {
      localStorage.setItem('theme', 'dark');
      const { result } = renderHook(() => useTheme());
      act(() => result.current.toggleTheme());
      expect(result.current.theme).toBe('light');
      expect(result.current.isDark).toBe(false);
    });

    it('toggleTheme 是稳定引用（useCallback 无依赖）', () => {
      const { result, rerender } = renderHook(() => useTheme());
      const first = result.current.toggleTheme;
      rerender();
      expect(result.current.toggleTheme).toBe(first);
    });
  });

  describe('副作用：documentElement class 与 localStorage 持久化', () => {
    it('theme=dark → documentElement 添加 dark class、移除 light', () => {
      localStorage.setItem('theme', 'dark');
      renderHook(() => useTheme());
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });

    it('theme=light → documentElement 添加 light class、移除 dark', () => {
      localStorage.setItem('theme', 'light');
      renderHook(() => useTheme());
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('toggleTheme 后 documentElement class 同步更新', () => {
      localStorage.setItem('theme', 'light');
      const { result } = renderHook(() => useTheme());
      expect(document.documentElement.classList.contains('light')).toBe(true);
      act(() => result.current.toggleTheme());
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });

    it('toggleTheme 后 localStorage 同步更新', () => {
      localStorage.setItem('theme', 'light');
      const { result } = renderHook(() => useTheme());
      act(() => result.current.toggleTheme());
      expect(localStorage.getItem('theme')).toBe('dark');
    });

    it('localStorage.setItem 抛 QuotaExceededError → 静默忽略不崩溃', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException(' quota exceeded', 'QuotaExceededError');
      });
      const { result } = renderHook(() => useTheme());
      // toggleTheme 不会因 setItem 抛错而崩溃
      act(() => result.current.toggleTheme());
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});
