import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义降级 UI；不传则使用全局错误页 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 错误时的回调，可用于上报 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 可复用的 React Error Boundary
 * - 全局使用：包裹整个应用，兜底所有未捕获异常
 * - 局部使用：包裹编辑器/AI面板等复杂组件，出错时只降级该区域而非白屏整页
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      // 全局兜底 UI
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-ink-950">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-ink-100 mb-2">应用发生错误</h2>
          <p className="text-ink-400 text-sm mb-6 max-w-md text-center">
            抱歉，应用出现了意外问题。请保存您的工作并重启应用。
          </p>
          <button onClick={() => window.location.reload()} className="btn btn-primary px-6 py-2">
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
