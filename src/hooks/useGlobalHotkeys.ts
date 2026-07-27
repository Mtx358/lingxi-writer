import { useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { isOverlayOpen } from '@/utils/overlayState';

export interface HotkeyHandler {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description?: string;
}

export function useGlobalHotkeys(hotkeys: HotkeyHandler[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 输入法组合状态（中文输入选字阶段）下不拦截按键，避免方向键被误捕获
      if (e.isComposing || e.keyCode === 229) return;
      // O3: 浮层（搜索弹窗/提及面板/右键菜单等）打开时屏蔽所有全局快捷键，
      // 避免在浮层中按 Ctrl+S/Ctrl+K 等组合键同时触发后台动作造成交互混乱。
      // 浮层自身的 Esc/方向键由其内部 keydown 监听器独立处理。
      if (isOverlayOpen()) return;
      // 快捷键均需修饰键或 shift：无任何修饰键且无 shift 类快捷键时直接放行，
      // 避免对每次普通按键都遍历整个 hotkeys 数组
      if (!e.ctrlKey && !e.metaKey && !e.altKey && hotkeys.every(h => !h.shift)) return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      for (const hotkey of hotkeys) {
        const keyMatch = e.key.toLowerCase() === hotkey.key.toLowerCase();
        const ctrlMatch = hotkey.ctrl ? (e.ctrlKey || e.metaKey) : !e.ctrlKey && !e.metaKey;
        const shiftMatch = hotkey.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = hotkey.alt ? e.altKey : !e.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          // 输入框内仅放行带 Ctrl 的 k/s 快捷键（保存/搜索），其余组合键在输入态下不触发，
          // 白名单需同时校验修饰键，避免无修饰键的 'k'/'s'/'escape' 误穿透
          if (isInput && !(hotkey.ctrl && ['k', 's'].includes(hotkey.key.toLowerCase()))) {
            continue;
          }
          // 必须调用 preventDefault：Ctrl+S（浏览器保存对话框）、Ctrl+K（部分浏览器聚焦地址栏/搜索栏）
          // 等组合键若不阻止默认行为，会与 web 端运行时的浏览器原生行为冲突。
          e.preventDefault();
          hotkey.handler();
          return;
        }
      }
    },
    [hotkeys]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * 应用级快捷键：Ctrl+S 保存快照 + 落盘 + 调用方传入的额外快捷键（如 Ctrl+K 打开搜索）。
 * extraHotkeys 建议使用 useMemo 稳定引用，避免每次渲染重建监听器。
 */
export function useAppHotkeys(extraHotkeys: HotkeyHandler[] = []) {
  const saveVersion = useAppStore(s => s.saveVersion);
  const saveProject = useAppStore(s => s.saveProject);
  const currentChapterId = useAppStore(s => s.currentChapterId);

  // 用 useMemo 稳定 hotkeys 数组引用，避免每次渲染重建数组导致
  // handleKeyDown 依赖变化、keydown 监听器反复重注册
  const hotkeys = useMemo<HotkeyHandler[]>(() => [
    {
      key: 's',
      ctrl: true,
      handler: () => {
        // Ctrl+S 双重语义：先创建版本快照（供 undo/redo 与版本历史面板使用），
        // 再落盘到 storage（原实现仅 saveVersion 不落盘，用户按 Ctrl+S 后误以为已保存，
        // 实际刷新页面会丢失编辑）。saveProject 内部有 isSaving 互斥，频繁按 Ctrl+S 不会重复落盘。
        if (currentChapterId) {
          saveVersion(currentChapterId, '手动保存快照');
        }
        void saveProject();
      },
      description: '保存快照并落盘 (Ctrl+S)',
    },
    ...extraHotkeys,
  ], [saveVersion, saveProject, currentChapterId, extraHotkeys]);

  useGlobalHotkeys(hotkeys);
}

export default useGlobalHotkeys;