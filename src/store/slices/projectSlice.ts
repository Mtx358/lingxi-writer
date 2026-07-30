/**
 * 项目域 slice
 *
 * 负责项目的加载、创建、打开、保存、关闭、删除等生命周期管理。
 * 项目操作会跨域读写章节、角色、设定、伏笔、素材、版本等数据，
 * 通过 get() 访问完整 AppState，set() 一次性写入多域状态。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from '../appState';
import type { Project, Chapter } from '@/types';
import { DEFAULT_CHAPTER_STATUS } from '@/types';
import { storage, generateId, markDirty, triggerSave, clearAutoSaveTimer } from '@/utils/storage';
import { createDefaultProject, createSampleProject } from '@/constants/mockData';
import { encodeVersionsToDeltas, decodeDeltasToVersions } from '@/utils/versionDelta';
import type { VersionDeltaPayload } from '@/utils/versionDelta';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { logError } from '@/utils/rendererLogger';
// 各模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/
// 章节纯文本缓存等）在各自模块加载时通过 registerProjectCleanup 注册清理函数，
// 项目切换时只需调用 runProjectCleanup() 一次，无需在此逐一手写。
// 此处 side-effect import 确保 imageCache 模块被加载（其清理函数得以注册），
// slice 模块由 useAppStore.ts 统一加载。
import '@/utils/imageCache';
import { runProjectCleanup } from '../projectCleanup';

/**
 * 项目切换状态重置片段：在 createProject/openProject/openProjectFile/loadSampleProject/
 * closeProject 等 5 个项目切换入口统一调用，防止上一项目的大纲打磨域状态（核心驱动/
 * 冲突罗盘/结构变体/因果推演报告/快照/扩展缓存）与灵犀助手域缓存（敏感词结果/设定卡
 * 提问/蓝图 busy 标志）泄漏到新项目（恢复旧快照会污染新项目章节结构）。
 * 不使用 as const：否则数组字面量会被推断为 readonly，与 AppState 中的可变数组类型冲突。
 * 注：settingCard / blueprint 不在顶层 store，由 lingxiSlice 的 getter 间接读取，
 *     subplots / updateSchedule 由各入口单独同步，不在此处重置。
 *
 * 含 histories / pendingEditorInsert：
 *   - histories 是 undo/redo 的章节正文快照，跨项目泄漏会让项目 B 的 undo 恢复出
 *     项目 A 的章节正文，造成数据污染。
 *   - pendingEditorInsert 是 AI 生成内容的待插入队列，跨项目泄漏会让项目 B 的编辑器
 *     插入项目 A 的 AI 生成内容。
 */
const PROJECT_SWITCH_RESET = {
  lastOutlineReport: null,
  outlineSnapshots: [] as AppState['outlineSnapshots'],
  isPolishingOutline: false,
  outlineExpansionCache: {},
  coreDriver: null,
  conflictCompass: [] as AppState['conflictCompass'],
  structureVariants: [] as AppState['structureVariants'],
  lastCausalImpact: null,
  // 灵犀助手域：项目切换时清空内存缓存（subplots/updateSchedule 由各入口单独同步）
  lastSensitiveWordCheck: null,
  settingCardQuestions: [],
  isSettingCardBusy: false,
  isBlueprintBusy: false,
  // 打磨日志域：按项目维度，切换时清空（持久化由 saveProject 单独处理）
  polishLog: [] as AppState['polishLog'],
  polishSessionActions: {
    foreshadowsResolved: 0,
    pacingAdjusted: 0,
    arcFixed: 0,
    newInspirations: 0,
    snapshotsCreated: 0,
    startedAt: Date.now(),
  },
  // undo/redo 历史与待插入 AI 内容：跨项目泄漏会造成数据污染
  histories: {} as AppState['histories'],
  pendingEditorInsert: null as AppState['pendingEditorInsert'],
  // 跨章节跳转请求：项目 A 设置的 pendingScrollTo（指向 A 的 chapterId）
  // 若不被重置，切到项目 B 后 TiptapEditor 会收到陈旧请求，尝试滚动到不存在的章节
  pendingScrollTo: null as AppState['pendingScrollTo'],
  // 章节批注：按项目维度，切换时清空（持久化由 saveProject 单独处理）
  comments: {} as AppState['comments'],
  // 伏笔回收合理性检测 + 逾期应急回收方案：按项目维度，切换时清空
  foreshadowPayoffChecks: [] as AppState['foreshadowPayoffChecks'],
  emergencyRecoveryPlans: [] as AppState['emergencyRecoveryPlans'],
};

/**
 * openProject / openProjectFile 的并发守卫：用户快速切换项目时，早先的 storage.get
 * 调用可能晚于最新的请求返回；若不守卫，旧项目的 chapters/characters/... 会覆盖
 * 新项目的状态，造成 store 中 currentProjectId 与数据分属不同项目。
 *
 * 用法：进入异步 action 时 ++ 自增并记录，await 后比对——若不一致说明期间有新请求进入，
 * 本次结果作废。
 */
let openProjectRequestId = 0;

/** 测试隔离用：重置模块级 openProjectRequestId，避免跨用例泄漏 */
export function _resetOpenProjectRequestId(): void {
  openProjectRequestId = 0;
}

type ProjectSlice = Pick<AppState,
  | 'projects' | 'currentProjectId' | 'currentProjectFilePath' | 'lastSavedAt' | 'isSaving'
  | 'loadProjects' | 'createProject' | 'openProject' | 'openProjectFile' | 'saveProject'
  | 'saveProjectAs' | 'closeProject' | 'deleteProject' | 'updateProject' | 'loadSampleProject'>;

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  projects: [],
  currentProjectId: null,
  currentProjectFilePath: null,
  lastSavedAt: null,
  isSaving: false,

  loadProjects: async () => {
    const projects = await storage.get<Project[]>('projects', []);
    // 防御：localStorage 被外部写入为非数组（对象/字符串）时，projects.map/find 会崩溃
    if (!Array.isArray(projects)) {
      console.warn('loadProjects: projects in storage is not an array, resetting to []');
      set({ projects: [] });
      return;
    }
    set({ projects });
  },

  createProject: async (title: string, template = 'blank') => {
    const project = createDefaultProject(title, template);
    // 原子 patchProjects add：避免 read → push → write 竞态导致并发创建项目时
    // 后写者覆盖前写者，先创建的项目目录已建但 projects.json 无记录
    const projects = await storage.patchProjects({ type: 'add', project });
    if (!projects) {
      toast.error('创建项目失败', '项目列表持久化失败，请检查磁盘空间或文件权限');
      throw new Error('项目列表持久化失败');
    }
    // 切换项目前保存当前项目的 dirty 状态（与 closeProject 一致），
    // 并清理 autoSaveTimer，避免旧项目编辑丢失与资源残留（C3-01/C3-03）
    if (get().currentProjectId) {
      await triggerSave();
      clearAutoSaveTimer();
    }
    // 清理所有模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/章节纯文本缓存等）
    runProjectCleanup();

    const now = new Date().toISOString();
    let initialChapters: Chapter[] = [];

    if (template === 'three-act') {
      const act1 = { id: generateId(), projectId: project.id, parentId: null, title: '第一幕：建置', summary: '', order: 0, level: 1, levelType: 'book' as const, status: DEFAULT_CHAPTER_STATUS, wordCount: 0, content: '', createdAt: now, updatedAt: now };
      const act2 = { id: generateId(), projectId: project.id, parentId: null, title: '第二幕：对抗', summary: '', order: 1, level: 1, levelType: 'book' as const, status: DEFAULT_CHAPTER_STATUS, wordCount: 0, content: '', createdAt: now, updatedAt: now };
      const act3 = { id: generateId(), projectId: project.id, parentId: null, title: '第三幕：结局', summary: '', order: 2, level: 1, levelType: 'book' as const, status: DEFAULT_CHAPTER_STATUS, wordCount: 0, content: '', createdAt: now, updatedAt: now };
      initialChapters = [act1, act2, act3];
    } else if (template === 'chapter') {
      for (let i = 0; i < 10; i++) {
        initialChapters.push({
          id: generateId(), projectId: project.id, parentId: null, title: `第${i + 1}章`, summary: '', order: i, level: 1, levelType: 'chapter', status: DEFAULT_CHAPTER_STATUS, wordCount: 0, content: '', createdAt: now, updatedAt: now,
        });
      }
    }

    set({
      projects,
      currentProjectId: project.id,
      currentProjectFilePath: null,
      chapters: initialChapters,
      characters: [],
      settingCategories: [],
      settingItems: [],
      foreshadows: [],
      materials: [],
      versions: {},
      conflicts: [],
      aiSuggestions: [],
      currentChapterId: null,
      lastSavedAt: null,
      // 重置 AI 生成状态、搜索与章节分析，防止上一个项目的残留状态污染新项目
      isAIGenerating: false,
      searchQuery: '',
      searchResults: [],
      analysis: {},
      // 清空大纲打磨域：上一项目的核心驱动/冲突罗盘/结构变体/快照/扩展缓存不应残留到新项目
      ...PROJECT_SWITCH_RESET,
      // 灵犀助手域：新项目无支线/存稿配置，置空
      subplots: [],
      updateSchedule: null,
    });
    markDirty();
    return project;
  },

  openProject: async (projectId: string) => {
    // 并发守卫：用户快速从 A 切到 B 再切到 C 时，三个 openProject 并发，
    // 若 A 的 storage.get 较慢，A 的 set 会覆盖 B/C 的状态。每次进入 ++ 自增，
    // await 后比对——若不一致说明期间有新请求进入，本次结果作废。
    const reqId = ++openProjectRequestId;
    // 切换项目时清理上一项目的素材图片缓存（与 closeProject 一致），
    // 覆盖"从项目 A 直接打开项目 B"不经过 closeProject 的场景
    if (get().currentProjectId && get().currentProjectId !== projectId) {
      // 保存当前项目的 dirty 状态（与 closeProject 一致），
      // 并清理 autoSaveTimer，避免旧项目编辑丢失与资源残留（C3-01/C3-03）
      await triggerSave();
      clearAutoSaveTimer();
    }
    // 清理所有模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/章节纯文本缓存等）
    runProjectCleanup();
    const projects = get().projects.map(p =>
      p.id === projectId ? { ...p, lastOpenedAt: new Date().toISOString() } : p
    );
    // 原子 patchProjects update：仅更新单个 project 的 lastOpenedAt，避免全量覆盖竞态
    const openedProject = projects.find(p => p.id === projectId);
    if (openedProject) {
      void storage.patchProjects({ type: 'update', project: openedProject })
        .catch(e => logError('patchProjects failed', e, { op: 'update', action: 'openProject' }));
    }

    // P-H2 修复：用 Promise.all 并行读取 7 个 key，避免串行 await 在 localStorage
    // 模式下逐次 tick 推迟状态就绪。并发守卫改为 await 后单次校验：
    // Promise.all 整体 resolve 时若已被新请求取代，直接丢弃结果即可
    //
    // 部分失败容错：改用 Promise.allSettled，单个 key 读取失败（如本地解密异常、
    // 数据损坏抛错）时回退到默认空数组/对象，避免一个 key 失败导致整个 openProject
    // reject——用户将完全无法打开该项目。失败情况记录日志并提示用户。
    const [
      chaptersR, charactersR, settingCategoriesR, settingItemsR,
      foreshadowsR, materialsR, versionsR, commentsR,
    ] = await Promise.allSettled([
      storage.get<Chapter[]>(`project_${projectId}_chapters`, []),
      storage.get<AppState['characters']>(`project_${projectId}_characters`, []),
      storage.get<AppState['settingCategories']>(`project_${projectId}_settingCategories`, []),
      storage.get<AppState['settingItems']>(`project_${projectId}_settingItems`, []),
      storage.get<AppState['foreshadows']>(`project_${projectId}_foreshadows`, []),
      storage.get<AppState['materials']>(`project_${projectId}_materials`, []),
      storage.get<Record<string, AppState['versions'][string]>>(`project_${projectId}_versions`, {}),
      storage.get<AppState['comments']>(`project_${projectId}_comments`, {}),
    ]);
    // 收集失败 key 用于统一提示，避免 toast 风暴
    const failedKeys: string[] = [];
    const settle = <T,>(r: PromiseSettledResult<T>, key: string, fallback: T): T => {
      if (r.status === 'fulfilled') return r.value;
      console.warn(`openProject: storage.get(${key}) failed, falling back to default:`, r.reason);
      failedKeys.push(key);
      return fallback;
    };
    const chapters = settle(chaptersR, 'chapters', [] as Chapter[]);
    const characters = settle(charactersR, 'characters', [] as AppState['characters']);
    const settingCategories = settle(settingCategoriesR, 'settingCategories', [] as AppState['settingCategories']);
    const settingItems = settle(settingItemsR, 'settingItems', [] as AppState['settingItems']);
    const foreshadows = settle(foreshadowsR, 'foreshadows', [] as AppState['foreshadows']);
    const materials = settle(materialsR, 'materials', [] as AppState['materials']);
    const versions = settle(versionsR, 'versions', {} as Record<string, AppState['versions'][string]>);
    const comments = settle(commentsR, 'comments', {} as AppState['comments']);
    if (reqId !== openProjectRequestId) return; // 被新请求取代
    // localStorage 中的版本以增量 Diff 形式持久化，加载时重建完整内容。
    // 单个 chapter 的 delta 损坏不应让整个 openProject reject——用户无法打开该项目。
    // 损坏 chapter 回退为空版本列表，保留其他 chapter 的版本可用。
    const decodedVersions: AppState['versions'] = {};
    // 收集 delta 解码失败的 cid，循环外统一 toast 避免风暴
    const failedDeltaChapterIds: string[] = [];
    for (const [cid, vlist] of Object.entries(versions)) {
      try {
        decodedVersions[cid] = decodeDeltasToVersions(vlist as VersionDeltaPayload[]);
      } catch (e) {
        console.warn(`openProject: decode deltas failed for chapter ${cid}, falling back to empty list:`, e);
        failedDeltaChapterIds.push(cid);
        decodedVersions[cid] = Array.isArray(vlist) ? vlist : [];
      }
    }
    // 循环外统一提示：多个章节 delta 损坏时只弹一次 toast，避免风暴
    if (failedDeltaChapterIds.length > 0) {
      toast.warning('章节历史版本加载失败', `部分章节历史版本已损坏并回退为空，受影响章节：${failedDeltaChapterIds.join('、')}`);
    }
    // 单个 key 读取失败的统一提示：用户需知道哪些数据未加载，避免误以为"项目本来就没有角色/伏笔"
    if (failedKeys.length > 0) {
      toast.warning('部分数据加载失败', `以下数据读取异常已回退为空：${failedKeys.join('、')}。建议从备份恢复或重新创建。`);
    }
    const project = projects.find(p => p.id === projectId);

    // totalWords 在 set 前计算并合并到 projects，避免第二次 set 产生中间订阅状态。
    // 防御 wordCount 为 undefined：从损坏的 .cwp/localStorage 加载的 chapter 可能缺失该字段，
    // sum + undefined = NaN 会被写入 project.totalWords 并展示为"NaN 字"
    const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    const projectsWithWords = project
      ? projects.map(p => p.id === projectId ? { ...p, totalWords } : p)
      : projects;

    set({
      projects: projectsWithWords,
      currentProjectId: projectId,
      currentProjectFilePath: null,
      chapters,
      characters,
      settingCategories,
      settingItems,
      foreshadows,
      materials,
      versions: decodedVersions,
      conflicts: [],
      aiSuggestions: [],
      currentChapterId: chapters.length > 0 ? chapters[0].id : null,
      lastSavedAt: project?.updatedAt || null,
      // 重置 AI 生成状态、搜索与章节分析，防止上一个项目的残留状态污染当前项目
      isAIGenerating: false,
      searchQuery: '',
      searchResults: [],
      analysis: {},
      // 清空大纲打磨域：上一项目的核心驱动/冲突罗盘/结构变体/快照/扩展缓存不应残留到当前项目
      ...PROJECT_SWITCH_RESET,
      // 批注：PROJECT_SWITCH_RESET 已置空，此处覆盖为本项目加载的批注
      comments,
      // 灵犀助手域：同步当前项目的支线与存稿配置到顶层字段
      subplots: project?.subplots || [],
      updateSchedule: project?.updateSchedule || null,
    });

    // 打开项目后章节正文已就绪，重算伏笔的 chaptersSinceMention
    get().recomputeForeshadowMentions();
  },

  openProjectFile: async (filePath: string) => {
    // 并发守卫：与 openProject 同理
    const reqId = ++openProjectRequestId;
    const data = await storage.readProjectFile(filePath);
    if (reqId !== openProjectRequestId) return false;
    if (!data) return false;

    const { project, chapters, characters, settingCategories, settingItems, foreshadows, materials, versions } = data;
    // .cwp 文件不含批注域，从 localStorage sidecar 加载（文件型项目批注跨会话保留）
    const comments = await storage.get<AppState['comments']>(`project_${project.id}_comments`, {});

    // 切换项目文件时清理上一项目的素材图片缓存（与 closeProject 一致），
    // 覆盖"从项目 A 直接打开项目文件 B"不经过 closeProject 的场景
    if (get().currentProjectId && get().currentProjectId !== project.id) {
      // 保存当前项目的 dirty 状态（与 closeProject 一致），
      // 并清理 autoSaveTimer，避免旧项目编辑丢失与资源残留（C3-01/C3-03）
      await triggerSave();
      clearAutoSaveTimer();
    }
    // 清理所有模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/章节纯文本缓存等）
    runProjectCleanup();

    const projects = [...get().projects.filter(p => p.id !== project.id), project];
    // 原子 patchProjects update（upsert 语义）：避免全量覆盖竞态。
    // 主进程 update op 在项目不存在时会追加，兼容首次导入 .cwp 文件场景
    void storage.patchProjects({ type: 'update', project })
      .catch(e => logError('patchProjects failed', e, { op: 'update', action: 'openProjectFile' }));

    const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    const updatedProject = { ...project, totalWords, lastOpenedAt: new Date().toISOString() };

    set({
      projects: projects.map(p => p.id === project.id ? updatedProject : p),
      currentProjectId: project.id,
      currentProjectFilePath: filePath,
      chapters,
      characters,
      settingCategories,
      settingItems,
      foreshadows,
      materials,
      versions,
      conflicts: [],
      aiSuggestions: [],
      currentChapterId: chapters.length > 0 ? chapters[0].id : null,
      lastSavedAt: project.updatedAt,
      // 重置 AI 生成状态、搜索与章节分析，防止上一个项目的残留状态污染当前项目
      isAIGenerating: false,
      searchQuery: '',
      searchResults: [],
      analysis: {},
      // 清空大纲打磨域：上一项目的核心驱动/冲突罗盘/结构变体/快照/扩展缓存不应残留到当前项目
      ...PROJECT_SWITCH_RESET,
      // 批注：PROJECT_SWITCH_RESET 已置空，此处覆盖为本项目 sidecar 加载的批注
      comments,
      // 灵犀助手域：同步当前项目的支线与存稿配置到顶层字段
      subplots: project?.subplots || [],
      updateSchedule: project?.updateSchedule || null,
    });

    // 打开项目文件后章节正文已就绪，重算伏笔的 chaptersSinceMention
    get().recomputeForeshadowMentions();

    return true;
  },

  saveProject: async () => {
    if (get().isSaving) return false;
    const { currentProjectId, currentProjectFilePath, projects, chapters, characters, settingCategories, settingItems, foreshadows, materials, versions, comments } = get();

    if (!currentProjectId) return false;

    set({ isSaving: true });

    try {
      const project = projects.find(p => p.id === currentProjectId);
      if (!project) return false;

      const now = new Date().toISOString();
      const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
      const updatedProject = { ...project, totalWords, updatedAt: now };

      if (currentProjectFilePath) {
        const success = await storage.writeProjectFile(
          currentProjectFilePath,
          updatedProject,
          chapters,
          characters,
          settingCategories,
          settingItems,
          foreshadows,
          materials,
          versions,
        );

        if (success) {
          await storage.backupProjectFile(currentProjectFilePath, 5);
          // 批注作为 sidecar 持久化到 localStorage（.cwp 文件格式暂未收纳批注域），
          // 文件型项目也能跨会话保留批注，仅不随 .cwp 导出
          void storage.set(`project_${currentProjectId}_comments`, comments)
            .catch(e => logError('persist comments sidecar failed', e, { projectId: currentProjectId }));
          // 重读最新 project：await 期间用户可能通过 updateProject 修改了 title/cover 等字段，
          // 闭包中的 updatedProject 基于陈旧 projects 快照构建，直接 set 会用陈旧字段覆盖
          // 并发修改导致丢失。totalWords 与 updatedAt 来自本次保存快照应保留；其他字段从
          // 最新 project 合并。极少数情况：await 期间项目被删除，则仅更新 lastSavedAt。
          const latestProject = get().projects.find(p => p.id === currentProjectId);
          if (latestProject) {
            const finalProject = { ...latestProject, totalWords, updatedAt: now };
            set({
              projects: get().projects.map(p => p.id === currentProjectId ? finalProject : p),
              lastSavedAt: now,
            });
          } else {
            set({ lastSavedAt: now });
          }
          return true;
        } else {
          // Electron writeProjectFile 返回 false（非异常）：用户取消保存对话框或写入失败
          // 必须告知用户，否则用户会误以为已保存导致数据丢失
          toast.error('项目保存失败', '写入文件失败，请检查文件权限或路径');
          return false;
        }
      } else {
        // 增量 Diff 编码后再持久化，降低 localStorage 体积
        const encodedVersions: Record<string, ReturnType<typeof encodeVersionsToDeltas>> = {};
        for (const [cid, vlist] of Object.entries(versions)) {
          encodedVersions[cid] = encodeVersionsToDeltas(vlist);
        }
        // 批量写入：把 7 个 key 合并为 1 次 IPC（storage:writeBatch），
        // 既减少 IPC 往返延迟（7×RTT → 1×RTT），又从根本上避免触发 storage:write 令牌桶限流。
        // patchProjects 走单独的原子 IPC（read-modify-write mutex），不并入 batch
        await storage.setMany({
          [`project_${currentProjectId}_chapters`]: chapters,
          [`project_${currentProjectId}_characters`]: characters,
          [`project_${currentProjectId}_settingCategories`]: settingCategories,
          [`project_${currentProjectId}_settingItems`]: settingItems,
          [`project_${currentProjectId}_foreshadows`]: foreshadows,
          [`project_${currentProjectId}_materials`]: materials,
          [`project_${currentProjectId}_versions`]: encodedVersions,
          [`project_${currentProjectId}_comments`]: comments,
        });
        // 与 Electron 分支同理：重读最新 project 后合并 totalWords/updatedAt，
        // 避免陈旧 updatedProject 覆盖 await 期间的并发 updateProject 修改
        const latestProject = get().projects.find(p => p.id === currentProjectId);
        if (latestProject) {
          const finalProject = { ...latestProject, totalWords, updatedAt: now };
          // 原子 patchProjects update：避免全量覆盖竞态丢失并发创建的项目
          await storage.patchProjects({ type: 'update', project: finalProject });
          set({
            projects: get().projects.map(p => p.id === currentProjectId ? finalProject : p),
            lastSavedAt: now,
          });
        } else {
          set({ lastSavedAt: now });
        }
        return true;
      }
    } catch (e) {
      logError('Failed to save project', e, { projectId: currentProjectId });
      // 持久化异常必须告知用户，否则用户会误以为已保存导致数据丢失
      const msg = getErrorMessage(e);
      toast.error('项目保存失败', `保存过程中发生异常：${msg}。请重试，或使用"另存为"切换到其他路径。`);
    } finally {
      set({ isSaving: false });
    }
    return false;
  },

  saveProjectAs: async () => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return null;

    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return null;

    const defaultName = `${project.title.replace(/[\\/:*?"<>|]/g, '_')}.cwp`;
    const filePath = await storage.saveFileDialog(defaultName);

    if (filePath) {
      // 保存旧路径，失败时回滚，避免 currentProjectFilePath 指向无法保存的新路径
      // 导致后续自动保存持续写入失败路径
      const prevPath = get().currentProjectFilePath;
      set({ currentProjectFilePath: filePath });
      const ok = await get().saveProject();
      if (!ok) {
        set({ currentProjectFilePath: prevPath });
        return null;
      }
      return filePath;
    }
    return null;
  },

  closeProject: async () => {
    // C1 修复：自增 openProjectRequestId，使所有 in-flight 的 openProject/openProjectFile
    // 请求被判 stale 而丢弃。否则 closeProject 清空 store 后，旧 openProject 的 await
    // 返回会把旧项目数据写入已清空的 store，产生 chapters 属于 B、currentProjectId 为 null 的分裂态
    openProjectRequestId++;
    // await 最终保存：此前未 await + saveCallback 内 isSaving 互斥跳过，
    // 会导致关闭项目时未刷新到磁盘的编辑丢失
    try {
      await triggerSave();
    } catch (e) {
      logError('closeProject: triggerSave failed', e);
      // 关闭前保存失败必须告知用户，否则用户会以为已保存导致编辑丢失
      toast.error('关闭项目前保存失败', '请重新打开项目并重试保存，避免编辑丢失');
    }
    clearAutoSaveTimer();
    // 清理所有模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/章节纯文本缓存等）
    runProjectCleanup();
    set({
      currentProjectId: null,
      currentProjectFilePath: null,
      chapters: [],
      characters: [],
      settingCategories: [],
      settingItems: [],
      foreshadows: [],
      materials: [],
      versions: {},
      conflicts: [],
      aiSuggestions: [],
      currentChapterId: null,
      lastSavedAt: null,
      // 重置 AI 生成状态、搜索与章节分析，防止上一个项目的残留状态污染无项目状态
      isAIGenerating: false,
      searchQuery: '',
      searchResults: [],
      analysis: {},
      // 清空大纲打磨域：上一项目的报告/快照/扩展缓存不应残留到新项目
      // 注：pendingScrollTo 已包含在 PROJECT_SWITCH_RESET 中，此处不再单独声明
      ...PROJECT_SWITCH_RESET,
      // 灵犀助手域：关闭项目时清空支线与存稿配置
      subplots: [],
      updateSchedule: null,
    });
  },

  deleteProject: async (projectId: string) => {
    // 删除的是当前打开的项目时需要在持久化后重置内存状态，
    // 否则 UI 仍展示已删除项目的章节/角色/素材等数据，且 currentProjectId 指向不存在的项目
    const isCurrent = get().currentProjectId === projectId;
    const previousProjects = get().projects;
    const projects = previousProjects.filter(p => p.id !== projectId);
    set({ projects });
    const results = await Promise.allSettled([
      // 原子 patchProjects remove：避免全量覆盖竞态（并发创建/删除时丢失其他项目）
      storage.patchProjects({ type: 'remove', id: projectId }),
      storage.remove(`project_${projectId}_chapters`),
      storage.remove(`project_${projectId}_characters`),
      storage.remove(`project_${projectId}_settingCategories`),
      storage.remove(`project_${projectId}_settingItems`),
      storage.remove(`project_${projectId}_foreshadows`),
      storage.remove(`project_${projectId}_materials`),
      storage.remove(`project_${projectId}_versions`),
      storage.remove(`project_${projectId}_comments`),
    ]);
    // 关键：若 patchProjects 失败，磁盘仍保留该项目记录，重启后会"复活"。
    // 此处回滚内存状态，让用户感知删除失败并重试，避免内存与磁盘不一致
    const patchResult = results[0];
    if (patchResult.status === 'rejected' || patchResult.value === null) {
      logError('deleteProject: patchProjects failed, rolling back memory state', patchResult.status === 'rejected' ? patchResult.reason : 'returned null', { projectId, op: 'remove' });
      set({ projects: previousProjects });
      toast.error('项目删除失败', '项目列表持久化失败，请检查磁盘空间或文件权限后重试');
      return;
    }
    let hasFailure = false;
    for (let i = 1; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        hasFailure = true;
        console.warn('deleteProject: storage operation failed', r.reason);
      }
    }
    // 子资源（chapters/characters 等）删除失败：项目元数据已删，仅残留子数据文件
    // 不影响项目列表，下次创建同名项目也不会冲突（key 含 projectId 唯一）
    if (hasFailure) {
      toast.warning('项目删除部分失败', '项目已从列表移除，但部分子数据未能清除，不影响正常使用');
    }
    // 删除当前项目后重置所有当前项目相关状态：与 closeProject 一致的资源清理 + 状态清空，
    // 但不触发 triggerSave（项目已删除，无需保存），也不调用 markDirty（projects 已持久化）
    if (isCurrent) {
      clearAutoSaveTimer();
      // 清理所有模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/章节纯文本缓存等）
      runProjectCleanup();
      set({
        currentProjectId: null,
        currentProjectFilePath: null,
        chapters: [],
        characters: [],
        settingCategories: [],
        settingItems: [],
        foreshadows: [],
        materials: [],
        versions: {},
        conflicts: [],
        aiSuggestions: [],
        currentChapterId: null,
        lastSavedAt: null,
        // 重置 AI 生成状态、搜索与章节分析，防止已删除项目的残留状态污染无项目状态
        isAIGenerating: false,
        searchQuery: '',
        searchResults: [],
        analysis: {},
        // 清空大纲打磨域：上一项目的报告/快照/扩展缓存不应残留
        // 注：pendingScrollTo 已包含在 PROJECT_SWITCH_RESET 中，此处不再单独声明
        ...PROJECT_SWITCH_RESET,
        // 灵犀助手域：删除当前项目时清空支线与存稿配置
        subplots: [],
        updateSchedule: null,
      });
    }
  },

  updateProject: (projectId: string, updates: Partial<Project>) => {
    const existing = get().projects.find(p => p.id === projectId);
    if (!existing) return;
    // 原子 patchProjects update：避免全量覆盖竞态丢失并发创建的项目
    const updatedProject = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const projects = get().projects.map(p => p.id === projectId ? updatedProject : p);
    void storage.patchProjects({ type: 'update', project: updatedProject })
      .catch(e => logError('patchProjects failed', e, { op: 'update', action: 'updateProject', projectId }));
    set({ projects });
    markDirty();
  },

  loadSampleProject: async () => {
    const { project, chapters, characters, settingCategories, settingItems, foreshadows, materials } = createSampleProject();
    const projects = [...get().projects, project];
    // 用 patchProjects 原子追加，避免与并发 createProject/openProject 的 storage.set('projects')
    // 产生 read-modify-write 覆盖（参考 P42 修复）
    void storage.patchProjects({ type: 'add', project }).catch(e => {
      console.error('loadSampleProject: patchProjects failed:', e);
      toast.error('示例项目加载失败', '项目列表持久化失败，请重试');
    });
    // 切换项目前保存当前项目的 dirty 状态（与 closeProject 一致），
    // 并清理 autoSaveTimer，避免旧项目编辑丢失与资源残留（C3-01/C3-03）
    if (get().currentProjectId) {
      await triggerSave();
      clearAutoSaveTimer();
    }
    // 清理所有模块级状态（图片缓存/搜索 Worker/大纲打磨并发守卫/角色搜索缓存/伏笔重算计时器/章节纯文本缓存等）
    runProjectCleanup();

    const firstChapter = chapters.find(c => c.levelType === 'chapter');
    set({
      projects,
      currentProjectId: project.id,
      currentProjectFilePath: null,
      chapters,
      characters,
      settingCategories,
      settingItems,
      foreshadows,
      materials,
      versions: {},
      conflicts: [],
      aiSuggestions: [],
      currentChapterId: firstChapter?.id || null,
      lastSavedAt: null,
      // 重置 AI 生成状态、搜索与章节分析，防止上一个项目的残留状态污染示例项目
      isAIGenerating: false,
      searchQuery: '',
      searchResults: [],
      analysis: {},
      // 清空大纲打磨域：上一项目的核心驱动/冲突罗盘/结构变体/快照/扩展缓存不应残留到示例项目
      ...PROJECT_SWITCH_RESET,
      // 灵犀助手域：示例项目无支线/存稿配置，置空
      subplots: [],
      updateSchedule: null,
    });
    markDirty();
  },
});
