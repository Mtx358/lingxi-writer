import type { AISettings } from '@/types';

/**
 * LLM 请求公共层
 *
 * 此前 aiService.callLLM 与 aiService.callLLMStream 中存在大量重复的
 * 请求配置、模型映射、消息组装逻辑，统一抽离到 LLMClient：
 *   - buildMessages：消息组装
 *   - resolveModel：模型映射
 *   - resolveEndpoint：根据 provider 解析 URL + headers + body
 *   - callLLM / callLLMStream / callLLMStreamViaProxy：三种调用方式
 *
 * 同时维护 settings、tokens 计数与一些跨能力域复用的小工具
 * （ensureHtmlParagraphs / clampScore / delay）。
 */

export const NOVEL_SYSTEM_PROMPT = `你是一位资深的中文小说作家，擅长创作自然流畅、富有真人写作质感的小说文本。

写作要求：
1. 语言自然流畅，避免AI生成的痕迹（如过度华丽、堆砌辞藻、句式雷同）
2. 符合中文小说的叙事习惯，节奏有张有弛
3. 人物对话要符合角色性格，避免千人一面
4. 描写要具体、克制，多用细节而非形容词堆砌
5. 心理活动要真实，避免直白地说出情绪
6. 不要过度使用"然而"、"突然"等过渡词
7. 直接输出小说正文，不要加任何说明、解释、标题或前后缀
8. 用 <p> 标签分段，每段一个 <p>...</p>

【核心原则】必须严格延续当前故事：
- 完全延续当前章节的人称（第一人称/第三人称）、时态、语气
- 不得引入新的角色或设定，除非用户明确要求
- 保持当前场景/时间线/地点的连续性
- 角色行为必须符合已建立的性格特征
- 不得偏离当前章节的情节走向`;

export interface StreamHandler {
  onChunk: (chunk: string) => void;
  onComplete: (fullContent: string) => void;
  onError: (error: Error) => void;
}

const DEFAULT_LLM_SETTINGS: AISettings = {
  provider: 'mock',
  style: 'balanced',
  descriptionDensity: 50,
  dialogueDensity: 50,
  strictness: 50,
  temperature: 0.7,
  maxTokens: 2000,
  autoCheckConflicts: true,
};

// provider → 默认模型映射
const DEFAULT_MODEL_MAP: Partial<Record<AISettings['provider'], string>> = {
  local: 'qwen2.5:7b',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
};

interface ResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export class LLMClient {
  private settings: AISettings = { ...DEFAULT_LLM_SETTINGS };
  private totalTokensUsed = 0;

  updateSettings(settings: Partial<AISettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  getSettings(): AISettings {
    return { ...this.settings };
  }

  getTotalTokensUsed(): number {
    return this.totalTokensUsed;
  }

  // ==================== 消息与模型解析 ====================

  buildMessages(prompt: string, systemPrompt?: string): { role: string; content: string }[] {
    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  resolveModel(): string {
    const { provider, model } = this.settings;
    return model || DEFAULT_MODEL_MAP[provider] || 'gpt-4o-mini';
  }

  /**
   * 根据 provider 解析出请求 URL、headers、body。
   * 统一了原本散落在 callLLM / callLLMStream 中的重复配置逻辑。
   */
  private resolveEndpoint(
    messages: { role: string; content: string }[],
    options: { stream: boolean },
  ): ResolvedEndpoint {
    const { provider, baseUrl, apiKey, temperature, maxTokens } = this.settings;
    const usedModel = this.resolveModel();

    if (provider === 'local') {
      // Ollama 本地接口
      return {
        url: `${baseUrl || 'http://localhost:11434'}/api/chat`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          model: usedModel,
          messages,
          stream: options.stream,
          options: { temperature },
        },
      };
    }

    if (provider === 'openai' || provider === 'deepseek') {
      const defaultBaseUrl = provider === 'openai' ? 'https://api.openai.com' : 'https://api.deepseek.com';
      return {
        url: `${baseUrl || defaultBaseUrl}/v1/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey || ''}`,
        },
        body: {
          model: usedModel,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: options.stream,
        },
      };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  // ==================== 调用入口 ====================

  /** 非流式调用 */
  async callLLM(prompt: string, systemPrompt?: string): Promise<string> {
    const { provider } = this.settings;
    // mock 等未支持的 provider 不应进入此方法
    if (provider !== 'local' && provider !== 'openai' && provider !== 'deepseek') {
      throw new Error('Mock provider: should not call callLLM');
    }

    const messages = this.buildMessages(prompt, systemPrompt);
    const { url, headers, body } = this.resolveEndpoint(messages, { stream: false });

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${provider} API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    // Ollama: data.message.content；OpenAI/DeepSeek: data.choices[0].message.content
    const content = provider === 'local'
      ? data?.message?.content
      : data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${provider} API: empty content`);
    }
    return content as string;
  }

  /** 流式调用：自动选择 Electron 主进程代理 / Web 直连 */
  async callLLMStream(
    prompt: string,
    systemPrompt?: string,
    handler?: StreamHandler,
    signal?: AbortSignal,
  ): Promise<string> {
    const { provider } = this.settings;

    // mock 或未知 provider 走本地模拟（不涉及密钥，不需要代理）
    if (provider !== 'local' && provider !== 'openai' && provider !== 'deepseek') {
      return await this.callLLM(prompt, systemPrompt);
    }

    // Electron 环境：走主进程代理，密钥不落渲染层
    if (typeof window !== 'undefined' && window.electronAPI?.ai?.proxyStream) {
      return await this.callLLMStreamViaProxy(prompt, systemPrompt, handler, signal);
    }

    // Web 环境回退：直连，密钥暴露在渲染层（警示）
    if (typeof window !== 'undefined' && !window.electronAPI) {
      console.warn('[安全提示] Web 环境下 AI API 密钥将在浏览器中明文使用，生产环境建议使用 Electron 版本');
    }

    const messages = this.buildMessages(prompt, systemPrompt);
    const { url, headers, body } = this.resolveEndpoint(messages, { stream: true });

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // 接入 AbortSignal，使取消按钮真正中断网络请求
      signal,
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    // SSE 跨 chunk 缓冲：TCP 分片可能将一行 JSON 截断，需缓存未完成的尾行
    let sseBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        // 保留最后一段（可能是不完整行），下一轮拼接
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            sseBuffer = '';
            handler?.onComplete(fullContent);
            return fullContent;
          }

          try {
            const data = JSON.parse(dataStr);
            const content = data?.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              handler?.onChunk(content);
            }
          } catch {
            continue;
          }
        }
      }

      // flush 残留缓冲
      if (sseBuffer.trim().startsWith('data: ')) {
        const dataStr = sseBuffer.trim().slice(6);
        if (dataStr !== '[DONE]') {
          try {
            const data = JSON.parse(dataStr);
            const content = data?.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              handler?.onChunk(content);
            }
          } catch {
            // 忽略解析残留失败
          }
        }
      }

      handler?.onComplete(fullContent);
      return fullContent;
    } catch (e) {
      // 用户主动取消：保留已生成的部分内容，按完成处理而非错误
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
        handler?.onComplete(fullContent);
        return fullContent;
      }
      handler?.onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  // Electron 主进程代理流式请求：密钥只在主进程使用，渲染层不接触密钥
  private async callLLMStreamViaProxy(
    prompt: string,
    systemPrompt: string | undefined,
    handler: StreamHandler | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const { provider, baseUrl, model, temperature, maxTokens } = this.settings;
    const messages = this.buildMessages(prompt, systemPrompt);
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let fullContent = '';

    const { promise, cleanup } = window.electronAPI!.ai.proxyStream(
      { provider, baseUrl, model, messages, temperature, maxTokens, requestId },
      (chunk: string) => {
        fullContent += chunk;
        handler?.onChunk(chunk);
      },
      (doneContent: string) => {
        // 主进程返回的完整内容作为权威值
        if (doneContent) fullContent = doneContent;
        handler?.onComplete(fullContent);
      },
      (error: string) => {
        handler?.onError(new Error(error));
      },
    );

    // 接入 AbortSignal：用户取消时通过 IPC 通知主进程中止
    if (signal) {
      if (signal.aborted) {
        window.electronAPI!.ai.abort(requestId);
        cleanup();
        handler?.onComplete(fullContent);
        return fullContent;
      }
      signal.addEventListener('abort', () => {
        window.electronAPI!.ai.abort(requestId);
      });
    }

    try {
      await promise;
      return fullContent;
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
        handler?.onComplete(fullContent);
        return fullContent;
      }
      handler?.onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      cleanup();
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (this.settings.provider === 'mock') {
      return { success: true, message: 'Mock 模式，无需测试连接' };
    }
    try {
      const result = await this.callLLM('请回复"连接成功"四个字。', '你是一个连接测试助手。');
      return { success: true, message: `连接成功：${result.slice(0, 50)}` };
    } catch (e) {
      return { success: false, message: `连接失败：${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ==================== 跨能力域复用的小工具 ====================

  /** 将裸文本规整为 <p> 包裹的 HTML；若已是 HTML 段落则原样返回 */
  ensureHtmlParagraphs(text: string): string {
    let trimmed = text.trim();
    trimmed = trimmed.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
    if (/<p[\s>]/.test(trimmed)) {
      return trimmed;
    }
    return trimmed
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => `<p>${line}</p>`)
      .join('');
  }

  /** 将任意值收敛到 0-100 的整数分数 */
  clampScore(v: unknown): number {
    const n = Number(v);
    if (isNaN(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const llmClient = new LLMClient();
