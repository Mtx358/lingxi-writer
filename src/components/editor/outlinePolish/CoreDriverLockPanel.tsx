/**
 * 核心驱动锁定面板
 *
 * 对应规格书第二阶段"核心驱动锁定"。
 *
 * 两种状态：
 * 1. 已锁定（coreDriver 存在）：展示驱动类型徽章 + 核心描述 + 锁定时间/备注，
 *    提供"解锁重选"按钮（window.confirm 确认），并提示后续打磨以此核心为红线。
 * 2. 未锁定（coreDriver 为 null）：三选一卡片（人物/情节/主题驱动型），
 *    每张卡片配独立输入框，点击"锁定此方向"调用 lockCoreDriver。
 *
 * 与 SkeletonTab 的区别：SkeletonTab 是单个 Tab 内紧凑表单（含冲突罗盘 / 结构变体），
 * 本面板为独立功能域，UI 更接近规格书描述（彩色徽章 + 引用块 + 红线提示）。
 */
import { useState } from 'react';
import { Users, Swords, BookOpen, Lock, Unlock, Target, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { CoreDriver } from '@/types';
import { Section } from './shared';

type DriverType = CoreDriver['type'];

/** 驱动类型 → 中文标签 */
const TYPE_LABELS: Record<DriverType, string> = {
  character: '人物驱动型',
  plot: '情节驱动型',
  theme: '主题驱动型',
};

/** 驱动类型 → 徽章配色（已锁定状态用，规格书：蓝/红/紫） */
const TYPE_BADGE_STYLES: Record<DriverType, string> = {
  character: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  plot: 'bg-red-500/15 text-red-300 border border-red-500/30',
  theme: 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
};

/** 卡片规格：图标 / 描述 / 输入框占位 / 配色（卡片边框与按钮） */
const CARD_CONFIG: Record<
  DriverType,
  {
    icon: typeof Users;
    desc: string;
    placeholder: string;
    border: string;
    iconColor: string;
    button: string;
  }
> = {
  character: {
    icon: Users,
    desc: '主角核心弧光作为全书主线',
    placeholder: '弧光描述，如"从逃避过去到直面代价"',
    border: 'border-blue-500/40',
    iconColor: 'text-blue-300',
    button: 'bg-blue-500/10 text-blue-300 hover:bg-blue-500/20',
  },
  plot: {
    icon: Swords,
    desc: '核心冲突驱动情节推进',
    placeholder: '核心冲突描述，如"旧规则与新时代的对抗"',
    border: 'border-red-500/40',
    iconColor: 'text-red-300',
    button: 'bg-red-500/10 text-red-300 hover:bg-red-500/20',
  },
  theme: {
    icon: BookOpen,
    desc: '核心主题表达作为落点',
    placeholder: '核心主题，如"所有谎言最终都会反噬说谎者"',
    border: 'border-purple-500/40',
    iconColor: 'text-purple-300',
    button: 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20',
  },
};

const DRIVER_TYPES: DriverType[] = ['character', 'plot', 'theme'];

export function CoreDriverLockPanel() {
  const coreDriver = useAppStore(s => s.coreDriver);
  const lockCoreDriver = useAppStore(s => s.lockCoreDriver);
  const unlockCoreDriver = useAppStore(s => s.unlockCoreDriver);

  // 三张卡片各自独立受控输入：用户可能先填了人物卡再切到情节卡，
  // 草稿保留能减少来回切换的输入成本
  const [inputs, setInputs] = useState<Record<DriverType, string>>({
    character: '',
    plot: '',
    theme: '',
  });

  const handleLock = (type: DriverType) => {
    const description = inputs[type].trim();
    if (!description) return;
    lockCoreDriver({
      type,
      description,
      lockedAt: new Date().toISOString(),
    });
    // 锁定成功后清空所有草稿：避免下次解锁时残留旧输入
    setInputs({ character: '', plot: '', theme: '' });
  };

  const handleUnlock = () => {
    // 解锁会清空已生成的冲突罗盘（见 outlinePolishSlice.unlockCoreDriver），
    // 与其他破坏性操作一致地确认
    if (!window.confirm('解锁后已基于该核心生成的冲突罗盘将被清空，且需重新锁定核心驱动。是否继续？')) return;
    unlockCoreDriver();
  };

  if (coreDriver) {
    const time = new Date(coreDriver.lockedAt).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <Section
        icon={Target}
        title="核心驱动锁定"
        desc="锚定整部作品的打磨基准线"
      >
        <div className="space-y-2.5">
          <div className="p-3 bg-ink-800/30 rounded-lg border border-ink-700/40">
            {/* 大标题 */}
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-ink-200 font-medium flex items-center gap-1.5">
                <span aria-hidden="true">🎯</span>
                核心驱动已锁定
              </div>
              <button
                onClick={handleUnlock}
                className="text-[10px] text-ink-500 hover:text-ink-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-ink-700/40"
                aria-label="解锁重选核心驱动"
              >
                <Unlock className="w-2.5 h-2.5" />
                解锁重选
              </button>
            </div>

            {/* 驱动类型徽章 */}
            <div className="mb-2">
              <span
                className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${TYPE_BADGE_STYLES[coreDriver.type]}`}
              >
                {TYPE_LABELS[coreDriver.type]}
              </span>
            </div>

            {/* 核心描述：引用块样式 */}
            <blockquote className="border-l-2 border-amber-400/60 pl-2.5 py-1 mb-2">
              <p className="text-xs text-ink-200 leading-relaxed">{coreDriver.description}</p>
            </blockquote>

            {/* 锁定时间 + 备注 */}
            <div className="text-[10px] text-ink-500 flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" aria-hidden="true" />
              <span>锁定于 {time}</span>
            </div>
            {coreDriver.note && (
              <div className="text-[10px] text-ink-400 mt-1 pl-3.5">
                备注：{coreDriver.note}
              </div>
            )}
          </div>

          {/* 红线提示 */}
          <div className="flex items-start gap-1.5 p-2 bg-amber-400/5 border border-amber-500/20 rounded">
            <AlertTriangle className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-[11px] text-amber-300 leading-relaxed">
              后续所有大纲打磨都会以此核心为基准，偏离核心的支线会被标记。
            </p>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section
      icon={Target}
      title="锁定核心驱动，锚定整部作品的打磨基准线"
      desc="三选一：人物 / 情节 / 主题驱动"
    >
      <div className="space-y-3">
        <p className="text-[11px] text-ink-500 leading-relaxed">
          系统会从你的灵感池和项目设定中提炼方向，请确认你要作为全书主线的核心驱动。锁定后即为所有打磨的红线。
        </p>

        <div className="grid grid-cols-3 gap-3">
          {DRIVER_TYPES.map(type => {
            const cfg = CARD_CONFIG[type];
            const Icon = cfg.icon;
            const value = inputs[type];
            const canLock = value.trim().length > 0;
            return (
              <div
                key={type}
                className={`p-2.5 bg-ink-800/30 rounded-lg border ${cfg.border} flex flex-col`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-3.5 h-3.5 ${cfg.iconColor}`} aria-hidden="true" />
                  <span className="text-xs text-ink-200 font-medium">{TYPE_LABELS[type]}</span>
                </div>
                <p className="text-[10px] text-ink-500 mb-2 leading-relaxed">{cfg.desc}</p>
                <textarea
                  aria-label={`${TYPE_LABELS[type]}描述`}
                  value={value}
                  onChange={e => setInputs(prev => ({ ...prev, [type]: e.target.value }))}
                  placeholder={cfg.placeholder}
                  rows={3}
                  className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1.5 rounded border border-ink-700/50 placeholder-ink-600 resize-none min-h-[60px]"
                />
                <button
                  onClick={() => handleLock(type)}
                  disabled={!canLock}
                  className={`mt-2 w-full px-2 py-1 text-[11px] rounded flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${cfg.button}`}
                >
                  <Lock className="w-3 h-3" />
                  锁定此方向
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
