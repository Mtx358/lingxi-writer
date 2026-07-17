import { useEffect, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import { ToastContainer, toast } from "@/hooks/useToast";
import ErrorBoundary from "@/components/ErrorBoundary";

// 路由级懒加载：编辑/审稿/导出页按需加载，减小首屏 chunk 体积
const EditorPage = lazy(() => import("@/pages/EditorPage"));
const ReviewPage = lazy(() => import("@/pages/ReviewPage"));
const ExportPage = lazy(() => import("@/pages/ExportPage"));

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
            <Route path="/" element={<Home />} />
            <Route path="/project/:projectId/editor" element={<EditorPage />} />
            <Route path="/project/:projectId/review" element={<ReviewPage />} />
            <Route path="/project/:projectId/export" element={<ExportPage />} />
          </Routes>
        </Suspense>
      </Router>
      <ToastContainer />
    </ErrorBoundary>
  );
}
