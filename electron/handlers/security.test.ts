/**
 * electron/handlers/security.ts 单元测试
 *
 * 测试目标：
 *   - isSafeIdentifier：长度上限 + 路径穿越字符防御 + 各类型边界
 *   - MAX_IDENTIFIER_LENGTH 常量导出值
 *   - isValidProjectFileData：project 形状校验（轻量覆盖，主要场景由 projectFile.logic.test.ts 覆盖）
 *
 * security.ts 顶层 import `app` from 'electron'（用于 getAllowedProjectFileRoots），
 * 因此本测试需 mock electron。isSafeIdentifier 本身是纯函数，不依赖 electron 运行时，
 * 但模块加载阶段必须能解析 'electron' import。
 *
 * 注意：完整路径校验（isSafeProjectFilePath / isSafeExportFilePath / assertRealPathInside）
 * 已由 storage.handler.test.ts / projectFile.logic.test.ts / exportFile.handler.test.ts 覆盖，
 * 本文件聚焦 isSafeIdentifier 长度上限（A1 安全加固）与少量边界补强。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

const hoisted = vi.hoisted(() => {
  const TEST_USERDATA = '/tmp/lingxi-test-userdata-security';
  const TEST_HOME = '/tmp/lingxi-test-home-security';
  return {
    TEST_USERDATA,
    TEST_HOME,
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
}));

// fs 在 security.ts 顶层 import，但 isSafeIdentifier / isValidProjectFileData 不使用 fs。
// 提供 mock 避免 node:fs/promises 在测试环境意外触达真实文件系统
vi.mock('node:fs/promises', () => ({
  default: {
    realpath: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  realpath: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import {
  isSafeIdentifier,
  MAX_IDENTIFIER_LENGTH,
  isValidProjectFileData,
} from './security';

describe('isSafeIdentifier', () => {
  describe('合法标识符', () => {
    it('普通 UUID 通过', () => {
      expect(isSafeIdentifier('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    it('短字符串通过', () => {
      expect(isSafeIdentifier('p1')).toBe(true);
      expect(isSafeIdentifier('attachment-001')).toBe(true);
    });

    it('含字母数字连字符下划线通过', () => {
      expect(isSafeIdentifier('proj_2024_v1')).toBe(true);
      expect(isSafeIdentifier('ATTACHMENT-XYZ')).toBe(true);
    });

    it('单字符通过', () => {
      expect(isSafeIdentifier('a')).toBe(true);
    });

    it('纯数字字符串通过', () => {
      expect(isSafeIdentifier('12345')).toBe(true);
    });
  });

  describe('长度上限（A1 安全加固）', () => {
    it('MAX_IDENTIFIER_LENGTH 常量为 256', () => {
      expect(MAX_IDENTIFIER_LENGTH).toBe(256);
    });

    it('恰好 256 字符的标识符通过', () => {
      const id = 'a'.repeat(MAX_IDENTIFIER_LENGTH);
      expect(id).toHaveLength(256);
      expect(isSafeIdentifier(id)).toBe(true);
    });

    it('257 字符的标识符被拒绝', () => {
      const id = 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1);
      expect(id).toHaveLength(257);
      expect(isSafeIdentifier(id)).toBe(false);
    });

    it('超长标识符（10KB）被拒绝，不触发 path.join 拼接（DoS 防御）', () => {
      const huge = 'a'.repeat(10_000);
      expect(isSafeIdentifier(huge)).toBe(false);
    });

    it('超长且含路径穿越字符的标识符被拒绝（长度检查优先于字符检查）', () => {
      // 即使含 ../，长度超限也应直接拒绝，不进入字符检查
      const huge = 'a'.repeat(MAX_IDENTIFIER_LENGTH + 100) + '../etc';
      expect(isSafeIdentifier(huge)).toBe(false);
    });
  });

  describe('类型与空值防御', () => {
    it('非字符串类型被拒绝', () => {
      expect(isSafeIdentifier(null)).toBe(false);
      expect(isSafeIdentifier(undefined)).toBe(false);
      expect(isSafeIdentifier(123)).toBe(false);
      expect(isSafeIdentifier({})).toBe(false);
      expect(isSafeIdentifier(['arr'])).toBe(false);
      expect(isSafeIdentifier(true)).toBe(false);
    });

    it('空字符串被拒绝', () => {
      expect(isSafeIdentifier('')).toBe(false);
    });

    // 类型守卫：isSafeIdentifier 返回 true 后 id 应收窄为 string
    it('类型守卫收窄为 string', () => {
      const input: unknown = 'safe-id';
      if (isSafeIdentifier(input)) {
        // 此处 input 应为 string 类型（编译期校验）
        expect(input.toUpperCase()).toBe('SAFE-ID');
      } else {
        expect.unreachable('should be safe identifier');
      }
    });
  });

  describe('路径穿越字符防御', () => {
    it('含 .. 被拒绝', () => {
      expect(isSafeIdentifier('../etc/passwd')).toBe(false);
      expect(isSafeIdentifier('foo..bar')).toBe(false);
      expect(isSafeIdentifier('..')).toBe(false);
    });

    it('含 / 被拒绝', () => {
      expect(isSafeIdentifier('foo/bar')).toBe(false);
      expect(isSafeIdentifier('/etc/passwd')).toBe(false);
      expect(isSafeIdentifier('foo/')).toBe(false);
    });

    it('含 \\ 被拒绝', () => {
      expect(isSafeIdentifier('foo\\bar')).toBe(false);
      expect(isSafeIdentifier('C:\\Windows')).toBe(false);
    });

    it('含空字节 \\0 被拒绝', () => {
      expect(isSafeIdentifier('foo\0bar')).toBe(false);
      expect(isSafeIdentifier('\0')).toBe(false);
    });

    it('混合路径穿越字符全部被拒绝', () => {
      expect(isSafeIdentifier('../../etc/passwd')).toBe(false);
      expect(isSafeIdentifier('..\\..\\windows\\system32')).toBe(false);
      expect(isSafeIdentifier('foo/../bar')).toBe(false);
    });
  });
});

describe('isValidProjectFileData（轻量回归）', () => {
  // 此处仅做最小覆盖，完整用例由 projectFile.logic.test.ts 维护
  it('合法 project 对象 + 6 数组字段通过', () => {
    expect(isValidProjectFileData({
      project: { id: 'p1' },
      chapters: [],
      characters: [],
      settingCategories: [],
      settingItems: [],
      foreshadows: [],
      materials: [],
      versions: {},
    })).toBe(true);
  });

  it('非对象被拒绝', () => {
    expect(isValidProjectFileData(null)).toBe(false);
    expect(isValidProjectFileData('string')).toBe(false);
    expect(isValidProjectFileData([])).toBe(false);
  });

  it('project 字段缺失被拒绝', () => {
    expect(isValidProjectFileData({ chapters: [] })).toBe(false);
  });

  it('6 个数组字段任一缺失被拒绝', () => {
    expect(isValidProjectFileData({
      project: { id: 'p1' },
      chapters: 'not-array',
      characters: [],
      settingCategories: [],
      settingItems: [],
      foreshadows: [],
      materials: [],
    })).toBe(false);
  });
});
