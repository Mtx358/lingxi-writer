import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration: number;
}

interface ToastStore {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id' | 'duration'> & { duration?: number }) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const DEFAULT_DURATION = 4000;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = uuidv4();
    const newToast: ToastMessage = {
      ...toast,
      id,
      duration: toast.duration ?? DEFAULT_DURATION,
    };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    
    // 自动移除
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, newToast.duration);
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clearToasts: () => {
    set({ toasts: [] });
  },
}));

// 便捷方法
export const toast = {
  success: (title: string, description?: string) => {
    useToastStore.getState().addToast({ type: 'success', title, description });
  },
  error: (title: string, description?: string) => {
    useToastStore.getState().addToast({ type: 'error', title, description });
  },
  warning: (title: string, description?: string) => {
    useToastStore.getState().addToast({ type: 'warning', title, description });
  },
  info: (title: string, description?: string) => {
    useToastStore.getState().addToast({ type: 'info', title, description });
  },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            px-4 py-3 rounded-lg shadow-lg max-w-sm animate-slide-up
            ${toast.type === 'success' ? 'bg-emerald-900/90 border border-emerald-700' : ''}
            ${toast.type === 'error' ? 'bg-red-900/90 border border-red-700' : ''}
            ${toast.type === 'warning' ? 'bg-amber-900/90 border border-amber-700' : ''}
            ${toast.type === 'info' ? 'bg-ink-800/90 border border-ink-600' : ''}
          `}
          onClick={() => removeToast(toast.id)}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-100">{toast.title}</p>
              {toast.description && (
                <p className="text-xs text-ink-300 mt-1">{toast.description}</p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeToast(toast.id);
              }}
              className="text-ink-400 hover:text-ink-200"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default toast;