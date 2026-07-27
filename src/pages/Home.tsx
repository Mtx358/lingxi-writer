import { useState, useEffect, useMemo, useId, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, Sparkles, BookOpen, Layers, Map, Trash2, Clock, FileText, Upload, FileSearch } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { PROJECT_TEMPLATES } from '@/constants/mockData';
import { formatDate } from '@/utils/storage';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { confirm } from '@/hooks/useConfirm';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { Project } from '@/types';
import OnboardingGuide from '@/components/OnboardingGuide';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';

// 导入弹窗懒加载：ImportModal 静态拉取 importUtils.ts（parseMarkdown/parseDocx + DOMPurify），
// OutlineImportModal 静态拉取 outlineParser.ts（parseOutline + DOMPurify），两者合计近 900 行
// 解析逻辑 + DOMPurify。仅在用户点击"导入"按钮时才需要，懒加载可显著降低首屏主入口 chunk 体积。
const ImportModal = lazy(() => import('@/components/ImportModal'));
const OutlineImportModal = lazy(() => import('@/components/OutlineImportModal'));

// 懒加载弹窗的统一占位：与 App.tsx 的 PageFallback 风格一致，避免空白闪烁
function ModalFallback() {
  return (
    <div className="flex items-center justify-center p-8 text-ink-500 text-sm">
      <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const loadProjects = useAppStore(s => s.loadProjects);
  const createProject = useAppStore(s => s.createProject);
  const deleteProject = useAppStore(s => s.deleteProject);
  const loadSampleProject = useAppStore(s => s.loadSampleProject);
  const [showNewModal, setShowNewModal] = useState(false);
  const newModalRef = useFocusTrap<HTMLDivElement>(showNewModal);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<Project['template']>('blank');
  const projectTitleId = useId();
  const templateGroupId = useId();
  // 创建中标记：防止重复点击触发多次 createProject+navigate
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const hasSeenGuide = safeLocalStorageGet('has_seen_onboarding');
    if (!hasSeenGuide) {
      setShowOnboarding(true);
    }
  }, []);

  // 完成/跳过引导处理一致，合并为单一 handler 避免重复代码
  const handleOnboardingClose = () => {
    safeLocalStorageSet('has_seen_onboarding', 'true');
    setShowOnboarding(false);
  };

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreateProject = async () => {
    if (creating) return;
    if (!newProjectTitle.trim()) return;
    setCreating(true);
    try {
      const project = await createProject(newProjectTitle, selectedTemplate);
      // 确保项目数据已写入存储后再导航
      await useAppStore.getState().openProject(project.id);
      navigate(`/project/${project.id}/editor`);
    } catch (e) {
      // 补 catch：createProject/openProject 抛错时只复位 creating，用户无反馈
      toast.error('创建项目失败', getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const handleOpenProject = (projectId: string) => {
    navigate(`/project/${projectId}/editor`);
  };

  const handleLoadSample = () => {
    loadSampleProject();
    const state = useAppStore.getState();
    const newProject = state.projects[state.projects.length - 1];
    // loadSampleProject 同步写入；若异常未写入则中止跳转，避免导航到不存在的项目
    if (!newProject) return;
    navigate(`/project/${newProject.id}/editor`);
  };

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) =>
      new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    ),
    [projects]
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay" />

      <header className="relative z-10 px-12 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-ink-900" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-ink-100">灵犀写作助手</h1>
              <p className="text-xs text-ink-500">人主导，AI 辅助</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowOutlineModal(true)}
              className="btn btn-secondary"
            >
              <FileSearch className="w-4 h-4" />
              导入大纲
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="btn btn-secondary"
            >
              <Upload className="w-4 h-4" />
              导入作品
            </button>
            <button
              onClick={() => setShowNewModal(true)}
              className="btn btn-primary"
            >
              <Plus className="w-4 h-4" />
              新建项目
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-12 pb-12">
        <div className="max-w-6xl mx-auto">
          {projects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-600/10 flex items-center justify-center mb-6">
                <BookOpen className="w-10 h-10 text-amber-400" />
              </div>
              <h2 className="text-2xl font-semibold text-ink-100 mb-2">开始你的创作之旅</h2>
              <p className="text-ink-400 text-sm mb-8 max-w-md text-center">
                在这里，你是创作的主人。AI 是你的助手、第一读者和最勤勉的审稿人。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowNewModal(true)}
                  className="btn btn-primary px-6 py-2.5"
                >
                  <Plus className="w-4 h-4" />
                  创建新项目
                </button>
                <button
                  onClick={handleLoadSample}
                  className="btn btn-secondary px-6 py-2.5"
                >
                  <Sparkles className="w-4 h-4" />
                  加载示例项目
                </button>
              </div>
            </div>
          ) : (
            <>
              <section className="mb-10">
                <h2 className="text-lg font-medium text-ink-200 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  最近项目
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedProjects.slice(0, 6).map(project => (
                    <div
                      key={project.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenProject(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenProject(project.id);
                        }
                      }}
                      aria-label={`打开项目 ${project.title}`}
                      className="group card p-5 cursor-pointer hover:border-amber-400/30 hover:shadow-medium transition-all duration-300 relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    >
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400/0 via-amber-400/50 to-amber-400/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                      <div className="flex items-start justify-between mb-3">
                        <div className="w-12 h-12 rounded-lg bg-ink-700/50 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-amber-400/80" aria-hidden="true" />
                        </div>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            // 用自定义 ConfirmDialog 替代原生 confirm（Electron 中原生 confirm 会阻塞主进程）
                            if (await confirm('确定要删除这个项目吗？')) {
                              deleteProject(project.id);
                            }
                          }}
                          aria-label={`删除项目 ${project.title}`}
                          className="p-1.5 rounded-md text-ink-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                      <h3 className="text-base font-medium text-ink-100 mb-1 group-hover:text-amber-300 transition-colors">
                        {project.title}
                      </h3>
                      <p className="text-sm text-ink-500 line-clamp-2 mb-3 min-h-[2.5rem]">
                        {project.description || '暂无描述'}
                      </p>
                      <div className="flex items-center justify-between text-xs text-ink-500">
                        <span>{project.totalWords.toLocaleString()} 字</span>
                        <span>{formatDate(project.updatedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-medium text-ink-200 mb-4 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-400" />
                  从模板开始
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {PROJECT_TEMPLATES.map(template => (
                    <button
                      key={template.id}
                      onClick={() => {
                        setSelectedTemplate(template.id);
                        setNewProjectTitle(template.name + ' - 新项目');
                        setShowNewModal(true);
                      }}
                      className="card p-5 text-left hover:border-amber-400/30 transition-all duration-300 group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-ink-700/50 flex items-center justify-center mb-3 group-hover:bg-amber-400/10 transition-colors">
                        {template.icon === 'file-text' && <FileText className="w-5 h-5 text-ink-400 group-hover:text-amber-400 transition-colors" />}
                        {template.icon === 'layers' && <Layers className="w-5 h-5 text-ink-400 group-hover:text-amber-400 transition-colors" />}
                        {template.icon === 'map' && <Map className="w-5 h-5 text-ink-400 group-hover:text-amber-400 transition-colors" />}
                        {template.icon === 'book-open' && <BookOpen className="w-5 h-5 text-ink-400 group-hover:text-amber-400 transition-colors" />}
                      </div>
                      <h3 className="text-sm font-medium text-ink-200 mb-1">{template.name}</h3>
                      <p className="text-xs text-ink-500 line-clamp-2">{template.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {showNewModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowNewModal(false)}
        >
          <div
            ref={newModalRef}
            className="card p-6 w-full max-w-md mx-4 animate-slide-up"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-project-modal-title" className="text-lg font-semibold text-ink-100 mb-1">新建项目</h2>
            <p className="text-sm text-ink-500 mb-5">给你的项目起个名字，选择一个结构模板</p>

            <div className="space-y-5">
              <div>
                <label htmlFor={projectTitleId} className="block text-sm text-ink-300 mb-2">项目名称</label>
                <input
                  id={projectTitleId}
                  type="text"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  placeholder="输入项目名称..."
                  className="input"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                />
              </div>

              <div>
                <div id={templateGroupId} className="block text-sm text-ink-300 mb-2">结构模板</div>
                <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby={templateGroupId}>
                  {PROJECT_TEMPLATES.map(template => (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template.id)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        selectedTemplate === template.id
                          ? 'border-amber-400/50 bg-amber-400/10'
                          : 'border-ink-700 bg-ink-800/50 hover:border-ink-600'
                      }`}
                    >
                      <div className="text-sm font-medium text-ink-200 mb-0.5">{template.name}</div>
                      <div className="text-xs text-ink-500 line-clamp-1">{template.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowNewModal(false)}
                className="btn btn-secondary flex-1"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={creating || !newProjectTitle.trim()}
                className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FolderOpen className="w-4 h-4" />
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <Suspense fallback={<ModalFallback />}>
          <ImportModal onClose={() => setShowImportModal(false)} />
        </Suspense>
      )}

      {showOutlineModal && (
        <Suspense fallback={<ModalFallback />}>
          <OutlineImportModal onClose={() => setShowOutlineModal(false)} />
        </Suspense>
      )}

      {showOnboarding && (
        <OnboardingGuide
          onComplete={handleOnboardingClose}
          onSkip={handleOnboardingClose}
        />
      )}
    </div>
  );
}
