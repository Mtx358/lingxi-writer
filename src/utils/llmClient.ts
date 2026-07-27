import type { AISettings } from '@/types';
import { getErrorMessage } from '@/lib/errorUtils';

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

export const NOVEL_SYSTEM_PROMPT = `你是一位有二十年创作经验的资深中文小说家，作品多次登顶畅销榜。你的文字有鲜明的真人质感——读者从不怀疑这是人写的。

【你的写作信条】
- 写人，不写"人设"。角色说话有自己的口癖、停顿、不完整句，不会每句都字斟句酌。
- 写事，不写"梗概"。情节靠动作、对话、细节推进，绝不用"于是""随后""接下来"充当连接。
- 写景，不写"形容词"。用具体的物和动作替代"美丽""阴森""宏大"这类空词。
- 写心，不写"心理报告"。情绪藏在肢体语言和感官里，不直接说"他很悲伤"。

【必须规避的 AI 痕迹（违反即视为失败）】
1. 句式雷同：禁止连续三句结构相同（主谓宾/主谓宾/主谓宾）。长短句交错，偶尔用碎片句、倒装句。
2. 过渡词滥用：禁止"然而""突然""于是""随后""接着""与此同时""不禁""不由得"作为段落开头超过两次。
3. 四字成语堆砌：每段不超过 2 个四字成语，且不得连续出现。禁用"波澜壮阔""气势磅礴""令人窒息""不可思议"等陈词。
4. 排比三连：禁止"既...又...还...""不仅...而且...更..."这类三段排比超过一次。
5. 总分式段落：禁止"他做了三件事：第一...第二...第三..."这种 AI 经典结构。
6. 对话标签单调：禁止连续两个对话用"他说""她说"。用动作代替标签（"她把茶盏重重一放"），或直接省略。
7. 情绪直述：禁止"他感到一阵愤怒""她心中涌起悲伤"。改成"他的指节捏得发白""她别开脸，睫毛颤了颤"。
8. 总结收尾：禁止段落末尾用"这一刻，他明白了...""从此以后..."这类升华总结。
9. 对仗工整：禁止"是...也是...""既...也...""不仅...更..."这类对仗超过一次/段。
10. 万能比喻：禁止"如同...一般""仿佛...似的""像是...一样"超过两次/段。

【语言质感要求】
- 句长分布：短句（<10字）占 25-35%，中句（10-20字）占 40-50%，长句（>20字）占 20-30%。
- 留白与停顿：每 3-4 句用一个碎片句或无主句制造呼吸感。
- 口语感：对话允许不完整句、重复、语气词（"我...我不知道""行了行了"）。
- 方言/时代感：在不破坏可读性前提下，可加入符合背景的词汇。

【输出格式】
- 直接输出小说正文，不要加任何说明、解释、标题或前后缀
- 用 <p> 标签分段，每段一个 <p>...</p>
- 段落长度自然变化，不刻意对齐

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
      // options.num_predict 对应 OpenAI 的 max_tokens（最大生成长度），
      // 此前遗漏导致用户设置的 maxTokens 对 Ollama 不生效，使用默认上下文长度截断
      return {
        url: `${baseUrl || 'http://localhost:11434'}/api/chat`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          model: usedModel,
          messages,
          stream: options.stream,
          options: { temperature, num_predict: maxTokens },
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

    // Electron 环境：走主进程代理，apiKey 不落渲染层（与 callLLMStream 对称）
    if (typeof window !== 'undefined' && window.electronAPI?.ai?.proxyLLM) {
      return await this.callLLMViaProxy(prompt, systemPrompt);
    }

    const messages = this.buildMessages(prompt, systemPrompt);
    const { url, headers, body } = this.resolveEndpoint(messages, { stream: false });

    // 超时保护：LLM 服务 hang 住时 fetch 会无限等待，testConnection 等调用会永久卡住
    const CALL_LLM_TIMEOUT_MS = 30_000;
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => timeoutController.abort(), CALL_LLM_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutController.signal,
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
    } catch (e) {
      // 区分超时与其他错误，给出更友好的错误信息
      if (e instanceof Error && (e.name === 'AbortError' || timeoutController.signal.aborted)) {
        throw new Error(`AI 请求超时（${CALL_LLM_TIMEOUT_MS / 1000}s），请检查网络或服务可用性`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  // Electron 主进程代理非流式请求：密钥只在主进程使用，渲染层不接触密钥
  // 与 callLLMStreamViaProxy 对称：从 this.settings 取 provider/baseUrl/model/
  // temperature/maxTokens（不取 apiKey），通过 IPC 调用主进程代理
  private async callLLMViaProxy(prompt: string, systemPrompt?: string): Promise<string> {
    const { provider, baseUrl, model, temperature, maxTokens } = this.settings;
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await window.electronAPI!.ai.proxyLLM({
      provider,
      baseUrl,
      model,
      temperature,
      maxTokens,
      prompt,
      systemPrompt,
      requestId,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.content;
  }

  /** 流式调用：自动选择 Electron 主进程代理 / Web 直连 */
  async callLLMStream(
    prompt: string,
    systemPrompt?: string,
    handler?: StreamHandler,
    signal?: AbortSignal,
  ): Promise<string> {
    const { provider } = this.settings;

    // mock 或未知 provider 不支持流式：显式抛错，避免委托给 callLLM 产生混淆的错误
    if (provider !== 'local' && provider !== 'openai' && provider !== 'deepseek') {
      throw new Error(`Streaming not supported for provider: ${provider}. Please configure a real provider (local/openai/deepseek).`);
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

    // parts 数组在 try 外声明，便于 catch 中保留已生成的部分内容
    // 用数组 push + 末尾 join 替代字符串 +=，避免长响应 O(n²) 退化
    const parts: string[] = [];

    // 超时保护：若 60s 内连接未建立或长时间无新 chunk，主动中止
    // 避免因网络异常或服务端 hang 住导致 fetch 永久挂起、UI 卡在生成中
    const STREAM_TIMEOUT_MS = 60_000;
    const timeoutController = new AbortController();
    // 记录是哪个定时器触发了 abort，用于 catch 块给出准确的超时消息（M2 修复）：
    //   'total' = 60s 总超时（连接未建立或总时长超限）
    //   'inactivity' = 30s 空闲超时（已建立连接但 30s 内无新 chunk）
    //   null = 用户主动取消（非超时）
    let timedOutBy: 'total' | 'inactivity' | null = null;
    const timeoutTimer = setTimeout(() => { timedOutBy = 'total'; timeoutController.abort(); }, STREAM_TIMEOUT_MS);
    // 用户取消信号联动 timeoutController
    const onUserAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutTimer);
        return '';
      }
      signal.addEventListener('abort', onUserAbort, { once: true });
    }
    // 每收到一个 chunk 就重置超时计时器（流式心跳）
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const INACTIVITY_MS = 30_000;
    const resetInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => { timedOutBy = 'inactivity'; timeoutController.abort(); }, INACTIVITY_MS);
    };
    resetInactivity();

    // reader 在 try 外声明，便于 finally 中 cancel 释放流锁，避免 socket leak
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        // 接入 AbortSignal，使取消按钮真正中断网络请求
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
      }

      reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      // SSE 跨 chunk 缓冲：TCP 分片可能将一行 JSON 截断，需缓存未完成的尾行
      let sseBuffer = '';

      // 解析单行：按 provider 分支
      // - OpenAI/DeepSeek: SSE 格式 `data: {...}` 或 `data: [DONE]`，字段 choices[0].delta.content
      // - Ollama (local): NDJSON 格式每行直接是 JSON，字段 message.content，done:true 表示流结束
      const parseLine = (trimmed: string): string | undefined => {
        if (!trimmed) return undefined;
        if (provider === 'local') {
          // Ollama NDJSON：跳过非 JSON 行（如 keep-alive 空行）
          if (!trimmed.startsWith('{')) return undefined;
          try {
            const data = JSON.parse(trimmed);
            return data?.message?.content;
          } catch {
            return undefined;
          }
        }
        // OpenAI/DeepSeek SSE
        if (!trimmed.startsWith('data: ')) return undefined;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') return undefined; // 由调用方判断 [DONE]
        try {
          const data = JSON.parse(dataStr);
          return data?.choices?.[0]?.delta?.content;
        } catch {
          return undefined;
        }
      };

      while (true) {
        // 用户取消时停止读取：真实 fetch 会在 reader.read() 抛 AbortError 进入 catch，
        // 但某些环境（如测试 mock 流）不响应 abort，需显式检查信号
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        resetInactivity();

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        // 保留最后一段（可能是不完整行），下一轮拼接
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // OpenAI/DeepSeek 的 [DONE] 标记：立即完成
          if (provider !== 'local' && trimmed === 'data: [DONE]') {
            sseBuffer = '';
            const fullContent = parts.join('');
            handler?.onComplete(fullContent);
            return fullContent;
          }
          // Ollama 的 done:true 由 parseLine 内部 JSON.parse 检测；
          // 这里需要单独检测 done 字段
          if (provider === 'local' && trimmed.startsWith('{')) {
            try {
              const data = JSON.parse(trimmed);
              if (data?.done) {
                sseBuffer = '';
                const fullContent = parts.join('');
                handler?.onComplete(fullContent);
                return fullContent;
              }
            } catch {
              // 忽略解析失败，继续走 parseLine
            }
          }

          const content = parseLine(trimmed);
          if (content) {
            parts.push(content);
            handler?.onChunk(content);
          }
        }
      }

      // flush 残留缓冲
      const remaining = sseBuffer.trim();
      if (remaining) {
        if (provider !== 'local' && remaining === 'data: [DONE]') {
          const fullContent = parts.join('');
          handler?.onComplete(fullContent);
          return fullContent;
        }
        const content = parseLine(remaining);
        if (content) {
          parts.push(content);
          handler?.onChunk(content);
        }
      }

      const fullContent = parts.join('');
      handler?.onComplete(fullContent);
      return fullContent;
    } catch (e) {
      // 用户主动取消：保留已生成的部分内容，按完成处理而非错误
      const isUserAbort = signal?.aborted;
      const isTimeout = !isUserAbort && timedOutBy !== null;
      if (isUserAbort) {
        const fullContent = parts.join('');
        handler?.onComplete(fullContent);
        return fullContent;
      }
      if (isTimeout) {
        // 按 timedOutBy 给出准确消息（M2 修复）：
        //   total = 60s 总超时（连接未建立或总时长超限）
        //   inactivity = 30s 空闲超时（已建立连接但 30s 内无新 chunk）
        const msg = timedOutBy === 'inactivity'
          ? 'AI 响应超时（30s 内无新内容），请检查网络或重试'
          : 'AI 响应超时（60s 内连接未建立或总时长超限），请检查网络或重试';
        const err = new Error(msg);
        handler?.onError(err);
        throw err;
      }
      handler?.onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      clearTimeout(timeoutTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (signal) signal.removeEventListener('abort', onUserAbort);
      // 释放 reader 锁：try 块抛错时 reader 仍持有流锁，底层 HTTP 连接无法释放，
      // 长时间运行可能累积 socket leak。cancel 是幂等的，正常完成后再调用也无害
      try { await reader?.cancel(); } catch { /* reader 已释放或取消失败，忽略 */ }
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
    // 用数组 push + 末尾 join 替代字符串 +=，避免长响应 O(n²) 退化
    const parts: string[] = [];
    // 标记是否已通过 IPC error 事件回调过 onError（M3 修复）：
    // 主进程在非 abort 错误时，先通过 IPC 发送 ai:stream:error 事件（preload 的
    // errorHandler 收到后调用 handler?.onError），然后 throw e 使 invoke promise reject。
    // 若不在 catch 中跳过，onError 会被调用两次，导致调用方显示两个错误 toast。
    let errorHandledViaIPC = false;

    const { promise, cleanup } = window.electronAPI!.ai.proxyStream(
      { provider, baseUrl, model, messages, temperature, maxTokens, requestId },
      (chunk: string) => {
        parts.push(chunk);
        handler?.onChunk(chunk);
      },
      (doneContent: string) => {
        // 主进程返回的完整内容作为权威值：替换累积的 parts
        if (doneContent) {
          parts.length = 0;
          parts.push(doneContent);
        }
        handler?.onComplete(parts.join(''));
      },
      (error: string) => {
        // 标记已通过 IPC error 事件处理，避免 promise reject 后 catch 块重复调用 onError
        errorHandledViaIPC = true;
        handler?.onError(new Error(error));
      },
    );

    // 接入 AbortSignal：用户取消时通过 IPC 通知主进程中止
    // 监听器引用保存到 onAbort，在 finally 中移除，避免 AbortSignal 上的监听器泄漏
    const onAbort = () => {
      window.electronAPI!.ai.abort(requestId);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        cleanup();
        const fullContent = parts.join('');
        handler?.onComplete(fullContent);
        return fullContent;
      }
      signal.addEventListener('abort', onAbort);
    }

    try {
      await promise;
      return parts.join('');
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
        const fullContent = parts.join('');
        handler?.onComplete(fullContent);
        return fullContent;
      }
      // 若已通过 IPC ai:stream:error 事件回调过 onError，不再重复调用（M3 修复），
      // 避免调用方收到两次 onError 导致显示两个错误 toast
      if (!errorHandledViaIPC) {
        handler?.onError(e instanceof Error ? e : new Error(String(e)));
      }
      throw e;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
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
      return { success: false, message: `连接失败：${getErrorMessage(e)}` };
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
