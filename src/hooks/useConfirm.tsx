// 本文件同时导出 Zustand store、便捷 confirm 方法与 ConfirmDialog 组件，
// 是 React + Zustand 确认弹窗系统的标准模式；fast-refresh 警告为已知取舍。
/* eslint-disable react-refresh/only-export-components */
import { create } from 'zustand';
import { BaseModal } from '@/components/BaseModal';

interface ConfirmState {
  isOpen: boolean;
  message: string;
  title: string;
  resolve?: (ok: boolean) => void;
  openConfirm: (message: string, title?: string) => Promise<boolean>;
  close: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  isOpen: false,
  message: '',
  title: '确认操作',
  resolve: undefined,
  openConfirm: (message, title) => {
    // 如果已有 confirm 打开，先关闭旧的（拒绝），避免 Promise 永久挂起
    const existing = get().resolve;
    if (existing) existing(false);
    return new Promise<boolean>(resolve => {
      set({ isOpen: true, message, title: title || '确认操作', resolve });
    });
  },
  close: (ok) => {
    const resolve = get().resolve;
    set({ isOpen: false, resolve: undefined });
    resolve?.(ok);
  },
}));

// 便捷方法：与原生 confirm 同名（小写），便于全局替换；
// 区别在于返回 Promise，调用方需 await。Electron 中原生 confirm 会阻塞主进程、
// 样式不一致且 a11y 差，统一改用本函数驱动 ConfirmDialog 组件。
export function confirm(message: string, title?: string): Promise<boolean> {
  return useConfirmStore.getState().openConfirm(message, title);
}

export function ConfirmDialog() {
  const isOpen = useConfirmStore(s => s.isOpen);
  const message = useConfirmStore(s => s.message);
  const title = useConfirmStore(s => s.title);
  const close = useConfirmStore(s => s.close);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => close(false)}
      title={title}
      width="sm"
      closeOnOverlayClick={false}
    >
      <p className="text-ink-300 text-sm whitespace-pre-line mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => close(false)}
          className="px-4 py-2 rounded-lg border border-ink-600 text-ink-300 hover:bg-ink-800 transition-colors"
        >
          取消
        </button>
        <button
          onClick={() => close(true)}
          className="px-4 py-2 rounded-lg bg-amber-500 text-ink-900 hover:bg-amber-400 transition-colors font-medium"
        >
          确定
        </button>
      </div>
    </BaseModal>
  );
}

export default ConfirmDialog;
