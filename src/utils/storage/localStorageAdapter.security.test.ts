/**
 * src/utils/storage/localStorageAdapter.ts 安全加固单元测试（A3）
 *
 * 测试目标：Web 环境 apiKey SubtleCrypto 加固
 *   - 加密 round-trip：save → load 返回原 apiKey
 *   - localStorage 中 apiKey 不再是明文（密文 + _apiKeyEncrypted 标记）
 *   - 随机 IV：同一 apiKey 多次 save 产生不同密文
 *   - 设备指纹变更后解密失败 → 清空 apiKey（不抛错）
 *   - 密文被篡改 → AES-GCM 认证失败 → 清空 apiKey
 *   - SubtleCrypto 不可用 → 降级到明文存储（round-trip 仍正确）
 *   - 空 apiKey 不触发加密（直接明文存储空字符串）
 *
 * 测试策略：
 *   - 直接 new LocalStorage() 测试 web 后端
 *   - 通过 localStorage 读取原始存储值验证加密标记与密文格式
 *   - 通过 Object.defineProperty 临时移除 crypto.subtle 模拟降级环境
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalStorage } from './localStorageAdapter';

// toast 被 localStorageAdapter 顶层 import，mock 避免控制台噪声
const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast', () => ({ toast: toastMock }));

describe('LocalStorage apiKey 加固（A3）', () => {
  let store: LocalStorage;

  beforeEach(() => {
    localStorage.clear();
    store = new LocalStorage();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('加密 round-trip', () => {
    it('save → load 返回原 apiKey（SubtleCrypto 可用）', async () => {
      const settings = {
        apiKey: 'sk-test-abc123-xyz',
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2000,
      };
      await store.saveAISettings(settings);
      const loaded = await store.loadAISettings();
      expect(loaded).not.toBeNull();
      expect(loaded!.apiKey).toBe('sk-test-abc123-xyz');
      // 其他字段不受加密影响
      expect(loaded!.provider).toBe('openai');
      expect(loaded!.model).toBe('gpt-4o-mini');
    });

    it('长 apiKey（100 字符）round-trip 正确', async () => {
      const longKey = 'sk-' + 'a'.repeat(100);
      await store.saveAISettings({
        apiKey: longKey,
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const loaded = await store.loadAISettings();
      expect(loaded!.apiKey).toBe(longKey);
    });

    it('含 Unicode 字符的 apiKey round-trip 正确', async () => {
      const unicodeKey = 'sk-中文-日本語-한국어-🔑';
      await store.saveAISettings({
        apiKey: unicodeKey,
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const loaded = await store.loadAISettings();
      expect(loaded!.apiKey).toBe(unicodeKey);
    });

    it('多次 save/load 循环均正确', async () => {
      const keys = ['sk-1', 'sk-2-very-long-key-for-testing', 'sk-3-unicode-中文'];
      for (const k of keys) {
        await store.saveAISettings({
          apiKey: k,
          provider: 'openai',
          baseUrl: '',
          model: '',
          temperature: 0.7,
          maxTokens: 2000,
        });
        const loaded = await store.loadAISettings();
        expect(loaded!.apiKey).toBe(k);
      }
    });
  });

  describe('密文不暴露明文', () => {
    it('localStorage 中 apiKey 字段不是明文（与原 apiKey 不同）', async () => {
      const apiKey = 'sk-plaintext-should-not-leak-123';
      await store.saveAISettings({
        apiKey,
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const raw = localStorage.getItem('aiSettings');
      expect(raw).not.toBeNull();
      // 原始 localStorage 内容不应包含明文 apiKey
      expect(raw!).not.toContain(apiKey);
      // 应包含 _apiKeyEncrypted 标记
      const parsed = JSON.parse(raw!);
      expect(parsed._apiKeyEncrypted).toBe(true);
      // apiKey 字段应为 base64 密文（含 IV 12 字节，长度 > 16）
      expect(typeof parsed.apiKey).toBe('string');
      expect(parsed.apiKey.length).toBeGreaterThan(16);
    });

    it('同一 apiKey 多次 save 产生不同密文（随机 IV）', async () => {
      const apiKey = 'sk-same-key-every-time';
      const settings = {
        apiKey,
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      };
      await store.saveAISettings(settings);
      const raw1 = JSON.parse(localStorage.getItem('aiSettings')!);

      // 重置设备指纹不影响（同一指纹每次加密 IV 不同 → 密文不同）
      await store.saveAISettings(settings);
      const raw2 = JSON.parse(localStorage.getItem('aiSettings')!);

      // 加密标记一致
      expect(raw2._apiKeyEncrypted).toBe(true);
      // 密文不同（IV 随机）
      expect(raw1.apiKey).not.toBe(raw2.apiKey);
      // 但都能正确解密回同一 apiKey
      const loaded = await store.loadAISettings();
      expect(loaded!.apiKey).toBe(apiKey);
    });
  });

  describe('设备指纹稳定性', () => {
    it('设备指纹生成后存 localStorage（lingxi_device_fp key）', async () => {
      expect(localStorage.getItem('lingxi_device_fp')).toBeNull();
      await store.saveAISettings({
        apiKey: 'sk-test',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const fp = localStorage.getItem('lingxi_device_fp');
      expect(fp).not.toBeNull();
      expect(fp!.length).toBeGreaterThan(10);
    });

    it('同一设备指纹下多次 save/load 一致', async () => {
      await store.saveAISettings({
        apiKey: 'sk-first',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const fpAfterFirst = localStorage.getItem('lingxi_device_fp');

      await store.saveAISettings({
        apiKey: 'sk-second',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const fpAfterSecond = localStorage.getItem('lingxi_device_fp');

      // 设备指纹不应改变
      expect(fpAfterFirst).toBe(fpAfterSecond);
    });
  });

  describe('解密失败容错', () => {
    it('设备指纹变更后解密失败 → apiKey 清空（不抛错）', async () => {
      await store.saveAISettings({
        apiKey: 'sk-original-key',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      // 模拟设备指纹变更（用户清了 lingxi_device_fp 但保留 aiSettings）
      localStorage.removeItem('lingxi_device_fp');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = await store.loadAISettings();
      // 解密失败应清空 apiKey，不抛错
      expect(loaded).not.toBeNull();
      expect(loaded!.apiKey).toBe('');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('密文被篡改 → AES-GCM 认证失败 → apiKey 清空', async () => {
      await store.saveAISettings({
        apiKey: 'sk-original-key',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      // 篡改密文：把 apiKey 字段替换为非法 base64
      const raw = JSON.parse(localStorage.getItem('aiSettings')!);
      // 替换为同样长度但内容不同的 base64（保留 _apiKeyEncrypted=true）
      raw.apiKey = btoa('tampered-ciphertext-content-here');
      localStorage.setItem('aiSettings', JSON.stringify(raw));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = await store.loadAISettings();
      expect(loaded).not.toBeNull();
      expect(loaded!.apiKey).toBe('');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('密文 base64 格式损坏 → 解密失败 → apiKey 清空', async () => {
      await store.saveAISettings({
        apiKey: 'sk-original-key',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      // 写入非法 base64（含非 base64 字符）
      const raw = JSON.parse(localStorage.getItem('aiSettings')!);
      raw.apiKey = '!!!not-valid-base64!!!';
      localStorage.setItem('aiSettings', JSON.stringify(raw));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = await store.loadAISettings();
      expect(loaded!.apiKey).toBe('');
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('SubtleCrypto 降级', () => {
    // 临时移除 crypto.subtle 模拟 jsdom 未实现 SubtleCrypto 的环境
    let originalSubtle: SubtleCrypto | undefined;
    let originalDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalDescriptor = Object.getOwnPropertyDescriptor(crypto, 'subtle');
      originalSubtle = crypto.subtle;
    });

    afterEach(() => {
      // 恢复 crypto.subtle
      if (originalDescriptor) {
        Object.defineProperty(crypto, 'subtle', originalDescriptor);
      } else if (originalSubtle) {
        Object.defineProperty(crypto, 'subtle', { value: originalSubtle, writable: true, configurable: true });
      }
    });

    it('SubtleCrypto 不可用时降级到明文存储（round-trip 仍正确）', async () => {
      // 移除 crypto.subtle
      Object.defineProperty(crypto, 'subtle', { value: undefined, writable: true, configurable: true });

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const apiKey = 'sk-plaintext-fallback';
      await store.saveAISettings({
        apiKey,
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });

      // 验证降级到明文：localStorage 中 apiKey 应为原值
      const raw = JSON.parse(localStorage.getItem('aiSettings')!);
      expect(raw.apiKey).toBe(apiKey);
      expect(raw._apiKeyEncrypted).toBeUndefined();

      // load 也走明文路径（_apiKeyEncrypted 未标记）
      const loaded = await store.loadAISettings();
      expect(loaded!.apiKey).toBe(apiKey);
      // 不应触发加密失败告警（apiKey 为空时不进入加密分支；非空时进入并降级）
      // 此处 apiKey 非空，加密应失败并降级，故有 warn
      // 但 load 路径无 _apiKeyEncrypted 标记，不会进入解密分支，无 warn
    });

    it('SubtleCrypto 不可用 + 已有加密数据 → load 清空 apiKey 让用户重输', async () => {
      // 先在 SubtleCrypto 可用时加密存储
      await store.saveAISettings({
        apiKey: 'sk-encrypted-then-downgrade',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const raw = JSON.parse(localStorage.getItem('aiSettings')!);
      expect(raw._apiKeyEncrypted).toBe(true);

      // 模拟 SubtleCrypto 变为不可用
      Object.defineProperty(crypto, 'subtle', { value: undefined, writable: true, configurable: true });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = await store.loadAISettings();
      // 已加密但无法解密 → 清空 apiKey
      expect(loaded!.apiKey).toBe('');
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('空 apiKey 不触发加密（直接明文存储空字符串）', async () => {
      await store.saveAISettings({
        apiKey: '',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const raw = JSON.parse(localStorage.getItem('aiSettings')!);
      expect(raw.apiKey).toBe('');
      expect(raw._apiKeyEncrypted).toBeUndefined();
      const loaded = await store.loadAISettings();
      expect(loaded!.apiKey).toBe('');
    });

    it('loadAISettings 无数据 → null', async () => {
      const loaded = await store.loadAISettings();
      expect(loaded).toBeNull();
    });

    it('loadAISettings JSON 损坏 → null', async () => {
      localStorage.setItem('aiSettings', '{invalid json');
      const loaded = await store.loadAISettings();
      expect(loaded).toBeNull();
    });

    it('loadAISettings 解析为非对象 → null', async () => {
      localStorage.setItem('aiSettings', '"a string"');
      const loaded = await store.loadAISettings();
      expect(loaded).toBeNull();
    });

    it('saveAISettings localStorage.setItem 抛错 → false', async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      const result = await store.saveAISettings({
        apiKey: 'sk-test',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      expect(result).toBe(false);
      setItemSpy.mockRestore();
    });

    it('loaded 结果不含 _apiKeyEncrypted 内部标记', async () => {
      await store.saveAISettings({
        apiKey: 'sk-test',
        provider: 'openai',
        baseUrl: '',
        model: '',
        temperature: 0.7,
        maxTokens: 2000,
      });
      const loaded = await store.loadAISettings();
      expect(loaded).not.toBeNull();
      expect(loaded).not.toHaveProperty('_apiKeyEncrypted');
    });
  });
});
