/**
 * 全局状态类型定义（独立于 useAppStore 实现，避免 slice 与 store 之间的循环依赖）
 *
 * 此前所有状态与 action 签名集中在 1155 行的 useAppStore.ts 中。现按领域拆分为
 * 多个 slice（见 ./slices/），各 slice 通过 StateCreator<AppState> 访问完整状态。
 */
import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion, ConflictIssue, AISuggestion, ChapterAnalysis, AISettings, ChapterLevelType, OutlinePolishReport, OutlineSnapshot, OutlineExpansionOption, CoreDriver, ConflictLayer, ConflictLayerType, StructureVariant, CausalImpactReport, ChapterBeat, AppPreferences, ProjectSettingCard, BlueprintOverview, Subplot, UpdateSchedule, SensitiveWordCheckResult, InspirationCard, InspirationCardType, StoryLink, MaterialQuestion, Storyline, StorylineType, TimelineNode, IntersectionTarget, MultiLineConflict, PacingPressureReport, PacingPressurePoint, ForeshadowBoardItem, VersionDiffReport, CharacterArcIssue, RelationshipTemperatureCurve, ReaderEmpathyReport, SandboxTrialReport, SandboxTrialSnapshot, PolishLogEntry, ChapterComment, OutlineBranch, BranchDiffReport, ReviewReflowEntry, InspirationGap, UndoEntry, SkeletonTimelineEvent, PacingPreset, ForeshadowPayoffCheck, EmergencyRecoveryPlan, CharacterArcCurve, CharacterArcRemedyPlan, CharacterEmotionConsistencyReport, PacingAdjustmentAdvice } from '@/types';

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

  // ===== 章节批注域 =====
  /** 批注按章节 ID 分组存储 */
  comments: Record<string, ChapterComment[]>;
  addComment: (chapterId: string, content: string, type?: ChapterComment['type'], anchorText?: string) => void;
  updateComment: (commentId: string, updates: Partial<Pick<ChapterComment, 'content' | 'type' | 'resolved'>>) => void;
  deleteComment: (commentId: string) => void;
  getComments: (chapterId: string) => ChapterComment[];

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
  /** 拖拽调整某层冲突权重（0-100），加重时自动生成对应情节种子追加到该层 seeds */
  updateConflictWeight: (layer: ConflictLayerType, weight: number) => void;
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

  /** 最近一次节奏压力测试报告 */
  lastPacingReport: PacingPressureReport | null;
  /** 最近一次人物弧光校验问题 */
  lastArcIssues: CharacterArcIssue[];
  /** 最近一次两人关系温度曲线 */
  lastRelationshipCurve: RelationshipTemperatureCurve | null;

  /** 执行节奏压力测试，结果写入 lastPacingReport */
  runPacingPressureTest: (scope?: 'all' | string) => Promise<void>;
  /** 手动调校某章节奏能量值（external/emotional/isBuffer），total 自动重算 */
  updatePacingPoint: (chapterId: string, updates: Partial<Pick<PacingPressurePoint, 'external' | 'emotional' | 'isBuffer'>>) => void;
  /** 重置某章节奏值为 0（需重新运行检测恢复 AI 原始值） */
  resetPacingPoint: (chapterId: string) => void;
  /** 获取伏笔看板数据（按 pending/paidoff/overdue 分组） */
  getForeshadowBoardItems: () => ForeshadowBoardItem[];
  /** 伏笔回收合理性检测结果（按 foreshadowId 索引，规格书阶段4-4） */
  foreshadowPayoffChecks: ForeshadowPayoffCheck[];
  /** 逾期伏笔应急回收方案（按 foreshadowId 索引，规格书阶段4-4） */
  emergencyRecoveryPlans: EmergencyRecoveryPlan[];
  /** 运行伏笔回收合理性检测（仅检测 paid-off 伏笔），结果写入 foreshadowPayoffChecks */
  runForeshadowPayoffCheck: () => Promise<void>;
  /** 为指定逾期伏笔生成应急回收方案，结果写入 emergencyRecoveryPlans */
  generateRecoveryPlan: (foreshadowId: string) => Promise<void>;
  /** 清空伏笔检测与应急方案（项目切换/手动重置时） */
  clearForeshadowChecks: () => void;
  /** 对比两个大纲快照，返回差异报告 */
  compareSnapshots: (oldSnapshotId: string, newSnapshotId: string) => VersionDiffReport | null;
  /** 执行人物弧光校验，结果写入 lastArcIssues */
  runCharacterArcCheck: () => Promise<void>;
  /** 分析两人关系温度曲线，结果写入 lastRelationshipCurve */
  analyzeRelationship: (characterAId: string, characterBId: string) => Promise<void>;

  /** 最近一次读者共情校验报告 */
  lastReaderEmpathyReport: ReaderEmpathyReport | null;
  /** 执行读者共情校验（逐章动机/情感/利益三维 + 共情问题），结果写入 lastReaderEmpathyReport */
  runReaderEmpathyCheck: (scope?: 'all' | string) => Promise<void>;

  /** 人物弧光三维追踪曲线（情绪/能力/认知，规格书阶段4-3） */
  lastArcCurves: CharacterArcCurve[];
  /** 弧光异常补救方案（预留，默认空数组，规格书阶段4-3） */
  lastArcRemedyPlans: CharacterArcRemedyPlan[];
  /** 角色维度情感一致性报告（规格书阶段4-5） */
  lastCharacterEmotionReport: CharacterEmotionConsistencyReport | null;
  /** 节奏调校 AI 建议（拖拽曲线后产出落地操作建议，规格书阶段4-2） */
  lastPacingAdvice: PacingAdjustmentAdvice | null;
  /** 执行角色维度情感一致性校验，结果写入 lastCharacterEmotionReport */
  runCharacterEmotionConsistencyCheck: () => Promise<void>;
  /** 请求节奏调校 AI 建议：根据 chapterId 找到章节后调用 generatePacingAdjustmentAdvice */
  requestPacingAdvice: (chapterId: string, dimension: 'external' | 'emotional', direction: 'raise' | 'lower', delta: number) => Promise<void>;
  /** 应用节奏调校建议：清空 lastPacingAdvice 并记录打磨动作（recordPolishAction('pacing')） */
  applyPacingAdvice: () => void;
  /** 清空节奏调校建议 */
  clearPacingAdvice: () => void;

  /** 沙盒试运行基线快照（修改前诊断快照，用于验证闭环对比） */
  sandboxBaseline: SandboxTrialSnapshot | null;
  /** 沙盒试运行基线大纲副本（深拷贝 chapters/foreshadows，用于不满意时回退到修改前） */
  sandboxBaselineChapters: Chapter[] | null;
  /** 沙盒试运行基线伏笔副本 */
  sandboxBaselineForeshadows: Foreshadow[] | null;
  /** 最近一次沙盒试运行前后对比报告 */
  lastSandboxReport: SandboxTrialReport | null;
  /** 捕获当前诊断报告为沙盒试运行基线（修改前快照 + 大纲副本） */
  captureSandboxBaseline: () => void;
  /** 清空沙盒试运行基线 */
  clearSandboxBaseline: () => void;
  /** 回退到沙盒基线：用基线副本覆盖当前 chapters/foreshadows（不满意修改时使用） */
  restoreSandboxBaseline: () => void;
  /** 运行沙盒验证：重新诊断并对基线做前后对比，结果写入 lastSandboxReport */
  runSandboxVerification: (scope?: 'all' | string) => Promise<void>;

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

  // ===== 打磨日志域（3.4 打磨成果摘要） =====
  /**
   * 打磨日志条目：每次打磨会话结束自动生成一条，持久化到项目数据。
   * 用于追溯成长轨迹，回答"我上次改了什么"。
   */
  polishLog: PolishLogEntry[];
  /** 当前打磨会话的动作计数器（内存态，退出时汇总成日志条目） */
  polishSessionActions: {
    foreshadowsResolved: number;
    pacingAdjusted: number;
    arcFixed: number;
    newInspirations: number;
    snapshotsCreated: number;
    startedAt: number;
  };
  /** 记录一次打磨动作（递增对应计数器） */
  recordPolishAction: (type: 'foreshadow' | 'pacing' | 'arc' | 'inspiration' | 'snapshot') => void;
  /** 结束当前打磨会话，生成日志条目并持久化 */
  finishPolishSession: () => void;
  /** 清空打磨日志（项目级） */
  clearPolishLog: () => void;

  // ===== 灵感打磨域（规格书第一阶段） =====
  /** 灵感卡列表（碎片捕获面板的存储单元） */
  inspirationCards: InspirationCard[];
  /** 连线沙盘：卡片之间的叙事脉络 */
  storyLinks: StoryLink[];
  /** 是否正在执行灵感卡 AI 操作（深度提问） */
  isInspirationBusy: boolean;
  /** 添加灵感卡；无当前项目时 toast 并返回空对象 */
  addInspirationCard: (input: { type: InspirationCardType; title: string; content: string; relatedChapterId?: string }) => InspirationCard;
  /** 更新灵感卡字段 */
  updateInspirationCard: (cardId: string, updates: Partial<InspirationCard>) => void;
  /** 删除灵感卡及其子卡，同时清理关联的 storyLinks */
  deleteInspirationCard: (cardId: string) => void;
  /** 对灵感卡深度提问，返回问题列表 */
  askInspirationCard: (cardId: string) => Promise<MaterialQuestion[]>;
  /** 为深度提问的答案生成子卡片，挂到主卡并更新 childCount */
  addInspirationChildCard: (parentId: string, dimension: string, question: string, answer: string) => InspirationCard | null;
  /** 调用 AI 生成两张卡之间的叙事脉络，写入 storyLinks */
  createStoryLink: (sourceCardId: string, targetCardId: string) => Promise<StoryLink | null>;
  /** 删除一条叙事脉络 */
  deleteStoryLink: (linkId: string) => void;
  /** 获取章节关联的灵感卡（relatedChapterId === chapterId） */
  getRelatedInspirationCards: (chapterId: string) => InspirationCard[];

  // ===== 多线作战指挥台（规格书第三阶段） =====
  /** 故事线列表（主线/反派线/支线） */
  storylines: Storyline[];
  /** 交集点预警目标列表 */
  intersectionTargets: IntersectionTarget[];
  /** 新增故事线；无当前项目时返回 null，颜色按 type 默认 */
  addStoryline: (input: { type: StorylineType; name: string; color?: string }) => Storyline | null;
  /** 更新故事线字段 */
  updateStoryline: (storylineId: string, updates: Partial<Storyline>) => void;
  /** 删除故事线，并从交集目标中移除引用（变空则删目标） */
  deleteStoryline: (storylineId: string) => void;
  /** 为故事线添加章节级时间轴节点 */
  addTimelineNode: (storylineId: string, chapterId: string) => TimelineNode | null;
  /** 移除时间轴节点 */
  removeTimelineNode: (storylineId: string, nodeId: string) => void;
  /** 新增交集点预警目标 */
  addIntersectionTarget: (input: { chapterId: string; description: string; storylineIds: string[] }) => IntersectionTarget | null;
  /** 删除交集点预警目标 */
  deleteIntersectionTarget: (targetId: string) => void;
  /** 交集点预警：按"交集前 3 章"节点数判定 ok / warning / danger */
  checkIntersection: (targetId: string) => void;
  /** 多线错位自动巡检结果（时间矛盾/行程冲突/节点真空/顺序倒置） */
  multiLineConflicts: MultiLineConflict[];
  /** 自动巡检所有线索的时间矛盾与行程冲突，结果写入 multiLineConflicts */
  detectMultiLineConflicts: () => void;
  /** 拖拽对齐：把某节点移动到新章节位置（节点拖拽对齐） */
  moveTimelineNode: (storylineId: string, nodeId: string, targetChapterId: string) => void;

  // ===== 版本花园域（规格书第五阶段-4：多分支并行试错）=====
  /** 创作分支列表 */
  branches: OutlineBranch[];
  /** 从指定快照分叉出独立分支；无当前项目或快照不存在时返回 null */
  createBranch: (sourceSnapshotId: string, name: string) => OutlineBranch | null;
  /** 更新分支字段（name/notes/chapters 等） */
  updateBranch: (branchId: string, updates: Partial<OutlineBranch>) => void;
  /** 删除分支 */
  deleteBranch: (branchId: string) => void;
  /** 归档分支（status=archived，不再可编辑/合并） */
  archiveBranch: (branchId: string) => void;
  /** 合并分支结构回主干（仅结构字段，不覆盖正文）；成功返回 true */
  mergeBranchToMain: (branchId: string) => boolean;
  /** 对比分支与主干的章节差异 + 关键指标 */
  compareBranchWithMain: (branchId: string) => BranchDiffReport | null;

  // ===== 读者评论回流域（规格书 3.3）=====
  /** 读者评论回流记录列表 */
  reviewReflows: ReviewReflowEntry[];
  /** 新增一条读者评论回流记录（已 AI 归类） */
  addReviewReflow: (entry: Omit<ReviewReflowEntry, 'id' | 'projectId' | 'createdAt' | 'resolved'>) => ReviewReflowEntry | null;
  /** 标记回流记录为已处理 */
  resolveReviewReflow: (entryId: string) => void;
  /** 删除回流记录 */
  deleteReviewReflow: (entryId: string) => void;

  // ===== 灵感缺口提示域（规格书阶段1-3）=====
  /** 当前项目的灵感缺口列表（AI 推断，可忽略） */
  inspirationGaps: InspirationGap[];
  /** 设置灵感缺口列表（AI 推断后整体替换） */
  setInspirationGaps: (gaps: InspirationGap[]) => void;
  /** 追加单条缺口（编辑器写作时触发回流到打磨台汇总，规格书 3.2/阶段1-3，去重追加） */
  addInspirationGap: (gap: Omit<InspirationGap, 'id' | 'ignored'>) => void;
  /** 忽略某条缺口 */
  ignoreInspirationGap: (gapId: string) => void;

  // ===== 全局撤销栈域（规格书 3.5 Ctrl+Z）=====
  /** 撤销栈（最近的操作在前，上限 30 条） */
  undoStack: UndoEntry[];
  /** 压入一条撤销记录 */
  pushUndo: (entry: Omit<UndoEntry, 'id' | 'timestamp'>) => void;
  /** 执行撤销：弹出栈顶并调用 undo，返回被撤销操作的描述（无则 null） */
  performUndo: () => string | null;
  /** 清空撤销栈 */
  clearUndoStack: () => void;

  // ===== 编辑器→打磨台自动复检域（规格书 3.2）=====
  /** 编辑器正文保存后置 true，打磨台挂载/监听时据此自动复检，复检后置 false */
  polishRecheckNeeded: boolean;
  /** 标记打磨台需要复检（编辑器保存正文时调用） */
  markPolishRecheckNeeded: () => void;
  /** 清除复检标记（打磨台完成复检后调用） */
  clearPolishRecheckNeeded: () => void;

  // ===== 骨架可交互结构时间轴域（规格书阶段2-1）=====
  /** 时间轴关键事件节点 */
  skeletonEvents: SkeletonTimelineEvent[];
  /** 节奏预设列表 */
  pacingPresets: PacingPreset[];
  /** 设置时间轴事件列表（拖拽/标高潮后整体替换） */
  setSkeletonEvents: (events: SkeletonTimelineEvent[]) => void;
  /** 设置节奏预设列表 */
  setPacingPresets: (presets: PacingPreset[]) => void;
}
