/**
 * electron/handlers/storage.ts IPC handler 注册层单元测试
 *
 * 测试目标：storage:read / storage:write / storage:patchProjects / storage:remove /
 *   storage:listProjectDirs / storage:backupProject / storage:readFileBase64 /
 *   storage:writeFile / storage:writeFileBuffer / dialog:saveFile / dialog:selectFile /
 *   file:openExternal / material:saveAttachment / material:deleteAttachment / file:readDataURL
 *   的 ipcMain.handle 注册层——参数校验、路径安全防线（isInsideDataDir / realpath）、
 *   schema 校验、大小限制、错误归一化。
 *
 * 测试策略（参考 backup.handler.test.ts 的 vi.hoisted + VFS 模式）：
 * - vi.mock('electron')：提供 ipcMain.handle 捕获注册的 listener；app.getPath 返回测试目录；
 *   dialog / shell 可控
 * - vi.mock('../ipcRateLimit')：关闭限流（check 永远返回 null）
 * - vi.mock('node:fs/promises')：控制 readFile/writeFile/rename/unlink/realpath/stat 等
 * - vi.mock('../logger')：捕获 audit/error/warn 调用
 * - 真实触发 isValidStorageKey / isSafeIdentifier / isInsideDataDir / assertRealPathInside
 *   校验（这是安全防线，不能 mock 整个 handler）
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
    realpath: vi.fn(),
  };
  const loggerMock = {
    audit: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    write: vi.fn(),
  };
  const dialogMock = {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  };
  const shellMock = {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  };
  return {
    TEST_USERDATA: _path.join(_os.tmpdir(), 'lingxi-test-userdata-storage-handler'),
    TEST_HOME: _path.join(_os.tmpdir(), 'lingxi-test-home-storage-handler'),
    tmpdir: _os.tmpdir(),
    handlers,
    fsMock,
    loggerMock,
    dialogMock,
    shellMock,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return hoisted.TEST_USERDATA;
      if (name === 'home') return hoisted.TEST_HOME;
      if (name === 'documents') return path.join(hoisted.TEST_HOME, 'Documents');
      if (name === 'desktop') return path.join(hoisted.TEST_HOME, 'Desktop');
      if (name === 'downloads') return path.join(hoisted.TEST_HOME, 'Downloads');
      return hoisted.tmpdir;
    }),
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      hoisted.handlers.set(channel, listener);
    }),
  },
  dialog: hoisted.dialogMock,
  shell: hoisted.shellMock,
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

import { registerStorageHandlers, rememberSelectedFile } from './storage';
import { setMainWindow } from './shared';

// ============ 路径常量 ============
const DATA_DIR = hoisted.TEST_USERDATA;
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const MATERIALS_DIR = path.join(DATA_DIR, 'materials');

// ============ 测试辅助 ============
function makeEvent() {
  return { sender: { id: 1 } };
}

async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = hoisted.handlers.get(channel);
  if (!fn) throw new Error(`handler not registered: ${channel}`);
  return fn(makeEvent(), ...args);
}

function makeMockWindow() {
  return {
    id: 1,
    webContents: { send: vi.fn(), isDestroyed: vi.fn(() => false) },
    isDestroyed: vi.fn(() => false),
  } as unknown as import('electron').BrowserWindow;
}

// ============ 全局 setup ============
beforeAll(() => {
  registerStorageHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  // 默认 fs 行为：文件/目录不存在
  hoisted.fsMock.access.mockRejectedValue(enoent);
  hoisted.fsMock.readFile.mockRejectedValue(enoent);
  hoisted.fsMock.writeFile.mockResolvedValue(undefined);
  hoisted.fsMock.rename.mockResolvedValue(undefined);
  hoisted.fsMock.unlink.mockResolvedValue(undefined);
  hoisted.fsMock.mkdir.mockResolvedValue(undefined);
  hoisted.fsMock.stat.mockResolvedValue({ size: 0, mtimeMs: 0, isDirectory: () => false });
  hoisted.fsMock.readdir.mockResolvedValue([]);
  hoisted.fsMock.copyFile.mockResolvedValue(undefined);
  hoisted.fsMock.rm.mockResolvedValue(undefined);
  hoisted.fsMock.cp.mockResolvedValue(undefined);
  // realpath 默认返回原路径（无 symlink），让 lexical 与 realpath 校验一致
  hoisted.fsMock.realpath.mockImplementation(async (p: string) => p);
  // 重置 main window
  setMainWindow(null);
});

// ============ 测试用例 ============

describe('storage:read handler 注册层', () => {
  it('非法 key 返回 null 并审计', async () => {
    await expect(callHandler('storage:read', '../etc/passwd')).resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.input', 'storage:read rejected: invalid storage key',
      expect.objectContaining({ key: '../etc/passwd' }),
    );
  });

  it('合法 key 读取文件并解析 JSON', async () => {
    hoisted.fsMock.readFile.mockResolvedValue('{"foo":"bar"}');
    const result = await callHandler('storage:read', 'projects');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('文件不存在时返回 null（不审计，仅 warn）', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    hoisted.fsMock.readFile.mockRejectedValue(enoent);
    await expect(callHandler('storage:read', 'projects')).resolves.toBeNull();
    expect(hoisted.loggerMock.warn).toHaveBeenCalledWith(
      'storage:read failed',
      expect.objectContaining({ key: 'projects', error: 'ENOENT' }),
    );
  });

  it('JSON 损坏时返回 null', async () => {
    hoisted.fsMock.readFile.mockResolvedValue('{not valid json');
    await expect(callHandler('storage:read', 'projects')).resolves.toBeNull();
    expect(hoisted.loggerMock.warn).toHaveBeenCalled();
  });
});

describe('storage:write handler 注册层', () => {
  it('非法 key 返回 false 并审计', async () => {
    await expect(callHandler('storage:write', '../etc/passwd', { data: 'evil' })).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.input', 'storage:write rejected: invalid storage key',
      expect.objectContaining({ key: '../etc/passwd' }),
    );
  });

  it('合法 key 原子写入（tmp + rename + unlink 清理）', async () => {
    const result = await callHandler('storage:write', 'projects', [{ id: 'p1' }]);
    expect(result).toBe(true);
    // writeFile 写入 tmp 文件
    expect(hoisted.fsMock.writeFile).toHaveBeenCalledTimes(1);
    const tmpPath = hoisted.fsMock.writeFile.mock.calls[0][0] as string;
    expect(tmpPath).toMatch(/\.json\.[0-9a-f-]+\.tmp$/);
    // rename tmp → target
    expect(hoisted.fsMock.rename).toHaveBeenCalledTimes(1);
    // finally 中 unlink tmp（清理）
    expect(hoisted.fsMock.unlink).toHaveBeenCalledTimes(1);
  });

  it('value 超过 50MB 限制返回 false 并审计', async () => {
    // 构造序列化后超过 50MB 的字符串
    const huge = 'x'.repeat(50 * 1024 * 1024 + 1);
    const result = await callHandler('storage:write', 'projects', huge);
    expect(result).toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.size', 'storage:write rejected: value too large',
      expect.objectContaining({ key: 'projects' }),
    );
    // 不应执行写入
    expect(hoisted.fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('写入异常时返回 false 并 error 日志', async () => {
    hoisted.fsMock.rename.mockRejectedValue(new Error('disk full'));
    const result = await callHandler('storage:write', 'projects', { data: 'ok' });
    expect(result).toBe(false);
    expect(hoisted.loggerMock.error).toHaveBeenCalledWith(
      'storage:write error',
      expect.any(Error),
    );
  });
});

describe('storage:patchProjects handler 注册层', () => {
  it('op 非对象（null）返回 null', async () => {
    await expect(callHandler('storage:patchProjects', null)).resolves.toBeNull();
  });

  it('op 是数组返回 null', async () => {
    await expect(callHandler('storage:patchProjects', [])).resolves.toBeNull();
  });

  it('未知 type 返回 null 并审计', async () => {
    await expect(callHandler('storage:patchProjects', { type: 'bogus' })).resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.schema', 'patchProjects rejected: unknown type',
      expect.objectContaining({ type: 'bogus' }),
    );
  });

  it('add 的 project 缺 id 返回 null 并审计', async () => {
    await expect(callHandler('storage:patchProjects', { type: 'add', project: { name: 'no-id' } }))
      .resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.schema', 'patchProjects rejected: invalid project',
      expect.objectContaining({ type: 'add' }),
    );
  });

  it('add 的 project 含 __proto__ 键返回 null（防原型污染）', async () => {
    // 用 JSON.parse 模拟 IPC 反序列化：对象字面量 { __proto__: ... } 会设置原型而非自身属性，
    // JSON.parse 把 "__proto__" 当作普通字符串键，成为对象自身的可枚举属性
    const maliciousProject = JSON.parse('{"id":"p1","__proto__":{"evil":true}}');
    const result = await callHandler('storage:patchProjects', {
      type: 'add',
      project: maliciousProject,
    });
    expect(result).toBeNull();
  });

  it('add 的 project id 含路径穿越字符返回 null', async () => {
    await expect(callHandler('storage:patchProjects', {
      type: 'add',
      project: { id: '../etc' },
    })).resolves.toBeNull();
  });

  it('remove 的 id 含路径穿越字符返回 null', async () => {
    await expect(callHandler('storage:patchProjects', {
      type: 'remove',
      id: '../etc',
    })).resolves.toBeNull();
  });

  it('clear 成功并返回空数组', async () => {
    // 文件不存在时视为空数组，clear 后仍为空
    const result = await callHandler('storage:patchProjects', { type: 'clear' });
    expect(result).toEqual([]);
  });

  it('add 成功时读取现有数组并追加新项目', async () => {
    hoisted.fsMock.readFile.mockResolvedValue(JSON.stringify([{ id: 'p1', name: 'A' }]));
    const result = await callHandler('storage:patchProjects', {
      type: 'add',
      project: { id: 'p2', name: 'B' },
    });
    expect(result).toEqual([
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ]);
    // 写入 tmp + rename
    expect(hoisted.fsMock.writeFile).toHaveBeenCalledTimes(1);
    expect(hoisted.fsMock.rename).toHaveBeenCalledTimes(1);
  });

  it('update 成功时合并现有项目', async () => {
    hoisted.fsMock.readFile.mockResolvedValue(JSON.stringify([{ id: 'p1', name: 'old', desc: 'keep' }]));
    const result = await callHandler('storage:patchProjects', {
      type: 'update',
      project: { id: 'p1', name: 'new' },
    });
    expect(result).toEqual([{ id: 'p1', name: 'new', desc: 'keep' }]);
  });
});

describe('storage:remove handler 注册层', () => {
  it('非法 key 返回 false 并审计', async () => {
    await expect(callHandler('storage:remove', '../etc/passwd')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.input', 'storage:remove rejected: invalid storage key',
      expect.objectContaining({ key: '../etc/passwd' }),
    );
  });

  it('非 project key 删除文件成功', async () => {
    const result = await callHandler('storage:remove', 'recovery_draft');
    expect(result).toBe(true);
    // unlink 被调用（文件路径为 dataDir/recovery_draft.json）
    expect(hoisted.fsMock.unlink).toHaveBeenCalledWith(
      path.join(DATA_DIR, 'recovery_draft.json'),
    );
  });

  it('project 子键删除对应 json 文件', async () => {
    const result = await callHandler('storage:remove', 'project_p1_chapters');
    expect(result).toBe(true);
    expect(hoisted.fsMock.unlink).toHaveBeenCalledWith(
      path.join(PROJECTS_DIR, 'p1', 'chapters.json'),
    );
  });
});

describe('storage:listProjectDirs handler 注册层', () => {
  it('projects 目录不存在时返回空数组', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    hoisted.fsMock.access.mockRejectedValue(enoent);
    const result = await callHandler('storage:listProjectDirs');
    expect(result).toEqual([]);
  });

  it('返回 projects 目录下的子目录名', async () => {
    hoisted.fsMock.access.mockResolvedValue(undefined);
    hoisted.fsMock.readdir.mockResolvedValue([
      { name: 'proj1', isDirectory: () => true, isFile: () => false },
      { name: 'proj2', isDirectory: () => true, isFile: () => false },
      { name: 'stray.json', isDirectory: () => false, isFile: () => true },
    ]);
    const result = await callHandler('storage:listProjectDirs');
    expect(result).toEqual(['proj1', 'proj2']);
  });

  it('readdir 失败时返回空数组并 warn', async () => {
    hoisted.fsMock.access.mockResolvedValue(undefined);
    hoisted.fsMock.readdir.mockRejectedValue(new Error('EIO'));
    const result = await callHandler('storage:listProjectDirs');
    expect(result).toEqual([]);
    expect(hoisted.loggerMock.warn).toHaveBeenCalledWith(
      'storage:listProjectDirs failed',
      expect.objectContaining({ error: 'EIO' }),
    );
  });
});

describe('storage:backupProject handler 注册层', () => {
  it('非法 projectId 返回 false 并审计', async () => {
    await expect(callHandler('storage:backupProject', '../etc')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'backupProject rejected: invalid projectId',
      expect.objectContaining({ projectId: '../etc' }),
    );
  });

  it('源项目目录不存在时返回 false', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    hoisted.fsMock.access.mockRejectedValue(enoent);
    const result = await callHandler('storage:backupProject', 'p1');
    expect(result).toBe(false);
  });

  it('合法 projectId 且源目录存在时备份成功', async () => {
    hoisted.fsMock.access.mockResolvedValue(undefined);
    // copyDir 内 readdir 返回空（无文件）
    hoisted.fsMock.readdir.mockResolvedValue([]);
    const result = await callHandler('storage:backupProject', 'p1', 5);
    expect(result).toBe(true);
    // 创建了备份目录
    expect(hoisted.fsMock.mkdir).toHaveBeenCalled();
  });
});

describe('storage:readFileBase64 handler 注册层', () => {
  it('路径在 materials 目录外返回 null 并审计', async () => {
    const evilPath = path.join(DATA_DIR, 'aiSettings.json');
    await expect(callHandler('storage:readFileBase64', evilPath)).resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'readFileBase64 rejected: path outside materials dir',
      expect.objectContaining({ filePath: evilPath }),
    );
  });

  it('realpath 解析到 materials 目录外返回 null（防 symlink）', async () => {
    const filePath = path.join(MATERIALS_DIR, 'evil.pdf');
    // realpath 返回 materials 目录外的路径（模拟 symlink 指向敏感文件）
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
      if (p === filePath) return '/etc/passwd';
      return p;
    });
    await expect(callHandler('storage:readFileBase64', filePath)).resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'readFileBase64 rejected: realpath outside materials dir (symlink?)',
      expect.objectContaining({ filePath }),
    );
  });

  it('合法路径返回 base64 编码内容', async () => {
    const filePath = path.join(MATERIALS_DIR, 'p1', 'image.png');
    hoisted.fsMock.readFile.mockResolvedValue(Buffer.from('binary-data'));
    const result = await callHandler('storage:readFileBase64', filePath);
    expect(result).toBe(Buffer.from('binary-data').toString('base64'));
  });
});

describe('storage:writeFile handler 注册层', () => {
  it('路径在 data dir 外返回 false 并审计', async () => {
    await expect(callHandler('storage:writeFile', '/etc/passwd', 'evil')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'writeFile rejected: path outside data dir',
      expect.objectContaining({ filePath: '/etc/passwd' }),
    );
  });

  it('realpath 解析到 data dir 外返回 false（防 symlink）', async () => {
    const filePath = path.join(DATA_DIR, 'evil.txt');
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
      if (p === filePath) return '/etc/passwd';
      return p;
    });
    await expect(callHandler('storage:writeFile', filePath, 'evil')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'writeFile rejected: realpath outside data dir (symlink?)',
      expect.objectContaining({ filePath }),
    );
  });

  it('合法路径写入成功返回 true', async () => {
    const filePath = path.join(DATA_DIR, 'export.txt');
    const result = await callHandler('storage:writeFile', filePath, 'content', 'utf-8');
    expect(result).toBe(true);
    expect(hoisted.fsMock.writeFile).toHaveBeenCalledWith(
      filePath,
      'content',
      { encoding: 'utf-8' },
    );
  });

  it('encoding 为空时回退为 utf-8', async () => {
    const filePath = path.join(DATA_DIR, 'export.txt');
    await callHandler('storage:writeFile', filePath, 'content');
    expect(hoisted.fsMock.writeFile).toHaveBeenCalledWith(
      filePath,
      'content',
      { encoding: 'utf-8' },
    );
  });
});

describe('storage:writeFileBuffer handler 注册层', () => {
  it('路径在 data dir 外返回 false 并审计', async () => {
    await expect(callHandler('storage:writeFileBuffer', '/etc/passwd', 'dGVzdA==')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'writeFileBuffer rejected: path outside data dir',
      expect.objectContaining({ filePath: '/etc/passwd' }),
    );
  });

  it('合法路径写入 base64 解码后的 buffer', async () => {
    const filePath = path.join(DATA_DIR, 'image.png');
    const result = await callHandler('storage:writeFileBuffer', filePath, 'dGVzdA==');
    expect(result).toBe(true);
    // Buffer.from('dGVzdA==', 'base64') 解码为 'test'
    expect(hoisted.fsMock.writeFile).toHaveBeenCalledTimes(1);
    const writtenBuffer = hoisted.fsMock.writeFile.mock.calls[0][1] as Buffer;
    expect(writtenBuffer.toString('utf-8')).toBe('test');
  });
});

describe('dialog:saveFile handler 注册层', () => {
  it('无主窗口时返回 null', async () => {
    setMainWindow(null);
    const result = await callHandler('dialog:saveFile', 'novel.pdf', 'data', 'pdf');
    expect(result).toBeNull();
  });

  it('filterExt 不在白名单返回 null 并审计', async () => {
    setMainWindow(makeMockWindow());
    await expect(callHandler('dialog:saveFile', 'novel.exe', 'data', 'exe')).resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'dialog:saveFile rejected: filterExt not in whitelist',
      expect.objectContaining({ filterExt: 'exe' }),
    );
  });

  it('filterExt 带点号也能通过（归一化）', async () => {
    setMainWindow(makeMockWindow());
    hoisted.dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/export.pdf',
    });
    const result = await callHandler('dialog:saveFile', 'novel', 'data', '.pdf');
    expect(result).toBe('/tmp/export.pdf');
  });

  it('用户取消时返回 null', async () => {
    setMainWindow(makeMockWindow());
    hoisted.dialogMock.showSaveDialog.mockResolvedValue({
      canceled: true,
      filePath: '',
    });
    const result = await callHandler('dialog:saveFile', 'novel.pdf', 'data', 'pdf');
    expect(result).toBeNull();
  });

  it('defaultName 含路径穿越字符时用 basename 剥离目录', async () => {
    setMainWindow(makeMockWindow());
    hoisted.dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/novel.pdf',
    });
    await callHandler('dialog:saveFile', '../../etc/passwd.pdf', 'data', 'pdf');
    // showSaveDialog 的 defaultPath 应为 basename 后的 'passwd.pdf'
    expect(hoisted.dialogMock.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: 'passwd.pdf' }),
    );
  });
});

describe('file:openExternal handler 注册层', () => {
  it('非绝对路径返回 false 并审计', async () => {
    await expect(callHandler('file:openExternal', 'relative.pdf')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'openExternal rejected: path must be absolute',
      expect.objectContaining({ filePath: 'relative.pdf' }),
    );
  });

  it('路径在 data dir 外且非最近选择返回 false 并审计', async () => {
    await expect(callHandler('file:openExternal', '/etc/safe.pdf')).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'openExternal rejected: outside data dir and not recently selected',
      expect.objectContaining({ filePath: '/etc/safe.pdf' }),
    );
  });

  it('禁止的可执行后缀返回 false 并审计', async () => {
    const filePath = path.join(DATA_DIR, 'evil.exe');
    await expect(callHandler('file:openExternal', filePath)).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'openExternal rejected: forbidden extension',
      expect.objectContaining({ ext: 'exe', filePath }),
    );
  });

  it('后缀不在白名单返回 false 并审计', async () => {
    const filePath = path.join(DATA_DIR, 'evil.unknownext');
    await expect(callHandler('file:openExternal', filePath)).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'openExternal rejected: extension not in allowlist',
      expect.objectContaining({ ext: 'unknownext', filePath }),
    );
  });

  it('合法路径与后缀时调用 shell.openPath 并返回 true', async () => {
    const filePath = path.join(DATA_DIR, 'doc.pdf');
    hoisted.shellMock.openPath.mockResolvedValue(undefined);
    const result = await callHandler('file:openExternal', filePath);
    expect(result).toBe(true);
    expect(hoisted.shellMock.openPath).toHaveBeenCalledWith(filePath);
  });

  it('realpath 解析到 data dir 外返回 false（防 symlink）', async () => {
    const filePath = path.join(DATA_DIR, 'link.pdf');
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
      if (p === filePath) return '/etc/secret.pdf';
      return p;
    });
    await expect(callHandler('file:openExternal', filePath)).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'openExternal rejected: realpath outside allowed dirs (symlink?)',
      expect.objectContaining({ filePath }),
    );
  });
});

describe('material:saveAttachment handler 注册层', () => {
  it('projectId 非法返回 null 并审计', async () => {
    await expect(callHandler('material:saveAttachment', '/tmp/file.txt', '../etc', 'att1'))
      .resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'saveAttachment rejected: invalid projectId or attachmentId',
      expect.objectContaining({ projectId: '../etc', attachmentId: 'att1' }),
    );
  });

  it('sourcePath 不在最近选择白名单返回 null 并审计', async () => {
    await expect(callHandler('material:saveAttachment', '/tmp/secret.txt', 'p1', 'att1'))
      .resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'saveAttachment rejected: sourcePath not in recent selection whitelist',
      expect.objectContaining({ sourcePath: '/tmp/secret.txt' }),
    );
  });

  it('合法 sourcePath 复制到 materials 目录并返回 destPath', async () => {
    const sourcePath = '/tmp/user-selected-file.pdf';
    // 加入最近选择白名单
    rememberSelectedFile(sourcePath);
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => p);
    hoisted.fsMock.copyFile.mockResolvedValue(undefined);

    const result = await callHandler('material:saveAttachment', sourcePath, 'p1', 'att1');
    expect(result).toBe(path.join(MATERIALS_DIR, 'p1', 'att1.pdf'));
    expect(hoisted.fsMock.copyFile).toHaveBeenCalledWith(sourcePath, path.join(MATERIALS_DIR, 'p1', 'att1.pdf'));
  });

  it('sourcePath 的 realpath 与原路径不同且不在白名单返回 null（防 symlink）', async () => {
    const sourcePath = '/tmp/link.pdf';
    rememberSelectedFile(sourcePath);
    // realpath 返回不同路径（模拟 symlink 指向敏感文件）
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
      if (p === sourcePath) return '/etc/passwd';
      return p;
    });
    await expect(callHandler('material:saveAttachment', sourcePath, 'p1', 'att1'))
      .resolves.toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'saveAttachment rejected: realpath of source not in recent selection',
      expect.objectContaining({ sourcePath, realSource: '/etc/passwd' }),
    );
  });
});

describe('material:deleteAttachment handler 注册层', () => {
  it('realpath 失败（文件不存在）返回 false', async () => {
    hoisted.fsMock.realpath.mockRejectedValue(new Error('ENOENT'));
    const result = await callHandler('material:deleteAttachment', path.join(MATERIALS_DIR, 'p1', 'missing.png'));
    expect(result).toBe(false);
  });

  it('路径在 materials 目录外返回 false 并审计', async () => {
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => p);
    const evilPath = '/etc/passwd';
    await expect(callHandler('material:deleteAttachment', evilPath)).resolves.toBe(false);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'deleteAttachment rejected: targetPath escapes materials dir',
      expect.objectContaining({ targetPath: evilPath }),
    );
  });

  it('合法路径删除成功返回 true', async () => {
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => p);
    const targetPath = path.join(MATERIALS_DIR, 'p1', 'image.png');
    hoisted.fsMock.unlink.mockResolvedValue(undefined);
    const result = await callHandler('material:deleteAttachment', targetPath);
    expect(result).toBe(true);
    expect(hoisted.fsMock.unlink).toHaveBeenCalledWith(targetPath);
  });
});

describe('file:readDataURL handler 注册层', () => {
  it('filePath 非字符串时 reject', async () => {
    // safeIpcHandle 包装层将原始错误统一替换为通用文案，防止主进程路径/堆栈泄漏到渲染层
    await expect(callHandler('file:readDataURL', null)).rejects.toThrow(/操作失败，请重试/);
    await expect(callHandler('file:readDataURL', 123)).rejects.toThrow(/操作失败，请重试/);
  });

  it('路径在 data dir 外时 reject', async () => {
    await expect(callHandler('file:readDataURL', '/etc/passwd')).rejects.toThrow(/操作失败，请重试/);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'readDataURL rejected: path outside data dir',
      expect.objectContaining({ filePath: '/etc/passwd' }),
    );
  });

  it('文件超过 10MB 返回 null 并审计', async () => {
    const filePath = path.join(DATA_DIR, 'large.png');
    hoisted.fsMock.stat.mockResolvedValue({ size: 11 * 1024 * 1024, isDirectory: () => false });
    const result = await callHandler('file:readDataURL', filePath);
    expect(result).toBeNull();
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.size', 'readDataURL rejected: file too large',
      expect.objectContaining({ size: 11 * 1024 * 1024 }),
    );
  });

  it('realpath 解析到 data dir 外时 reject（防 symlink）', async () => {
    const filePath = path.join(DATA_DIR, 'link.png');
    hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
      if (p === filePath) return '/etc/secret.png';
      return p;
    });
    await expect(callHandler('file:readDataURL', filePath)).rejects.toThrow(/操作失败，请重试/);
    expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
      'security.path', 'readDataURL rejected: realpath outside data dir (symlink?)',
      expect.objectContaining({ filePath }),
    );
  });

  it('合法图片返回 data URL', async () => {
    const filePath = path.join(DATA_DIR, 'image.png');
    hoisted.fsMock.stat.mockResolvedValue({ size: 100, isDirectory: () => false });
    hoisted.fsMock.readFile.mockResolvedValue(Buffer.from('png-bytes'));
    const result = await callHandler('file:readDataURL', filePath);
    expect(result).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
  });

  it('未知扩展名使用 application/octet-stream MIME', async () => {
    const filePath = path.join(DATA_DIR, 'data.unknownext');
    hoisted.fsMock.stat.mockResolvedValue({ size: 100, isDirectory: () => false });
    hoisted.fsMock.readFile.mockResolvedValue(Buffer.from('bytes'));
    const result = await callHandler('file:readDataURL', filePath);
    expect(result).toMatch(/^data:application\/octet-stream;base64,/);
  });
});

describe('dialog:selectFile handler 注册层', () => {
  it('无主窗口时返回 null', async () => {
    setMainWindow(null);
    const result = await callHandler('dialog:selectFile');
    expect(result).toBeNull();
  });

  it('用户取消时返回 null', async () => {
    setMainWindow(makeMockWindow());
    hoisted.dialogMock.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    const result = await callHandler('dialog:selectFile');
    expect(result).toBeNull();
  });

  it('选择文件后返回路径/名称/大小/扩展名', async () => {
    setMainWindow(makeMockWindow());
    const selectedPath = '/tmp/test-doc.pdf';
    hoisted.dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [selectedPath],
    });
    hoisted.fsMock.stat.mockResolvedValue({ size: 4096, isDirectory: () => false });
    const result = await callHandler('dialog:selectFile') as {
      path: string; name: string; size: number; ext: string;
    };
    expect(result.path).toBe(selectedPath);
    expect(result.name).toBe('test-doc.pdf');
    expect(result.size).toBe(4096);
    expect(result.ext).toBe('pdf');
  });
});
