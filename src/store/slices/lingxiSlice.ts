/**
 * 灵犀助手扩展域 slice
 *
 * 承载灵犀助手方案中六大模块的新增状态与逻辑：
 *   - 灵犀设定（1.1 核心设定卡）：getSettingCard / updateSettingCard /
 *     askSettingCardQuestions / checkSettingCard
 *   - 灵犀蓝图（2.1-2.5）：generateBlueprint / updateBlueprint / lockBlueprint /
 *     generateBlueprintImpact（含改动影响报告）
 *   - 灵犀总控-支线（6.4）：addSubplot / updateSubplot / progressSubplot
 *   - 灵犀总控-存稿（6.5）：updateSchedule + getStockpileDays
 *   - 灵犀发布-敏感词（5.2）：runSensitiveWordCheck
 *
 * 与其他 slice 的耦合：
 *   - 读 projects / currentProjectId（projectSlice）
 *   - 调 updateProject 持久化到 project.settingCard/blueprint/subplots/updateSchedule
 *   - 调 chapters / foreshadows（chapter + entity slice）作为蓝图生成与影响评估输入
 *   - closeProject 时由 projectSlice 重置 subplots/updateSchedule/sensitive 缓存
 *
 * 蓝图锁定语义：
 *   - lockBlueprint 设置 blueprint.lockedAt = now，updateBlueprint 会被拦截
 *   - 解锁后修改需先调 generateBlueprintImpact 生成影响报告，再 updateBlueprint
 *   - lockedAt 仅作 UI 提示与编辑拦截，不影响 runOutlinePolish 等已有功能
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type {
  ProjectSettingCard,
  BlueprintOverview,
  Subplot,
  SubplotStatus,
  UpdateSchedule,
  PolishLogEntry,
} from '@/types';
import {
  createEmptySettingCard,
  createDefaultUpdateSchedule,
  DEFAULT_SUBPLOT_STATUS,
} from '@/types';
import { generateId, markDirty, storage } from '@/utils/storage';
import {
  generateCoreSettingCardQuestions,
  checkSettingCardContradictions,
  generateBlueprintOverview,
  generateBlueprintChangeImpact,
  filterSensitiveWords,
  generatePolishSummary,
} from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { logError } from '@/utils/rendererLogger';

type LingxiSlice = Pick<AppState,
  | 'isSettingCardBusy' | 'settingCardQuestions' | 'isBlueprintBusy'
  | 'lastSensitiveWordCheck'
  | 'getSettingCard' | 'updateSettingCard' | 'initSettingCard'
  | 'askSettingCardQuestions' | 'checkSettingCard' | 'resolveSettingCardContradiction'
  | 'getBlueprint' | 'generateBlueprint' | 'updateBlueprint' | 'lockBlueprint'
  | 'unlockBlueprint' | 'generateBlueprintImpact' | 'clearBlueprintImpact'
  | 'subplots' | 'addSubplot' | 'updateSubplot' | 'deleteSubplot' | 'progressSubplot'
  | 'updateSchedule' | 'updateUpdateSchedule' | 'getStockpileDays'
  | 'runSensitiveWordCheck' | 'clearSensitiveWordCheck'
  | 'polishLog' | 'polishSessionActions' | 'recordPolishAction' | 'finishPolishSession' | 'clearPolishLog'>;

export const createLingxiSlice: StateCreator<AppState, [], [], LingxiSlice> = (set, get) => ({
  // ===== 灵犀设定 =====
  isSettingCardBusy: false,
  settingCardQuestions: [],

  getSettingCard: () => {
    const pid = get().currentProjectId;
    if (!pid) return null;
    const project = get().projects.find(p => p.id === pid);
    return project?.settingCard || null;
  },

  initSettingCard: () => {
    const pid = get().currentProjectId;
    if (!pid) {
      toast.error('初始化失败', '当前没有打开的项目');
      // 无项目时返回 null：原先返回未关联项目的兜底设定卡会误导调用方认为初始化成功，
      // 但该卡既未持久化也无项目关联，调用方若直接使用会写入无效数据
      return null;
    }
    const project = get().projects.find(p => p.id === pid);
    const card = createEmptySettingCard(project?.title || '未命名作品');
    get().updateProject(pid, { settingCard: card });
    return card;
  },

  updateSettingCard: (updates) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const project = get().projects.find(p => p.id === pid);
    if (!project) return;
    const current = project.settingCard || createEmptySettingCard(project.title);
    const merged: ProjectSettingCard = {
      ...current,
      ...updates,
      protagonist: { ...current.protagonist, ...(updates.protagonist || {}) },
      worldview: { ...current.worldview, ...(updates.worldview || {}) },
      coreConflict: { ...current.coreConflict, ...(updates.coreConflict || {}) },
      updatedAt: new Date().toISOString(),
    };
    get().updateProject(pid, { settingCard: merged });
  },

  askSettingCardQuestions: async () => {
    const pid = get().currentProjectId;
    const card = get().getSettingCard();
    if (!card || !pid) {
      toast.warning('请先填写设定卡', 'AI 提问需要先初始化设定卡');
      return [];
    }
    set({ isSettingCardBusy: true });
    try {
      const questions = await generateCoreSettingCardQuestions(card);
      // await 期间用户可能切换了项目，此时不应把旧项目的 questions 写入新项目
      if (get().currentProjectId !== pid) return questions;
      set({ settingCardQuestions: questions });
      return questions;
    } catch (e) {
      console.error('askSettingCardQuestions failed:', e);
      toast.error('AI 提问失败', getErrorMessage(e));
      return [];
    } finally {
      // 仅当仍处于发起请求时的项目时才复位 busy flag，避免新项目的同名 flag 被提前置 false
      if (get().currentProjectId === pid) set({ isSettingCardBusy: false });
    }
  },

  checkSettingCard: async () => {
    const pid = get().currentProjectId;
    const card = get().getSettingCard();
    if (!card || !pid) {
      toast.warning('请先填写设定卡', '矛盾检查需要先初始化设定卡');
      return;
    }
    set({ isSettingCardBusy: true });
    try {
      const contradictions = await checkSettingCardContradictions(card);
      // 跨项目竞态守卫：await 期间若用户切换了项目，contradictions（基于旧 card 算出）
      // 不应写入新项目的 settingCard，否则造成数据污染
      if (get().currentProjectId !== pid) return;
      get().updateSettingCard({ contradictions });
      if (contradictions.length === 0) {
        toast.success('未发现矛盾', '设定卡自洽，可放心进入下一步');
      } else {
        const errors = contradictions.filter(c => c.severity === 'error').length;
        toast.warning(
          '发现 ' + contradictions.length + ' 处矛盾',
          errors > 0 ? `${errors} 处需立即修改，详见设定卡` : '均为提示性矛盾，可酌情处理',
        );
      }
    } catch (e) {
      console.error('checkSettingCard failed:', e);
      toast.error('检查失败', getErrorMessage(e));
    } finally {
      if (get().currentProjectId === pid) set({ isSettingCardBusy: false });
    }
  },

  resolveSettingCardContradiction: (index) => {
    const card = get().getSettingCard();
    if (!card || !card.contradictions || !card.contradictions[index]) return;
    const next = card.contradictions.map((c, i) =>
      i === index ? { ...c, resolved: true } : c
    );
    get().updateSettingCard({ contradictions: next });
  },

  // ===== 灵犀蓝图 =====
  isBlueprintBusy: false,

  getBlueprint: () => {
    const pid = get().currentProjectId;
    if (!pid) return null;
    const project = get().projects.find(p => p.id === pid);
    return project?.blueprint || null;
  },

  generateBlueprint: async () => {
    const pid = get().currentProjectId;
    if (!pid) {
      toast.warning('未打开项目', '请先打开项目再生成蓝图');
      return;
    }
    const project = get().projects.find(p => p.id === pid);
    if (!project) return;
    // 蓝图锁定时禁止覆盖，避免误操作丢失定稿
    if (project.blueprint?.lockedAt) {
      toast.warning('蓝图已锁定', '请先解锁蓝图再重新生成');
      return;
    }
    // 没有核心设定卡时用 project 元信息兜底，避免 generateBlueprintOverview 收到 undefined
    const card = project.settingCard || createEmptySettingCard(project.title);
    set({ isBlueprintBusy: true });
    try {
      const blueprint = await generateBlueprintOverview(
        card,
        get().chapters,
        get().characters,
      );
      // 跨项目竞态守卫：await 期间用户可能切换项目，避免把旧项目的蓝图写入新项目
      if (get().currentProjectId !== pid) return;
      get().updateProject(pid, { blueprint });
      toast.success('蓝图已生成', '可在蓝图面板查看与调整');
    } catch (e) {
      console.error('generateBlueprint failed:', e);
      toast.error('蓝图生成失败', getErrorMessage(e));
    } finally {
      if (get().currentProjectId === pid) set({ isBlueprintBusy: false });
    }
  },

  updateBlueprint: (updates) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const project = get().projects.find(p => p.id === pid);
    if (!project) return;
    if (!project.blueprint) {
      toast.warning('请先生成蓝图', '尚未生成全局走向概览');
      return;
    }
    if (project.blueprint.lockedAt) {
      toast.warning('蓝图已锁定', '请先解锁蓝图再修改');
      return;
    }
    const merged: BlueprintOverview = {
      ...project.blueprint,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    get().updateProject(pid, { blueprint: merged });
  },

  lockBlueprint: () => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const project = get().projects.find(p => p.id === pid);
    if (!project?.blueprint) {
      toast.warning('请先生成蓝图', '锁定前需先生成全局走向概览');
      return;
    }
    const merged: BlueprintOverview = {
      ...project.blueprint,
      lockedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    get().updateProject(pid, { blueprint: merged });
    toast.success('蓝图已锁定', '后续正文创作将基于此蓝图');
  },

  unlockBlueprint: () => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const project = get().projects.find(p => p.id === pid);
    if (!project?.blueprint) return;
    if (!project.blueprint.lockedAt) return;
    const merged: BlueprintOverview = {
      ...project.blueprint,
      lockedAt: null,
      updatedAt: new Date().toISOString(),
    };
    get().updateProject(pid, { blueprint: merged });
    toast.info('蓝图已解锁', '修改前建议先生成改动影响报告');
  },

  generateBlueprintImpact: async (changeDescription) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const project = get().projects.find(p => p.id === pid);
    if (!project?.blueprint) {
      toast.warning('请先生成蓝图', '尚无蓝图可评估改动影响');
      return;
    }
    set({ isBlueprintBusy: true });
    try {
      const impact = await generateBlueprintChangeImpact(
        changeDescription,
        project.blueprint,
        get().chapters,
        get().foreshadows,
      );
      // 跨项目竞态守卫：避免把旧蓝图的影响报告写入新项目
      if (get().currentProjectId !== pid) return;
      // 重读最新 project：await 期间用户可能通过 updateBlueprint 修改了 blueprint 其他字段，
      // 闭包中的 project.blueprint 已陈旧，直接 spread 会用陈旧字段覆盖并发修改导致丢失
      const latestProject = get().projects.find(p => p.id === pid);
      if (!latestProject?.blueprint) return;
      const merged: BlueprintOverview = {
        ...latestProject.blueprint,
        lastChangeImpact: impact,
        updatedAt: new Date().toISOString(),
      };
      get().updateProject(pid, { blueprint: merged });
      const riskLabel = impact.riskLevel === 'high' ? '高风险' : impact.riskLevel === 'medium' ? '中风险' : '低风险';
      toast.warning(
        `${riskLabel}改动`,
        impact.suggestion || `波及 ${impact.affectedVolumes.length} 个分卷`,
      );
    } catch (e) {
      console.error('generateBlueprintImpact failed:', e);
      toast.error('影响评估失败', getErrorMessage(e));
    } finally {
      if (get().currentProjectId === pid) set({ isBlueprintBusy: false });
    }
  },

  clearBlueprintImpact: () => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const project = get().projects.find(p => p.id === pid);
    if (!project?.blueprint) return;
    const merged: BlueprintOverview = {
      ...project.blueprint,
      lastChangeImpact: undefined,
      updatedAt: new Date().toISOString(),
    };
    get().updateProject(pid, { blueprint: merged });
  },

  // ===== 灵犀总控-支线 =====
  subplots: [],

  addSubplot: (subplot) => {
    const pid = get().currentProjectId;
    if (!pid) {
      toast.error('添加失败', '当前没有打开的项目');
      // 不返回伪造的占位 Subplot（projectId='' 会导致"幽灵支线"），直接返回 null 让调用方判断
      return null;
    }
    const projects = get().projects;
    const project = projects.find(p => p.id === pid);
    if (!project) {
      toast.error('添加失败', '未找到当前项目');
      return null;
    }
    const now = new Date().toISOString();
    const newSubplot: Subplot = {
      id: generateId(),
      projectId: pid,
      title: subplot.title || '新支线',
      description: subplot.description || '',
      status: subplot.status || DEFAULT_SUBPLOT_STATUS,
      startChapterId: subplot.startChapterId || null,
      lastProgressChapterId: subplot.lastProgressChapterId || null,
      expectedCloseChapterId: subplot.expectedCloseChapterId || null,
      relatedCharacters: subplot.relatedCharacters || [],
      relatedForeshadows: subplot.relatedForeshadows || [],
      notes: subplot.notes || '',
      lastProgressAt: subplot.lastProgressAt || null,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...(project.subplots || []), newSubplot];
    // 合并单次 set：避免 updateProject 内部 set({ projects }) 与 set({ subplots }) 两次 set
    // 之间出现订阅者可见的不一致中间态（顶层 subplots 已更新、projects[].subplots 未更新）
    const updatedProjects = projects.map(p =>
      p.id === pid ? { ...p, subplots: next, updatedAt: new Date().toISOString() } : p
    );
    set({ projects: updatedProjects, subplots: next });
    void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === pid)! })
      .catch(e => logError('patchProjects failed', e, { slice: 'lingxi', action: 'addSubplot', projectId: pid }));
    markDirty();
    return newSubplot;
  },

  updateSubplot: (subplotId, updates) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const projects = get().projects;
    const project = projects.find(p => p.id === pid);
    if (!project?.subplots) return;
    const next = project.subplots.map(s =>
      s.id === subplotId
        ? { ...s, ...updates, updatedAt: new Date().toISOString() }
        : s
    );
    // 合并单次 set：避免 updateProject 内部 set 与 set({ subplots }) 两次 set 之间的不一致中间态
    const updatedProjects = projects.map(p =>
      p.id === pid ? { ...p, subplots: next, updatedAt: new Date().toISOString() } : p
    );
    set({ projects: updatedProjects, subplots: next });
    void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === pid)! })
      .catch(e => logError('patchProjects failed', e, { slice: 'lingxi', action: 'updateSubplot', projectId: pid }));
    markDirty();
  },

  deleteSubplot: (subplotId) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const projects = get().projects;
    const project = projects.find(p => p.id === pid);
    if (!project?.subplots) return;
    const next = project.subplots.filter(s => s.id !== subplotId);
    // 合并单次 set：避免 updateProject 内部 set 与 set({ subplots }) 两次 set 之间的不一致中间态
    const updatedProjects = projects.map(p =>
      p.id === pid ? { ...p, subplots: next, updatedAt: new Date().toISOString() } : p
    );
    set({ projects: updatedProjects, subplots: next });
    void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === pid)! })
      .catch(e => logError('patchProjects failed', e, { slice: 'lingxi', action: 'deleteSubplot', projectId: pid }));
    markDirty();
  },

  progressSubplot: (subplotId, chapterId) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const projects = get().projects;
    const project = projects.find(p => p.id === pid);
    if (!project?.subplots) return;
    // 早返回：已收束/放弃的支线不再推进——原先虽然不会改回 progressing，
    // 但仍会更新 lastProgressChapterId/lastProgressAt/updatedAt，让"已结束"的支线
    // 出现新的进度记录，UI 上展示为"刚刚推进过"，误导用户
    const target = project.subplots.find(s => s.id === subplotId);
    if (!target || target.status === 'closed' || target.status === 'abandoned') return;
    const now = new Date().toISOString();
    const next = project.subplots.map(s => {
      if (s.id !== subplotId) return s;
      // open / paused 都视为"未结束"，推进时迁回 progressing
      const nextStatus: SubplotStatus =
        s.status === 'open' || s.status === 'paused' ? 'progressing' : s.status;
      return {
        ...s,
        status: nextStatus,
        lastProgressChapterId: chapterId,
        lastProgressAt: now,
        updatedAt: now,
      };
    });
    // 合并单次 set：避免 updateProject 内部 set 与 set({ subplots }) 两次 set 之间的不一致中间态
    const updatedProjects = projects.map(p =>
      p.id === pid ? { ...p, subplots: next, updatedAt: new Date().toISOString() } : p
    );
    set({ projects: updatedProjects, subplots: next });
    void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === pid)! })
      .catch(e => logError('patchProjects failed', e, { slice: 'lingxi', action: 'progressSubplot', projectId: pid }));
    markDirty();
  },

  // ===== 灵犀总控-存稿与更新 =====
  updateSchedule: null,

  updateUpdateSchedule: (updates) => {
    const pid = get().currentProjectId;
    if (!pid) return;
    const projects = get().projects;
    const project = projects.find(p => p.id === pid);
    if (!project) return;
    const current = project.updateSchedule || createDefaultUpdateSchedule();
    const merged: UpdateSchedule = { ...current, ...updates };
    // 合并单次 set：避免 updateProject 内部 set 与 set({ updateSchedule }) 两次 set 之间的不一致中间态
    const updatedProjects = projects.map(p =>
      p.id === pid ? { ...p, updateSchedule: merged, updatedAt: new Date().toISOString() } : p
    );
    set({ projects: updatedProjects, updateSchedule: merged });
    void storage.patchProjects({ type: 'update', project: updatedProjects.find(p => p.id === pid)! })
      .catch(e => logError('patchProjects failed', e, { slice: 'lingxi', action: 'updateUpdateSchedule', projectId: pid }));
    markDirty();
  },

  getStockpileDays: () => {
    const pid = get().currentProjectId;
    if (!pid) return 0;
    const project = get().projects.find(p => p.id === pid);
    const schedule = project?.updateSchedule;
    if (!schedule || schedule.dailySpeed <= 0) return 0;
    // 存稿语义：仅 status==='done' 的章节才算"已完成可发布"的存稿量。
    // 原先统计所有 chapter 级别字数，会把 draft/writing/reviewing 中的半成品计入，
    // 导致存稿天数虚高，UI 上的"存稿告急"提醒失真
    const totalWords = get().chapters
      .filter(c => c.levelType === 'chapter' && c.status === 'done')
      .reduce((sum, c) => sum + (c.wordCount || 0), 0);
    return Math.floor(totalWords / schedule.dailySpeed);
  },

  // ===== 灵犀发布-敏感词 =====
  lastSensitiveWordCheck: null,

  runSensitiveWordCheck: (chapterIds) => {
    const all = get().chapters;
    const targets = chapterIds && chapterIds.length > 0
      ? all.filter(c => chapterIds.includes(c.id))
      : all.filter(c => c.levelType === 'chapter');
    const result = filterSensitiveWords(targets);
    set({ lastSensitiveWordCheck: result });
    return result;
  },

  clearSensitiveWordCheck: () => set({ lastSensitiveWordCheck: null }),

  // ===== 打磨日志域（3.4 打磨成果摘要） =====
  polishLog: [],
  // 会话计数器初始值：startedAt 记录会话开始时间，退出时用于计算耗时
  polishSessionActions: {
    foreshadowsResolved: 0,
    pacingAdjusted: 0,
    arcFixed: 0,
    newInspirations: 0,
    snapshotsCreated: 0,
    startedAt: Date.now(),
  },

  recordPolishAction: (type) => {
    set(state => {
      const a = state.polishSessionActions;
      return {
        polishSessionActions: {
          ...a,
          foreshadowsResolved: a.foreshadowsResolved + (type === 'foreshadow' ? 1 : 0),
          pacingAdjusted: a.pacingAdjusted + (type === 'pacing' ? 1 : 0),
          arcFixed: a.arcFixed + (type === 'arc' ? 1 : 0),
          newInspirations: a.newInspirations + (type === 'inspiration' ? 1 : 0),
          snapshotsCreated: a.snapshotsCreated + (type === 'snapshot' ? 1 : 0),
        },
      };
    });
  },

  finishPolishSession: () => {
    const a = get().polishSessionActions;
    const now = Date.now();
    const durationMinutes = Math.max(1, Math.round((now - a.startedAt) / 60000));
    const summary = generatePolishSummary({
      foreshadowsResolved: a.foreshadowsResolved,
      pacingAdjusted: a.pacingAdjusted,
      arcFixed: a.arcFixed,
      newInspirations: a.newInspirations,
      snapshotsCreated: a.snapshotsCreated,
    });
    // 仅在有实际动作时记录日志，避免空会话污染日志
    const hasActions = a.foreshadowsResolved + a.pacingAdjusted + a.arcFixed + a.newInspirations + a.snapshotsCreated > 0;
    if (!hasActions) {
      // 重置会话计数器，但不写日志
      set({
        polishSessionActions: {
          foreshadowsResolved: 0,
          pacingAdjusted: 0,
          arcFixed: 0,
          newInspirations: 0,
          snapshotsCreated: 0,
          startedAt: now,
        },
      });
      return;
    }
    const entry: PolishLogEntry = {
      id: generateId(),
      startedAt: new Date(a.startedAt).toISOString(),
      finishedAt: new Date(now).toISOString(),
      durationMinutes,
      foreshadowsResolved: a.foreshadowsResolved,
      pacingAdjusted: a.pacingAdjusted,
      arcFixed: a.arcFixed,
      newInspirations: a.newInspirations,
      snapshotsCreated: a.snapshotsCreated,
      summary,
    };
    set(state => ({
      polishLog: [entry, ...state.polishLog].slice(0, 100), // 最多保留 100 条
      polishSessionActions: {
        foreshadowsResolved: 0,
        pacingAdjusted: 0,
        arcFixed: 0,
        newInspirations: 0,
        snapshotsCreated: 0,
        startedAt: now,
      },
    }));
    markDirty();
  },

  clearPolishLog: () => {
    set({ polishLog: [] });
    markDirty();
  },
});

// 注：灵犀域的项目切换重置不在此处实现，而是由 projectSlice 通过 PROJECT_SWITCH_RESET
// 统一处理（lastSensitiveWordCheck / settingCardQuestions / isSettingCardBusy /
// isBlueprintBusy 已加入该片段）；subplots / updateSchedule 由 projectSlice 的 5 个
// 切换入口单独同步。这是设计选择而非疏漏：reset 逻辑集中在 projectSlice 一处，
// 避免跨 slice 调用顺序与遗漏。
