/**
 * 骨架 Tab：核心驱动锁定 + 冲突罗盘 + 结构变体预览
 *
 * 由原 OutlinePolishPanel.tsx 中 SkeletonTab 函数原样搬迁而来。
 * 自管理 draftType/draftDesc/conflictBusy/variantsBusy 等本地状态，
 * 通过 useAppStore 直接读写 coreDriver / conflictCompass / structureVariants。
 */
import { useState } from 'react';
import { Target, Compass, GitBranch, Loader2, Lock, Unlock } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { confirm } from '@/hooks/useConfirm';
import type { CoreDriver } from '@/types';
import { Section } from './shared';
import { DRIVER_TYPE_LABELS, CONFLICT_LAYER_LABELS } from './constants';

export function SkeletonTab() {
  const coreDriver = useAppStore(s => s.coreDriver);
  const conflictCompass = useAppStore(s => s.conflictCompass);
  const structureVariants = useAppStore(s => s.structureVariants);
  const lockCoreDriver = useAppStore(s => s.lockCoreDriver);
  const unlockCoreDriver = useAppStore(s => s.unlockCoreDriver);
  const fetchConflictCompass = useAppStore(s => s.fetchConflictCompass);
  const fetchStructureVariants = useAppStore(s => s.fetchStructureVariants);

  const [draftType, setDraftType] = useState<CoreDriver['type']>('character');
  const [draftDesc, setDraftDesc] = useState('');
  // 独立跟踪两类请求的 loading：原先用单值 busy，并发触发时后触发的会覆盖前者的状态，
  // 前者 finally 中 setBusy(null) 又会清掉后者的 loading，UI 显示错乱
  const [conflictBusy, setConflictBusy] = useState(false);
  const [variantsBusy, setVariantsBusy] = useState(false);

  const handleLock = () => {
    if (!draftDesc.trim()) return;
    lockCoreDriver({
      type: draftType,
      description: draftDesc.trim(),
      lockedAt: new Date().toISOString(),
    });
  };

  const handleFetchConflict = async () => {
    setConflictBusy(true);
    try {
      await fetchConflictCompass();
    } finally {
      setConflictBusy(false);
    }
  };

  const handleFetchVariants = async () => {
    setVariantsBusy(true);
    try {
      await fetchStructureVariants();
    } finally {
      setVariantsBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 核心驱动锁定 */}
      <Section icon={Target} title="核心驱动锁定" desc="锚定整部作品的打磨基准线">
        {coreDriver ? (
          <div className="space-y-2">
            <div className="p-3 bg-amber-400/5 border border-amber-500/30 rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-amber-300 bg-amber-400/20 px-1.5 py-0.5 rounded">
                  {DRIVER_TYPE_LABELS[coreDriver.type]}
                </span>
                <button
                  onClick={async () => {
                    // 解锁会清空已生成的冲突罗盘，与其他删除操作一致地确认
                    if (conflictCompass.length > 0 && !(await confirm('解锁后已生成的冲突罗盘将被清空，确定吗？'))) return;
                    unlockCoreDriver();
                  }}
                  className="text-[10px] text-ink-500 hover:text-ink-300 flex items-center gap-0.5"
                >
                  <Unlock className="w-2.5 h-2.5" /> 解锁重选
                </button>
              </div>
              <div className="text-xs text-ink-200">{coreDriver.description}</div>
              <div className="text-[10px] text-ink-500 mt-1">
                锁定于 {new Date(coreDriver.lockedAt).toLocaleString()}
              </div>
            </div>
            <button
              onClick={handleFetchConflict}
              disabled={conflictBusy}
              className="w-full px-3 py-1.5 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {conflictBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Compass className="w-3 h-3" />}
              {conflictCompass.length > 0 ? '重新生成冲突罗盘' : '生成冲突罗盘'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1">
              {(['character', 'plot', 'theme'] as CoreDriver['type'][]).map(t => (
                <button
                  key={t}
                  onClick={() => setDraftType(t)}
                  className={`flex-1 px-2 py-1 text-[11px] rounded transition-colors ${
                    draftType === t
                      ? 'bg-amber-400/20 text-amber-300'
                      : 'bg-ink-800/50 text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {DRIVER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <textarea
              value={draftDesc}
              onChange={e => setDraftDesc(e.target.value)}
              placeholder={
                draftType === 'character'
                  ? '例：主角核心弧光从"逃避过去"到"直面代价"'
                  : draftType === 'plot'
                  ? '例：核心冲突是"旧规则与新时代的对抗"'
                  : '例：核心表达"所有谎言最终都会反噬说谎者"'
              }
              rows={3}
              className="input text-xs py-1.5 w-full resize-none"
            />
            <button
              onClick={handleLock}
              disabled={!draftDesc.trim()}
              className="w-full px-3 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Lock className="w-3 h-3" />
              锁定核心驱动
            </button>
          </div>
        )}
      </Section>

      {/* 冲突罗盘 */}
      {conflictCompass.length > 0 && (
        <Section icon={Compass} title="冲突罗盘" desc="4 层冲突体系，全书情节的发动机">
          <div className="space-y-2">
            {conflictCompass.map(layer => (
              <div key={layer.layer} className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded">
                <div className="text-[11px] text-purple-300 font-medium mb-1">
                  {CONFLICT_LAYER_LABELS[layer.layer]}
                </div>
                <div className="text-xs text-ink-200 mb-1.5">{layer.description}</div>
                {layer.seeds.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-ink-500">情节种子：</div>
                    {layer.seeds.map((seed, i) => (
                      <div key={i} className="text-[11px] text-ink-400 pl-2 border-l border-ink-700">
                        {seed}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 结构变体 */}
      <Section icon={GitBranch} title="结构变体预览" desc="3 套叙事结构方案，选好了再往下搭">
        {structureVariants.length === 0 ? (
          <button
            onClick={handleFetchVariants}
            disabled={variantsBusy}
            className="w-full px-3 py-1.5 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {variantsBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
            生成 3 套结构变体
          </button>
        ) : (
          <div className="space-y-2">
            {structureVariants.map(v => (
              <div key={v.id} className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-blue-300 font-medium">{v.name}</div>
                  <div className="text-[9px] text-ink-500">{v.suggestedHierarchy.join(' / ')}</div>
                </div>
                <div className="text-[11px] text-ink-300 mb-1.5">{v.description}</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="text-emerald-300">
                    <span className="text-ink-500">优势：</span>{v.pros}
                  </div>
                  <div className="text-amber-300">
                    <span className="text-ink-500">风险：</span>{v.cons}
                  </div>
                </div>
                <div className="text-[10px] text-cyan-300 mt-1">
                  <span className="text-ink-500">适配：</span>{v.fitScenarios}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
