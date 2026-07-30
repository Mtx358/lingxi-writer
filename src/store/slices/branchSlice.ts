/**
 * 版本花园 slice（规格书第五阶段-4：多分支并行试错）
 *
 * 从任意快照分叉出独立创作分支，每条分支持有自己的一份章节结构快照，
 * 可独立发展、与主干对比、合并回主干。分支编辑不污染主干 chapters。
 *
 * 合并主干：把 branch.chapters 的结构字段写回主干 chapters（与 restoreOutlineSnapshot
 * 同构，仅恢复结构，不覆盖正文）。合并后分支状态置为 merged。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { OutlineBranch, BranchDiffReport, BranchMetricDelta, VersionDiffEntry } from '@/types';
import { generateId, markDirty } from '@/utils/storage';
import { toast } from '@/hooks/useToast';

type BranchSlice = Pick<AppState,
  | 'branches' | 'createBranch' | 'updateBranch' | 'deleteBranch'
  | 'mergeBranchToMain' | 'compareBranchWithMain' | 'archiveBranch'>;

const MAX_BRANCHES = 12;

export const createBranchSlice: StateCreator<AppState, [], [], BranchSlice> = (set, get) => ({
  branches: [],

  createBranch: (sourceSnapshotId, name) => {
    const { currentProjectId, outlineSnapshots, branches } = get();
    if (!currentProjectId) return null;
    const source = outlineSnapshots.find(s => s.id === sourceSnapshotId);
    if (!source) {
      toast.error('无法分叉', '找不到来源快照，请先生成一份快照');
      return null;
    }

    const now = new Date().toISOString();
    const branch: OutlineBranch = {
      id: generateId(),
      projectId: currentProjectId,
      name: name.trim() || `分支 ${branches.length + 1}`,
      sourceSnapshotId,
      createdAt: now,
      updatedAt: now,
      // 深拷贝快照章节，避免与快照共享引用
      chapters: source.chapters.map(c => ({ ...c })),
      status: 'active',
    };

    const updated = [branch, ...branches]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_BRANCHES);
    set({ branches: updated });
    markDirty();
    toast.success('已创建分支', `「${branch.name}」从快照「${source.label}」分叉，可独立编辑`);
    return branch;
  },

  updateBranch: (branchId, updates) => {
    const { branches } = get();
    const updated = branches.map(b =>
      b.id === branchId ? { ...b, ...updates, updatedAt: new Date().toISOString() } : b,
    );
    set({ branches: updated });
    markDirty();
  },

  deleteBranch: (branchId) => {
    const { branches } = get();
    const target = branches.find(b => b.id === branchId);
    set({ branches: branches.filter(b => b.id !== branchId) });
    markDirty();
    if (target) toast.info('分支已删除', `「${target.name}」已移除`);
  },

  archiveBranch: (branchId) => {
    const { branches } = get();
    const updated = branches.map(b =>
      b.id === branchId ? { ...b, status: 'archived' as const, updatedAt: new Date().toISOString() } : b,
    ) as OutlineBranch[];
    set({ branches: updated });
    markDirty();
  },

  mergeBranchToMain: (branchId) => {
    const { branches, chapters } = get();
    const branch = branches.find(b => b.id === branchId);
    if (!branch) {
      toast.error('合并失败', '找不到目标分支');
      return false;
    }
    if (branch.status !== 'active') {
      toast.error('合并失败', '该分支已合并或已归档，无法再次合并');
      return false;
    }

    // 合并前快照主干 chapters，用于全局撤销（Ctrl+Z 回退此次合并）
    const prevChapters = chapters;
    const prevBranchStatus = branch.status;

    // 与 restoreOutlineSnapshot 同构：仅恢复结构字段，不覆盖正文
    const branchMap = new Map(branch.chapters.map(c => [c.id, c]));
    const updatedChapters = chapters.map(ch => {
      const bc = branchMap.get(ch.id);
      if (!bc) return ch;
      return {
        ...ch,
        parentId: bc.parentId,
        order: bc.order,
        level: bc.level,
        levelType: bc.levelType,
        title: bc.title,
        summary: bc.summary,
        updatedAt: new Date().toISOString(),
      };
    });

    const updatedBranches = branches.map(b =>
      b.id === branchId ? { ...b, status: 'merged' as const, updatedAt: new Date().toISOString() } : b,
    ) as OutlineBranch[];
    set({ chapters: updatedChapters, branches: updatedBranches });
    markDirty();

    // 记录到全局撤销栈：恢复主干 chapters + 分支状态回 active
    get().pushUndo({
      kind: 'branch-merge',
      description: `合并分支「${branch.name}」到主干`,
      undo: () => {
        const cur = get();
        const restoredBranches = cur.branches.map(b =>
          b.id === branchId ? { ...b, status: prevBranchStatus, updatedAt: new Date().toISOString() } : b,
        ) as OutlineBranch[];
        set({ chapters: prevChapters, branches: restoredBranches });
        markDirty();
        cur.recomputeForeshadowMentions?.();
      },
    });

    toast.success('分支已合并回主干', `「${branch.name}」的结构已写回主干，正文未被覆盖（可 Ctrl+Z 撤销）`);
    return true;
  },

  compareBranchWithMain: (branchId) => {
    const { branches, chapters } = get();
    const branch = branches.find(b => b.id === branchId);
    if (!branch) return null;

    const mainMap = new Map(chapters.map(c => [c.id, c]));
    const branchMap = new Map(branch.chapters.map(c => [c.id, c]));
    const allIds = new Set<string>([...mainMap.keys(), ...branchMap.keys()]);

    const diffs: VersionDiffEntry[] = [];
    for (const id of allIds) {
      const main = mainMap.get(id);
      const bc = branchMap.get(id);
      const mainTitle = main?.title ?? '';
      const branchTitle = bc?.title ?? '';
      if (!main && bc) {
        diffs.push({ field: bc.title || id, oldValue: '', newValue: branchTitle, changeType: 'added' });
      } else if (main && !bc) {
        diffs.push({ field: main.title || id, oldValue: mainTitle, newValue: '', changeType: 'removed' });
      } else if (main && bc && main.title !== bc.title) {
        diffs.push({ field: mainTitle || id, oldValue: mainTitle, newValue: branchTitle, changeType: 'modified' });
      }
    }

    // 关键指标（数量级层面）
    const mainCount = chapters.filter(c => c.levelType === 'chapter').length;
    const branchCount = branch.chapters.filter(c => c.levelType === 'chapter').length;
    const mainWords = chapters.filter(c => c.levelType === 'chapter').reduce((s, c) => s + c.wordCount, 0);
    const branchWords = branch.chapters.filter(c => c.levelType === 'chapter').reduce((s, c) => s + (c.summary?.length || 0) * 50, 0);

    // 质量指标（规格书阶段5-4：「双栏展示 + 质量指标变化对比」）
    //   - 节奏均方差：每章张力估算（wordCount 归一化 + 标题张力关键词加权）的标准差，越低越均匀
    //   - 伏笔回收率：分支中涉及的伏笔，最后出现在后 1/3 章节的视为已回收
    //   - 平均章末钩子强度：每章估算 0-5，取平均
    const mainChapters = chapters
      .filter(c => c.levelType === 'chapter')
      .sort((a, b) => a.order - b.order);
    const branchChapters = branch.chapters
      .filter(c => c.levelType === 'chapter')
      .sort((a, b) => a.order - b.order);

    const mainTension = mainChapters.map(estimateChapterTension);
    const branchTension = branchChapters.map(estimateChapterTension);
    const mainPacingStd = stddev(mainTension);
    const branchPacingStd = stddev(branchTension);
    const mainHook = average(mainChapters.map(estimateHookStrength));
    const branchHook = average(branchChapters.map(estimateHookStrength));

    // 伏笔回收率：基于章节 foreshadows 字段（伏笔 ID 列表）估算
    const foreshadows = get().foreshadows;
    const mainRecovery = estimateForeshadowRecovery(mainChapters, foreshadows);
    const branchRecovery = estimateForeshadowRecovery(branchChapters, foreshadows);

    const metrics: BranchMetricDelta[] = [
      {
        label: '章节数',
        baseValue: mainCount,
        branchValue: branchCount,
        direction: branchCount > mainCount ? 'up' : branchCount < mainCount ? 'down' : 'same',
        positive: branchCount >= mainCount,
      },
      {
        label: '结构改动',
        baseValue: 0,
        branchValue: diffs.length,
        direction: diffs.length > 0 ? 'up' : 'same',
        positive: diffs.length === 0,
      },
      {
        label: '预估字数',
        baseValue: mainWords,
        branchValue: branchWords,
        direction: branchWords > mainWords ? 'up' : branchWords < mainWords ? 'down' : 'same',
        positive: branchWords >= mainWords,
      },
      // 质量指标：节奏均方差越低越好（positive = 分支更低）
      {
        label: '节奏均方差',
        baseValue: Number(mainPacingStd.toFixed(2)),
        branchValue: Number(branchPacingStd.toFixed(2)),
        direction: branchPacingStd > mainPacingStd ? 'up' : branchPacingStd < mainPacingStd ? 'down' : 'same',
        positive: branchPacingStd <= mainPacingStd,
      },
      // 质量指标：伏笔回收率越高越好
      {
        label: '伏笔回收率',
        baseValue: `${Math.round(mainRecovery * 100)}%`,
        branchValue: `${Math.round(branchRecovery * 100)}%`,
        direction: branchRecovery > mainRecovery ? 'up' : branchRecovery < mainRecovery ? 'down' : 'same',
        positive: branchRecovery >= mainRecovery,
      },
      // 质量指标：平均章末钩子强度（0-5）越高越好
      {
        label: '章末钩子强度',
        baseValue: Number(mainHook.toFixed(1)),
        branchValue: Number(branchHook.toFixed(1)),
        direction: branchHook > mainHook ? 'up' : branchHook < mainHook ? 'down' : 'same',
        positive: branchHook >= mainHook,
      },
    ];

    const report: BranchDiffReport = {
      branchId,
      baseLabel: '主干（当前）',
      branchLabel: branch.name,
      generatedAt: new Date().toISOString(),
      diffs,
      metrics,
    };
    return report;
  },
});

// ===== 分支质量指标启发式估算工具 =====

// 标题张力关键词：出现这些词时给章节张力加分
const HIGH_TENSION_KEYWORDS = ['高潮', '决斗', '真相', '惊变', '陨落', '背叛', '决战', '反杀', '危机', '生死', '爆发', '逆转'];
const LOW_TENSION_KEYWORDS = ['日常', '铺垫', '过渡', '闲谈', '小憩', '休整'];

/** 章节张力估算（0-100）：wordCount 归一化 + 标题张力关键词加权
 *  wordCount 可选：主干章节有字数，分支章节是 Pick 类型不含 wordCount，
 *  缺失时用 summary 长度估算字数（概要越长 → 规划信息量越大 → 估算正文越长），
 *  让分支内部各章张力差异能体现，避免字数维度恒为 0 导致均方差系统性偏低。 */
function estimateChapterTension(c: { title: string; wordCount?: number; summary?: string }): number {
  // 字数维度：5000 字 ≈ 张力 50，1 万字 ≈ 张力 80
  // 分支无 wordCount 时，用 summary 长度 × 50 估算（100 字概要 ≈ 5000 字正文）
  const wc = c.wordCount ?? (c.summary ? c.summary.length * 50 : 0);
  const wordTension = Math.min(80, (wc / 5000) * 50);
  // 标题关键词维度
  const titleHit = HIGH_TENSION_KEYWORDS.some(k => c.title.includes(k)) ? 25 : 0;
  const titleLow = LOW_TENSION_KEYWORDS.some(k => c.title.includes(k)) ? -15 : 0;
  // 摘要里出现高强度关键词再补一些
  const summaryHit = c.summary && HIGH_TENSION_KEYWORDS.some(k => c.summary!.includes(k)) ? 10 : 0;
  return Math.max(5, Math.min(100, Math.round(wordTension + titleHit + titleLow + summaryHit + 15)));
}

/** 章末钩子强度估算（0-5）：基于章节张力映射 + 标题悬念关键词 */
function estimateHookStrength(c: { title: string; wordCount?: number; summary?: string }): number {
  const tension = estimateChapterTension(c);
  // 张力 80+ → 钩子 5；张力 60+ → 4；张力 40+ → 3；张力 20+ → 2；否则 1
  const fromTension = tension >= 80 ? 5 : tension >= 60 ? 4 : tension >= 40 ? 3 : tension >= 20 ? 2 : 1;
  // 标题悬念关键词加成（？/ 未解 / 谜 / 影 / 影子 / 暗中）
  const hookKeywords = ['？', '?', '未解', '谜', '影', '暗中', '幕后', '消失', '谁', '为何'];
  const hookBonus = hookKeywords.some(k => c.title.includes(k)) ? 0.5 : 0;
  return Math.min(5, Number((fromTension + hookBonus).toFixed(1)));
}

/** 伏笔回收率估算
 *  主干路径：章节有 foreshadows 字段时，按伏笔最后出现的相对位置判断（后 1/3 视为回收）。
 *  分支路径：分支章节是 Pick 类型不含 foreshadows，改用 payoffChapterId 是否仍存在于
 *           分支章节列表来判断——分支删掉回收章节会让该伏笔在分支里算未回收，
 *           从而让"伏笔回收率"指标能反映分支结构变化的真实影响，而非与主干恒等。 */
function estimateForeshadowRecovery(
  sortedChapters: Array<{ id: string; foreshadows?: string[] }>,
  allForeshadows: Array<{ id: string; status: string; payoffChapterId?: string | null }>,
): number {
  // 章节列表为空或无伏笔，按"全部已回收"处理（避免空项目显示 0%）
  if (sortedChapters.length === 0) return 1;
  if (allForeshadows.length === 0) return 1;

  // 路径1：章节带 foreshadows 字段（主干），按最后出现位置判断
  const lastSeenAt = new Map<string, number>(); // foreshadowId → 最后出现的章节下标
  sortedChapters.forEach((c, idx) => {
    if (!c.foreshadows || c.foreshadows.length === 0) return;
    for (const fid of c.foreshadows) {
      lastSeenAt.set(fid, idx);
    }
  });
  if (lastSeenAt.size > 0) {
    const totalTracked = lastSeenAt.size;
    const n = sortedChapters.length;
    const recoveredThreshold = Math.floor(n * 2 / 3); // 后 1/3 视为回收
    let recovered = 0;
    for (const [, idx] of lastSeenAt) {
      if (idx >= recoveredThreshold) recovered++;
    }
    return recovered / totalTracked;
  }

  // 路径2：分支章节无 foreshadows 字段 → 基于 payoffChapterId 是否仍存在于分支判断
  // 分支删掉回收章节 → 该伏笔在分支算未回收；保留则沿用主干 status
  const branchChapterIds = new Set(sortedChapters.map(c => c.id));
  const paidOff = allForeshadows.filter(f => {
    if (f.status !== 'paid-off') return false;
    // 已回收伏笔：若 payoffChapterId 指向的章节在分支中已被删除，则算未回收
    if (f.payoffChapterId && !branchChapterIds.has(f.payoffChapterId)) return false;
    return true;
  }).length;
  return paidOff / allForeshadows.length;
}

/** 标准差（总体） */
function stddev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** 平均值 */
function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
