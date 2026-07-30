/**
 * 人物弧光校验面板（规格书第四阶段）
 *
 * 调用 runCharacterArcCheck 检测人物弧光问题（性格突变 / 能力越界 / 关系跳转），
 * 按角色分组展示；并支持选择两位角色调用 analyzeRelationship 生成关系温度
 * 曲线（SVG polyline + 三色温度带）。无图表库依赖。
 *
 * 扩展（阶段4-3 + 4-5）：
 *   - 人物弧光三维追踪 ArcCurveView：从 lastArcCurves 读取情绪/能力/认知三条演进曲线，
 *     异常点红色 circle 标注，点击展开 dimension + reason + remedy。
 *   - 角色维度情感一致性 CharacterEmotionConsistencyView：调用 runCharacterEmotionConsistencyCheck
 *     检测相邻章节情绪跳转，标记突兀节点并建议插入过渡段落。
 *
 * 数据来源：outlinePolishSlice.lastArcIssues / lastRelationshipCurve / lastArcCurves /
 *           lastCharacterEmotionReport。
 */
import { useState } from 'react';
import { ShieldAlert, RefreshCw, Thermometer, AlertCircle, AlertTriangle, Lightbulb, Activity, HeartPulse } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type {
  CharacterArcIssue,
  RelationshipTemperatureCurve,
  CharacterArcCurve,
  CharacterArcCurvePoint,
  CharacterEmotionConsistencyReport,
} from '@/types';
import { Section, EmptyHint } from './shared';

const ARC_ISSUE_TYPE_LABELS: Record<CharacterArcIssue['type'], string> = {
  'personality-break': '性格突变',
  'ability-exceed': '能力越界',
  'relationship-jump': '关系跳转',
  'emotion-jump': '情绪跳转',
};

const ARC_ISSUE_TYPE_COLORS: Record<CharacterArcIssue['type'], string> = {
  'personality-break': 'text-red-300 bg-red-400/10 border-red-500/30',
  'ability-exceed': 'text-amber-300 bg-amber-400/10 border-amber-500/30',
  'relationship-jump': 'text-purple-300 bg-purple-400/10 border-purple-500/30',
  'emotion-jump': 'text-pink-300 bg-pink-400/10 border-pink-500/30',
};

// SVG 温度曲线坐标系
const SVG_W = 300;
const SVG_H = 120;

// SVG 三维弧光曲线坐标系（情绪/能力/认知三条线共用）
const ARC_SVG_W = 300;
const ARC_SVG_H = 140;

// 三维弧光曲线维度配置：颜色严格按规格书 emotion=#f87171 / ability=#60a5fa / cognition=#c084fc
const ARC_DIMENSIONS: Array<{ key: keyof Pick<CharacterArcCurvePoint, 'emotion' | 'ability' | 'cognition'>; label: string; color: string }> = [
  { key: 'emotion', label: '情绪', color: '#f87171' },
  { key: 'ability', label: '能力', color: '#60a5fa' },
  { key: 'cognition', label: '认知', color: '#c084fc' },
];

export function CharacterArcCheckPanel() {
  const arcIssues = useAppStore(s => s.lastArcIssues);
  const relationshipCurve = useAppStore(s => s.lastRelationshipCurve);
  const arcCurves = useAppStore(s => s.lastArcCurves);
  const emotionReport = useAppStore(s => s.lastCharacterEmotionReport);
  const runCharacterArcCheck = useAppStore(s => s.runCharacterArcCheck);
  const runCharacterEmotionConsistencyCheck = useAppStore(s => s.runCharacterEmotionConsistencyCheck);
  const analyzeRelationship = useAppStore(s => s.analyzeRelationship);
  const characters = useAppStore(s => s.characters);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);

  const [isRunningArc, setIsRunningArc] = useState(false);
  const [isAnalyzingRel, setIsAnalyzingRel] = useState(false);
  const [isRunningEmotion, setIsRunningEmotion] = useState(false);
  const [hasRunArc, setHasRunArc] = useState(false);
  const [charAId, setCharAId] = useState('');
  const [charBId, setCharBId] = useState('');

  const charName = (id: string) => characters.find(c => c.id === id)?.name ?? id.slice(0, 6);
  const groupedIssues = groupIssuesByCharacter(arcIssues);

  const handleRunArc = async () => {
    setIsRunningArc(true);
    try {
      await runCharacterArcCheck();
      setHasRunArc(true);
    } finally {
      setIsRunningArc(false);
    }
  };

  const handleAnalyzeRel = async () => {
    if (!charAId || !charBId || charAId === charBId) return;
    setIsAnalyzingRel(true);
    try {
      await analyzeRelationship(charAId, charBId);
    } finally {
      setIsAnalyzingRel(false);
    }
  };

  const handleRunEmotion = async () => {
    setIsRunningEmotion(true);
    try {
      await runCharacterEmotionConsistencyCheck();
    } finally {
      setIsRunningEmotion(false);
    }
  };

  const canAnalyze = !!charAId && !!charBId && charAId !== charBId && !isAnalyzingRel;
  const showEmpty = !hasRunArc && arcIssues.length === 0 && !relationshipCurve;

  return (
    <div className="space-y-3">
      {/* 弧光校验操作栏 */}
      <div className="p-2 bg-ink-800/30 rounded-lg flex items-center gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        <span className="text-xs text-ink-300">人物弧光校验</span>
        <button
          onClick={handleRunArc}
          disabled={isRunningArc}
          className="ml-auto px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {isRunningArc ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}
          {isRunningArc ? '校验中' : '运行弧光校验'}
        </button>
      </div>

      {/* 关系温度计子区 */}
      <div className="p-2 bg-ink-800/30 rounded-lg space-y-2">
        <div className="flex items-center gap-1.5">
          <Thermometer className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="text-xs text-ink-300">关系温度计</span>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            aria-label="角色A"
            value={charAId}
            onChange={e => setCharAId(e.target.value)}
            className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
          >
            <option value="">选择角色A</option>
            {characters.filter(c => c.id !== charBId).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="text-ink-500 text-xs flex-shrink-0">↔</span>
          <select
            aria-label="角色B"
            value={charBId}
            onChange={e => setCharBId(e.target.value)}
            className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
          >
            <option value="">选择角色B</option>
            {characters.filter(c => c.id !== charAId).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleAnalyzeRel}
            disabled={!canAnalyze}
            className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
          >
            {isAnalyzingRel ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Thermometer className="w-3 h-3" />}
            分析关系
          </button>
        </div>
      </div>

      {/* 人物弧光三维追踪（阶段4-3） */}
      <ArcCurveView curves={arcCurves} charName={charName} onJump={setCurrentChapter} />

      {/* 角色维度情感一致性（阶段4-5） */}
      <CharacterEmotionConsistencyView
        report={emotionReport}
        isRunning={isRunningEmotion}
        onRun={handleRunEmotion}
        onJump={setCurrentChapter}
      />

      {showEmpty ? (
        <div className="text-center py-8">
          <ShieldAlert className="w-10 h-10 text-ink-600 mx-auto mb-2" />
          <p className="text-sm text-ink-500">点击上方按钮运行全本弧光校验</p>
          <p className="text-xs text-ink-600">或选择两个角色分析关系温度曲线。</p>
        </div>
      ) : (
        <>
          {/* 弧光问题列表 */}
          {arcIssues.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs text-ink-300 font-medium">弧光问题（{arcIssues.length}）</div>
              {Object.entries(groupedIssues).map(([cid, issues]) => (
                <div key={cid} className="space-y-2">
                  <div className="text-[11px] text-amber-300 font-medium flex items-center gap-1">
                    <span className="w-1 h-1 bg-amber-400 rounded-full" />
                    {issues[0].characterName || charName(cid)}
                  </div>
                  {issues.map(issue => (
                    <ArcIssueCard
                      key={issue.id}
                      issue={issue}
                      onJump={() => issue.chapterId && setCurrentChapter(issue.chapterId)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : hasRunArc ? (
            <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" /> 未检测到弧光问题
            </div>
          ) : null}

          {/* 关系温度曲线 */}
          {relationshipCurve && (
            <RelationshipCurveView
              curve={relationshipCurve}
              charName={charName}
              onJump={setCurrentChapter}
            />
          )}
        </>
      )}
    </div>
  );
}

function groupIssuesByCharacter(issues: CharacterArcIssue[]): Record<string, CharacterArcIssue[]> {
  const map: Record<string, CharacterArcIssue[]> = {};
  for (const i of issues) {
    if (!map[i.characterId]) map[i.characterId] = [];
    map[i.characterId].push(i);
  }
  return map;
}

function ArcIssueCard({ issue, onJump }: { issue: CharacterArcIssue; onJump: () => void }) {
  const sevIcon = issue.severity === 'error'
    ? <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
    : <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />;
  const sevBorder = issue.severity === 'error'
    ? 'border-red-500/30 bg-red-500/5'
    : 'border-amber-500/30 bg-amber-500/5';
  return (
    <div className={`p-3 rounded-lg border ${sevBorder}`}>
      <div className="flex items-start gap-2">
        {sevIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`px-1.5 py-px text-[9px] rounded border ${ARC_ISSUE_TYPE_COLORS[issue.type]}`}>
              {ARC_ISSUE_TYPE_LABELS[issue.type]}
            </span>
            <span className={`px-1 py-px text-[9px] rounded ${issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
              {issue.severity === 'error' ? '严重' : '警告'}
            </span>
            {issue.chapterTitle && (
              <button
                onClick={onJump}
                className="text-[10px] text-ink-300 hover:text-amber-300 underline truncate max-w-[140px]"
                title="跳转到该章节"
              >
                [{issue.chapterTitle}]
              </button>
            )}
          </div>
          <div className="text-xs text-ink-100 mb-1.5 leading-relaxed">{issue.description}</div>
          <div className="text-[11px] text-emerald-300 flex items-start gap-1 leading-relaxed">
            <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>{issue.suggestion}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RelationshipCurveView({
  curve,
  charName,
  onJump,
}: {
  curve: RelationshipTemperatureCurve;
  charName: (id: string) => string;
  onJump: (id: string) => void;
}) {
  const aName = charName(curve.characterAId);
  const bName = charName(curve.characterBId);
  const points = curve.points;
  const n = points.length;

  const padL = 6;
  const padR = 6;
  const innerW = SVG_W - padL - padR;
  const xFor = (i: number) => (n > 1 ? padL + (i / (n - 1)) * innerW : SVG_W / 2);
  const yFor = (t: number) => SVG_H - (Math.min(Math.max(t, 0), 100) / 100) * SVG_H;

  const polyline = points.map((p, i) => `${xFor(i)},${yFor(p.temperature)}`).join(' ');

  const prevTitle = (chapterId: string) => {
    const idx = points.findIndex(p => p.chapterId === chapterId);
    return idx > 0 ? points[idx - 1].chapterTitle : null;
  };

  return (
    <div className="p-3 bg-ink-800/30 rounded-lg space-y-2">
      <div className="text-xs text-ink-300 font-medium flex items-center gap-1.5">
        <Thermometer className="w-3.5 h-3.5 text-amber-400" />
        {aName} ↔ {bName}
      </div>

      {n === 0 ? (
        <div className="text-[11px] text-ink-500 text-center py-2">暂无温度数据</div>
      ) : (
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full" style={{ height: `${SVG_H}px` }} preserveAspectRatio="none">
          {/* 温度区域：70-100 亲密 / 30-70 中立 / 0-30 敌对 */}
          <rect x="0" y="0" width={SVG_W} height={SVG_H * 0.3} fill="rgba(52,211,153,0.12)" />
          <rect x="0" y={SVG_H * 0.3} width={SVG_W} height={SVG_H * 0.4} fill="rgba(251,191,36,0.12)" />
          <rect x="0" y={SVG_H * 0.7} width={SVG_W} height={SVG_H * 0.3} fill="rgba(248,113,113,0.12)" />
          {/* 分界线 */}
          <line x1="0" y1={SVG_H * 0.3} x2={SVG_W} y2={SVG_H * 0.3} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          <line x1="0" y1={SVG_H * 0.7} x2={SVG_W} y2={SVG_H * 0.7} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          {/* 折线 */}
          <polyline
            points={polyline}
            fill="none"
            stroke="rgb(251,191,36)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* 数据点 */}
          {points.map((p, i) => (
            <circle key={p.chapterId} cx={xFor(i)} cy={yFor(p.temperature)} r="2" fill="rgb(251,191,36)">
              <title>{p.chapterTitle}: {p.temperature}°C{p.note ? ` · ${p.note}` : ''}</title>
            </circle>
          ))}
        </svg>
      )}

      {/* 温度图例 */}
      <div className="flex items-center gap-3 text-[10px] text-ink-400 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-400/30 rounded-sm" />亲密 (70-100)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-400/30 rounded-sm" />中立 (30-70)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-400/30 rounded-sm" />敌对 (0-30)</span>
      </div>

      {/* 章节标签 */}
      {n > 0 && (
        <div className="flex justify-between text-[9px] text-ink-600">
          <span className="truncate max-w-[45%]">{points[0].chapterTitle}</span>
          {n > 1 && <span className="truncate max-w-[45%]">{points[n - 1].chapterTitle}</span>}
        </div>
      )}

      {/* 跳转问题列表 */}
      {curve.jumps.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-ink-700/50">
          <div className="text-[10px] text-ink-500">温度跳转（{curve.jumps.length}）</div>
          {curve.jumps.map((j, i) => {
            const fromTitle = prevTitle(j.chapterId);
            return (
              <button
                key={`${j.chapterId}-${i}`}
                onClick={() => onJump(j.chapterId)}
                className="block w-full text-left text-[11px] text-ink-300 hover:text-amber-300 leading-relaxed"
                title="跳转到该章节"
              >
                <AlertTriangle className="w-3 h-3 text-amber-400 inline mr-1 align-text-bottom" />
                {fromTitle ? `第${fromTitle} → 第${j.chapterTitle}` : `第${j.chapterTitle}`}：从{' '}
                <span className="text-amber-300">{j.fromTemp}°C</span> 跳到{' '}
                <span className="text-red-300">{j.toTemp}°C</span>，{j.description}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 人物弧光三维追踪（阶段4-3）：情绪/能力/认知三条演进曲线
 * - 从 store 读取 lastArcCurves（CharacterArcCurve[]）
 * - 角色选择下拉框（只列出 lastArcCurves 中有曲线的角色）
 * - SVG polyline 同时绘制三条曲线，异常点（anomalies 非空）红色 circle 标注
 * - 点击异常点展开 dimension + reason + remedy
 * - 无曲线时显示提示
 */
function ArcCurveView({
  curves,
  charName,
  onJump,
}: {
  curves: CharacterArcCurve[];
  charName: (id: string) => string;
  onJump: (id: string) => void;
}) {
  // 防护：curves 可能为 undefined（store 字段未初始化或 mock 缺失），统一降级为空数组
  const safeCurves = curves ?? [];
  const [selectedCharId, setSelectedCharId] = useState<string>(safeCurves[0]?.characterId ?? '');
  // 异常点展开状态：key = `${chapterId}-${dimension}-${idx}`，null 表示全部收起
  const [expandedAnomalyKey, setExpandedAnomalyKey] = useState<string | null>(null);

  // 仅列出 lastArcCurves 中有曲线的角色
  const charOptions = safeCurves.map(c => ({
    id: c.characterId,
    name: c.characterName || charName(c.characterId),
  }));
  const curve = safeCurves.find(c => c.characterId === selectedCharId) ?? safeCurves[0] ?? null;

  if (safeCurves.length === 0) {
    return (
      <div className="p-2 bg-ink-800/30 rounded-lg">
        <Section icon={Activity} title="人物弧光三维追踪" desc="情绪 / 能力 / 认知三条演进曲线">
          <EmptyHint
            icon={Activity}
            hint="运行弧光校验后显示三维曲线"
            subHint="异常点红色标注，点击查看补救方案"
          />
        </Section>
      </div>
    );
  }

  const points = curve?.points ?? [];
  const n = points.length;
  const padL = 6;
  const padR = 6;
  const innerW = ARC_SVG_W - padL - padR;
  // x 轴：章节序号；y 轴：0-100 映射到 SVG 高度
  const xFor = (i: number) => (n > 1 ? padL + (i / (n - 1)) * innerW : ARC_SVG_W / 2);
  const yFor = (v: number) => ARC_SVG_H - (Math.min(Math.max(v, 0), 100) / 100) * ARC_SVG_H;

  const lineFor = (dim: 'emotion' | 'ability' | 'cognition') =>
    points.map((p, i) => `${xFor(i)},${yFor(p[dim])}`).join(' ');

  const anomalyKey = (chapterId: string, dimension: string, idx: number) =>
    `${chapterId}-${dimension}-${idx}`;

  return (
    <div className="p-2 bg-ink-800/30 rounded-lg">
      <Section
        icon={Activity}
        title="人物弧光三维追踪"
        desc="情绪 / 能力 / 认知三条演进曲线"
        action={
          <select
            aria-label="选择角色"
            value={selectedCharId}
            onChange={e => {
              setSelectedCharId(e.target.value);
              setExpandedAnomalyKey(null);
            }}
            className="bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
          >
            {charOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        }
      >
        {n === 0 ? (
          <div className="text-[11px] text-ink-500 text-center py-2">该角色暂无曲线数据</div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${ARC_SVG_W} ${ARC_SVG_H}`}
              className="w-full"
              style={{ height: `${ARC_SVG_H}px` }}
              preserveAspectRatio="none"
            >
              {/* y 轴中位参考线 */}
              <line x1="0" y1={ARC_SVG_H * 0.5} x2={ARC_SVG_W} y2={ARC_SVG_H * 0.5} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
              {/* 三条维度折线 */}
              {ARC_DIMENSIONS.map(d => (
                <polyline
                  key={d.key}
                  points={lineFor(d.key)}
                  fill="none"
                  stroke={d.color}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* 三条曲线常规数据点 */}
              {ARC_DIMENSIONS.map(d =>
                points.map((p, i) => (
                  <circle
                    key={`${d.key}-${p.chapterId}`}
                    cx={xFor(i)}
                    cy={yFor(p[d.key])}
                    r="1.5"
                    fill={d.color}
                  >
                    <title>{p.chapterTitle} · {d.label}: {p[d.key]}</title>
                  </circle>
                )),
              )}
              {/* 异常点：红色 circle（r=4），点击展开 dimension + reason + remedy */}
              {points.map((p, i) =>
                p.anomalies.map((a, ai) => {
                  const key = anomalyKey(p.chapterId, a.dimension, ai);
                  const isExpanded = expandedAnomalyKey === key;
                  return (
                    <circle
                      key={key}
                      cx={xFor(i)}
                      cy={yFor(p[a.dimension])}
                      r="4"
                      fill="red"
                      stroke="rgba(255,255,255,0.5)"
                      strokeWidth="0.5"
                      className="cursor-pointer"
                      onClick={() => setExpandedAnomalyKey(isExpanded ? null : key)}
                    >
                      <title>{a.dimension} 异常：{a.reason}</title>
                    </circle>
                  );
                }),
              )}
            </svg>

            {/* 图例 */}
            <div className="flex items-center gap-3 text-[10px] text-ink-400 flex-wrap">
              {ARC_DIMENSIONS.map(d => (
                <span key={d.key} className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  {d.label}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                异常点（点击查看详情）
              </span>
            </div>

            {/* 章节标签 */}
            <div className="flex justify-between text-[9px] text-ink-600">
              <span className="truncate max-w-[45%]">{points[0].chapterTitle}</span>
              {n > 1 && <span className="truncate max-w-[45%]">{points[n - 1].chapterTitle}</span>}
            </div>

            {/* 展开的异常点详情 */}
            {points.map(p =>
              p.anomalies.map((a, ai) => {
                const key = anomalyKey(p.chapterId, a.dimension, ai);
                if (expandedAnomalyKey !== key) return null;
                const dimMeta = ARC_DIMENSIONS.find(d => d.key === a.dimension);
                return (
                  <div
                    key={key}
                    className="p-2 bg-red-500/5 border border-red-500/30 rounded-lg space-y-1"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-px text-[9px] rounded border border-red-500/40 text-red-300">
                        异常 · {dimMeta?.label ?? a.dimension}
                      </span>
                      {p.chapterId && (
                        <button
                          onClick={() => onJump(p.chapterId)}
                          className="text-[10px] text-ink-300 hover:text-amber-300 underline truncate max-w-[140px]"
                          title="跳转到该章节"
                        >
                          [{p.chapterTitle}]
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-100 leading-relaxed">
                      <span className="text-ink-400">原因：</span>
                      {a.reason}
                    </div>
                    <div className="text-[11px] text-emerald-300 flex items-start gap-1 leading-relaxed">
                      <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>{a.remedy}</span>
                    </div>
                  </div>
                );
              }),
            )}
          </>
        )}
      </Section>
    </div>
  );
}

/**
 * 角色维度情感一致性（阶段4-5）：检测相邻章节同一角色情绪跳转
 * - 调用 runCharacterEmotionConsistencyCheck，读取 lastCharacterEmotionReport
 * - issues 中 type='emotion-jump' 列表展示，每个带"跳转章节"和"建议插入过渡段落"
 * - 可选：用 curves 画一个角色的情绪曲线（简化版，单条 emotion 线 + 突兀点红标）
 * - 无报告时显示提示
 */
function CharacterEmotionConsistencyView({
  report,
  isRunning,
  onRun,
  onJump,
}: {
  report: CharacterEmotionConsistencyReport | null;
  isRunning: boolean;
  onRun: () => void;
  onJump: (id: string) => void;
}) {
  const [selectedCharId, setSelectedCharId] = useState<string>('');

  const issues = report?.issues ?? [];
  const curves = report?.curves ?? [];
  const emotionJumpIssues = issues.filter(i => i.type === 'emotion-jump');

  const charOptions = curves.map(c => ({
    id: c.characterId,
    name: c.characterName,
  }));
  const effectiveCharId = selectedCharId || curves[0]?.characterId || '';
  const curve = curves.find(c => c.characterId === effectiveCharId) ?? curves[0] ?? null;

  // 情绪跳转触发章节集合（用于曲线上标红）
  const jumpChapterIds = new Set<string>(
    emotionJumpIssues
      .map(i => i.chapterId)
      .filter((id): id is string => !!id),
  );

  return (
    <div className="p-2 bg-ink-800/30 rounded-lg">
      <Section
        icon={HeartPulse}
        title="角色维度情感一致性"
        desc="检测相邻章节情绪跳转，建议插入过渡段落"
        action={
          <button
            onClick={onRun}
            disabled={isRunning}
            className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
          >
            {isRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <HeartPulse className="w-3 h-3" />}
            {isRunning ? '校验中' : '运行情感一致性校验'}
          </button>
        }
      >
        {!report ? (
          <EmptyHint
            icon={HeartPulse}
            hint="点击上方按钮运行情感一致性校验"
            subHint="检测相邻章节同一角色情绪跳转幅度，标记突兀节点并建议过渡段落"
          />
        ) : (
          <>
            {/* 情绪跳转突兀列表 */}
            {emotionJumpIssues.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] text-ink-400">情绪跳转突兀（{emotionJumpIssues.length}）</div>
                {emotionJumpIssues.map(issue => (
                  <div
                    key={issue.id}
                    className="p-2 rounded-lg border border-pink-500/30 bg-pink-500/5 space-y-1"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-px text-[9px] rounded border border-pink-400/40 text-pink-300 bg-pink-400/10">
                        情绪跳转
                      </span>
                      <span className={`px-1 py-px text-[9px] rounded ${issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                        {issue.severity === 'error' ? '严重' : '警告'}
                      </span>
                      {issue.chapterTitle && (
                        <button
                          onClick={() => issue.chapterId && onJump(issue.chapterId)}
                          className="text-[10px] text-ink-300 hover:text-amber-300 underline truncate max-w-[140px]"
                          title="跳转到该章节"
                        >
                          跳转章节：[{issue.chapterTitle}]
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-ink-100 leading-relaxed">{issue.description}</div>
                    <div className="text-[11px] text-emerald-300 flex items-start gap-1 leading-relaxed">
                      <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>建议插入过渡段落：{issue.suggestion}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-2 bg-emerald-400/5 border border-emerald-400/20 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                <HeartPulse className="w-3.5 h-3.5" /> 未检测到相邻章节情绪跳转突兀
              </div>
            )}

            {/* 简化版单角色情绪曲线 + 突兀点红标 */}
            {curve && curve.points.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-ink-700/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-500">情绪曲线</span>
                  {charOptions.length > 1 && (
                    <select
                      aria-label="选择角色"
                      value={effectiveCharId}
                      onChange={e => setSelectedCharId(e.target.value)}
                      className="ml-auto bg-ink-800/60 text-ink-200 text-[10px] px-1.5 py-0.5 rounded border border-ink-700/50"
                    >
                      {charOptions.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <EmotionMiniCurve
                  points={curve.points}
                  jumpChapterIds={jumpChapterIds}
                  onJump={onJump}
                />
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

/**
 * 简化版单条情绪曲线：emotion 线 + 突兀章节红标。
 * 复用 RelationshipCurveView 的 SVG 写法（polyline + circle，preserveAspectRatio="none"）。
 */
function EmotionMiniCurve({
  points,
  jumpChapterIds,
  onJump,
}: {
  points: Array<{ chapterId: string; chapterTitle: string; emotion: number }>;
  jumpChapterIds: Set<string>;
  onJump: (id: string) => void;
}) {
  const n = points.length;
  const padL = 6;
  const padR = 6;
  const innerW = ARC_SVG_W - padL - padR;
  const xFor = (i: number) => (n > 1 ? padL + (i / (n - 1)) * innerW : ARC_SVG_W / 2);
  const yFor = (v: number) => ARC_SVG_H - (Math.min(Math.max(v, 0), 100) / 100) * ARC_SVG_H;

  const polyline = points.map((p, i) => `${xFor(i)},${yFor(p.emotion)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${ARC_SVG_W} ${ARC_SVG_H}`}
      className="w-full"
      style={{ height: `${ARC_SVG_H}px` }}
      preserveAspectRatio="none"
    >
      <line x1="0" y1={ARC_SVG_H * 0.5} x2={ARC_SVG_W} y2={ARC_SVG_H * 0.5} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      <polyline
        points={polyline}
        fill="none"
        stroke="#f87171"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => {
        const isJump = jumpChapterIds.has(p.chapterId);
        return (
          <circle
            key={p.chapterId}
            cx={xFor(i)}
            cy={yFor(p.emotion)}
            r={isJump ? 4 : 1.5}
            fill={isJump ? 'red' : '#f87171'}
            stroke={isJump ? 'rgba(255,255,255,0.5)' : 'none'}
            strokeWidth="0.5"
            className={isJump ? 'cursor-pointer' : undefined}
            onClick={isJump ? () => onJump(p.chapterId) : undefined}
          >
            <title>
              {p.chapterTitle}: {p.emotion}{isJump ? ' · 突兀节点' : ''}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}
