/**
 * 全局状态类型定义（独立于 useAppStore 实现，避免 slice 与 store 之间的循环依赖）
 *
 * 此前所有状态与 action 签名集中在 1155 行的 useAppStore.ts 中。现按领域拆分为
 * 多个 slice（见 ./slices/），各 slice 通过 StateCreator<AppState> 访问完整状态。
 */
import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion, ConflictIssue, AISuggestion, ChapterAnalysis, AISettings, ChapterLevelType } from '@/types';

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

export interface AppState {
  // ===== 项目域 =====
  projects: Project[];
  currentProjectId: string | null;
  currentProjectFilePath: string | null;
  lastSavedAt: string | null;
  isSaving: boolean;

  loadProjects: () => Promise<void>;
  createProject: (title: string, template?: Project['template']) => Project;
  openProject: (projectId: string) => Promise<void>;
  openProjectFile: (filePath: string) => Promise<boolean>;
  saveProject: () => Promise<boolean>;
  saveProjectAs: () => Promise<string | null>;
  closeProject: () => void;
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
  rightPanelTab: 'ai' | 'characters' | 'settings' | 'foreshadows' | 'materials';
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
  updateAISettings: (updates: Partial<AISettings>) => void;

  checkForRecovery: () => Promise<void>;
  restoreRecoveryDraft: () => void;
  discardRecoveryDraft: () => void;
}
