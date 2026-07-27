/**
 * electron/main.ts 路径校验函数单元测试
 *
 * 测试目标：isSafeIdentifier / isInsideDataDir / isValidProjectFileData /
 *          isSafeProjectFilePath / isSafeBackupPath
 *          resolveRealPath / assertRealPathInside（防 symlink 绕过）
 *
 * main.ts 是 Electron 主进程入口，import 时会触发 import 'electron' 以及
 * 顶层副作用（app.requestSingleInstanceLock / app.whenReady().then(...) 等）。
 * 测试用 vi.mock('electron', ...) 提供 app/ipcMain/Menu 等的内存实现，
 * 并让 app.whenReady 返回永不 resolve 的 Promise，避免触发 createWindow /
 * startAutoBackup / IPC handler 注册等副作用。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// ============ 测试用 userData / home 目录 ============
// 用 vi.hoisted 让 mock factory 能引用这些常量（vi.mock 会被 hoist 到顶部，
// 普通 const 在 factory 运行时尚未初始化）
const { TEST_USERDATA, TEST_HOME, neverResolve } = vi.hoisted(() => ({
  TEST_USERDATA: '/tmp/lingxi-test-userdata',
  TEST_HOME: '/tmp/lingxi-test-home',
  // 让 whenReady 永不 resolve：阻止 createWindow / startAutoBackup /
  // registerXxxHandlers 等副作用在测试中执行
  neverResolve: new Promise<never>(() => {}),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return TEST_USERDATA;
      if (name === 'home') return TEST_HOME;
      if (name === 'documents') return `${TEST_HOME}/Documents`;
      if (name === 'desktop') return `${TEST_HOME}/Desktop`;
      if (name === 'downloads') return `${TEST_HOME}/Downloads`;
      return '/tmp';
    }),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    whenReady: vi.fn(() => neverResolve),
    quit: vi.fn(),
    // crashReporter.start 在 app.whenReady 之前调用，setPath 用于设置 crashDumps 目录
    setPath: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    once: vi.fn(),
    on: vi.fn(),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
    },
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    show: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
  })),
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn(),
        onBeforeRequest: vi.fn(),
      },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      clearStorageData: vi.fn().mockResolvedValue(undefined),
    },
  },
  // crashReporter.start 在 app.whenReady 之前调用（本地落盘模式），需提供 start mock
  crashReporter: {
    start: vi.fn(),
  },
}));

// 在 import main.ts 之前先 mock，确保 vi.mock 提前生效（vitest 自动 hoist）
import {
  isSafeIdentifier,
  isInsideDataDir,
  isValidProjectFileData,
  isSafeProjectFilePath,
  isSafeExportFilePath,
  isSafeBackupPath,
  resolveRealPath,
  assertRealPathInside,
  validateAIProxyParams,
  validateAIProxyLLMParams,
} from './main';

// ============ 测试用例 ============

describe('electron/main 路径校验', () => {
  // -------------------- isSafeIdentifier --------------------
  describe('isSafeIdentifier', () => {
    it('合法标识符返回 true', () => {
      expect(isSafeIdentifier('abc123')).toBe(true);
      expect(isSafeIdentifier('project-uuid-001')).toBe(true);
      expect(isSafeIdentifier('a')).toBe(true);
      expect(isSafeIdentifier('00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('空字符串返回 false', () => {
      expect(isSafeIdentifier('')).toBe(false);
    });

    it('".." 返回 false（路径穿越）', () => {
      expect(isSafeIdentifier('..')).toBe(false);
    });

    it('"../etc" 返回 false', () => {
      expect(isSafeIdentifier('../etc')).toBe(false);
    });

    it('含 / 的字符串返回 false', () => {
      expect(isSafeIdentifier('foo/bar')).toBe(false);
    });

    it('含 \\ 的字符串返回 false', () => {
      expect(isSafeIdentifier('foo\\bar')).toBe(false);
    });

    it('含 null 字节的字符串返回 false', () => {
      expect(isSafeIdentifier('foo\0bar')).toBe(false);
    });

    it('null 返回 false', () => {
      expect(isSafeIdentifier(null)).toBe(false);
    });

    it('undefined 返回 false', () => {
      expect(isSafeIdentifier(undefined)).toBe(false);
    });

    it('非字符串（数字）返回 false', () => {
      // 函数签名接受 unknown，传 123 不报 TS 错误，仅验证运行时返回 false
      expect(isSafeIdentifier(123)).toBe(false);
    });

    it('foo:bar 当前实现返回 true（L1 改进建议：应额外禁止 : 以避免与 Windows 盘符冲突）', () => {
      // 当前实现仅校验 .. / \\ 这些路径穿越字符，未禁止冒号。
      // 在 Windows 上 "C:foo" 会被 path.resolve 解释为相对当前盘符 C: 的相对路径，
      // 可能构成路径穿越。L1 建议把冒号也加入禁止字符集。
      expect(isSafeIdentifier('foo:bar')).toBe(true);
    });
  });

  // -------------------- isInsideDataDir --------------------
  describe('isInsideDataDir', () => {
    it('位于 userData 之内的路径返回 true', () => {
      expect(isInsideDataDir(path.join(TEST_USERDATA, 'safe.txt'))).toBe(true);
    });

    it('userData 自身返回 true', () => {
      expect(isInsideDataDir(TEST_USERDATA)).toBe(true);
    });

    it('os.tmpdir() 下的文件返回 false（不在 userData 内）', () => {
      // /tmp/safe.txt 不在 /tmp/lingxi-test-userdata 内
      expect(isInsideDataDir(path.join(os.tmpdir(), 'safe.txt'))).toBe(false);
    });

    it('空字符串返回 false', () => {
      expect(isInsideDataDir('')).toBe(false);
    });

    it('null 返回 false', () => {
      expect(isInsideDataDir(null)).toBe(false);
    });

    it('"../../../etc/passwd" 返回 false', () => {
      // 相对路径会被 path.resolve 解析到 cwd 之外，但不会落在 userData 内
      expect(isInsideDataDir('../../../etc/passwd')).toBe(false);
    });

    it('"/etc/passwd" 返回 false', () => {
      expect(isInsideDataDir('/etc/passwd')).toBe(false);
    });

    it('前缀绕过攻击返回 false（/tmp/lingxi-test-userdata-malicious/x）', () => {
      // 严格前缀匹配：必须以 userData + path.sep 开头，防止 userData-malicious 绕过
      const malicious = `${TEST_USERDATA}-malicious/evil.txt`;
      expect(isInsideDataDir(malicious)).toBe(false);
    });

    it('含 null 字节的路径返回 false', () => {
      expect(isInsideDataDir(`${TEST_USERDATA}\0evil`)).toBe(false);
    });
  });

  // -------------------- isValidProjectFileData --------------------
  describe('isValidProjectFileData', () => {
    const validData = {
      project: {},
      chapters: [],
      characters: [],
      settingCategories: [],
      settingItems: [],
      foreshadows: [],
      materials: [],
    };

    it('完整合法数据返回 true', () => {
      expect(isValidProjectFileData(validData)).toBe(true);
    });

    it('null 返回 false', () => {
      expect(isValidProjectFileData(null)).toBe(false);
    });

    it('undefined 返回 false', () => {
      expect(isValidProjectFileData(undefined)).toBe(false);
    });

    it('空对象返回 false（缺 project）', () => {
      expect(isValidProjectFileData({})).toBe(false);
    });

    it('project 是字符串返回 false', () => {
      expect(isValidProjectFileData({ ...validData, project: 'not object' })).toBe(false);
    });

    it('project 是数组返回 false', () => {
      expect(isValidProjectFileData({ ...validData, project: [] })).toBe(false);
    });

    it('chapters 不是数组返回 false', () => {
      expect(isValidProjectFileData({ ...validData, chapters: 'not array' })).toBe(false);
    });

    it('6 个集合字段任一非数组都返回 false', () => {
      expect(isValidProjectFileData({ ...validData, characters: 'x' })).toBe(false);
      expect(isValidProjectFileData({ ...validData, settingCategories: 'x' })).toBe(false);
      expect(isValidProjectFileData({ ...validData, settingItems: 'x' })).toBe(false);
      expect(isValidProjectFileData({ ...validData, foreshadows: 'x' })).toBe(false);
      expect(isValidProjectFileData({ ...validData, materials: 'x' })).toBe(false);
    });

    it('versions 缺省（undefined）返回 true', () => {
      expect(isValidProjectFileData(validData)).toBe(true);
    });

    it('versions 为 null 返回 true（向后兼容）', () => {
      expect(isValidProjectFileData({ ...validData, versions: null })).toBe(true);
    });

    it('versions 为空对象返回 true', () => {
      expect(isValidProjectFileData({ ...validData, versions: {} })).toBe(true);
    });

    it('versions 为字符串返回 false', () => {
      expect(isValidProjectFileData({ ...validData, versions: 'not object' })).toBe(false);
    });

    it('versions 为数组返回 false', () => {
      expect(isValidProjectFileData({ ...validData, versions: [] })).toBe(false);
    });
  });

  // -------------------- isSafeProjectFilePath --------------------
  describe('isSafeProjectFilePath', () => {
    it('白名单目录内的 .cwp 返回 true', () => {
      expect(isSafeProjectFilePath(path.join(TEST_HOME, 'novel.cwp'))).toBe(true);
      expect(isSafeProjectFilePath(path.join(TEST_USERDATA, 'novel.cwp'))).toBe(true);
      expect(isSafeProjectFilePath(path.join(TEST_HOME, 'Documents', 'novel.cwp'))).toBe(true);
    });

    it('白名单目录外的 .cwp 返回 false', () => {
      expect(isSafeProjectFilePath('/etc/novel.cwp')).toBe(false);
      expect(isSafeProjectFilePath('/var/novel.cwp')).toBe(false);
    });

    it('非 .cwp 后缀返回 false', () => {
      expect(isSafeProjectFilePath(path.join(TEST_HOME, 'novel.txt'))).toBe(false);
      expect(isSafeProjectFilePath(path.join(TEST_HOME, 'novel.json'))).toBe(false);
      expect(isSafeProjectFilePath(path.join(TEST_HOME, 'novel'))).toBe(false);
    });

    it('相对路径返回 false', () => {
      expect(isSafeProjectFilePath('relative.cwp')).toBe(false);
      expect(isSafeProjectFilePath('./novel.cwp')).toBe(false);
    });

    it('含 .. 的路径返回 false', () => {
      // path.normalize 后会跳出白名单目录
      expect(isSafeProjectFilePath(path.join(TEST_HOME, '..', 'etc', 'novel.cwp'))).toBe(false);
    });

    it('含 null 字节的路径返回 false', () => {
      expect(isSafeProjectFilePath(`${path.join(TEST_HOME, 'novel.cwp')}\0`)).toBe(false);
    });

    it('含换行符的路径返回 false', () => {
      expect(isSafeProjectFilePath(`${path.join(TEST_HOME, 'novel.cwp')}\n`)).toBe(false);
      expect(isSafeProjectFilePath(`${path.join(TEST_HOME, 'novel.cwp')}\r`)).toBe(false);
    });

    it('空字符串返回 false', () => {
      expect(isSafeProjectFilePath('')).toBe(false);
    });

    it('null 返回 false', () => {
      expect(isSafeProjectFilePath(null)).toBe(false);
    });

    it('非字符串返回 false', () => {
      // 函数签名接受 unknown，传 123 不报 TS 错误，仅验证运行时返回 false
      expect(isSafeProjectFilePath(123)).toBe(false);
    });

    it('"../evil.cwp/." 这种规范化绕过返回 false', () => {
      // 规范化后不以 .cwp 结尾 → false
      expect(isSafeProjectFilePath(`${path.join(TEST_HOME, 'evil.cwp')}/.`)).toBe(false);
    });
  });

  // -------------------- isSafeExportFilePath --------------------
  describe('isSafeExportFilePath', () => {
    it('白名单目录内的允许扩展名返回 true', () => {
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.docx'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.pdf'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.epub'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.txt'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.md'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.html'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.markdown'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.htm'))).toBe(true);
    });

    it('Documents / Desktop / Downloads / userData 目录内返回 true', () => {
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'Documents', 'novel.pdf'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'Desktop', 'novel.docx'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'Downloads', 'novel.epub'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_USERDATA, 'export', 'novel.txt'))).toBe(true);
    });

    it('扩展名大小写不敏感', () => {
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.DOCX'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.PDF'))).toBe(true);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.Epub'))).toBe(true);
    });

    it('白名单外的目录返回 false', () => {
      expect(isSafeExportFilePath('/etc/novel.pdf')).toBe(false);
      expect(isSafeExportFilePath('/var/novel.docx')).toBe(false);
      expect(isSafeExportFilePath('/tmp/novel.epub')).toBe(false);
    });

    it('不在扩展名白名单内的返回 false', () => {
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'evil.exe'))).toBe(false);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'evil.bat'))).toBe(false);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'evil.sh'))).toBe(false);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'evil.json'))).toBe(false);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.cwp'))).toBe(false);
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel'))).toBe(false);
    });

    it('相对路径返回 false', () => {
      expect(isSafeExportFilePath('relative.pdf')).toBe(false);
      expect(isSafeExportFilePath('./novel.docx')).toBe(false);
    });

    it('含 .. 的路径返回 false', () => {
      // path.normalize 后会跳出白名单目录
      expect(isSafeExportFilePath(path.join(TEST_HOME, '..', 'etc', 'novel.pdf'))).toBe(false);
    });

    it('含 null 字节的路径返回 false', () => {
      expect(isSafeExportFilePath(`${path.join(TEST_HOME, 'novel.pdf')}\0`)).toBe(false);
    });

    it('含换行符的路径返回 false', () => {
      expect(isSafeExportFilePath(`${path.join(TEST_HOME, 'novel.pdf')}\n`)).toBe(false);
      expect(isSafeExportFilePath(`${path.join(TEST_HOME, 'novel.pdf')}\r`)).toBe(false);
    });

    it('空字符串返回 false', () => {
      expect(isSafeExportFilePath('')).toBe(false);
    });

    it('null 返回 false', () => {
      expect(isSafeExportFilePath(null)).toBe(false);
    });

    it('非字符串返回 false', () => {
      expect(isSafeExportFilePath(123)).toBe(false);
    });

    it('"../evil.exe/." 这种规范化绕过返回 false', () => {
      // 规范化后不以白名单扩展名结尾 → false
      expect(isSafeExportFilePath(`${path.join(TEST_HOME, 'evil.exe')}/.`)).toBe(false);
    });

    it('"novel.pdf/../evil.exe" 规范化后变 .exe 返回 false', () => {
      // 路径 normalize 后扩展名从 .pdf 变为 .exe（跳出白名单）
      expect(isSafeExportFilePath(path.join(TEST_HOME, 'novel.pdf', '..', 'evil.exe'))).toBe(false);
    });
  });

  // -------------------- isSafeBackupPath --------------------
  describe('isSafeBackupPath', () => {
    const BACKUPS_DIR = path.join(TEST_USERDATA, 'backups');

    it('backups 根目录返回 true', () => {
      expect(isSafeBackupPath(BACKUPS_DIR)).toBe(true);
    });

    it('backups 目录下的子路径返回 true', () => {
      expect(isSafeBackupPath(path.join(BACKUPS_DIR, '2024-01-01.cwp'))).toBe(true);
      expect(isSafeBackupPath(path.join(BACKUPS_DIR, 'sub', 'backup.cwp'))).toBe(true);
    });

    it('backups 之外的路径返回 false', () => {
      expect(isSafeBackupPath('/etc/passwd')).toBe(false);
      expect(isSafeBackupPath(path.join(TEST_USERDATA, 'projects', 'x.json'))).toBe(false);
    });

    it('前缀绕过攻击返回 false（backups-malicious）', () => {
      // 严格前缀匹配：必须以 backupsRoot + path.sep 开头
      const malicious = `${BACKUPS_DIR}-malicious/evil.cwp`;
      expect(isSafeBackupPath(malicious)).toBe(false);
    });

    it('空字符串返回 false', () => {
      expect(isSafeBackupPath('')).toBe(false);
    });

    it('null 返回 false', () => {
      expect(isSafeBackupPath(null)).toBe(false);
    });

    it('含 null 字节的路径返回 false', () => {
      expect(isSafeBackupPath(`${BACKUPS_DIR}\0evil`)).toBe(false);
    });
  });

  // -------------------- resolveRealPath / assertRealPathInside --------------------
  // 这些测试需要真实文件系统操作（创建 symlink），用 os.tmpdir() 作为沙箱。
  // 验证 realpath 递归跟随 symlink，且 assertRealPathInside 拒绝指向 allowedRoots 外的 symlink。
  // 注意：CI 上 /tmp 可能本身是 symlink（如 macOS /tmp -> /private/tmp），realpath 会解析到真实路径，
  // 测试用 fs.realpath 解析 tempDir 后再做断言，避免前缀不匹配的误判
  describe('resolveRealPath & assertRealPathInside（防 symlink 绕过）', () => {
    let sandbox: string;
    let outsideSandbox: string;
    let realSandbox: string;
    let realOutside: string;

    beforeAll(async () => {
      // 创建两个独立目录：sandbox 模拟 allowedRoot，outsideSandbox 模拟 allowedRoot 外
      sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'lxw-sandbox-'));
      outsideSandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'lxw-outside-'));
      // 解析真实路径（tmpdir 本身可能是 symlink）
      realSandbox = await fs.realpath(sandbox);
      realOutside = await fs.realpath(outsideSandbox);
    });

    afterAll(async () => {
      await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {});
      await fs.rm(outsideSandbox, { recursive: true, force: true }).catch(() => {});
    });

    it('resolveRealPath 对普通文件返回真实路径', async () => {
      const filePath = path.join(sandbox, 'normal.txt');
      await fs.writeFile(filePath, 'hello', 'utf-8');
      const real = await resolveRealPath(filePath);
      expect(real).toBe(await fs.realpath(filePath));
    });

    it('resolveRealPath 对不存在的文件回退到 父目录 realpath + basename', async () => {
      const filePath = path.join(sandbox, 'nonexistent.txt');
      const real = await resolveRealPath(filePath);
      expect(real).toBe(path.join(realSandbox, 'nonexistent.txt'));
    });

    it('resolveRealPath 对父目录也不存在的路径返回 null', async () => {
      const filePath = path.join(sandbox, 'missing-subdir', 'file.txt');
      const real = await resolveRealPath(filePath);
      expect(real).toBeNull();
    });

    it('resolveRealPath 跟随 symlink 返回目标真实路径', async () => {
      // 在 sandbox 创建指向 outsideSandbox 文件的 symlink
      const targetFile = path.join(outsideSandbox, 'secret.txt');
      await fs.writeFile(targetFile, 'secret', 'utf-8');
      const symlinkPath = path.join(sandbox, 'link-to-secret.txt');
      await fs.symlink(targetFile, symlinkPath);
      const real = await resolveRealPath(symlinkPath);
      expect(real).toBe(await fs.realpath(targetFile));
    });

    it('assertRealPathInside 拒绝指向 allowedRoots 之外的 symlink', async () => {
      // sandbox 内的 symlink 指向 outsideSandbox 文件
      const targetFile = path.join(outsideSandbox, 'evil.txt');
      await fs.writeFile(targetFile, 'evil', 'utf-8');
      const symlinkPath = path.join(sandbox, 'evil-link.txt');
      // 若已存在（前序测试残留）先删
      await fs.unlink(symlinkPath).catch(() => {});
      await fs.symlink(targetFile, symlinkPath);
      // lexical isInsideDataDir 类比检查会通过（symlinkPath 在 sandbox 内），
      // 但 assertRealPathInside 应拒绝（realpath 解析到 outsideSandbox）
      const ok = await assertRealPathInside(symlinkPath, [realSandbox]);
      expect(ok).toBe(false);
    });

    it('assertRealPathInside 接受指向 allowedRoots 之内的普通文件', async () => {
      const filePath = path.join(sandbox, 'safe.txt');
      await fs.writeFile(filePath, 'safe', 'utf-8');
      const ok = await assertRealPathInside(filePath, [realSandbox]);
      expect(ok).toBe(true);
    });

    it('assertRealPathInside 接受 allowedRoots 内的 symlink 指向同根内文件', async () => {
      // sandbox 内的 symlink 指向 sandbox 内另一个文件（合法）
      const targetFile = path.join(sandbox, 'target.txt');
      await fs.writeFile(targetFile, 'target', 'utf-8');
      const symlinkPath = path.join(sandbox, 'internal-link.txt');
      await fs.unlink(symlinkPath).catch(() => {});
      await fs.symlink(targetFile, symlinkPath);
      const ok = await assertRealPathInside(symlinkPath, [realSandbox]);
      expect(ok).toBe(true);
    });

    it('assertRealPathInside 对不存在的父目录返回 false', async () => {
      const filePath = path.join(sandbox, 'missing-subdir', 'file.txt');
      const ok = await assertRealPathInside(filePath, [realSandbox]);
      expect(ok).toBe(false);
    });

    it('assertRealPathInside 对存在的 allowedRoot 但 filePath 不存在时通过', async () => {
      // 模拟 projectFile:write 新文件场景：父目录 sandbox 存在，file 不存在
      const filePath = path.join(sandbox, 'new-file.cwp');
      const ok = await assertRealPathInside(filePath, [realSandbox]);
      expect(ok).toBe(true);
    });

    it('assertRealPathInside 多个 allowedRoots：命中任一即通过', async () => {
      const filePathInSandbox = path.join(sandbox, 'in-sandbox.txt');
      await fs.writeFile(filePathInSandbox, '', 'utf-8');
      const ok = await assertRealPathInside(filePathInSandbox, [realOutside, realSandbox]);
      expect(ok).toBe(true);
    });
  });
});

// -------------------- validateAIProxyParams --------------------
// ai:proxyStream 入参白名单校验：防止渲染层被 XSS 后传入畸形 params
describe('validateAIProxyParams', () => {
  const validParams = {
    provider: 'mock',
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.7,
    maxTokens: 1000,
    requestId: 'ai-12345-abc',
  };

  it('合法 params 返回 null', () => {
    expect(validateAIProxyParams(validParams)).toBeNull();
  });

  it('所有合法 provider 都通过', () => {
    for (const p of ['mock', 'local', 'openai', 'deepseek']) {
      expect(validateAIProxyParams({ ...validParams, provider: p })).toBeNull();
    }
  });

  it('provider 不在白名单返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, provider: 'claude' })).toMatch(/invalid provider/);
    expect(validateAIProxyParams({ ...validParams, provider: '' })).toMatch(/invalid provider/);
  });

  it('provider 非字符串返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, provider: 123 })).toMatch(/invalid provider/);
    expect(validateAIProxyParams({ ...validParams, provider: null })).toMatch(/invalid provider/);
  });

  it('params 非对象返回错误', () => {
    expect(validateAIProxyParams(null)).toMatch(/params must be/);
    expect(validateAIProxyParams(undefined)).toMatch(/params must be/);
    expect(validateAIProxyParams('string')).toMatch(/params must be/);
    expect(validateAIProxyParams(123)).toMatch(/params must be/);
  });

  it('baseUrl 过长返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, baseUrl: 'x'.repeat(1025) })).toMatch(/invalid baseUrl/);
  });

  it('baseUrl 合法字符串通过', () => {
    expect(validateAIProxyParams({ ...validParams, baseUrl: 'https://api.openai.com' })).toBeNull();
  });

  it('baseUrl 空字符串与 undefined 通过（可选字段）', () => {
    expect(validateAIProxyParams({ ...validParams, baseUrl: '' })).toBeNull();
    expect(validateAIProxyParams({ ...validParams, baseUrl: undefined })).toBeNull();
  });

  it('baseUrl 非字符串返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, baseUrl: 123 })).toMatch(/invalid baseUrl/);
  });

  it('model 过长返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, model: 'x'.repeat(129) })).toMatch(/invalid model/);
  });

  it('model 合法字符串通过', () => {
    expect(validateAIProxyParams({ ...validParams, model: 'gpt-4o-mini' })).toBeNull();
  });

  it('messages 非数组返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, messages: 'not array' })).toMatch(/messages must be/);
    expect(validateAIProxyParams({ ...validParams, messages: {} })).toMatch(/messages must be/);
  });

  it('messages 空数组返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, messages: [] })).toMatch(/messages must be/);
  });

  it('messages 超过 200 条返回错误', () => {
    const messages = Array(201).fill({ role: 'user', content: 'x' });
    expect(validateAIProxyParams({ ...validParams, messages })).toMatch(/too many messages/);
  });

  it('messages 恰好 200 条通过（边界值）', () => {
    const messages = Array(200).fill({ role: 'user', content: 'x' });
    expect(validateAIProxyParams({ ...validParams, messages })).toBeNull();
  });

  it('message 非对象返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, messages: ['not object'] })).toMatch(/must be an object/);
    expect(validateAIProxyParams({ ...validParams, messages: [null] })).toMatch(/must be an object/);
  });

  it('message role 不在白名单返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: 'tool', content: 'x' }] })).toMatch(/invalid role/);
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: '', content: 'x' }] })).toMatch(/invalid role/);
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: 'admin', content: 'x' }] })).toMatch(/invalid role/);
  });

  it('message 所有合法 role 通过', () => {
    expect(validateAIProxyParams({
      ...validParams,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey' },
      ],
    })).toBeNull();
  });

  it('message content 非字符串返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: 'user', content: 123 }] })).toMatch(/content must be string/);
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: 'user', content: null }] })).toMatch(/content must be string/);
  });

  it('message content 超长返回错误', () => {
    const longContent = 'x'.repeat(200_001);
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: 'user', content: longContent }] })).toMatch(/content too long/);
  });

  it('message content 恰好 200K 通过（边界值）', () => {
    const content = 'x'.repeat(200_000);
    expect(validateAIProxyParams({ ...validParams, messages: [{ role: 'user', content }] })).toBeNull();
  });

  it('temperature 非数字返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, temperature: 'high' })).toMatch(/invalid temperature/);
    expect(validateAIProxyParams({ ...validParams, temperature: null })).toMatch(/invalid temperature/);
  });

  it('temperature NaN/Infinity 返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, temperature: NaN })).toMatch(/invalid temperature/);
    expect(validateAIProxyParams({ ...validParams, temperature: Infinity })).toMatch(/invalid temperature/);
    expect(validateAIProxyParams({ ...validParams, temperature: -Infinity })).toMatch(/invalid temperature/);
  });

  it('temperature 超出 [0, 2] 返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, temperature: -0.1 })).toMatch(/invalid temperature/);
    expect(validateAIProxyParams({ ...validParams, temperature: 2.1 })).toMatch(/invalid temperature/);
  });

  it('temperature 边界值 0 和 2 通过', () => {
    expect(validateAIProxyParams({ ...validParams, temperature: 0 })).toBeNull();
    expect(validateAIProxyParams({ ...validParams, temperature: 2 })).toBeNull();
  });

  it('maxTokens 非整数返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, maxTokens: 1.5 })).toMatch(/invalid maxTokens/);
  });

  it('maxTokens 超出 [1, 8192] 返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, maxTokens: 0 })).toMatch(/invalid maxTokens/);
    expect(validateAIProxyParams({ ...validParams, maxTokens: 8193 })).toMatch(/invalid maxTokens/);
  });

  it('maxTokens NaN/Infinity 返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, maxTokens: NaN })).toMatch(/invalid maxTokens/);
    expect(validateAIProxyParams({ ...validParams, maxTokens: Infinity })).toMatch(/invalid maxTokens/);
  });

  it('maxTokens 边界值 1 和 8192 通过', () => {
    expect(validateAIProxyParams({ ...validParams, maxTokens: 1 })).toBeNull();
    expect(validateAIProxyParams({ ...validParams, maxTokens: 8192 })).toBeNull();
  });

  it('requestId 含空格返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'has space' })).toMatch(/invalid requestId/);
  });

  it('requestId 含点号返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'has.dot' })).toMatch(/invalid requestId/);
  });

  it('requestId 含斜杠返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'has/slash' })).toMatch(/invalid requestId/);
  });

  it('requestId 含特殊字符（如 : ! @）返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'has:colon' })).toMatch(/invalid requestId/);
    expect(validateAIProxyParams({ ...validParams, requestId: 'has@at' })).toMatch(/invalid requestId/);
    expect(validateAIProxyParams({ ...validParams, requestId: 'has!bang' })).toMatch(/invalid requestId/);
  });

  it('requestId 空字符串返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: '' })).toMatch(/invalid requestId/);
  });

  it('requestId 超长（> 128）返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'a'.repeat(129) })).toMatch(/invalid requestId/);
  });

  it('requestId 恰好 128 字符通过（边界值）', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'a'.repeat(128) })).toBeNull();
  });

  it('requestId 合法格式通过（含连字符/下划线）', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 'ai-12345-abc' })).toBeNull();
    expect(validateAIProxyParams({ ...validParams, requestId: 'req_001' })).toBeNull();
    expect(validateAIProxyParams({ ...validParams, requestId: 'a' })).toBeNull();
  });

  it('requestId 非字符串返回错误', () => {
    expect(validateAIProxyParams({ ...validParams, requestId: 123 })).toMatch(/invalid requestId/);
    expect(validateAIProxyParams({ ...validParams, requestId: null })).toMatch(/invalid requestId/);
  });
});

// ai:proxyLLM 入参白名单校验：非流式代理的入参校验（与 proxyStream 对称）
describe('validateAIProxyLLMParams', () => {
  const validParams = {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    prompt: '请回复"连接成功"四个字。',
    systemPrompt: '你是一个连接测试助手。',
    temperature: 0.7,
    maxTokens: 1000,
    requestId: 'ai-12345-abc',
  };

  it('合法 params 返回 null', () => {
    expect(validateAIProxyLLMParams(validParams)).toBeNull();
  });

  it('所有合法 provider 都通过', () => {
    for (const p of ['mock', 'local', 'openai', 'deepseek']) {
      expect(validateAIProxyLLMParams({ ...validParams, provider: p })).toBeNull();
    }
  });

  it('provider 不在白名单返回错误', () => {
    expect(validateAIProxyLLMParams({ ...validParams, provider: 'claude' })).toMatch(/invalid provider/);
    expect(validateAIProxyLLMParams({ ...validParams, provider: '' })).toMatch(/invalid provider/);
  });

  it('params 非对象返回错误', () => {
    expect(validateAIProxyLLMParams(null)).toMatch(/params must be/);
    expect(validateAIProxyLLMParams(undefined)).toMatch(/params must be/);
    expect(validateAIProxyLLMParams('string')).toMatch(/params must be/);
  });

  it('prompt 必须是非空字符串', () => {
    expect(validateAIProxyLLMParams({ ...validParams, prompt: '' })).toMatch(/non-empty string/);
    expect(validateAIProxyLLMParams({ ...validParams, prompt: 123 })).toMatch(/non-empty string/);
  });

  it('prompt 过长返回错误', () => {
    expect(validateAIProxyLLMParams({ ...validParams, prompt: 'x'.repeat(200001) })).toMatch(/prompt too long/);
  });

  it('baseUrl 过长返回错误', () => {
    expect(validateAIProxyLLMParams({ ...validParams, baseUrl: 'x'.repeat(1025) })).toMatch(/invalid baseUrl/);
  });

  it('baseUrl 空字符串与 undefined 通过（可选字段）', () => {
    expect(validateAIProxyLLMParams({ ...validParams, baseUrl: '' })).toBeNull();
    expect(validateAIProxyLLMParams({ ...validParams, baseUrl: undefined })).toBeNull();
  });

  it('systemPrompt 空字符串与 undefined 通过（可选字段）', () => {
    expect(validateAIProxyLLMParams({ ...validParams, systemPrompt: '' })).toBeNull();
    expect(validateAIProxyLLMParams({ ...validParams, systemPrompt: undefined })).toBeNull();
  });

  it('systemPrompt 过长返回错误', () => {
    expect(validateAIProxyLLMParams({ ...validParams, systemPrompt: 'x'.repeat(200001) })).toMatch(/systemPrompt too long/);
  });

  it('temperature 超范围返回错误', () => {
    expect(validateAIProxyLLMParams({ ...validParams, temperature: -0.1 })).toMatch(/invalid temperature/);
    expect(validateAIProxyLLMParams({ ...validParams, temperature: 2.1 })).toMatch(/invalid temperature/);
    expect(validateAIProxyLLMParams({ ...validParams, temperature: NaN })).toMatch(/invalid temperature/);
    expect(validateAIProxyLLMParams({ ...validParams, temperature: 'high' })).toMatch(/invalid temperature/);
  });

  it('maxTokens 非正整数返回错误', () => {
    expect(validateAIProxyLLMParams({ ...validParams, maxTokens: 0 })).toMatch(/invalid maxTokens/);
    expect(validateAIProxyLLMParams({ ...validParams, maxTokens: 1.5 })).toMatch(/invalid maxTokens/);
    expect(validateAIProxyLLMParams({ ...validParams, maxTokens: -1 })).toMatch(/invalid maxTokens/);
    expect(validateAIProxyLLMParams({ ...validParams, maxTokens: 'many' })).toMatch(/invalid maxTokens/);
  });

  it('requestId 格式校验', () => {
    expect(validateAIProxyLLMParams({ ...validParams, requestId: 'req_001' })).toBeNull();
    expect(validateAIProxyLLMParams({ ...validParams, requestId: 'a' })).toBeNull();
    expect(validateAIProxyLLMParams({ ...validParams, requestId: '' })).toMatch(/invalid requestId/);
    expect(validateAIProxyLLMParams({ ...validParams, requestId: 'x'.repeat(129) })).toMatch(/invalid requestId/);
    expect(validateAIProxyLLMParams({ ...validParams, requestId: 'bad space' })).toMatch(/invalid requestId/);
  });
});
