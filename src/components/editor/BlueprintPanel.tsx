/**
 * 灵犀蓝图 - 全局走向概览面板（灵犀助手 2.1-2.5）
 *
 * 覆盖方案：
 *   - 2.1 全局走向概览：主线 / 起点 / 转折节点 / 终点 / 成长弧线 / 人物命运 / 分卷概览
 *   - 2.2 AI 生成蓝图（基于核心设定卡 + 已有章节/角色）
 *   - 2.3 锁定 / 解锁：锁定后正文创作以此为基准
 *   - 2.4 手动编辑：解锁后可调整任意字段
 *   - 2.5 改动影响报告：解锁后修改前评估风险与受影响范围
 *
 * 锁定语义：blueprint.lockedAt 非空时，store 的 updateBlueprint 会被拦截；
 *           本面板在 UI 层同步禁用编辑控件（除"解锁"按钮外），并在顶部显示锁定提示条。
 */
import { useState, useRef, useEffect, useId, type ReactNode } from 'react';
import {
  Sparkles,
  Lock,
  Unlock,
  Loader2,
  Plus,
  X,
  AlertTriangle,
  TrendingUp,
  BookOpen,
  Users,
  Map,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { generateId } from '@/utils/storage';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { confirm } from '@/hooks/useConfirm';
import type { PlotTurnPoint, GrowthArcSegment, BlueprintChangeImpact } from '@/types';
import Empty from '@/components/Empty';
import Field from '@/components/Field';

// 改动影响风险等级配置：high=红 / medium=琥珀 / low=绿
const RISK_CONFIG: Record<BlueprintChangeImpact['riskLevel'], { label: string; color: string; bgColor: string }> = {
  high: { label: '高风险', color: 'text-red-400', bgColor: 'bg-red-500/15' },
  medium: { label: '中风险', color: 'text-amber-300', bgColor: 'bg-amber-400/15' },
  low: { label: '低风险', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' },
};

export default function BlueprintPanel() {
  // ===== store 订阅（严格使用方案规定的 selector）=====
  const blueprint = useAppStore(s => s.projects.find(p => p.id === s.currentProjectId)?.blueprint || null);
  const generateBlueprint = useAppStore(s => s.generateBlueprint);
  const updateBlueprint = useAppStore(s => s.updateBlueprint);
  const lockBlueprint = useAppStore(s => s.lockBlueprint);
  const unlockBlueprint = useAppStore(s => s.unlockBlueprint);
  const generateBlueprintImpact = useAppStore(s => s.generateBlueprintImpact);
  const clearBlueprintImpact = useAppStore(s => s.clearBlueprintImpact);
  const isBlueprintBusy = useAppStore(s => s.isBlueprintBusy);

  // ===== 本地 UI 状态 =====
  const [impactInputOpen, setImpactInputOpen] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const changeDescId = useId();
  // 卸载守卫：异步 AI 请求完成后避免向已卸载组件 setState
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const isLocked = !!blueprint?.lockedAt;

  // ===== 顶部行动处理 =====
  const handleGenerate = async () => {
    // 已存在未锁定的蓝图时，AI 重新生成会整体覆盖手动编辑，
    // 需二次确认（与 OutlinePanel 删除章节的 confirm 模式一致）
    if (blueprint && !isLocked) {
      if (!(await confirm('已有蓝图将被覆盖，确定要重新生成吗？'))) return;
    }
    // 包 try/catch：generateBlueprint 抛错时 store 不会复位 isBlueprintBusy，
    // 所有 disabled 按钮会永久禁用导致 UI 死锁，需在 catch 中提示失败
    try {
      await generateBlueprint();
    } catch (e) {
      toast.error('蓝图生成失败', getErrorMessage(e));
    }
  };

  const handleToggleLock = () => {
    if (isLocked) {
      unlockBlueprint();
    } else {
      lockBlueprint();
    }
  };

  const handleEvaluateImpact = async () => {
    const desc = changeDescription.trim();
    if (!desc) return;
    // 请求发起即清空输入，避免用户在等待期间重复点击或残留草稿
    setChangeDescription('');
    setImpactInputOpen(false);
    // 包 try/catch：generateBlueprintImpact 抛错时未复位 isBlueprintBusy，
    // 会导致评估相关按钮永久禁用；catch 中提示失败原因
    try {
      await generateBlueprintImpact(desc);
      if (!isMountedRef.current) return;
    } catch (e) {
      if (!isMountedRef.current) return;
      toast.error('改动影响评估失败', getErrorMessage(e));
    }
  };

  const handleCancelImpact = () => {
    setImpactInputOpen(false);
    setChangeDescription('');
  };

  // ===== 未生成蓝图：初始化提示卡片 =====
  if (!blueprint) {
    return (
      <Empty
        icon={<Sparkles className="w-10 h-10 text-amber-400" aria-hidden="true" />}
        title="还没有全局走向概览"
        description="基于核心设定卡与已有章节，由 AI 生成主线、转折节点、成长弧线、人物命运与分卷概览，作为正文创作的基准。"
        action={
          <button
            onClick={handleGenerate}
            disabled={isBlueprintBusy}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {isBlueprintBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            )}
            AI 生成蓝图
          </button>
        }
        className="p-6 gap-4 h-auto justify-start"
      />
    );
  }

  // ===== 转折节点编辑 =====
  const handleAddTurnPoint = () => {
    // 为新节点生成本地稳定 id，用作 React key，避免 idx key 在删除中间项时复用 DOM 导致输入焦点错乱
    const newPoint: PlotTurnPoint = { id: generateId(), progress: 50, title: '', description: '' };
    updateBlueprint({ turnPoints: [...blueprint.turnPoints, newPoint] });
  };
  const handleUpdateTurnPoint = (idx: number, patch: Partial<PlotTurnPoint>) => {
    updateBlueprint({
      turnPoints: blueprint.turnPoints.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });
  };
  const handleRemoveTurnPoint = (idx: number) => {
    updateBlueprint({ turnPoints: blueprint.turnPoints.filter((_, i) => i !== idx) });
  };

  // ===== 成长弧线编辑 =====
  const handleUpdateGrowthArc = (idx: number, patch: Partial<GrowthArcSegment>) => {
    updateBlueprint({
      growthArc: blueprint.growthArc.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    });
  };

  return (
    <div className="p-4 space-y-5 text-sm bg-ink-900/50 text-ink-200">
      {/* ============ 顶部行动区 ============ */}
      <div className="flex items-center gap-2 pb-3 border-b border-ink-700/50 flex-wrap">
        <Sparkles className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <h2 className="font-medium text-ink-100 flex-1 min-w-[8rem]">全局走向概览</h2>

        {/* 锁定状态徽章 */}
        {isLocked && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/15 text-emerald-300 rounded text-xs">
            <Lock className="w-3 h-3" aria-hidden="true" />
            已锁定
          </span>
        )}

        {/* AI 生成蓝图（锁定时禁用并显示锁图标） */}
        <button
          onClick={handleGenerate}
          disabled={isBlueprintBusy || isLocked}
          className="btn btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
          aria-label="AI 生成蓝图"
          title={isLocked ? '蓝图已锁定，请先解锁' : 'AI 生成蓝图'}
        >
          {isBlueprintBusy ? (
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          ) : isLocked ? (
            <Lock className="w-3 h-3" aria-hidden="true" />
          ) : (
            <Sparkles className="w-3 h-3" aria-hidden="true" />
          )}
          AI 生成蓝图
        </button>

        {/* 锁定 / 解锁 */}
        <button
          onClick={handleToggleLock}
          disabled={isBlueprintBusy}
          className="btn btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
          aria-label={isLocked ? '解锁蓝图' : '锁定蓝图'}
        >
          {isLocked ? (
            <Unlock className="w-3 h-3" aria-hidden="true" />
          ) : (
            <Lock className="w-3 h-3" aria-hidden="true" />
          )}
          {isLocked ? '解锁蓝图' : '锁定蓝图'}
        </button>

        {/* 评估改动影响（仅解锁态可见） */}
        {!isLocked && (
          <button
            onClick={() => setImpactInputOpen(o => !o)}
            disabled={isBlueprintBusy}
            className="btn btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
            aria-label="评估改动影响"
          >
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            评估改动影响
          </button>
        )}
      </div>

      {/* ============ 锁定提示条 ============ */}
      {isLocked && (
        <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-md text-xs text-emerald-200">
          <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>蓝图已锁定，正文创作将基于此蓝图。修改前请先解锁并评估改动影响。</span>
        </div>
      )}

      {/* ============ 评估改动影响输入区 ============ */}
      {impactInputOpen && !isLocked && (
        <div className="p-3 bg-ink-800/50 border border-ink-700/50 rounded-md space-y-2">
          <label htmlFor={changeDescId} className="block text-[11px] text-ink-400">改动描述</label>
          <textarea
            id={changeDescId}
            value={changeDescription}
            onChange={e => setChangeDescription(e.target.value)}
            placeholder="如：把第二卷的反派从 A 改为 B"
            rows={3}
            className="input-field resize-none"
            disabled={isBlueprintBusy}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancelImpact}
              disabled={isBlueprintBusy}
              className="btn btn-secondary text-xs disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleEvaluateImpact}
              disabled={isBlueprintBusy || !changeDescription.trim()}
              className="btn btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
              aria-label="提交评估"
            >
              {isBlueprintBusy ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              )}
              提交评估
            </button>
          </div>
        </div>
      )}

      {/* ============ 主体内容 ============ */}

      {/* 1. 主线 */}
      <section className="space-y-2">
        <SectionHeader icon={<Map className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />} title="主线" />
        <textarea
          value={blueprint.mainline}
          onChange={e => updateBlueprint({ mainline: e.target.value })}
          placeholder="一句话概括全书主线"
          rows={2}
          className="input-field resize-none"
          readOnly={isLocked}
        />
      </section>

      {/* 2. 起点 */}
      <section className="space-y-2">
        <SectionHeader icon={<Map className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />} title="起点" />
        <textarea
          value={blueprint.startPoint}
          onChange={e => updateBlueprint({ startPoint: e.target.value })}
          placeholder="故事开场时主角的状态与世界状态"
          rows={2}
          className="input-field resize-none"
          readOnly={isLocked}
        />
      </section>

      {/* 3. 核心冲突演变（转折节点） */}
      <section className="space-y-2">
        <SectionHeader
          icon={<TrendingUp className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
          title="核心冲突演变（转折节点）"
          action={
            <button
              onClick={handleAddTurnPoint}
              disabled={isLocked}
              className="btn btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
              aria-label="添加转折点"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              添加转折点
            </button>
          }
        />
        {blueprint.turnPoints.length === 0 ? (
          <Empty title="暂无转折节点，点击右上角添加。" className="text-xs text-ink-500 italic" />
        ) : (
          <div className="space-y-2">
            {blueprint.turnPoints.map((tp, idx) => (
              <div
                key={tp.id || `tp-${idx}`}
                className="p-3 bg-ink-800/40 border border-ink-700/50 rounded-md space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tp.progress}
                    onChange={e =>
                      handleUpdateTurnPoint(idx, {
                        progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="input-field w-16 text-xs"
                    readOnly={isLocked}
                    aria-label={`转折点 ${idx + 1} 进度百分比`}
                  />
                  <span className="text-xs text-ink-400">%</span>
                  <input
                    type="text"
                    value={tp.title}
                    onChange={e => handleUpdateTurnPoint(idx, { title: e.target.value })}
                    placeholder="转折标题"
                    className="input-field flex-1 text-xs"
                    readOnly={isLocked}
                    aria-label={`转折点 ${idx + 1} 标题`}
                  />
                  <button
                    onClick={() => handleRemoveTurnPoint(idx)}
                    disabled={isLocked}
                    className="p-1 rounded text-ink-500 hover:text-red-400 hover:bg-ink-700/50 transition-colors disabled:opacity-30"
                    aria-label={`删除转折点 ${idx + 1}`}
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <textarea
                  value={tp.description}
                  onChange={e => handleUpdateTurnPoint(idx, { description: e.target.value })}
                  placeholder="转折描述"
                  rows={2}
                  className="input-field resize-none text-xs"
                  readOnly={isLocked}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 终点 */}
      <section className="space-y-2">
        <SectionHeader icon={<Map className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />} title="终点" />
        <textarea
          value={blueprint.endPoint}
          onChange={e => updateBlueprint({ endPoint: e.target.value })}
          placeholder="故事结局时主角与世界状态"
          rows={2}
          className="input-field resize-none"
          readOnly={isLocked}
        />
      </section>

      {/* 5. 主角成长弧线 */}
      <section className="space-y-2">
        <SectionHeader
          icon={<TrendingUp className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
          title="主角成长弧线"
        />
        {blueprint.growthArc.length === 0 ? (
          <Empty title="暂无成长弧线段。" className="text-xs text-ink-500 italic" />
        ) : (
          <div className="space-y-2">
            {blueprint.growthArc.map((seg, idx) => (
              <div
                key={seg.id || `ga-${idx}`}
                className="p-3 bg-ink-800/40 border border-ink-700/50 rounded-md space-y-2"
              >
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <span>第</span>
                  <input
                    type="number"
                    min={1}
                    value={seg.volumeIndex}
                    onChange={e =>
                      handleUpdateGrowthArc(idx, { volumeIndex: Math.max(1, Number(e.target.value) || 1) })
                    }
                    className="input-field w-16 text-xs"
                    readOnly={isLocked}
                    aria-label={`成长弧线段 ${idx + 1} 卷号`}
                  />
                  <span>卷</span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <Field label="起始状态">
                    <input
                      type="text"
                      value={seg.fromState}
                      onChange={e => handleUpdateGrowthArc(idx, { fromState: e.target.value })}
                      placeholder="如：自卑、懦弱"
                      className="input-field text-xs"
                      readOnly={isLocked}
                    />
                  </Field>
                  <Field label="经历">
                    <textarea
                      value={seg.experiences}
                      onChange={e => handleUpdateGrowthArc(idx, { experiences: e.target.value })}
                      placeholder="该卷关键经历"
                      rows={2}
                      className="input-field resize-none text-xs"
                      readOnly={isLocked}
                    />
                  </Field>
                  <Field label="结束状态">
                    <input
                      type="text"
                      value={seg.toState}
                      onChange={e => handleUpdateGrowthArc(idx, { toState: e.target.value })}
                      placeholder="如：自信、果决"
                      className="input-field text-xs"
                      readOnly={isLocked}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. 主要人物命运线（显示） */}
      <section className="space-y-2">
        <SectionHeader
          icon={<Users className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
          title="主要人物命运线"
        />
        {blueprint.characterFates.length === 0 ? (
          <Empty title="暂无人物命运线。" className="text-xs text-ink-500 italic" />
        ) : (
          <div className="space-y-2">
            {blueprint.characterFates.map((fate, idx) => (
              <div
                key={idx}
                className="p-3 bg-ink-800/40 border border-ink-700/50 rounded-md space-y-1"
              >
                <div className="text-sm text-amber-300 font-medium">{fate.characterName || '未命名角色'}</div>
                <div className="text-xs text-ink-300">
                  <span className="text-ink-500">关键节点：</span>
                  {fate.keyNodes || '—'}
                </div>
                {fate.ending && (
                  <div className="text-xs text-ink-300">
                    <span className="text-ink-500">结局：</span>
                    {fate.ending}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 7. 分卷概览（显示） */}
      <section className="space-y-2">
        <SectionHeader
          icon={<BookOpen className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
          title="分卷概览"
        />
        {blueprint.volumes.length === 0 ? (
          <Empty title="暂无分卷概览。" className="text-xs text-ink-500 italic" />
        ) : (
          <div className="space-y-2">
            {blueprint.volumes.map(vol => (
              <div
                key={vol.index}
                className="p-3 bg-ink-800/40 border border-ink-700/50 rounded-md space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center px-2 py-0.5 bg-amber-400/15 text-amber-300 rounded text-xs font-medium">
                    第 {vol.index} 卷
                  </span>
                  <span className="text-sm text-ink-100 font-medium">{vol.title || '未命名'}</span>
                  {vol.chapterRange && (
                    <span className="text-xs text-ink-500">· {vol.chapterRange}</span>
                  )}
                </div>
                <div className="text-xs text-ink-300">
                  <span className="text-ink-500">核心任务：</span>
                  {vol.coreTask || '—'}
                </div>
                {vol.endingHook && (
                  <div className="text-xs text-ink-300">
                    <span className="text-ink-500">结尾钩子：</span>
                    {vol.endingHook}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ 改动影响报告区 ============ */}
      {blueprint.lastChangeImpact && (
        <ChangeImpactReport impact={blueprint.lastChangeImpact} onClear={clearBlueprintImpact} />
      )}
    </div>
  );
}

// ============ 子组件 ============

/** 区块标题：图标 + 标题 + 可选右侧操作 */
function SectionHeader({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-xs uppercase tracking-wider text-ink-400">{title}</h3>
      </div>
      {action}
    </div>
  );
}

/** 改动影响报告卡片 */
function ChangeImpactReport({
  impact,
  onClear,
}: {
  impact: BlueprintChangeImpact;
  onClear: () => void;
}) {
  const risk = RISK_CONFIG[impact.riskLevel];
  return (
    <section className="p-3 bg-ink-800/50 border border-amber-400/30 rounded-md space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" />
          <h3 className="text-sm font-medium text-ink-100">改动影响报告</h3>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${risk.color} ${risk.bgColor}`}>
            {risk.label}
          </span>
        </div>
        <button
          onClick={onClear}
          className="btn btn-secondary text-xs"
          aria-label="清除报告"
        >
          清除报告
        </button>
      </div>
      <div className="text-xs text-ink-300 space-y-2">
        <p>
          <span className="text-ink-500">改动描述：</span>
          {impact.changeDescription}
        </p>
        <p>
          <span className="text-ink-500">建议：</span>
          {impact.suggestion}
        </p>
        {impact.affectedVolumes.length > 0 && (
          <p>
            <span className="text-ink-500">受影响卷：</span>
            {impact.affectedVolumes.map(v => `第 ${v} 卷`).join('、')}
          </p>
        )}
        {impact.affectedChapters.length > 0 && (
          <p>
            <span className="text-ink-500">受影响章节：</span>
            {impact.affectedChapters.join('、')}
          </p>
        )}
        {impact.affectedForeshadows.length > 0 && (
          <p>
            <span className="text-ink-500">受影响伏笔：</span>
            {impact.affectedForeshadows.join('、')}
          </p>
        )}
      </div>
    </section>
  );
}
