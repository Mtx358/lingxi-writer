/**
 * 因果推演 Tab：变动影响预览
 *
 * 由原 OutlinePolishPanel.tsx 中 CausalTab 函数原样搬迁而来。
 * 输入目标章节 + 假设性改动描述，调用 runCausalPreview 获取变动影响报告，
 * 展示综合风险等级 + 各类影响项（断裂 / 弱化 / 缺失）+ 替代方案。
 */
import { useState } from 'react';
import { ShieldAlert, AlertTriangle, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter } from '@/types';
import { Section } from './shared';

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
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className="input text-xs py-1.5 w-full"
          >
            {chapters.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          <textarea
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
          <div className="space-y-2">
            <div className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
              lastCausalImpact.overallRisk === 'high'
                ? 'bg-red-500/10 text-red-300'
                : lastCausalImpact.overallRisk === 'medium'
                ? 'bg-amber-500/10 text-amber-300'
                : 'bg-emerald-500/10 text-emerald-300'
            }`}>
              综合风险：
              {lastCausalImpact.overallRisk === 'high' ? '高' : lastCausalImpact.overallRisk === 'medium' ? '中' : '低'}
            </div>
            {lastCausalImpact.impacts.map((impact, i) => (
              <div
                key={i}
                className={`p-2.5 border rounded text-xs ${
                  impact.type === 'broken'
                    ? 'bg-red-500/5 border-red-500/30'
                    : impact.type === 'weakened'
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-blue-500/5 border-blue-500/30'
                }`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-[10px] px-1 py-0.5 rounded ${
                    impact.type === 'broken' ? 'bg-red-500/20 text-red-300' :
                    impact.type === 'weakened' ? 'bg-amber-500/20 text-amber-300' :
                    'bg-blue-500/20 text-blue-300'
                  }`}>
                    {impact.type === 'broken' ? '断裂' : impact.type === 'weakened' ? '弱化' : '缺失'}
                  </span>
                  {impact.chapterTitle && (
                    <span className="text-[10px] text-ink-500">「{impact.chapterTitle}」</span>
                  )}
                </div>
                <div className="text-ink-200 mb-1">{impact.description}</div>
                <div className="text-[11px] text-emerald-300/80">
                  <span className="text-ink-500">替代：</span>{impact.alternative}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
