import { AlertTriangle } from 'lucide-react';

/**
 * 项目不存在的全屏占位组件。
 *
 * DashboardPage / ReviewPage / ExportPage 三个页面原先各自内联相同的
 * "项目不存在或已被删除" JSX（含 loading 分支与"返回首页"按钮），
 * 现统一收敛到此组件，避免后续修改时三处不一致。
 *
 * 用法：
 *   <ProjectNotFound loading={projectLoading} onBackHome={() => navigate('/')} />
 */
export interface ProjectNotFoundProps {
  /** true 时显示"加载中..."，false 时显示"项目不存在"提示与返回按钮 */
  loading?: boolean;
  /** "返回首页"按钮回调（通常 navigate('/')） */
  onBackHome: () => void;
}

export default function ProjectNotFound({ loading, onBackHome }: ProjectNotFoundProps) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-ink-950 gap-3">
      {loading ? (
        <div className="text-ink-400">加载中...</div>
      ) : (
        <>
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <div className="text-ink-300">项目不存在或已被删除</div>
          <button
            onClick={onBackHome}
            className="btn btn-primary text-sm"
          >
            返回首页
          </button>
        </>
      )}
    </div>
  );
}
