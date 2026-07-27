/**
 * 全局状态类型定义（独立于 useAppStore 实现，避免 slice 与 store 之间的循环依赖）
 *
 * 此前所有状态与 action 签名集中在 1155 行的 useAppStore.ts 中。现按领域拆分为
 * 多个 slice（见 ./slices/），各 slice 通过 StateCreator<AppState> 访问完整状态。
 */
import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion, ConflictIssue, AISuggestion, ChapterAnalysis, AISettings, ChapterLevelType, OutlinePolishReport, OutlineSnapshot, OutlineExpansionOption, CoreDriver, ConflictLayer, StructureVariant, CausalImpactReport, ChapterBeat, AppPreferences, ProjectSettingCard, BlueprintOverview, Subplot, UpdateSchedule, SensitiveWordCheckResult } from '@/types';

export interface ChapterHistory {
  past: string[];
  future: string[];
  lastPush: number;
}

export interface SearchEntry {
  type: string;
  id: string;
  title: string;
  preview: string;
  matchCount: number;
}

export interface PendingEditorInsert {
  chapterId: string;
  content: string;
  mode: 'cursor' | 'end';
}

export interface RecoveryDraft {
  projectId: string;
  chapterId: string;
  content: string;
  timestamp: string;
}

/**
 * 编辑器待跳转定位请求。
 * - chapterId: 目标章节
 * - position: 纯文本字符偏移（基于剥离 HTML 后的正文），可选；无则仅切换章节
 * - timestamp: 创建时间戳，用于 TiptapEditor 区分连续多次跳转请求
 *
 * 使用场景：冲突检测面板的"跳转到正文"按钮。ConflictPanel 与 TiptapEditor 是兄弟组件，
 * 通过 store 中转避免 props 钻孔。TiptapEditor 监听此字段变化执行跳转，完成后置空。
 */
export interface PendingScrollTo {
  chapterId: string;
  /** 纯文本偏移定位（冲突检测用） */
  position?: { start: number; end: number };
  /** 块文本匹配定位（版本 diff 用）：编辑器查找首个文本包含该值的段落并滚动高亮 */
  blockText?: string;
  timestamp: number;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'mock',
  style: 'balanced',
  descriptionDensity: 50,
  dialogueDensity: 50,
  strictness: 50,
  temperature: 0.7,
  maxTokens: 2000,
  autoCheckConflicts: true,
};

/** 应用级偏好默认值 */
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  autoSaveInterval: 30000,
  defaultFontSize: 16,
  defaultLineHeight: 1.8,
  defaultFontFamily: 'system-ui',
  defaultTheme: 'dark',
  showWordCount: true,
  showLineNumbers: false,
  reopenLastProject: false,
  defaultPolishScope: 'all',
};

export interface AppState {
  // ===== 项目域 =====
  projects: Project[];
  currentProjectId: string | null;
  currentProjectFilePath: string | null;
  lastSavedAt: string | null;
  isSaving: boolean;

  loadProjects: () => Promise<void>;
  createProject: (title: string, template?: Project['template']) => Promise<Project>;
  openProject: (projectId: string) => Promise<void>;
  openProjectFile: (filePath: string) => Promise<boolean>;
  saveProject: () => Promise<boolean>;
  saveProjectAs: () => Promise<string | null>;
  closeProject: () => Promise<void>;
  deleteProject: (projectId: string) => void;
  updateProject: (projectId: string, updates: Partial<Project>) => void;
  loadSampleProject: () => void;

  // ===== 章节域 =====
  chapters: Chapter[];
  currentChapterId: string | null;
  pendingEditorInsert: PendingEditorInsert | null;
  pendingScrollTo: PendingScrollTo | null;
  contentEpoch: number;
  isAIGenerating: boolean;

  addChapter: (parentId: string | null, title: string, order?: number, levelType?: ChapterLevelType) => Chapter | null;
  updateChapter: (chapterId: string, updates: Partial<Chapter>) => void;
  /** 批量更新章节 order（拖拽重排时用），单次 set + 单次 markDirty，避免 N 次 updateChapter 的 N 轮订阅广播 */
  batchUpdateChapterOrder: (updates: Array<{ id: string; order: number }>) => void;
  deleteChapter: (chapterId: string) => void;
  /** 移动章节到新父级；返回 false 表示因嵌套层级超限或检测到循环而拒绝移动 */
  moveChapter: (chapterId: string, newParentId: string | null, newOrder: number) => boolean;
  setCurrentChapter: (chapterId: string | null) => void;
  updateChapterContent: (chapterId: string, content: string) => void;
  setPendingEditorInsert: (content: PendingEditorInsert | null) => void;
  setPendingScrollTo: (payload: PendingScrollTo | null) => void;
  bumpContentEpoch: () => void;
  setAIGenerating: (v: boolean) => void;

  // ===== 实体域（角色 / 设定 / 伏笔 / 素材） =====
  characters: Character[];
  settingCategories: SettingCategory[];
  settingItems: SettingItem[];
  foreshadows: Foreshadow[];
  materials: Material[];

  addCharacter: (character: Partial<Character>) => Character;
  updateCharacter: (characterId: string, updates: Partial<Character>) => void;
  deleteCharacter: (characterId: string) => void;

  addSettingCategory: (name: string, icon: string) => SettingCategory;
  updateSettingCategory: (categoryId: string, updates: Partial<SettingCategory>) => void;
  deleteSettingCategory: (categoryId: string) => void;
  addSettingItem: (categoryId: string, name: string) => SettingItem;
  updateSettingItem: (itemId: string, updates: Partial<SettingItem>) => void;
  deleteSettingItem: (itemId: string) => void;

  addForeshadow: (foreshadow: Partial<Foreshadow>) => Foreshadow;
  updateForeshadow: (foreshadowId: string, updates: Partial<Foreshadow>) => void;
  deleteForeshadow: (foreshadowId: string) => void;
  recomputeForeshadowMentions: () => void;

  addMaterial: (material: Partial<Material>) => Material;
  updateMaterial: (materialId: string, updates: Partial<Material>) => void;
  deleteMaterial: (materialId: string) => void;

  // ===== 版本与历史域 =====
  versions: Record<string, ChapterVersion[]>;
  histories: Record<string, ChapterHistory>;

  saveVersion: (chapterId: string, description?: string) => void;
  getVersions: (chapterId: string) => ChapterVersion[];
  restoreVersion: (chapterId: string, versionId: string) => void;
  deleteVersion: (chapterId: string, versionId: string) => void;

  commitHistory: (chapterId: string, prevContent: string) => void;
  undo: (chapterId: string, currentContent: string) => string | null;
  redo: (chapterId: string, currentContent: string) => string | null;
  canUndo: (chapterId: string) => boolean;
  canRedo: (chapterId: string) => boolean;

  // ===== UI / 搜索 / 冲突 / AI / 恢复域 =====
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'ai' | 'characters' | 'settings' | 'foreshadows' | 'materials'
    | 'coreSetting' | 'blueprint' | 'subplot' | 'updateSchedule';
  searchQuery: string;
  searchResults: SearchEntry[];
  searchHighlight: string | null;
  conflicts: ConflictIssue[];
  aiSuggestions: AISuggestion[];
  analysis: Record<string, ChapterAnalysis>;
  aiSettings: AISettings;
  recoveryDraft: RecoveryDraft | null;

  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: AppState['rightPanelTab']) => void;

  search: (query: string) => void;
  clearSearch: () => void;
  setSearchHighlight: (keyword: string | null) => void;

  detectConflicts: () => void;
  resolveConflict: (issueId: string) => void;
  addAISuggestion: (suggestion: Omit<AISuggestion, 'id' | 'timestamp'>) => void;
  clearAISuggestions: () => void;

  loadAISettings: () => Promise<void>;
  updateAISettings: (updates: Partial<AISettings>) => Promise<void> | void;

  checkForRecovery: () => Promise<void>;
  restoreRecoveryDraft: () => void;
  discardRecoveryDraft: () => void;

  // ===== 应用级偏好 =====
  appPreferences: AppPreferences;
  loadAppPreferences: () => Promise<void>;
  // 允许 Promise<void>（持久化完成后再 resolve）或 void（fire-and-forget），
  // 与 updateAISettings 保持一致的签名风格，便于调用方按需 await
  updateAppPreferences: (updates: Partial<AppPreferences>) => Promise<void> | void;

  // ===== 大纲打磨域 =====
  /** 最近一次大纲打磨报告（按项目维度缓存于内存，关闭项目清空） */
  lastOutlineReport: OutlinePolishReport | null;
  /** 大纲结构快照列表（版本花园） */
  outlineSnapshots: OutlineSnapshot[];
  /** 是否正在执行大纲打磨 */
  isPolishingOutline: boolean;
  /** 情节扩展器缓存：chapterId -> 最近一次扩展方案 */
  outlineExpansionCache: Record<string, OutlineExpansionOption[]>;

  /** 执行全量/局部大纲打磨，结果写入 lastOutlineReport */
  runOutlinePolish: (scope?: 'all' | string) => Promise<void>;
  /** 忽略单条诊断（标记 ignored=true，不再计入未解决项） */
  ignoreOutlineIssue: (issueId: string) => void;
  /** 标记单条诊断为已采纳（resolved=true） */
  resolveOutlineIssue: (issueId: string) => void;
  /** 批量采纳建议：将所有未忽略未解决的 issue 标记为 resolved */
  batchResolveOutlineIssues: (issueIds?: string[]) => void;
  /** 保存当前大纲结构为快照（版本花园） */
  saveOutlineSnapshot: (label: string) => OutlineSnapshot | null;
  /** 删除一个大纲快照 */
  deleteOutlineSnapshot: (snapshotId: string) => void;
  /** 恢复到指定大纲快照（仅恢复结构：parentId/order/level/levelType/title/summary） */
  restoreOutlineSnapshot: (snapshotId: string) => void;
  /** 拉取某章节的情节扩展方案（带缓存） */
  fetchOutlineExpansion: (chapterId: string) => Promise<OutlineExpansionOption[]>;
  /** 清空情节扩展缓存（章节内容变更后调用） */
  clearOutlineExpansionCache: (chapterId?: string) => void;
  /** 获取当前报告（兼容 selector 调用） */
  getOutlineReport: () => OutlinePolishReport | null;

  // ===== 大纲打磨扩展域（节拍 / 核心驱动 / 冲突罗盘 / 结构变体 / 因果推演）=====
  /** 核心驱动锁定（人物/情节/主题），作为后续打磨基准线 */
  coreDriver: CoreDriver | null;
  /** 冲突罗盘：4 层冲突 + 情节种子 */
  conflictCompass: ConflictLayer[];
  /** 结构变体：3 套骨架方案预览 */
  structureVariants: StructureVariant[];
  /** 最近一次因果推演报告（变动影响预览） */
  lastCausalImpact: CausalImpactReport | null;

  /** 锁定核心驱动 */
  lockCoreDriver: (driver: CoreDriver) => void;
  /** 解锁核心驱动（允许重选） */
  unlockCoreDriver: () => void;
  /** 拉取冲突罗盘（基于核心驱动 + 角色） */
  fetchConflictCompass: () => Promise<void>;
  /** 拉取 3 套结构变体 */
  fetchStructureVariants: () => Promise<void>;
  /** 为指定章节生成 5 大节拍（写入 chapter.beats） */
  generateBeatsForChapter: (chapterId: string) => Promise<void>;
  /** 更新章节某个节拍内容 */
  updateChapterBeat: (chapterId: string, beatType: ChapterBeat['type'], content: string) => void;
  /** 切换节拍锁定状态（锁定后咬合校验不再要求修改） */
  toggleBeatLock: (chapterId: string, beatType: ChapterBeat['type']) => void;
  /** 执行因果推演预览（不修改大纲，仅返回影响报告） */
  runCausalPreview: (changeDescription: string, targetId: string) => Promise<void>;
  /** 清空因果推演报告 */
  clearCausalImpact: () => void;

  // ===== 灵犀设定域（1.1 核心设定卡） =====
  /** 是否正在执行设定卡 AI 操作（提问/矛盾检查） */
  isSettingCardBusy: boolean;
  /** 最近一次 AI 提问列表 */
  settingCardQuestions: string[];
  /** 获取当前项目的核心设定卡（无则返回 null） */
  getSettingCard: () => ProjectSettingCard | null;
  /** 保存/更新核心设定卡（写入 project.settingCard） */
  updateSettingCard: (updates: Partial<ProjectSettingCard>) => void;
  /** 初始化空白设定卡（新建项目或首次进入设定面板时）。无当前项目时返回 null。 */
  initSettingCard: () => ProjectSettingCard | null;
  /** AI 实时提问深化，返回 3-5 个问题 */
  askSettingCardQuestions: () => Promise<string[]>;
  /** 检查设定卡矛盾点 */
  checkSettingCard: () => Promise<void>;
  /** 标记矛盾点已解决 */
  resolveSettingCardContradiction: (index: number) => void;

  // ===== 灵犀蓝图域（2.1-2.5） =====
  /** 获取当前项目的全局走向概览 */
  getBlueprint: () => BlueprintOverview | null;
  /** AI 生成全局走向概览（覆盖当前 blueprint） */
  generateBlueprint: () => Promise<void>;
  /** 手动更新蓝图字段（锁定后会被拦截，需先解锁） */
  updateBlueprint: (updates: Partial<BlueprintOverview>) => void;
  /** 锁定蓝图（设置 lockedAt，禁止直接编辑） */
  lockBlueprint: () => void;
  /** 解锁蓝图（清除 lockedAt，允许编辑；不删除 lastChangeImpact） */
  unlockBlueprint: () => void;
  /** 解锁后修改时生成改动影响报告，写入 blueprint.lastChangeImpact */
  generateBlueprintImpact: (changeDescription: string) => Promise<void>;
  /** 清除改动影响报告 */
  clearBlueprintImpact: () => void;
  /** 是否正在生成/分析蓝图 */
  isBlueprintBusy: boolean;

  // ===== 灵犀总控域：支线（6.4） =====
  /** 当前项目所有支线（从 project.subplots 读取，便于 UI 订阅） */
  subplots: Subplot[];
  /** 新增支线；未打开项目或项目未找到时返回 null */
  addSubplot: (subplot: Partial<Subplot>) => Subplot | null;
  /** 更新支线 */
  updateSubplot: (subplotId: string, updates: Partial<Subplot>) => void;
  /** 删除支线 */
  deleteSubplot: (subplotId: string) => void;
  /** 推进支线（记录最近推进章节与时间） */
  progressSubplot: (subplotId: string, chapterId: string) => void;

  // ===== 灵犀总控域：存稿与更新（6.5） =====
  /** 当前项目更新管理配置 */
  updateSchedule: UpdateSchedule | null;
  /** 更新存稿与更新管理配置 */
  updateUpdateSchedule: (updates: Partial<UpdateSchedule>) => void;
  /** 计算存稿余量（按未发布章节字数 / 日更速度） */
  getStockpileDays: () => number;

  // ===== 灵犀发布域（5.2 敏感词检查） =====
  /** 最近一次敏感词检查结果（按项目维度缓存） */
  lastSensitiveWordCheck: SensitiveWordCheckResult | null;
  /** 执行敏感词检查（本地词库，无 LLM） */
  runSensitiveWordCheck: (chapterIds?: string[]) => SensitiveWordCheckResult;
  /** 清空敏感词检查结果 */
  clearSensitiveWordCheck: () => void;
}
