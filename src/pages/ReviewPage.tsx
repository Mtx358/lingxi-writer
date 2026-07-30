import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, AlertTriangle, TrendingUp, Heart, Zap, Clock, BookOpen, FileText, Users, Sparkles, Loader2, RefreshCw, Type, Gauge } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import { CHAPTER_STATUS_LABELS } from '@/types';
import type { ChapterAnalysis } from '@/types';
import { REVIEW_ANALYSIS_DEBOUNCE_MS, REVIEW_ANALYSIS_CONCURRENCY, READING_SPEED_WPM } from '@/constants/config';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import AITracePanel from '@/components/editor/AITracePanel';
import Empty from '@/components/Empty';
import ProjectNotFound from '@/components/ProjectNotFound';

// I2: 简单 FNV-1a 32 位字符串哈希，用于检测章节内容是否变更，
// 避免对未变更章节重复发起 AI 分析（无需加密强度，只求稳定与快速）
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// I2: 限制并发数的任务执行器。从队列中取任务执行，最多同时 limit 个 worker 运行，
// 避免一次性打满 API 配额触发服务商限流或熔断。
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default function ReviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const loadProjects = useAppStore(s => s.loadProjects);
  const openProject = useAppStore(s => s.openProject);
  const characters = useAppStore(s => s.characters);
  const [loading, setLoading] = useState(true);
  // 项目加载状态：区分"加载中"与"项目不存在"两种 fallback 场景，
  // 不复用 loading（loading 用于审稿分析，语义不同）
  const [projectLoading, setProjectLoading] = useState(true);
  const [analysis, setAnalysis] = useState<{
    issues: { type: string; severity: string; chapterId?: string; description: string; suggestion: string }[];
    pacing: number[];
    emotionCurve: number[];
  } | null>(null);
  const [chapterAnalyses, setChapterAnalyses] = useState<Record<string, {
    wordCount: number;
    readingTime: number;
    emotionScore: number;
    conflictIntensity: number;
    hookStrength: number;
    pacingScore: number;
  }>>({});

  // 灵犀打磨 4.x：全书审阅 / 风格一致性 / 章节阅读体验分析
  // 这三项是按需触发的深度分析，不随页面加载自动执行，避免拖慢首屏
  const [fullBookReview, setFullBookReview] = useState<{
    issues: { type: 'rhythm' | 'consistency' | 'repetition' | 'pacing'; chapterId?: string; description: string; suggestion: string; priority: 'high' | 'medium' | 'low' }[];
    summary: string;
  } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [styleIssues, setStyleIssues] = useState<{ type: string; severity: string; chapterId: string; description: string }[] | null>(null);
  const [styleLoading, setStyleLoading] = useState(false);
  const [readingAnalysis, setReadingAnalysis] = useState<{
    chapterId: string;
    longSentences: { paragraphIndex: number; preview: string }[];
    repeatedWords: { word: string; count: number }[];
    hookScore: number;
  } | null>(null);
  const [readingLoadingChapterId, setReadingLoadingChapterId] = useState<string | null>(null);

  // I2: 记录上次分析的章节内容哈希（chapterId -> hash），仅对变更章节重新分析
  const chapterHashRef = useRef<Map<string, string>>(new Map());
  // I2: 记录上次结构分析的整书哈希，仅当章节集合/内容变化时重新执行结构分析
  // 设计说明：结构分析（节奏曲线、情感弧线、跨章冲突）对单章内容也敏感——
  // 例如某章新增高潮场景会改变整书节奏判断，故采用"章节ID+内容哈希"组合作为整书哈希，
  // 任意一章内容变化都触发重新分析。若未来确认结构分析仅需骨架敏感（增删/排序），
  // 可将 combinedStructureInput 改为只拼接 ch.id + ch.title + ch.order，剥离内容哈希。
  const structureHashRef = useRef<string>('');
  // I2: 缓存上次的章节分析结果，未变更章节直接复用，避免重复请求
  const chapterAnalysesRef = useRef<Record<string, ChapterAnalysis>>({});
  // 卸载守卫：3 个 on-demand 灵犀打磨 handler 是异步 AI 请求，
  // 组件卸载时若仍在飞行，setState 会落在已卸载组件上（React 18 静默 no-op 但属代码味道）
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setProjectLoading(true);
    (async () => {
      try {
        await loadProjects();
        if (cancelled) return;
        await openProject(projectId);
        // await openProject 之后再次检查：若用户在 openProject 飞行期间切到其他项目，
        // 旧请求会把 store 切回当前 projectId；此处检查无法撤销已发生的写入，
        // 但能阻止后续若添加的 setState 等副作用落到已卸载/已切换的组件上
        if (cancelled) return;
      } catch (e) {
        if (!cancelled) {
          console.error('ReviewPage 加载项目失败:', e);
          toast.error('项目加载失败', '请返回首页重试，或检查项目文件是否可访问');
        }
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadProjects, openProject]);

  useEffect(() => {
    // 空项目时也要复位 loading，否则页面会永远显示"分析中..."
    if (chapters.length === 0) {
      setLoading(false);
      return;
    }

    // cancelled 守卫：组件卸载或 chapters 再次变化时，丢弃进行中的异步分析，避免卸载后 setState
    let cancelled = false;

    // I2: 防抖 N 毫秒，避免编辑过程中每次 chapters 引用变化都触发全量分析
    const debounceTimer = setTimeout(() => {
      const level2 = chapters.filter(c => c.levelType === 'chapter');

      // 计算各章节内容哈希与整书组合哈希
      const currentHashes = new Map<string, string>();
      let combinedStructureInput = '';
      for (const ch of level2) {
        const h = hashString(ch.content || '');
        currentHashes.set(ch.id, h);
        combinedStructureInput += ch.id + ':' + h + '|';
      }
      const structureHash = hashString(combinedStructureInput);

      // 找出内容变更的章节（首次运行时所有章节均视为变更）
      const changedChapters = level2.filter(ch => {
        const prev = chapterHashRef.current.get(ch.id);
        return prev !== currentHashes.get(ch.id);
      });

      const structureChanged = structureHash !== structureHashRef.current;
      // 无任何变更时跳过分析，但需复位 loading，避免上一轮 cancelled 留下的 true 状态
      if (changedChapters.length === 0 && !structureChanged) {
        setLoading(false);
        return;
      }

      const runAnalysis = async () => {
        if (cancelled) return;
        setLoading(true);
        try {
          // 结构分析：仅当整书哈希变化时重新执行
          if (structureChanged) {
            const result = await aiService.analyzeStructure(chapters);
            if (cancelled) return;
            setAnalysis(result);
            structureHashRef.current = structureHash;
          }

          // 章节分析：仅对变更章节发起，并发限制为 REVIEW_ANALYSIS_CONCURRENCY
          if (changedChapters.length > 0) {
            const newResults: Record<string, ChapterAnalysis> = {};
            await runWithConcurrency(changedChapters, REVIEW_ANALYSIS_CONCURRENCY, async (chapter) => {
              try {
                const chAnalysis = await aiService.analyzeChapter(chapter);
                newResults[chapter.id] = chAnalysis;
              } catch (e) {
                console.warn(`分析章节「${chapter.title}」失败:`, e);
              }
            });
            if (cancelled) return;
            // 合并：新结果覆盖旧结果，未变更章节保留缓存
            const merged: Record<string, ChapterAnalysis> = { ...chapterAnalysesRef.current, ...newResults };
            // 清理已删除章节的缓存
            const currentIds = new Set(level2.map(c => c.id));
            for (const id of Object.keys(merged)) {
              if (!currentIds.has(id)) delete merged[id];
            }
            chapterAnalysesRef.current = merged;
            setChapterAnalyses(merged);
            // 更新哈希缓存，标记这些章节已分析
            for (const ch of changedChapters) {
              chapterHashRef.current.set(ch.id, currentHashes.get(ch.id)!);
            }
          }
        } catch (e) {
          // 外层补 catch：analyzeStructure 抛错时若仅复位 loading，UI 仍会展示空的
          // 旧 analysis 数据，用户无任何失败提示。这里清空 analysis 并弹 toast。
          if (!cancelled) {
            setAnalysis(null);
            toast.error('结构分析失败', getErrorMessage(e));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      runAnalysis();
    }, REVIEW_ANALYSIS_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [chapters]);

  const project = useMemo(
    () => projects.find(p => p.id === projectId),
    [projects, projectId]
  );
  const mainChapters = useMemo(
    () => chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order),
    [chapters]
  );
  // 实时总字数：project.totalWords 仅在 openProject/updateProject 时同步，
  // 编辑器中改章节内容时不会刷新，需用 chapters 实时聚合，避免统计卡片与章节列表字数对不上
  const realtimeTotalWords = useMemo(
    () => mainChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0),
    [mainChapters]
  );

  if (!project) {
    return <ProjectNotFound loading={projectLoading} onBackHome={() => navigate('/')} />;
  }

  const severityColors: Record<string, string> = {
    error: 'text-red-400 bg-red-400/10 border-red-400/30',
    warning: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
    info: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  };

  // 灵犀打磨 4.3：全书审阅（节奏/一致性/重复/ pacing 四维度）
  const handleRunFullBookReview = async () => {
    if (reviewLoading) return;
    if (mainChapters.length === 0) {
      toast.info('暂无章节', '请先在编辑器中创建章节');
      return;
    }
    setReviewLoading(true);
    setFullBookReview(null);
    try {
      const result = await aiService.generateFullBookReview(mainChapters);
      if (!isMountedRef.current) return;
      setFullBookReview(result);
      if (result.issues.length === 0) {
        toast.success('全书审阅通过', '未发现明显的节奏/一致性/重复问题');
      } else {
        toast.info('全书审阅完成', `发现 ${result.issues.length} 条可改进项`);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const msg = getErrorMessage(e);
      toast.error('全书审阅失败', msg);
    } finally {
      if (isMountedRef.current) setReviewLoading(false);
    }
  };

  // 灵犀打磨 4.x：风格一致性检查（跨章节视角/语气/用词一致性）
  const handleRunStyleConsistency = async () => {
    if (styleLoading) return;
    if (mainChapters.length === 0) {
      toast.info('暂无章节', '请先在编辑器中创建章节');
      return;
    }
    setStyleLoading(true);
    setStyleIssues(null);
    try {
      const result = await aiService.checkStyleConsistency(mainChapters);
      if (!isMountedRef.current) return;
      setStyleIssues(result.issues);
      if (result.issues.length === 0) {
        toast.success('风格一致性良好', '未发现跨章节风格冲突');
      } else {
        toast.info('风格检查完成', `发现 ${result.issues.length} 条风格不一致项`);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const msg = getErrorMessage(e);
      toast.error('风格一致性检查失败', msg);
    } finally {
      if (isMountedRef.current) setStyleLoading(false);
    }
  };

  // 灵犀打磨 4.x：章节阅读体验分析（长句/重复词/钩子分数）
  const handleAnalyzeReading = async (chapterId: string) => {
    if (readingLoadingChapterId) return;
    const chapter = mainChapters.find(c => c.id === chapterId);
    if (!chapter) return;
    setReadingLoadingChapterId(chapterId);
    setReadingAnalysis(null);
    try {
      const result = await aiService.analyzeChapterForReading(chapter);
      if (!isMountedRef.current) return;
      setReadingAnalysis({ chapterId, ...result });
    } catch (e) {
      if (!isMountedRef.current) return;
      const msg = getErrorMessage(e);
      toast.error('章节阅读分析失败', msg);
    } finally {
      if (isMountedRef.current) setReadingLoadingChapterId(null);
    }
  };

  // 全书审阅 issue 优先级样式
  const priorityColors: Record<'high' | 'medium' | 'low', string> = {
    high: 'text-red-400 bg-red-400/10 border-red-400/30',
    medium: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
    low: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  };
  const reviewTypeLabels: Record<string, string> = {
    rhythm: '节奏',
    consistency: '一致性',
    repetition: '重复',
    pacing: '步调',
  };

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
              <BarChart3 className="w-4 h-4 text-amber-400" />
              审稿中心
            </h1>
            <p className="text-xs text-ink-500">{project.title}</p>
          </div>
        </div>
        <button
          onClick={() => navigate(`/project/${projectId}/editor`)}
          className="btn btn-primary text-sm"
        >
          返回编辑
        </button>
      </header>

      {/* Content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="card p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-amber-400/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <div className="text-2xl font-semibold text-ink-100">{mainChapters.length}</div>
                  <div className="text-xs text-ink-500">章节数</div>
                </div>
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-blue-400/10 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="text-2xl font-semibold text-ink-100">{realtimeTotalWords.toLocaleString()}</div>
                  <div className="text-xs text-ink-500">总字数</div>
                </div>
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-emerald-400/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-semibold text-ink-100">
                    {Math.ceil(realtimeTotalWords / READING_SPEED_WPM)}
                  </div>
                  <div className="text-xs text-ink-500">阅读分钟</div>
                </div>
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-purple-400/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <div className="text-2xl font-semibold text-ink-100">{characters.length}</div>
                  <div className="text-xs text-ink-500">角色数</div>
                </div>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Emotion Curve */}
            <div className="card p-4">
              <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
                <Heart className="w-4 h-4 text-red-400" />
                情绪心电图
              </h3>
              {loading ? (
                <div className="h-32 flex items-center justify-center text-ink-500 text-sm">分析中...</div>
              ) : analysis?.emotionCurve?.length ? (
                <div className="h-32 flex items-end gap-1 px-2">
                  {analysis.emotionCurve.map((val, idx) => (
                    <div
                      key={idx}
                      role="img"
                      aria-label={`第${idx + 1}章：情绪值 ${val}`}
                      className="flex-1 bg-gradient-to-t from-red-500/50 to-amber-400/50 rounded-t transition-all hover:from-red-500 hover:to-amber-300"
                      style={{ height: `${Math.max(10, val)}%` }}
                      title={`第${idx + 1}章：情绪值 ${val}`}
                    />
                  ))}
                </div>
              ) : (
                <Empty title="暂无数据，编写章节后自动分析" className="h-32 text-ink-500 text-sm" />
              )}
              <div className="flex justify-between mt-2 text-[10px] text-ink-500">
                <span>低</span>
                <span>高</span>
              </div>
            </div>

            {/* Pacing Curve */}
            <div className="card p-4">
              <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                节奏曲线
              </h3>
              {loading ? (
                <div className="h-32 flex items-center justify-center text-ink-500 text-sm">分析中...</div>
              ) : analysis?.pacing?.length ? (
                <div className="h-32 flex items-end gap-1 px-2">
                  {analysis.pacing.map((val, idx) => (
                    <div
                      key={idx}
                      role="img"
                      aria-label={`第${idx + 1}章：节奏值 ${val}`}
                      className="flex-1 bg-gradient-to-t from-amber-600/50 to-amber-400/50 rounded-t transition-all hover:from-amber-500 hover:to-amber-300"
                      style={{ height: `${Math.max(10, val)}%` }}
                      title={`第${idx + 1}章：节奏值 ${val}`}
                    />
                  ))}
                </div>
              ) : (
                <Empty title="暂无数据，编写章节后自动分析" className="h-32 text-ink-500 text-sm" />
              )}
              <div className="flex justify-between mt-2 text-[10px] text-ink-500">
                <span>慢</span>
                <span>快</span>
              </div>
            </div>
          </div>

          {/* Issues */}
          <div className="card p-4 mb-6">
            <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              AI 审稿建议
              <span className="ml-auto text-xs text-ink-500 font-normal">
                共 {analysis?.issues.length || 0} 条
              </span>
            </h3>
            {loading ? (
              <div className="py-8 text-center text-ink-500 text-sm">分析中...</div>
            ) : analysis?.issues.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-emerald-400 mb-2">✨</div>
                <p className="text-sm text-ink-400">结构完整，节奏良好！</p>
              </div>
            ) : (
              <div className="space-y-2">
                {analysis?.issues.map((issue, idx) => {
                  const chapter = chapters.find(c => c.id === issue.chapterId);
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${severityColors[issue.severity] || severityColors.info}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">
                            {issue.type === 'structure' && '结构问题'}
                            {issue.type === 'pacing' && '节奏问题'}
                            {issue.type === 'style' && '风格问题'}
                            {!['structure', 'pacing', 'style'].includes(issue.type) && issue.type}
                          </div>
                          {chapter && (
                            <div className="text-xs opacity-70 mt-0.5">
                              相关章节：{chapter.title}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] uppercase tracking-wider opacity-70">
                          {issue.severity}
                        </span>
                      </div>
                      <p className="text-xs mt-2 opacity-80">{issue.description}</p>
                      <p className="text-xs mt-1 opacity-60">
                        💡 {issue.suggestion}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 灵犀打磨 4.3：全书审阅 */}
          <div className="card p-4 mb-6">
            <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              全书深度审阅
              <button
                onClick={handleRunFullBookReview}
                disabled={reviewLoading}
                className="ml-auto px-2 py-1 text-[11px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-50"
              >
                {reviewLoading ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />审阅中</>
                ) : (
                  <><RefreshCw className="w-3 h-3" />{fullBookReview ? '重新审阅' : '开始审阅'}</>
                )}
              </button>
            </h3>
            {!fullBookReview ? (
              <div className="py-6 text-center text-xs text-ink-500" role="status" aria-live="polite">
                {reviewLoading ? '正在通读全书，检查节奏、一致性、重复与步调…' : '点击"开始审阅"，AI 将通读全书输出深度诊断'}
              </div>
            ) : (
              <div className="space-y-3">
                {fullBookReview.summary && (
                  <div className="p-3 rounded-lg bg-ink-800/50 text-xs text-ink-300 leading-relaxed">
                    <span className="text-amber-300">总评：</span>{fullBookReview.summary}
                  </div>
                )}
                {fullBookReview.issues.length === 0 ? (
                  <div className="py-4 text-center text-sm text-emerald-300">✨ 全书节奏与一致性良好</div>
                ) : (
                  <div className="space-y-2">
                    {fullBookReview.issues.map((issue, idx) => {
                      const chapter = issue.chapterId ? chapters.find(c => c.id === issue.chapterId) : null;
                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border ${priorityColors[issue.priority]}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div>
                              <span className="text-sm font-medium">
                                {reviewTypeLabels[issue.type] || issue.type}
                              </span>
                              {chapter && (
                                <span className="ml-2 text-xs opacity-70">相关章节：{chapter.title}</span>
                              )}
                            </div>
                            <span className="text-[10px] uppercase tracking-wider opacity-70">
                              {issue.priority}
                            </span>
                          </div>
                          <p className="text-xs opacity-80">{issue.description}</p>
                          <p className="text-xs mt-1 opacity-60">💡 {issue.suggestion}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 灵犀打磨 4.x：风格一致性检查 */}
          <div className="card p-4 mb-6">
            <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <Type className="w-4 h-4 text-blue-400" />
              风格一致性
              <button
                onClick={handleRunStyleConsistency}
                disabled={styleLoading}
                className="ml-auto px-2 py-1 text-[11px] bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded flex items-center gap-1 disabled:opacity-50"
              >
                {styleLoading ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />检查中</>
                ) : (
                  <><RefreshCw className="w-3 h-3" />{styleIssues ? '重新检查' : '开始检查'}</>
                )}
              </button>
            </h3>
            {!styleIssues ? (
              <div className="py-6 text-center text-xs text-ink-500" role="status" aria-live="polite">
                {styleLoading ? '正在跨章节比对视角、语气与用词…' : '检查跨章节视角/语气/用词的一致性'}
              </div>
            ) : styleIssues.length === 0 ? (
              <div className="py-4 text-center text-sm text-emerald-300">✨ 风格一致性良好</div>
            ) : (
              <div className="space-y-2">
                {styleIssues.map((issue, idx) => {
                  const chapter = chapters.find(c => c.id === issue.chapterId);
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${severityColors[issue.severity] || severityColors.info}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-medium">{issue.type}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-70">{issue.severity}</span>
                      </div>
                      {chapter && (
                        <div className="text-xs opacity-70 mb-1">章节：{chapter.title}</div>
                      )}
                      <p className="text-xs opacity-80">{issue.description}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 灵犀打磨 4.x：章节阅读体验分析 */}
          <div className="card p-4 mb-6">
            <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-emerald-400" />
              章节阅读体验
            </h3>
            <p className="text-xs text-ink-500 mb-3">
              点击下方章节按钮，AI 将检测长句、重复词并给出钩子分数（0-100，越高越能留住读者）
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {mainChapters.slice(0, 20).map(chapter => (
                <button
                  key={chapter.id}
                  onClick={() => handleAnalyzeReading(chapter.id)}
                  disabled={readingLoadingChapterId !== null}
                  className={`px-2 py-1 text-[11px] rounded transition-colors disabled:opacity-50 ${
                    readingAnalysis?.chapterId === chapter.id
                      ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                      : 'bg-ink-700/50 text-ink-300 hover:bg-ink-700'
                  }`}
                >
                  {readingLoadingChapterId === chapter.id ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {chapter.title.slice(0, 8)}
                    </span>
                  ) : (
                    chapter.title.slice(0, 12)
                  )}
                </button>
              ))}
              {mainChapters.length > 20 && (
                <span className="text-[10px] text-ink-500 self-center">…共 {mainChapters.length} 章</span>
              )}
            </div>
            {readingAnalysis ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-2 rounded-lg bg-ink-800/50">
                  <span className="text-xs text-ink-400">钩子分数</span>
                  <div className="flex-1 h-2 bg-ink-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        readingAnalysis.hookScore >= 70 ? 'bg-emerald-400' :
                        readingAnalysis.hookScore >= 40 ? 'bg-amber-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${readingAnalysis.hookScore}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-ink-200">{readingAnalysis.hookScore}</span>
                </div>
                {readingAnalysis.longSentences.length > 0 && (
                  <div>
                    <div className="text-xs text-ink-400 mb-1">
                      长句（{readingAnalysis.longSentences.length} 处）
                    </div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {readingAnalysis.longSentences.map((s, idx) => (
                        <div key={idx} className="text-[11px] text-ink-500 p-1.5 bg-ink-800/40 rounded">
                          <span className="text-ink-400">第 {s.paragraphIndex + 1} 段：</span>{s.preview}…
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {readingAnalysis.repeatedWords.length > 0 && (
                  <div>
                    <div className="text-xs text-ink-400 mb-1">高频重复词</div>
                    <div className="flex flex-wrap gap-1">
                      {readingAnalysis.repeatedWords.map((w, idx) => (
                        <span key={idx} className="px-2 py-0.5 text-[11px] bg-amber-400/10 text-amber-300 rounded">
                          {w.word} × {w.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {readingAnalysis.longSentences.length === 0 && readingAnalysis.repeatedWords.length === 0 && (
                  <div className="text-center text-sm text-emerald-300 py-2">✨ 本章未发现长句与高频重复词</div>
                )}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-ink-500">选择章节开始阅读体验分析</div>
            )}
          </div>

          {/* Chapter by Chapter */}
          <div className="card p-4">
            <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              各章数据
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-500 text-xs border-b border-ink-700/50">
                    <th className="pb-2 pr-4 font-medium">章节</th>
                    <th className="pb-2 pr-4 font-medium">字数</th>
                    <th className="pb-2 pr-4 font-medium">情绪</th>
                    <th className="pb-2 pr-4 font-medium">冲突</th>
                    <th className="pb-2 pr-4 font-medium">钩子</th>
                    <th className="pb-2 font-medium">节奏</th>
                  </tr>
                </thead>
                <tbody>
                  {mainChapters.map(chapter => {
                    const data = chapterAnalyses[chapter.id];
                    return (
                      <tr
                        key={chapter.id}
                        className="border-b border-ink-800/30 hover:bg-ink-800/30 cursor-pointer"
                        onClick={() => {
                          // 跳转前定位章节，避免进入编辑器后丢失当前章上下文
                          useAppStore.getState().setCurrentChapter(chapter.id);
                          navigate(`/project/${projectId}/editor`);
                        }}
                      >
                        <td className="py-2.5 pr-4">
                          <div className="text-ink-200">{chapter.title}</div>
                          <div className="text-[10px] text-ink-500">
                            {CHAPTER_STATUS_LABELS[chapter.status]}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-ink-300">
                          {(data?.wordCount ?? chapter.wordCount).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-red-400/70 rounded-full"
                                style={{ width: `${data?.emotionScore ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.emotionScore ?? '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-400/70 rounded-full"
                                style={{ width: `${data?.conflictIntensity ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.conflictIntensity ?? '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-400/70 rounded-full"
                                style={{ width: `${data?.hookStrength ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.hookStrength ?? '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400/70 rounded-full"
                                style={{ width: `${data?.pacingScore ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.pacingScore ?? '-'}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI 率检测 */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="card p-4">
              <AITracePanel scope="chapter" />
            </div>
            <div className="card p-4">
              <AITracePanel scope="book" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

