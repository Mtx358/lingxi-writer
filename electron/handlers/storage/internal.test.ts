/**
 * electron/handlers/storage/internal.ts 单元测试
 *
 * 覆盖 storage.handler.test.ts 未直接覆盖的内部工具函数：
 *   - resolveFilePath：路径解析 + 安全校验
 *   - resolveDirPath：目录路径解析 + 空 projectId 防护
 *   - isRecentlySelectedFile：过期文件清理路径（行 106-108）
 *   - getRecentlySelectedFilesRealPaths：混合过期/有效文件过滤（行 119-120）
 *   - rememberSelectedFile：空/非法输入处理
 *
 * 测试策略：
 *   - vi.mock('electron')：app.getPath 返回测试目录
 *   - vi.mock('../shared')：提供 getDataDir/getProjectsDir 的可控返回值
 *   - vi.useFakeTimers() 控制时间推进，测试过期清理
 *   - beforeEach 中推进时间超过 TTL 并触发清理，清空模块级 recentSelectedFiles Map
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

const hoisted = vi.hoisted(() => {
  // vi.hoisted 回调在模块 import 初始化前执行，不能引用外层 import，需用 require
  const _path = require('node:path');
  const _os = require('node:os');
  return {
    TEST_USERDATA: _path.join(_os.tmpdir(), 'lingxi-test-internal'),
    tmpdir: _os.tmpdir(),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return hoisted.TEST_USERDATA;
      return hoisted.tmpdir;
    }),
  },
}));

vi.mock('../shared', () => ({
  getDataDir: vi.fn(() => hoisted.TEST_USERDATA),
  getProjectsDir: vi.fn(() => path.join(hoisted.TEST_USERDATA, 'projects')),
}));

import {
  resolveFilePath,
  resolveDirPath,
  rememberSelectedFile,
  isRecentlySelectedFile,
  getRecentlySelectedFilesRealPaths,
  ALLOWED_PROJECT_SUBKEYS,
  RECENT_SELECTED_FILES_TTL_MS,
} from './internal';

describe('resolveFilePath', () => {
  it('全局 key → dataDir/{key}.json', () => {
    const result = resolveFilePath('projects');
    expect(result).toBe(path.join(hoisted.TEST_USERDATA, 'projects.json'));
  });

  it('project_{id} → projectsDir/{id}/main.json', () => {
    const result = resolveFilePath('project_p1');
    expect(result).toBe(path.join(hoisted.TEST_USERDATA, 'projects', 'p1', 'main.json'));
  });

  it('project_{id}_{subkey} → projectsDir/{id}/{subkey}.json', () => {
    const result = resolveFilePath('project_p1_chapters');
    expect(result).toBe(path.join(hoisted.TEST_USERDATA, 'projects', 'p1', 'chapters.json'));
  });

  it('非法 subkey → 抛错', () => {
    expect(() => resolveFilePath('project_p1_evil')).toThrow('Invalid project subkey');
  });

  it('合法 subkey 全部可解析', () => {
    for (const subkey of ALLOWED_PROJECT_SUBKEYS) {
      const result = resolveFilePath(`project_p1_${subkey}`);
      expect(result).toContain(subkey);
    }
  });

  it('路径穿越字符 → 抛错', () => {
    expect(() => resolveFilePath('../etc/passwd')).toThrow();
    expect(() => resolveFilePath('foo/bar')).toThrow();
    expect(() => resolveFilePath('foo\\bar')).toThrow();
    expect(() => resolveFilePath('foo\0bar')).toThrow();
  });

  it('空 key → 抛错', () => {
    expect(() => resolveFilePath('')).toThrow();
    expect(() => resolveFilePath(null as unknown as string)).toThrow();
  });
});

describe('resolveDirPath', () => {
  it('project_{id} → projectsDir/{id}', () => {
    const result = resolveDirPath('project_p1');
    expect(result).toBe(path.join(hoisted.TEST_USERDATA, 'projects', 'p1'));
  });

  it('project_{id}_{subkey} → projectsDir/{id}（忽略 subkey）', () => {
    const result = resolveDirPath('project_p1_chapters');
    expect(result).toBe(path.join(hoisted.TEST_USERDATA, 'projects', 'p1'));
  });

  it('空 projectId（project_ 单独前缀）→ 抛错（防 rm -rf projects 根目录）', () => {
    expect(() => resolveDirPath('project_')).toThrow('Invalid projectId');
  });

  it('projectId 含路径穿越 → 抛错', () => {
    expect(() => resolveDirPath('project_../etc')).toThrow();
  });

  it('非 project_ 前缀 → 返回 dataDir', () => {
    const result = resolveDirPath('recovery_draft');
    expect(result).toBe(hoisted.TEST_USERDATA);
  });
});

// ============ recentSelectedFiles 相关测试 ============
// recentSelectedFiles 是模块级 Map，跨测试持久。用 fake timer + TTL 推进清理。
describe('isRecentlySelectedFile / rememberSelectedFile / getRecentlySelectedFilesRealPaths', () => {
  // 单调递增的时间基线：recentSelectedFiles 是模块级 Map，跨测试共享。
  // 若 beforeEach 用 setSystemTime(0) 回退时间，上一个测试遗留的条目（时间戳 > 0）
  // 会变成"未来"条目（age 为负），cleanup 循环不会删除它们，从而污染后续断言。
  // 改为每次递增基线，保证新基线 > 上次测试的最大时间戳，遗留条目均为"过去"从而被清理。
  let cleanupTimeBase = 1_000_000_000_000; // 1e12，远大于任何测试内相对推进的时间

  beforeEach(() => {
    vi.useFakeTimers();
    // 每次递增基线（单调递增），确保上次遗留条目相对新基线均为"过去"
    cleanupTimeBase += 10 * RECENT_SELECTED_FILES_TTL_MS;
    vi.setSystemTime(new Date(cleanupTimeBase));
    // 触发清理循环：删除所有 age > TTL 的遗留条目
    rememberSelectedFile('/tmp/__cleanup_trigger__');
    // 推进让 trigger 自身也过期（getRecentlySelectedFilesRealPaths 会过滤它）
    vi.advanceTimersByTime(RECENT_SELECTED_FILES_TTL_MS + 1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rememberSelectedFile 后 isRecentlySelectedFile 返回 true', () => {
    rememberSelectedFile('/tmp/file.txt');
    expect(isRecentlySelectedFile('/tmp/file.txt')).toBe(true);
  });

  it('未 remember 的文件 → false', () => {
    expect(isRecentlySelectedFile('/tmp/never.txt')).toBe(false);
  });

  it('过期文件 → 返回 false 并清理（行 106-108）', () => {
    rememberSelectedFile('/tmp/expired.txt');
    // 推进超过 TTL
    vi.advanceTimersByTime(RECENT_SELECTED_FILES_TTL_MS + 1);
    // 过期：返回 false 并从 Map 中删除
    expect(isRecentlySelectedFile('/tmp/expired.txt')).toBe(false);
  });

  it('过期后再 remember → 重新有效', () => {
    rememberSelectedFile('/tmp/renewed.txt');
    vi.advanceTimersByTime(RECENT_SELECTED_FILES_TTL_MS + 1);
    expect(isRecentlySelectedFile('/tmp/renewed.txt')).toBe(false);
    // 重新 remember
    rememberSelectedFile('/tmp/renewed.txt');
    expect(isRecentlySelectedFile('/tmp/renewed.txt')).toBe(true);
  });

  it('非字符串 / 空字符串 → false', () => {
    expect(isRecentlySelectedFile(null)).toBe(false);
    expect(isRecentlySelectedFile('')).toBe(false);
    expect(isRecentlySelectedFile(123)).toBe(false);
    expect(isRecentlySelectedFile(undefined)).toBe(false);
  });

  it('rememberSelectedFile 忽略空/非法输入', () => {
    // 不抛错，静默忽略
    rememberSelectedFile('');
    rememberSelectedFile(null as unknown as string);
    // 这些不添加任何有效条目
  });

  it('相对路径被 resolve 为绝对路径后存储', () => {
    rememberSelectedFile('relative/path.txt');
    const abs = path.resolve('relative/path.txt');
    expect(isRecentlySelectedFile(abs)).toBe(true);
  });

  it('getRecentlySelectedFilesRealPaths 返回所有未过期文件（行 119-120）', () => {
    // 先触发清理（rememberSelectedFile 内部清理过期项）
    rememberSelectedFile('/tmp/gp_a.txt');
    rememberSelectedFile('/tmp/gp_b.txt');
    rememberSelectedFile('/tmp/gp_c.txt');

    const paths = getRecentlySelectedFilesRealPaths();
    // 应包含刚添加的 3 个（以及可能的未过期 trigger，但已过期被清理）
    expect(paths).toContain('/tmp/gp_a.txt');
    expect(paths).toContain('/tmp/gp_b.txt');
    expect(paths).toContain('/tmp/gp_c.txt');
  });

  it('getRecentlySelectedFilesRealPaths 混合过期/有效 → 仅返回未过期的', () => {
    rememberSelectedFile('/tmp/gp_valid.txt');
    // 推进部分时间（未过期）
    vi.advanceTimersByTime(1000);
    rememberSelectedFile('/tmp/gp_also_valid.txt');
    // 推进让第一个过期但第二个不过期
    vi.advanceTimersByTime(RECENT_SELECTED_FILES_TTL_MS - 500);

    const paths = getRecentlySelectedFilesRealPaths();
    // 第一个已过期，第二个未过期
    expect(paths).not.toContain('/tmp/gp_valid.txt');
    expect(paths).toContain('/tmp/gp_also_valid.txt');
  });

  it('getRecentlySelectedFilesRealPaths 全部过期 → 返回空数组', () => {
    rememberSelectedFile('/tmp/gp_old1.txt');
    rememberSelectedFile('/tmp/gp_old2.txt');
    vi.advanceTimersByTime(RECENT_SELECTED_FILES_TTL_MS + 1);

    const paths = getRecentlySelectedFilesRealPaths();
    expect(paths).toEqual([]);
  });

  it('getRecentlySelectedFilesRealPaths 触发清理后过期文件不再返回', () => {
    rememberSelectedFile('/tmp/gp_cleanup.txt');
    vi.advanceTimersByTime(RECENT_SELECTED_FILES_TTL_MS + 1);
    // rememberSelectedFile 触发清理循环
    rememberSelectedFile('/tmp/gp_fresh.txt');
    // getRecentlySelectedFilesRealPaths 仅返回未过期的
    const paths = getRecentlySelectedFilesRealPaths();
    expect(paths).not.toContain('/tmp/gp_cleanup.txt');
    expect(paths).toContain('/tmp/gp_fresh.txt');
  });
});
