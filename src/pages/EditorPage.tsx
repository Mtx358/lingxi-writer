import { useState, useEffect, useRef, useMemo } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useAppHotkeys, type HotkeyHandler } from '@/hooks/useGlobalHotkeys';
import OutlinePanel from '@/components/editor/OutlinePanel';
import TiptapEditor from '@/components/editor/TiptapEditor';
import AIPanel from '@/components/editor/AIPanel';
import CharactersPanel from '@/components/editor/CharactersPanel';
import SettingsPanel from '@/components/editor/SettingsPanel';
import ForeshadowPanel from '@/components/editor/ForeshadowPanel';
import MaterialsPanel from '@/components/editor/MaterialsPanel';
import VersionHistoryPanel from '@/components/editor/VersionHistoryPanel';
import ConflictPanel from '@/components/editor/ConflictPanel';
import OutlinePolishPanel from '@/components/editor/OutlinePolishPanel';
import SearchModal from '@/components/SearchModal';
import InteractiveTour, { type TourStep } from '@/components/InteractiveTour';

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const leftPanelCollapsed = useAppStore(s => s.leftPanelCollapsed);
  const rightPanelCollapsed = useAppStore(s => s.rightPanelCollapsed);
  const rightPanelTab = useAppStore(s => s.rightPanelTab);
  const setLeftPanelCollapsed = useAppStore(s => s.setLeftPanelCollapsed);
  const setRightPanelCollapsed = useAppStore(s => s.setRightPanelCollapsed);
  const setRightPanelTab = useAppStore(s => s.setRightPanelTab);
  const loadProjects = useAppStore(s => s.loadProjects);
  const openProject = useAppStore(s => s.openProject);
  const lastSavedAt = useAppStore(s => s.lastSavedAt);

  const [showSearch, setShowSearch] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [showConflictPanel, setShowConflictPanel] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<'outline' | 'polish'>('outline');
  const [showTour, setShowTour] = useState(false);

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

  // openProject 竞态守卫：快速切换项目时，旧请求 await 完成后通过 id 比对丢弃过期结果
  const openRequestId = useRef(0);
  // 标记 projects 是否已加载完成，用于区分“加载中”与“项目不存在”
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    const id = ++openRequestId.current;
    setProjectsLoaded(false);
    (async () => {
      try {
        await loadProjects();
        if (id !== openRequestId.current) return;
        await openProject(projectId);
        if (id !== openRequestId.current) return;
      } catch (e) {
        console.error('加载项目失败:', e);
      }
      if (id !== openRequestId.current) return;
      setProjectsLoaded(true);
    })();
  }, [projectId, loadProjects, openProject]);

  const currentProject = projects.find(p => p.id === projectId);

  // 首次进入编辑器时触发交互式引导。依赖 currentProject?.id 而非 currentProject 对象引用，
  // 避免编辑/保存导致 currentProject 引用变化时重复触发
  useEffect(() => {
    if (!currentProject) return;
    if (localStorage.getItem('has_seen_editor_tour')) return;
    const timer = setTimeout(() => setShowTour(true), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const handleTourComplete = () => {
    localStorage.setItem('has_seen_editor_tour', 'true');
    setShowTour(false);
  };

  const handleTourSkip = () => {
    localStorage.setItem('has_seen_editor_tour', 'true');
    setShowTour(false);
  };



  if (!currentProject) {
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
          >
            <Home className="w-4 h-4" />
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
          >
            <Search className="w-4 h-4" />
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
          >
            <History className="w-4 h-4" />
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
          >
            <AlertTriangle className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="审稿中心"
            onClick={() => navigate(`/project/${projectId}/review`)}
          >
            <BarChart3 className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-ink-700 mx-1" />
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="导出"
            onClick={() => navigate(`/project/${projectId}/export`)}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
            title="保存"
          >
            <Save className="w-4 h-4" />
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
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {leftPanelTab === 'outline' && <OutlinePanel />}
            {leftPanelTab === 'polish' && <OutlinePolishPanel />}
          </div>
        </aside>

        {/* Left Toggle Button (when collapsed) */}
        {leftPanelCollapsed && (
          <button
            onClick={() => setLeftPanelCollapsed(false)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-ink-800 border border-l-0 border-ink-700 rounded-r-md text-ink-400 hover:text-ink-200 hover:bg-ink-700 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
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
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto">
            {(() => {
              switch (rightPanelTab) {
                case 'ai': return <AIPanel />;
                case 'characters': return <CharactersPanel />;
                case 'settings': return <SettingsPanel />;
                case 'foreshadows': return <ForeshadowPanel />;
                case 'materials': return <MaterialsPanel />;
                default: return <AIPanel />;
              }
            })()}
          </div>
        </aside>

        {/* Right Toggle Button (when collapsed) */}
        {rightPanelCollapsed && (
          <button
            onClick={() => setRightPanelCollapsed(false)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-ink-800 border border-r-0 border-ink-700 rounded-l-md text-ink-400 hover:text-ink-200 hover:bg-ink-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status Bar */}
      <footer className="relative z-20 h-7 border-t border-ink-800/50 flex items-center justify-between px-4 bg-ink-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-4 text-xs text-ink-500">
          <span>共 {chapters.filter(c => c.levelType === 'chapter').length} 章</span>
          <span>{currentProject.totalWords.toLocaleString()} 字</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-500">
          {currentChapter && (
            <>
              <span>{currentChapter.wordCount.toLocaleString()} 字</span>
              <span>约 {Math.ceil(currentChapter.wordCount / 400)} 分钟阅读</span>
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
            <VersionHistoryPanel onClose={() => setShowVersionPanel(false)} />
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
            <ConflictPanel onClose={() => setShowConflictPanel(false)} />
          </div>
        </div>
      )}

      {/* Search Modal */}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}

      {/* Interactive Tour (首次进入编辑器) */}
      {showTour && (
        <InteractiveTour
          steps={editorTourSteps}
          onComplete={handleTourComplete}
          onSkip={handleTourSkip}
        />
      )}
    </div>
  );
}
