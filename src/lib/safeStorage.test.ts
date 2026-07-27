/**
 * safeStorage 单元测试
 *
 * 测试范围：
 *   - 正常路径：get/set/remove 读写删除成功
 *   - 异常路径：localStorage 抛错时 get 返回 null、set/remove 静默失败
 *   - 抛错场景：隐私模式 / 配额满 / 禁用存储
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
  safeLocalStorageRemove,
} from '@/lib/safeStorage';

describe('safeStorage', () => {
  let originalGetItem: typeof localStorage.getItem;
  let originalSetItem: typeof localStorage.setItem;
  let originalRemoveItem: typeof localStorage.removeItem;

  beforeEach(() => {
    originalGetItem = localStorage.getItem;
    originalSetItem = localStorage.setItem;
    originalRemoveItem = localStorage.removeItem;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.getItem = originalGetItem;
    localStorage.setItem = originalSetItem;
    localStorage.removeItem = originalRemoveItem;
    vi.restoreAllMocks();
  });

  // ============ 正常路径 ============
  it('safeLocalStorageGet 读取已存在键返回对应值', () => {
    localStorage.setItem('foo', 'bar');
    expect(safeLocalStorageGet('foo')).toBe('bar');
  });

  it('safeLocalStorageGet 读取不存在键返回 null', () => {
    expect(safeLocalStorageGet('missing')).toBeNull();
  });

  it('safeLocalStorageSet 写入键值对成功', () => {
    safeLocalStorageSet('k1', 'v1');
    expect(localStorage.getItem('k1')).toBe('v1');
  });

  it('safeLocalStorageSet 覆盖已有键值', () => {
    localStorage.setItem('k1', 'old');
    safeLocalStorageSet('k1', 'new');
    expect(localStorage.getItem('k1')).toBe('new');
  });

  it('safeLocalStorageRemove 删除已存在键', () => {
    localStorage.setItem('del', 'val');
    safeLocalStorageRemove('del');
    expect(localStorage.getItem('del')).toBeNull();
  });

  it('safeLocalStorageRemove 删除不存在键不抛错', () => {
    expect(() => safeLocalStorageRemove('never-exists')).not.toThrow();
  });

  // ============ 异常路径 ============
  it('getItem 抛错时 safeLocalStorageGet 返回 null', () => {
    localStorage.getItem = vi.fn(() => {
      throw new Error('SecurityError: Access denied');
    });
    expect(safeLocalStorageGet('any')).toBeNull();
  });

  it('getItem 抛非 Error 时 safeLocalStorageGet 仍返回 null', () => {
    localStorage.getItem = vi.fn(() => {
      throw '字符串错误';
    });
    expect(safeLocalStorageGet('any')).toBeNull();
  });

  it('setItem 抛错时 safeLocalStorageSet 静默失败（不抛出）', () => {
    localStorage.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => safeLocalStorageSet('k', 'v')).not.toThrow();
  });

  it('setItem 抛非 Error 时 safeLocalStorageSet 静默失败', () => {
    localStorage.setItem = vi.fn(() => {
      throw '字符串错误';
    });
    expect(() => safeLocalStorageSet('k', 'v')).not.toThrow();
  });

  it('removeItem 抛错时 safeLocalStorageRemove 静默失败（不抛出）', () => {
    localStorage.removeItem = vi.fn(() => {
      throw new Error('SecurityError');
    });
    expect(() => safeLocalStorageRemove('k')).not.toThrow();
  });

  it('removeItem 抛非 Error 时 safeLocalStorageRemove 静默失败', () => {
    localStorage.removeItem = vi.fn(() => {
      throw '字符串错误';
    });
    expect(() => safeLocalStorageRemove('k')).not.toThrow();
  });

  // ============ 集成场景 ============
  it('set 后 get 同一键可读回', () => {
    safeLocalStorageSet('round-trip', 'hello world');
    expect(safeLocalStorageGet('round-trip')).toBe('hello world');
  });

  it('set 后 remove 再 get 返回 null', () => {
    safeLocalStorageSet('temp', 'data');
    safeLocalStorageRemove('temp');
    expect(safeLocalStorageGet('temp')).toBeNull();
  });

  it('存储大对象 JSON 字符串往返一致', () => {
    const obj = { name: '灵犀', count: 100, nested: { a: [1, 2, 3] } };
    safeLocalStorageSet('json', JSON.stringify(obj));
    const got = safeLocalStorageGet('json');
    expect(got).not.toBeNull();
    expect(JSON.parse(got!)).toEqual(obj);
  });

  it('空字符串作为值时可正常存取', () => {
    safeLocalStorageSet('empty', '');
    expect(safeLocalStorageGet('empty')).toBe('');
  });

  it('空字符串作为键时可正常存取（localStorage 允许空键）', () => {
    safeLocalStorageSet('', 'empty-key-val');
    expect(safeLocalStorageGet('')).toBe('empty-key-val');
    safeLocalStorageRemove('');
    expect(safeLocalStorageGet('')).toBeNull();
  });
});
