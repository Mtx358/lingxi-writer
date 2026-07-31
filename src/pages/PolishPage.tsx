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
  Map as MapIcon,
  Layers,
  Undo2,
  Search,
  LayoutGrid,
  ListTree,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { READING_SPEED_WPM } from '@/constants/config';
import { toast } from '@/hooks/useToast';
import ProjectNotFound from '@/components/ProjectNotFound';
import { lazy, Suspense } from 'react';
import type { InspirationCard, Character, Foreshadow, Chapter } from '@/types';
import { isPolishableChapter } from '@/utils/chapterUtils';
import {
  analyzeProjectHealth,
  recommendPolishGuide,
  type ProjectHealthReport,
  type PolishGuide,
  type HealthIssue,
} from '@/utils/aiService/health';
import { STAGES, type StageId } from '@/components/editor/outlinePolish/types';
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

// 五阶段图标（左栏阶段切换用，与 OutlinePolishPanel 内部 STAGE_ICON 同步）
const STAGE_ICON_MAP: Record<StageId, typeof Zap> = {
  inspiration: Lightbulb,
  skeleton: Layers,
  chapter: BookOpen,
  verify: CheckCircle2,
  modify: Wand2,
};

// 章节问题分类 → 图标/标签（中栏章节行问题标记用）
const ISSUE_CATEGORY_MARK: Record<string, { icon: string; label: string }> = {
  pacing: { icon: '⚠️', label: '节奏' },
  character: { icon: '👤', label: '人设' },
  foreshadow: { icon: '🔗', label: '伏笔' },
  structure: { icon: '🧩', label: '逻辑' },
  subplot: { icon: '🔗', label: '支线' },
  stockpile: { icon: '⚠️', label: '存稿' },
  emotion: { icon: '👤', label: '情感' },
};

// 大纲节点层级 → 中文标签（中栏展示卷/部/章/节用）
// 导入大纲通常是「卷→部」结构，编辑器手建多为「章」，三幕模板为「幕」。
// 打磨台中栏需展示所有层级，避免 levelType!=='chapter' 的节点被过滤后「提取不到内容」。
const LEVEL_TYPE_LABELS: Record<Chapter['levelType'], string> = {
  book: '幕',
  volume: '卷',
  part: '部',
  section: '节',
  chapter: '章',
};

// 章节节拍总数（节拍编辑器 5 大固定槽位）
const BEAT_TOTAL_SLOTS = 5;

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

  // ===== 三栏布局状态 =====
  // 中栏选中的章节（驱动右栏联动）
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  // 左栏→右栏阶段联动（受控 OutlinePolishPanel 的 activeStage）
  const [polishStage, setPolishStage] = useState<StageId>('inspiration');
  // 中栏视图：卡片视图 / 大纲树视图
  const [viewMode, setViewMode] = useState<'card' | 'tree'>('card');
  // 中栏搜索：按章节标题模糊匹配
  const [searchQuery, setSearchQuery] = useState('');
  // 中栏风险筛选：点击左栏健康度摘要行后筛选对应风险等级的章节（null=不筛选）
  const [riskFilter, setRiskFilter] = useState<'high' | 'medium' | null>(null);
  // 左栏「详细统计」可折叠
  const [statsExpanded, setStatsExpanded] = useState(false);
  // 大纲树视图展开的卷集合（id → bool）
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});

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
    const mainChapters = chapters.filter(c => isPolishableChapter(c));
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

  // ===== 三栏布局派生数据 =====
  // 中栏展示所有层级的大纲节点（卷/部/章/节/幕），不再仅限 levelType==='chapter'。
  // 否则导入大纲（卷→部结构，无 chapter 层）会全部被过滤，打磨台「提取不到编辑器已有内容」。
  // stats 中的正文章节统计仍单独按 levelType==='chapter' 计算，与此处展示列表解耦。
  const mainChapters = useMemo(() => chapters, [chapters]);

  // 卷/部列表（用于大纲树视图分组）
  const volumes = useMemo(
    () => chapters.filter(c => c.levelType === 'volume' || c.levelType === 'part'),
    [chapters],
  );

  // 章节问题映射：chapterId → 该章命中的 issues（按 actionChapterId 匹配）
  const issuesByChapter = useMemo(() => {
    const map = new Map<string, HealthIssue[]>();
    if (!healthReport) return map;
    for (const issue of healthReport.issues) {
      if (!issue.actionChapterId) continue;
      const list = map.get(issue.actionChapterId);
      if (list) list.push(issue);
      else map.set(issue.actionChapterId, [issue]);
    }
    return map;
  }, [healthReport]);

  // 每个阶段的问题状态点：'high'(红) | 'medium'(黄) | 'none'(灰)
  const stageIssueStatus = useMemo(() => {
    const result: Record<StageId, 'high' | 'medium' | 'none'> = {
      inspiration: 'none',
      skeleton: 'none',
      chapter: 'none',
      verify: 'none',
      modify: 'none',
    };
    if (!healthReport) return result;
    for (const stage of STAGES) {
      const stageTabs = new Set(stage.tabs);
      let hasHigh = false;
      let hasMedium = false;
      for (const issue of healthReport.issues) {
        if (!stageTabs.has(issue.actionTab)) continue;
        if (issue.severity === 'high') hasHigh = true;
        else if (issue.severity === 'medium') hasMedium = true;
      }
      result[stage.id] = hasHigh ? 'high' : hasMedium ? 'medium' : 'none';
    }
    return result;
  }, [healthReport]);

  // 中栏经过滤后的章节列表（搜索 + 风险筛选）
  const filteredChapters = useMemo(() => {
    let list = mainChapters;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(c => c.title.toLowerCase().includes(q));
    }
    if (riskFilter) {
      list = list.filter(c => {
        const issues = issuesByChapter.get(c.id);
        if (!issues) return false;
        return issues.some(i => i.severity === riskFilter);
      });
    }
    return list;
  }, [mainChapters, searchQuery, riskFilter, issuesByChapter]);

  // 当前选中章节对象
  const selectedChapter = useMemo(
    () => mainChapters.find(c => c.id === selectedChapterId) ?? null,
    [mainChapters, selectedChapterId],
  );

  // 选中章节的序号（1-based）
  const selectedChapterIndex = useMemo(() => {
    if (!selectedChapter) return 0;
    return mainChapters.findIndex(c => c.id === selectedChapter.id) + 1;
  }, [mainChapters, selectedChapter]);

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

  // ===== 三栏布局：章节选中 / 双击跳编辑器 / 阶段切换 / 风险筛选 =====
  // 单击章节行：本地 selectedChapterId + 同步 store.currentChapterId，让右栏 OutlinePolishPanel
  // 内部依赖 currentChapterId 的子面板（章节网格/节拍/扩展等）一并联动
  const handleSelectChapter = useCallback((chapterId: string) => {
    setSelectedChapterId(chapterId);
    setCurrentChapter(chapterId);
  }, [setCurrentChapter]);

  // 双击章节行：跳转编辑器该章正文（与 handleOpenIssueInEditor 闭环一致）
  const handleOpenChapterInEditor = useCallback((chapterId: string) => {
    setCurrentChapter(chapterId);
    navigate(`/project/${projectId}/editor`);
  }, [navigate, projectId, setCurrentChapter]);

  // 左栏点击阶段：受控切换 OutlinePolishPanel 的 activeStage
  const handleStageSwitch = useCallback((s: StageId) => {
    setPolishStage(s);
  }, []);

  // 左栏点击健康度摘要行：切换风险筛选（再次点击同一等级则取消）
  const handleRiskFilterToggle = useCallback((level: 'high' | 'medium') => {
    setRiskFilter(prev => (prev === level ? null : level));
  }, []);

  if (!project) {
    return <ProjectNotFound loading={projectLoading} onBackHome={() => navigate('/')} />;
  }

  const highIssues = healthReport?.issues.filter(i => i.severity === 'high') ?? [];
  const mediumIssues = healthReport?.issues.filter(i => i.severity === 'medium') ?? [];

  // 今日打磨记录数（底部状态栏用，plain 计算避免在 early return 后调用 hook）
  const today = new Date().toDateString();
  const todayPolishCount = polishLog.filter(e => new Date(e.startedAt).toDateString() === today).length;

  // 上次保存时间文案（底部状态栏用，简单显示）
  let lastSavedText = '无快照';
  if (outlineSnapshots.length > 0) {
    const last = outlineSnapshots[0];
    if (last?.createdAt) {
      const diffMs = Date.now() - new Date(last.createdAt).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) lastSavedText = '刚刚';
      else if (mins < 60) lastSavedText = `${mins} 分钟前`;
      else if (mins < 1440) lastSavedText = `${Math.floor(mins / 60)} 小时前`;
      else lastSavedText = new Date(last.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay pointer-events-none" aria-hidden="true" />

      {/* ===== 顶部工具栏 h-12 ===== */}
      <header className="relative z-20 h-12 border-b border-ink-800/50 flex items-center justify-between px-3 bg-ink-900/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Wand2 className="w-4 h-4 text-amber-400 shrink-0" />
          <h1 className="text-sm font-semibold text-ink-100">灵犀打磨台</h1>
          <span className="text-xs text-ink-500 truncate">— {project.title}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 打磨强度切换 */}
          <div className="flex items-center gap-0.5 bg-ink-800/50 rounded-md p-0.5 mr-1">
            {(Object.keys(MODE_META) as PolishMode[]).map(m => {
              const M = MODE_META[m];
              const Icon = M.icon;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  title={M.desc}
                  className={`px-1.5 py-0.5 text-[10px] rounded flex items-center gap-1 transition-colors ${
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
            className="px-2.5 py-1 text-xs rounded-md bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
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
            className="px-2.5 py-1 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5"
          >
            <Camera className="w-3.5 h-3.5" />
            快照
          </button>

          {/* 同步大纲 */}
          <button
            onClick={handleSyncToEditor}
            title="返回编辑器查看大纲同步效果"
            className="px-2.5 py-1 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            同步
          </button>

          {/* 锁定蓝图 */}
          {blueprint && !blueprint.lockedAt && (
            <button
              onClick={handleLockBlueprint}
              title="锁定全局蓝图，后续修改自动生成影响报告"
              className="px-2.5 py-1 text-xs rounded-md bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              锁定蓝图
            </button>
          )}
          {blueprint?.lockedAt && (
            <span className="px-2 py-1 text-[11px] text-emerald-400 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              蓝图已锁定
            </span>
          )}

          {/* 打磨日志 */}
          <button
            onClick={() => setShowPolishLog(true)}
            title="查看打磨成果摘要与成长轨迹"
            className="px-2.5 py-1 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5" />
            日志{polishLog.length > 0 && `(${polishLog.length})`}
          </button>

          {/* 全局撤销（Ctrl+Z）：回退结构性改动 */}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title={undoStack.length > 0 ? `撤销：${undoStack[0].description}（Ctrl+Z）` : '撤销栈为空'}
            className="px-2.5 py-1 text-xs rounded-md bg-ink-700/50 text-ink-200 hover:bg-ink-700 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
            撤销{undoStack.length > 0 && `(${undoStack.length})`}
          </button>

          {/* 返回编辑器（右侧主按钮 amber） */}
          <button
            onClick={() => navigate(`/project/${projectId}/editor`)}
            title="返回编辑器"
            className="ml-1 px-2.5 py-1 text-xs rounded-md bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回编辑器
          </button>
        </div>
      </header>

      {/* ===== 主体三栏 ===== */}
      <main className="relative z-10 flex-1 flex overflow-hidden">
        {mode === 'walk' ? (
          <WalkModePanel
            inspirationCards={inspirationCards}
            characters={characters}
            foreshadows={foreshadows}
            onEngageInspiration={() => recordPolishAction('inspiration')}
          />
        ) : (
          <>
            {/* ===== 左栏 w-60：健康度摘要 + 详细统计 + 问题清单 + 五阶段切换 ===== */}
            <aside className="w-60 border-r border-ink-800/50 bg-ink-900/30 flex flex-col overflow-y-auto shrink-0">
              {/* 上半区：健康度摘要 */}
              <section className="p-3 space-y-0.5">
                <div className="text-[11px] text-ink-500 mb-1.5 flex items-center justify-between">
                  <span>待处理问题</span>
                  {healthLoading && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />}
                </div>
                {healthReport ? (
                  <>
                    <button
                      onClick={() => handleRiskFilterToggle('high')}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        riskFilter === 'high'
                          ? 'bg-red-500/15 text-red-300'
                          : 'text-ink-300 hover:bg-ink-800/40'
                      }`}
                    >
                      <span aria-hidden="true">🔴</span>
                      <span className="flex-1 text-left">高危</span>
                      <span className="text-red-400 font-medium">{highIssues.length} 个</span>
                    </button>
                    <button
                      onClick={() => handleRiskFilterToggle('medium')}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        riskFilter === 'medium'
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'text-ink-300 hover:bg-ink-800/40'
                      }`}
                    >
                      <span aria-hidden="true">🟡</span>
                      <span className="flex-1 text-left">中危</span>
                      <span className="text-amber-400 font-medium">{mediumIssues.length} 个</span>
                    </button>
                    <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-ink-400">
                      <span aria-hidden="true">🟢</span>
                      <span className="flex-1 text-left">正常</span>
                      <span className="text-emerald-400">
                        {highIssues.length === 0 && mediumIssues.length === 0 ? '健康' : '—'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-ink-600 px-2 py-2">未体检，点击顶部「一键体检」</div>
                )}
              </section>

              {/* 详细统计（可折叠，保留原 StatChip 一大排） */}
              <section className="border-t border-ink-800/40">
                <button
                  onClick={() => setStatsExpanded(s => !s)}
                  aria-expanded={statsExpanded}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink-400 hover:text-ink-200 hover:bg-ink-800/30 transition-colors"
                >
                  {statsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <span>详细统计</span>
                </button>
                {statsExpanded && (
                  <div className="px-3 pb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
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
                      icon={MapIcon}
                      label="蓝图"
                      value={blueprint ? (blueprint.lockedAt ? '已锁' : '已生成') : '未生成'}
                      color={blueprint?.lockedAt ? 'green' : blueprint ? 'amber' : 'gray'}
                    />
                    <StatChip icon={Layers} label="快照" value={`${outlineSnapshots.length}`} />
                  </div>
                )}
              </section>

              {/* 问题清单 & 智能引导（可折叠，复用 healthCollapsed 状态） */}
              <section className="border-t border-ink-800/40">
                <button
                  onClick={() => setHealthCollapsed(c => !c)}
                  aria-expanded={!healthCollapsed}
                  aria-controls="polish-issues-region"
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink-400 hover:text-ink-200 hover:bg-ink-800/30 transition-colors"
                >
                  {healthCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <span>问题清单 & 智能引导</span>
                  {healthReport && healthReport.issues.length > 0 && (
                    <span className="text-ink-600">({healthReport.issues.length})</span>
                  )}
                </button>
                {!healthCollapsed && (
                  <div id="polish-issues-region" role="region" aria-label="问题清单与智能引导" className="px-2 pb-2 space-y-2">
                    {/* 智能引导 */}
                    {guide && guide.steps.length > 0 && (
                      <div className="flex items-start gap-2 px-2 py-2 bg-amber-400/5 border border-amber-400/20 rounded-lg">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-amber-300/90 mb-1 leading-relaxed">{guide.summary}</div>
                          <div className="flex flex-wrap gap-1">
                            {guide.steps.map((step, idx) => {
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
                              {guide.totalEstimatedMinutes} 分钟
                            </div>
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
                                  {currentGuideStep + 1 >= guide.steps.length ? '完成本序列' : '下一个 →'}
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
                          {currentGuideStep !== null && (
                            <div className="text-[10px] text-amber-400/80 mt-1" role="status" aria-live="polite">
                              第 {currentGuideStep + 1} / {guide.steps.length} 项
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 问题列表（轻量模式只显示高危和中危） */}
                    <ul role="list" className="space-y-1.5">
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

                    {healthReport && healthReport.issues.length === 0 && (
                      <div className="flex items-center gap-2 px-2 py-2 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        项目健康状况良好，无紧急问题。
                      </div>
                    )}
                    {!healthReport && !healthLoading && (
                      <div className="flex items-center gap-2 px-2 py-2 text-xs text-ink-500">
                        <Stethoscope className="w-3.5 h-3.5" aria-hidden="true" />
                        点击「一键体检」开始诊断。
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 分割线 */}
              <div className="h-px bg-ink-800/50 shrink-0" />

              {/* 下半区：五阶段切换 */}
              <section className="p-3 flex-1">
                <div className="text-[11px] text-ink-500 mb-2">打磨阶段</div>
                <ul role="list" className="space-y-1">
                  {STAGES.map(stage => {
                    const Icon = STAGE_ICON_MAP[stage.id];
                    const isActive = polishStage === stage.id;
                    const status = stageIssueStatus[stage.id];
                    return (
                      <li key={stage.id}>
                        <button
                          onClick={() => handleStageSwitch(stage.id)}
                          aria-current={isActive ? 'step' : undefined}
                          title={`${stage.label}：${stage.description}`}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors relative ${
                            isActive
                              ? 'bg-amber-400/10 text-amber-300 font-medium'
                              : 'text-ink-300 hover:bg-ink-800/40 hover:text-ink-100'
                          }`}
                        >
                          {isActive && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400" aria-hidden="true" />}
                          <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span className="flex-1 text-left truncate">{stage.label}</span>
                          {/* 问题状态点：空心灰 / 实心黄 / 实心红 */}
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              status === 'high'
                                ? 'bg-red-500'
                                : status === 'medium'
                                ? 'bg-amber-400'
                                : 'border border-ink-600'
                            }`}
                            aria-label={
                              status === 'high' ? '有高危问题' : status === 'medium' ? '有中危问题' : '无问题'
                            }
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </aside>

            {/* ===== 中栏 flex-1：视图切换 + 章节列表 ===== */}
            <section className="flex-1 flex flex-col min-w-0">
              {/* 视图切换栏 h-10 */}
              <div className="h-10 border-b border-ink-800/50 flex items-center px-3 gap-2 shrink-0 bg-ink-900/20">
                <div className="flex items-center gap-0.5 bg-ink-800/50 rounded-md p-0.5">
                  <button
                    onClick={() => setViewMode('card')}
                    aria-pressed={viewMode === 'card'}
                    title="卡片视图"
                    className={`px-2 py-1 text-[11px] rounded flex items-center gap-1 transition-colors ${
                      viewMode === 'card'
                        ? 'bg-amber-400/15 text-amber-300'
                        : 'text-ink-500 hover:text-ink-300'
                    }`}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    卡片
                  </button>
                  <button
                    onClick={() => setViewMode('tree')}
                    aria-pressed={viewMode === 'tree'}
                    title="大纲树视图"
                    className={`px-2 py-1 text-[11px] rounded flex items-center gap-1 transition-colors ${
                      viewMode === 'tree'
                        ? 'bg-amber-400/15 text-amber-300'
                        : 'text-ink-500 hover:text-ink-300'
                    }`}
                  >
                    <ListTree className="w-3 h-3" />
                    树
                  </button>
                </div>

                {riskFilter && (
                  <button
                    onClick={() => setRiskFilter(null)}
                    className="px-2 py-0.5 text-[11px] rounded-full bg-ink-800/60 text-ink-300 hover:bg-ink-700 transition-colors flex items-center gap-1"
                    title="清除风险筛选"
                  >
                    {riskFilter === 'high' ? '高危筛选' : '中危筛选'}
                    <span aria-hidden="true">✕</span>
                  </button>
                )}

                <div className="flex-1" />

                {/* 搜索框 */}
                <div className="relative w-56">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500" aria-hidden="true" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索章节、角色、标签"
                    className="w-full pl-7 pr-2 py-1 text-xs bg-ink-800/50 text-ink-200 rounded border border-ink-700/40 focus:border-amber-400/40 focus:outline-none placeholder:text-ink-600"
                  />
                </div>
              </div>

              {/* 列表区 */}
              <div className="flex-1 overflow-y-auto">
                {mainChapters.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6">
                    <BookOpen className="w-8 h-8 text-ink-700 mb-3" aria-hidden="true" />
                    <div className="text-sm text-ink-400 mb-1">暂无章节</div>
                    <p className="text-xs text-ink-600">请先在编辑器中创建大纲</p>
                  </div>
                ) : filteredChapters.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-ink-600">
                    无匹配章节
                  </div>
                ) : viewMode === 'card' ? (
                  <ul role="list" className="divide-y divide-ink-800/30">
                    {filteredChapters.map(ch => {
                      const idx = mainChapters.findIndex(c => c.id === ch.id) + 1;
                      return (
                        <ChapterCardRow
                          key={ch.id}
                          chapter={ch}
                          index={idx}
                          issues={issuesByChapter.get(ch.id) ?? []}
                          selected={selectedChapterId === ch.id}
                          onSelect={() => handleSelectChapter(ch.id)}
                          onOpen={() => handleOpenChapterInEditor(ch.id)}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <ChapterTreeView
                    volumes={volumes}
                    chapters={mainChapters}
                    filteredIds={new Set(filteredChapters.map(c => c.id))}
                    issuesByChapter={issuesByChapter}
                    selectedChapterId={selectedChapterId}
                    mainChapters={mainChapters}
                    expandedVolumes={expandedVolumes}
                    onToggleVolume={(vid) => setExpandedVolumes(prev => ({ ...prev, [vid]: !prev[vid] }))}
                    onSelect={handleSelectChapter}
                    onOpen={handleOpenChapterInEditor}
                  />
                )}
              </div>
            </section>

            {/* ===== 右栏 w-90：当前阶段操作面板（嵌入 OutlinePolishPanel） ===== */}
            <aside className="w-[360px] border-l border-ink-800/50 bg-ink-900/30 flex flex-col shrink-0">
              {/* 章节名头部 h-10 */}
              <div className="h-10 border-b border-ink-800/50 px-3 flex items-center shrink-0">
                {selectedChapter ? (
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-xs text-ink-500 shrink-0">第{selectedChapterIndex}章</span>
                    <span className="text-sm text-ink-100 truncate">· {selectedChapter.title}</span>
                  </div>
                ) : (
                  <div className="text-xs text-ink-500">请从中间大纲区选中一个章节开始处理</div>
                )}
              </div>
              {/* 嵌入 OutlinePolishPanel：受控 activeStage + 隐藏阶段步骤条 */}
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<PolishFallback />}>
                  <OutlinePolishPanel
                    embedded
                    activeStage={polishStage}
                    onStageChange={handleStageSwitch}
                  />
                </Suspense>
              </div>
            </aside>
          </>
        )}
      </main>

      {/* ===== 底部状态栏 h-8 ===== */}
      <footer className="relative z-20 h-8 border-t border-ink-800/50 flex items-center justify-between px-3 bg-ink-900/80 backdrop-blur-sm text-[11px] text-ink-500 shrink-0">
        <span>
          今日处理 <span className="text-ink-300">{todayPolishCount}</span> 个问题 · 剩余{' '}
          <span className={highIssues.length > 0 ? 'text-red-400' : 'text-emerald-400'}>{highIssues.length} 个高危</span>
        </span>
        <span>上次保存 <span className="text-ink-400">{lastSavedText}</span></span>
        <button
          onClick={() => setShowPolishLog(true)}
          className="hover:text-ink-300 transition-colors flex items-center gap-1"
          title="查看打磨日志"
        >
          打磨日志 ▸
        </button>
      </footer>

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

      {/* ===== 快照 toast ===== */}
      {snapshotToast && (
        <div role="status" aria-live="polite" className="fixed top-14 right-4 z-50 px-4 py-2 bg-emerald-500/20 text-emerald-300 rounded-lg text-sm border border-emerald-500/30 backdrop-blur-sm">
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

// ===== 章节行问题标记计算（卡片视图 & 树视图共用） =====
// 根据章节命中的 issues 推导：行背景风险等级 + 问题图标列表
function deriveChapterIssueMarks(issues: HealthIssue[]): {
  bgClass: string;
  marks: { icon: string; label: string }[];
} {
  if (issues.length === 0) {
    return { bgClass: '', marks: [] };
  }
  const hasHigh = issues.some(i => i.severity === 'high');
  const hasMedium = issues.some(i => i.severity === 'medium');
  const bgClass = hasHigh
    ? 'bg-red-500/5'
    : hasMedium
    ? 'bg-amber-500/5'
    : '';
  // 按 category 去重，保留首次出现的标记
  const seen = new Set<string>();
  const marks: { icon: string; label: string }[] = [];
  for (const issue of issues) {
    if (seen.has(issue.category)) continue;
    seen.add(issue.category);
    const mark = ISSUE_CATEGORY_MARK[issue.category];
    if (mark) marks.push(mark);
  }
  return { bgClass, marks };
}

// 章节节拍完成度文案："3/5 节拍"，无节拍数据则返回字数
function beatProgressText(ch: Chapter): string {
  const filledBeats = ch.beats?.filter(b => b.content?.trim()).length ?? 0;
  if (filledBeats === 0) {
    return ch.wordCount > 0 ? `${ch.wordCount} 字` : '空';
  }
  return `${filledBeats}/${BEAT_TOTAL_SLOTS} 节拍`;
}

// ===== 中栏卡片视图：单行章节 =====
function ChapterCardRow({
  chapter,
  index,
  issues,
  selected,
  onSelect,
  onOpen,
}: {
  chapter: Chapter;
  index: number;
  issues: HealthIssue[];
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { bgClass, marks } = deriveChapterIssueMarks(issues);
  const levelLabel = LEVEL_TYPE_LABELS[chapter.levelType];
  return (
    <li role="listitem" className="list-none">
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        title={`${levelLabel}${index} · ${chapter.title}（双击在编辑器中打开）`}
        aria-pressed={selected}
        className={`group w-full h-12 flex items-center gap-2 px-3 text-left transition-colors relative ${
          selected
            ? 'bg-amber-400/10'
            : bgClass || 'hover:bg-ink-800/30'
        }`}
      >
        {/* 选中：左侧 2px amber 边框 */}
        {selected && (
          <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400" aria-hidden="true" />
        )}
        {/* 层级标签 + 序号 + 标题 */}
        <span className="text-xs text-ink-500 shrink-0 w-14 truncate">{levelLabel}{index}</span>
        <span className="flex-1 min-w-0 text-sm text-ink-200 truncate group-hover:text-ink-100">
          {chapter.title || '（无标题）'}
        </span>
        {/* 节拍完成度 / 字数 */}
        <span className="text-[11px] text-ink-500 shrink-0 tabular-nums">
          {beatProgressText(chapter)}
        </span>
        {/* 问题标记 */}
        <span className="flex items-center gap-1 shrink-0 w-20 justify-end">
          {marks.length === 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/60" aria-label="无问题" />
          ) : (
            marks.slice(0, 4).map((m, i) => (
              <span key={i} title={m.label} className="text-xs" aria-label={m.label}>
                {m.icon}
              </span>
            ))
          )}
        </span>
      </button>
    </li>
  );
}

// ===== 中栏大纲树视图：任意层级递归（卷→部→章→节…）=====
// 旧版只支持「卷→章」两级，导入大纲的「卷→部」结构会被当成无卷处理而平铺，
// 且 volumes 过滤掉 part 导致层级丢失。改为基于 parentId 递归渲染，支持任意深度。
function ChapterTreeView({
  chapters,
  filteredIds,
  issuesByChapter,
  selectedChapterId,
  mainChapters,
  expandedVolumes,
  onToggleVolume,
  onSelect,
  onOpen,
}: {
  // volumes 保留以兼容调用处签名，内部不再使用（递归改用 parentId 索引）
  volumes: Chapter[];
  chapters: Chapter[];
  filteredIds: Set<string>;
  issuesByChapter: Map<string, HealthIssue[]>;
  selectedChapterId: string | null;
  mainChapters: Chapter[];
  expandedVolumes: Record<string, boolean>;
  onToggleVolume: (volumeId: string) => void;
  onSelect: (chapterId: string) => void;
  onOpen: (chapterId: string) => void;
}) {
  // 构建 parentId → children 索引（按 order 排序），递归渲染的基础
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Chapter[]>();
    for (const c of chapters) {
      const arr = map.get(c.parentId);
      if (arr) arr.push(c);
      else map.set(c.parentId, [c]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
    return map;
  }, [chapters]);

  // 计算可见节点集合：节点自身在 filteredIds，或其任意后代在 filteredIds。
  // 搜索时若只过滤叶子，含匹配章节的卷/部会被丢弃，导致看不到上下文。
  const visibleIds = useMemo(() => {
    const result = new Set<string>();
    const dfs = (node: Chapter): boolean => {
      let childMatched = false;
      const children = childrenByParent.get(node.id) ?? [];
      for (const ch of children) {
        if (dfs(ch)) childMatched = true;
      }
      const selfMatched = filteredIds.has(node.id);
      if (selfMatched || childMatched) {
        result.add(node.id);
        return true;
      }
      return false;
    };
    const roots = childrenByParent.get(null) ?? [];
    for (const r of roots) dfs(r);
    return result;
  }, [childrenByParent, filteredIds]);

  // 节点序号映射：基于 mainChapters 全局顺序，用于显示「卷1/部2/章3」
  const indexMap = useMemo(() => {
    const m = new Map<string, number>();
    mainChapters.forEach((c, i) => m.set(c.id, i + 1));
    return m;
  }, [mainChapters]);

  // 递归渲染单个节点：有子节点则可折叠，叶子节点直接展示
  // 返回类型由 TS 推断（JSX.Element | null），不显式标注以避免依赖 React 命名空间
  const renderNode = (node: Chapter, depth: number) => {
    if (!visibleIds.has(node.id)) return null;
    const children = childrenByParent.get(node.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = expandedVolumes[node.id] ?? true;
    const issues = issuesByChapter.get(node.id) ?? [];
    const { bgClass, marks } = deriveChapterIssueMarks(issues);
    const selected = selectedChapterId === node.id;
    const idx = indexMap.get(node.id) ?? 0;
    const levelLabel = LEVEL_TYPE_LABELS[node.levelType];

    return (
      <li
        key={node.id}
        role="treeitem"
        className="list-none"
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => onOpen(node.id)}
          aria-pressed={selected}
          title={`${levelLabel}${idx} · ${node.title}（双击在编辑器中打开）`}
          className={`group w-full h-12 flex items-center gap-1.5 pl-2 pr-3 text-left transition-colors relative ${
            selected ? 'bg-amber-400/10' : bgClass || 'hover:bg-ink-800/30'
          }`}
          style={{ paddingLeft: depth * 14 + 8 }}
        >
          {selected && (
            <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400" aria-hidden="true" />
          )}
          {/* 折叠/展开图标：用 span 承载点击，避免 button 嵌套 button */}
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onToggleVolume(node.id); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleVolume(node.id);
                }
              }}
              aria-label={expanded ? '折叠' : '展开'}
              className="text-ink-500 hover:text-ink-200 shrink-0 cursor-pointer flex items-center"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          ) : (
            <span className="w-3 shrink-0" aria-hidden="true" />
          )}
          <span className="text-xs text-ink-500 shrink-0 w-12 truncate">{levelLabel}{idx}</span>
          <span className="flex-1 min-w-0 text-sm text-ink-200 truncate group-hover:text-ink-100">
            {node.title || '（无标题）'}
          </span>
          <span className="text-[11px] text-ink-500 shrink-0 tabular-nums">
            {beatProgressText(node)}
          </span>
          <span className="flex items-center gap-1 shrink-0 w-16 justify-end">
            {marks.length === 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/60" aria-label="无问题" />
            ) : (
              marks.slice(0, 4).map((m, i) => (
                <span key={i} title={m.label} className="text-xs" aria-label={m.label}>
                  {m.icon}
                </span>
              ))
            )}
          </span>
        </button>
        {hasChildren && expanded && (
          <ul role="group" className="pb-0.5">
            {children.map(ch => renderNode(ch, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  if (chapters.length === 0) return null;

  const roots = (childrenByParent.get(null) ?? []).filter(r => visibleIds.has(r.id));

  return (
    <ul role="tree" className="py-1">
      {roots.map(r => renderNode(r, 0))}
    </ul>
  );
}
