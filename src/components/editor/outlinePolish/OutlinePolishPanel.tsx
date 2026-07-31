/**
 * 大纲打磨面板：主组件（按规格书 5 阶段重构）
 *
 * 这不是一套冰冷的校验工具，而是陪你从凌晨三点的闪念，到完整可落地的全本大纲的案头搭档。
 * 全程用小说创作者的语言工作，不教你怎么写，只帮你把脑子里的故事磨得更稳、更顺、更经得住推敲。
 *
 * 5 大阶段（对应规格书）：
 *   1. 灵感打磨：碎片捕获 / 卡片促活 / 智能连线
 *   2. 骨架打磨：核心驱动锁定 / 冲突罗盘 / 结构变体
 *   3. 章节打磨：节拍编辑器 / 情节扩展 / 多线作战指挥台
 *   4. 深度校验：智能诊断 / 节奏压力 / 人物弧光 / 草蛇灰线看板
 *   5. 颠覆性修改：因果推演 / 版本对比 / 版本花园
 *
 * 顶层用 StageId 切换阶段（左侧侧边栏），阶段内用 TabId 切换子功能（顶部 Tab 栏）。
 * 所有子功能由同目录各功能域子模块渲染，AI 调用 / 导出逻辑由 useOutlinePolishActions hook 统一封装。
 */
import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import {
  Wand2,
  Target,
  Sparkles,
  RefreshCw,
  Download,
  Camera,
  Users,
  GitBranch,
  Play,
  ShieldAlert,
  Compass,
  Lightbulb,
  Lock,
  Activity,
  Workflow,
  GitCompareArrows,
  LayoutGrid,
  Heart,
  FlaskConical,
  Crosshair,
  MessageSquare,
  MessageCircle,
  Clock,
  Network,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { StageId, TabId } from './types';
import { STAGES } from './types';
import { useOutlinePolishActions } from './useOutlinePolishActions';

/**
 * 子面板懒加载：17 个功能域子组件按需加载，避免单 chunk 过大（402KB → 各 < 80KB）。
 * 用户进入打磨台时只加载当前阶段+Tab 对应的代码，其余 Tab 切换时才拉取。
 * SkeletonTab 已是骨架实现，直接用作 Suspense fallback。
 */
const SkeletonTab = lazy(() => import('./SkeletonTab').then(m => ({ default: m.SkeletonTab })));
const DiagnosticsPanel = lazy(() => import('./DiagnosticsPanel').then(m => ({ default: m.DiagnosticsPanel })));
const RhythmPulsePanel = lazy(() => import('./RhythmPulsePanel').then(m => ({ default: m.RhythmPulsePanel })));
const CharacterArcPanel = lazy(() => import('./CharacterArcPanel').then(m => ({ default: m.CharacterArcPanel })));
const ExpansionPanel = lazy(() => import('./ExpansionPanel').then(m => ({ default: m.ExpansionPanel })));
const BeatsTab = lazy(() => import('./BeatsTab').then(m => ({ default: m.BeatsTab })));
const ChapterGridPanel = lazy(() => import('./ChapterGridPanel').then(m => ({ default: m.ChapterGridPanel })));
const CausalTab = lazy(() => import('./CausalTab').then(m => ({ default: m.CausalTab })));
const VersionGardenPanel = lazy(() => import('./VersionGardenPanel').then(m => ({ default: m.VersionGardenPanel })));
const InspirationPanel = lazy(() => import('./InspirationPanel'));
const CoreDriverLockPanel = lazy(() => import('./CoreDriverLockPanel').then(m => ({ default: m.CoreDriverLockPanel })));
const MultiLineCommandPanel = lazy(() => import('./MultiLineCommandPanel'));
const PacingPressurePanel = lazy(() => import('./PacingPressurePanel').then(m => ({ default: m.PacingPressurePanel })));
const ForeshadowBoardPanel = lazy(() => import('./ForeshadowBoardPanel').then(m => ({ default: m.ForeshadowBoardPanel })));
const CharacterArcCheckPanel = lazy(() => import('./CharacterArcCheckPanel').then(m => ({ default: m.CharacterArcCheckPanel })));
const ReaderEmpathyCheckPanel = lazy(() => import('./ReaderEmpathyCheckPanel').then(m => ({ default: m.ReaderEmpathyCheckPanel })));
const SandboxTrialPanel = lazy(() => import('./SandboxTrialPanel').then(m => ({ default: m.SandboxTrialPanel })));
const VersionDiffPanel = lazy(() => import('./VersionDiffPanel').then(m => ({ default: m.VersionDiffPanel })));
// 第二档新增面板：场景定位仪 / 自然语言命令 / 情感一致性 / 章节批注
const SceneLocatorPanel = lazy(() => import('./SceneLocatorPanel').then(m => ({ default: m.SceneLocatorPanel })));
const NaturalLanguagePanel = lazy(() => import('./NaturalLanguagePanel').then(m => ({ default: m.NaturalLanguagePanel })));
const EmotionConsistencyPanel = lazy(() => import('./EmotionConsistencyPanel').then(m => ({ default: m.EmotionConsistencyPanel })));
const CommentsPanel = lazy(() => import('./CommentsPanel').then(m => ({ default: m.CommentsPanel })));
// 第三档新增面板：章节时间轴 / 曲线拖拽 / 力导向画布
const TimelinePanel = lazy(() => import('./TimelinePanel').then(m => ({ default: m.TimelinePanel })));
const CurveDragPanel = lazy(() => import('./CurveDragPanel').then(m => ({ default: m.CurveDragPanel })));
const ForceDirectedCanvasPanel = lazy(() => import('./ForceDirectedCanvasPanel').then(m => ({ default: m.ForceDirectedCanvasPanel })));
// 第四档新增面板：力导向灵感画布 / 骨架时间轴 / 分支花园 / 读者评论回流
const InspirationCanvasPanel = lazy(() => import('./InspirationCanvasPanel').then(m => ({ default: m.InspirationCanvasPanel })));
const SkeletonTimelinePanel = lazy(() => import('./SkeletonTimelinePanel').then(m => ({ default: m.SkeletonTimelinePanel })));
const BranchGardenPanel = lazy(() => import('./BranchGardenPanel').then(m => ({ default: m.BranchGardenPanel })));
const ReviewReflowPanel = lazy(() => import('./ReviewReflowPanel').then(m => ({ default: m.ReviewReflowPanel })));

// Tab 元信息：label / icon / 所属阶段
const TAB_META: Record<TabId, { label: string; icon: typeof Target }> = {
  // 灵感打磨
  inspiration: { label: '灵感池', icon: Lightbulb },
  inspirationCanvas: { label: '连线画布', icon: Network },
  nlCommand: { label: '自然语言', icon: MessageCircle },
  // 骨架打磨
  coreDriver: { label: '核心驱动', icon: Lock },
  skeleton: { label: '骨架', icon: Compass },
  // 章节打磨
  chapterGrid: { label: '概览', icon: LayoutGrid },
  beats: { label: '节拍', icon: Play },
  expansion: { label: '扩展', icon: GitBranch },
  multiline: { label: '多线', icon: Workflow },
  sceneLocator: { label: '场景定位', icon: Crosshair },
  timeline: { label: '时间轴', icon: Clock },
  skeletonTimeline: { label: '骨架曲线', icon: Activity },
  // 深度校验
  diagnosis: { label: '诊断', icon: Target },
  pacing: { label: '节奏', icon: Activity },
  characters: { label: '弧光', icon: Users },
  readerEmpathy: { label: '共情', icon: Heart },
  foreshadowBoard: { label: '伏笔看板', icon: ShieldAlert },
  emotionConsistency: { label: '情感曲线', icon: Activity },
  curveDrag: { label: '曲线设计', icon: Activity },
  forceCanvas: { label: '关系网', icon: Network },
  comments: { label: '批注', icon: MessageSquare },
  reviewReflow: { label: '评论回流', icon: MessageSquare },
  // 颠覆性修改
  causal: { label: '推演', icon: ShieldAlert },
  sandbox: { label: '试运行', icon: FlaskConical },
  versionDiff: { label: '版本对比', icon: GitCompareArrows },
  snapshots: { label: '版本花园', icon: Camera },
  branchGarden: { label: '分支花园', icon: GitBranch },
};

// 阶段图标
const STAGE_ICON: Record<StageId, typeof Target> = {
  inspiration: Lightbulb,
  skeleton: Compass,
  chapter: Play,
  verify: Target,
  modify: GitCompareArrows,
};

export default function OutlinePolishPanel({
  fullScreen = false,
  embedded = false,
  activeStage: controlledStage,
  onStageChange,
}: {
  fullScreen?: boolean;
  /** 嵌入模式：隐藏阶段步骤条与阶段标题区，仅保留子 Tab 栏 + 操作按钮 + 内容区，供外层三栏布局嵌入 */
  embedded?: boolean;
  /** 受控阶段：传入时由父组件管理 activeStage */
  activeStage?: StageId;
  /** 受控阶段变更回调 */
  onStageChange?: (s: StageId) => void;
}) {
  const chapters = useAppStore(s => s.chapters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const report = useAppStore(s => s.lastOutlineReport);
  const isPolishing = useAppStore(s => s.isPolishingOutline);
  const snapshotCount = useAppStore(s => s.outlineSnapshots.length);
  // 批注未解决总数：用于 comments Tab 徽章
  const comments = useAppStore(s => s.comments);
  const unresolvedCommentCount = useMemo(
    () => Object.values(comments).reduce((sum, list) => sum + list.filter(c => !c.resolved).length, 0),
    [comments],
  );

  // 当前阶段（默认灵感打磨）。受控模式：交给父组件；非受控：本地维护。
  const [internalStage, setInternalStage] = useState<StageId>('inspiration');
  const activeStage = controlledStage ?? internalStage;
  const setActiveStage = useCallback((s: StageId) => {
    if (onStageChange) {
      onStageChange(s);
    } else {
      setInternalStage(s);
    }
  }, [onStageChange]);

  // 当前阶段内的子 Tab（默认每个阶段的第一个 tab）
  const [activeTab, setActiveTab] = useState<TabId>('inspiration');
  const [scope, setScope] = useState<'all' | string>('all');

  // 受控阶段切换时同步 activeTab：若当前 activeTab 不属于新阶段，则切到新阶段首个 Tab。
  // storage 事件跳转时会同时设置 stage 与 targetTab，此时 targetTab 属于新阶段，不会被重置。
  const prevControlledStageRef = useRef<StageId | undefined>(controlledStage);
  useEffect(() => {
    if (!controlledStage) return;
    if (controlledStage === prevControlledStageRef.current) return;
    prevControlledStageRef.current = controlledStage;
    const newStage = STAGES.find(s => s.id === controlledStage);
    if (newStage && !newStage.tabs.includes(activeTab)) {
      setActiveTab(newStage.tabs[0]);
    }
  }, [controlledStage, activeTab]);

  // 监听健康度快捷跳转：外部通过 localStorage + storage 事件传递 targetTab
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'polish:targetTab' && e.newValue) {
        const targetTab = e.newValue as TabId;
        // 找到该 Tab 所属的阶段
        const stage = STAGES.find(s => s.tabs.includes(targetTab));
        if (stage) {
          setActiveStage(stage.id);
          setActiveTab(targetTab);
        }
      }
      if (e.key === 'polish:targetChapter' && e.newValue) {
        setCurrentChapter(e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    // 初始化时检查是否已有 targetTab
    const initialTab = localStorage.getItem('polish:targetTab');
    if (initialTab) {
      const targetTab = initialTab as TabId;
      const stage = STAGES.find(s => s.tabs.includes(targetTab));
      if (stage) {
        setActiveStage(stage.id);
        setActiveTab(targetTab);
      }
      localStorage.removeItem('polish:targetTab');
    }
    return () => window.removeEventListener('storage', handler);
  }, [setCurrentChapter, setActiveStage]);

  // 备忘 mainChapters：包含所有层级的大纲节点（卷/部/章/节/幕），不再仅限 levelType==='chapter'。
  // 否则导入大纲（卷→部结构，无 chapter 层）会全部被过滤，章节网格/节拍/扩展等子面板读不到内容。
  // chapters 引用每次 set 都会变，但内容大多数时候未变；不 memo 会让下游子组件无谓重渲染。
  const mainChapters = useMemo(() => chapters, [chapters]);

  const { handleAnalyze, handleExportMarkdown } = useOutlinePolishActions(report, scope);

  // 切换阶段时自动选中该阶段的第一个 Tab
  const handleStageChange = (stageId: StageId) => {
    setActiveStage(stageId);
    const firstTab = STAGES.find(s => s.id === stageId)?.tabs[0];
    if (firstTab) setActiveTab(firstTab);
  };

  // 当前阶段的所有 Tab
  const currentStage = STAGES.find(s => s.id === activeStage)!;
  const currentTabs = currentStage.tabs;

  // 诊断范围选择器仅在 verify/diagnosis 阶段显示
  const showScopeSelector = activeTab === 'diagnosis';
  // 全面分析按钮仅在 verify/diagnosis 阶段显示
  const showAnalyzeButton = activeTab === 'diagnosis';
  // 导出按钮仅在 verify 阶段且有报告时显示
  const showExportButton = activeTab === 'diagnosis' && !!report;

  return (
    <div className="h-full flex flex-col">
      {/* 5 阶段步骤条：fullScreen 横向 / 默认纵向侧边栏 / embedded 隐藏（步骤条由外层三栏布局左栏承载） */}
      {!embedded && (
        fullScreen ? (
          <nav aria-label="打磨阶段" className="border-b border-ink-800/50 flex items-center px-2 py-1.5 gap-1 bg-ink-900/30">
            <ul role="list" className="flex items-center gap-1">
              {STAGES.map((stage, idx) => {
                const Icon = STAGE_ICON[stage.id];
                const isActive = activeStage === stage.id;
                return (
                  <li key={stage.id} className="flex items-center shrink-0">
                    {idx > 0 && <span className="text-ink-700 mx-0.5" aria-hidden="true">→</span>}
                    <button
                      onClick={() => handleStageChange(stage.id)}
                      aria-current={isActive ? 'step' : undefined}
                      title={`${stage.label}：${stage.description}`}
                      className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors ${
                        isActive
                          ? 'text-amber-300 bg-amber-400/10 font-medium'
                          : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800/30'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                      {stage.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : (
          <nav aria-label="打磨阶段" className="w-16 border-r border-ink-800/50 flex flex-col py-2 gap-1 bg-ink-900/30">
            <ul role="list" className="flex flex-col gap-1 flex-1">
              {STAGES.map(stage => {
                const Icon = STAGE_ICON[stage.id];
                const isActive = activeStage === stage.id;
                return (
                  <li key={stage.id} className="flex-1">
                    <button
                      onClick={() => handleStageChange(stage.id)}
                      aria-current={isActive ? 'step' : undefined}
                      title={`${stage.label}：${stage.description}`}
                      className={`w-full min-h-[64px] flex flex-col items-center justify-center gap-1 px-1 transition-colors relative group ${
                        isActive
                          ? 'text-amber-300 bg-amber-400/10'
                          : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800/30'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400" aria-hidden="true" />
                      )}
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span className="text-[10px] leading-tight text-center">{stage.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )
      )}

      {/* 主内容区：fullScreen 时 flex-1 垂直布局 / 默认 flex-1 水平布局 */}
      <div className={fullScreen ? 'flex-1 flex flex-col min-w-0' : 'flex-1 flex flex-col min-w-0'}>
        {/* 顶部：阶段标题 + 子 Tab 栏 + 操作按钮（embedded 模式下隐藏阶段标题区，由外层渲染章节名头部；仅保留操作按钮行） */}
        {!embedded && (
          <div className="border-b border-ink-800/50">
            <div className="px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Wand2 className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-200 truncate">{currentStage.label}</div>
                  <div className="text-[10px] text-ink-500 truncate">{currentStage.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {showExportButton && (
                  <button
                    onClick={handleExportMarkdown}
                    title="导出 Markdown 报告"
                    className="px-2 py-1 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded transition-colors flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    导出
                  </button>
                )}
                {showAnalyzeButton && (
                  <button
                    onClick={handleAnalyze}
                    disabled={isPolishing || mainChapters.length === 0}
                    className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {isPolishing ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {isPolishing ? '诊断中' : '全面分析'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* embedded 模式下：单独渲染操作按钮行（仅在有按钮时显示，保证诊断/导出等关键操作仍可达） */}
        {embedded && (showExportButton || showAnalyzeButton) && (
          <div className="px-3 py-1.5 flex items-center justify-end gap-1 border-b border-ink-800/50 bg-ink-900/20">
            {showExportButton && (
              <button
                onClick={handleExportMarkdown}
                title="导出 Markdown 报告"
                className="px-2 py-1 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded transition-colors flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                导出
              </button>
            )}
            {showAnalyzeButton && (
              <button
                onClick={handleAnalyze}
                disabled={isPolishing || mainChapters.length === 0}
                className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {isPolishing ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {isPolishing ? '诊断中' : '全面分析'}
              </button>
            )}
          </div>
        )}

        {/* 子 Tab 栏（仅当阶段有多个 Tab 时显示） */}
        {currentTabs.length > 1 && (
          <div role="tablist" aria-label={`${currentStage.label}子功能`} className={`flex border-t border-ink-800/30 overflow-x-auto ${embedded ? 'border-t-0' : ''}`}>
            {currentTabs.map(tabId => {
              const meta = TAB_META[tabId];
              const Icon = meta.icon;
              const isActive = activeTab === tabId;
              // Tab 徽章计数
              let badge: number | undefined;
              if (tabId === 'diagnosis') {
                badge = report?.issues.filter(i => !i.ignored && !i.resolved).length || 0;
              } else if (tabId === 'snapshots') {
                badge = snapshotCount;
              } else if (tabId === 'comments') {
                badge = unresolvedCommentCount;
              }
              return (
                <button
                  key={tabId}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`polish-tabpanel-${tabId}`}
                  onClick={() => setActiveTab(tabId)}
                  className={`flex-1 min-w-[64px] py-2 text-xs flex items-center justify-center gap-1 transition-colors relative whitespace-nowrap ${
                    isActive
                      ? 'text-amber-300 border-b-2 border-amber-400 bg-amber-400/5'
                      : 'text-ink-500 hover:text-ink-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {meta.label}
                  {badge !== undefined && badge > 0 && (
                    <span className="ml-0.5 px-1 py-px text-[9px] bg-amber-400/20 text-amber-300 rounded-full">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 诊断范围选择器（仅 diagnosis Tab） */}
        {showScopeSelector && (
          <div className="px-3 py-2 border-t border-ink-800/30 flex items-center gap-2 text-[11px]">
            <span className="text-ink-500">诊断范围：</span>
            <select
              aria-label="诊断范围"
              value={scope}
              onChange={e => setScope(e.target.value)}
              className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
            >
              <option value="all">全量大纲</option>
              {mainChapters.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* 内容区：根据 activeTab 渲染对应子组件 */}
        <div
          id={`polish-tabpanel-${activeTab}`}
          role="tabpanel"
          aria-label={TAB_META[activeTab]?.label}
          className="flex-1 overflow-y-auto p-3 space-y-3"
        >
          <Suspense fallback={<div role="status" aria-live="polite" className="p-4 text-center text-xs text-ink-500">加载中…</div>}>
          {/* 灵感打磨阶段 */}
          {activeTab === 'inspiration' && <InspirationPanel />}
          {activeTab === 'inspirationCanvas' && <InspirationCanvasPanel />}
          {activeTab === 'nlCommand' && <NaturalLanguagePanel />}

          {/* 骨架打磨阶段 */}
          {activeTab === 'coreDriver' && <CoreDriverLockPanel />}
          {activeTab === 'skeleton' && <SkeletonTab />}

          {/* 章节打磨阶段 */}
          {activeTab === 'chapterGrid' && (
            <ChapterGridPanel
              chapters={mainChapters}
              currentChapterId={currentChapterId}
              onSelectChapter={setCurrentChapter}
              report={report}
            />
          )}
          {activeTab === 'beats' && (
            <BeatsTab
              chapters={mainChapters}
              currentChapterId={currentChapterId}
              onSelectChapter={setCurrentChapter}
            />
          )}
          {activeTab === 'expansion' && (
            <ExpansionPanel
              chapters={mainChapters}
              currentChapterId={currentChapterId}
              onSelectChapter={setCurrentChapter}
            />
          )}
          {activeTab === 'multiline' && <MultiLineCommandPanel />}
          {activeTab === 'sceneLocator' && <SceneLocatorPanel />}
          {activeTab === 'timeline' && <TimelinePanel />}
          {activeTab === 'skeletonTimeline' && <SkeletonTimelinePanel />}

          {/* 深度校验阶段 */}
          {activeTab === 'diagnosis' && (
            <DiagnosticsPanel report={report} onJumpTo={setCurrentChapter} />
          )}
          {activeTab === 'pacing' && <PacingPressurePanel />}
          {activeTab === 'characters' && <CharacterArcCheckPanel />}
          {activeTab === 'readerEmpathy' && <ReaderEmpathyCheckPanel />}
          {activeTab === 'foreshadowBoard' && <ForeshadowBoardPanel />}
          {activeTab === 'emotionConsistency' && <EmotionConsistencyPanel />}
          {activeTab === 'curveDrag' && <CurveDragPanel />}
          {activeTab === 'forceCanvas' && <ForceDirectedCanvasPanel />}
          {activeTab === 'comments' && <CommentsPanel />}
          {activeTab === 'reviewReflow' && <ReviewReflowPanel />}
          {/* 保留旧的 RhythmPulsePanel / CharacterArcPanel 以兼容导出报告 */}
          {activeTab === 'pacing' && report && (
            <details className="text-[11px] text-ink-500">
              <summary className="cursor-pointer hover:text-ink-300">查看旧版节奏/角色曲线（来自诊断报告）</summary>
              <div className="mt-2 space-y-2">
                <RhythmPulsePanel report={report} onJumpTo={setCurrentChapter} />
                <CharacterArcPanel report={report} onJumpTo={setCurrentChapter} />
              </div>
            </details>
          )}

          {/* 颠覆性修改阶段 */}
          {activeTab === 'causal' && <CausalTab chapters={mainChapters} />}
          {activeTab === 'sandbox' && <SandboxTrialPanel />}
          {activeTab === 'versionDiff' && <VersionDiffPanel />}
          {activeTab === 'snapshots' && (
            <VersionGardenPanel foreshadows={foreshadows} chapters={chapters} />
          )}
          {activeTab === 'branchGarden' && <BranchGardenPanel />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
