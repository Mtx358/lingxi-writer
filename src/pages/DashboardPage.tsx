import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  LayoutDashboard,
  FileText,
  BookOpen,
  Clock,
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  CalendarClock,
  Flag,
  Target,
  Sparkles,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { CHAPTER_STATUS_LABELS, SUBPLOT_STATUS_LABELS, SUBPLOT_STATUS_COLORS } from '@/types';
import type { SubplotStatus } from '@/types';
import { READING_SPEED_WPM } from '@/constants/config';
import Empty from '@/components/Empty';
import ProjectNotFound from '@/components/ProjectNotFound';

// 警报阈值：支线停留 N 天未推进触发警报
const SUBPLOT_STALE_DAYS_PROGRESSING = 14;
const SUBPLOT_STALE_DAYS_OPEN = 7;
// 存稿安全阈值（天）
const STOCKPILE_SAFE_DAYS = 7;
const STOCKPILE_WARN_DAYS = 3;

export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const subplots = useAppStore(s => s.subplots);
  const updateSchedule = useAppStore(s => s.updateSchedule);
  const getStockpileDays = useAppStore(s => s.getStockpileDays);
  const loadProjects = useAppStore(s => s.loadProjects);
  const openProject = useAppStore(s => s.openProject);

  // 项目加载状态：loadProjects+openProject 完成后置 false，
  // 用于区分"加载中"与"项目不存在"两种 fallback 场景
  const [projectLoading, setProjectLoading] = useState(true);

  // 项目加载：await 串行，避免 loadProjects 未完成时 openProject 找不到 project
  // cancelled 守卫覆盖 await openProject 之前与之后两个时点：
  // 时序 bug 场景：A 的 loadProjects 完成 → cancelled_A=false → 开始 openProject(A)，
  //   此时用户切到 B → cancelled_A=true → A 的 openProject 仍在飞行且会把 store 切到 A，
  //   若 A 比 B 晚返回，最终状态会被切回 A。加 await 后再次检查可丢弃 A 的结果。
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setProjectLoading(true);
    (async () => {
      try {
        await loadProjects();
        if (cancelled) return;
        await openProject(projectId);
        // await openProject 之后再次检查：覆盖 A 的 openProject 比 B 晚返回的场景
        if (cancelled) return;
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadProjects, openProject]);

  const project = projects.find(p => p.id === projectId);
  const mainChapters = useMemo(
    () => chapters.filter(c => c.levelType === 'chapter').sort((a, b) => a.order - b.order),
    [chapters],
  );

  // 派生统计
  const stats = useMemo(() => {
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const doneChapters = mainChapters.filter(c => c.status === 'done').length;
    const draftChapters = mainChapters.filter(c => c.status === 'draft').length;
    const completionRate = mainChapters.length > 0 ? Math.round((doneChapters / mainChapters.length) * 100) : 0;
    const readingMinutes = Math.ceil(totalWords / READING_SPEED_WPM);
    return {
      totalWords,
      chapterCount: mainChapters.length,
      doneChapters,
      draftChapters,
      completionRate,
      readingMinutes,
      characterCount: characters.length,
    };
  }, [chapters, mainChapters, characters]);

  // 伏笔回收统计
  const foreshadowStats = useMemo(() => {
    const total = foreshadows.length;
    const paidOff = foreshadows.filter(f => f.status === 'paid-off').length;
    const planted = foreshadows.filter(f => f.status === 'planted').length;
    const progressing = foreshadows.filter(f => f.status === 'progressing').length;
    const abandoned = foreshadows.filter(f => f.status === 'abandoned').length;
    const recoveryRate = total > 0 ? Math.round((paidOff / total) * 100) : 100;
    return { total, paidOff, planted, progressing, abandoned, recoveryRate };
  }, [foreshadows]);

  // 支线状态分布
  const subplotStats = useMemo(() => {
    const byStatus: Record<SubplotStatus, number> = {
      open: 0,
      progressing: 0,
      paused: 0,
      closed: 0,
      abandoned: 0,
    };
    subplots.forEach(s => {
      byStatus[s.status]++;
    });
    return {
      byStatus,
      total: subplots.length,
      active: byStatus.open + byStatus.progressing,
    };
  }, [subplots]);

  // 存稿天数：依赖 chapters 与 updateSchedule，否则 getStockpileDays 内部读取的
  // store 状态变化时本 memo 不会重算，导致存稿天数永远陈旧。
  /* eslint-disable react-hooks/exhaustive-deps -- getStockpileDays 是 store getter，
     静态分析看不到它内部读 chapters/updateSchedule，需手动加 deps 触发重算 */
  const stockpileDays = useMemo(
    () => getStockpileDays(),
    [getStockpileDays, chapters, updateSchedule],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  // 警报列表：综合支线停滞 / 存稿告急 / 伏笔悬而未决 / 草稿堆积
  const alerts = useMemo(() => {
    const now = Date.now();
    const items: { level: 'high' | 'medium' | 'low'; title: string; detail: string }[] = [];

    // 1. 支线停滞
    subplots.forEach(s => {
      if (s.status === 'closed' || s.status === 'abandoned') return;
      const updated = s.updatedAt ? new Date(s.updatedAt).getTime() : new Date(s.createdAt).getTime();
      const daysSince = Math.floor((now - updated) / (24 * 60 * 60 * 1000));
      const threshold = s.status === 'open' ? SUBPLOT_STALE_DAYS_OPEN : SUBPLOT_STALE_DAYS_PROGRESSING;
      if (daysSince >= threshold) {
        items.push({
          level: s.status === 'open' ? 'medium' : 'high',
          title: `支线「${s.title}」已 ${daysSince} 天未推进`,
          detail: `当前状态：${SUBPLOT_STATUS_LABELS[s.status]}，建议尽快推进或显式标记为"暂停"`,
        });
      }
    });

    // 2. 存稿告急
    if (updateSchedule) {
      if (stockpileDays < STOCKPILE_WARN_DAYS) {
        items.push({
          level: 'high',
          title: `存稿仅剩 ${stockpileDays} 天`,
          detail: `低于 ${STOCKPILE_WARN_DAYS} 天警戒线，断更风险高，建议立即补稿`,
        });
      } else if (stockpileDays < STOCKPILE_SAFE_DAYS) {
        items.push({
          level: 'medium',
          title: `存稿 ${stockpileDays} 天，临近警戒线`,
          detail: `建议保持每日写作节奏，避免跌破 ${STOCKPILE_WARN_DAYS} 天`,
        });
      }
    }

    // 3. 伏笔悬而未决（planted 状态超过 5 章）
    mainChapters.forEach((ch, idx) => {
      foreshadows.forEach(f => {
        if (f.status !== 'planted') return;
        if (f.plantedChapterId === ch.id && idx < mainChapters.length - 5) {
          items.push({
            level: 'medium',
            title: `伏笔「${f.title}」已埋设 ${mainChapters.length - idx} 章未推进`,
            detail: '建议尽快推进或回收，避免读者遗忘',
          });
        }
      });
    });

    // 4. 草稿堆积
    if (stats.draftChapters >= 5) {
      items.push({
        level: 'low',
        title: `${stats.draftChapters} 章处于草稿状态`,
        detail: '考虑集中打磨后再发布，避免大量半成品堆积',
      });
    }

    return items;
  }, [subplots, updateSchedule, stockpileDays, foreshadows, mainChapters, stats.draftChapters]);

  if (!project) {
    return <ProjectNotFound loading={projectLoading} onBackHome={() => navigate('/')} />;
  }

  const alertStyle = {
    high: 'bg-red-500/10 text-red-300 border-red-500/30',
    medium: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
    low: 'bg-blue-400/10 text-blue-300 border-blue-400/30',
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
              <LayoutDashboard className="w-4 h-4 text-amber-400" />
              总控仪表盘
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
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {/* 警报横幅（若有 high 级别） */}
          {alerts.some(a => a.level === 'high') && (
            <div className="card p-4 border-red-500/30 bg-red-500/5">
              <div className="flex items-center gap-2 text-red-300 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {alerts.filter(a => a.level === 'high').length} 项高优先级警报
                </span>
              </div>
              <p className="text-xs text-red-300/80">
                建议优先处理下方标红的警报项，避免断更或剧情失控
              </p>
            </div>
          )}

          {/* 统计卡片 6 列 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={FileText} color="amber" value={stats.chapterCount} label="章节" />
            <StatCard icon={BookOpen} color="blue" value={stats.totalWords.toLocaleString()} label="总字数" />
            <StatCard icon={Clock} color="emerald" value={stats.readingMinutes} label="阅读分钟" />
            <StatCard icon={Users} color="purple" value={stats.characterCount} label="角色" />
            <StatCard icon={GitBranch} color="pink" value={subplotStats.total} label="支线" />
            <StatCard icon={Flag} color="indigo" value={foreshadowStats.total} label="伏笔" />
          </div>

          {/* 完成度 + 存稿 + 伏笔回收率 三栏 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 完成度 */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-medium text-ink-200">全书完成度</h3>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-bold text-amber-300">{stats.completionRate}</span>
                <span className="text-sm text-ink-500">%</span>
              </div>
              <div className="w-full h-2 bg-ink-700 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full transition-all"
                  style={{ width: `${stats.completionRate}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-ink-500">
                <span>已完成 {stats.doneChapters} 章</span>
                <span>草稿 {stats.draftChapters} 章</span>
              </div>
            </div>

            {/* 存稿 */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <CalendarClock className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-medium text-ink-200">存稿储备</h3>
              </div>
              {updateSchedule ? (
                <>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-bold text-blue-300">
                      {stockpileDays}
                    </span>
                    <span className="text-sm text-ink-500">天</span>
                  </div>
                  <div className="w-full h-2 bg-ink-700 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all ${
                        stockpileDays < STOCKPILE_WARN_DAYS ? 'bg-red-400' :
                        stockpileDays < STOCKPILE_SAFE_DAYS ? 'bg-amber-400' :
                        'bg-emerald-400'
                      }`}
                      style={{
                        width: `${Math.min(100, (stockpileDays / 30) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-ink-500">
                    <span>日目标 {updateSchedule.dailyTargetWords.toLocaleString()} 字</span>
                    <span>速度 {updateSchedule.dailySpeed} 字/日</span>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-xs text-ink-500">
                  未配置存稿计划
                  <br />
                  <button
                    onClick={() => navigate(`/project/${projectId}/editor`)}
                    className="mt-2 text-amber-400 hover:text-amber-300"
                  >
                    在右侧"存稿"标签配置 →
                  </button>
                </div>
              )}
            </div>

            {/* 伏笔回收率 */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Flag className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-medium text-ink-200">伏笔回收率</h3>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-bold text-indigo-300">{foreshadowStats.recoveryRate}</span>
                <span className="text-sm text-ink-500">%</span>
              </div>
              <div className="w-full h-2 bg-ink-700 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-gradient-to-r from-indigo-400 to-emerald-400 rounded-full transition-all"
                  style={{ width: `${foreshadowStats.recoveryRate}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-ink-500">
                <span>已回收 {foreshadowStats.paidOff}</span>
                <span>推进中 {foreshadowStats.progressing}</span>
                <span>已埋设 {foreshadowStats.planted}</span>
              </div>
            </div>
          </div>

          {/* 警报列表 */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-ink-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                警报中心
              </h3>
              <span className="text-xs text-ink-500">{alerts.length} 项</span>
            </div>
            {alerts.length === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-emerald-300">一切正常，无任何警报</p>
                <p className="text-xs text-ink-500 mt-1">支线、存稿、伏笔、草稿均处于健康状态</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border text-xs ${alertStyle[alert.level]}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{alert.title}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {alert.level === 'high' ? '高' : alert.level === 'medium' ? '中' : '低'}
                      </span>
                    </div>
                    <p className="opacity-80">{alert.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 支线状态分布 */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-ink-200 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-pink-400" />
                支线状态分布
              </h3>
              <button
                onClick={() => navigate(`/project/${projectId}/editor`)}
                className="text-xs text-amber-400 hover:text-amber-300"
              >
                管理支线 →
              </button>
            </div>
            {subplotStats.total === 0 ? (
              <Empty
                title="暂无支线"
                className="py-6 text-xs text-ink-500"
                action={
                  <button
                    onClick={() => navigate(`/project/${projectId}/editor`)}
                    className="mt-2 text-amber-400 hover:text-amber-300"
                  >
                    在右侧"支线"标签新建 →
                  </button>
                }
              />
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {(Object.keys(SUBPLOT_STATUS_LABELS) as SubplotStatus[]).map(status => (
                  <div key={status} className="p-3 rounded-lg bg-ink-800/50 text-center">
                    <div className={`w-2 h-2 rounded-full mx-auto mb-2 ${SUBPLOT_STATUS_COLORS[status]}`} />
                    <div className="text-2xl font-bold text-ink-100">
                      {subplotStats.byStatus[status]}
                    </div>
                    <div className="text-[10px] text-ink-500 mt-1">
                      {SUBPLOT_STATUS_LABELS[status]}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 章节完成度快览 */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-ink-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                章节进度概览
              </h3>
              <span className="text-xs text-ink-500">
                {stats.doneChapters} / {stats.chapterCount} 已完成
              </span>
            </div>
            {mainChapters.length === 0 ? (
              <Empty title="暂无章节" className="py-6 text-xs text-ink-500" />
            ) : (
              <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-[repeat(15,minmax(0,1fr))] lg:grid-cols-[repeat(20,minmax(0,1fr))] gap-1">
                {mainChapters.map((ch, idx) => (
                  <button
                    key={ch.id}
                    onClick={() => {
                      useAppStore.getState().setCurrentChapter(ch.id);
                      navigate(`/project/${projectId}/editor`);
                    }}
                    title={`第 ${idx + 1} 章：${ch.title}（${CHAPTER_STATUS_LABELS[ch.status]}）`}
                    className={`aspect-square rounded text-[9px] flex items-center justify-center transition-colors ${
                      ch.status === 'done' ? 'bg-emerald-400/30 text-emerald-300 hover:bg-emerald-400/50' :
                      ch.status === 'draft' ? 'bg-amber-400/20 text-amber-300 hover:bg-amber-400/40' :
                      ch.status === 'writing' ? 'bg-blue-400/20 text-blue-300 hover:bg-blue-400/40' :
                        'bg-ink-700/50 text-ink-500 hover:bg-ink-700'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 灵犀助手六大模块快捷入口 */}
          <div className="card p-4">
            <h3 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              灵犀助手快捷入口
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              <QuickLink
                icon={Target}
                label="灵犀设定"
                desc="设定卡"
                onClick={() => {
                  useAppStore.getState().setRightPanelTab('coreSetting');
                  navigate(`/project/${projectId}/editor`);
                }}
              />
              <QuickLink
                icon={LayoutDashboard}
                label="灵犀蓝图"
                desc="故事蓝图"
                onClick={() => {
                  useAppStore.getState().setRightPanelTab('blueprint');
                  navigate(`/project/${projectId}/editor`);
                }}
              />
              <QuickLink
                icon={Sparkles}
                label="灵犀写作"
                desc="AI 助手"
                onClick={() => {
                  useAppStore.getState().setRightPanelTab('ai');
                  navigate(`/project/${projectId}/editor`);
                }}
              />
              <QuickLink
                icon={TrendingUp}
                label="灵犀打磨"
                desc="审稿中心"
                onClick={() => navigate(`/project/${projectId}/review`)}
              />
              <QuickLink
                icon={BookOpen}
                label="灵犀发布"
                desc="导出"
                onClick={() => navigate(`/project/${projectId}/export`)}
              />
              <QuickLink
                icon={GitBranch}
                label="支线/存稿"
                desc="总控"
                onClick={() => {
                  useAppStore.getState().setRightPanelTab('subplot');
                  navigate(`/project/${projectId}/editor`);
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  color,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: 'amber' | 'blue' | 'emerald' | 'purple' | 'pink' | 'indigo';
  value: number | string;
  label: string;
}) {
  const colorMap = {
    amber: 'bg-amber-400/10 text-amber-400',
    blue: 'bg-blue-400/10 text-blue-400',
    emerald: 'bg-emerald-400/10 text-emerald-400',
    purple: 'bg-purple-400/10 text-purple-400',
    pink: 'bg-pink-400/10 text-pink-400',
    indigo: 'bg-indigo-400/10 text-indigo-400',
  };
  return (
    <div className="card p-3">
      <div className={`w-8 h-8 rounded-lg ${colorMap[color]} flex items-center justify-center mb-2`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-xl font-semibold text-ink-100">{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  );
}

function QuickLink({
  icon: Icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-3 rounded-lg bg-ink-800/50 hover:bg-ink-700/50 transition-colors text-left"
    >
      <Icon className="w-4 h-4 text-amber-400 mb-1.5" />
      <div className="text-xs font-medium text-ink-200">{label}</div>
      <div className="text-[10px] text-ink-500 mt-0.5">{desc}</div>
    </button>
  );
}
