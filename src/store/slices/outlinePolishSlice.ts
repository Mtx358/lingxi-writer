/**
 * 大纲打磨域 slice
 *
 * 承载"大纲打磨"功能的全部状态与逻辑：
 *   - 报告生成与持久化（lastOutlineReport）：调用 aiService.polishOutline 完成
 *     六维度诊断，并本地补充节奏曲线/情感曲线/三幕比例/角色弧光/伏笔密度，
 *     组装为 OutlinePolishReport。
 *   - 诊断项操作：ignoreOutlineIssue / resolveOutlineIssue / batchResolveOutlineIssues
 *     支持单条忽略、单条采纳、批量采纳，结果直接写回 report.issues。
 *   - 版本花园（outlineSnapshots）：保存当前章节结构快照（仅结构字段，不含正文），
 *     支持删除与恢复。恢复时仅覆盖结构字段，不触及正文 content/wordCount/status。
 *   - 情节扩展器（outlineExpansionCache）：按 chapterId 缓存最近一次扩展方案，
 *     章节内容变更时可主动失效。
 *
 * 与其他 slice 的耦合：
 *   - 读取 chapters / characters / foreshadows（entity + chapter slice）
 *   - 恢复快照时调用 updateChapter（chapter slice）批量更新结构字段
 *   - closeProject 时由 projectSlice 重置 lastOutlineReport / outlineSnapshots / cache
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type {
  Chapter,
  Foreshadow,
  OutlinePolishReport,
  OutlineSnapshot,
  OutlineIssue,
  CharacterArcAnalysis,
  ChapterBeat,
  CoreDriver,
  ConflictLayerType,
  PacingPressureReport,
  PacingPressurePoint,
  ForeshadowBoardItem,
  VersionDiffReport,
  VersionDiffEntry,
  CharacterArcIssue,
  RelationshipTemperatureCurve,
  ReaderEmpathyReport,
  SandboxTrialReport,
  SandboxTrialSnapshot,
  SandboxTrialIssueDigest,
  SandboxTrialMetricDelta,
  ForeshadowPayoffCheck,
  EmergencyRecoveryPlan,
  CharacterArcCurve,
  CharacterArcRemedyPlan,
  CharacterEmotionConsistencyReport,
  PacingAdjustmentAdvice,
} from '@/types';
import { generateId, markDirty } from '@/utils/storage';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import {
  polishOutline,
  analyzeCharacterArcs,
  expandOutlineNode,
  generateChapterBeats,
  generateStructureVariants,
  generateConflictCompass,
  previewCausalImpact,
  runPacingPressureTest,
  analyzeCharacterArcIssues,
  analyzeRelationshipTemperature,
  analyzeReaderEmpathy,
  checkForeshadowPayoffReasonability,
  generateEmergencyRecoveryPlan,
  analyzeCharacterArcCurves,
  analyzeCharacterEmotionConsistency,
  generatePacingAdjustmentAdvice,
} from '@/utils/aiService';
import { registerProjectCleanup } from '../projectCleanup';

/**
 * 异步 action 并发守卫：以 action 维度记录最新一次请求 ID。
 *
 * 场景：用户对同一目标连续触发"生成节拍/冲突罗盘/结构变体/因果推演"，
 * 早先的 LLM 请求可能晚于最新的请求返回；若不守卫，旧响应会覆盖新响应，
 * UI 显示与最新请求不符的结果。
 *
 * 用法：每次进入异步 action 时 ++ 自增并写入 Map，await 后比对——若不一致
 * 说明期间有新请求进入，本次结果作废。
 */
const lastRequestIds = new Map<string, number>();
let requestCounter = 0;

/** 生成并登记本次请求 ID，返回 [本次ID, 校验函数]。校验函数返回 true 表示仍是最新请求。 */
function beginRequest(key: string): { isStale: () => boolean } {
  const id = ++requestCounter;
  lastRequestIds.set(key, id);
  return { isStale: () => lastRequestIds.get(key) !== id };
}

/**
 * 清空所有并发守卫的请求 ID 记录。
 *
 * 'beats:${chapterId}' 这类 key 跨项目唯一且永不再用，项目切换时若不清理会
 * 慢速累积。在 projectSlice 的 5 个项目切换入口调用一次即可。
 * 同时让所有在飞的请求 isStale() 返回 true（lastRequestIds.get(key) 为 undefined，
 * 与本次 id !== undefined 比较为 true），相当于强制取消。
 */
export function clearOutlinePolishRequests(): void {
  lastRequestIds.clear();
}

/** 测试隔离用：重置模块级请求守卫状态（lastRequestIds + requestCounter），避免跨用例泄漏 */
export function _resetOutlinePolishRequestState(): void {
  lastRequestIds.clear();
  requestCounter = 0;
}

// 项目切换时自动清理大纲打磨域并发守卫记录
registerProjectCleanup(clearOutlinePolishRequests);

type OutlinePolishSlice = Pick<AppState,
  | 'lastOutlineReport' | 'outlineSnapshots' | 'isPolishingOutline' | 'outlineExpansionCache'
  | 'runOutlinePolish' | 'ignoreOutlineIssue' | 'resolveOutlineIssue' | 'batchResolveOutlineIssues'
  | 'saveOutlineSnapshot' | 'deleteOutlineSnapshot' | 'restoreOutlineSnapshot'
  | 'fetchOutlineExpansion' | 'clearOutlineExpansionCache' | 'getOutlineReport'
  | 'coreDriver' | 'conflictCompass' | 'structureVariants' | 'lastCausalImpact'
  | 'lockCoreDriver' | 'unlockCoreDriver' | 'fetchConflictCompass' | 'updateConflictWeight' | 'fetchStructureVariants'
  | 'generateBeatsForChapter' | 'updateChapterBeat' | 'toggleBeatLock'
  | 'runCausalPreview' | 'clearCausalImpact'
  | 'lastPacingReport' | 'lastArcIssues' | 'lastRelationshipCurve'
  | 'runPacingPressureTest' | 'updatePacingPoint' | 'resetPacingPoint' | 'getForeshadowBoardItems' | 'compareSnapshots'
  | 'runCharacterArcCheck' | 'analyzeRelationship'
  | 'lastReaderEmpathyReport' | 'runReaderEmpathyCheck'
  | 'lastArcCurves' | 'lastArcRemedyPlans' | 'lastCharacterEmotionReport' | 'lastPacingAdvice'
  | 'runCharacterEmotionConsistencyCheck' | 'requestPacingAdvice' | 'applyPacingAdvice' | 'clearPacingAdvice'
  | 'sandboxBaseline' | 'sandboxBaselineChapters' | 'sandboxBaselineForeshadows' | 'lastSandboxReport'
  | 'captureSandboxBaseline' | 'clearSandboxBaseline' | 'restoreSandboxBaseline' | 'runSandboxVerification'
  | 'foreshadowPayoffChecks' | 'emergencyRecoveryPlans'
  | 'runForeshadowPayoffCheck' | 'generateRecoveryPlan' | 'clearForeshadowChecks'>;

// 单项目快照数量上限：超过时淘汰最旧快照，避免长期累积占用内存
const MAX_OUTLINE_SNAPSHOTS = 30;

/**
 * 计算章节张力分数（0-100）。
 * 本地启发式：基于字数、对话比例、关键词（冲突/危机/真相/对决等）综合估算，
 * 用于在 LLM 未返回 pacing 时填充曲线，让"节奏脉搏"始终有可读数据。
 */
function computeTension(chapter: Chapter): number {
  const text = chapter.content?.replace(/<[^>]*>/g, '') || '';
  if (!text) return chapter.summary ? 30 : 10;
  const len = text.length;
  const dialogueMatches = text.match(/["""].+?[""]/g) || [];
  const dialogueRatio = len > 0 ? Math.min(dialogueMatches.length * 60 / len, 0.5) : 0;
  const tensionKeywords = /冲突|危机|对决|真相|暴露|背叛|死亡|险|战|逃|追|惊|怒|恐|崩溃|转折|杀|险境|绝望|爆发|揭穿|突袭/i;
  const keywordHit = tensionKeywords.test(text) ? 25 : 0;
  const summaryHit = tensionKeywords.test(chapter.summary || '') ? 10 : 0;
  // 字数基础分：每 500 字加 5 分，封顶 30
  const lengthScore = Math.min((chapter.wordCount || len) / 500 * 5, 30);
  // 对话加分：对话密度高暗示交锋
  const dialogueScore = dialogueRatio * 60;
  const raw = lengthScore + dialogueScore + keywordHit + summaryHit + 20;
  return Math.max(5, Math.min(100, Math.round(raw)));
}

/**
 * 计算章节情感强度（0-100）。
 * 本地启发式：基于情感关键词与感叹号密度估算，用于"情感曲线"视图。
 */
function computeEmotion(chapter: Chapter): number {
  const text = chapter.content?.replace(/<[^>]*>/g, '') || '';
  if (!text) return chapter.summary ? 25 : 10;
  const emotionKeywords = /爱|恨|喜|悲|痛|怒|恐|惊|醉|笑|哭|颤|心碎|狂|绝望|狂喜|激动|平静|冷漠|温暖/i;
  const keywordCount = (text.match(emotionKeywords) || []).length;
  const exclamCount = (text.match(/[！!]/g) || []).length;
  const len = Math.max(text.length, 1);
  const keywordScore = Math.min(keywordCount / len * 1000 * 8, 50);
  const exclamScore = Math.min(exclamCount / len * 1000 * 5, 30);
  const raw = keywordScore + exclamScore + 20;
  return Math.max(5, Math.min(100, Math.round(raw)));
}

/**
 * 计算三幕比例：[开端%, 发展%, 高潮与结局%]。
 * 按章节顺序简单切分：前 25% 章节算开端，中间 50% 算发展，末 25% 算高潮与结局。
 * 字数加权（避免一章超长拉偏比例）。
 */
function computeThreeActRatio(mainChapters: Chapter[]): [number, number, number] {
  if (mainChapters.length === 0) return [0, 0, 0];
  const total = mainChapters.length;
  const firstActEnd = Math.max(1, Math.round(total * 0.25));
  const secondActEnd = Math.max(firstActEnd + 1, Math.round(total * 0.75));
  let a = 0, b = 0, c = 0;
  mainChapters.forEach((ch, idx) => {
    const w = Math.max(ch.wordCount || 1, 1);
    if (idx < firstActEnd) a += w;
    else if (idx < secondActEnd) b += w;
    else c += w;
  });
  const sum = a + b + c || 1;
  return [
    Math.round((a / sum) * 100),
    Math.round((b / sum) * 100),
    Math.round((c / sum) * 100),
  ];
}

/**
 * 计算每章伏笔密度：{ planted, progressing, paidOff }。
 * 按伏笔的 plantedChapterId / payoffChapterId 统计，progressing 状态下
 * 凡章节出现在 relatedChapters 或正文提及标题时计入。
 */
function computeForeshadowDensity(
  mainChapters: Chapter[],
  foreshadows: Foreshadow[],
): OutlinePolishReport['foreshadowDensity'] {
  return mainChapters.map(ch => {
    let planted = 0, progressing = 0, paidOff = 0;
    foreshadows.forEach(f => {
      if (f.plantedChapterId === ch.id) planted++;
      if (f.payoffChapterId === ch.id) paidOff++;
      // 推进中：章节在 planted 与 payoff 之间且正文/摘要提及该伏笔标题
      if (f.status === 'progressing' || f.status === 'planted') {
        const text = `${ch.content || ''} ${ch.summary || ''}`;
        if (text.includes(f.title) && f.plantedChapterId !== ch.id && f.payoffChapterId !== ch.id) {
          progressing++;
        }
      }
    });
    return {
      chapterId: ch.id,
      chapterTitle: ch.title,
      planted,
      progressing,
      paidOff,
    };
  });
}

/** 为 issue 注入 chapterTitle（基于 chapters 列表查找） */
const enrichIssues = (issues: OutlineIssue[], chapters: Chapter[]): OutlineIssue[] =>
  issues.map(issue => {
    if (issue.chapterTitle) return issue;
    const ch = issue.chapterId ? chapters.find(c => c.id === issue.chapterId) : undefined;
    return ch ? { ...issue, chapterTitle: ch.title } : issue;
  });

/** 冲突层级中文标签 */
const LAYER_LABELS: Record<ConflictLayerType, string> = {
  inner: '内心冲突',
  interpersonal: '人际冲突',
  faction: '阵营冲突',
  social: '社会冲突',
};

/**
 * 冲突加重时启发式生成情节种子（文档：加重某层冲突，自动生成对应情节种子）。
 * 基于层级类型与现有描述，给出一个可落地的情节方向。
 */
function generateConflictSeed(layer: ConflictLayerType, description: string, weight: number): string {
  const intensity = weight >= 75 ? '激化到顶点' : weight >= 50 ? '显著加码' : '逐步升温';
  const base = description || '核心矛盾';
  const templates: Record<ConflictLayerType, string> = {
    inner: `【${intensity}】${base}：安排一场独处场景，让主角在抉择前内心撕裂，旧伤复发逼迫其直面真实渴望`,
    interpersonal: `【${intensity}】${base}：设计一次正面交锋，双方撕破伪装，关系从暧昧转向对立，留出翻盘余地`,
    faction: `【${intensity}】${base}：引入第三方势力打破平衡，迫使两方在利益与立场间重新站队`,
    social: `【${intensity}】${base}：放大环境压力（舆论/制度/灾难），让社会层面的阻力具体落到主角身上`,
  };
  return templates[layer];
}

export const createOutlinePolishSlice: StateCreator<AppState, [], [], OutlinePolishSlice> = (set, get) => ({
  lastOutlineReport: null,
  outlineSnapshots: [],
  isPolishingOutline: false,
  outlineExpansionCache: {},
  coreDriver: null,
  conflictCompass: [],
  structureVariants: [],
  lastCausalImpact: null,
  lastPacingReport: null as PacingPressureReport | null,
  lastArcIssues: [] as CharacterArcIssue[],
  lastRelationshipCurve: null as RelationshipTemperatureCurve | null,
  lastReaderEmpathyReport: null as ReaderEmpathyReport | null,
  // 人物弧光三维追踪 / 角色维度情感一致性 / 节奏调校 AI 建议（规格书阶段4-2/4-3/4-5）
  lastArcCurves: [] as CharacterArcCurve[],
  lastArcRemedyPlans: [] as CharacterArcRemedyPlan[],
  lastCharacterEmotionReport: null as CharacterEmotionConsistencyReport | null,
  lastPacingAdvice: null as PacingAdjustmentAdvice | null,
  sandboxBaseline: null as SandboxTrialSnapshot | null,
  sandboxBaselineChapters: null as Chapter[] | null,
  sandboxBaselineForeshadows: null as Foreshadow[] | null,
  lastSandboxReport: null as SandboxTrialReport | null,
  // 伏笔回收合理性检测 + 逾期应急回收方案（规格书阶段4-4）
  foreshadowPayoffChecks: [] as ForeshadowPayoffCheck[],
  emergencyRecoveryPlans: [] as EmergencyRecoveryPlan[],

  runOutlinePolish: async (scope: 'all' | string = 'all') => {
    const { chapters, characters, foreshadows, currentProjectId } = get();
    if (!currentProjectId) return;

    // 并发守卫：UI 通过 isPolishingOutline 禁用按钮已能阻止大部分重复触发，
    // 但程序化调用或快速点击仍可能让两次 polishOutline 并发。若旧请求晚于新请求
    // 返回，会用旧 report 覆盖新 report，UI 显示与最新大纲不符。
    const req = beginRequest('outlinePolish');
    set({ isPolishingOutline: true });
    try {
      // 局部打磨：仅诊断选中章节（及子章节）
      const scopedChapters = scope === 'all'
        ? chapters
        : chapters.filter(c => c.id === scope || isDescendant(chapters, c.id, scope));

      const mainChapters = scopedChapters.filter(c => c.levelType === 'chapter');

      // 1. AI 多维度诊断（mock 模式下走启发式规则，仍返回结构化 issues）
      let issues: OutlineIssue[] = [];
      try {
        issues = await polishOutline(scopedChapters, characters, foreshadows);
      } catch (e) {
        console.warn('polishOutline failed:', e);
        toast.error('大纲诊断失败', e instanceof Error ? e.message : 'AI 诊断服务异常，请稍后重试');
      }
      // 期间若有新请求进入或项目已切换，丢弃本次结果（不再写 lastOutlineReport）
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;

      issues = enrichIssues(issues, chapters);

      // 2. 本地补充：节奏曲线 / 情感曲线 / 三幕比例 / 角色弧光 / 伏笔密度
      const pacingCurve = mainChapters.map(ch => ({
        chapterId: ch.id,
        chapterTitle: ch.title,
        tension: computeTension(ch),
        wordCount: ch.wordCount,
      }));
      const emotionCurve = mainChapters.map(ch => ({
        chapterId: ch.id,
        chapterTitle: ch.title,
        emotion: computeEmotion(ch),
      }));
      const threeActRatio = computeThreeActRatio(mainChapters);
      const characterArcs: CharacterArcAnalysis[] = analyzeCharacterArcs(scopedChapters, characters);
      const foreshadowDensity = computeForeshadowDensity(mainChapters, foreshadows);

      const totalWords = mainChapters.reduce((s, c) => s + (c.wordCount || 0), 0);

      const report: OutlinePolishReport = {
        generatedAt: new Date().toISOString(),
        scope,
        projectId: currentProjectId,
        issues,
        pacingCurve,
        emotionCurve,
        threeActRatio,
        characterArcs,
        foreshadowDensity,
        totalChapters: mainChapters.length,
        totalWords,
      };

      set({ lastOutlineReport: report });
    } catch (e) {
      // enrichIssues / computeTension / analyzeCharacterArcs / computeForeshadowDensity / computeThreeActRatio
      // 等本地函数若因 chapters 数据异常抛错，原 try/finally 会让异常向上冒泡到调用方，
      // 且用户看不到错误。这里 catch 并 toast 上报，finally 仍保证 loading 复位
      console.error('runOutlinePolish failed:', e);
      if (!req.isStale() && get().currentProjectId === currentProjectId) {
        toast.error('大纲打磨失败', getErrorMessage(e));
      }
    } finally {
      // 仅当本次仍是最新请求时才复位 loading：否则会把后续请求的 loading 状态清掉
      if (!req.isStale()) set({ isPolishingOutline: false });
    }
  },

  ignoreOutlineIssue: (issueId: string) => {
    const report = get().lastOutlineReport;
    if (!report) return;
    set({
      lastOutlineReport: {
        ...report,
        issues: report.issues.map(i =>
          i.id === issueId ? { ...i, ignored: !i.ignored } : i
        ),
      },
    });
  },

  resolveOutlineIssue: (issueId: string) => {
    const report = get().lastOutlineReport;
    if (!report) return;
    set({
      lastOutlineReport: {
        ...report,
        issues: report.issues.map(i =>
          i.id === issueId ? { ...i, resolved: !i.resolved } : i
        ),
      },
    });
  },

  batchResolveOutlineIssues: (issueIds?: string[]) => {
    const report = get().lastOutlineReport;
    if (!report) return;
    const targetIds = issueIds && issueIds.length > 0
      ? new Set(issueIds)
      : new Set(report.issues.filter(i => !i.ignored && !i.resolved).map(i => i.id));
    if (targetIds.size === 0) return;
    set({
      lastOutlineReport: {
        ...report,
        issues: report.issues.map(i =>
          targetIds.has(i.id) ? { ...i, resolved: true } : i
        ),
      },
    });
  },

  saveOutlineSnapshot: (label: string) => {
    const { chapters, currentProjectId, outlineSnapshots } = get();
    if (!currentProjectId) return null;

    const snapshot: OutlineSnapshot = {
      id: generateId(),
      projectId: currentProjectId,
      createdAt: new Date().toISOString(),
      label: label.trim() || `快照 ${new Date().toLocaleString('zh-CN')}`,
      chapters: chapters.map(c => ({
        id: c.id,
        parentId: c.parentId,
        order: c.order,
        level: c.level,
        levelType: c.levelType,
        title: c.title,
        summary: c.summary,
      })),
    };

    // 超出上限时淘汰最旧（按 createdAt 升序）
    const updated = [snapshot, ...outlineSnapshots]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_OUTLINE_SNAPSHOTS);
    set({ outlineSnapshots: updated });
    markDirty();
    return snapshot;
  },

  deleteOutlineSnapshot: (snapshotId: string) => {
    const { outlineSnapshots } = get();
    set({ outlineSnapshots: outlineSnapshots.filter(s => s.id !== snapshotId) });
    markDirty();
  },

  restoreOutlineSnapshot: (snapshotId: string) => {
    const { outlineSnapshots, chapters, currentChapterId, contentEpoch } = get();
    const snapshot = outlineSnapshots.find(s => s.id === snapshotId);
    if (!snapshot) return;

    // 仅恢复结构字段：parentId / order / level / levelType / title / summary
    // 不触及 content / wordCount / status / characterFocus / keyEvents / foreshadows / notes
    // 避免覆盖用户已经写好的正文
    const snapshotMap = new Map(snapshot.chapters.map(c => [c.id, c]));
    const updatedChapters = chapters.map(ch => {
      const snap = snapshotMap.get(ch.id);
      if (!snap) return ch;
      return {
        ...ch,
        parentId: snap.parentId,
        order: snap.order,
        level: snap.level,
        levelType: snap.levelType,
        title: snap.title,
        summary: snap.summary,
        updatedAt: new Date().toISOString(),
      };
    });

    set({
      chapters: updatedChapters,
      contentEpoch: contentEpoch + 1,
    });

    // 当前章节若仍存在，保持选中；若已被快照中删除（实际未删除章节，仅改结构），无需切换
    if (currentChapterId && !updatedChapters.find(c => c.id === currentChapterId)) {
      set({ currentChapterId: null });
    }
    markDirty();
    // 恢复快照改变了 chapters 的 order/parentId/title/summary，会影响伏笔的
    // chaptersSinceMention 计算（依赖章节顺序与正文/摘要文本匹配），需重算
    get().recomputeForeshadowMentions();
  },

  fetchOutlineExpansion: async (chapterId: string) => {
    const { chapters, characters, outlineExpansionCache, currentProjectId } = get();
    const cached = outlineExpansionCache[chapterId];
    if (cached && cached.length > 0) return cached;

    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return [];

    // 后续章节（order 更大的同级章节），用于生成连锁影响
    const subsequentChapters = chapters
      .filter(c => c.parentId === chapter.parentId && c.order > chapter.order)
      .sort((a, b) => a.order - b.order)
      .slice(0, 5);

    // 项目切换守卫：用户切项目后，旧项目的扩展方案不应写入新项目的 cache
    const req = beginRequest(`outlineExpansion:${chapterId}`);
    try {
      const options = await expandOutlineNode(chapter, characters, subsequentChapters);
      // 期间若有新请求进入或项目已切换，丢弃本次结果
      if (req.isStale()) return [];
      if (get().currentProjectId !== currentProjectId) return [];
      // 章节可能已被删除
      if (!get().chapters.find(c => c.id === chapterId)) return [];
      set({
        outlineExpansionCache: { ...get().outlineExpansionCache, [chapterId]: options },
      });
      return options;
    } catch (e) {
      console.warn('fetchOutlineExpansion failed:', e);
      toast.error('大纲展开失败', e instanceof Error ? e.message : 'AI 服务异常，请稍后重试');
      return [];
    }
  },

  clearOutlineExpansionCache: (chapterId?: string) => {
    const { outlineExpansionCache } = get();
    if (!chapterId) {
      set({ outlineExpansionCache: {} });
      return;
    }
    if (outlineExpansionCache[chapterId]) {
      const next = { ...outlineExpansionCache };
      delete next[chapterId];
      set({ outlineExpansionCache: next });
    }
  },

  getOutlineReport: () => get().lastOutlineReport,

  // ===== 大纲打磨扩展域 actions =====

  lockCoreDriver: (driver: CoreDriver) => {
    // 锁定新驱动时清空旧 conflictCompass：旧罗盘基于上一驱动生成，
    // 保留会误导用户以为是新驱动的冲突结构。与 unlockCoreDriver 对称。
    set({ coreDriver: driver, conflictCompass: [] });
    markDirty();
  },

  unlockCoreDriver: () => {
    set({ coreDriver: null, conflictCompass: [] });
    markDirty();
  },

  fetchConflictCompass: async () => {
    const { coreDriver, characters, currentProjectId } = get();
    if (!coreDriver) return;
    const req = beginRequest('conflictCompass');
    try {
      const layers = await generateConflictCompass(coreDriver.description, characters);
      // 期间若再次触发或驱动被解锁/重锁，丢弃本次结果
      if (req.isStale()) return;
      if (!get().coreDriver) return; // 项目切换/解锁后 coreDriver 已清空
      // 项目切换守卫：新项目也可能锁了 coreDriver，仅靠 coreDriver 存在性判断会污染新项目
      if (get().currentProjectId !== currentProjectId) return;
      set({ conflictCompass: layers });
    } catch (e) {
      console.warn('fetchConflictCompass failed:', e);
      toast.error('冲突罗盘生成失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 拖拽调整某层冲突权重（0-100）。
   * 加重该层冲突时（weight 提升 ≥15），自动生成对应情节种子追加到该层 seeds，
   * 让创作者拖完即拿到可落地的情节方向（文档：加重某层冲突，自动生成对应情节种子）。
   */
  updateConflictWeight: (layer, weight) => {
    const clamped = Math.max(0, Math.min(100, Math.round(weight)));
    const { conflictCompass } = get();
    const target = conflictCompass.find(l => l.layer === layer);
    if (!target) return;
    const prevWeight = target.weight ?? 50;
    const updated = conflictCompass.map(l =>
      l.layer === layer ? { ...l, weight: clamped } : l,
    );
    // 加重 ≥15：自动生成对应情节种子追加（启发式，基于层级类型与描述）
    const increased = clamped - prevWeight;
    if (increased >= 15) {
      const newSeed = generateConflictSeed(layer, target.description, clamped);
      const targetUpdated = updated.find(l => l.layer === layer);
      if (targetUpdated && !targetUpdated.seeds.includes(newSeed)) {
        updated[updated.indexOf(targetUpdated)] = {
          ...targetUpdated,
          seeds: [...targetUpdated.seeds, newSeed],
        };
      }
      toast.info('冲突加重，已生成情节种子', `${LAYER_LABELS[layer]}：${newSeed}`);
    }
    set({ conflictCompass: updated });
    markDirty();
  },

  fetchStructureVariants: async () => {
    const { currentProjectId, projects, materials } = get();
    if (!currentProjectId) return;
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return;
    const req = beginRequest('structureVariants');
    try {
      const variants = await generateStructureVariants(project.title, project.description, materials);
      if (req.isStale()) return;
      // 项目切换后不再写入（currentProjectId 变化即说明用户已切走）
      if (get().currentProjectId !== currentProjectId) return;
      set({ structureVariants: variants });
    } catch (e) {
      console.warn('fetchStructureVariants failed:', e);
      toast.error('结构变体生成失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  generateBeatsForChapter: async (chapterId: string) => {
    const { chapters, characters, updateChapter, currentProjectId } = get();
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;
    const req = beginRequest(`beats:${chapterId}`);
    try {
      const beats = await generateChapterBeats(chapter, characters);
      if (req.isStale()) return;
      // 项目切换/章节删除后不再写入，避免污染新项目或抛错
      if (get().currentProjectId !== currentProjectId) return;
      if (!get().chapters.find(c => c.id === chapterId)) return;
      updateChapter(chapterId, { beats });
    } catch (e) {
      console.warn('generateBeatsForChapter failed:', e);
      toast.error('章节节拍生成失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  updateChapterBeat: (chapterId: string, beatType: ChapterBeat['type'], content: string) => {
    const { chapters, updateChapter } = get();
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) return;
    const beats = [...(chapter.beats || [])];
    const idx = beats.findIndex(b => b.type === beatType);
    if (idx >= 0) {
      beats[idx] = { ...beats[idx], content };
    } else {
      beats.push({ type: beatType, content });
    }
    updateChapter(chapterId, { beats });
  },

  toggleBeatLock: (chapterId: string, beatType: ChapterBeat['type']) => {
    const { chapters, updateChapter } = get();
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter?.beats) return;
    const beats = chapter.beats.map(b =>
      b.type === beatType ? { ...b, locked: !b.locked } : b
    );
    updateChapter(chapterId, { beats });
  },

  runCausalPreview: async (changeDescription: string, targetId: string) => {
    const { chapters, characters, foreshadows, currentProjectId } = get();
    const req = beginRequest('causalPreview');
    try {
      const report = await previewCausalImpact(
        changeDescription,
        targetId,
        chapters,
        characters,
        foreshadows,
      );
      if (req.isStale()) return;
      // 项目切换后不再写入，避免旧项目的推演报告残留到新项目
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastCausalImpact: report });
    } catch (e) {
      console.warn('runCausalPreview failed:', e);
      toast.error('因果推演失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  clearCausalImpact: () => set({ lastCausalImpact: null }),

  // ===== 规格书第四、五阶段扩展域 actions（节奏压力 / 草蛇灰线看板 / 版本对比 / 人物弧光 / 关系温度）=====

  runPacingPressureTest: async (scope: 'all' | string = 'all') => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return;
    // 局部测试：仅测试选中章节（及子章节），与 runOutlinePolish 的 scope 语义一致
    const scopedChapters = scope === 'all'
      ? chapters
      : chapters.filter(c => c.id === scope || isDescendant(chapters, c.id, scope));
    const req = beginRequest('pacingPressure');
    try {
      const report = await runPacingPressureTest(scopedChapters);
      // 期间若有新请求进入或项目已切换，丢弃本次结果
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastPacingReport: report });
    } catch (e) {
      console.warn('runPacingPressureTest failed:', e);
      toast.error('节奏压力测试失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 手动调校某章的节奏能量值（规格书第四阶段：可交互节奏调校）。
   * 创作者根据对故事的判断微调 external/emotional/isBuffer，曲线实时更新，
   * 但不触发 AI 重新检测（避免覆盖人工判断）。total 由 external+emotional 自动重算。
   */
  updatePacingPoint: (chapterId: string, updates: Partial<Pick<PacingPressurePoint, 'external' | 'emotional' | 'isBuffer'>>) => {
    const report = get().lastPacingReport;
    if (!report) return;
    const nextPoints = report.points.map(p => {
      if (p.chapterId !== chapterId) return p;
      const external = updates.external !== undefined ? Math.min(100, Math.max(0, Math.round(updates.external))) : p.external;
      const emotional = updates.emotional !== undefined ? Math.min(100, Math.max(0, Math.round(updates.emotional))) : p.emotional;
      const isBuffer = updates.isBuffer !== undefined ? updates.isBuffer : p.isBuffer;
      return { ...p, external, emotional, isBuffer, total: external + emotional };
    });
    set({ lastPacingReport: { ...report, points: nextPoints } });
  },

  /** 重置某章节奏值为 AI 检测的原始值（需保存原始快照，此处简化为清空整个报告让用户重测） */
  resetPacingPoint: (chapterId: string) => {
    const report = get().lastPacingReport;
    if (!report) return;
    // 标记该章为"待重测"——实际重置需用户重新运行检测；此处仅清空该点数值归 0
    const nextPoints = report.points.map(p =>
      p.chapterId === chapterId ? { ...p, external: 0, emotional: 0, isBuffer: false, total: 0 } : p,
    );
    set({ lastPacingReport: { ...report, points: nextPoints } });
  },

  getForeshadowBoardItems: (): ForeshadowBoardItem[] => {
    const { foreshadows, chapters } = get();
    // 当前进度参考：取 order 最大的章节作为"当前章节"，用于判定逾期
    const currentOrder = chapters.length > 0
      ? Math.max(...chapters.map(c => c.order))
      : 0;
    const chapterById = new Map(chapters.map(c => [c.id, c]));

    return foreshadows.map(f => {
      const plantedChapter = f.plantedChapterId ? chapterById.get(f.plantedChapterId) : undefined;
      const payoffChapter = f.payoffChapterId ? chapterById.get(f.payoffChapterId) : undefined;

      let group: ForeshadowBoardItem['group'] = 'pending';
      let overdueChapters = 0;
      if (f.status === 'paid-off') {
        group = 'paidoff';
      } else if (f.status === 'progressing') {
        // 推进中：用户显式标记正在回收推进
        group = 'progressing';
      } else if (payoffChapter && currentOrder > payoffChapter.order) {
        // 已越过预设回收章节但尚未标记回收 → 逾期
        group = 'overdue';
        overdueChapters = currentOrder - payoffChapter.order;
      }

      return {
        foreshadowId: f.id,
        title: f.title,
        group,
        plantedChapterTitle: plantedChapter?.title,
        payoffChapterTitle: payoffChapter?.title,
        overdueChapters,
        priority: f.priority,
        // 关联角色返回 ID 列表，UI 层自行映射为名字
        relatedCharacters: f.relatedCharacters,
      };
    });
  },

  compareSnapshots: (oldSnapshotId: string, newSnapshotId: string): VersionDiffReport | null => {
    const { outlineSnapshots } = get();
    const oldSnap = outlineSnapshots.find(s => s.id === oldSnapshotId);
    const newSnap = outlineSnapshots.find(s => s.id === newSnapshotId);
    if (!oldSnap || !newSnap) return null;

    const oldMap = new Map(oldSnap.chapters.map(c => [c.id, c]));
    const newMap = new Map(newSnap.chapters.map(c => [c.id, c]));
    const diffs: VersionDiffEntry[] = [];

    // added: 新快照有但旧快照没有
    for (const newCh of newSnap.chapters) {
      if (!oldMap.has(newCh.id)) {
        diffs.push({
          field: `章节[${newCh.title}]`,
          oldValue: '',
          newValue: '新增章节',
          changeType: 'added',
        });
      }
    }

    // removed: 旧快照有但新快照没有
    for (const oldCh of oldSnap.chapters) {
      if (!newMap.has(oldCh.id)) {
        diffs.push({
          field: `章节[${oldCh.title}]`,
          oldValue: '删除章节',
          newValue: '',
          changeType: 'removed',
        });
      }
    }

    // modified: 都有但 title/summary/order/levelType 变化
    for (const newCh of newSnap.chapters) {
      const oldCh = oldMap.get(newCh.id);
      if (!oldCh) continue;
      if (oldCh.title !== newCh.title) {
        diffs.push({
          field: `章节[${newCh.title}].title`,
          oldValue: oldCh.title,
          newValue: newCh.title,
          changeType: 'modified',
        });
      }
      if (oldCh.summary !== newCh.summary) {
        diffs.push({
          field: `章节[${newCh.title}].summary`,
          oldValue: oldCh.summary,
          newValue: newCh.summary,
          changeType: 'modified',
        });
      }
      if (oldCh.order !== newCh.order) {
        diffs.push({
          field: `章节[${newCh.title}].order`,
          oldValue: String(oldCh.order),
          newValue: String(newCh.order),
          changeType: 'modified',
        });
      }
      if (oldCh.levelType !== newCh.levelType) {
        diffs.push({
          field: `章节[${newCh.title}].levelType`,
          oldValue: oldCh.levelType,
          newValue: newCh.levelType,
          changeType: 'modified',
        });
      }
    }

    return {
      oldSnapshotId,
      newSnapshotId,
      diffs,
      generatedAt: new Date().toISOString(),
    };
  },

  runCharacterArcCheck: async () => {
    const { chapters, characters, currentProjectId } = get();
    if (!currentProjectId) return;
    const req = beginRequest('characterArcCheck');
    try {
      const issues = await analyzeCharacterArcIssues(chapters, characters);
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastArcIssues: issues });

      // 扩展：在现有 analyzeCharacterArcIssues 调用后，再调用 analyzeCharacterArcCurves，
      // 结果写入 lastArcCurves（try/catch 包裹，失败不阻断 issues）
      try {
        const curves = await analyzeCharacterArcCurves({ chapters, characters });
        if (req.isStale()) return;
        if (get().currentProjectId !== currentProjectId) return;
        set({ lastArcCurves: curves });
      } catch (e2) {
        console.warn('analyzeCharacterArcCurves failed (non-blocking):', e2);
      }
    } catch (e) {
      console.warn('runCharacterArcCheck failed:', e);
      toast.error('人物弧光校验失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 执行角色维度情感一致性校验（规格书阶段4-5）。
   * 检测相邻章节同一角色的情绪跳转幅度（>50 为突兀），
   * 结果写入 lastCharacterEmotionReport（含 issues + curves）。
   */
  runCharacterEmotionConsistencyCheck: async () => {
    const { chapters, characters, currentProjectId } = get();
    if (!currentProjectId) return;
    const req = beginRequest('characterEmotionConsistency');
    try {
      const report = await analyzeCharacterEmotionConsistency({ chapters, characters });
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastCharacterEmotionReport: report });
      if (report.issues.length > 0) {
        toast.warning('角色情感一致性校验完成', `检测到 ${report.issues.length} 处情绪跳转突兀`);
      } else {
        toast.success('角色情感一致性校验完成', '未检测到相邻章节情绪跳转突兀');
      }
    } catch (e) {
      console.warn('runCharacterEmotionConsistencyCheck failed:', e);
      toast.error('角色情感一致性校验失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 请求节奏调校 AI 建议（规格书阶段4-2）。
   * 根据 chapterId 找到章节，调用 generatePacingAdjustmentAdvice，
   * 结果写入 lastPacingAdvice，供 UI 在弹层中展示。
   */
  requestPacingAdvice: async (chapterId, dimension, direction, delta) => {
    const { chapters, currentProjectId } = get();
    if (!currentProjectId) return;
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter) {
      toast.warning('未找到章节', '无法生成节奏调校建议');
      return;
    }
    const req = beginRequest(`pacingAdvice:${chapterId}`);
    try {
      const advice = await generatePacingAdjustmentAdvice({ chapter, dimension, direction, delta });
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastPacingAdvice: advice });
    } catch (e) {
      console.warn('requestPacingAdvice failed:', e);
      toast.error('节奏调校建议生成失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 应用节奏调校建议（规格书阶段4-2）。
   * 清空 lastPacingAdvice + 调用 recordPolishAction('pacing') 记录打磨动作。
   * 用 get() 跨域调用 recordPolishAction（参考现有 recordPolishAction 用法）。
   */
  applyPacingAdvice: () => {
    set({ lastPacingAdvice: null });
    try {
      get().recordPolishAction('pacing');
    } catch (e) {
      console.warn('applyPacingAdvice recordPolishAction failed:', e);
    }
  },

  /** 清空节奏调校建议 */
  clearPacingAdvice: () => set({ lastPacingAdvice: null }),

  analyzeRelationship: async (characterAId: string, characterBId: string) => {
    const { chapters, characters, currentProjectId } = get();
    if (!currentProjectId) return;
    const charA = characters.find(c => c.id === characterAId);
    const charB = characters.find(c => c.id === characterBId);
    if (!charA || !charB) return;
    // key 含两个角色 ID，避免不同角色对的请求互相挤掉
    const req = beginRequest(`relationship:${characterAId}:${characterBId}`);
    try {
      const curve = await analyzeRelationshipTemperature(chapters, charA, charB);
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastRelationshipCurve: curve });
    } catch (e) {
      console.warn('analyzeRelationship failed:', e);
      toast.error('关系温度分析失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  runReaderEmpathyCheck: async (scope: 'all' | string = 'all') => {
    const { chapters, characters, foreshadows, currentProjectId } = get();
    if (!currentProjectId) return;
    // 局部校验：仅校验选中章节（及子章节），与 runOutlinePolish 的 scope 语义一致
    const scopedChapters = scope === 'all'
      ? chapters
      : chapters.filter(c => c.id === scope || isDescendant(chapters, c.id, scope));
    const req = beginRequest('readerEmpathy');
    try {
      // 扩展：传入 foreshadows，启用 suspense-forget 等四项读者留存视角检测
      const report = await analyzeReaderEmpathy(scopedChapters, characters, foreshadows);
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      set({ lastReaderEmpathyReport: { ...report, scope } });
    } catch (e) {
      console.warn('runReaderEmpathyCheck failed:', e);
      toast.error('读者共情校验失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 捕获当前诊断报告为沙盒试运行基线（修改前快照 + 大纲副本）。
   * 同时深拷贝 chapters/foreshadows，用于不满意时回退到修改前状态。
   * 创作者在"发现问题"后点击此按钮锁定基线，随后就地修改大纲，
   * 修改完成后再调 runSandboxVerification 对比前后状态，验证闭环。
   * 不满意可调 restoreSandboxBaseline 回退。
   */
  captureSandboxBaseline: () => {
    const report = get().lastOutlineReport;
    if (!report) {
      toast.warning('请先运行一次诊断', '还没有诊断报告可作为基线');
      return;
    }
    const { chapters, foreshadows } = get();
    set({
      sandboxBaseline: buildTrialSnapshot(report),
      sandboxBaselineChapters: chapters.map(c => ({ ...c })),
      sandboxBaselineForeshadows: foreshadows.map(f => ({ ...f })),
      lastSandboxReport: null,
    });
    toast.success('已捕获试运行基线', '大纲副本已保存，修改后可一键回退到此刻状态');
  },

  clearSandboxBaseline: () => {
    set({
      sandboxBaseline: null,
      sandboxBaselineChapters: null,
      sandboxBaselineForeshadows: null,
      lastSandboxReport: null,
    });
  },

  /**
   * 回退到沙盒基线：用基线副本覆盖当前 chapters/foreshadows。
   * 用于试运行后对修改不满意，想撤销所有改动回到基线状态。
   * 同时记录到全局撤销栈，支持 Ctrl+Z 撤销此次回退。
   */
  restoreSandboxBaseline: () => {
    const { sandboxBaselineChapters, sandboxBaselineForeshadows } = get();
    if (!sandboxBaselineChapters && !sandboxBaselineForeshadows) {
      toast.warning('没有可回退的基线', '请先点击"开始试运行"捕获基线');
      return;
    }
    const prevChapters = get().chapters;
    const prevForeshadows = get().foreshadows;
    set({
      chapters: sandboxBaselineChapters ?? prevChapters,
      foreshadows: sandboxBaselineForeshadows ?? prevForeshadows,
    });
    markDirty();
    get().recomputeForeshadowMentions();
    // 记录到全局撤销栈：可撤销此次回退
    get().pushUndo({
      kind: 'chapter-update',
      description: '回退到沙盒试运行基线',
      undo: () => {
        set({ chapters: prevChapters, foreshadows: prevForeshadows });
        markDirty();
        get().recomputeForeshadowMentions();
      },
    });
    toast.success('已回退到试运行基线', '当前大纲已恢复为修改前状态（可 Ctrl+Z 撤销此次回退）');
  },

  /**
   * 运行沙盒验证：重新诊断并对基线做前后对比。
   * 流程：重新跑 runOutlinePolish 获取"后"报告 → 与基线 diff → 产出对比报告。
   * 复用 outlinePolish 的并发守卫，避免与正在进行的诊断冲突。
   */
  runSandboxVerification: async (scope: 'all' | string = 'all') => {
    const { currentProjectId, sandboxBaseline } = get();
    if (!currentProjectId) return;
    if (!sandboxBaseline) {
      toast.warning('请先捕获试运行基线', '点击"开始试运行"锁定修改前状态');
      return;
    }
    const req = beginRequest('sandboxVerify');
    try {
      // 复用 runOutlinePolish 获取最新诊断报告
      await get().runOutlinePolish(scope);
      if (req.isStale()) return;
      if (get().currentProjectId !== currentProjectId) return;
      const afterReport = get().lastOutlineReport;
      if (!afterReport) return;
      const after = buildTrialSnapshot(afterReport);
      const report = diffTrialSnapshots(sandboxBaseline, after);
      if (req.isStale()) return;
      set({ lastSandboxReport: report });
      if (report.verdict === 'improved') {
        toast.success('验证闭环完成', `解决 ${report.resolvedIssues.length} 个问题，新增 ${report.newIssues.length} 个`);
      } else if (report.verdict === 'regressed') {
        toast.warning('验证闭环完成', `新增 ${report.newIssues.length} 个问题，仅解决 ${report.resolvedIssues.length} 个，需复核`);
      } else {
        toast.info('验证闭环完成', `问题数量无净变化（解决 ${report.resolvedIssues.length}·新增 ${report.newIssues.length}）`);
      }
    } catch (e) {
      console.warn('runSandboxVerification failed:', e);
      toast.error('沙盒验证失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 运行伏笔回收合理性检测（规格书阶段4-4）。
   * 仅检测已标记 paid-off 且有回收章节的伏笔，判断回收章节是否真正呼应埋设内容。
   * 结果写入 foreshadowPayoffChecks，UI 据此在已回收栏标注 good/weak/missing。
   */
  runForeshadowPayoffCheck: async () => {
    const { foreshadows, chapters, currentProjectId } = get();
    if (!currentProjectId) return;
    const paidOff = foreshadows.filter(f => f.status === 'paid-off' && f.payoffChapterId);
    if (paidOff.length === 0) {
      set({ foreshadowPayoffChecks: [] });
      toast.info('无需检测', '当前没有已回收伏笔');
      return;
    }
    try {
      const results = await checkForeshadowPayoffReasonability({ foreshadows, chapters });
      set({ foreshadowPayoffChecks: results });
      const weak = results.filter(r => r.level === 'weak').length;
      const missing = results.filter(r => r.level === 'missing').length;
      if (weak + missing === 0) {
        toast.success('回收合理性检测完成', `${results.length} 条已回收伏笔全部充分呼应`);
      } else {
        toast.warning('回收合理性检测完成', `${results.length} 条已回收：${missing} 条未呼应、${weak} 条呼应较弱`);
      }
    } catch (e) {
      console.warn('runForeshadowPayoffCheck failed:', e);
      toast.error('回收合理性检测失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  /**
   * 为指定逾期伏笔生成应急回收方案（规格书阶段4-4）。
   * 产出 3 个按成本递增的变体方向，结果写入 emergencyRecoveryPlans。
   */
  generateRecoveryPlan: async (foreshadowId: string) => {
    const { foreshadows, chapters, characters, currentProjectId } = get();
    if (!currentProjectId) return;
    const foreshadow = foreshadows.find(f => f.id === foreshadowId);
    if (!foreshadow) return;
    try {
      const plan = await generateEmergencyRecoveryPlan({ foreshadow, chapters, characters });
      // 替换同 ID 的旧方案，保留其余
      const rest = get().emergencyRecoveryPlans.filter(p => p.foreshadowId !== foreshadowId);
      set({ emergencyRecoveryPlans: [...rest, plan] });
    } catch (e) {
      console.warn('generateRecoveryPlan failed:', e);
      toast.error('应急方案生成失败', e instanceof Error ? e.message : 'AI 服务异常');
    }
  },

  clearForeshadowChecks: () => {
    set({ foreshadowPayoffChecks: [], emergencyRecoveryPlans: [] });
  },
});

/** 判断 targetId 是否为 ancestorId 的后代（含跨多级） */
function isDescendant(chapters: Chapter[], targetId: string, ancestorId: string): boolean {
  let parentId = chapters.find(c => c.id === targetId)?.parentId ?? null;
  const guard = new Set<string>(); // 防御环状结构导致死循环
  while (parentId) {
    if (parentId === ancestorId) return true;
    if (guard.has(parentId)) return false;
    guard.add(parentId);
    parentId = chapters.find(c => c.id === parentId)?.parentId ?? null;
  }
  return false;
}

/**
 * 从诊断报告构建沙盒试运行快照（含多维指标：节奏/弧光/伏笔/逻辑/钩子）。
 * 用于前后对比，避免持有完整报告引用。
 */
function buildTrialSnapshot(report: OutlinePolishReport): SandboxTrialSnapshot {
  const activeIssues = report.issues.filter(i => !i.ignored && !i.resolved);
  const errorCount = activeIssues.filter(i => i.severity === 'error').length;
  const warningCount = activeIssues.filter(i => i.severity === 'warning' || i.severity === 'info').length;

  // 节奏曲线统计：均值与方差
  const tensions = report.pacingCurve.map(p => p.tension).filter(t => typeof t === 'number');
  const pacingMean = tensions.length > 0 ? tensions.reduce((a, b) => a + b, 0) / tensions.length : 0;
  const pacingVariance = tensions.length > 0
    ? tensions.reduce((sum, t) => sum + Math.pow(t - pacingMean, 2), 0) / tensions.length
    : 0;

  // 人物弧光高风险数
  const characterArcRiskCount = report.characterArcs.filter(a => a.risk === 'high').length;

  // 伏笔状态统计 + 回收率
  const foreshadowPlanted = report.foreshadowDensity.reduce((s, c) => s + c.planted, 0);
  const foreshadowProgressing = report.foreshadowDensity.reduce((s, c) => s + c.progressing, 0);
  const foreshadowPaidOff = report.foreshadowDensity.reduce((s, c) => s + c.paidOff, 0);
  // 逾期 = planted 且章节距离 > 阈值（这里用 planted - paidOff 近似未回收，简化为统计）
  const foreshadowStats: [number, number, number, number] = [
    foreshadowPlanted, foreshadowProgressing, foreshadowPaidOff, 0,
  ];
  const totalForeshadows = foreshadowPlanted + foreshadowProgressing + foreshadowPaidOff;
  const foreshadowRecoveryRate = totalForeshadows > 0
    ? Math.round((foreshadowPaidOff / totalForeshadows) * 100)
    : 0;

  // 逻辑维度问题数
  const logicIssueCount = activeIssues.filter(i => i.dimension === 'logic').length;

  // 章末钩子强度均值（用 pacingCurve 的 hookStrength 近似，回退到 tension/20）
  const hookStrengths = report.pacingCurve.map(p => (p as { hookStrength?: number }).hookStrength);
  const validHooks = hookStrengths.filter((h): h is number => typeof h === 'number');
  const avgHookStrength = validHooks.length > 0
    ? validHooks.reduce((a, b) => a + b, 0) / validHooks.length
    : pacingMean / 20;

  return {
    capturedAt: new Date().toISOString(),
    totalIssues: activeIssues.length,
    errorCount,
    warningCount,
    threeActRatio: report.threeActRatio,
    totalChapters: report.totalChapters,
    totalWords: report.totalWords,
    issueDigests: activeIssues.map(i => ({
      id: i.id,
      dimension: i.dimension,
      severity: i.severity,
      description: i.description,
      chapterId: i.chapterId,
      chapterTitle: i.chapterTitle,
    })),
    pacingMean: Math.round(pacingMean * 100) / 100,
    pacingVariance: Math.round(pacingVariance * 100) / 100,
    characterArcRiskCount,
    foreshadowStats,
    foreshadowRecoveryRate,
    logicIssueCount,
    avgHookStrength: Math.round(avgHookStrength * 10) / 10,
  };
}

/**
 * 问题对齐键：用 dimension + chapterId + description 做稳定匹配。
 * issue 的 id 在两次诊断间可能不同（AI 重新生成），不能用 id 对齐。
 */
function issueKey(d: SandboxTrialIssueDigest): string {
  return `${d.dimension}::${d.chapterId || ''}::${d.description}`;
}

/**
 * 对比前后两份试运行快照，产出对比报告。
 *
 * 对齐策略：按 dimension + chapterId + description 匹配 issue。
 *   - resolvedIssues：before 有 after 无
 *   - newIssues：after 有 before 无
 *   - remainingIssues：两边都有
 *
 * verdict 判定：
 *   - improved：errorCount 下降，或新增问题数 < 已解决数
 *   - regressed：errorCount 上升，或新增问题数 > 已解决数
 *   - neutral：其余
 */
function diffTrialSnapshots(
  before: SandboxTrialSnapshot,
  after: SandboxTrialSnapshot,
): SandboxTrialReport {
  const beforeMap = new Map(before.issueDigests.map(d => [issueKey(d), d]));
  const afterMap = new Map(after.issueDigests.map(d => [issueKey(d), d]));

  const resolvedIssues: SandboxTrialIssueDigest[] = [];
  const newIssues: SandboxTrialIssueDigest[] = [];
  const remainingIssues: SandboxTrialIssueDigest[] = [];

  for (const [key, d] of beforeMap) {
    if (afterMap.has(key)) {
      remainingIssues.push(d);
    } else {
      resolvedIssues.push(d);
    }
  }
  for (const [key, d] of afterMap) {
    if (!beforeMap.has(key)) {
      newIssues.push(d);
    }
  }

  // 指标变化（含文档要求的多维对比：节奏/弧光/伏笔/逻辑/钩子）
  const metricDeltas: SandboxTrialMetricDelta[] = [
    buildMetricDelta('问题总数', before.totalIssues, after.totalIssues, true),
    buildMetricDelta('必修问题', before.errorCount, after.errorCount, true),
    buildMetricDelta('建议问题', before.warningCount, after.warningCount, true),
    // 节奏均方差：越低越均匀，下降为正向
    buildMetricDelta('节奏均方差', before.pacingVariance, after.pacingVariance, true),
    buildMetricDelta('节奏均值', before.pacingMean, after.pacingMean, false),
    // 人物弧光高风险数：越少越好，下降为正向
    buildMetricDelta('弧光高风险角色', before.characterArcRiskCount, after.characterArcRiskCount, true),
    // 伏笔回收率：越高越好，上升为正向
    buildMetricDelta('伏笔回收率(%)', before.foreshadowRecoveryRate, after.foreshadowRecoveryRate, false),
    // 逻辑问题数：越少越好
    buildMetricDelta('逻辑断裂点', before.logicIssueCount, after.logicIssueCount, true),
    // 章末钩子强度：越高越好
    buildMetricDelta('平均钩子强度', before.avgHookStrength, after.avgHookStrength, false),
    buildMetricDelta('章节数', before.totalChapters, after.totalChapters, false),
    buildMetricDelta('总字数', before.totalWords, after.totalWords, false),
    {
      label: '三幕比例',
      before: before.threeActRatio.join(' / '),
      after: after.threeActRatio.join(' / '),
      direction: before.threeActRatio.join() === after.threeActRatio.join() ? 'same' : 'up',
      positive: before.threeActRatio.join() === after.threeActRatio.join(),
    },
  ];

  // verdict 判定
  const errorDelta = after.errorCount - before.errorCount;
  const netIssueDelta = newIssues.length - resolvedIssues.length;
  let verdict: SandboxTrialReport['verdict'];
  if (errorDelta < 0 || (errorDelta === 0 && netIssueDelta < 0)) {
    verdict = 'improved';
  } else if (errorDelta > 0 || (errorDelta === 0 && netIssueDelta > 0)) {
    verdict = 'regressed';
  } else {
    verdict = 'neutral';
  }

  return {
    generatedAt: new Date().toISOString(),
    before,
    after,
    resolvedIssues,
    newIssues,
    remainingIssues,
    metricDeltas,
    verdict,
  };
}

/** 构建单项指标变化。lowerIsBetter=true 表示数值降低为正向（如问题数）。 */
function buildMetricDelta(
  label: string,
  beforeVal: number,
  afterVal: number,
  lowerIsBetter: boolean,
): SandboxTrialMetricDelta {
  const diff = afterVal - beforeVal;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const positive = diff === 0 ? true : lowerIsBetter ? diff < 0 : diff > 0;
  return { label, before: beforeVal, after: afterVal, direction, positive };
}
