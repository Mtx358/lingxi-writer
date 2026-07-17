import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, AlertTriangle, TrendingUp, Heart, Zap, Clock, BookOpen, FileText } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import { CHAPTER_STATUS_LABELS } from '@/types';
import type { ChapterAnalysis } from '@/types';

export default function ReviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const loadProjects = useAppStore(s => s.loadProjects);
  const openProject = useAppStore(s => s.openProject);
  const characters = useAppStore(s => s.characters);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!projectId) return;
    loadProjects();
    openProject(projectId);
  }, [projectId, loadProjects, openProject]);

  useEffect(() => {
    if (chapters.length === 0) return;

    const runAnalysis = async () => {
      setLoading(true);
      try {
        const result = await aiService.analyzeStructure(chapters);
        setAnalysis(result);

        const chapterResults: Record<string, ChapterAnalysis> = {};
        for (const chapter of chapters.filter(c => c.level === 2)) {
          const analysis = await aiService.analyzeChapter(chapter);
          chapterResults[chapter.id] = analysis;
        }
        setChapterAnalyses(chapterResults);
      } finally {
        setLoading(false);
      }
    };

    runAnalysis();
  }, [chapters]);

  const project = projects.find(p => p.id === projectId);
  const mainChapters = chapters.filter(c => c.level === 2).sort((a, b) => a.order - b.order);

  if (!project) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-ink-950">
        <div className="text-ink-400">加载中...</div>
      </div>
    );
  }

  const severityColors: Record<string, string> = {
    error: 'text-red-400 bg-red-400/10 border-red-400/30',
    warning: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
    info: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 h-14 border-b border-ink-800/50 flex items-center justify-between px-4 bg-ink-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/project/${projectId}/editor`)}
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
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
                  <div className="text-2xl font-semibold text-ink-100">{project.totalWords.toLocaleString()}</div>
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
                    {Math.ceil(project.totalWords / 400)}
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
              ) : (
                <div className="h-32 flex items-end gap-1 px-2">
                  {analysis?.emotionCurve.map((val, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-gradient-to-t from-red-500/50 to-amber-400/50 rounded-t transition-all hover:from-red-500 hover:to-amber-300"
                      style={{ height: `${Math.max(10, val)}%` }}
                      title={`第${idx + 1}章：情绪值 ${val}`}
                    />
                  ))}
                </div>
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
              ) : (
                <div className="h-32 flex items-end gap-1 px-2">
                  {analysis?.pacing.map((val, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-gradient-to-t from-amber-600/50 to-amber-400/50 rounded-t transition-all hover:from-amber-500 hover:to-amber-300"
                      style={{ height: `${Math.max(10, val)}%` }}
                      title={`第${idx + 1}章：节奏值 ${val}`}
                    />
                  ))}
                </div>
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
                        onClick={() => navigate(`/project/${projectId}/editor`)}
                      >
                        <td className="py-2.5 pr-4">
                          <div className="text-ink-200">{chapter.title}</div>
                          <div className="text-[10px] text-ink-500">
                            {CHAPTER_STATUS_LABELS[chapter.status]}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-ink-300">
                          {data?.wordCount?.toLocaleString() || chapter.wordCount}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-red-400/70 rounded-full"
                                style={{ width: `${data?.emotionScore || 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.emotionScore || '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-400/70 rounded-full"
                                style={{ width: `${data?.conflictIntensity || 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.conflictIntensity || '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-400/70 rounded-full"
                                style={{ width: `${data?.hookStrength || 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.hookStrength || '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400/70 rounded-full"
                                style={{ width: `${data?.pacingScore || 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-500 w-8">{data?.pacingScore || '-'}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Users(props: { className?: string }) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
