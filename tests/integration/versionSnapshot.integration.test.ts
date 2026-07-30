/**
 * 流程 4：版本历史快照恢复集成测试
 *
 * 验证 saveVersion → 编辑修改 → restoreVersion → 内容回退 的完整链路：
 *   1. 创建项目 + 添加章节 + 编辑初始内容（内容 A）
 *   2. saveVersion：保存 A 的快照
 *   3. 继续编辑修改章节内容（内容 B）
 *   4. restoreVersion：恢复到 A 的快照
 *   5. 断言：章节内容回退到 A，且 restoreVersion 自动生成"恢复前备份"快照（B 内容）
 *   6. 再次 restoreVersion 到备份快照，断言内容回到 B（可往返恢复）
 *
 * Mock 策略：
 *   - storage：内存 Map 实现，让 versions 也可持久化（saveProject 写入 storage）
 *   - markDirty / triggerSave / clearAutoSaveTimer：no-op
 *   - toast：no-op
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import type { Project, Chapter, ChapterVersion } from '@/types';

// ============ 内存存储 mock ============
const { memoryStore, mockStorage } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();
  const mockStorage = {
    get: vi.fn(async <T>(key: string, defaultValue: T): Promise<T> => {
      return memoryStore.has(key) ? (memoryStore.get(key) as T) : defaultValue;
    }),
    set: vi.fn(async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value);
    }),
    setMany: vi.fn(async (entries: Record<string, unknown>): Promise<void> => {
      for (const [key, value] of Object.entries(entries)) {
        memoryStore.set(key, value);
      }
    }),
    remove: vi.fn(async (key: string): Promise<void> => { memoryStore.delete(key); }),
    patchProjects: vi.fn(async (op: { type: 'add'; project: Project } | { type: 'remove'; id: string } | { type: 'update'; project: Project } | { type: 'clear' }): Promise<Project[] | null> => {
      const cur = (memoryStore.get('projects') as Project[]) || [];
      let next = cur;
      if (op.type === 'add') next = cur.some(p => p.id === op.project.id) ? cur.map(p => (p.id === op.project.id ? op.project : p)) : [...cur, op.project];
      else if (op.type === 'remove') next = cur.filter(p => p.id !== op.id);
      else if (op.type === 'update') next = cur.some(p => p.id === op.project.id) ? cur.map(p => (p.id === op.project.id ? { ...p, ...op.project } : p)) : [...cur, op.project];
      else next = [];
      memoryStore.set('projects', next);
      return next;
    }),
    readProjectFile: vi.fn().mockResolvedValue(null),
    writeProjectFile: vi.fn().mockResolvedValue(false),
    backupProjectFile: vi.fn().mockResolvedValue(false),
    listBackups: vi.fn().mockResolvedValue([]),
    restoreBackup: vi.fn().mockResolvedValue(false),
    openFileDialog: vi.fn().mockResolvedValue(null),
    saveFileDialog: vi.fn().mockResolvedValue(null),
    checkForRecovery: vi.fn().mockResolvedValue(null),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    loadRecoveryDraft: vi.fn().mockResolvedValue(null),
    clearRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    saveAISettings: vi.fn().mockResolvedValue(true),
    loadAISettings: vi.fn().mockResolvedValue(null),
  };
  return { memoryStore, mockStorage };
});

vi.mock('@/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    storage: mockStorage,
    markDirty: vi.fn(),
    triggerSave: vi.fn(async () => {}),
    clearAutoSaveTimer: vi.fn(),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const EMPTY_STORE_STATE = {
  projects: [] as Project[],
  currentProjectId: null as string | null,
  currentProjectFilePath: null as string | null,
  lastSavedAt: null as string | null,
  isSaving: false,
  chapters: [] as Chapter[],
  currentChapterId: null as string | null,
  pendingEditorInsert: null,
  pendingScrollTo: null,
  contentEpoch: 0,
  isAIGenerating: false,
  characters: [],
  settingCategories: [],
  settingItems: [],
  foreshadows: [],
  materials: [],
  versions: {} as Record<string, ChapterVersion[]>,
  histories: {},
  conflicts: [],
  aiSuggestions: [],
  analysis: {},
  aiSettings: { ...DEFAULT_AI_SETTINGS },
  recoveryDraft: null,
  subplots: [],
  updateSchedule: null,
};

beforeEach(() => {
  memoryStore.clear();
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.setMany.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  useAppStore.setState(EMPTY_STORE_STATE);
});

describe('流程 4：版本历史快照恢复', () => {
  it('完整快照恢复链路：保存快照A → 编辑为B → 恢复到A → 内容回退', async () => {
    // ---------- 阶段 1：创建项目 + 章节，写入内容 A ----------
    await useAppStore.getState().createProject('版本恢复测试', 'blank');
    const chapter = useAppStore.getState().addChapter(null, '第一章', 0, 'chapter')!;
    const chapterId = chapter.id;

    const contentA = '<p>这是版本 A 的内容，描述了主角走进森林。</p>';
    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, contentA);

    // 阶段性断言：章节内容是 A
    expect(useAppStore.getState().chapters.find(c => c.id === chapterId)?.content).toBe(contentA);

    // ---------- 阶段 2：保存版本快照（A） ----------
    useAppStore.getState().saveVersion(chapterId, '版本A：主角进入森林');

    const versionsAfterA = useAppStore.getState().getVersions(chapterId);
    expect(versionsAfterA.length).toBe(1);
    expect(versionsAfterA[0].content).toBe(contentA);
    expect(versionsAfterA[0].description).toBe('版本A：主角进入森林');
    expect(versionsAfterA[0].autoGenerated).toBe(false); // 显式传入 description → 非 auto
    expect(versionsAfterA[0].metadata?.title).toBe('第一章');

    // ---------- 阶段 3：继续编辑，内容改为 B ----------
    const contentB = '<p>这是版本 B 的内容，主角在森林中遇到了神秘人。</p>';
    useAppStore.getState().updateChapterContent(chapterId, contentB);

    // 阶段性断言：章节内容已变为 B
    expect(useAppStore.getState().chapters.find(c => c.id === chapterId)?.content).toBe(contentB);

    // ---------- 阶段 4：恢复到版本 A ----------
    const versionAId = versionsAfterA[0].id;
    useAppStore.getState().restoreVersion(chapterId, versionAId);

    // ---------- 阶段 5：断言章节内容回退到 A ----------
    const restoredChapter = useAppStore.getState().chapters.find(c => c.id === chapterId);
    expect(restoredChapter?.content).toBe(contentA);

    // ---------- 阶段 6：restoreVersion 应自动生成"恢复前备份"快照（B 内容） ----------
    const versionsAfterRestore = useAppStore.getState().getVersions(chapterId);
    expect(versionsAfterRestore.length).toBe(2);

    // 备份版本是最新加入的，autoGenerated=false
    const backupVersion = versionsAfterRestore.find(v => v.content === contentB);
    expect(backupVersion).toBeDefined();
    expect(backupVersion?.description).toContain('恢复到版本');
    expect(backupVersion?.autoGenerated).toBe(false);

    // 版本号单调递增（备份版本号 > 原版本号）
    const maxVersion = Math.max(...versionsAfterRestore.map(v => v.version));
    expect(backupVersion?.version).toBe(maxVersion);

    // contentEpoch 已 bump（编辑器据此知道内容已变）
    expect(useAppStore.getState().contentEpoch).toBeGreaterThan(0);
  });

  it('往返恢复：A → B → 恢复到 A → 恢复到 B 备份 → 内容回到 B', async () => {
    await useAppStore.getState().createProject('往返测试', 'blank');
    const chapter = useAppStore.getState().addChapter(null, '章', 0, 'chapter')!;
    const chapterId = chapter.id;

    const contentA = '<p>内容 A</p>';
    const contentB = '<p>内容 B</p>';

    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, contentA);
    useAppStore.getState().saveVersion(chapterId, 'A');

    useAppStore.getState().updateChapterContent(chapterId, contentB);
    useAppStore.getState().saveVersion(chapterId, 'B');

    // 现在有 2 个版本（A、B）
    const versionsAB = useAppStore.getState().getVersions(chapterId);
    expect(versionsAB.length).toBe(2);
    const versionAId = versionsAB.find(v => v.content === contentA)!.id;

    // 恢复到 A：内容回退到 A，并自动生成 B 的备份
    useAppStore.getState().restoreVersion(chapterId, versionAId);
    expect(useAppStore.getState().chapters.find(c => c.id === chapterId)?.content).toBe(contentA);

    const versionsAfterRestore = useAppStore.getState().getVersions(chapterId);
    expect(versionsAfterRestore.length).toBe(3);

    // 找到 B 的备份版本（restoreVersion 自动生成的"恢复前备份"）
    const backupBVersion = versionsAfterRestore.find(v => v.content === contentB);
    expect(backupBVersion).toBeDefined();

    // 再次恢复到 B 备份：内容回到 B
    useAppStore.getState().restoreVersion(chapterId, backupBVersion!.id);
    expect(useAppStore.getState().chapters.find(c => c.id === chapterId)?.content).toBe(contentB);

    // 此时又自动生成了 A 内容的"恢复前备份"
    const versionsAfterSecondRestore = useAppStore.getState().getVersions(chapterId);
    const backupAVersion = versionsAfterSecondRestore.find(v => v.content === contentA && v.description?.includes('恢复到版本'));
    expect(backupAVersion).toBeDefined();
  });

  it('saveVersion 内容去重：相同内容不产生重复快照', async () => {
    await useAppStore.getState().createProject('去重测试', 'blank');
    const chapter = useAppStore.getState().addChapter(null, '章', 0, 'chapter')!;
    const chapterId = chapter.id;

    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, '<p>相同内容</p>');

    // 第一次保存快照
    useAppStore.getState().saveVersion(chapterId, '首次');
    expect(useAppStore.getState().getVersions(chapterId).length).toBe(1);

    // 内容未改变，再次保存：应跳过（M12 修复）
    useAppStore.getState().saveVersion(chapterId, '重复');
    expect(useAppStore.getState().getVersions(chapterId).length).toBe(1);

    // 修改内容后保存：新快照
    useAppStore.getState().updateChapterContent(chapterId, '<p>新内容</p>');
    useAppStore.getState().saveVersion(chapterId, '新版本');
    expect(useAppStore.getState().getVersions(chapterId).length).toBe(2);
  });

  it('deleteVersion：移除指定快照但不影响其他版本与章节内容', async () => {
    await useAppStore.getState().createProject('删除测试', 'blank');
    const chapter = useAppStore.getState().addChapter(null, '章', 0, 'chapter')!;
    const chapterId = chapter.id;

    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, '<p>V1</p>');
    useAppStore.getState().saveVersion(chapterId, 'V1');
    useAppStore.getState().updateChapterContent(chapterId, '<p>V2</p>');
    useAppStore.getState().saveVersion(chapterId, 'V2');

    const versions = useAppStore.getState().getVersions(chapterId);
    expect(versions.length).toBe(2);
    const v1Id = versions.find(v => v.content === '<p>V1</p>')!.id;

    // 删除 V1
    useAppStore.getState().deleteVersion(chapterId, v1Id);

    const versionsAfterDelete = useAppStore.getState().getVersions(chapterId);
    expect(versionsAfterDelete.length).toBe(1);
    expect(versionsAfterDelete.find(v => v.id === v1Id)).toBeUndefined();
    // V2 仍在
    expect(versionsAfterDelete.find(v => v.content === '<p>V2</p>')).toBeDefined();
    // 章节内容不变
    expect(useAppStore.getState().chapters.find(c => c.id === chapterId)?.content).toBe('<p>V2</p>');
  });

  it('持久化后重启：版本历史完整恢复', async () => {
    const project = await useAppStore.getState().createProject('持久化版本测试', 'blank');
    const projectId = project.id;
    const chapter = useAppStore.getState().addChapter(null, '章', 0, 'chapter')!;
    const chapterId = chapter.id;

    useAppStore.getState().setCurrentChapter(chapterId);
    useAppStore.getState().updateChapterContent(chapterId, '<p>快照内容</p>');
    useAppStore.getState().saveVersion(chapterId, '保存的快照');

    // saveProject 持久化 versions（增量 delta 编码后落到 storage）
    const saveOk = await useAppStore.getState().saveProject();
    expect(saveOk).toBe(true);
    expect(memoryStore.has(`project_${projectId}_versions`)).toBe(true);

    // 模拟重启
    useAppStore.setState(EMPTY_STORE_STATE);
    await useAppStore.getState().loadProjects();
    await useAppStore.getState().openProject(projectId);

    // 版本历史完整恢复
    const restoredVersions = useAppStore.getState().getVersions(chapterId);
    expect(restoredVersions.length).toBe(1);
    expect(restoredVersions[0].content).toBe('<p>快照内容</p>');
    expect(restoredVersions[0].description).toBe('保存的快照');
    expect(restoredVersions[0].autoGenerated).toBe(false);
  });
});
