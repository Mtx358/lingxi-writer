import { useEffect, lazy, Suspense, ReactNode } from 'react';
import { HashRouter as Router, Routes, Route, useParams, useNavigate } from "react-router-dom";
import Home from "@/pages/Home";
import { ToastContainer, toast } from "@/hooks/useToast";
import { ConfirmDialog } from "@/hooks/useConfirm";
import ErrorBoundary from "@/components/ErrorBoundary";

// 路由级懒加载：编辑/审稿/导出/总控页按需加载，减小首屏 chunk 体积
const EditorPage = lazy(() => import("@/pages/EditorPage"));
const ReviewPage = lazy(() => import("@/pages/ReviewPage"));
const ExportPage = lazy(() => import("@/pages/ExportPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));

function PageFallback() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-ink-900 text-ink-400">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
        <span className="text-sm">加载中…</span>
      </div>
    </div>
  );
}

// 路由级错误降级 UI：单页异常时显示，不白屏整应用
function RouteErrorFallback({
  error,
  onBack,
  onRetry,
}: {
  error: Error;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-ink-950">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-ink-100 mb-2">页面发生错误</h2>
      <p className="text-ink-400 text-sm mb-6 max-w-md text-center">
        该页面出现了意外问题。可以返回首页或重试。
      </p>
      {import.meta.env.DEV && (
        <pre className="text-xs text-red-300/70 max-w-lg mb-6 overflow-auto whitespace-pre-wrap break-all">
          {error.message}
        </pre>
      )}
      <div className="flex gap-3">
        <button onClick={onBack} className="px-6 py-2 rounded-lg border border-ink-600 text-ink-200 hover:bg-ink-800 transition-colors">
          返回首页
        </button>
        <button onClick={onRetry} className="px-6 py-2 rounded-lg bg-amber-500 text-ink-900 hover:bg-amber-400 transition-colors font-medium">
          重试
        </button>
      </div>
    </div>
  );
}

// 路由级 ErrorBoundary：包裹每个 Route 元素，单点异常只降级当前页而非白屏整应用
// resetKey 使用 projectId，切换项目时自动重置错误状态
function RouteBoundary({ children }: { children: ReactNode }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  return (
    <ErrorBoundary
      resetKey={projectId}
      fallback={(error, reset) => (
        <RouteErrorFallback error={error} onBack={() => navigate('/')} onRetry={reset} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export default function App() {
  // 应用启动时检查崩溃恢复
  useEffect(() => {
    if (window.electronAPI?.system?.checkCrashRecovery) {
      window.electronAPI.system.checkCrashRecovery()
        .then(result => {
          if (result.recovered && result.projects.length > 0) {
            toast.info('已恢复异常退出的数据', `恢复了 ${result.projects.length} 个项目的最后保存状态`);
          }
        })
        .catch(err => console.warn('Crash recovery check failed:', err));
    }
  }, []);

  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<RouteBoundary><Home /></RouteBoundary>} />
            <Route path="/project/:projectId/editor" element={<RouteBoundary><EditorPage /></RouteBoundary>} />
            <Route path="/project/:projectId/review" element={<RouteBoundary><ReviewPage /></RouteBoundary>} />
            <Route path="/project/:projectId/export" element={<RouteBoundary><ExportPage /></RouteBoundary>} />
            <Route path="/project/:projectId/dashboard" element={<RouteBoundary><DashboardPage /></RouteBoundary>} />
          </Routes>
        </Suspense>
      </Router>
      <ToastContainer />
      <ConfirmDialog />
    </ErrorBoundary>
  );
}
