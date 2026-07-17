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
import { toast } from '@/hooks/useToast';
import { disposeSearchWorker } from './uiSlice';

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
    set({ projects });
  },

  createProject: (title: string, template = 'blank') => {
    const project = createDefaultProject(title, template);
    const projects = [...get().projects, project];
    void storage.set('projects', projects);

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
    });
    markDirty();
    return project;
  },

  openProject: async (projectId: string) => {
    const projects = get().projects.map(p =>
      p.id === projectId ? { ...p, lastOpenedAt: new Date().toISOString() } : p
    );
    void storage.set('projects', projects);

    const chapters = await storage.get<Chapter[]>(`project_${projectId}_chapters`, []);
    const characters = await storage.get<AppState['characters']>(`project_${projectId}_characters`, []);
    const settingCategories = await storage.get<AppState['settingCategories']>(`project_${projectId}_settingCategories`, []);
    const settingItems = await storage.get<AppState['settingItems']>(`project_${projectId}_settingItems`, []);
    const foreshadows = await storage.get<AppState['foreshadows']>(`project_${projectId}_foreshadows`, []);
    const materials = await storage.get<AppState['materials']>(`project_${projectId}_materials`, []);
    const versions = await storage.get<Record<string, AppState['versions'][string]>>(`project_${projectId}_versions`, {});
    // localStorage 中的版本以增量 Diff 形式持久化，加载时重建完整内容
    const decodedVersions: AppState['versions'] = {};
    for (const [cid, vlist] of Object.entries(versions)) {
      decodedVersions[cid] = decodeDeltasToVersions(vlist as unknown as ReturnType<typeof encodeVersionsToDeltas>);
    }
    const project = projects.find(p => p.id === projectId);

    // totalWords 在 set 前计算并合并到 projects，避免第二次 set 产生中间订阅状态
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
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
    });

    // 打开项目后章节正文已就绪，重算伏笔的 chaptersSinceMention
    get().recomputeForeshadowMentions();
  },

  openProjectFile: async (filePath: string) => {
    const data = await storage.readProjectFile(filePath);
    if (!data) return false;

    const { project, chapters, characters, settingCategories, settingItems, foreshadows, materials, versions } = data;

    const projects = [...get().projects.filter(p => p.id !== project.id), project];
    void storage.set('projects', projects);

    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
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
    });

    // 打开项目文件后章节正文已就绪，重算伏笔的 chaptersSinceMention
    get().recomputeForeshadowMentions();

    return true;
  },

  saveProject: async () => {
    if (get().isSaving) return false;
    const { currentProjectId, currentProjectFilePath, projects, chapters, characters, settingCategories, settingItems, foreshadows, materials, versions } = get();

    if (!currentProjectId) return false;

    set({ isSaving: true });

    try {
      const project = projects.find(p => p.id === currentProjectId);
      if (!project) return false;

      const now = new Date().toISOString();
      const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
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
          set({
            projects: get().projects.map(p => p.id === currentProjectId ? updatedProject : p),
            lastSavedAt: now,
          });
          return true;
        }
      } else {
        await storage.set(`project_${currentProjectId}_chapters`, chapters);
        await storage.set(`project_${currentProjectId}_characters`, characters);
        await storage.set(`project_${currentProjectId}_settingCategories`, settingCategories);
        await storage.set(`project_${currentProjectId}_settingItems`, settingItems);
        await storage.set(`project_${currentProjectId}_foreshadows`, foreshadows);
        await storage.set(`project_${currentProjectId}_materials`, materials);
        // 增量 Diff 编码后再持久化，降低 localStorage 体积
        const encodedVersions: Record<string, ReturnType<typeof encodeVersionsToDeltas>> = {};
        for (const [cid, vlist] of Object.entries(versions)) {
          encodedVersions[cid] = encodeVersionsToDeltas(vlist);
        }
        await storage.set(`project_${currentProjectId}_versions`, encodedVersions);
        await storage.set('projects', get().projects.map(p => p.id === currentProjectId ? updatedProject : p));
        // 与 Electron 分支一致：同步更新内存中的 projects，避免 lastSavedAt 已更新但 projects 仍为旧值
        set({
          projects: get().projects.map(p => p.id === currentProjectId ? updatedProject : p),
          lastSavedAt: now,
        });
        return true;
      }
    } catch (e) {
      console.error('Failed to save project:', e);
      // 持久化异常必须告知用户，否则用户会误以为已保存导致数据丢失
      const msg = e instanceof Error ? e.message : String(e);
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
      set({ currentProjectFilePath: filePath });
      const ok = await get().saveProject();
      return ok ? filePath : null;
    }
    return null;
  },

  closeProject: () => {
    triggerSave();
    clearAutoSaveTimer();
    // 关闭项目时终止搜索 Worker，释放子线程资源并防止监听器泄漏
    disposeSearchWorker();
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
      histories: {},
      conflicts: [],
      aiSuggestions: [],
      currentChapterId: null,
      lastSavedAt: null,
      // 重置 AI 生成状态、搜索与章节分析，防止上一个项目的残留状态污染无项目状态
      isAIGenerating: false,
      searchQuery: '',
      searchResults: [],
      analysis: {},
    });
  },

  deleteProject: async (projectId: string) => {
    const projects = get().projects.filter(p => p.id !== projectId);
    set({ projects });
    const results = await Promise.allSettled([
      storage.set('projects', projects),
      storage.remove(`project_${projectId}_chapters`),
      storage.remove(`project_${projectId}_characters`),
      storage.remove(`project_${projectId}_settingCategories`),
      storage.remove(`project_${projectId}_settingItems`),
      storage.remove(`project_${projectId}_foreshadows`),
      storage.remove(`project_${projectId}_materials`),
      storage.remove(`project_${projectId}_versions`),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('deleteProject: storage operation failed', r.reason);
      }
    }
  },

  updateProject: (projectId: string, updates: Partial<Project>) => {
    const projects = get().projects.map(p =>
      p.id === projectId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
    );
    void storage.set('projects', projects);
    set({ projects });
    markDirty();
  },

  loadSampleProject: () => {
    const { project, chapters, characters, settingCategories, settingItems, foreshadows, materials } = createSampleProject();
    const projects = [...get().projects, project];
    void storage.set('projects', projects);

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
    });
    markDirty();
  },
});
