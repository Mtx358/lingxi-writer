/**
 * 灵犀打磨台：独立全屏工作台
 *
 * 核心理念：AI 负责算力，人类负责判断。
 * 打开就看到最紧急的问题，点一下就能处理，改完立刻生效。
 *
 * 布局：
 *   顶部工具栏（返回 / 一键体检 / 生成快照 / 同步大纲 / 锁定蓝图）
 *   项目健康度总览（可折叠，按风险优先级排序，每项带快捷操作）
 *   智能引导（AI 推荐本次打磨顺序）
 *   横向步骤条（灵感 → 骨架 → 章节 → 校验 → 颠覆）
 *   全屏工作区（当前阶段的完整操作面板）
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Wand2,
  Stethoscope,
  Camera,
  RefreshCw,
  Lock,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Clock,
  Play,
  Lightbulb,
  Coffee,
  Zap,
  FileText,
  Users,
  Flag,
  Globe,
  BookOpen,
  Map,
  Layers,
  Undo2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { READING_SPEED_WPM } from '@/constants/config';
import { toast } from '@/hooks/useToast';
import ProjectNotFound from '@/components/ProjectNotFound';
import { lazy, Suspense } from 'react';
import type { InspirationCard, Character, Foreshadow } from '@/types';
import {
  analyzeProjectHealth,
  recommendPolishGuide,
  type ProjectHealthReport,
  type PolishGuide,
  type HealthIssue,
} from '@/utils/aiService/health';
const OutlinePolishPanel = lazy(() => import('@/components/editor/outlinePolish/OutlinePolishPanel'));

// 核心驱动类型 → 中文标签
const DRIVER_TYPE_LABELS: Record<string, string> = {
  character: '人物驱动',
  plot: '情节驱动',
  theme: '主题驱动',
};

// 打磨强度模式
type PolishMode = 'deep' | 'light' | 'walk';

const MODE_META: Record<PolishMode, { label: string; icon: typeof Zap; desc: string }> = {
  deep: { label: '深度打磨', icon: Zap, desc: '完整功能：影响树、沙盒、全身体检' },
  light: { label: '轻量维护', icon: Flag, desc: '只显示逾期伏笔、支线停滞、存稿预警等红点问题' },
  walk: { label: '散步模式', icon: Coffee, desc: '随机推送灵感卡、角色档案、已回收伏笔回顾' },
};

function PolishFallback() {
  return (
    <div className="flex items-center justify-center h-full text-ink-500 text-sm">
      <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
    </div>
  );
}

export default function PolishPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // ===== Store 数据 =====
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const characters = useAppStore(s => s.characters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const settingItems = useAppStore(s => s.settingItems);
  const inspirationCards = useAppStore(s => s.inspirationCards);
  const outlineSnapshots = useAppStore(s => s.outlineSnapshots);
  const coreDriver = useAppStore(s => s.coreDriver);
  const getBlueprint = useAppStore(s => s.getBlueprint);
  const subplots = useAppStore(s => s.subplots);
  const updateSchedule = useAppStore(s => s.updateSchedule);
  const loadProjects = useAppStore(s => s.loadProjects);
  const openProject = useAppStore(s => s.openProject);
  const saveOutlineSnapshot = useAppStore(s => s.saveOutlineSnapshot);
  const lockBlueprint = useAppStore(s => s.lockBlueprint);
  const isPolishingOutline = useAppStore(s => s.isPolishingOutline);
  const runOutlinePolish = useAppStore(s => s.runOutlinePolish);
  // 问题点「在编辑器中打开」：跳转到对应章节正文
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  // 打磨日志域：记录动作 + 退出时生成摘要
  const recordPolishAction = useAppStore(s => s.recordPolishAction);
  const finishPolishSession = useAppStore(s => s.finishPolishSession);
  const polishLog = useAppStore(s => s.polishLog);
  // 全局撤销栈：Ctrl+Z 回退结构性改动（新增/删除/重排章节）
  const undoStack = useAppStore(s => s.undoStack);
  const performUndo = useAppStore(s => s.performUndo);
  // 编辑器→打磨台自动复检标记（规格书 3.2）：编辑器保存正文后置 true，打磨台据此自动重跑健康度
  const polishRecheckNeeded = useAppStore(s => s.polishRecheckNeeded);
  const clearPolishRecheckNeeded = useAppStore(s => s.clearPolishRecheckNeeded);

  // ===== 本地状态 =====
  const [projectLoading, setProjectLoading] = useState(true);
  const [healthReport, setHealthReport] = useState<ProjectHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCollapsed, setHealthCollapsed] = useState(false);
  const [guide, setGuide] = useState<PolishGuide | null>(null);
  const [mode, setMode] = useState<PolishMode>('deep');
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);
  // 智能引导「按顺序处理」：当前执行到的步骤下标（null=未启动，0=第一步）
  // 跟踪 guide.steps 的进度，配合「处理完成，下一个」按钮推进
  const [currentGuideStep, setCurrentGuideStep] = useState<number | null>(null);
  // 打磨日志浮层
  const [showPolishLog, setShowPolishLog] = useState(false);

  // ===== 打磨位置持久化 + 异常恢复 =====
  // 离开/崩溃后再次进入打磨台，恢复到上次的模式与引导步骤，避免「找不回刚才改到哪」。
  // 按项目维度存 localStorage，进程被杀也能恢复（unmount 写 + 变更即写双保险）。
  const positionKey = projectId ? `polish:position:${projectId}` : null;
  const pendingGuideStepRef = useRef<number | null>(null);
  const restoredRef = useRef(false);

  // 恢复：仅在本项目首次挂载时读一次
  useEffect(() => {
    if (!positionKey || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(positionKey);
      if (!raw) return;
      const pos = JSON.parse(raw) as { mode?: PolishMode; currentGuideStep?: number | null; savedAt?: number };
      if (pos.mode && (pos.mode === 'deep' || pos.mode === 'light' || pos.mode === 'walk')) {
        setMode(pos.mode);
      }
      if (typeof pos.currentGuideStep === 'number') {
        pendingGuideStepRef.current = pos.currentGuideStep;
      }
      if (pos.savedAt && Date.now() - pos.savedAt < 7 * 24 * 3600 * 1000) {
        // 7 天内的位置才提示恢复，过期的静默丢弃
        const when = new Date(pos.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        toast.info('已恢复上次的打磨位置', `模式：${MODE_META[pos.mode || 'deep'].label}（${when}）`);
      }
    } catch {
      // 损坏的位置数据静默丢弃，不阻塞打磨台
    }
  }, [positionKey]);

  // 引导加载后，把待恢复的步骤下标应用到 guide（需校验下标仍有效）
  useEffect(() => {
    if (guide && pendingGuideStepRef.current !== null) {
      const idx = pendingGuideStepRef.current;
      pendingGuideStepRef.current = null;
      if (idx >= 0 && idx < guide.steps.length) {
        setCurrentGuideStep(idx);
      }
    }
  }, [guide]);

  // 持久化：模式或引导步骤变化即写，崩溃也能保住最近位置
  useEffect(() => {
    if (!positionKey) return;
    try {
      localStorage.setItem(positionKey, JSON.stringify({
        mode,
        currentGuideStep,
        savedAt: Date.now(),
      }));
    } catch {
      // 配额满或禁用 localStorage 时静默，不阻塞打磨
    }
  }, [positionKey, mode, currentGuideStep]);

  // ===== 加载项目 =====
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setProjectLoading(true);
    (async () => {
      try {
        await loadProjects();
        if (cancelled) return;
        const p = useAppStore.getState().projects.find(p => p.id === projectId);
        if (p) await openProject(projectId);
        if (!cancelled) setProjectLoading(false);
      } catch (e) {
        if (!cancelled) {
          setProjectLoading(false);
          console.error('PolishPage 加载项目失败:', e);
          toast.error('项目加载失败', '请返回首页重试，或检查项目文件是否可访问');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadProjects, openProject]);

  const project = projects.find(p => p.id === projectId);
  const blueprint = project ? getBlueprint() : null;

  // ===== 全局统计 =====
  const stats = useMemo(() => {
    const mainChapters = chapters.filter(c => c.levelType === 'chapter');
    const totalWords = mainChapters.reduce((sum, ch) => sum + ch.wordCount, 0);
    const doneChapters = mainChapters.filter(c => c.status === 'done').length;
    const readingMinutes = Math.round(totalWords / READING_SPEED_WPM);
    const completionRate = mainChapters.length > 0
      ? Math.round((doneChapters / mainChapters.length) * 100)
      : 0;
    const foreshadowPaidOff = foreshadows.filter(f => f.status === 'paid-off').length;
    const foreshadowRecovery = foreshadows.length > 0
      ? Math.round((foreshadowPaidOff / foreshadows.length) * 100)
      : 100;
    const inspirationActive = inspirationCards.filter(c => !c.parentId).length;

    return {
      mainChapters,
      totalWords,
      doneChapters,
      readingMinutes,
      completionRate,
      foreshadowRecovery,
      inspirationActive,
    };
  }, [chapters, foreshadows, inspirationCards]);

  // ===== 健康度诊断 =====
  // mountedRef 守卫：analyzeProjectHealth/recommendPolishGuide 是 AI 调用，耗时较长，
  // 用户可能在此期间离开页面，await 后的 setState 需校验组件未卸载
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const runHealthCheck = useCallback(async () => {
    if (!project) return;
    setHealthLoading(true);
    try {
      const report = await analyzeProjectHealth({
        chapters,
        characters,
        foreshadows,
        subplots,
        updateSchedule,
        coreDriver,
        blueprint,
      });
      if (!mountedRef.current) return;
      setHealthReport(report);
      const g = await recommendPolishGuide(report);
      if (!mountedRef.current) return;
      setGuide(g);
    } catch (e) {
      // 诊断失败：保留上次报告供用户继续参考，但需明确提示而非静默
      if (!mountedRef.current) return;
      console.warn('健康度诊断失败:', e);
      toast.warning('健康度诊断失败', '可重试一键体检；当前展示上次诊断结果');
    } finally {
      if (mountedRef.current) setHealthLoading(false);
    }
  }, [project, chapters, characters, foreshadows, subplots, updateSchedule, coreDriver, blueprint]);

  // 项目加载完成后自动跑一次健康检查
  useEffect(() => {
    if (project && !projectLoading && !healthReport) {
      runHealthCheck();
    }
  }, [project, projectLoading, healthReport, runHealthCheck]);

  // ===== 编辑器→打磨台自动复检（规格书 3.2）=====
  // 编辑器正文保存后 chapterSlice.updateChapterContent 会置 polishRecheckNeeded=true。
  // 打磨台常驻期间监听此标记：为 true 时自动重跑健康度诊断（复检），复检后清标记。
  // 打磨台未挂载时标记会保留，下次进入时由上面的"首次健康检查"effect 兜底跑一次。
  // 防抖保护：复检是 AI 调用，编辑器高频保存会连续置 true，用 healthLoading 守卫避免并发重跑。
  useEffect(() => {
    if (!polishRecheckNeeded) return;
    if (healthLoading) return; // 上一轮复检还在跑，跳过本次，标记保留等下一轮
    if (!project) return;
    // 复检前先清标记，避免 runHealthCheck 内部 setState 触发的重渲染又进来一次
    clearPolishRecheckNeeded();
    runHealthCheck();
  }, [polishRecheckNeeded, healthLoading, project, runHealthCheck, clearPolishRecheckNeeded]);

  // ===== 大改前提醒 =====
  // 一键体检等会改动大纲结构的操作，若距上次快照超过 10 分钟（或无快照），
  // 先弹层让用户选择「先存快照」/「直接继续」/「取消」，避免大改后无法回退。
  const [bigChangeModal, setBigChangeModal] = useState<{ label: string; onConfirm: () => void } | null>(null);
  const minutesSinceLastSnapshot = useMemo(() => {
    if (outlineSnapshots.length === 0) return Infinity;
    const last = outlineSnapshots[0];
    const lastTs = last?.createdAt ? new Date(last.createdAt).getTime() : 0;
    return Math.floor((Date.now() - lastTs) / 60000);
  }, [outlineSnapshots]);

  const ensureSnapshotBeforeBigChange = useCallback((label: string, action: () => void) => {
    // 距上次快照 <10 分钟，直接放行（刚备份过，无需打断）
    if (minutesSinceLastSnapshot < 10) {
      action();
      return;
    }
    setBigChangeModal({ label, onConfirm: action });
  }, [minutesSinceLastSnapshot]);

  // ===== 一键全面体检（跑大纲诊断） =====
  // 大改前提醒：体检会重写大纲诊断结果，距上次快照超 10 分钟先确认
  const handleFullDiagnosis = useCallback(() => {
    ensureSnapshotBeforeBigChange('一键全面体检', () => {
      if (projectId) {
        runOutlinePolish('all');
      }
      runHealthCheck();
    });
  }, [projectId, runOutlinePolish, runHealthCheck, ensureSnapshotBeforeBigChange]);

  // ===== 生成快照 =====
  // toastTimerRef 守卫：组件卸载时清理 3s 定时器，避免卸载后 setState
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);
  const handleSaveSnapshot = useCallback(() => {
    const snap = saveOutlineSnapshot(`打磨前快照 ${new Date().toLocaleString('zh-CN')}`);
    if (snap) {
      setSnapshotToast(`已生成快照：${snap.label}`);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setSnapshotToast(null), 3000);
      // 记录到打磨会话计数器
      recordPolishAction('snapshot');
    }
  }, [saveOutlineSnapshot, recordPolishAction]);

  // ===== 10 分钟静默快照定时器 =====
  // 打磨台常驻期间每 10 分钟自动存一份快照，作为崩溃/误操作的兜底安全网。
  // 「静默」：不弹窗打断，仅用一次性 info 提示让用户知道发生了。
  const autoSnapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    autoSnapshotTimerRef.current = setInterval(() => {
      const snap = saveOutlineSnapshot(`自动快照 ${new Date().toLocaleString('zh-CN')}`);
      if (snap) {
        recordPolishAction('snapshot');
        toast.info('已自动生成快照', '每 10 分钟静默备份一次，可在快照列表查看');
      }
    }, 10 * 60 * 1000);
    return () => {
      if (autoSnapshotTimerRef.current) clearInterval(autoSnapshotTimerRef.current);
    };
  }, [saveOutlineSnapshot, recordPolishAction]);

  const handleBigChangeSnapshotFirst = useCallback(() => {
    handleSaveSnapshot();
    const next = bigChangeModal?.onConfirm;
    setBigChangeModal(null);
    if (next) next();
  }, [bigChangeModal, handleSaveSnapshot]);

  const handleBigChangeProceed = useCallback(() => {
    const next = bigChangeModal?.onConfirm;
    setBigChangeModal(null);
    if (next) next();
  }, [bigChangeModal]);

  // ===== 打磨会话生命周期 =====
  // 组件卸载（离开打磨台）时自动生成成果摘要日志
  useEffect(() => {
    return () => {
      finishPolishSession();
    };
  }, [finishPolishSession]);

  // ===== 全局撤销快捷键 Ctrl+Z / Cmd+Z =====
  // 打磨台是独立页面（不含正文编辑器），此处 Ctrl+Z 触发结构撤销栈，
  // 回退新增/删除/重排章节等结构性改动。输入框/文本域/富文本内放行，保留原生文本撤销。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el instanceof HTMLElement && el.isContentEditable)) {
        return; // 文本编辑场景交由原生撤销
      }
      e.preventDefault();
      performUndo(); // 栈空时返回 null 且静默；成功时 performUndo 内部已 toast
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [performUndo]);

  // ===== 手动撤销按钮 =====
  const handleUndo = useCallback(() => {
    performUndo();
  }, [performUndo]);

  // ===== 锁定蓝图 =====
  const handleLockBlueprint = useCallback(() => {
    if (blueprint && !blueprint.lockedAt) {
      lockBlueprint();
    }
  }, [blueprint, lockBlueprint]);

  // ===== 健康问题快捷跳转 =====
  const handleIssueAction = useCallback((issue: HealthIssue) => {
    // 切换到对应 Tab — 通过 localStorage 传递给 OutlinePolishPanel
    if (issue.actionTab) {
      localStorage.setItem('polish:targetTab', issue.actionTab);
      // 触发 storage 事件让 OutlinePolishPanel 监听
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'polish:targetTab',
        newValue: issue.actionTab,
      }));
    }
    if (issue.actionChapterId) {
      localStorage.setItem('polish:targetChapter', issue.actionChapterId);
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'polish:targetChapter',
        newValue: issue.actionChapterId,
      }));
    }
  }, []);

  // ===== 智能引导「按顺序处理」 =====
  // 复用 guide.steps[i].targetTab/targetChapterId，跳转逻辑与 handleIssueAction 一致
  const jumpToGuideStep = useCallback((step: { targetTab: string; targetChapterId?: string }) => {
    localStorage.setItem('polish:targetTab', step.targetTab);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'polish:targetTab',
      newValue: step.targetTab,
    }));
    if (step.targetChapterId) {
      localStorage.setItem('polish:targetChapter', step.targetChapterId);
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'polish:targetChapter',
        newValue: step.targetChapterId,
      }));
    }
  }, []);

  // 启动按顺序处理：跳转到第一个步骤
  const handleStartGuideSequence = useCallback(() => {
    if (!guide || guide.steps.length === 0) return;
    setCurrentGuideStep(0);
    jumpToGuideStep(guide.steps[0]);
  }, [guide, jumpToGuideStep]);

  // 处理完当前步骤，推进到下一个；最后一个则完成序列
  const handleAdvanceGuideStep = useCallback(() => {
    if (!guide || currentGuideStep === null) return;
    const next = currentGuideStep + 1;
    if (next >= guide.steps.length) {
      // 全部处理完，退出序列模式
      setCurrentGuideStep(null);
      toast.success('引导序列已完成', `${guide.steps.length} 个问题已依次处理`);
      return;
    }
    setCurrentGuideStep(next);
    jumpToGuideStep(guide.steps[next]);
  }, [guide, currentGuideStep, jumpToGuideStep]);

  // 手动退出序列模式
  const handleExitGuideSequence = useCallback(() => {
    setCurrentGuideStep(null);
  }, []);

  // ===== 同步大纲（跳转编辑器） =====
  const handleSyncToEditor = useCallback(() => {
    navigate(`/project/${projectId}/editor`);
  }, [navigate, projectId]);

  // ===== 问题点「在编辑器中打开」 =====
  // 带 actionChapterId 的问题可直接跳到该章节正文，闭环「发现 → 改」
  const handleOpenIssueInEditor = useCallback((issue: HealthIssue) => {
    if (issue.actionChapterId) {
      setCurrentChapter(issue.actionChapterId);
    }
    navigate(`/project/${projectId}/editor`);
  }, [navigate, projectId, setCurrentChapter]);

  if (!project) {
    return <ProjectNotFound loading={projectLoading} onBackHome={() => navigate('/')} />;
  }

  const highIssues = healthReport?.issues.filter(i => i.severity === 'high') ?? [];
  const mediumIssues = healthReport?.issues.filter(i => i.severity === 'medium') ?? [];

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay pointer-events-none" aria-hidden="true" />

      {/* ===== 顶部工具栏 ===== */}
      <header className="relative z-20 h-14 border-b border-ink-800/50 flex items-center justify-between px-4 bg-ink-900/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/project/${projectId}/editor`)}
            aria-label="返回编辑器"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-amber-400" />
            <h1 className="text-base font-semibold text-ink-100">灵犀打磨台</h1>
            <span className="text-xs text-ink-500">— {project.title}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 打磨强度切换 */}
          <div className="flex items-center gap-0.5 bg-ink-800/50 rounded-md p-0.5 mr-2">
            {(Object.keys(MODE_META) as PolishMode[]).map(m => {
              const M = MODE_META[m];
              const Icon = M.icon;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  title={M.desc}
                  className={`px-2 py-1 text-[11px] rounded flex items-center gap-1 transition-colors ${
                    mode === m
                      ? 'bg-amber-400/15 text-amber-300'
                      : 'text-ink-500 hover:text-ink-300'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {M.label}
                </button>
              );
            })}
          </div>

          {/* 一键体检 */}
          <button
            onClick={handleFullDiagnosis}
            disabled={healthLoading || isPolishingOutline}
            title="跑完全维度诊断，生成体检报告"
            className="px-3 py-1.5 text-xs rounded-md bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {healthLoading || isPolishingOutline ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Stethoscope className="w-3.5 h-3.5" />
            )}
            一键体检
          </button>

          {/* 生成快照 */}
          <button
            onClick={handleSaveSnapshot}
            title="大改前随手存版本"
            className="px-3 py-1.5 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5"
          >
            <Camera className="w-3.5 h-3.5" />
            快照
          </button>

          {/* 同步大纲 */}
          <button
            onClick={handleSyncToEditor}
            title="返回编辑器查看大纲同步效果"
            className="px-3 py-1.5 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            同步
          </button>

          {/* 锁定蓝图 */}
          {blueprint && !blueprint.lockedAt && (
            <button
              onClick={handleLockBlueprint}
              title="锁定全局蓝图，后续修改自动生成影响报告"
              className="px-3 py-1.5 text-xs rounded-md bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              锁定蓝图
            </button>
          )}
          {blueprint?.lockedAt && (
            <span className="px-2 py-1.5 text-[11px] text-emerald-400 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              蓝图已锁定
            </span>
          )}

          {/* 打磨日志 */}
          <button
            onClick={() => setShowPolishLog(true)}
            title="查看打磨成果摘要与成长轨迹"
            className="px-3 py-1.5 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5" />
            日志{polishLog.length > 0 && `(${polishLog.length})`}
          </button>

          {/* 全局撤销（Ctrl+Z）：回退结构性改动 */}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title={undoStack.length > 0 ? `撤销：${undoStack[0].description}（Ctrl+Z）` : '撤销栈为空'}
            className="px-3 py-1.5 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
            撤销{undoStack.length > 0 && `(${undoStack.length})`}
          </button>
        </div>
      </header>

      {/* ===== 打磨日志浮层 ===== */}
      {showPolishLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPolishLog(false)}
          role="dialog"
          aria-modal="true"
          aria-label="打磨日志"
        >
          <div
            className="card p-5 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-ink-100">打磨日志</h3>
                <span className="text-[11px] text-ink-500">每次离开打磨台自动记录</span>
              </div>
              <button
                onClick={() => setShowPolishLog(false)}
                className="text-ink-500 hover:text-ink-300 text-xs"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {polishLog.length === 0 ? (
                <div className="text-center py-8 text-sm text-ink-500">
                  暂无打磨记录。在打磨台完成一些操作后离开，会自动生成摘要。
                </div>
              ) : (
                polishLog.map(entry => (
                  <div key={entry.id} className="p-3 rounded-lg bg-ink-800/40 border border-ink-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-ink-300 font-medium">
                        {new Date(entry.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] text-ink-500">{entry.durationMinutes} 分钟</span>
                    </div>
                    <div className="text-xs text-ink-400 leading-relaxed">{entry.summary}</div>
                    {(entry.foreshadowsResolved + entry.pacingAdjusted + entry.arcFixed + entry.newInspirations + entry.snapshotsCreated) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.foreshadowsResolved > 0 && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded">伏笔 ×{entry.foreshadowsResolved}</span>}
                        {entry.pacingAdjusted > 0 && <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded">节奏 ×{entry.pacingAdjusted}</span>}
                        {entry.arcFixed > 0 && <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">弧光 ×{entry.arcFixed}</span>}
                        {entry.newInspirations > 0 && <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded">灵感 ×{entry.newInspirations}</span>}
                        {entry.snapshotsCreated > 0 && <span className="text-[9px] px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded">快照 ×{entry.snapshotsCreated}</span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 项目健康度总览（可折叠） ===== */}
      {mode !== 'walk' && (
        <div className="relative z-10 border-b border-ink-800/50 bg-ink-900/30 shrink-0">
          {/* 折叠头 */}
          <button
            onClick={() => setHealthCollapsed(c => !c)}
            aria-expanded={!healthCollapsed}
            aria-controls="polish-health-region"
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-ink-800/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              {healthCollapsed ? <ChevronRight className="w-4 h-4 text-ink-500" /> : <ChevronDown className="w-4 h-4 text-ink-500" />}
              <span className="text-sm font-medium text-ink-200">项目健康度</span>
              {healthReport && (
                <div className="flex items-center gap-1.5 ml-1">
                  {highIssues.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded-full flex items-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" />
                      {highIssues.length} 高危
                    </span>
                  )}
                  {mediumIssues.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {mediumIssues.length} 中危
                    </span>
                  )}
                  {highIssues.length === 0 && mediumIssues.length === 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      健康
                    </span>
                  )}
                </div>
              )}
              {healthLoading && (
                <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
              )}
            </div>

            {/* 迷你统计条 */}
            <div className="flex items-center gap-3 text-[11px] text-ink-500">
              <StatChip icon={FileText} label="章节" value={`${stats.mainChapters.length}`} />
              <StatChip icon={BookOpen} label="字数" value={stats.totalWords > 9999 ? `${(stats.totalWords / 10000).toFixed(1)}万` : `${stats.totalWords}`} />
              <StatChip icon={Users} label="角色" value={`${characters.length}`} />
              <StatChip icon={Flag} label="伏笔" value={`${foreshadows.length}`} sub={`回收${stats.foreshadowRecovery}%`} />
              <StatChip icon={Globe} label="设定" value={`${settingItems.length}`} />
              <StatChip icon={Lightbulb} label="灵感" value={`${stats.inspirationActive}`} />
              <StatChip
                icon={Lock}
                label="驱动"
                value={coreDriver ? (DRIVER_TYPE_LABELS[coreDriver.type] ?? coreDriver.type) : '未锁'}
                color={coreDriver ? 'green' : 'red'}
              />
              <StatChip
                icon={Map}
                label="蓝图"
                value={blueprint ? (blueprint.lockedAt ? '已锁' : '已生成') : '未生成'}
                color={blueprint?.lockedAt ? 'green' : blueprint ? 'amber' : 'gray'}
              />
              <StatChip icon={Layers} label="快照" value={`${outlineSnapshots.length}`} />
            </div>
          </button>

          {/* 展开内容：问题列表 + 智能引导 */}
          {!healthCollapsed && (
            <div id="polish-health-region" role="region" aria-label="项目健康度详情" className="px-4 pb-3 space-y-2">
              {/* 智能引导 */}
              {guide && guide.steps.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-400/5 border border-amber-400/20 rounded-lg">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-amber-300/90 mb-1">{guide.summary}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {guide.steps.map((step, idx) => {
                        // 序列模式下高亮当前步骤，已处理的步骤标灰
                        const isCurrent = currentGuideStep === idx;
                        const isDone = currentGuideStep !== null && idx < currentGuideStep;
                        return (
                          <span
                            key={step.order}
                            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                              isCurrent
                                ? 'bg-amber-400/30 text-amber-200 ring-1 ring-amber-400/50 font-medium'
                                : isDone
                                ? 'bg-emerald-500/10 text-emerald-400/70 line-through'
                                : 'text-ink-400 bg-ink-800/50'
                            }`}
                          >
                            {isDone && '✓ '}{step.order}. {step.title}
                          </span>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex items-center gap-1 text-[10px] text-ink-500">
                        <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                        预计 {guide.totalEstimatedMinutes} 分钟
                      </div>
                      {/* 按顺序处理：未启动时显示「开始」按钮；进行中显示「处理完成，下一个」+「退出」 */}
                      {currentGuideStep === null ? (
                        <button
                          onClick={handleStartGuideSequence}
                          className="text-[10px] px-2 py-0.5 bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 rounded transition-colors flex items-center gap-1"
                        >
                          <Play className="w-2.5 h-2.5" aria-hidden="true" />
                          按顺序处理
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={handleAdvanceGuideStep}
                            className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded transition-colors"
                          >
                            {currentGuideStep + 1 >= guide.steps.length ? '完成本序列' : '处理完成，下一个 →'}
                          </button>
                          <button
                            onClick={handleExitGuideSequence}
                            className="text-[10px] px-1.5 py-0.5 text-ink-500 hover:text-ink-300 rounded transition-colors"
                            aria-label="退出按顺序处理"
                          >
                            退出
                          </button>
                        </div>
                      )}
                    </div>
                    {/* 序列模式进度提示 */}
                    {currentGuideStep !== null && (
                      <div className="text-[10px] text-amber-400/80 mt-1" role="status" aria-live="polite">
                        正在处理第 {currentGuideStep + 1} / {guide.steps.length} 项，完成后点击「下一个」继续
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 轻量模式只显示高危和中危 */}
              <ul role="list" className="space-y-2">
                {(mode === 'light' ? [...highIssues, ...mediumIssues] : healthReport?.issues ?? []).map(issue => (
                  <li key={issue.id} className="list-none">
                    <HealthIssueRow
                      issue={issue}
                      onAction={() => handleIssueAction(issue)}
                      onOpenInEditor={issue.actionChapterId ? () => handleOpenIssueInEditor(issue) : undefined}
                    />
                  </li>
                ))}
              </ul>

              {/* 无问题时 */}
              {healthReport && healthReport.issues.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  项目健康状况良好，无紧急问题。可以从灵感打磨或骨架打磨开始主动优化。
                </div>
              )}

              {/* 未跑过健康检查 */}
              {!healthReport && !healthLoading && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-ink-500">
                  <Stethoscope className="w-4 h-4" aria-hidden="true" />
                  点击「一键体检」开始诊断项目健康状况。
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== 快照 toast ===== */}
      {snapshotToast && (
        <div role="status" aria-live="polite" className="fixed top-16 right-4 z-50 px-4 py-2 bg-emerald-500/20 text-emerald-300 rounded-lg text-sm border border-emerald-500/30 backdrop-blur-sm">
          {snapshotToast}
        </div>
      )}

      {/* ===== 大改前提醒弹层 ===== */}
      {bigChangeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="大改前快照提醒"
        >
          <div className="card p-5 w-full max-w-md mx-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1">
                <div className="text-sm font-medium text-ink-100 mb-1">
                  「{bigChangeModal.label}」前建议先存快照
                </div>
                <p className="text-xs text-ink-500 leading-relaxed">
                  {outlineSnapshots.length === 0
                    ? '当前项目还没有任何快照，大改后无法回退。建议先生成一份快照再继续。'
                    : `距上次快照已 ${minutesSinceLastSnapshot} 分钟，期间的大纲改动不会被快照覆盖。建议先存一份再继续。`}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setBigChangeModal(null)}
                className="px-3 py-1.5 text-xs text-ink-400 hover:text-ink-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleBigChangeProceed}
                className="px-3 py-1.5 text-xs text-ink-300 hover:text-ink-100 border border-ink-700 hover:border-ink-600 rounded transition-colors"
              >
                直接继续
              </button>
              <button
                onClick={handleBigChangeSnapshotFirst}
                className="px-3 py-1.5 text-xs bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 rounded transition-colors flex items-center gap-1.5"
              >
                <Camera className="w-3 h-3" aria-hidden="true" />
                先存快照再继续
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 全屏工作区 ===== */}
      <main className="relative z-10 flex-1 overflow-hidden">
        {mode === 'walk' ? (
          <WalkModePanel
            inspirationCards={inspirationCards}
            characters={characters}
            foreshadows={foreshadows}
            onEngageInspiration={() => recordPolishAction('inspiration')}
          />
        ) : (
          <Suspense fallback={<PolishFallback />}>
            <OutlinePolishPanel fullScreen />
          </Suspense>
        )}
      </main>
    </div>
  );
}

// ===== 散步模式面板 =====
// 没有写作动力时打开，随机推送灵感卡/角色档案/已回收伏笔回顾，
// 低压力地保持与作品的连接。AI 负责挑拣，人类负责看与感受。
type WalkItem =
  | { kind: 'inspiration'; card: InspirationCard }
  | { kind: 'character'; character: Character }
  | { kind: 'foreshadow'; foreshadow: Foreshadow };

const INSPIRATION_TYPE_LABEL: Record<InspirationCard['type'], string> = {
  character: '人物种子',
  concept: '高概念',
  scene: '场景片段',
  dialogue: '对话金句',
  setting: '设定疑问',
  plot: '情节脑洞',
};

const CHARACTER_ROLE_LABEL: Record<Character['role'], string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  minor: '次要',
  narrator: '叙述者',
};

const FORESHADOW_PRIORITY_LABEL: Record<Foreshadow['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

function WalkModePanel({
  inspirationCards,
  characters,
  foreshadows,
  onEngageInspiration,
}: {
  inspirationCards: InspirationCard[];
  characters: Character[];
  foreshadows: Foreshadow[];
  onEngageInspiration: () => void;
}) {
  // 仅取顶层灵感卡（排除子卡与已归档），已回收伏笔，全部角色
  const pool = useMemo<WalkItem[]>(() => {
    const items: WalkItem[] = [];
    for (const c of inspirationCards) {
      if (c.parentId) continue;
      if (c.status === 'archived') continue;
      items.push({ kind: 'inspiration', card: c });
    }
    for (const ch of characters) {
      items.push({ kind: 'character', character: ch });
    }
    for (const f of foreshadows) {
      if (f.status === 'paid-off') items.push({ kind: 'foreshadow', foreshadow: f });
    }
    return items;
  }, [inspirationCards, characters, foreshadows]);

  const [current, setCurrent] = useState<WalkItem | null>(null);

  // 从池中随机取一项，avoidId 用于避免连续重复同一项
  const draw = useCallback((avoidId?: string) => {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    let next: WalkItem;
    let guard = 0;
    do {
      next = pool[Math.floor(Math.random() * pool.length)];
      guard++;
    } while (
      guard < 10 &&
      avoidId &&
      (next.kind === 'inspiration' && next.card.id === avoidId ||
        next.kind === 'character' && next.character.id === avoidId ||
        next.kind === 'foreshadow' && next.foreshadow.id === avoidId)
    );
    return next;
  }, [pool]);

  // 池变化时（首次进入或数据更新）抽一张
  useEffect(() => {
    setCurrent(draw());
  }, [draw]);

  const handleNext = useCallback(() => {
    const avoidId = current
      ? current.kind === 'inspiration'
        ? current.card.id
        : current.kind === 'character'
        ? current.character.id
        : current.foreshadow.id
      : undefined;
    setCurrent(draw(avoidId));
  }, [current, draw]);

  if (pool.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <Coffee className="w-10 h-10 text-amber-400/50 mb-4" aria-hidden="true" />
        <div className="text-base text-ink-200 mb-2">散步需要素材</div>
        <p className="text-sm text-ink-500 max-w-md leading-relaxed">
          当前项目还没有灵感卡、角色或已回收伏笔。先去灵感面板随手记几句，
          或在角色卡里建几个核心人物，散步模式就有东西可以推给你了。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
      <div className="w-full max-w-2xl">
        {/* 散步引导语 */}
        <div className="flex items-center justify-center gap-2 mb-6 text-ink-500 text-xs">
          <Coffee className="w-3.5 h-3.5 text-amber-400/70" aria-hidden="true" />
          <span>随便看看就好，不用想怎么改</span>
        </div>

        {/* 当前推送卡片 */}
        {current && <WalkCard item={current} />}

        {/* 操作栏 */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={handleNext}
            className="px-5 py-2 text-sm rounded-md bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            换一张
          </button>
          {current?.kind === 'inspiration' && (
            <button
              onClick={() => {
                onEngageInspiration();
                handleNext();
              }}
              className="px-4 py-2 text-sm rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
            >
              <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
              记下这次触动
            </button>
          )}
        </div>

        {/* 池容量提示 */}
        <div className="text-center text-[11px] text-ink-600 mt-4">
          漫步素材池：{pool.length} 项（灵感 {inspirationCards.filter(c => !c.parentId && c.status !== 'archived').length} · 角色 {characters.length} · 已回收伏笔 {foreshadows.filter(f => f.status === 'paid-off').length}）
        </div>
      </div>
    </div>
  );
}

// ===== 散步模式单卡渲染 =====
function WalkCard({ item }: { item: WalkItem }) {
  if (item.kind === 'inspiration') {
    const { card } = item;
    return (
      <div className="card p-6 min-h-[200px] flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2 py-0.5 text-[10px] bg-purple-500/15 text-purple-300 rounded-full">
            灵感 · {INSPIRATION_TYPE_LABEL[card.type]}
          </span>
          <span className="text-[10px] text-ink-600">
            {new Date(card.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
          </span>
        </div>
        <div className="text-lg font-medium text-ink-100 mb-2 leading-snug">{card.title}</div>
        {card.content && (
          <div className="text-sm text-ink-400 leading-relaxed whitespace-pre-wrap flex-1">
            {card.content}
          </div>
        )}
      </div>
    );
  }

  if (item.kind === 'character') {
    const { character } = item;
    const p = character.profile;
    return (
      <div className="card p-6 min-h-[200px] flex flex-col">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0"
            style={{ backgroundColor: character.color + '30', color: character.color }}
            aria-hidden="true"
          >
            {character.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-medium text-ink-100 truncate">{character.name}</div>
            <div className="text-[11px] text-ink-500">
              {CHARACTER_ROLE_LABEL[character.role]}
              {p.occupation && ` · ${p.occupation}`}
            </div>
          </div>
        </div>
        <div className="space-y-1.5 text-sm text-ink-400 leading-relaxed flex-1">
          {p.personality && <div><span className="text-ink-600">性格：</span>{p.personality}</div>}
          {p.motivation && <div><span className="text-ink-600">动机：</span>{p.motivation}</div>}
          {p.goal && <div><span className="text-ink-600">目标：</span>{p.goal}</div>}
          {p.weakness && <div><span className="text-ink-600">弱点：</span>{p.weakness}</div>}
          {p.arc && <div><span className="text-ink-600">弧光：</span>{p.arc}</div>}
          {!p.personality && !p.motivation && !p.goal && !p.weakness && !p.arc && (
            <div className="text-ink-600 italic">这个角色还没有详细档案，去角色面板补全看看？</div>
          )}
        </div>
      </div>
    );
  }

  // foreshadow 回顾
  const { foreshadow } = item;
  return (
    <div className="card p-6 min-h-[200px] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <span className="px-2 py-0.5 text-[10px] bg-emerald-500/15 text-emerald-300 rounded-full">
          伏笔回顾 · 已回收
        </span>
        <span className="text-[10px] text-ink-600">
          优先级 {FORESHADOW_PRIORITY_LABEL[foreshadow.priority]}
        </span>
      </div>
      <div className="text-lg font-medium text-ink-100 mb-2 leading-snug">{foreshadow.title}</div>
      {foreshadow.description && (
        <div className="text-sm text-ink-400 leading-relaxed mb-2">{foreshadow.description}</div>
      )}
      {foreshadow.notes && (
        <div className="text-xs text-ink-500 leading-relaxed border-l-2 border-emerald-500/30 pl-3 mt-2">
          <span className="text-ink-600">笔记：</span>{foreshadow.notes}
        </div>
      )}
      <div className="text-[11px] text-ink-600 mt-auto pt-2">
        这条伏笔已成功回收——回头看，埋得多深、收得多巧？
      </div>
    </div>
  );
}

// ===== 健康问题行组件 =====
function HealthIssueRow({
  issue,
  onAction,
  onOpenInEditor,
}: {
  issue: HealthIssue;
  onAction: () => void;
  onOpenInEditor?: () => void;
}) {
  const config = {
    high: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/5', border: 'border-red-500/20' },
    medium: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/20' },
    low: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20' },
  };
  const c = config[issue.severity];
  const Icon = c.icon;

  return (
    <div className={`flex items-start gap-2 px-3 py-2 ${c.bg} border ${c.border} rounded-lg`}>
      <Icon className={`w-4 h-4 ${c.color} shrink-0 mt-0.5`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium ${c.color}`}>{issue.title}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">{issue.description}</div>
        <div className="text-[11px] text-ink-400 mt-0.5">{issue.suggestion}</div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <button
          onClick={onAction}
          className={`px-2 py-1 text-[11px] ${c.color} hover:bg-ink-800/50 rounded transition-colors whitespace-nowrap`}
        >
          {issue.actionLabel}
        </button>
        {onOpenInEditor && (
          <button
            onClick={onOpenInEditor}
            className="px-2 py-1 text-[10px] text-ink-400 hover:text-ink-200 hover:bg-ink-800/50 rounded transition-colors whitespace-nowrap flex items-center gap-1"
            title="跳转到该章节正文直接修改"
          >
            <FileText className="w-2.5 h-2.5" aria-hidden="true" />
            在编辑器中打开
          </button>
        )}
      </div>
    </div>
  );
}

// ===== 迷你统计芯片 =====
function StatChip({
  icon: Icon,
  label,
  value,
  sub,
  color = 'default',
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  sub?: string;
  color?: 'default' | 'green' | 'red' | 'amber' | 'gray';
}) {
  const colorMap = {
    default: 'text-ink-300',
    green: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    gray: 'text-ink-600',
  };
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Icon className={`w-3 h-3 ${colorMap[color]}`} />
      <span className="text-ink-600">{label}</span>
      <span className={colorMap[color]}>{value}</span>
      {sub && <span className="text-ink-700 text-[9px]">({sub})</span>}
    </div>
  );
}
