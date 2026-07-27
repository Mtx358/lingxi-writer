import { useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
}

const WIDTH_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

// 模块级引用计数：跟踪当前打开的 BaseModal 数量，避免嵌套模态互相破坏 body.overflow
let modalOpenCount = 0;
// 保存 body.overflow 的原始值，关闭最后一个模态时恢复（避免破坏外部库设置的原有样式）
let savedBodyOverflow = '';

export function BaseModal({
  isOpen,
  onClose,
  title,
  children,
  width = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
}: BaseModalProps) {
  // useFocusTrap 接管焦点管理：打开时聚焦首个可聚焦元素、Tab 在模态内循环、关闭时恢复焦点。
  // 与 Esc 关闭（handleKeyDown）配合满足 WCAG 2.1 SC 2.1.2（Esc 可退出，非键盘陷阱）。
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen);
  // 用 React 18 useId 生成唯一 ID，避免多模态间 id="modal-title" 冲突
  const titleId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        // 阻止其他嵌套模态的 keydown 监听器同时触发，确保一次 Esc 只关闭一个模态
        e.stopImmediatePropagation();
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  // body.overflow 引用计数（焦点管理由 useFocusTrap 负责，此处仅管滚动锁定）
  useEffect(() => {
    if (!isOpen) return;

    if (modalOpenCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
    }
    modalOpenCount++;
    document.body.style.overflow = 'hidden';

    return () => {
      modalOpenCount--;
      if (modalOpenCount <= 0) {
        modalOpenCount = 0;
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [isOpen]);

  // 键盘事件：捕获阶段注册，配合 stopImmediatePropagation 避免嵌套模态下多个监听器同时触发
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnOverlayClick) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`card p-6 w-full mx-4 animate-slide-up ${WIDTH_CLASSES[width]} outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between mb-4">
            {title && (
              <h2 id={titleId} className="text-lg font-semibold text-ink-100">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export default BaseModal;
