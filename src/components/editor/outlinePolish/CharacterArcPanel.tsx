/**
 * 角色 Tab：角色弧光分析
 *
 * 由原 OutlinePolishPanel.tsx 中 CharactersTab / CharacterArcCard 两个内部组件
 * 原样搬迁而来。按风险等级排序展示角色弧光卡片，支持展开查看弧光缺口 + 出场章节。
 */
import { useState, useMemo } from 'react';
import { Users, ChevronRight, ChevronDown, CheckCircle } from 'lucide-react';
import type { OutlinePolishReport, CharacterArcAnalysis } from '@/types';
import { CHARACTER_ROLE_LABELS } from '@/types';

export function CharacterArcPanel({
  report,
  onJumpTo,
}: {
  report: OutlinePolishReport | null;
  onJumpTo: (chapterId: string | null) => void;
}) {
  // useMemo 收敛按风险排序，避免每次 render 重算 sort。
  // 必须在 early return 之前调用（Rules of Hooks）；riskOrder 移入回调避免每渲染新建对象
  const sorted = useMemo(() => {
    if (!report) return [];
    const riskOrder: Record<CharacterArcAnalysis['risk'], number> = { high: 0, medium: 1, low: 2, ok: 3 };
    return [...report.characterArcs].sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
  }, [report]);

  if (!report || report.characterArcs.length === 0) {
    return (
      <div className="text-center py-8">
        <Users className="w-10 h-10 text-ink-600 mx-auto mb-2" />
        <p className="text-sm text-ink-500">点击"全面分析"</p>
        <p className="text-xs text-ink-600">查看角色弧光分析</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="p-2 bg-ink-800/30 rounded text-[11px] text-ink-400">
        共 {report.characterArcs.length} 位角色，按风险等级排序
      </div>
      {sorted.map(arc => (
        <CharacterArcCard key={arc.characterId} arc={arc} onJumpTo={onJumpTo} />
      ))}
    </div>
  );
}

function CharacterArcCard({
  arc,
  onJumpTo,
}: {
  arc: CharacterArcAnalysis;
  onJumpTo: (chapterId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const riskColor = arc.risk === 'high'
    ? 'border-red-500/40 bg-red-500/5'
    : arc.risk === 'medium'
    ? 'border-amber-500/40 bg-amber-500/5'
    : arc.risk === 'low'
    ? 'border-blue-500/40 bg-blue-500/5'
    : 'border-emerald-500/40 bg-emerald-500/5';
  const riskText = arc.risk === 'high'
    ? 'text-red-300'
    : arc.risk === 'medium'
    ? 'text-amber-300'
    : arc.risk === 'low'
    ? 'text-blue-300'
    : 'text-emerald-300';
  const riskLabel = { high: '高风险', medium: '中等', low: '低风险', ok: '健康' }[arc.risk];

  return (
    <div className={`p-3 rounded-lg border ${riskColor}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`character-arc-${arc.characterId}-detail`}
        aria-label={`${expanded ? '折叠' : '展开'}${arc.characterName}人物弧光详情`}
        className="w-full flex items-center gap-2 text-left"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500" aria-hidden="true" />}
        <span className="text-sm text-ink-100 flex-1 truncate">{arc.characterName}</span>
        <span className="text-[10px] text-ink-400">{CHARACTER_ROLE_LABELS[arc.role]}</span>
        <span className={`text-[10px] px-1.5 py-px rounded ${riskText} bg-ink-800/50`}>{riskLabel}</span>
      </button>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-ink-800/40 rounded p-1.5">
          <div className="text-ink-500 text-[10px]">出场章节数</div>
          <div className="text-ink-100 font-medium">{arc.appearanceCount}</div>
        </div>
        <div className="bg-ink-800/40 rounded p-1.5">
          <div className="text-ink-500 text-[10px]">末尾连续缺席</div>
          <div className={`font-medium ${arc.consecutiveAbsence > 3 ? 'text-amber-300' : 'text-ink-100'}`}>
            {arc.consecutiveAbsence} 章
          </div>
        </div>
      </div>

      {arc.riskDescription && (
        <div className="mt-2 text-[11px] text-ink-400 leading-relaxed">
          {arc.riskDescription}
        </div>
      )}

      {expanded && (
        <div id={`character-arc-${arc.characterId}-detail`} className="mt-2 pt-2 border-t border-ink-700/50 space-y-2">
          {arc.arcGaps.length > 0 ? (
            <>
              <div className="text-[10px] text-ink-500">弧光缺口</div>
              <ul className="text-[11px] text-ink-300 space-y-1 list-disc list-inside">
                {arc.arcGaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </>
          ) : (
            <div className="text-[11px] text-emerald-300 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> 未检测到弧光缺口
            </div>
          )}

          {arc.appearanceChapters.length > 0 && (
            <div>
              <div className="text-[10px] text-ink-500 mb-1">出场章节</div>
              <div className="flex flex-wrap gap-1">
                {arc.appearanceChapters.slice(0, 12).map(cid => (
                  <button
                    key={cid}
                    onClick={() => onJumpTo(cid)}
                    className="text-[9px] px-1.5 py-px bg-ink-700/50 text-ink-300 hover:bg-amber-400/20 hover:text-amber-200 rounded"
                  >
                    {cid.slice(0, 6)}
                  </button>
                ))}
                {arc.appearanceChapters.length > 12 && (
                  <span className="text-[9px] text-ink-500 px-1">+{arc.appearanceChapters.length - 12}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
