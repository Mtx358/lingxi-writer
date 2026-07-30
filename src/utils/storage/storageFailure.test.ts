/**
 * 存储失败测试（B2）
 *
 * 验证磁盘满（ENOSPC）/ 权限拒绝（EACCES）等存储失败场景下：
 *   1. ElectronStorage（渲染层）正确处理 IPC 返回 false / IPC 抛错 → toast.error 提示用户
 *   2. ElectronStorage.remove IPC 抛错时错误被 re-throw（让调用方感知）
 *   3. autoSave 的 saveCallback 抛 ENOSPC/EACCES → isDirty 保持 true 供下周期重试
 *   4. autoSave 失败后重试成功 → isDirty 清除
 *
 * 测试策略（参考 autoSave.test.ts 风格）：
 *   - ElectronStorage 部分：直接实例化 ElectronStorage，mock window.electronAPI.storage.write
 *     返回 false（模拟主进程 fs.writeFile 抛 ENOSPC/EACCES 后返回 false）
 *   - autoSave 部分：setAutoSaveCallback 注入抛 ENOSPC/EACCES 的 callback，验证 dirty 状态
 *
 * 背景：主进程 storage:write handler 在 fs.writeFile/fs.rename 抛错时 catch 并返回 false，
 * 渲染层 ElectronStorage.set 检查返回值，false 时 toast.error 告知用户。
 * autoSave 的 saveCallback（projectSlice 注入）在持久化失败时抛错，
 * autoSave 捕获后保留 isDirty=true 以便下个周期重试，避免静默丢数据。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElectronStorage } from './electronBridge';
import {
  markDirty,
  triggerSave,
  setAutoSaveCallback,
  clearAutoSaveTimer,
  getDirtyState,
} from './autoSave';
import { AUTOSAVE_INTERVAL } from '@/constants/config';
import { toast } from '@/hooks/useToast';

// ============ toast mock ============
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ============ 构造带 code 属性的 Node.js 风格错误 ============
function makeNodeError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

// ============ ElectronStorage 测试辅助 ============
// setup.ts 的 window.electronAPI mock 缺少 storage.write / storage.read（preload 实际有），
// 此处补全，让 ElectronStorage 能正常调用
function ensureStorageWriteMock() {
  const storage = window.electronAPI!.storage as unknown as Record<string, unknown>;
  if (!storage.write) {
    storage.write = vi.fn().mockResolvedValue(true);
  }
  if (!storage.read) {
    storage.read = vi.fn().mockResolvedValue(null);
  }
  return storage as {
    write: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
}

describe('存储失败测试（B2）', () => {
  describe('ElectronStorage：IPC 返回 false / 抛错时正确提示用户', () => {
    let store: ElectronStorage;
    let storageMock: ReturnType<typeof ensureStorageWriteMock>;

    beforeEach(() => {
      store = new ElectronStorage();
      storageMock = ensureStorageWriteMock();
      vi.clearAllMocks();
    });

    it('磁盘满（ENOSPC）：IPC 返回 false → toast.error 提示"数据写入失败"', async () => {
      // 模拟主进程 fs.writeFile 抛 ENOSPC → handler catch → 返回 false
      storageMock.write.mockResolvedValue(false);

      await store.set('projects', [{ id: 'p1' }]);

      expect(storageMock.write).toHaveBeenCalledWith('projects', [{ id: 'p1' }]);
      expect(toast.error).toHaveBeenCalledWith(
        '数据写入失败',
        expect.stringContaining('持久化失败'),
      );
    });

    it('权限拒绝（EACCES）：IPC 返回 false → toast.error 提示"数据写入失败"', async () => {
      storageMock.write.mockResolvedValue(false);

      await store.set('project_p1_chapters', [{ id: 'c1' }]);

      expect(toast.error).toHaveBeenCalledWith(
        '数据写入失败',
        expect.stringContaining('project_p1_chapters'),
      );
    });

    it('IPC 抛 ENOSPC 错误 → catch → toast.error 含错误消息', async () => {
      const enospcError = makeNodeError('ENOSPC', 'no space left on device');
      storageMock.write.mockRejectedValue(enospcError);

      await store.set('projects', [{ id: 'p1' }]);

      // IPC 抛错走 catch 分支，toast.error 含 getErrorMessage 提取的消息
      expect(toast.error).toHaveBeenCalledWith(
        '数据写入失败',
        expect.stringContaining('no space left on device'),
      );
    });

    it('IPC 抛 EACCES 错误 → catch → toast.error 含错误消息', async () => {
      const eaccesError = makeNodeError('EACCES', 'permission denied');
      storageMock.write.mockRejectedValue(eaccesError);

      await store.set('recovery_draft', { content: 'draft' });

      expect(toast.error).toHaveBeenCalledWith(
        '数据写入失败',
        expect.stringContaining('permission denied'),
      );
    });

    it('writeProjectFile 返回 { success: false } → toast.error 提示项目保存失败', async () => {
      // 模拟主进程 projectFile:write 失败（如磁盘满导致 fs.writeFile 抛 ENOSPC）
      const projectFileWrite = window.electronAPI!.projectFile.write as ReturnType<typeof vi.fn>;
      projectFileWrite.mockResolvedValue({ success: false, error: 'ENOSPC' });

      const result = await store.writeProjectFile(
        '/path/to/file.cwp',
        { id: 'p1', title: 'T' } as never,
        [], [], [], [], [], [], {},
      );

      expect(result).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(
        '项目文件保存失败',
        expect.stringContaining('写入'),
      );
    });

    it('writeProjectFile IPC 抛 EACCES → catch → toast.error + 返回 false', async () => {
      const eaccesError = makeNodeError('EACCES', 'permission denied');
      const projectFileWrite = window.electronAPI!.projectFile.write as ReturnType<typeof vi.fn>;
      projectFileWrite.mockRejectedValue(eaccesError);

      const result = await store.writeProjectFile(
        '/path/to/file.cwp',
        { id: 'p1', title: 'T' } as never,
        [], [], [], [], [], [], {},
      );

      expect(result).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(
        '项目文件保存失败',
        expect.stringContaining('permission denied'),
      );
    });

    it('remove IPC 抛 EACCES → 错误被 re-throw（让调用方感知）', async () => {
      const eaccesError = makeNodeError('EACCES', 'permission denied');
      const storageRemove = window.electronAPI!.storage.remove as ReturnType<typeof vi.fn>;
      storageRemove.mockRejectedValue(eaccesError);

      // ElectronStorage.remove 在 IPC 抛错时 re-throw（不像 set 那样吞错），
      // 让 deleteProject 等调用方通过 Promise.allSettled 感知失败
      await expect(store.remove('project_p1_chapters')).rejects.toThrow('permission denied');
    });

    it('patchProjects IPC 抛错 → catch → 返回 null（不崩溃）', async () => {
      const enospcError = makeNodeError('ENOSPC', 'no space left on device');
      const patchProjects = window.electronAPI!.storage.patchProjects as ReturnType<typeof vi.fn>;
      patchProjects.mockRejectedValue(enospcError);

      const result = await store.patchProjects({ type: 'add', project: { id: 'p1' } as never });

      expect(result).toBeNull();
    });
  });

  describe('autoSave：存储失败时 dirty 状态保持（失败重试）', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      clearAutoSaveTimer();
      setAutoSaveCallback(async () => {});
      if (getDirtyState()) {
        // 清理上一个测试遗留的 dirty
        return triggerSave().then(() => undefined);
      }
      // 无遗留 dirty：显式返回 undefined 以满足 noImplicitReturns
      return undefined;
    });

    afterEach(() => {
      clearAutoSaveTimer();
      setAutoSaveCallback(async () => {});
      vi.useRealTimers();
    });

    it('saveCallback 抛 ENOSPC → isDirty 保持 true 供下周期重试', async () => {
      const enospcError = makeNodeError('ENOSPC', 'no space left on device');
      const failingCb = vi.fn(async (): Promise<void> => { throw enospcError; });
      setAutoSaveCallback(failingCb);

      markDirty();
      expect(getDirtyState()).toBe(true);

      await triggerSave();

      // 存储失败：isDirty 必须保持 true，否则用户编辑会静默丢失
      expect(getDirtyState()).toBe(true);
      expect(failingCb).toHaveBeenCalledTimes(1);
    });

    it('saveCallback 抛 EACCES → isDirty 保持 true 供下周期重试', async () => {
      const eaccesError = makeNodeError('EACCES', 'permission denied');
      const failingCb = vi.fn(async (): Promise<void> => { throw eaccesError; });
      setAutoSaveCallback(failingCb);

      markDirty();
      await triggerSave();

      expect(getDirtyState()).toBe(true);
      expect(failingCb).toHaveBeenCalledTimes(1);
    });

    it('自动保存周期触发时抛 ENOSPC → isDirty 保持 true 供下次自动重试', async () => {
      const enospcError = makeNodeError('ENOSPC', 'no space left on device');
      const failingCb = vi.fn(async (): Promise<void> => { throw enospcError; });
      setAutoSaveCallback(failingCb);

      markDirty();
      // 推进一个自动保存周期
      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL);

      // 自动保存失败：保留 dirty 以便下个周期重试
      expect(getDirtyState()).toBe(true);
      expect(failingCb).toHaveBeenCalledTimes(1);
    });

    it('失败后重试成功 → isDirty 清除', async () => {
      // 第一次抛 ENOSPC，第二次成功
      let callCount = 0;
      const cb = vi.fn(async (): Promise<void> => {
        callCount++;
        if (callCount === 1) {
          throw makeNodeError('ENOSPC', 'no space left on device');
        }
        // 第二次成功
      });
      setAutoSaveCallback(cb);

      markDirty();
      // 第一次 triggerSave 失败
      await triggerSave();
      expect(getDirtyState()).toBe(true);
      expect(cb).toHaveBeenCalledTimes(1);

      // 第二次 triggerSave 成功 → isDirty 清除
      await triggerSave();
      expect(getDirtyState()).toBe(false);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('连续 markDirty + triggerSave 失败 → dirtyVersion 保护新编辑不丢失', async () => {
      const enospcError = makeNodeError('ENOSPC', 'no space left on device');
      const cb = vi.fn(async (): Promise<void> => { throw enospcError; });
      setAutoSaveCallback(cb);

      markDirty();
      const firstSave = triggerSave();
      // triggerSave 进行中时再次 markDirty（模拟用户继续编辑）
      markDirty();
      await firstSave;

      // 新 dirty 不应被覆盖：isDirty 保持 true
      expect(getDirtyState()).toBe(true);
    });
  });
});
