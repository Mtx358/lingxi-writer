/**
 * src/utils/aiService/core.ts 单元测试
 *
 * 测试目标：
 *   - setLLMClient dev-only 守卫（A2 安全加固）
 *     - 开发/测试环境：注入新 client 后 getLLMClient 立即返回新实例
 *     - 生产环境（DEV=false 且 MODE!=test）：no-op + console.warn，不替换 client
 *     - client=null 视为"重置为默认单例"
 *   - getLLMClient 默认返回 llmClient 单例
 *   - parseJsonFromLLM：直接 parse / extractBalancedJson 回退 / 边界条件
 *
 * 注意：humanizeWithAITraceCheck 已由 aiService.test.ts 端到端覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLLMClient, getLLMClient, parseJsonFromLLM } from './core';
import { llmClient, LLMClient } from '../llmClient';

describe('setLLMClient / getLLMClient', () => {
  afterEach(() => {
    // 恢复默认 client，避免污染后续测试
    setLLMClient(llmClient);
    // 恢复 stubEnv（vi.unstubAllEnvs 清除所有 stub）
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('默认状态', () => {
    it('getLLMClient 默认返回 llmClient 单例', () => {
      expect(getLLMClient()).toBe(llmClient);
    });

    it('getLLMClient 返回 LLMClient 实例', () => {
      expect(getLLMClient()).toBeInstanceOf(LLMClient);
    });
  });

  describe('dev/test 环境注入（守卫放行）', () => {
    beforeEach(() => {
      // 显式声明 dev 环境（vitest 默认即此状态）
      vi.stubEnv('DEV', true);
      vi.stubEnv('MODE', 'test');
    });

    it('注入 mock client 后 getLLMClient 返回该实例', () => {
      const mockClient = {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
      } as unknown as LLMClient;
      setLLMClient(mockClient);
      expect(getLLMClient()).toBe(mockClient);
    });

    it('注入真实 LLMClient 实例后可正常调用其方法', () => {
      const fresh = new LLMClient();
      fresh.updateSettings({ provider: 'openai', apiKey: 'sk-test' });
      setLLMClient(fresh);
      expect(getLLMClient().getSettings().provider).toBe('openai');
    });

    it('client=null 重置为默认单例', () => {
      // 先注入一个 mock，再用 null 复位
      const mockClient = { foo: 'bar' } as unknown as LLMClient;
      setLLMClient(mockClient);
      expect(getLLMClient()).toBe(mockClient);
      setLLMClient(null);
      expect(getLLMClient()).toBe(llmClient);
    });

    it('多次注入不同 client 每次立即生效', () => {
      const a = { id: 'a' } as unknown as LLMClient;
      const b = { id: 'b' } as unknown as LLMClient;
      setLLMClient(a);
      expect(getLLMClient()).toBe(a);
      setLLMClient(b);
      expect(getLLMClient()).toBe(b);
    });
  });

  describe('生产环境守卫（A2 安全加固）', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // 模拟生产构建：DEV=false, MODE='production'
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', 'production');
    });

    it('生产环境注入 client 不生效（getLLMClient 仍返回默认）', () => {
      const mockClient = { evil: true } as unknown as LLMClient;
      setLLMClient(mockClient);
      // client 未被替换
      expect(getLLMClient()).not.toBe(mockClient);
      expect(getLLMClient()).toBe(llmClient);
    });

    it('生产环境注入 client 触发 console.warn 告警', () => {
      const mockClient = { evil: true } as unknown as LLMClient;
      setLLMClient(mockClient);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('setLLMClient');
      expect(warnSpy.mock.calls[0][0]).toContain('development');
    });

    it('生产环境传入 null 也不生效（守卫在 null 处理之前）', () => {
      setLLMClient(null);
      // 仍应触发告警
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // client 未被替换
      expect(getLLMClient()).toBe(llmClient);
    });

    it('生产环境多次调用均被守卫拦截', () => {
      const mock1 = { a: 1 } as unknown as LLMClient;
      const mock2 = { b: 2 } as unknown as LLMClient;
      setLLMClient(mock1);
      setLLMClient(mock2);
      setLLMClient(null);
      expect(warnSpy).toHaveBeenCalledTimes(3);
      expect(getLLMClient()).toBe(llmClient);
    });
  });

  describe('MODE=test 兜底（DEV 未注入但 MODE=test）', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // 模拟 DEV 未注入但 MODE=test 的环境（某些 CI 可能出现）
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', 'test');
    });

    it('MODE=test 时即使 DEV=false 也允许注入', () => {
      const mockClient = { test: true } as unknown as LLMClient;
      setLLMClient(mockClient);
      expect(getLLMClient()).toBe(mockClient);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('MODE=test 时 null 重置仍生效', () => {
      const mockClient = { test: true } as unknown as LLMClient;
      setLLMClient(mockClient);
      setLLMClient(null);
      expect(getLLMClient()).toBe(llmClient);
    });
  });
});

// ============ parseJsonFromLLM 测试 ============
// 覆盖 extractBalancedJson 回退路径（core.ts 行 96-108, 124-128）
// aiService.test.ts 仅测试 mock provider 路径（JSON 可直接 parse），
// 未覆盖 LLM 返回带噪声文本的 JSON（需 extractBalancedJson 提取）
describe('parseJsonFromLLM', () => {
  it('直接 parse 成功：合法 JSON 字符串', () => {
    const result = parseJsonFromLLM('{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('直接 parse 成功：合法 JSON 数组', () => {
    const result = parseJsonFromLLM('[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('带前后噪声文本 → extractBalancedJson 回退提取 JSON 对象', () => {
    const noisy = '好的，这是结果：\n{"name":"test","value":42}\n希望满意';
    const result = parseJsonFromLLM<{ name: string; value: number }>(noisy);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('带前后噪声文本 → extractBalancedJson 回退提取 JSON 数组', () => {
    const noisy = '以下是建议：\n[{"id":1},{"id":2}]\n以上';
    const result = parseJsonFromLLM<Array<{ id: number }>>(noisy);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('嵌套结构：extractBalancedJson 正确处理嵌套括号', () => {
    const nested = '结果：{"outer":{"inner":[1,2,{"deep":3}]}}结束';
    const result = parseJsonFromLLM<{ outer: { inner: unknown[] } }>(nested);
    expect(result).toEqual({ outer: { inner: [1, 2, { deep: 3 }] } });
  });

  it('字符串内含括号字符：不计入深度计数', () => {
    // 字符串内的 ] 和 } 不应被误认为闭合括号
    const tricky = '前缀{"text":"包含]和}字符"}后缀';
    const result = parseJsonFromLLM<{ text: string }>(tricky);
    expect(result).toEqual({ text: '包含]和}字符' });
  });

  it('转义字符：字符串内的 " 不翻转 inString 状态', () => {
    const escaped = '噪声{"text":"包含\\"引号"}噪声';
    const result = parseJsonFromLLM<{ text: string }>(escaped);
    expect(result).toEqual({ text: '包含"引号' });
  });

  it('转义反斜杠：\\\\ 不被误认为转义前缀', () => {
    const doubleSlash = '{"path":"C:\\\\Users\\\\test"}';
    const result = parseJsonFromLLM<{ path: string }>(doubleSlash);
    expect(result).toEqual({ path: 'C:\\Users\\test' });
  });

  it('无 JSON 结构 → 返回 null', () => {
    expect(parseJsonFromLLM('纯文本无JSON')).toBeNull();
    expect(parseJsonFromLLM('')).toBeNull();
    expect(parseJsonFromLLM('   ')).toBeNull();
  });

  it('未闭合 JSON → extractBalancedJson 返回 null → parseJsonFromLLM 返回 null', () => {
    expect(parseJsonFromLLM('{"key":"value"')).toBeNull();
    expect(parseJsonFromLLM('[1,2,3')).toBeNull();
  });

  it('提取后仍无法 parse 的片段 → 返回 null', () => {
    // 提取到 {[}] 这种语法合法但语义不合法的括号平衡片段
    expect(parseJsonFromLLM('{[}]')).toBeNull();
  });

  it('超长输入（>1MB）→ 直接返回 null（防 OOM）', () => {
    const huge = 'x'.repeat(1024 * 1024 + 1);
    expect(parseJsonFromLLM(huge)).toBeNull();
  });

  it('trim 后直接 parse 成功（前后空白）', () => {
    const result = parseJsonFromLLM('  \n  {"a":1}  \n  ');
    expect(result).toEqual({ a: 1 });
  });
});
