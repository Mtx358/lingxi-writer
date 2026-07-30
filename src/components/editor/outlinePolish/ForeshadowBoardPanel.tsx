/**
 * 草蛇灰线看板（规格书第四阶段）
 *
 * 将伏笔按 pending / progressing / paidoff / overdue 四栏分组展示，支持按重要等级筛选，
 * 点击卡片跳转到埋设章节，并支持拖拽卡片在栏间切换状态。
 * 数据来自 outlinePolishSlice.getForeshadowBoardItems()，关联角色 ID 在 UI 层映射为名字。
 *
 * 状态映射（Foreshadow.status → 看板分组）：
 *   planted    → pending     （待回收）
 *   progressing → progressing （推进中）
 *   paid-off   → paidoff      （已回收）
 *   planted + 已越过 payoff → overdue（逾期未回收）
 *
 * 拖拽语义：
 *   - 拖到「推进中」→ status='progressing'
 *   - 拖到「已回收」 → status='paid-off'
 *   - 拖到「待回收」 → status='planted'（同时清空 payoffChapterId 不足以保证不再逾期，
 *     故仅当原分组为 progressing/paidoff 时才回退到 planted）
 *   - 「逾期未回收」列不可拖入（逾期是系统判定，需先回到待回收或推进中）
 */
import { useState, useCallback, useMemo } from 'react';
import { ClipboardList, ShieldCheck, Siren, Sparkles, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ForeshadowBoardItem, Foreshadow, ForeshadowBoardGroup, ForeshadowPayoffCheck, EmergencyRecoveryPlan } from '@/types';

type Priority = Foreshadow['priority'];

const PRIORITY_LABELS: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const PRIORITY_COLORS: Record<Priority, string> = {
  high: 'text-red-300 bg-red-400/10 border-red-500/30',
  medium: 'text-amber-300 bg-amber-400/10 border-amber-500/30',
  low: 'text-ink-400 bg-ink-700/40 border-ink-600/40',
};

/** 栏位配置：标题 / 是否可拖入 / 危险栏样式 */
const COLUMN_CONFIG: Record<ForeshadowBoardGroup, { title: string; droppable: boolean; danger?: boolean; accent: string }> = {
  pending: { title: '待回收', droppable: true, accent: 'text-ink-300' },
  progressing: { title: '推进中', droppable: true, accent: 'text-cyan-300' },
  paidoff: { title: '已回收', droppable: true, accent: 'text-emerald-300' },
  overdue: { title: '逾期未回收', droppable: false, danger: true, accent: 'text-red-300' },
};

const COLUMN_ORDER: ForeshadowBoardGroup[] = ['pending', 'progressing', 'paidoff', 'overdue'];

/** 回收合理性等级 → 标签与配色（规格书阶段4-4） */
const PAYOFF_LEVEL_META: Record<ForeshadowPayoffCheck['level'], { label: string; cls: string }> = {
  good: { label: '充分呼应', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  weak: { label: '呼应较弱', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  missing: { label: '未呼应', cls: 'text-red-300 bg-red-500/10 border-red-500/30' },
};

/** 应急回收方案代价 → 标签 */
const RECOVERY_COST_META: Record<'low' | 'medium' | 'high', { label: string; cls: string }> = {
  low: { label: '低成本', cls: 'text-emerald-300 bg-emerald-500/10' },
  medium: { label: '中成本', cls: 'text-amber-300 bg-amber-500/10' },
  high: { label: '高成本', cls: 'text-red-300 bg-red-500/10' },
};

/** 将分组映射回 Foreshadow.status（用于拖拽后写回） */
function groupToStatus(group: ForeshadowBoardGroup): Foreshadow['status'] | null {
  switch (group) {
    case 'pending': return 'planted';
    case 'progressing': return 'progressing';
    case 'paidoff': return 'paid-off';
    // overdue 不可拖入
    default: return null;
  }
}

export function ForeshadowBoardPanel() {
  const getItems = useAppStore(s => s.getForeshadowBoardItems);
  const foreshadows = useAppStore(s => s.foreshadows);
  const characters = useAppStore(s => s.characters);
  const chapters = useAppStore(s => s.chapters);
  const updateForeshadow = useAppStore(s => s.updateForeshadow);
  const runForeshadowPayoffCheck = useAppStore(s => s.runForeshadowPayoffCheck);
  const generateRecoveryPlan = useAppStore(s => s.generateRecoveryPlan);
  const payoffChecks = useAppStore(s => s.foreshadowPayoffChecks);
  const recoveryPlans = useAppStore(s => s.emergencyRecoveryPlans);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ForeshadowBoardGroup | null>(null);
  const [checkingPayoff, setCheckingPayoff] = useState(false);
  const [generatingPlanFor, setGeneratingPlanFor] = useState<string | null>(null);
  const [expandedPlanFor, setExpandedPlanFor] = useState<string | null>(null);

  // getItems() 每次调用都遍历全部 foreshadows 构建 chapter Map 并返回全新数组，
  // 必须用 useMemo 收敛，否则每次渲染都重算 O(F) 映射且下游 counts/filtered/grouped
  // 全部因新引用而重算，子组件 BoardColumn/ForeshadowCard 也无法受益于 memo
  // 依赖 chapters：getForeshadowBoardItems 内部读取 chapters 计算 currentOrder 与
  // chapterById，章节增删/重排会影响逾期分组，故 chapters 变化必须让 memo 失效
  // eslint-disable-next-line react-hooks/exhaustive-deps -- foreshadows/chapters 经 store get() 读取，linter 无法追踪，但确实需要作为依赖触发重算
  const items = useMemo(() => getItems(), [getItems, foreshadows, chapters]);
  const charMap = useMemo(() => new Map(characters.map(c => [c.id, c.name])), [characters]);
  const foreMap = useMemo(() => new Map(foreshadows.map(f => [f.id, f])), [foreshadows]);

  const { counts, grouped } = useMemo(() => {
    const c: Record<ForeshadowBoardGroup, number> = { pending: 0, progressing: 0, paidoff: 0, overdue: 0 };
    const g: Record<ForeshadowBoardGroup, ForeshadowBoardItem[]> = {
      pending: [],
      progressing: [],
      paidoff: [],
      overdue: [],
    };
    for (const it of items) {
      c[it.group] += 1;
      if (priorityFilter === 'all' || it.priority === priorityFilter) {
        g[it.group].push(it);
      }
    }
    return { counts: c, grouped: g };
  }, [items, priorityFilter]);

  const resolveCharName = (id: string) => charMap.get(id) ?? id.slice(0, 6);

  // 合理性检测与应急方案索引：按 foreshadowId 查找
  const payoffCheckMap = useMemo(() => new Map(payoffChecks.map(c => [c.foreshadowId, c])), [payoffChecks]);
  const recoveryPlanMap = useMemo(() => new Map(recoveryPlans.map(p => [p.foreshadowId, p])), [recoveryPlans]);

  const handleCardClick = (item: ForeshadowBoardItem) => {
    const f = foreMap.get(item.foreshadowId);
    const plantedChapterId = f?.plantedChapterId ?? null;
    useAppStore.setState({ currentChapterId: plantedChapterId });
  };

  /** 运行回收合理性检测（仅检测已回收伏笔） */
  const handleRunPayoffCheck = useCallback(async () => {
    setCheckingPayoff(true);
    try {
      await runForeshadowPayoffCheck();
    } finally {
      setCheckingPayoff(false);
    }
  }, [runForeshadowPayoffCheck]);

  /** 为逾期伏笔生成应急回收方案 */
  const handleGeneratePlan = useCallback(async (foreshadowId: string) => {
    setGeneratingPlanFor(foreshadowId);
    setExpandedPlanFor(foreshadowId);
    try {
      await generateRecoveryPlan(foreshadowId);
    } finally {
      setGeneratingPlanFor(null);
    }
  }, [generateRecoveryPlan]);

  /** 采纳应急方案：跳转到推荐回收章节，让创作者就地落实 */
  const handleAdoptPlan = useCallback((plan: EmergencyRecoveryPlan) => {
    if (plan.recommendedChapterId) {
      setCurrentChapter(plan.recommendedChapterId);
    }
  }, [setCurrentChapter]);

  /** 拖拽放下：根据目标栏位写回 foreshadow.status */
  const handleDrop = useCallback((targetGroup: ForeshadowBoardGroup) => {
    if (!draggingId) return;
    const newStatus = groupToStatus(targetGroup);
    if (!newStatus) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }
    const f = foreMap.get(draggingId);
    if (f && f.status !== newStatus) {
      updateForeshadow(draggingId, { status: newStatus });
    }
    setDraggingId(null);
    setDropTarget(null);
  }, [draggingId, foreMap, updateForeshadow]);

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <StatsBar
          counts={counts}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          payoffCheckCount={payoffChecks.length}
          onRunPayoffCheck={handleRunPayoffCheck}
          checkingPayoff={checkingPayoff}
        />
        <div className="text-center py-8">
          <ClipboardList className="w-10 h-10 text-ink-600 mx-auto mb-2" />
          <p className="text-sm text-ink-500">暂无伏笔</p>
          <p className="text-xs text-ink-600">在伏笔面板中创建伏笔并指定埋设/回收章节后，这里会自动汇总。</p>
          <p className="text-xs text-ink-600 mt-1">拖拽卡片在四栏间切换状态：待回收 ⇄ 推进中 ⇄ 已回收。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StatsBar
        counts={counts}
        priorityFilter={priorityFilter}
        setPriorityFilter={setPriorityFilter}
        payoffCheckCount={payoffChecks.length}
        onRunPayoffCheck={handleRunPayoffCheck}
        checkingPayoff={checkingPayoff}
      />

      <div className="grid grid-cols-4 gap-2">
        {COLUMN_ORDER.map(group => (
          <BoardColumn
            key={group}
            group={group}
            items={grouped[group]}
            onCardClick={handleCardClick}
            resolveCharName={resolveCharName}
            isDropTarget={dropTarget === group}
            canDrop={COLUMN_CONFIG[group].droppable}
            onDragStart={(id) => setDraggingId(id)}
            onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
            onDragOver={(g) => {
              if (COLUMN_CONFIG[g].droppable && draggingId) setDropTarget(g);
            }}
            onDrop={handleDrop}
            draggingId={draggingId}
            payoffCheckMap={payoffCheckMap}
            recoveryPlanMap={recoveryPlanMap}
            generatingPlanFor={generatingPlanFor}
            expandedPlanFor={expandedPlanFor}
            onGeneratePlan={handleGeneratePlan}
            onTogglePlan={(id) => setExpandedPlanFor(cur => cur === id ? null : id)}
            onAdoptPlan={handleAdoptPlan}
          />
        ))}
      </div>
    </div>
  );
}

function StatsBar({
  counts,
  priorityFilter,
  setPriorityFilter,
  payoffCheckCount,
  onRunPayoffCheck,
  checkingPayoff,
}: {
  counts: Record<ForeshadowBoardGroup, number>;
  priorityFilter: 'all' | Priority;
  setPriorityFilter: (v: 'all' | Priority) => void;
  payoffCheckCount: number;
  onRunPayoffCheck: () => void;
  checkingPayoff: boolean;
}) {
  return (
    <div className="p-2 bg-ink-800/30 rounded-lg flex items-center gap-2 text-[11px] flex-wrap">
      <span className="px-2 py-0.5 bg-ink-700/40 rounded flex items-center gap-1">
        <span className="text-ink-500">待回收</span>
        <span className="text-ink-100 font-medium">{counts.pending}</span>
      </span>
      <span className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded flex items-center gap-1">
        <span className="text-cyan-400">推进中</span>
        <span className="text-cyan-300 font-medium">{counts.progressing}</span>
      </span>
      <span className="px-2 py-0.5 bg-ink-700/40 rounded flex items-center gap-1">
        <span className="text-ink-500">已回收</span>
        <span className="text-emerald-300 font-medium">{counts.paidoff}</span>
      </span>
      <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded flex items-center gap-1">
        <span className="text-red-400">逾期未回收</span>
        <span className="text-red-400 font-medium">{counts.overdue}</span>
      </span>
      <button
        onClick={onRunPayoffCheck}
        disabled={checkingPayoff || counts.paidoff === 0}
        title="检测已回收伏笔的回收章节是否真正呼应埋设内容"
        className="px-2 py-0.5 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 rounded flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {checkingPayoff ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
        回收合理性检测
        {payoffCheckCount > 0 && <span className="ml-0.5 text-[9px] opacity-70">({payoffCheckCount})</span>}
      </button>
      <select
        aria-label="筛选优先级"
        value={priorityFilter}
        onChange={e => setPriorityFilter(e.target.value as 'all' | Priority)}
        className="ml-auto bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
      >
        <option value="all">全部等级</option>
        <option value="high">高</option>
        <option value="medium">中</option>
        <option value="low">低</option>
      </select>
    </div>
  );
}

function BoardColumn({
  group,
  items,
  onCardClick,
  resolveCharName,
  isDropTarget,
  canDrop,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  draggingId,
  payoffCheckMap,
  recoveryPlanMap,
  generatingPlanFor,
  expandedPlanFor,
  onGeneratePlan,
  onTogglePlan,
  onAdoptPlan,
}: {
  group: ForeshadowBoardGroup;
  items: ForeshadowBoardItem[];
  onCardClick: (item: ForeshadowBoardItem) => void;
  resolveCharName: (id: string) => string;
  isDropTarget: boolean;
  canDrop: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (group: ForeshadowBoardGroup) => void;
  onDrop: (group: ForeshadowBoardGroup) => void;
  draggingId: string | null;
  payoffCheckMap: Map<string, ForeshadowPayoffCheck>;
  recoveryPlanMap: Map<string, EmergencyRecoveryPlan>;
  generatingPlanFor: string | null;
  expandedPlanFor: string | null;
  onGeneratePlan: (foreshadowId: string) => void;
  onTogglePlan: (foreshadowId: string) => void;
  onAdoptPlan: (plan: EmergencyRecoveryPlan) => void;
}) {
  const config = COLUMN_CONFIG[group];
  return (
    <div
      onDragOver={(e) => {
        if (!canDrop) return;
        e.preventDefault();
        onDragOver(group);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(group);
      }}
      className={`rounded-lg border p-2 transition-colors min-h-[120px] ${
        config.danger ? 'border-red-500/40' : 'border-ink-700/50'
      } ${
        isDropTarget && canDrop ? 'bg-cyan-500/10 border-cyan-400/60 ring-1 ring-cyan-400/40' : 'bg-ink-800/20'
      }`}
      data-testid={`board-column-${group}`}
    >
      <div className={`text-xs font-medium mb-2 flex items-center justify-between ${config.accent}`}>
        <span>{config.title}</span>
        <span className="text-[10px] text-ink-500">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-[10px] text-ink-600 text-center py-4">
            {canDrop ? '拖拽卡片到此处' : '空'}
          </div>
        ) : (
          items.map(item => (
            <ForeshadowCard
              key={item.foreshadowId}
              item={item}
              onClick={() => onCardClick(item)}
              resolveCharName={resolveCharName}
              danger={config.danger}
              isDragging={draggingId === item.foreshadowId}
              onDragStart={() => onDragStart(item.foreshadowId)}
              onDragEnd={onDragEnd}
              payoffCheck={payoffCheckMap.get(item.foreshadowId)}
              recoveryPlan={recoveryPlanMap.get(item.foreshadowId)}
              generatingPlan={generatingPlanFor === item.foreshadowId}
              planExpanded={expandedPlanFor === item.foreshadowId}
              onGeneratePlan={() => onGeneratePlan(item.foreshadowId)}
              onTogglePlan={() => onTogglePlan(item.foreshadowId)}
              onAdoptPlan={onAdoptPlan}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ForeshadowCard({
  item,
  onClick,
  resolveCharName,
  danger,
  isDragging,
  onDragStart,
  onDragEnd,
  payoffCheck,
  recoveryPlan,
  generatingPlan,
  planExpanded,
  onGeneratePlan,
  onTogglePlan,
  onAdoptPlan,
}: {
  item: ForeshadowBoardItem;
  onClick: () => void;
  resolveCharName: (id: string) => string;
  danger?: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  payoffCheck?: ForeshadowPayoffCheck;
  recoveryPlan?: EmergencyRecoveryPlan;
  generatingPlan: boolean;
  planExpanded: boolean;
  onGeneratePlan: () => void;
  onTogglePlan: () => void;
  onAdoptPlan: (plan: EmergencyRecoveryPlan) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        // jsdom 等环境可能不实现 dataTransfer，做防御性判断
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.foreshadowId);
        }
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`w-full text-left p-2 rounded border transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      } ${
        danger
          ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
          : 'border-ink-700/50 bg-ink-800/40 hover:bg-ink-700/40'
      }`}
      title="点击跳转到埋设章节，拖拽切换状态"
      data-testid={`foreshadow-card-${item.foreshadowId}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs text-ink-100 font-medium truncate flex-1">{item.title}</span>
        <span className={`px-1 py-px text-[9px] rounded border flex-shrink-0 ${PRIORITY_COLORS[item.priority]}`}>
          {PRIORITY_LABELS[item.priority]}
        </span>
      </div>
      <div className="text-[10px] text-ink-500 space-y-0.5">
        <div>埋设：{item.plantedChapterTitle ?? '未指定'}</div>
        <div>回收：{item.payoffChapterTitle ?? '未指定'}</div>
      </div>
      {item.group === 'overdue' && item.overdueChapters > 0 && (
        <div className="text-[10px] text-red-400 font-bold mt-1">逾期 {item.overdueChapters} 章</div>
      )}
      {item.relatedCharacters.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {item.relatedCharacters.map(id => (
            <span key={id} className="text-[9px] px-1 py-px bg-ink-700/50 text-ink-400 rounded">
              {resolveCharName(id)}
            </span>
          ))}
        </div>
      )}

      {/* 回收合理性检测结果（仅已回收栏显示） */}
      {item.group === 'paidoff' && payoffCheck && (
        <div className="mt-1.5 pt-1.5 border-t border-ink-700/40">
          <div className="flex items-center gap-1 mb-0.5">
            <span className={`px-1 py-px text-[9px] rounded border ${PAYOFF_LEVEL_META[payoffCheck.level].cls}`}>
              {PAYOFF_LEVEL_META[payoffCheck.level].label}
            </span>
          </div>
          <div className="text-[9px] text-ink-400 leading-relaxed">{payoffCheck.reason}</div>
          {payoffCheck.level !== 'good' && (
            <div className="text-[9px] text-amber-300/80 mt-0.5">建议：{payoffCheck.suggestion}</div>
          )}
        </div>
      )}

      {/* 逾期应急回收方案（仅逾期栏显示） */}
      {item.group === 'overdue' && (
        <div className="mt-1.5 pt-1.5 border-t border-red-500/20">
          {recoveryPlan ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePlan(); }}
                className="w-full flex items-center gap-1 text-[9px] text-red-300 hover:text-red-200 mb-1"
              >
                <Siren className="w-2.5 h-2.5" />
                {planExpanded ? '收起应急方案' : '查看应急回收方案'}
                <span className="ml-auto text-ink-600">{recoveryPlan.variants.length} 个变体</span>
              </button>
              {planExpanded && (
                <div className="space-y-1">
                  {recoveryPlan.summary && (
                    <div className="text-[9px] text-ink-400 italic">{recoveryPlan.summary}</div>
                  )}
                  {recoveryPlan.recommendedChapterTitle && (
                    <div className="text-[9px] text-emerald-300/80">
                      推荐回收点：《{recoveryPlan.recommendedChapterTitle}》
                    </div>
                  )}
                  {recoveryPlan.variants.map((v, idx) => {
                    const costMeta = RECOVERY_COST_META[v.cost];
                    return (
                      <div key={idx} className="p-1 rounded bg-ink-900/40 border border-ink-700/40">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[9px] text-ink-200 font-medium">{v.title}</span>
                          <span className={`ml-auto px-1 text-[8px] rounded ${costMeta.cls}`}>{costMeta.label}</span>
                        </div>
                        <div className="text-[9px] text-ink-400 leading-relaxed">{v.content}</div>
                      </div>
                    );
                  })}
                  <button
                    onClick={(e) => { e.stopPropagation(); onAdoptPlan(recoveryPlan); }}
                    className="w-full mt-0.5 px-1.5 py-0.5 text-[9px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 rounded flex items-center justify-center gap-1"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    就近落实（跳转推荐章节）
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onGeneratePlan(); }}
              disabled={generatingPlan}
              className="w-full px-1.5 py-1 text-[9px] bg-red-500/15 text-red-300 hover:bg-red-500/25 rounded flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {generatingPlan ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Siren className="w-2.5 h-2.5" />}
              {generatingPlan ? '生成中…' : '生成应急回收方案'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
