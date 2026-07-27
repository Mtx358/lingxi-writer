import {
  countWords,
  generateId,
  isElectron,
  markDirty,
  triggerSave,
  setAutoSaveCallback,
  clearAutoSaveTimer,
  getDirtyState,
  formatDate,
  storage,
  runMigration,
  checkLocalStorageData,
  migrateLocalStorageToProjectFile,
} from '@/utils/storage';
import type { Project } from '@/types';

// 共享 toast mock：vi.hoisted 保证在 vi.mock 工厂执行时已定义。
// 同一引用让顶层 import 的 toast 与 LocalStorage 动态 import 的 toast 都指向同一 mock
const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/hooks/useToast', () => ({ toast: toastMock }));

// 测试环境（setup.ts）下 window.electronAPI 保证存在，非空断言一次以简化后续引用。
// 注：isElectron 测试与 LocalStorage describe 需直接操作 window.electronAPI，不走此别名
const electronAPI = window.electronAPI!;

describe('storage 工具函数', () => {
  describe('countWords', () => {
    it('空字符串 → 0', () => {
      const input = '';
      const result = countWords(input);
      expect(result).toBe(0);
    });

    it('纯中文 "你好世界" → 4（每个 CJK 字符计 1 字）', () => {
      const input = '你好世界';
      const result = countWords(input);
      expect(result).toBe(4);
    });

    it('纯英文 "hello world" → 1（内部 strip 空白后 helloworld 计为 1 个单词）', () => {
      const input = 'hello world';
      const result = countWords(input);
      expect(result).toBe(1);
    });

    it('中英混合 "你好 hello 世界 world" → 5（去空格后 helloworld 计为 1 个单词）', () => {
      const input = '你好 hello 世界 world';
      const result = countWords(input);
      expect(result).toBe(5);
    });

    it('含 HTML 标签：函数内部 strip HTML（调用方无需预处理）', () => {
      const input = '<p>你好</p><p>世界</p>';
      const result = countWords(input);
      expect(result).toBe(4);
    });

    it('含全角标点 "你好，世界！" → 6（全角标点在 \\uFF00-\\uFFEF 范围内计入 CJK）', () => {
      const input = '你好，世界！';
      const result = countWords(input);
      expect(result).toBe(6);
    });

    it('多空格 "你好   世界" → 4（空白被统一移除）', () => {
      const input = '你好   世界';
      const result = countWords(input);
      expect(result).toBe(4);
    });

    it('emoji "😀😁😂" → 0（不在 CJK 范围也不是字母数字）', () => {
      const input = '😀😁😂';
      const result = countWords(input);
      expect(result).toBe(0);
    });
  });

  describe('generateId', () => {
    it('返回非空字符串', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('连续调用 1000 次无碰撞', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(1000);
    });

    it('格式符合 UUID v4（crypto.randomUUID 优先）', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('isElectron', () => {
    it('有 window.electronAPI → true（setup.ts 已 mock）', () => {
      const result = isElectron();
      expect(result).toBe(true);
    });

    it('无 window.electronAPI → false', () => {
      const original = window.electronAPI;
      try {
        delete window.electronAPI;
        const result = isElectron();
        expect(result).toBe(false);
      } finally {
        Object.defineProperty(window, 'electronAPI', {
          value: original,
          writable: true,
          configurable: true,
        });
      }
    });
  });

  describe('markDirty / triggerSave', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      clearAutoSaveTimer();
      setAutoSaveCallback(async () => {});
      if (getDirtyState()) {
        await triggerSave();
      }
    });

    afterEach(() => {
      clearAutoSaveTimer();
      setAutoSaveCallback(async () => {});
      vi.useRealTimers();
    });

    it('markDirty 设置 isDirty', () => {
      expect(getDirtyState()).toBe(false);
      markDirty();
      expect(getDirtyState()).toBe(true);
    });

    it('triggerSave 调用 saveCallback', async () => {
      const mockCallback = vi.fn(async () => {});
      setAutoSaveCallback(mockCallback);
      markDirty();
      expect(mockCallback).not.toHaveBeenCalled();
      await triggerSave();
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('triggerSave 成功后清除 isDirty', async () => {
      markDirty();
      expect(getDirtyState()).toBe(true);
      await triggerSave();
      expect(getDirtyState()).toBe(false);
    });

    it('triggerSave 期间 markDirty 不丢失（P43 dirtyVersion 竞态修复）', async () => {
      let resolveSave!: () => void;
      const blockingPromise = new Promise<void>(resolve => {
        resolveSave = resolve;
      });
      const mockCallback = vi.fn(() => blockingPromise);
      setAutoSaveCallback(mockCallback);

      markDirty();
      const triggerPromise = triggerSave();
      markDirty();
      resolveSave();
      await triggerPromise;

      expect(getDirtyState()).toBe(true);
    });

    it('并发 triggerSave 串行化执行（inflightSave 链，不跳过）', async () => {
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>(resolve => {
        resolveFirst = resolve;
      });
      let callCount = 0;
      const mockCallback = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          await firstPromise;
        }
      });
      setAutoSaveCallback(mockCallback);

      markDirty();
      const first = triggerSave();
      const second = triggerSave();
      resolveFirst();
      await Promise.all([first, second]);

      expect(mockCallback).toHaveBeenCalledTimes(2);
    });

    it('markDirty 设置的自动保存定时器到时触发保存', async () => {
      const mockCallback = vi.fn(async () => {});
      setAutoSaveCallback(mockCallback);
      markDirty();
      expect(mockCallback).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30000);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(getDirtyState()).toBe(false);
    });
  });
});

// ============ formatDate ============
describe('formatDate', () => {
  it('格式化有效 ISO 日期字符串 → 含年/月/日', () => {
    const result = formatDate('2024-01-15T10:30:00Z');
    expect(result).toMatch(/2024/);
    expect(result).toContain('01');
    expect(result).toContain('15');
  });

  it('Invalid date → 不抛出（toLocaleString 返回 "Invalid Date"）', () => {
    expect(() => formatDate('not-a-date')).not.toThrow();
  });
});

// ============ ElectronStorage 类（通过 storage 单例测试） ============
// 测试 setup.ts 的 mock 仅提供 storage.get/set/remove，但 storage.ts 调用的是
// storage.read/write/remove。在 beforeAll 中补齐 read/write 与 projectFile 缺失方法
describe('ElectronStorage 类', () => {
  beforeAll(() => {
    const storageApi = electronAPI.storage as unknown as Record<string, unknown>;
    if (!storageApi.read) storageApi.read = vi.fn();
    if (!storageApi.write) storageApi.write = vi.fn();
    const projectFileApi = electronAPI.projectFile as unknown as Record<string, unknown>;
    if (!projectFileApi.backup) projectFileApi.backup = vi.fn().mockResolvedValue({ success: false });
    if (!projectFileApi.restoreBackup) projectFileApi.restoreBackup = vi.fn().mockResolvedValue({ success: false });
    if (!projectFileApi.saveDialog) projectFileApi.saveDialog = vi.fn().mockResolvedValue(null);
  });

  describe('get', () => {
    it('storage.read 返回非 null/undefined → 返回该值', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('hello');
      const result = await storage.get<string>('key', 'default');
      expect(result).toBe('hello');
    });

    it('storage.read 返回 null → 返回 defaultValue', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const result = await storage.get('key', 'default');
      expect(result).toBe('default');
    });

    it('storage.read 返回 undefined → 返回 defaultValue', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      const result = await storage.get('key', 'default');
      expect(result).toBe('default');
    });

    it('storage.read 抛出异常 → 返回 defaultValue', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.get('key', 'default');
      expect(result).toBe('default');
    });
  });

  describe('set', () => {
    it('storage.write 成功 → 无 toast.error', async () => {
      vi.mocked(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await storage.set('key', 'value');
      expect(toastMock.error).not.toHaveBeenCalled();
    });

    it('storage.write 抛出异常 → toast.error', async () => {
      vi.mocked(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
      await storage.set('key', 'value');
      expect(toastMock.error).toHaveBeenCalledWith(
        '数据写入失败',
        expect.stringContaining('disk full'),
      );
    });

    it('storage.write 返回 false（磁盘满/权限错误/isQuitting）→ toast.error 让用户感知（H2 修复）', async () => {
      // 主进程 storage:write 在所有失败路径返回 false 而非抛异常，
      // 此前 set 仅 try/catch 导致 catch 永不触发，写入失败静默丢失。
      // 修复后 set 检查返回值，false 时显式 toast.error。
      vi.mocked(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      await storage.set('important_key', 'important_value');
      expect(toastMock.error).toHaveBeenCalledWith(
        '数据写入失败',
        expect.stringContaining('important_key'),
      );
    });
  });

  describe('remove', () => {
    it('storage.remove 成功 → 无异常抛出', async () => {
      vi.mocked(electronAPI.storage.remove as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await expect(storage.remove('key')).resolves.toBeUndefined();
    });

    it('storage.remove 抛出异常 → rethrow 让调用方感知失败（deleteProject 的 allSettled 据此判定 hasFailure）', async () => {
      vi.mocked(electronAPI.storage.remove as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('IPC failed'));
      // 修复 H3：remove 失败时 rethrow，避免 deleteProject 的 hasFailure 永远为 false、磁盘残留无感知
      await expect(storage.remove('key')).rejects.toThrow('IPC failed');
    });
  });

  describe('readProjectFile', () => {
    it('projectFile.read 返回 success+data → 返回 data', async () => {
      const mockData = {
        project: { id: 'p1' }, chapters: [], characters: [],
        settingCategories: [], settingItems: [], foreshadows: [],
        materials: [], versions: {},
      };
      vi.mocked(electronAPI.projectFile.read).mockResolvedValueOnce({ success: true, data: mockData });
      const result = await storage.readProjectFile('/path.cwp');
      expect(result).toEqual(mockData);
    });

    it('projectFile.read 返回 success=false → null', async () => {
      vi.mocked(electronAPI.projectFile.read).mockResolvedValueOnce({ success: false, error: 'mock' });
      const result = await storage.readProjectFile('/path.cwp');
      expect(result).toBeNull();
    });

    it('projectFile.read 抛出异常 → null', async () => {
      vi.mocked(electronAPI.projectFile.read).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.readProjectFile('/path.cwp');
      expect(result).toBeNull();
    });
  });

  describe('writeProjectFile', () => {
    const mockArgs: Parameters<typeof storage.writeProjectFile> = [
      '/path.cwp',
      { id: 'p1' } as Project,
      [], [], [], [], [], [], {},
    ];

    it('projectFile.write 返回 success=true → true', async () => {
      vi.mocked(electronAPI.projectFile.write).mockResolvedValueOnce({ success: true });
      const result = await storage.writeProjectFile(...mockArgs);
      expect(result).toBe(true);
    });

    it('projectFile.write 返回 success=false → toast.error + false', async () => {
      vi.mocked(electronAPI.projectFile.write).mockResolvedValueOnce({ success: false });
      const result = await storage.writeProjectFile(...mockArgs);
      expect(result).toBe(false);
      expect(toastMock.error).toHaveBeenCalled();
    });

    it('projectFile.write 抛出异常 → toast.error + false', async () => {
      vi.mocked(electronAPI.projectFile.write).mockRejectedValueOnce(new Error('disk full'));
      const result = await storage.writeProjectFile(...mockArgs);
      expect(result).toBe(false);
      expect(toastMock.error).toHaveBeenCalled();
    });
  });

  describe('backupProjectFile', () => {
    it('projectFile.backup 返回 success=true → true', async () => {
      vi.mocked(electronAPI.projectFile.backup as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });
      const result = await storage.backupProjectFile('/path.cwp');
      expect(result).toBe(true);
    });

    it('projectFile.backup 返回 success=false → toast.warning + false', async () => {
      vi.mocked(electronAPI.projectFile.backup as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false });
      const result = await storage.backupProjectFile('/path.cwp');
      expect(result).toBe(false);
      expect(toastMock.warning).toHaveBeenCalled();
    });

    it('projectFile.backup 抛出异常 → toast.warning + false', async () => {
      vi.mocked(electronAPI.projectFile.backup as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.backupProjectFile('/path.cwp');
      expect(result).toBe(false);
      expect(toastMock.warning).toHaveBeenCalled();
    });
  });

  describe('listBackups', () => {
    it('projectFile.listBackups 返回 success+backups → 返回 backups', async () => {
      const backups = [{ name: 'b1', path: '/b1', timestamp: '2024-01-01' }];
      vi.mocked(electronAPI.projectFile.listBackups).mockResolvedValueOnce({ success: true, backups });
      const result = await storage.listBackups('/path.cwp');
      expect(result).toEqual(backups);
    });

    it('projectFile.listBackups 返回 success=false → []', async () => {
      vi.mocked(electronAPI.projectFile.listBackups).mockResolvedValueOnce({ success: false });
      const result = await storage.listBackups('/path.cwp');
      expect(result).toEqual([]);
    });

    it('projectFile.listBackups 抛出异常 → []', async () => {
      vi.mocked(electronAPI.projectFile.listBackups).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.listBackups('/path.cwp');
      expect(result).toEqual([]);
    });
  });

  describe('restoreBackup', () => {
    it('projectFile.restoreBackup 返回 success=true → true', async () => {
      vi.mocked(electronAPI.projectFile.restoreBackup as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });
      const result = await storage.restoreBackup('/backup', '/target');
      expect(result).toBe(true);
    });

    it('projectFile.restoreBackup 抛出异常 → false', async () => {
      vi.mocked(electronAPI.projectFile.restoreBackup as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.restoreBackup('/backup', '/target');
      expect(result).toBe(false);
    });
  });

  describe('openFileDialog', () => {
    it('projectFile.openDialog 返回路径 → 返回该路径', async () => {
      vi.mocked(electronAPI.projectFile.openDialog).mockResolvedValueOnce('/path.cwp');
      const result = await storage.openFileDialog();
      expect(result).toBe('/path.cwp');
    });

    it('projectFile.openDialog 返回空 → null', async () => {
      vi.mocked(electronAPI.projectFile.openDialog).mockResolvedValueOnce('');
      const result = await storage.openFileDialog();
      expect(result).toBeNull();
    });

    it('projectFile.openDialog 抛出异常 → null', async () => {
      vi.mocked(electronAPI.projectFile.openDialog).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.openFileDialog();
      expect(result).toBeNull();
    });
  });

  describe('saveFileDialog', () => {
    it('projectFile.saveDialog 返回路径 → 返回该路径', async () => {
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/path.cwp');
      const result = await storage.saveFileDialog('default.cwp');
      expect(result).toBe('/path.cwp');
    });

    it('projectFile.saveDialog 返回空 → null', async () => {
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');
      const result = await storage.saveFileDialog('default.cwp');
      expect(result).toBeNull();
    });

    it('projectFile.saveDialog 抛出异常 → null', async () => {
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.saveFileDialog('default.cwp');
      expect(result).toBeNull();
    });
  });

  describe('recovery draft', () => {
    it('saveRecoveryDraft 调用 storage.write', async () => {
      vi.mocked(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await storage.saveRecoveryDraft('p1', 'c1', 'content');
      expect(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('recovery_draft', expect.objectContaining({
        projectId: 'p1',
        chapterId: 'c1',
        content: 'content',
      }));
    });

    it('loadRecoveryDraft 返回有效草稿', async () => {
      const draft = { projectId: 'p1', chapterId: 'c1', content: 'content', timestamp: new Date().toISOString() };
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(draft);
      const result = await storage.loadRecoveryDraft();
      expect(result).toEqual(draft);
    });

    it('loadRecoveryDraft 形状不全（缺字段）→ null', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ projectId: 'p1' });
      const result = await storage.loadRecoveryDraft();
      expect(result).toBeNull();
    });

    it('loadRecoveryDraft 过期 → 清除并返回 null', async () => {
      const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        projectId: 'p1', chapterId: 'c1', content: 'x', timestamp: expired,
      });
      vi.mocked(electronAPI.storage.remove as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const result = await storage.loadRecoveryDraft();
      expect(result).toBeNull();
      expect(electronAPI.storage.remove).toHaveBeenCalledWith('recovery_draft');
    });

    it('loadRecoveryDraft read 抛出异常 → null', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.loadRecoveryDraft();
      expect(result).toBeNull();
    });

    it('checkForRecovery 等价于 loadRecoveryDraft', async () => {
      const draft = { projectId: 'p1', chapterId: 'c1', content: 'content', timestamp: new Date().toISOString() };
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(draft);
      const result = await storage.checkForRecovery();
      expect(result).toEqual(draft);
    });

    it('clearRecoveryDraft 调用 storage.remove', async () => {
      vi.mocked(electronAPI.storage.remove as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await storage.clearRecoveryDraft();
      expect(electronAPI.storage.remove).toHaveBeenCalledWith('recovery_draft');
    });
  });

  describe('AI settings', () => {
    const settings = {
      apiKey: 'sk-xxx',
      provider: 'openai',
      baseUrl: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
    };

    it('saveAISettings 成功 → true', async () => {
      vi.mocked(electronAPI.ai.saveSettings).mockResolvedValueOnce(true);
      const result = await storage.saveAISettings(settings);
      expect(result).toBe(true);
      expect(electronAPI.ai.saveSettings).toHaveBeenCalledWith(settings);
    });

    it('saveAISettings 抛出异常 → false', async () => {
      vi.mocked(electronAPI.ai.saveSettings).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.saveAISettings(settings);
      expect(result).toBe(false);
    });

    it('loadAISettings 返回有效对象 → 返回该对象', async () => {
      vi.mocked(electronAPI.ai.loadSettings).mockResolvedValueOnce(settings);
      const result = await storage.loadAISettings();
      expect(result).toEqual(settings);
    });

    it('loadAISettings 返回 null → null', async () => {
      vi.mocked(electronAPI.ai.loadSettings).mockResolvedValueOnce(null);
      const result = await storage.loadAISettings();
      expect(result).toBeNull();
    });

    it('loadAISettings 返回非对象 → null', async () => {
      vi.mocked(electronAPI.ai.loadSettings).mockResolvedValueOnce('not an object');
      const result = await storage.loadAISettings();
      expect(result).toBeNull();
    });

    it('loadAISettings 抛出异常 → null', async () => {
      vi.mocked(electronAPI.ai.loadSettings).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.loadAISettings();
      expect(result).toBeNull();
    });
  });

  describe('patchProjects', () => {
    it('成功 → 返回 Project[]', async () => {
      const projects = [{ id: 'p1' } as Project];
      vi.mocked(electronAPI.storage.patchProjects).mockResolvedValueOnce(projects);
      const result = await storage.patchProjects({ type: 'clear' });
      expect(result).toEqual(projects);
    });

    it('抛出异常 → null', async () => {
      vi.mocked(electronAPI.storage.patchProjects).mockRejectedValueOnce(new Error('IPC failed'));
      const result = await storage.patchProjects({ type: 'clear' });
      expect(result).toBeNull();
    });
  });
});

// ============ LocalStorage 类 ============
// 通过 vi.resetModules + 动态 import 在 isElectron()=false 环境下获得 LocalStorage 单例
describe('LocalStorage 类', () => {
  let localStore: typeof storage;

  beforeAll(async () => {
    const originalElectron = (window as unknown as { electronAPI?: unknown }).electronAPI;
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    try {
      vi.resetModules();
      const mod = await import('@/utils/storage');
      localStore = mod.storage;
    } finally {
      Object.defineProperty(window, 'electronAPI', {
        value: originalElectron,
        writable: true,
        configurable: true,
      });
      vi.resetModules();
    }
  });

  beforeEach(() => {
    localStorage.clear();
    toastMock.error.mockClear();
    toastMock.warning.mockClear();
    toastMock.success.mockClear();
    toastMock.info.mockClear();
  });

  describe('get', () => {
    it('localStorage 有键 → 返回解析后的值', async () => {
      localStorage.setItem('testKey', JSON.stringify({ a: 1 }));
      const result = await localStore.get('testKey', null);
      expect(result).toEqual({ a: 1 });
    });

    it('localStorage 无键 → 返回 defaultValue', async () => {
      const result = await localStore.get('missing', 'default');
      expect(result).toBe('default');
    });

    it('localStorage 键值 JSON.parse 失败 → 删除键、返回 defaultValue', async () => {
      localStorage.setItem('brokenKey', '{not valid json');
      const result = await localStore.get('brokenKey', 'default');
      expect(result).toBe('default');
      expect(localStorage.getItem('brokenKey')).toBeNull();
    });

    it('项目级键解析失败 → toast.error', async () => {
      localStorage.setItem('project_123_chapters', '{broken');
      await localStore.get('project_123_chapters', []);
      expect(toastMock.error).toHaveBeenCalledWith(
        '数据损坏',
        expect.stringContaining('project_123_chapters'),
      );
    });

    it('非项目级键解析失败 → 不调用 toast.error', async () => {
      localStorage.setItem('some_key', '{broken');
      await localStore.get('some_key', []);
      expect(toastMock.error).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('正常写入 localStorage', async () => {
      await localStore.set('key', { a: 1 });
      expect(localStorage.getItem('key')).toBe('{"a":1}');
    });

    it('配额超限错误 → toast.error 提示', async () => {
      const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw quotaError;
      });
      await localStore.set('key', 'value');
      expect(toastMock.error).toHaveBeenCalledWith(
        '浏览器存储已满',
        expect.any(String),
      );
      setItemSpy.mockRestore();
    });

    it('非配额错误 → toast.error 提示', async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('some other error');
      });
      await localStore.set('key', 'value');
      expect(toastMock.error).toHaveBeenCalledWith('数据写入失败', expect.any(String));
      setItemSpy.mockRestore();
    });
  });

  describe('remove', () => {
    it('localStorage.removeItem 调用', async () => {
      localStorage.setItem('key', 'value');
      await localStore.remove('key');
      expect(localStorage.getItem('key')).toBeNull();
    });
  });

  describe('writeProjectFile', () => {
    it('写入多个 project_xxx_yyy 键，返回 true', async () => {
      const project = { id: 'p1' } as Project;
      const result = await localStore.writeProjectFile(
        '/path/file.cwp',
        project, [], [], [], [], [], [], {},
      );
      expect(result).toBe(true);
      expect(localStorage.getItem('project_p1_chapters')).toBe('[]');
      expect(localStorage.getItem('project_p1_characters')).toBe('[]');
      expect(localStorage.getItem('project_p1_settingCategories')).toBe('[]');
      expect(localStorage.getItem('project_p1_settingItems')).toBe('[]');
      expect(localStorage.getItem('project_p1_foreshadows')).toBe('[]');
      expect(localStorage.getItem('project_p1_materials')).toBe('[]');
      expect(localStorage.getItem('project_p1_versions')).toBe('{}');
    });
  });

  describe('backup/list/restore/dialog', () => {
    it('backupProjectFile → false（web 环境不支持）', async () => {
      const result = await localStore.backupProjectFile('/path');
      expect(result).toBe(false);
    });

    it('listBackups → []', async () => {
      const result = await localStore.listBackups('/path');
      expect(result).toEqual([]);
    });

    it('restoreBackup → false', async () => {
      const result = await localStore.restoreBackup('/path', '/target');
      expect(result).toBe(false);
    });

    it('openFileDialog → null', async () => {
      const result = await localStore.openFileDialog();
      expect(result).toBeNull();
    });

    it('saveFileDialog → null', async () => {
      const result = await localStore.saveFileDialog('default');
      expect(result).toBeNull();
    });
  });

  describe('recovery draft', () => {
    it('saveRecoveryDraft + loadRecoveryDraft 往返', async () => {
      await localStore.saveRecoveryDraft('p1', 'c1', 'content');
      const draft = await localStore.loadRecoveryDraft();
      expect(draft).not.toBeNull();
      expect(draft!.projectId).toBe('p1');
      expect(draft!.chapterId).toBe('c1');
      expect(draft!.content).toBe('content');
    });

    it('loadRecoveryDraft 无草稿 → null', async () => {
      const draft = await localStore.loadRecoveryDraft();
      expect(draft).toBeNull();
    });

    it('loadRecoveryDraft 形状不全（缺字段）→ null', async () => {
      localStorage.setItem('recovery_draft', JSON.stringify({ projectId: 'p1' }));
      const draft = await localStore.loadRecoveryDraft();
      expect(draft).toBeNull();
    });

    it('loadRecoveryDraft 过期 → 清除并返回 null', async () => {
      const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('recovery_draft', JSON.stringify({
        projectId: 'p1', chapterId: 'c1', content: 'x', timestamp: expired,
      }));
      const draft = await localStore.loadRecoveryDraft();
      expect(draft).toBeNull();
      expect(localStorage.getItem('recovery_draft')).toBeNull();
    });

    it('checkForRecovery 等价于 loadRecoveryDraft', async () => {
      await localStore.saveRecoveryDraft('p1', 'c1', 'content');
      const result = await localStore.checkForRecovery();
      expect(result).not.toBeNull();
      expect(result!.projectId).toBe('p1');
    });

    it('clearRecoveryDraft 清除草稿', async () => {
      await localStore.saveRecoveryDraft('p1', 'c1', 'content');
      await localStore.clearRecoveryDraft();
      const draft = await localStore.loadRecoveryDraft();
      expect(draft).toBeNull();
    });
  });

  describe('AI settings', () => {
    const settings = {
      apiKey: 'sk-xxx',
      provider: 'openai',
      baseUrl: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
    };

    it('saveAISettings + loadAISettings 往返', async () => {
      const saved = await localStore.saveAISettings(settings);
      expect(saved).toBe(true);
      const loaded = await localStore.loadAISettings();
      expect(loaded).toEqual(settings);
    });

    it('loadAISettings 无设置 → null', async () => {
      const loaded = await localStore.loadAISettings();
      expect(loaded).toBeNull();
    });

    it('saveAISettings setItem 失败 → false', async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      const result = await localStore.saveAISettings({
        apiKey: 'sk-xxx', provider: 'openai', baseUrl: '', model: '',
        temperature: 0.7, maxTokens: 2000,
      });
      expect(result).toBe(false);
      setItemSpy.mockRestore();
    });

    it('loadAISettings JSON.parse 失败 → null', async () => {
      localStorage.setItem('aiSettings', '{invalid');
      const loaded = await localStore.loadAISettings();
      expect(loaded).toBeNull();
    });

    it('loadAISettings 解析为非对象 → null', async () => {
      localStorage.setItem('aiSettings', '"string value"');
      const loaded = await localStore.loadAISettings();
      expect(loaded).toBeNull();
    });
  });

  describe('patchProjects', () => {
    it('add 新项目', async () => {
      const p1 = { id: 'p1', title: 'P1' } as Project;
      const result = await localStore.patchProjects({ type: 'add', project: p1 });
      expect(result).toEqual([p1]);
    });

    it('add 已存在的 id → 更新', async () => {
      const p1 = { id: 'p1', title: 'Old' } as Project;
      await localStore.patchProjects({ type: 'add', project: p1 });
      const p1New = { id: 'p1', title: 'New' } as Project;
      const result = await localStore.patchProjects({ type: 'add', project: p1New });
      expect(result).toEqual([p1New]);
    });

    it('remove 项目', async () => {
      const p1 = { id: 'p1' } as Project;
      const p2 = { id: 'p2' } as Project;
      await localStore.patchProjects({ type: 'add', project: p1 });
      await localStore.patchProjects({ type: 'add', project: p2 });
      const result = await localStore.patchProjects({ type: 'remove', id: 'p1' });
      expect(result).toEqual([p2]);
    });

    it('update 已存在的项目 → 合并字段', async () => {
      const p1 = { id: 'p1', title: 'Old' } as Project;
      await localStore.patchProjects({ type: 'add', project: p1 });
      const result = await localStore.patchProjects({
        type: 'update',
        project: { id: 'p1', title: 'New' } as Project,
      });
      expect(result).toEqual([{ id: 'p1', title: 'New' }]);
    });

    it('update 不存在的项目 → push', async () => {
      const result = await localStore.patchProjects({
        type: 'update',
        project: { id: 'p1', title: 'New' } as Project,
      });
      expect(result).toEqual([{ id: 'p1', title: 'New' }]);
    });

    it('clear 清空所有项目', async () => {
      await localStore.patchProjects({ type: 'add', project: { id: 'p1' } as Project });
      const result = await localStore.patchProjects({ type: 'clear' });
      expect(result).toEqual([]);
    });

    it('localStorage 数据非数组 → 返回 null 不覆盖原数据（防数据丢失）', async () => {
      localStorage.setItem('projects', '{"not":"array"}');
      const result = await localStore.patchProjects({ type: 'add', project: { id: 'p1' } as Project });
      expect(result).toBeNull();
      // 原数据未被覆盖
      expect(localStorage.getItem('projects')).toBe('{"not":"array"}');
    });

    it('JSON.parse 失败 → 返回 null', async () => {
      localStorage.setItem('projects', '{invalid json');
      const result = await localStore.patchProjects({ type: 'clear' });
      expect(result).toBeNull();
    });
  });
});

// ============ migration 函数 ============
describe('migration 函数', () => {
  beforeEach(() => {
    toastMock.error.mockClear();
    toastMock.warning.mockClear();
    toastMock.success.mockClear();
    toastMock.info.mockClear();
  });

  describe('runMigration', () => {
    it('首次迁移（无版本）→ 返回 true 并写入版本', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');
      vi.mocked(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const result = await runMigration();
      expect(result).toBe(true);
      expect(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('app_migration_version', '2.0.0');
    });

    it('已是当前版本 → 返回 false', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('2.0.0');
      const result = await runMigration();
      expect(result).toBe(false);
      expect(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('旧版本 → 迁移到新版本', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('1.0.0');
      vi.mocked(electronAPI.storage.write as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const result = await runMigration();
      expect(result).toBe(true);
    });
  });

  describe('checkLocalStorageData', () => {
    it('无项目 → false', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const result = await checkLocalStorageData();
      expect(result).toBe(false);
    });

    it('有项目 → true', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'p1' }]);
      const result = await checkLocalStorageData();
      expect(result).toBe(true);
    });
  });

  describe('migrateLocalStorageToProjectFile', () => {
    const project = { id: 'p1', title: '测试项目' } as Project;

    it('无项目 → null', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => []);
      const result = await migrateLocalStorageToProjectFile();
      expect(result).toBeNull();
    });

    it('saveFileDialog 取消 → null', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'projects') return [project];
        return [];
      });
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const result = await migrateLocalStorageToProjectFile();
      expect(result).toBeNull();
    });

    it('writeProjectFile 成功 → 返回 filePath 并清理 localStorage 键', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'projects') return [project];
        return [];
      });
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/new/path.cwp');
      vi.mocked(electronAPI.projectFile.write).mockResolvedValueOnce({ success: true });
      vi.mocked(electronAPI.storage.remove as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      const result = await migrateLocalStorageToProjectFile();
      expect(result).toBe('/new/path.cwp');
      expect(electronAPI.storage.remove).toHaveBeenCalledWith('project_p1_chapters');
      expect(electronAPI.storage.remove).toHaveBeenCalledWith('project_p1_characters');
      expect(electronAPI.storage.remove).toHaveBeenCalledWith('project_p1_versions');
    });

    it('writeProjectFile 失败 → null（不清理）', async () => {
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'projects') return [project];
        return [];
      });
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/new/path.cwp');
      vi.mocked(electronAPI.projectFile.write).mockResolvedValueOnce({ success: false });
      const result = await migrateLocalStorageToProjectFile();
      expect(result).toBeNull();
      expect(electronAPI.storage.remove).not.toHaveBeenCalled();
    });

    it('文件名包含非法字符 → 替换为 _', async () => {
      const projWithBadName = { id: 'p1', title: 'a/b:c*d?e' } as Project;
      vi.mocked(electronAPI.storage.read as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
        if (key === 'projects') return [projWithBadName];
        return [];
      });
      vi.mocked(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      await migrateLocalStorageToProjectFile();
      expect(electronAPI.projectFile.saveDialog as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('a_b_c_d_e.cwp');
    });
  });
});

// ============ auto-save 边界用例 ============
describe('auto-save 边界用例', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    clearAutoSaveTimer();
    setAutoSaveCallback(async () => {});
    if (getDirtyState()) {
      await triggerSave();
    }
  });

  afterEach(() => {
    clearAutoSaveTimer();
    setAutoSaveCallback(async () => {});
    vi.useRealTimers();
  });

  it('clearAutoSaveTimer：无定时器时不抛出', () => {
    expect(() => clearAutoSaveTimer()).not.toThrow();
  });

  it('clearAutoSaveTimer：有定时器时清除（自动保存不再触发）', async () => {
    const mockCallback = vi.fn(async () => {});
    setAutoSaveCallback(mockCallback);
    markDirty();
    clearAutoSaveTimer();
    await vi.advanceTimersByTimeAsync(60000);
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('triggerSave：无 saveCallback 时清除定时器并返回', async () => {
    markDirty();
    // 设置 saveCallback 为 null（绕过 TS 类型检查）
    setAutoSaveCallback(null as unknown as () => Promise<void>);
    await expect(triggerSave()).resolves.toBeUndefined();
  });

  it('triggerSave：saveCallback 抛出异常 → isDirty 保持 true', async () => {
    const mockCallback = vi.fn(async () => { throw new Error('save failed'); });
    setAutoSaveCallback(mockCallback);
    markDirty();
    expect(getDirtyState()).toBe(true);
    await triggerSave();
    expect(getDirtyState()).toBe(true);
  });

  it('markDirty：无 saveCallback 时设置定时器但不崩溃', async () => {
    setAutoSaveCallback(null as unknown as () => Promise<void>);
    markDirty();
    expect(getDirtyState()).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(getDirtyState()).toBe(true);
  });

  it('markDirty：自动保存失败 → isDirty 保持 true 以便下周期重试', async () => {
    const mockCallback = vi.fn(async () => { throw new Error('disk full'); });
    setAutoSaveCallback(mockCallback);
    markDirty();
    await vi.advanceTimersByTimeAsync(30000);
    expect(getDirtyState()).toBe(true);
  });
});
