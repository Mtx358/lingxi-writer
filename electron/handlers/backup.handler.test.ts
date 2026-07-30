/**
 * electron/handlers/backup.ts IPC handler 注册层单元测试
 *
 * 测试目标：system:checkCrashRecovery handler 的 ipcMain.handle 注册层——
 *   崩溃恢复扫描、tmp 文件恢复、损坏 tmp 删除、stale tmp 清理、错误兜底。
 *
 * 注：backup.ts 实际仅注册 system:checkCrashRecovery 一个 IPC channel（任务描述中
 *   的 backup:list/create/restore/delete 在本仓库不存在，分别在 projectFile/storage
 *   handler 中实现）。checkCrashRecovery 逻辑未抽离到 .logic.ts，故通过 handler 注册层
 *   直接覆盖其行为（路径越界/恢复/清理/错误兜底）。
 *
 * 测试策略：
 * - vi.mock('electron')：提供 ipcMain.handle 捕获 listener；app.getPath 返回测试目录
 * - vi.mock('../ipcRateLimit')：关闭限流
 * - vi.mock('node:fs/promises')：用虚拟文件系统（vfs Map）控制 readdir/stat/readFile 等
 * - vi.mock('../logger')：捕获 audit/error/warn 调用
 * - 真实触发 checkCrashRecovery / cleanupStaleTmpFiles / scanTmpFilesRecursive 逻辑
 *
 * 不修改业务代码，仅新建测试文件。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';

const hoisted = vi.hoisted(() => {
  const _path = require('node:path');
  const _os = require('node:os');
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const fsMock = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
    copyFile: vi.fn(),
    rm: vi.fn(),
    cp: vi.fn(),
  };
  const loggerMock = {
    audit: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    write: vi.fn(),
  };
  return {
    TEST_USERDATA: _path.join(_os.tmpdir(), 'lingxi-test-userdata-backup-handler'),
    tmpdir: _os.tmpdir(),
    handlers,
    fsMock,
    loggerMock,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return hoisted.TEST_USERDATA;
      if (name === 'home') return path.join(hoisted.tmpdir, 'lingxi-test-home-backup-handler');
      return hoisted.tmpdir;
    }),
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      hoisted.handlers.set(channel, listener);
    }),
  },
}));

vi.mock('../logger', () => ({ logger: hoisted.loggerMock }));
vi.mock('../ipcRateLimit', () => ({
  ipcRateLimiter: { check: vi.fn(() => null) },
  RateLimitError: class RateLimitError extends Error {
    constructor(
      public readonly channel: string,
      public readonly senderId: number,
      message: string,
    ) {
      super(message);
      this.name = 'RateLimitError';
    }
  },
}));
vi.mock('node:fs/promises', () => ({ default: hoisted.fsMock, ...hoisted.fsMock }));

import { registerBackupHandlers } from './backup';

// ============ 虚拟文件系统 ============
interface VfsEntry {
  content: string;
  mtimeMs: number;
}
interface VfsDir {
  files: Map<string, VfsEntry>;
  // 子目录名集合（用于 readdir 列目录条目）
  subdirs: Set<string>;
}

const vfs = new Map<string, VfsDir>();

function dirOf(p: string): VfsDir {
  let d = vfs.get(p);
  if (!d) {
    d = { files: new Map(), subdirs: new Set() };
    vfs.set(p, d);
  }
  return d;
}

function addFile(p: string, content: string, mtimeMs: number = Date.now()) {
  const parent = path.dirname(p);
  const base = path.basename(p);
  dirOf(parent).files.set(base, { content, mtimeMs });
}

function addDir(p: string) {
  const parent = path.dirname(p);
  const base = path.basename(p);
  dirOf(parent).subdirs.add(base);
  // 确保子目录条目存在
  dirOf(p);
}

function resetVfs() {
  vfs.clear();
}

// 构造 Dirent-like 对象
function makeDirent(name: string, kind: 'file' | 'dir') {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  };
}

// ============ 路径常量 ============
const DATA_DIR = hoisted.TEST_USERDATA;
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// ============ 测试辅助 ============
function makeEvent() {
  return { sender: { id: 1 } };
}

async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = hoisted.handlers.get(channel);
  if (!fn) throw new Error(`handler not registered: ${channel}`);
  return fn(makeEvent(), ...args);
}

// ============ 全局 setup ============
beforeAll(() => {
  registerBackupHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetVfs();
  // 默认 fs 行为基于 vfs
  hoisted.fsMock.access.mockImplementation(async (p: string) => {
    // 目录或文件存在即 resolve
    const parent = path.dirname(p);
    const base = path.basename(p);
    const parentDir = vfs.get(parent);
    if (parentDir && (parentDir.files.has(base) || parentDir.subdirs.has(base))) return;
    if (vfs.has(p)) return; // p 本身是已注册目录
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  hoisted.fsMock.readdir.mockImplementation(async (p: string) => {
    const d = vfs.get(p);
    if (!d) return [];
    const entries: ReturnType<typeof makeDirent>[] = [];
    for (const base of d.subdirs) entries.push(makeDirent(base, 'dir'));
    for (const base of d.files.keys()) entries.push(makeDirent(base, 'file'));
    return entries;
  });
  hoisted.fsMock.stat.mockImplementation(async (p: string) => {
    const parent = path.dirname(p);
    const base = path.basename(p);
    const parentDir = vfs.get(parent);
    if (parentDir) {
      const f = parentDir.files.get(base);
      if (f) return { size: f.content.length, mtimeMs: f.mtimeMs, isDirectory: () => false };
      if (parentDir.subdirs.has(base)) return { size: 0, mtimeMs: 0, isDirectory: () => true };
    }
    if (vfs.has(p)) return { size: 0, mtimeMs: 0, isDirectory: () => true };
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  hoisted.fsMock.readFile.mockImplementation(async (p: string) => {
    const parent = path.dirname(p);
    const base = path.basename(p);
    const parentDir = vfs.get(parent);
    const f = parentDir?.files.get(base);
    if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return f.content;
  });
  hoisted.fsMock.copyFile.mockImplementation(async (src: string, dst: string) => {
    const srcParent = path.dirname(src);
    const srcBase = path.basename(src);
    const f = vfs.get(srcParent)?.files.get(srcBase);
    if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    addFile(dst, f.content, Date.now());
  });
  hoisted.fsMock.unlink.mockImplementation(async (p: string) => {
    const parent = path.dirname(p);
    const base = path.basename(p);
    vfs.get(parent)?.files.delete(base);
  });
  hoisted.fsMock.mkdir.mockResolvedValue(undefined);
  hoisted.fsMock.writeFile.mockImplementation(async (p: string, content: string) => {
    addFile(p, typeof content === 'string' ? content : String(content), Date.now());
  });
  hoisted.fsMock.rm.mockResolvedValue(undefined);
  hoisted.fsMock.rename.mockResolvedValue(undefined);
  hoisted.fsMock.cp.mockResolvedValue(undefined);
});

// ============ 测试用例 ============

describe('system:checkCrashRecovery handler 注册层', () => {
  it('handler 已注册到 ipcMain.handle', () => {
    expect(hoisted.handlers.has('system:checkCrashRecovery')).toBe(true);
  });

  it('projectsDir 不存在时返回 {recovered:false, projects:[]}', async () => {
    // vfs 为空，projectsDir 不存在
    const result = await callHandler('system:checkCrashRecovery');
    expect(result).toEqual({ recovered: false, projects: [] });
  });

  it('projectsDir 存在但无子目录时返回 {recovered:false, projects:[]}', async () => {
    addDir(PROJECTS_DIR);
    const result = await callHandler('system:checkCrashRecovery');
    expect(result).toEqual({ recovered: false, projects: [] });
  });

  it('project 目录有 tmp（mtime 新）且 main 不存在时恢复并返回项目 id', async () => {
    const projectDir = path.join(PROJECTS_DIR, 'proj1');
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    addDir(projectDir);
    const tmpPath = path.join(projectDir, 'main.json.tmp');
    const mainPath = path.join(projectDir, 'main.json');
    addFile(tmpPath, '{"valid":"json"}', Date.now());

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: true, projects: ['proj1'] });
    // tmp 内容被 copyFile 到 main.json
    expect(hoisted.fsMock.copyFile).toHaveBeenCalledWith(tmpPath, mainPath);
  });

  it('project 目录有 tmp（mtime 新）且 main 旧时恢复', async () => {
    const projectDir = path.join(PROJECTS_DIR, 'proj1');
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    addDir(projectDir);
    addFile(path.join(projectDir, 'main.json'), '{"old":true}', 1000);
    addFile(path.join(projectDir, 'main.json.tmp'), '{"new":true}', 2000);

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: true, projects: ['proj1'] });
  });

  it('project 目录有 tmp 但 mtime 旧于 main 时不恢复', async () => {
    const projectDir = path.join(PROJECTS_DIR, 'proj1');
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    addDir(projectDir);
    addFile(path.join(projectDir, 'main.json'), '{"newer":true}', 2000);
    addFile(path.join(projectDir, 'main.json.tmp'), '{"older":true}', 1000);

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: false, projects: [] });
    // 不应 copyFile
    expect(hoisted.fsMock.copyFile).not.toHaveBeenCalled();
  });

  it('project 目录有 tmp 但 JSON 损坏时删除 tmp 且不恢复', async () => {
    const projectDir = path.join(PROJECTS_DIR, 'proj1');
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    addDir(projectDir);
    const tmpPath = path.join(projectDir, 'main.json.tmp');
    addFile(tmpPath, '{not valid json', Date.now());

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: false, projects: [] });
    // 损坏 tmp 应被删除
    expect(hoisted.fsMock.unlink).toHaveBeenCalledWith(tmpPath);
    expect(hoisted.loggerMock.warn).toHaveBeenCalledWith(
      'Crash recovery: tmp file corrupted, deleting instead of recovering',
      expect.objectContaining({ tmpFile: tmpPath, error: expect.any(String) }),
    );
  });

  it('project 目录有 main 无 tmp 时不恢复', async () => {
    const projectDir = path.join(PROJECTS_DIR, 'proj1');
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    addDir(projectDir);
    addFile(path.join(projectDir, 'main.json'), '{"ok":true}', Date.now());

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: false, projects: [] });
    expect(hoisted.fsMock.copyFile).not.toHaveBeenCalled();
  });

  it('多个 project 目录中仅部分需要恢复', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    // proj1: 有可恢复 tmp
    const proj1Dir = path.join(PROJECTS_DIR, 'proj1');
    addDir(proj1Dir);
    addFile(path.join(proj1Dir, 'main.json.tmp'), '{"a":1}', Date.now());
    // proj2: 无 tmp，仅 main
    const proj2Dir = path.join(PROJECTS_DIR, 'proj2');
    addDir(proj2Dir);
    addFile(path.join(proj2Dir, 'main.json'), '{"b":2}', Date.now());

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: true, projects: ['proj1'] });
  });

  it('非目录条目（如残留文件）被跳过', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    // 在 projectsDir 下放一个普通文件（非目录），应被跳过
    addFile(path.join(PROJECTS_DIR, 'stray-file.json'), '{}', Date.now());

    const result = await callHandler('system:checkCrashRecovery') as { recovered: boolean; projects: string[] };

    expect(result).toEqual({ recovered: false, projects: [] });
    // 不应对该文件调用 stat
    expect(hoisted.fsMock.stat).not.toHaveBeenCalledWith(path.join(PROJECTS_DIR, 'stray-file.json', 'main.json'));
  });

  it('清理超过 1 小时的 stale tmp 文件（位于 dataDir 根）', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    const staleTmpPath = path.join(DATA_DIR, 'old-backup.json.tmp');
    // mtime 设为 2 小时前（超过 1 小时阈值）
    addFile(staleTmpPath, '{"stale":true}', Date.now() - 2 * 60 * 60 * 1000);

    await callHandler('system:checkCrashRecovery');

    // stale tmp 应被 unlink
    expect(hoisted.fsMock.unlink).toHaveBeenCalledWith(staleTmpPath);
  });

  it('保留 1 小时内的 tmp 文件（可能正在写入）', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    const freshTmpPath = path.join(DATA_DIR, 'fresh.json.tmp');
    // mtime 设为 5 分钟前（1 小时内）
    addFile(freshTmpPath, '{"fresh":true}', Date.now() - 5 * 60 * 1000);

    await callHandler('system:checkCrashRecovery');

    // fresh tmp 不应被 unlink
    expect(hoisted.fsMock.unlink).not.toHaveBeenCalledWith(freshTmpPath);
  });

  it('scanTmpFilesRecursive 递归清理子目录中的 stale tmp', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    // 在 dataDir/logsub/ 下放 stale tmp
    addDir(path.join(DATA_DIR, 'logsub'));
    const nestedTmp = path.join(DATA_DIR, 'logsub', 'nested.tmp');
    addFile(nestedTmp, '{}', Date.now() - 3 * 60 * 60 * 1000);

    await callHandler('system:checkCrashRecovery');

    expect(hoisted.fsMock.unlink).toHaveBeenCalledWith(nestedTmp);
  });

  it('非 .tmp 后缀文件不被清理', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    const jsonPath = path.join(DATA_DIR, 'projects.json');
    addFile(jsonPath, '{"projects":[]}', Date.now() - 5 * 60 * 60 * 1000);

    await callHandler('system:checkCrashRecovery');

    expect(hoisted.fsMock.unlink).not.toHaveBeenCalledWith(jsonPath);
  });

  it('checkCrashRecovery 抛错时 handler 捕获并返回 {recovered:false, projects:[]}', async () => {
    // 让 readdir 抛错（非 ENOENT 的异常）
    hoisted.fsMock.access.mockResolvedValue(undefined); // projectsDir "存在"
    hoisted.fsMock.readdir.mockRejectedValueOnce(new Error('EIO'));

    const result = await callHandler('system:checkCrashRecovery');

    expect(result).toEqual({ recovered: false, projects: [] });
    expect(hoisted.loggerMock.error).toHaveBeenCalledWith(
      'checkCrashRecovery error',
      expect.objectContaining({ message: 'EIO' }),
    );
  });

  it('readdir 失败的子目录被跳过不阻断整体扫描', async () => {
    addDir(DATA_DIR);
    addDir(PROJECTS_DIR);
    // 让对 dataDir 的 readdir 抛错（cleanupStaleTmpFiles 扫描 dataDir 时），
    // 但 projectsDir 的 readdir 正常
    const dataDirRead = vi.fn(async () => { throw new Error('EIO'); });
    const defaultReaddir = hoisted.fsMock.readdir.getMockImplementation();
    hoisted.fsMock.readdir.mockImplementation(async (p: string) => {
      if (p === DATA_DIR) return dataDirRead();
      return defaultReaddir ? defaultReaddir(p) : [];
    });

    // 不应抛错（cleanupStaleTmpFiles 内部 catch）
    const result = await callHandler('system:checkCrashRecovery');
    expect(result).toEqual({ recovered: false, projects: [] });
  });
});
