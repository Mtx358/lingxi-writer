/**
 * 因果推演 Tab：变动影响预览 + 影响树可视化（规格书第五阶段）
 *
 * 输入目标章节 + 假设性改动描述，调用 runCausalPreview 获取变动影响报告。
 * 报告以「影响树」形式展示：
 *   根节点（改动目标 + 改动描述）
 *     ├── 🔴 严重断裂（N 项）  ← 按影响程度一级分组，可折叠
 *     │     ├── 章节（N 项）   ← 按受影响实体类型二级分组
 *     │     ├── 人物（N 项）
 *     │     ├── 伏笔（N 项）
 *     │     └── 设定（N 项）
 *     ├── 🟡 部分影响（N 项）
 *     └── 🟢 轻微波动（N 项）
 *
 * 规格书阶段5-2：
 *   - 树枝按影响程度标色：🔴 严重断裂 / 🟡 部分影响 / 🟢 轻微波动
 *   - 树枝是受影响的章节/人物/伏笔/设定
 *   - 点开每根树枝，看具体问题和替代方案
 */
import { useState, useMemo } from 'react';
import {
  ShieldAlert, AlertTriangle, Loader2,
  ChevronRight, ChevronDown, GitBranch, Target,
  BookOpen, Users, Flag, Globe,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter, CausalImpactItem, CausalImpactReport } from '@/types';
import { Section } from './shared';

/** 影响类型配置：标签 / 颜色 / 图标色（按影响程度三色）*/
const IMPACT_TYPE_CONFIG: Record<CausalImpactItem['type'], { label: string; branchClass: string; badgeClass: string; leafClass: string; dot: string; emoji: string }> = {
  broken: {
    label: '严重断裂',
    branchClass: 'border-red-500/40 bg-red-500/5',
    badgeClass: 'bg-red-500/20 text-red-300',
    leafClass: 'bg-red-500/5 border-red-500/30',
    dot: 'bg-red-400',
    emoji: '🔴',
  },
  weakened: {
    label: '部分影响',
    branchClass: 'border-amber-500/40 bg-amber-500/5',
    badgeClass: 'bg-amber-500/20 text-amber-300',
    leafClass: 'bg-amber-500/5 border-amber-500/30',
    dot: 'bg-amber-400',
    emoji: '🟡',
  },
  missing: {
    // 规格书阶段5-2：第三色为绿色"轻微波动"（原蓝色"缺失"按标尺重构）
    label: '轻微波动',
    branchClass: 'border-emerald-500/40 bg-emerald-500/5',
    badgeClass: 'bg-emerald-500/20 text-emerald-300',
    leafClass: 'bg-emerald-500/5 border-emerald-500/30',
    dot: 'bg-emerald-400',
    emoji: '🟢',
  },
};

const TYPE_ORDER: CausalImpactItem['type'][] = ['broken', 'weakened', 'missing'];

/** 实体类型配置：标签 / 图标（按受影响实体分类二级分组）*/
const ENTITY_TYPE_CONFIG: Record<NonNullable<CausalImpactItem['entityType']>, { label: string; icon: typeof BookOpen; color: string }> = {
  chapter: { label: '章节', icon: BookOpen, color: 'text-blue-300' },
  character: { label: '人物', icon: Users, color: 'text-purple-300' },
  foreshadow: { label: '伏笔', icon: Flag, color: 'text-amber-300' },
  setting: { label: '设定', icon: Globe, color: 'text-cyan-300' },
};

const ENTITY_TYPE_ORDER: NonNullable<CausalImpactItem['entityType']>[] = ['chapter', 'character', 'foreshadow', 'setting'];

export function CausalTab({ chapters }: { chapters: Chapter[] }) {
  const runCausalPreview = useAppStore(s => s.runCausalPreview);
  const lastCausalImpact = useAppStore(s => s.lastCausalImpact);
  const clearCausalImpact = useAppStore(s => s.clearCausalImpact);

  const [targetId, setTargetId] = useState(chapters[0]?.id || '');
  const [changeDesc, setChangeDesc] = useState('');
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    if (!changeDesc.trim() || !targetId) return;
    setRunning(true);
    try {
      await runCausalPreview(changeDesc.trim(), targetId);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <Section icon={ShieldAlert} title="因果推演预览" desc="假设性改动的影响报告，先算代价再决定是否改">
        <div className="space-y-2">
          <select
            aria-label="目标章节"
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className="input text-xs py-1.5 w-full"
          >
            {chapters.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          <textarea
            aria-label="改动描述"
            value={changeDesc}
            onChange={e => setChangeDesc(e.target.value)}
            placeholder="描述假设性改动，如：让导师在第 8 章提前死亡 / 让反派提前知道主角身份"
            rows={3}
            className="input text-xs py-1.5 w-full resize-none"
          />
          <button
            onClick={handleRun}
            disabled={running || !changeDesc.trim() || !targetId}
            className="w-full px-3 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1 disabled:opacity-40"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}
            启动推演
          </button>
        </div>
      </Section>

      {lastCausalImpact && (
        <Section
          icon={AlertTriangle}
          title="变动影响报告"
          desc={lastCausalImpact.changeDescription}
          action={
            <button
              onClick={clearCausalImpact}
              className="text-[10px] text-ink-500 hover:text-ink-300"
            >
              清除
            </button>
          }
        >
          <ImpactTree report={lastCausalImpact} chapters={chapters} />
        </Section>
      )}
    </div>
  );
}

/** 影响树：根节点 → 类型分支（一级）→ 实体类型分组（二级）→ 叶子 */
function ImpactTree({ report, chapters }: { report: CausalImpactReport; chapters: Chapter[] }) {
  const chapterMap = useMemo(() => new Map(chapters.map(c => [c.id, c.title])), [chapters]);
  const targetTitle = chapterMap.get(report.targetId) ?? '未指定章节';

  // 按影响类型一级分组
  const groupedByType = useMemo(() => {
    const map: Record<CausalImpactItem['type'], CausalImpactItem[]> = { broken: [], weakened: [], missing: [] };
    for (const imp of report.impacts) map[imp.type].push(imp);
    return map;
  }, [report.impacts]);

  return (
    <div className="space-y-2" role="status" aria-live="polite" aria-label="变动影响报告">
      {/* 综合风险等级 */}
      <div className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
        report.overallRisk === 'high'
          ? 'bg-red-500/10 text-red-300'
          : report.overallRisk === 'medium'
          ? 'bg-amber-500/10 text-amber-300'
          : 'bg-emerald-500/10 text-emerald-300'
      }`}>
        综合风险：
        {report.overallRisk === 'high' ? '高' : report.overallRisk === 'medium' ? '中' : '低'}
      </div>

      {/* 树根节点：改动目标 */}
      <div className="flex items-start gap-2 p-2 rounded-lg bg-ink-800/40 border border-ink-700/50">
        <Target className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-ink-500">改动目标</div>
          <div className="text-xs text-ink-100 font-medium truncate">{targetTitle}</div>
          <div className="text-[11px] text-ink-400 mt-0.5 line-clamp-2">{report.changeDescription}</div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-ink-500 flex-shrink-0">
          <GitBranch className="w-3 h-3" />
          <span>{report.impacts.length} 处影响</span>
        </div>
      </div>

      {/* 树连接线 + 一级类型分支（每条分支内再按实体类型二级分组）*/}
      {report.impacts.length === 0 ? (
        <div className="text-center py-4 text-xs text-ink-500">
          未检测到连锁影响，可以放心改动
        </div>
      ) : (
        <div className="space-y-1.5 pl-3 border-l border-dashed border-ink-700/50 ml-3">
          {TYPE_ORDER.map(type => {
            const items = groupedByType[type];
            if (items.length === 0) return null;
            return (
              <ImpactBranch key={type} type={type} items={items} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 一级类型分支：可折叠，内部按 entityType 二级分组 */
function ImpactBranch({ type, items }: { type: CausalImpactItem['type']; items: CausalImpactItem[] }) {
  const config = IMPACT_TYPE_CONFIG[type];
  const [collapsed, setCollapsed] = useState(false);

  // 二级分组：按 entityType 归类（无 entityType 的归入 'chapter' 兜底）
  const groupedByEntity = useMemo(() => {
    const map: Record<NonNullable<CausalImpactItem['entityType']>, CausalImpactItem[]> = {
      chapter: [],
      character: [],
      foreshadow: [],
      setting: [],
    };
    for (const imp of items) {
      const et = imp.entityType ?? 'chapter';
      map[et].push(imp);
    }
    return map;
  }, [items]);

  return (
    <div className={`rounded border ${config.branchClass}`}>
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-controls={`impact-branch-${type}-region`}
        aria-label={`${collapsed ? '展开' : '折叠'}${config.label}影响列表`}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left"
        data-testid={`impact-branch-${type}`}
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-ink-500 flex-shrink-0" aria-hidden="true" />
          : <ChevronDown className="w-3 h-3 text-ink-500 flex-shrink-0" aria-hidden="true" />}
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot} flex-shrink-0`} />
        <span className={`text-[10px] px-1 py-0.5 rounded ${config.badgeClass} flex-shrink-0`}>
          {config.emoji} {config.label}
        </span>
        <span className="text-[10px] text-ink-500">{items.length} 项</span>
        <span className="ml-auto text-[10px] text-ink-600">{collapsed ? '展开' : '折叠'}</span>
      </button>
      {!collapsed && (
        <div id={`impact-branch-${type}-region`} className="px-2 pb-2 space-y-2">
          {ENTITY_TYPE_ORDER.map(et => {
            const subItems = groupedByEntity[et];
            if (subItems.length === 0) return null;
            return (
              <EntityGroup key={et} entityType={et} items={subItems} leafClass={config.leafClass} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 二级实体类型分组：章节 / 人物 / 伏笔 / 设定 */
function EntityGroup({
  entityType,
  items,
  leafClass,
}: {
  entityType: NonNullable<CausalImpactItem['entityType']>;
  items: CausalImpactItem[];
  leafClass: string;
}) {
  const cfg = ENTITY_TYPE_CONFIG[entityType];
  const Icon = cfg.icon;
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="ml-2 pl-2 border-l border-dashed border-ink-700/40">
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? '展开' : '折叠'}${cfg.label}分组`}
        className="w-full flex items-center gap-1.5 py-1 text-left"
        data-testid={`impact-entity-${entityType}`}
      >
        {collapsed
          ? <ChevronRight className="w-2.5 h-2.5 text-ink-500 flex-shrink-0" />
          : <ChevronDown className="w-2.5 h-2.5 text-ink-500 flex-shrink-0" />}
        <Icon className={`w-3 h-3 ${cfg.color} flex-shrink-0`} aria-hidden="true" />
        <span className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
        <span className="text-[10px] text-ink-500">{items.length} 项</span>
      </button>
      {!collapsed && (
        <div className="space-y-1.5 mt-1">
          {items.map((impact, i) => (
            <ImpactLeaf key={i} impact={impact} leafClass={leafClass} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 叶子节点：单个影响项 + 替代方案 */
function ImpactLeaf({
  impact,
  leafClass,
}: {
  impact: CausalImpactItem;
  leafClass: string;
}) {
  // 实体名优先用 entityName，回退到 chapterTitle
  const entityLabel = impact.entityName || impact.chapterTitle;
  return (
    <div className={`p-2 border rounded text-xs ${leafClass} ml-4`}>
      {entityLabel && (
        <div className="text-[10px] text-ink-300 mb-1 font-medium">「{entityLabel}」</div>
      )}
      <div className="text-ink-200 mb-1">{impact.description}</div>
      <div className="text-[11px] text-emerald-300/80">
        <span className="text-ink-500">替代：</span>{impact.alternative}
      </div>
    </div>
  );
}
