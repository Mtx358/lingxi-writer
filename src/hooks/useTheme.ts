import { useState, useLayoutEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Safari 隐私模式下 localStorage 访问会抛 SecurityError，需 try/catch 兜底，
    // 失败时回退到 prefers-color-scheme 默认主题，避免 hook 抛错导致整树白屏
    try {
      const savedTheme = localStorage.getItem('theme') as Theme;
      if (savedTheme) {
        return savedTheme;
      }
    } catch (e) {
      console.warn('localStorage.getItem failed, falling back to system theme:', e);
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    // Safari 隐私模式 / 配额满时 setItem 会抛 QuotaExceededError，静默忽略避免影响 UI
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      console.warn('localStorage.setItem failed, theme will not persist:', e);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  return {
    theme,
    toggleTheme,
    isDark: theme === 'dark'
  };
}
