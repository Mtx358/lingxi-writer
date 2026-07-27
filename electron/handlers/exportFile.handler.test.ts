/**
 * electron/handlers/exportFile.ts IPC handler 注册层单元测试
 *
 * 测试目标：export:writeFile / export:writeFileBuffer 的 ipcMain.handle 注册层——
 *   路径白名单校验（isSafeExportFilePath + getAllowedProjectFileRoots）、
 *   realpath 校验（防 symlink 绕过）、编码归一化、base64 解码、错误归一化。
 *
 * 测试策略（参考 storage.handler.test.ts 的 vi.hoisted + mock 模式）：
 * - vi.mock('electron')：提供 ipcMain.handle 捕获注册的 listener；app.getPath 返回测试目录
 * - vi.mock('../ipcRateLimit')：关闭限流（check 永远返回 null）
 * - vi.mock('node:fs/promises')：控制 writeFile / realpath（assertRealPathInside 依赖）
 * - vi.mock('../logger')：捕获 audit/error 调用
 * - 不 mock ./exportFile.logic：buildExportWriteOptions / decodeBase64ToBuffer 是纯函数，
 *   已在 exportFile.logic.test.ts 充分覆盖，此处让其真实运行验证 handler 胶水层正确调用
 * - 真实触发 isSafeExportFilePath / assertRealPathInside 校验（安全防线不能 mock）
 *
 * 不修改业务代码，仅新建测试文件。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';

const hoisted = vi.hoisted(() => {
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
  return {
    TEST_USERDATA: '/tmp/lingxi-test-userdata-exportFile-handler',
    TEST_HOME: '/tmp/lingxi-test-home-exportFile-handler',
    handlers,
    fsMock,
    loggerMock,
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
      return '/tmp';
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

import { registerExportFileHandlers } from './exportFile';

// ============ 路径常量 ============
const TEST_HOME = hoisted.TEST_HOME;
const TEST_USERDATA = hoisted.TEST_USERDATA;

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
  registerExportFileHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  // 默认 fs 行为
  hoisted.fsMock.writeFile.mockResolvedValue(undefined);
  // realpath 默认返回原路径（无 symlink），让 lexical 与 realpath 校验一致
  hoisted.fsMock.realpath.mockImplementation(async (p: string) => p);
});

// ============ 测试用例 ============

describe('export:writeFile handler 注册层', () => {
  describe('路径校验（安全防线）', () => {
    it('相对路径返回 false 并审计', async () => {
      await expect(callHandler('export:writeFile', 'relative.pdf', 'data')).resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.path', 'export:writeFile rejected: invalid path',
        expect.objectContaining({ filePath: 'relative.pdf' }),
      );
    });

    it('扩展名不在白名单返回 false（防 .exe/.bat 等可执行文件）', async () => {
      const filePath = path.join(TEST_HOME, 'evil.exe');
      await expect(callHandler('export:writeFile', filePath, 'evil')).resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.path', 'export:writeFile rejected: invalid path',
        expect.objectContaining({ filePath }),
      );
      // 不应执行写入
      expect(hoisted.fsMock.writeFile).not.toHaveBeenCalled();
    });

    it('路径在白名单根目录外返回 false 并审计', async () => {
      const filePath = '/etc/novel.pdf';
      await expect(callHandler('export:writeFile', filePath, 'data')).resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.path', 'export:writeFile rejected: invalid path',
        expect.objectContaining({ filePath }),
      );
    });

    it('realpath 解析到白名单外返回 false（防 symlink 绕过）', async () => {
      const filePath = path.join(TEST_HOME, 'link.pdf');
      // realpath 返回白名单外的路径（模拟 symlink 指向 /etc 文件）
      hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
        if (p === filePath) return '/etc/secret.pdf';
        return p;
      });
      await expect(callHandler('export:writeFile', filePath, 'data')).resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.path', 'export:writeFile rejected: realpath outside allowed roots (symlink?)',
        expect.objectContaining({ filePath }),
      );
      expect(hoisted.fsMock.writeFile).not.toHaveBeenCalled();
    });

    it('含 null 字节的路径返回 false', async () => {
      const filePath = `${path.join(TEST_HOME, 'novel.pdf')}\0`;
      await expect(callHandler('export:writeFile', filePath, 'data')).resolves.toBe(false);
    });
  });

  describe('成功路径', () => {
    it('合法路径写入成功返回 true', async () => {
      const filePath = path.join(TEST_HOME, 'novel.pdf');
      const result = await callHandler('export:writeFile', filePath, 'content', 'utf-8');
      expect(result).toBe(true);
      expect(hoisted.fsMock.writeFile).toHaveBeenCalledWith(
        filePath,
        'content',
        { encoding: 'utf-8' },
      );
    });

    it('encoding 为 undefined 时回退为 utf-8', async () => {
      const filePath = path.join(TEST_HOME, 'novel.txt');
      const result = await callHandler('export:writeFile', filePath, 'content');
      expect(result).toBe(true);
      expect(hoisted.fsMock.writeFile).toHaveBeenCalledWith(
        filePath,
        'content',
        { encoding: 'utf-8' },
      );
    });

    it('Documents/Desktop/Downloads/userData 目录内均允许写入', async () => {
      for (const dir of [
        path.join(TEST_HOME, 'Documents'),
        path.join(TEST_HOME, 'Desktop'),
        path.join(TEST_HOME, 'Downloads'),
        TEST_USERDATA,
      ]) {
        const filePath = path.join(dir, 'novel.docx');
        hoisted.fsMock.writeFile.mockClear();
        const result = await callHandler('export:writeFile', filePath, 'content');
        expect(result).toBe(true);
        expect(hoisted.fsMock.writeFile).toHaveBeenCalledTimes(1);
      }
    });

    it('所有白名单扩展名均允许（txt/md/markdown/html/htm/docx/pdf/epub）', async () => {
      for (const ext of ['txt', 'md', 'markdown', 'html', 'htm', 'docx', 'pdf', 'epub']) {
        const filePath = path.join(TEST_HOME, `novel.${ext}`);
        hoisted.fsMock.writeFile.mockClear();
        const result = await callHandler('export:writeFile', filePath, 'content');
        expect(result).toBe(true);
      }
    });
  });

  describe('错误处理', () => {
    it('fs.writeFile 抛错时返回 false 并 error 日志', async () => {
      const filePath = path.join(TEST_HOME, 'novel.pdf');
      hoisted.fsMock.writeFile.mockRejectedValue(new Error('disk full'));
      const result = await callHandler('export:writeFile', filePath, 'content');
      expect(result).toBe(false);
      expect(hoisted.loggerMock.error).toHaveBeenCalledWith(
        'export:writeFile failed',
        expect.objectContaining({ error: 'disk full' }),
      );
    });
  });
});

describe('export:writeFileBuffer handler 注册层', () => {
  describe('路径校验', () => {
    it('路径在白名单外返回 false 并审计', async () => {
      await expect(callHandler('export:writeFileBuffer', '/etc/evil.pdf', 'dGVzdA=='))
        .resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.path', 'export:writeFileBuffer rejected: invalid path',
        expect.objectContaining({ filePath: '/etc/evil.pdf' }),
      );
    });

    it('扩展名不在白名单返回 false', async () => {
      const filePath = path.join(TEST_HOME, 'evil.exe');
      await expect(callHandler('export:writeFileBuffer', filePath, 'dGVzdA=='))
        .resolves.toBe(false);
    });

    it('realpath 解析到白名单外返回 false（防 symlink）', async () => {
      const filePath = path.join(TEST_HOME, 'link.pdf');
      hoisted.fsMock.realpath.mockImplementation(async (p: string) => {
        if (p === filePath) return '/etc/secret.pdf';
        return p;
      });
      await expect(callHandler('export:writeFileBuffer', filePath, 'dGVzdA=='))
        .resolves.toBe(false);
      expect(hoisted.loggerMock.audit).toHaveBeenCalledWith(
        'security.path', 'export:writeFileBuffer rejected: realpath outside allowed roots (symlink?)',
        expect.objectContaining({ filePath }),
      );
    });
  });

  describe('成功路径', () => {
    it('合法路径写入 base64 解码后的 buffer', async () => {
      const filePath = path.join(TEST_HOME, 'novel.pdf');
      // 'dGVzdA==' 是 'test' 的 base64 编码
      const result = await callHandler('export:writeFileBuffer', filePath, 'dGVzdA==');
      expect(result).toBe(true);
      expect(hoisted.fsMock.writeFile).toHaveBeenCalledTimes(1);
      const writtenBuffer = hoisted.fsMock.writeFile.mock.calls[0][1] as Buffer;
      expect(writtenBuffer.toString('utf-8')).toBe('test');
    });

    it('二进制内容（非文本）正确解码并写入', async () => {
      // .pdf 是 exportFile 白名单扩展名（二进制格式），.png 不在白名单中
      const filePath = path.join(TEST_HOME, 'novel.pdf');
      // 构造 8 字节二进制：0x00 0x01 ... 0x07
      const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
      const b64 = bytes.toString('base64');
      const result = await callHandler('export:writeFileBuffer', filePath, b64);
      expect(result).toBe(true);
      const writtenBuffer = hoisted.fsMock.writeFile.mock.calls[0][1] as Buffer;
      expect(writtenBuffer).toEqual(bytes);
    });
  });

  describe('错误处理', () => {
    it('fs.writeFile 抛错时返回 false 并 error 日志', async () => {
      const filePath = path.join(TEST_HOME, 'novel.pdf');
      hoisted.fsMock.writeFile.mockRejectedValue(new Error('permission denied'));
      const result = await callHandler('export:writeFileBuffer', filePath, 'dGVzdA==');
      expect(result).toBe(false);
      expect(hoisted.loggerMock.error).toHaveBeenCalledWith(
        'export:writeFileBuffer failed',
        expect.objectContaining({ error: 'permission denied' }),
      );
    });
  });
});

describe('handler 注册完整性', () => {
  it('export:writeFile 已注册到 ipcMain.handle', () => {
    expect(hoisted.handlers.has('export:writeFile')).toBe(true);
  });

  it('export:writeFileBuffer 已注册到 ipcMain.handle', () => {
    expect(hoisted.handlers.has('export:writeFileBuffer')).toBe(true);
  });
});
