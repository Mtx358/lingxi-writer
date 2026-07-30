/**
 * projectsStore 独立单元测试
 *
 * 直接 import './projectsStore' 模块。重点覆盖 migrateLocalStorageToProjectFile
 * 的版本 delta 解码路径（storage.test.ts 仅覆盖 happy/取消/写入失败/文件名净化，
 * 未覆盖 decodeDeltasToVersions 解码成功、单个/多个 delta 损坏回退与防 toast 风暴）。
 *
 * 注：patchProjects/addProject/removeProject/updateProject 属于 StorageAPI 适配器
 * 方法（electronBridge/localStorageAdapter），已在 storage.test.ts 覆盖，不在此重复。
 *
 * 测试范围：
 *   - versions 含 delta → 解码后传入 writeProjectFile
 *   - 单个 chapter delta 损坏 → toast.warning + 该 chapter 回退原数组
 *   - 多个 chapter delta 损坏 → 仅一次 toast.warning（防风暴）
 *   - versions 为空 {} → 不解码，正常写入
 *   - runMigration：已是当前版本 → false 不写
 *   - runMigration：旧版本 → 写入新版本并返回 true
 *   - checkLocalStorageData：有/无项目 → true/false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runMigration,
  checkLocalStorageData,
  migrateLocalStorageToProjectFile,
} from './projectsStore';
import { toast } from '@/hooks/useToast';
import type { Project } from '@/types';

// ============ 共享 mock：storage 单例 + decodeDeltasToVersions ============
const { storageMock, decodeMock } = vi.hoisted(() => ({
  storageMock: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
    setMany: vi.fn().mockResolvedValue(undefined),
    saveFileDialog: vi.fn(),
    writeProjectFile: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  decodeMock: vi.fn(),
}));
vi.mock('./index', () => ({ storage: storageMock }));
vi.mock('@/utils/versionDelta', () => ({
  decodeDeltasToVersions: decodeMock,
}));
vi.mock('@/hooks/useToast', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe('projectsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.get.mockReset();
    storageMock.get.mockResolvedValue([]);
    storageMock.set.mockResolvedValue(undefined);
    storageMock.remove.mockResolvedValue(undefined);
    storageMock.saveFileDialog.mockResolvedValue(null);
    storageMock.writeProjectFile.mockResolvedValue(false);
    decodeMock.mockReset();
    decodeMock.mockImplementation((list: unknown[]) => list as never);
  });

  describe('migrateLocalStorageToProjectFile 版本 delta 解码', () => {
    it('versions 含 delta → decodeDeltasToVersions 解码后传入 writeProjectFile', async () => {
      storageMock.get.mockImplementation(async (key: string, def: unknown) => {
        if (key === 'projects') return [{ id: 'p1', title: 'T' } as Project];
        if (key === 'project_p1_versions') return { c1: [{ delta: 'd1', content: 'old' }] };
        return def;
      });
      decodeMock.mockReturnValue([{ id: 'v1', content: 'decoded' }]);
      storageMock.saveFileDialog.mockResolvedValue('/out.cwp');
      storageMock.writeProjectFile.mockResolvedValue(true);

      const result = await migrateLocalStorageToProjectFile();

      expect(result).toBe('/out.cwp');
      expect(decodeMock).toHaveBeenCalledWith([{ delta: 'd1', content: 'old' }]);
      // 解码后的完整版本数组传入 writeProjectFile 的 versions 参数
      expect(storageMock.writeProjectFile).toHaveBeenCalledWith(
        '/out.cwp',
        expect.objectContaining({ id: 'p1' }),
        [], [], [], [], [], [],
        { c1: [{ id: 'v1', content: 'decoded' }] },
      );
    });

    it('单个 chapter delta 损坏 → toast.warning + 该 chapter 回退为原数组', async () => {
      storageMock.get.mockImplementation(async (key: string, def: unknown) => {
        if (key === 'projects') return [{ id: 'p1', title: 'T' } as Project];
        if (key === 'project_p1_versions') return { c1: [{ delta: 'bad' }] };
        return def;
      });
      decodeMock.mockImplementation(() => {
        throw new Error('decode failed');
      });
      storageMock.saveFileDialog.mockResolvedValue('/out.cwp');
      storageMock.writeProjectFile.mockResolvedValue(true);

      await migrateLocalStorageToProjectFile();

      expect(toast.warning).toHaveBeenCalledWith(
        '章节历史版本加载失败',
        expect.stringContaining('c1'),
      );
      // 损坏 chapter 回退为原始数组（非空数组时保留）
      expect(storageMock.writeProjectFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.any(Array), expect.any(Array), expect.any(Array),
        expect.any(Array), expect.any(Array), expect.any(Array),
        { c1: [{ delta: 'bad' }] },
      );
    });

    it('多个 chapter delta 损坏 → 仅一次 toast.warning（防风暴），文案含所有受影响 chapter', async () => {
      storageMock.get.mockImplementation(async (key: string, def: unknown) => {
        if (key === 'projects') return [{ id: 'p1', title: 'T' } as Project];
        if (key === 'project_p1_versions') return { c1: [{ delta: 'bad' }], c2: [{ delta: 'bad2' }] };
        return def;
      });
      decodeMock.mockImplementation(() => {
        throw new Error('decode failed');
      });
      storageMock.saveFileDialog.mockResolvedValue('/out.cwp');
      storageMock.writeProjectFile.mockResolvedValue(true);

      await migrateLocalStorageToProjectFile();

      // 两个 chapter 损坏仍只弹一次 toast
      expect(toast.warning).toHaveBeenCalledTimes(1);
      const warnCall = vi.mocked(toast.warning).mock.calls[0];
      expect(warnCall[0]).toBe('章节历史版本加载失败');
      expect(warnCall[1]).toContain('c1');
      expect(warnCall[1]).toContain('c2');
    });

    it('versions 为空 {} → 不调用 decodeDeltasToVersions，正常写入空 versions', async () => {
      storageMock.get.mockImplementation(async (key: string, def: unknown) => {
        if (key === 'projects') return [{ id: 'p1', title: 'T' } as Project];
        if (key === 'project_p1_versions') return {};
        return def;
      });
      storageMock.saveFileDialog.mockResolvedValue('/out.cwp');
      storageMock.writeProjectFile.mockResolvedValue(true);

      const result = await migrateLocalStorageToProjectFile();

      expect(result).toBe('/out.cwp');
      expect(decodeMock).not.toHaveBeenCalled();
      expect(storageMock.writeProjectFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.any(Array), expect.any(Array), expect.any(Array),
        expect.any(Array), expect.any(Array), expect.any(Array),
        {},
      );
    });
  });

  describe('runMigration', () => {
    it('版本号已是当前版本 → 返回 false 且不写入', async () => {
      storageMock.get.mockResolvedValueOnce('2.0.0');
      const result = await runMigration();
      expect(result).toBe(false);
      expect(storageMock.set).not.toHaveBeenCalled();
    });

    it('旧版本 → 写入新版本并返回 true', async () => {
      storageMock.get.mockResolvedValueOnce('1.0.0');
      const result = await runMigration();
      expect(result).toBe(true);
      expect(storageMock.set).toHaveBeenCalledWith('app_migration_version', '2.0.0');
    });

    it('无版本号（首次迁移）→ 写入新版本并返回 true', async () => {
      storageMock.get.mockResolvedValueOnce('');
      const result = await runMigration();
      expect(result).toBe(true);
      expect(storageMock.set).toHaveBeenCalledWith('app_migration_version', '2.0.0');
    });
  });

  describe('checkLocalStorageData', () => {
    it('有项目 → true', async () => {
      storageMock.get.mockResolvedValueOnce([{ id: 'p1' }]);
      expect(await checkLocalStorageData()).toBe(true);
    });

    it('无项目 → false', async () => {
      storageMock.get.mockResolvedValueOnce([]);
      expect(await checkLocalStorageData()).toBe(false);
    });
  });
});
