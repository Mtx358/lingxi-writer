import type { Chapter, Character, Foreshadow, Subplot, UpdateSchedule } from '@/types';
import type { TabId } from '@/components/editor/outlinePolish/types';
import { getLLMClient, parseJsonFromLLM } from './core';

// ==================== 项目健康度域类型 ====================

/** 健康度问题严重级别 */
export type HealthSeverity = 'high' | 'medium' | 'low';

/** 健康度问题分类 */
export type HealthCategory =
  | 'foreshadow'
  | 'pacing'
  | 'character'
  | 'subplot'
  | 'stockpile'
  | 'structure'
  | 'emotion';

/** 单个健康度问题 */
export interface HealthIssue {
  id: string;
  severity: HealthSeverity;
  category: HealthCategory;
  title: string;
  description: string;
  suggestion: string;
  /** 快捷操作目标：跳转到哪个打磨 Tab */
  actionTab: TabId;
  /** 快捷操作目标：跳转到哪个章节（可选） */
  actionChapterId?: string;
  /** 按钮文案 */
  actionLabel: string;
}

/** 项目健康度报告 */
export interface ProjectHealthReport {
  issues: HealthIssue[];
  summary: {
    totalIssues: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    /** 整体状态：healthy(无高危) / warning(有中危) / critical(有高危) */
    overallStatus: 'healthy' | 'warning' | 'critical';
  };
}

/** 智能引导步骤 */
export interface PolishGuideStep {
  order: number;
  title: string;
  detail: string;
  targetTab: TabId;
  targetChapterId?: string;
  estimatedMinutes: number;
}

/** 智能引导报告 */
export interface PolishGuide {
  steps: PolishGuideStep[];
  totalEstimatedMinutes: number;
  summary: string;
}

// ==================== 内部常量 ====================

const VALID_TAB_IDS: TabId[] = [
  'inspiration',
  'nlCommand',
  'skeleton',
  'coreDriver',
  'beats',
  'expansion',
  'multiline',
  'chapterGrid',
  'sceneLocator',
  'timeline',
  'diagnosis',
  'pacing',
  'characters',
  'readerEmpathy',
  'foreshadowBoard',
  'emotionConsistency',
  'curveDrag',
  'forceCanvas',
  'comments',
  'causal',
  'sandbox',
  'snapshots',
  'versionDiff',
];

const VALID_SEVERITIES: HealthSeverity[] = ['high', 'medium', 'low'];
const VALID_CATEGORIES: HealthCategory[] = [
  'foreshadow',
  'pacing',
  'character',
  'subplot',
  'stockpile',
  'structure',
  'emotion',
];

const SEVERITY_ORDER: Record<HealthSeverity, number> = { high: 0, medium: 1, low: 2 };

// ==================== 函数1: analyzeProjectHealth ====================

/**
 * 项目健康度诊断：检测伏笔逾期、节奏拖沓、角色未出场、支线停滞、存稿不足、
 * 核心驱动未锁定、蓝图未生成等 7 类问题，输出结构化报告。
 *
 * Mock 模式下走本地启发式，非 Mock 模式调用 LLM，失败时 fallback 到启发式。
 */
export async function analyzeProjectHealth(params: {
  chapters: Chapter[];
  characters: Character[];
  foreshadows: Foreshadow[];
  subplots?: Subplot[];
  updateSchedule?: UpdateSchedule | null;
  coreDriver?: { type: string } | null;
  blueprint?: unknown;
}): Promise<ProjectHealthReport> {
  const { chapters, characters, foreshadows, subplots, updateSchedule, coreDriver, blueprint } = params;
  const mainChapters = chapters.filter(c => c.levelType === 'chapter');

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const chapDigest = mainChapters
        .slice(0, 30)
        .map(
          (c, i) =>
            `第${i + 1}章「${c.title}」(${c.wordCount}字, ${c.status}): ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 120)}`,
        )
        .join('\n');
      const charDigest = characters
        .slice(0, 10)
        .map(c => `- ${c.name}（${c.role}）`)
        .join('\n');
      const foreshadowDigest = foreshadows
        .slice(0, 15)
        .map(
          f =>
            `- 《${f.title}》: status=${f.status}｜埋设章节=${f.plantedChapterId || '未指定'}｜回收章节=${f.payoffChapterId || '未指定'}｜已${f.chaptersSinceMention}章未提及`,
        )
        .join('\n');
      const subplotDigest = (subplots || [])
        .slice(0, 10)
        .map(s => `- 《${s.title}》: status=${s.status}｜更新时间=${s.updatedAt}`)
        .join('\n');
      const scheduleInfo = updateSchedule
        ? `日更目标=${updateSchedule.dailyTargetWords}字/天，速度=${updateSchedule.dailySpeed}字/天，上次更新=${updateSchedule.lastUpdateAt || '无'}`
        : '未配置';
      const driverInfo = coreDriver ? `已锁定(${coreDriver.type})` : '未锁定';
      const blueprintInfo = blueprint ? '已生成' : '未生成';
      const doneCount = mainChapters.filter(c => c.status === 'done').length;

      const prompt = `请基于以下项目数据，诊断小说项目健康度，返回 JSON 数组。

诊断维度（category 字段）：
- foreshadow：伏笔逾期/未回收/长期未提及
- pacing：节奏拖沓/连续无高潮/信息密度失衡
- character：角色长期未出场/弧光断层
- subplot：支线停滞/无进展
- stockpile：存稿不足/断更风险
- structure：核心驱动未锁定/蓝图未生成等结构性问题
- emotion：情感张力不足

每条问题包含：
{
  "severity": "high|medium|low",
  "category": "上述取值之一",
  "title": "问题标题（不超过30字）",
  "description": "问题描述（不超过80字）",
  "suggestion": "可落地建议（不超过80字）",
  "actionTab": "目标Tab，取值：${VALID_TAB_IDS.join('|')}",
  "actionChapterId": "可选，关联章节ID",
  "actionLabel": "按钮文案（4-8字）"
}

severity 优先级：高危=影响连载/烂尾风险，中危=体验下降，低危=可延后处理。
只返回 JSON 数组，无问题返回 []。

【项目摘要】
主线章节数：${mainChapters.length}（已完成 ${doneCount}）
核心驱动：${driverInfo}
全局蓝图：${blueprintInfo}
更新计划：${scheduleInfo}

【章节列表】
${chapDigest || '（无）'}

【角色库】
${charDigest || '（无）'}

【伏笔库】
${foreshadowDigest || '（无）'}

【支线库】
${subplotDigest || '（无）'}
`;

      const result = await llmClient.callLLM(
        prompt,
        '你是资深小说连载运营顾问，擅长诊断项目健康度与连载风险。只返回 JSON 数组。',
      );
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const issues: HealthIssue[] = [];
        const now = Date.now();
        parsed.forEach((raw, idx) => {
          if (!raw || typeof raw !== 'object') return;
          const r = raw as Record<string, unknown>;
          const severity = String(r.severity || 'medium') as HealthSeverity;
          const category = String(r.category || 'structure') as HealthCategory;
          const actionTab = String(r.actionTab || 'diagnosis') as TabId;
          const actionChapterIdRaw = r.actionChapterId ? String(r.actionChapterId) : undefined;
          const actionChapterId =
            actionChapterIdRaw && mainChapters.some(c => c.id === actionChapterIdRaw)
              ? actionChapterIdRaw
              : undefined;
          issues.push({
            id: `health-llm-${now}-${idx}`,
            severity: VALID_SEVERITIES.includes(severity) ? severity : 'medium',
            category: VALID_CATEGORIES.includes(category) ? category : 'structure',
            title: String(r.title || '').slice(0, 60),
            description: String(r.description || '').slice(0, 200),
            suggestion: String(r.suggestion || '').slice(0, 200),
            actionTab: VALID_TAB_IDS.includes(actionTab) ? actionTab : 'diagnosis',
            actionChapterId,
            actionLabel: String(r.actionLabel || '查看详情').slice(0, 20),
          });
        });
        return buildHealthReport(issues);
      }
    } catch (e) {
      console.warn('AI analyzeProjectHealth failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(300);
  const issues = generateHeuristicHealthIssues(
    mainChapters,
    characters,
    foreshadows,
    subplots,
    updateSchedule,
    coreDriver,
    blueprint,
  );
  return buildHealthReport(issues);
}

/** 拼装健康度报告：按 severity 排序 + 统计 + overallStatus */
function buildHealthReport(issues: HealthIssue[]): ProjectHealthReport {
  const sorted = [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const highCount = sorted.filter(i => i.severity === 'high').length;
  const mediumCount = sorted.filter(i => i.severity === 'medium').length;
  const lowCount = sorted.filter(i => i.severity === 'low').length;
  const overallStatus: ProjectHealthReport['summary']['overallStatus'] =
    highCount > 0 ? 'critical' : mediumCount > 0 ? 'warning' : 'healthy';
  return {
    issues: sorted,
    summary: {
      totalIssues: sorted.length,
      highCount,
      mediumCount,
      lowCount,
      overallStatus,
    },
  };
}

/** Mock 启发式：基于本地数据生成 7 类健康度问题 */
function generateHeuristicHealthIssues(
  mainChapters: Chapter[],
  characters: Character[],
  foreshadows: Foreshadow[],
  subplots: Subplot[] | undefined,
  updateSchedule: UpdateSchedule | null | undefined,
  coreDriver: { type: string } | null | undefined,
  blueprint: unknown,
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const now = Date.now();
  const lastIdx = mainChapters.length - 1;

  // 1. 伏笔逾期检测：status='planted' 且距离埋设章节超过 5 章
  for (const f of foreshadows) {
    if (f.status !== 'planted') continue;
    if (!f.plantedChapterId) continue;
    const plantIdx = mainChapters.findIndex(c => c.id === f.plantedChapterId);
    if (plantIdx === -1) continue;
    const gap = lastIdx - plantIdx;
    if (gap > 5) {
      issues.push({
        id: `health-foreshadow-${now}-${f.id}`,
        severity: 'high',
        category: 'foreshadow',
        title: `伏笔「${f.title}」已逾期 ${gap} 章未回收`,
        description: `埋设于第${plantIdx + 1}章，距今已${gap}章未推进，读者可能已遗忘`,
        suggestion: `建议在近期章节中回收此伏笔，或推进至"进行中"状态`,
        actionTab: 'foreshadowBoard',
        actionChapterId: f.plantedChapterId,
        actionLabel: '查看伏笔看板',
      });
    }
  }

  // 2. 节奏拖沓检测：最后 10 章中连续 5+ 章无高潮/冲突/转折/对决/揭秘
  if (mainChapters.length >= 5) {
    const last10 = mainChapters.slice(-10);
    const climaxKeywords = ['高潮', '冲突', '转折', '对决', '揭秘'];
    let streak = 0;
    let streakStart = 0;
    let maxStreak = 0;
    let maxStart = 0;
    for (let i = 0; i < last10.length; i++) {
      const ch = last10[i];
      const text = `${ch.summary || ''} ${ch.content || ''}`;
      const hasClimax = climaxKeywords.some(kw => text.includes(kw));
      if (hasClimax) {
        streak = 0;
      } else {
        if (streak === 0) streakStart = i;
        streak++;
        if (streak > maxStreak) {
          maxStreak = streak;
          maxStart = streakStart;
        }
      }
    }
    if (maxStreak >= 5) {
      const offsetBase = mainChapters.length - last10.length;
      const startChapterNum = offsetBase + maxStart + 1;
      const endChapterNum = offsetBase + maxStart + maxStreak;
      issues.push({
        id: `health-pacing-${now}`,
        severity: 'medium',
        category: 'pacing',
        title: `第${startChapterNum}-${endChapterNum}章连续${maxStreak}章无高潮`,
        description: `最近 ${last10.length} 章中存在连续 ${maxStreak} 章无高潮/冲突/转折/对决/揭秘等关键事件，节奏偏缓`,
        suggestion: `建议在其中插入一个小高潮或冲突事件，避免读者流失`,
        actionTab: 'pacing',
        actionLabel: '查看节奏图',
      });
    }
  }

  // 3. 角色长期未出场：role !== 'minor' 的角色连续 15+ 章未出现
  for (const char of characters) {
    if (char.role === 'minor') continue;
    if (mainChapters.length === 0) break;
    let gap = 0;
    for (let i = lastIdx; i >= 0; i--) {
      const ch = mainChapters[i];
      const text = ch.content || '';
      const mentioned =
        text.includes(char.name) || (ch.characterFocus?.includes(char.id) ?? false);
      if (mentioned) break;
      gap++;
    }
    if (gap >= 15) {
      const roleLabel =
        char.role === 'protagonist'
          ? '主角'
          : char.role === 'antagonist'
            ? '对手'
            : char.role === 'narrator'
              ? '叙述者'
              : '重要角色';
      issues.push({
        id: `health-character-${now}-${char.id}`,
        severity: 'medium',
        category: 'character',
        title: `角色「${char.name}」已${gap}章未出场`,
        description: `${roleLabel}「${char.name}」连续 ${gap} 章未在任何章节中出现，弧光可能断层`,
        suggestion: `建议安排该角色在近期章节出场，或明确标记为"暂离"`,
        actionTab: 'characters',
        actionLabel: '查看角色弧光',
      });
    }
  }

  // 4. 支线停滞：status 不是 closed/abandoned，且 updatedAt 距今 > 14 天
  if (subplots && subplots.length > 0) {
    const nowMs = Date.now();
    for (const s of subplots) {
      if (s.status === 'closed' || s.status === 'abandoned') continue;
      const updatedMs = new Date(s.updatedAt).getTime();
      if (isNaN(updatedMs)) continue;
      const days = Math.floor((nowMs - updatedMs) / (1000 * 60 * 60 * 24));
      if (days > 14) {
        issues.push({
          id: `health-subplot-${now}-${s.id}`,
          severity: 'high',
          category: 'subplot',
          title: `支线「${s.title}」已停滞${days}天`,
          description: `支线状态为「${s.status}」，但距上次更新已 ${days} 天未推进，存在烂尾风险`,
          suggestion: `建议尽快推进此支线，或显式标记为"暂停"`,
          actionTab: 'beats',
          actionLabel: '查看章节节拍',
        });
      }
    }
  }

  // 5. 存稿不足：updateSchedule 存在时，按 done 章节数 / 日更频率(1章/天) 估算存稿天数
  if (updateSchedule) {
    const doneChapters = mainChapters.filter(c => c.status === 'done').length;
    // 日更频率默认 1 章/天
    const days = doneChapters;
    if (days < 7) {
      const severity: HealthSeverity = days < 3 ? 'high' : 'medium';
      issues.push({
        id: `health-stockpile-${now}`,
        severity,
        category: 'stockpile',
        title: `存稿仅剩 ${days} 天`,
        description: `当前已完成 ${doneChapters} 章，按日更 1 章计算仅够支撑 ${days} 天`,
        suggestion: `低于警戒线，断更风险高，建议立即补稿`,
        actionTab: 'snapshots',
        actionLabel: '生成快照',
      });
    }
  }

  // 6. 核心驱动未锁定
  if (!coreDriver) {
    issues.push({
      id: `health-core-driver-${now}`,
      severity: 'medium',
      category: 'structure',
      title: `核心驱动尚未锁定`,
      description: `核心驱动是全书打磨红线，未锁定会导致后续修改缺乏基准，易跑偏`,
      suggestion: `建议在骨架打磨阶段锁定核心驱动，作为全书打磨红线`,
      actionTab: 'coreDriver',
      actionLabel: '锁定核心驱动',
    });
  }

  // 7. 蓝图未生成
  if (!blueprint) {
    issues.push({
      id: `health-blueprint-${now}`,
      severity: 'low',
      category: 'structure',
      title: `全局蓝图尚未生成`,
      description: `蓝图锁定全书走向，未生成时后续章节修改缺乏全局参照，易出现结构断层`,
      suggestion: `建议生成蓝图锁定全书走向，后续修改以此为基准`,
      actionTab: 'skeleton',
      actionLabel: '查看骨架',
    });
  }

  return issues;
}

// ==================== 函数2: recommendPolishGuide ====================

/**
 * 智能引导：基于健康度报告生成打磨步骤推荐。
 * 纯启发式，不调用 LLM。高危问题优先，预估耗时更长。
 */
export async function recommendPolishGuide(report: ProjectHealthReport): Promise<PolishGuide> {
  if (report.issues.length === 0) {
    return {
      steps: [],
      totalEstimatedMinutes: 0,
      summary: '当前项目健康状况良好，无紧急问题。可以从灵感打磨或骨架打磨开始主动优化。',
    };
  }

  const sorted = [...report.issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const steps: PolishGuideStep[] = sorted.map((issue, idx) => {
    let estimatedMinutes: number;
    if (issue.severity === 'high') {
      // 高危 5-10 分钟，取中位
      estimatedMinutes = 8;
    } else if (issue.severity === 'medium') {
      // 中危 3-5 分钟，取中位
      estimatedMinutes = 4;
    } else {
      estimatedMinutes = 2;
    }
    return {
      order: idx + 1,
      title: issue.title,
      detail: `${issue.description}｜建议：${issue.suggestion}`,
      targetTab: issue.actionTab,
      targetChapterId: issue.actionChapterId,
      estimatedMinutes,
    };
  });

  const totalEstimatedMinutes = steps.reduce((s, st) => s + st.estimatedMinutes, 0);
  const summary = `建议本次打磨按以下顺序处理 ${report.summary.highCount} 个高危问题和 ${report.summary.mediumCount} 个中危问题，预计耗时约 ${totalEstimatedMinutes} 分钟`;

  return {
    steps,
    totalEstimatedMinutes,
    summary,
  };
}

// ==================== 函数3: generatePolishSummary ====================

/**
 * 纯函数：基于本次打磨动作生成成果摘要文本，不调用 LLM。
 */
export function generatePolishSummary(actions: {
  foreshadowsResolved: number;
  pacingAdjusted: number;
  arcFixed: number;
  newInspirations: number;
  snapshotsCreated: number;
}): string {
  const parts: string[] = [];
  if (actions.foreshadowsResolved > 0) parts.push(`回收 ${actions.foreshadowsResolved} 个伏笔`);
  if (actions.pacingAdjusted > 0) parts.push(`调整 ${actions.pacingAdjusted} 处节奏`);
  if (actions.arcFixed > 0) parts.push(`修复 ${actions.arcFixed} 处角色弧光`);
  if (actions.newInspirations > 0) parts.push(`新增 ${actions.newInspirations} 条灵感`);
  if (actions.snapshotsCreated > 0) parts.push(`创建 ${actions.snapshotsCreated} 个快照`);

  if (parts.length === 0) {
    return '本次打磨未产生明显变更，建议从灵感打磨或骨架打磨入手主动优化。';
  }
  return `本次打磨共${parts.join('、')}。`;
}
