import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Check, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import ProjectNotFound from '@/components/ProjectNotFound';
import type { ExportPlatform, PlatformTagRecommendation } from '@/types';
import { ExportFormatSelector } from './ExportFormatSelector';
import { ExportOptionsPanel } from './ExportOptionsPanel';
import { ExportPreview } from './ExportPreview';
import { ExportProgress } from './ExportProgress';
import { PublishPanel } from './PublishPanel';
import { useExportActions } from './useExportActions';
import type { ExportFormat, ExportStyle } from './types';

export default function ExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const updateProject = useAppStore(s => s.updateProject);
  const getSettingCard = useAppStore(s => s.getSettingCard);
  const updateSettingCard = useAppStore(s => s.updateSettingCard);
  const runSensitiveWordCheck = useAppStore(s => s.runSensitiveWordCheck);
  const clearSensitiveWordCheck = useAppStore(s => s.clearSensitiveWordCheck);
  const sensitiveResult = useAppStore(s => s.lastSensitiveWordCheck);
  const loadProjects = useAppStore(s => s.loadProjects);
  const openProject = useAppStore(s => s.openProject);

  const [projectLoading, setProjectLoading] = useState(true);
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [includeToc, setIncludeToc] = useState(true);
  const [style, setStyle] = useState<ExportStyle>('novel');
  const [platform, setPlatform] = useState<ExportPlatform>('general');
  // 灵犀发布：简介优化 / 标签推荐 / 敏感词扫描的本地状态
  const [synopsisOptimizing, setSynopsisOptimizing] = useState(false);
  const [optimizedSynopsis, setOptimizedSynopsis] = useState<string | null>(null);
  const [tagRecommending, setTagRecommending] = useState(false);
  const [tagRecommendation, setTagRecommendation] = useState<PlatformTagRecommendation | null>(null);
  const [scanningSensitive, setScanningSensitive] = useState(false);

  // 敏感词扫描的 setTimeout 句柄：组件卸载/项目切换时需清理，避免回调 setState 落在已卸载组件
  const sensitiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const project = projects.find(p => p.id === projectId);
  const mainChapters = useMemo(
    () => chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order),
    [chapters]
  );

  const { exporting, exported, exportMessage, exportProgress, exportStage, handleExport } =
    useExportActions({ project, mainChapters, format, includeToc, style, platform, projectId });

  // H6 性能修复：单次循环分组统计敏感词严重度，避免 JSX 中 3 次 filter（O(3H) per render）
  const sensitiveHitsBySeverity = useMemo(() => {
    const by = { high: 0, medium: 0, low: 0 };
    if (sensitiveResult?.hits) {
      for (const h of sensitiveResult.hits) {
        if (h.severity in by) (by as Record<string, number>)[h.severity]++;
      }
    }
    return by;
  }, [sensitiveResult]);

  // 导出前检查：基于真实伏笔/章节数据计算，不再硬编码假数据
  // 仅统计 chapter 级节点，与 mainChapters 口径一致，避免卷(volume)节点被计入分母
  const precheckIssues = useMemo(() => {
    const issues: { type: 'warning' | 'info'; text: string }[] = [];
    const pendingForeshadows = foreshadows.filter(
      f => f.status !== 'paid-off' && f.status !== 'abandoned'
    ).length;
    if (pendingForeshadows > 0) {
      issues.push({ type: 'warning', text: `有 ${pendingForeshadows} 个伏笔尚未回收` });
    }
    const draftChapters = chapters.filter(c => c.levelType === 'chapter' && c.status === 'draft').length;
    if (draftChapters > 0) {
      issues.push({ type: 'info', text: `${draftChapters} 个章节状态为草稿` });
    }
    return issues;
  }, [foreshadows, chapters]);

  // 项目健康度：基于伏笔回收率（50%）与章节完成率（50%）动态计算
  // 仅统计 chapter 级节点，与 DashboardPage 口径一致
  const health = useMemo(() => {
    const totalForeshadows = foreshadows.length;
    const recovered = foreshadows.filter(f => f.status === 'paid-off').length;
    const foreshadowRate = totalForeshadows > 0 ? recovered / totalForeshadows : 1;
    const chapterLevel = chapters.filter(c => c.levelType === 'chapter');
    const totalChapters = chapterLevel.length;
    const completedChapters = chapterLevel.filter(c => c.status === 'done').length;
    const chapterRate = totalChapters > 0 ? completedChapters / totalChapters : 1;
    const score = Math.round((foreshadowRate * 0.5 + chapterRate * 0.5) * 100);
    const label = score >= 80 ? '良好' : score >= 60 ? '一般' : '需改进';
    return { score, label };
  }, [foreshadows, chapters]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (sensitiveTimerRef.current) clearTimeout(sensitiveTimerRef.current);
    };
  }, []);

  // 项目加载：ExportPage 通过 URL 直接访问时 projects 可能为空（如刷新页面），
  // 需主动 loadProjects+openProject 才能拿到 project 与 chapters。
  // 完成后置 projectLoading=false，区分"加载中"与"项目不存在"两种 fallback 场景
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setProjectLoading(true);
    (async () => {
      try {
        await loadProjects();
        if (cancelled) return;
        await openProject(projectId);
        if (cancelled) return;
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadProjects, openProject]);

  // 切换项目时清空灵犀发布域的本地状态：React Router 在路径参数变化时默认复用同一组件实例，
  // 不主动清空会导致项目 A 的优化简介/标签推荐/敏感词结果显示在项目 B 上
  // 导出状态（exporting/exported/...）由 useExportActions 内同名 effect 清理
  useEffect(() => {
    setOptimizedSynopsis(null);
    setTagRecommendation(null);
    setSynopsisOptimizing(false);
    setTagRecommending(false);
    setScanningSensitive(false);
    // 切项目时也清空 store 中的敏感词结果（属于上一项目的扫描产物）
    clearSensitiveWordCheck();
    if (sensitiveTimerRef.current) {
      clearTimeout(sensitiveTimerRef.current);
      sensitiveTimerRef.current = null;
    }
  }, [projectId, clearSensitiveWordCheck]);

  // 切换平台时清空 optimizedSynopsis：避免上一平台风格的优化简介残留，
  // 导致按钮文字显示"按番茄风格优化"而内容仍是起点风格
  useEffect(() => {
    setOptimizedSynopsis(null);
  }, [platform]);

  // 灵犀发布：按平台风格优化简介
  const handleOptimizeSynopsis = async () => {
    if (!project) return;
    if (synopsisOptimizing) return;
    setSynopsisOptimizing(true);
    setOptimizedSynopsis(null);
    try {
      const current = project.description || '';
      const optimized = await aiService.optimizeSynopsis(current, platform, getSettingCard() || undefined);
      if (!isMountedRef.current) return;
      if (optimized && optimized !== current) {
        setOptimizedSynopsis(optimized);
      } else {
        toast.info('简介已是最优', '当前简介无需进一步优化');
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const msg = getErrorMessage(e);
      toast.error('简介优化失败', msg);
    } finally {
      if (isMountedRef.current) setSynopsisOptimizing(false);
    }
  };

  const handleApplyOptimizedSynopsis = () => {
    if (!project || !optimizedSynopsis) return;
    updateProject(project.id, { description: optimizedSynopsis });
    setOptimizedSynopsis(null);
    toast.success('已应用优化后的简介', '可在预览区查看效果');
  };

  // 灵犀发布：基于设定卡 + 简介推荐平台标签与分类
  const handleRecommendTags = async () => {
    if (tagRecommending) return;
    setTagRecommending(true);
    setTagRecommendation(null);
    try {
      const recommendation = await aiService.recommendPlatformTags(getSettingCard() || undefined, project?.description);
      if (!isMountedRef.current) return;
      setTagRecommendation(recommendation);
    } catch (e) {
      if (!isMountedRef.current) return;
      const msg = getErrorMessage(e);
      toast.error('标签推荐失败', msg);
    } finally {
      if (isMountedRef.current) setTagRecommending(false);
    }
  };

  const handleApplyRecommendedTags = () => {
    if (!tagRecommendation) return;
    const card = getSettingCard();
    if (!card) {
      toast.error('请先创建设定卡', '在右侧"设定卡"标签页中创建后再使用标签推荐');
      return;
    }
    // 合并去重，避免覆盖用户已填的标签
    const merged = Array.from(new Set([...card.genreTags, ...tagRecommendation.tags]));
    updateSettingCard({ genreTags: merged });
    toast.success('已合并推荐标签到设定卡', `共 ${merged.length} 个标签`);
    setTagRecommendation(null);
  };

  // 灵犀发布：扫描全章节敏感词（本地词库，无 LLM）
  const handleScanSensitiveWords = () => {
    if (scanningSensitive) return;
    setScanningSensitive(true);
    // filterSensitiveWords 是同步函数，但章节多时可能阻塞主线程，
    // 使用 setTimeout 让 UI 先进入"扫描中"状态
    // 用 ref 保存 timer id，组件卸载/项目切换时清理，避免 setState 落在已卸载组件
    sensitiveTimerRef.current = setTimeout(() => {
      try {
        const result = runSensitiveWordCheck();
        if (!isMountedRef.current) return;
        if (result.totalHits === 0) {
          toast.success('未发现敏感词', '全书章节已通过本地词库扫描');
        } else {
          toast.warning('发现 ' + result.totalHits + ' 处敏感词', '请查看下方详情并修改正文');
        }
      } catch (e) {
        if (!isMountedRef.current) return;
        const msg = getErrorMessage(e);
        toast.error('敏感词扫描失败', msg);
      } finally {
        if (isMountedRef.current) setScanningSensitive(false);
        sensitiveTimerRef.current = null;
      }
    }, 50);
  };

  if (!project) {
    return <ProjectNotFound loading={projectLoading} onBackHome={() => navigate('/')} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 h-14 border-b border-ink-800/50 flex items-center justify-between px-4 bg-ink-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/project/${projectId}/editor`)}
            aria-label="返回编辑器"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-ink-100 flex items-center gap-2">
              <Download className="w-4 h-4 text-amber-400" />
              导出发布
            </h1>
            <p className="text-xs text-ink-500">{project.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {format === 'pdf' && (
            <span className="text-[10px] text-amber-400/70 hidden sm:inline flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              PDF 导出需联网加载中文字体（首次导出时），无网络时中文可能显示异常
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn btn-primary text-sm disabled:opacity-50"
          >
            {exporting ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-ink-900/30 border-t-ink-900 rounded-full animate-spin" />
                导出中 {exportProgress}%
              </span>
            ) : exported ? (
              <><Check className="w-4 h-4" /> 已导出</>
            ) : (
              <><Download className="w-4 h-4" /> 开始导出</>
            )}
          </button>
        </div>
      </header>

      <ExportProgress
        exporting={exporting}
        exportStage={exportStage}
        format={format}
        exportProgress={exportProgress}
        exportMessage={exportMessage}
      />

      {/* Content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <ExportFormatSelector format={format} onFormatChange={setFormat} />

          <ExportOptionsPanel
            includeToc={includeToc}
            onIncludeTocChange={setIncludeToc}
            style={style}
            onStyleChange={setStyle}
            platform={platform}
            onPlatformChange={setPlatform}
          />

          {/* Pre-check */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-ink-200 mb-3">导出前检查</h2>
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-ink-300">项目健康度</span>
                <span className="text-sm text-amber-400 font-medium">{health.label}</span>
              </div>
              <div className="w-full h-2 bg-ink-700 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full" style={{ width: `${health.score}%` }} />
              </div>

              <div className="space-y-2">
                {precheckIssues.length === 0 && (
                  <div className="flex items-start gap-2 p-2 rounded text-xs bg-emerald-400/10 text-emerald-300">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>暂无待处理问题</span>
                  </div>
                )}
                {precheckIssues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 p-2 rounded text-xs ${
                      issue.type === 'warning'
                        ? 'bg-amber-400/10 text-amber-300'
                        : 'bg-blue-400/10 text-blue-300'
                    }`}
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{issue.text}</span>
                  </div>
                ))}
                <div className="flex items-start gap-2 p-2 rounded text-xs bg-emerald-400/10 text-emerald-300">
                  <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{mainChapters.length} 个章节结构完整</span>
                </div>
              </div>
            </div>
          </section>

          <PublishPanel
            project={project}
            platform={platform}
            synopsisOptimizing={synopsisOptimizing}
            optimizedSynopsis={optimizedSynopsis}
            onOptimizedSynopsisChange={setOptimizedSynopsis}
            onOptimizeSynopsis={handleOptimizeSynopsis}
            onApplyOptimizedSynopsis={handleApplyOptimizedSynopsis}
            tagRecommending={tagRecommending}
            tagRecommendation={tagRecommendation}
            onTagRecommendationChange={setTagRecommendation}
            onRecommendTags={handleRecommendTags}
            onApplyRecommendedTags={handleApplyRecommendedTags}
            scanningSensitive={scanningSensitive}
            onScanSensitiveWords={handleScanSensitiveWords}
            onClearSensitiveWordCheck={clearSensitiveWordCheck}
            sensitiveResult={sensitiveResult}
            sensitiveHitsBySeverity={sensitiveHitsBySeverity}
          />

          <ExportPreview project={project} mainChapters={mainChapters} />
        </div>
      </main>
    </div>
  );
}
