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
  | 'lockCoreDriver' | 'unlockCoreDriver' | 'fetchConflictCompass' | 'fetchStructureVariants'
  | 'generateBeatsForChapter' | 'updateChapterBeat' | 'toggleBeatLock'
  | 'runCausalPreview' | 'clearCausalImpact'>;

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

export const createOutlinePolishSlice: StateCreator<AppState, [], [], OutlinePolishSlice> = (set, get) => ({
  lastOutlineReport: null,
  outlineSnapshots: [],
  isPolishingOutline: false,
  outlineExpansionCache: {},
  coreDriver: null,
  conflictCompass: [],
  structureVariants: [],
  lastCausalImpact: null,

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

    // 项目切换守卫：用户切项目后，旧项目的扩展方案不应写入新项目的 cache
    const req = beginRequest(`outlineExpansion:${chapterId}`);
    try {
      const options = await expandOutlineNode(chapter, characters);
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
