import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Users,
  Globe,
  Flag,
  Search,
  Home,
  Save,
  Download,
  BarChart3,
  History,
  Lightbulb,
  FileText,
  BookMarked,
  AlertTriangle,
  Wand2,
  Settings,
  IdCard,
  Map,
  GitBranch,
  CalendarClock,
  LayoutDashboard,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import { useAppHotkeys, type HotkeyHandler } from '@/hooks/useGlobalHotkeys';
import { READING_SPEED_WPM } from '@/constants/config';
import OutlinePanel from '@/components/editor/OutlinePanel';
import TiptapEditor from '@/components/editor/TiptapEditor';
import AIPanel from '@/components/editor/AIPanel';
import CharactersPanel from '@/components/editor/CharactersPanel';
import SettingsPanel from '@/components/editor/SettingsPanel';
import ForeshadowPanel from '@/components/editor/ForeshadowPanel';
import MaterialsPanel from '@/components/editor/MaterialsPanel';
// 灵犀助手域面板：4 个模块仅在切到对应右侧 tab 时才渲染，与 OutlinePolishPanel 同样
// 使用懒加载降低首屏代码体积
const CoreSettingCardPanel = lazy(() => import('@/components/editor/CoreSettingCardPanel'));
const BlueprintPanel = lazy(() => import('@/components/editor/BlueprintPanel'));
const SubplotPanel = lazy(() => import('@/components/editor/SubplotPanel'));
const UpdateSchedulePanel = lazy(() => import('@/components/editor/UpdateSchedulePanel'));
// OutlinePolishPanel 含 8 个 tab、报告渲染、多个子组件，体积较大但仅在用户切到
// 左侧"打磨"tab 才显示，懒加载可让首屏不拉取该部分代码
const OutlinePolishPanel = lazy(() => import('@/components/editor/OutlinePolishPanel'));
// 以下 5 个均为条件渲染的抽屉/模态，用户不点开就永远不渲染，懒加载收益最大
const VersionHistoryPanel = lazy(() => import('@/components/editor/VersionHistoryPanel'));
const ConflictPanel = lazy(() => import('@/components/editor/ConflictPanel'));
const SearchModal = lazy(() => import('@/components/SearchModal'));
const SettingsModal = lazy(() => import('@/components/SettingsModal'));
const InteractiveTour = lazy(() => import('@/components/InteractiveTour'));
import type { TourStep } from '@/components/InteractiveTour';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';

// 条件渲染组件的统一加载占位（轻量，避免空白闪烁）
function ModalFallback() {
  return (
    <div className="flex items-center justify-center p-8 text-ink-500 text-sm">
      <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
    </div>
  );
}

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  // 12 个字段集中订阅：useShallow 浅比较，任一字段变化才触发重渲染。
  // 数据字段（projects/chapters/currentChapterId/lastSavedAt/chapterCount）+ UI 状态
  // （leftPanelCollapsed/rightPanelCollapsed/rightPanelTab）+ 5 个稳定 action setter，
  // 浅比较对 action 永远命中缓存；对基本类型字段按值比较；对数组/对象按引用比较。
  const {
    projects,
    chapters,
    currentChapterId,
    leftPanelCollapsed,
    rightPanelCollapsed,
    rightPanelTab,
    setLeftPanelCollapsed,
    setRightPanelCollapsed,
    setRightPanelTab,
    loadProjects,
    openProject,
    lastSavedAt,
    chapterCount,
  } = useAppStore(
    useShallow(s => ({
      projects: s.projects,
      chapters: s.chapters,
      currentChapterId: s.currentChapterId,
      leftPanelCollapsed: s.leftPanelCollapsed,
      rightPanelCollapsed: s.rightPanelCollapsed,
      rightPanelTab: s.rightPanelTab,
      setLeftPanelCollapsed: s.setLeftPanelCollapsed,
      setRightPanelCollapsed: s.setRightPanelCollapsed,
      setRightPanelTab: s.setRightPanelTab,
      loadProjects: s.loadProjects,
      openProject: s.openProject,
      lastSavedAt: s.lastSavedAt,
      // P-L2: 章节计数改为 selector 内计算，zustand 仅在返回值（基本类型）变化时重算/重渲染，
      // 避免每次 render 都 filter chapters
      chapterCount: s.chapters.filter(c => c.levelType === 'chapter').length,
    })),
  );

  const [showSearch, setShowSearch] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [showConflictPanel, setShowConflictPanel] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<'outline' | 'polish'>('outline');
  const [showTour, setShowTour] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // O4: 引导步骤。prepare 回调在进入该步前自动展开/激活目标面板，
  // 避免面板收起时 getBoundingClientRect 返回 0 宽高导致引导跳过该步。
  // setLeft/RightPanelCollapsed、setRightPanelTab 均为 Zustand setter，引用稳定，补全依赖零成本。
  const editorTourSteps = useMemo<TourStep[]>(() => [
    {
      selector: '[data-tour="outline-panel"]',
      title: '大纲面板',
      description: '左侧是作品大纲，管理章节结构，支持拖拽排序与多级目录。点击章节即可切换编辑。',
      placement: 'right',
      prepare: () => setLeftPanelCollapsed(false),
    },
    {
      selector: '[data-tour="editor-area"]',
      title: '编辑区',
      description: '这里是你的主创作区，所见即所得。输入 @ 可快速引用角色/设定，选中文字会呼出 AI 续写菜单。',
      placement: 'bottom',
    },
    {
      selector: '[data-tour="right-panel"]',
      title: '右侧面板',
      description: '切换 AI、角色、设定、伏笔、素材标签，所有辅助工具集中在此。',
      placement: 'left',
      prepare: () => setRightPanelCollapsed(false),
    },
    {
      selector: '[data-tour="ai-panel"]',
      title: 'AI 助手',
      description: '智能续写、扩写、润色、换视角。你始终是主导者，AI 只提供建议，由你决定是否采纳。',
      placement: 'left',
      prepare: () => {
        setRightPanelCollapsed(false);
        setRightPanelTab('ai');
      },
    },
    {
      selector: '[data-tour="version-history"]',
      title: '版本历史',
      description: '随时保存版本，支持版本间 Diff 对比，再也不怕改坏稿子。',
      placement: 'bottom',
    },
    {
      selector: '[data-tour="materials"]',
      title: '素材库',
      description: '收集灵感、参考资料。写作时随手取用，让创作更高效。',
      placement: 'bottom',
      prepare: () => {
        setRightPanelCollapsed(false);
        setRightPanelTab('materials');
      },
    },
  ], [setLeftPanelCollapsed, setRightPanelCollapsed, setRightPanelTab]);

  // 注册全局快捷键：Ctrl+S 保存快照 + Ctrl+K 打开全局搜索
  // setShowSearch 是 useState setter，引用稳定，useMemo 空依赖即可
  const extraHotkeys = useMemo<HotkeyHandler[]>(() => [
    {
      key: 'k',
      ctrl: true,
      handler: () => setShowSearch(true),
      description: '全局搜索 (Ctrl+K)',
    },
  ], []);
  useAppHotkeys(extraHotkeys);

  // P-M1: 右侧面板内容用 useMemo 缓存，避免每次 render 都通过 IIFE 重建 switch 闭包。
  // 仅 rightPanelTab 变化时重算，其余 render 直接复用上一次结果。
  const rightPanelContent = useMemo(() => {
    switch (rightPanelTab) {
      case 'ai': return <AIPanel />;
      case 'characters': return <CharactersPanel />;
      case 'settings': return <SettingsPanel />;
      case 'foreshadows': return <ForeshadowPanel />;
      case 'materials': return <MaterialsPanel />;
      case 'coreSetting': return <CoreSettingCardPanel />;
      case 'blueprint': return <BlueprintPanel />;
      case 'subplot': return <SubplotPanel />;
      case 'updateSchedule': return <UpdateSchedulePanel />;
      default: return <AIPanel />;
    }
  }, [rightPanelTab]);

  // openProject 竞态守卫：快速切换项目时，旧请求 await 完成后通过 id 比对丢弃过期结果
  const openRequestId = useRef(0);
  // 标记 projects 是否已加载完成，用于区分“加载中”与“项目不存在”
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // 加载失败标记：与"项目不存在"区分。loadProjects/openProject 抛错时若只置 projectsLoaded(true)，
  // UI 会渲染"项目不存在"分支，误导用户以为项目被删除；这里独立标记，命中时展示重试入口
  const [loadError, setLoadError] = useState(false);
  // 重试计数：作为 useEffect 依赖，点"重试"时 +1 触发重新加载
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    const id = ++openRequestId.current;
    setProjectsLoaded(false);
    setLoadError(false);
    (async () => {
      try {
        await loadProjects();
        if (id !== openRequestId.current) return;
        await openProject(projectId);
        if (id !== openRequestId.current) return;
      } catch (e) {
        console.error('加载项目失败:', e);
        // 区分加载失败与项目不存在：仅当加载阶段抛错时置 loadError，
        // 不再 fallthrough 到 setProjectsLoaded(true) 触发"项目不存在"分支
        if (id === openRequestId.current) setLoadError(true);
        return;
      }
      if (id !== openRequestId.current) return;
      setProjectsLoaded(true);
    })();
  }, [projectId, loadProjects, openProject, retryCount]);

  const currentProject = projects.find(p => p.id === projectId);

  // 首次进入编辑器时触发交互式引导。依赖 currentProject?.id 而非 currentProject 对象引用，
  // 避免编辑/保存导致 currentProject 引用变化时重复触发
  useEffect(() => {
    if (!currentProject) return;
    if (safeLocalStorageGet('has_seen_editor_tour')) return;
    const timer = setTimeout(() => setShowTour(true), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const handleTourComplete = () => {
    safeLocalStorageSet('has_seen_editor_tour', 'true');
    setShowTour(false);
  };

  const handleTourSkip = () => {
    safeLocalStorageSet('has_seen_editor_tour', 'true');
    setShowTour(false);
  };



  if (!currentProject) {
    if (loadError) {
      // 加载失败分支：与"项目不存在"区分。提供"重试"按钮，点击触发 retryCount+1
      // 重新走 useEffect，避免用户误以为项目被删除
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-ink-950 gap-4">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <div className="text-ink-300">项目加载失败，请重试</div>
          <div className="flex gap-2">
            <button
              onClick={() => setRetryCount(c => c + 1)}
              className="btn btn-primary"
            >
              重试
            </button>
            <button
              onClick={() => navigate('/')}
              className="btn btn-secondary"
            >
              返回首页
            </button>
          </div>
        </div>
      );
    }
    if (!projectsLoaded) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-ink-950">
          <div className="text-ink-400">加载中...</div>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-ink-950 gap-4">
        <div className="text-ink-400">项目不存在</div>
        <button
          onClick={() => navigate('/')}
          className="btn btn-primary"
        >
          返回首页
        </button>
      </div>
    );
  }

  const currentChapter = chapters.find(c => c.id === currentChapterId);

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay pointer-events-none" />

      {/* Top Bar */}
      <header className="relative z-20 h-12 border-b border-ink-800/50 flex items-center justify-between px-3 bg-ink-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="返回项目列表"
            aria-label="返回项目列表"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="w-px h-5 bg-ink-700" />
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-ink-200 font-medium">{currentProject.title}</span>
          </div>
          {currentChapter && (
            <>
              <span className="text-ink-600">/</span>
              <span className="text-sm text-ink-400">{currentChapter.title}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSearch(true)}
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="全局搜索 (Ctrl+K)"
            aria-label="全局搜索"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              setShowVersionPanel(v => !v);
              setShowConflictPanel(false);
            }}
            data-tour="version-history"
            className={`p-1.5 rounded-md transition-colors ${
              showVersionPanel
                ? 'text-amber-400 bg-amber-400/10'
                : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800'
            }`}
            title="版本历史"
            aria-label="版本历史"
          >
            <History className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              setShowConflictPanel(c => !c);
              setShowVersionPanel(false);
            }}
            className={`p-1.5 rounded-md transition-colors ${
              showConflictPanel
                ? 'text-amber-400 bg-amber-400/10'
                : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800'
            }`}
            title="冲突检测"
            aria-label="冲突检测"
          >
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="总控仪表盘"
            aria-label="总控仪表盘"
            onClick={() => navigate(`/project/${projectId}/dashboard`)}
          >
            <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="审稿中心"
            aria-label="审稿中心"
            onClick={() => navigate(`/project/${projectId}/review`)}
          >
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="w-px h-5 bg-ink-700 mx-1" />
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="导出"
            aria-label="导出"
            onClick={() => navigate(`/project/${projectId}/export`)}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="软件设置"
            aria-label="软件设置"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="保存（Ctrl+S）"
            aria-label="保存"
            onClick={() => {
              // 立即触发保存并显示反馈；失败时 saveProject 内部会弹 toast
              if (!currentChapterId) return;
              void useAppStore.getState().saveProject();
            }}
            disabled={!currentChapterId}
          >
            <Save className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex overflow-hidden">
        {/* Left Panel - Outline */}
        <aside
          data-tour="outline-panel"
          className={`relative flex flex-col border-r border-ink-800/50 bg-ink-900/50 transition-all duration-300 ${
            leftPanelCollapsed ? 'w-0 overflow-hidden' : 'w-64'
          }`}
        >
          {/* Left Tab Headers */}
          <div className="flex border-b border-ink-800/50">
            <button
              onClick={() => setLeftPanelTab('outline')}
              className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors relative ${
                leftPanelTab === 'outline'
                  ? 'text-amber-400'
                  : 'text-ink-500 hover:text-ink-300'
              }`}
            >
              <BookMarked className="w-4 h-4" />
              <span className="text-[10px]">大纲</span>
              {leftPanelTab === 'outline' && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-400 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setLeftPanelTab('polish')}
              className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors relative ${
                leftPanelTab === 'polish'
                  ? 'text-amber-400'
                  : 'text-ink-500 hover:text-ink-300'
              }`}
            >
              <Wand2 className="w-4 h-4" />
              <span className="text-[10px]">打磨</span>
              {leftPanelTab === 'polish' && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-400 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setLeftPanelCollapsed(true)}
              className="px-2 text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
              aria-label="折叠大纲面板"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {leftPanelTab === 'outline' && <OutlinePanel />}
            {leftPanelTab === 'polish' && (
              <Suspense fallback={<ModalFallback />}>
                <OutlinePolishPanel />
              </Suspense>
            )}
          </div>
        </aside>

        {/* Left Toggle Button (when collapsed) */}
        {leftPanelCollapsed && (
          <button
            onClick={() => setLeftPanelCollapsed(false)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-ink-800 border border-l-0 border-ink-700 rounded-r-md text-ink-400 hover:text-ink-200 hover:bg-ink-700 transition-colors"
            aria-label="展开大纲面板"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        {/* Center - Editor */}
        <main data-tour="editor-area" className="flex-1 flex flex-col overflow-hidden relative">
          <TiptapEditor />
        </main>

        {/* Right Panel */}
        <aside
          data-tour="right-panel"
          className={`relative flex flex-col border-l border-ink-800/50 bg-ink-900/50 transition-all duration-300 ${
            rightPanelCollapsed ? 'w-0 overflow-hidden' : 'w-80'
          }`}
        >
          {/* Tab Headers */}
          <div className="flex border-b border-ink-800/50">
            {[
              { id: 'ai', icon: Sparkles, label: 'AI' },
              { id: 'characters', icon: Users, label: '角色' },
              { id: 'settings', icon: Globe, label: '设定' },
              { id: 'foreshadows', icon: Flag, label: '伏笔' },
              { id: 'materials', icon: Lightbulb, label: '素材' },
              { id: 'coreSetting', icon: IdCard, label: '设定卡' },
              { id: 'blueprint', icon: Map, label: '蓝图' },
              { id: 'subplot', icon: GitBranch, label: '支线' },
              { id: 'updateSchedule', icon: CalendarClock, label: '存稿' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setRightPanelTab(tab.id as typeof rightPanelTab)}
                data-tour={tab.id === 'materials' ? 'materials' : undefined}
                className={`flex-1 py-2.5 flex flex-col items-center gap-1 transition-colors relative ${
                  rightPanelTab === tab.id
                    ? 'text-amber-400'
                    : 'text-ink-500 hover:text-ink-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="text-[10px]">{tab.label}</span>
                {rightPanelTab === tab.id && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-400 rounded-full" />
                )}
              </button>
            ))}
            <button
              onClick={() => setRightPanelCollapsed(true)}
              className="px-2 text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
              aria-label="折叠右侧面板"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto">
            {/* 4 个灵犀面板为 lazy 加载，需 Suspense 接管首次加载时的 fallback，
                避免切到对应 tab 时 React 抛出 Suspense 异常无 handler 导致白屏 */}
            <Suspense fallback={<ModalFallback />}>
              {rightPanelContent}
            </Suspense>
          </div>
        </aside>

        {/* Right Toggle Button (when collapsed) */}
        {rightPanelCollapsed && (
          <button
            onClick={() => setRightPanelCollapsed(false)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-ink-800 border border-r-0 border-ink-700 rounded-l-md text-ink-400 hover:text-ink-200 hover:bg-ink-700 transition-colors"
            aria-label="展开右侧面板"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Status Bar */}
      <footer className="relative z-20 h-7 border-t border-ink-800/50 flex items-center justify-between px-4 bg-ink-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-4 text-xs text-ink-500">
          <span>共 {chapterCount} 章</span>
          <span>{currentProject.totalWords.toLocaleString()} 字</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-500">
          {currentChapter && (
            <>
              <span>{currentChapter.wordCount.toLocaleString()} 字</span>
              <span>约 {Math.ceil(currentChapter.wordCount / READING_SPEED_WPM)} 分钟阅读</span>
            </>
          )}
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
            已自动保存
          </span>
          {lastSavedAt && (
            <span>最后保存: {new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          )}
        </div>
      </footer>

      {/* Version History Panel (Drawer) */}
      {showVersionPanel && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div
            className="absolute inset-0 bg-black/30 pointer-events-auto"
            onClick={() => setShowVersionPanel(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-ink-900 border-l border-ink-800 shadow-large pointer-events-auto animate-slide-left">
            <Suspense fallback={<ModalFallback />}>
              <VersionHistoryPanel onClose={() => setShowVersionPanel(false)} />
            </Suspense>
          </div>
        </div>
      )}

      {/* Conflict Detection Panel (Drawer) */}
      {showConflictPanel && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div
            className="absolute inset-0 bg-black/30 pointer-events-auto"
            onClick={() => setShowConflictPanel(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-ink-900 border-l border-ink-800 shadow-large pointer-events-auto animate-slide-left">
            <Suspense fallback={<ModalFallback />}>
              <ConflictPanel onClose={() => setShowConflictPanel(false)} />
            </Suspense>
          </div>
        </div>
      )}

      {/* Search Modal */}
      {showSearch && (
        <Suspense fallback={<ModalFallback />}>
          <SearchModal onClose={() => setShowSearch(false)} />
        </Suspense>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <Suspense fallback={<ModalFallback />}>
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {/* Interactive Tour (首次进入编辑器) */}
      {showTour && (
        <Suspense fallback={null}>
          <InteractiveTour
            steps={editorTourSteps}
            onComplete={handleTourComplete}
            onSkip={handleTourSkip}
          />
        </Suspense>
      )}
    </div>
  );
}
