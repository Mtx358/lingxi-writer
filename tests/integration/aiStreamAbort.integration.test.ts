/**
 * 流程 2：AI 流式生成中断集成测试
 *
 * 验证完整的 store → aiService → llmClient → fetch → AbortController → handler 回环：
 *   1. 配置 AI settings（store.updateAISettings + aiService.updateSettings）
 *   2. 触发流式生成
 *   3. 中途 abort（AbortController.abort）
 *   4. 断言：handler 在 abort 前收到部分 chunk，abort 后不再被调用；onComplete 走 abort 路径
 *   5. 断言：abortController 已 aborted；可立即重新触发生成（llmClient 无残留状态）
 *
 * 覆盖两条流式路径：
 *   - mock provider：aiService 内部分块生成（不调用 fetch），用于验证 aiService 层的 abort
 *   - openai provider + mock fetch SSE：验证 llmClient.callLLMStream 的 fetch 流式 abort
 *
 * Mock 策略（最小化）：
 *   - 不 mock @/utils/aiService / @/utils/llmClient：跑真实实现
 *   - mock globalThis.fetch：返回可控的 ReadableStream SSE
 *   - mock @/utils/storage：仅用于 store.updateAISettings 的持久化（settings 落到内存）
 *   - 真实 useAppStore 单例：updateAISettings → store.aiSettings 真实更新
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import { aiService, type StreamHandler } from '@/utils/aiService';
import { llmClient } from '@/utils/llmClient';
import type { Character, Project } from '@/types';

// ============ storage mock（仅供 store.updateAISettings 持久化使用）============
const { memoryStore, mockStorage } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();
  const mockStorage = {
    get: vi.fn(async <T>(key: string, defaultValue: T): Promise<T> => {
      return memoryStore.has(key) ? (memoryStore.get(key) as T) : defaultValue;
    }),
    set: vi.fn(async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value);
    }),
    remove: vi.fn(async (key: string): Promise<void> => { memoryStore.delete(key); }),
    patchProjects: vi.fn(async (op: { type: 'add'; project: Project } | { type: 'remove'; id: string } | { type: 'update'; project: Project } | { type: 'clear' }): Promise<Project[] | null> => {
      const cur = (memoryStore.get('projects') as Project[]) || [];
      let next = cur;
      if (op.type === 'add') next = cur.some(p => p.id === op.project.id) ? cur.map(p => (p.id === op.project.id ? op.project : p)) : [...cur, op.project];
      else if (op.type === 'remove') next = cur.filter(p => p.id !== op.id);
      else if (op.type === 'update') next = cur.some(p => p.id === op.project.id) ? cur.map(p => (p.id === op.project.id ? { ...p, ...op.project } : p)) : [...cur, op.project];
      else next = [];
      memoryStore.set('projects', next);
      return next;
    }),
    readProjectFile: vi.fn().mockResolvedValue(null),
    writeProjectFile: vi.fn().mockResolvedValue(false),
    backupProjectFile: vi.fn().mockResolvedValue(false),
    listBackups: vi.fn().mockResolvedValue([]),
    restoreBackup: vi.fn().mockResolvedValue(false),
    openFileDialog: vi.fn().mockResolvedValue(null),
    saveFileDialog: vi.fn().mockResolvedValue(null),
    checkForRecovery: vi.fn().mockResolvedValue(null),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    loadRecoveryDraft: vi.fn().mockResolvedValue(null),
    clearRecoveryDraft: vi.fn().mockResolvedValue(undefined),
    saveAISettings: vi.fn().mockResolvedValue(true),
    loadAISettings: vi.fn().mockResolvedValue(null),
  };
  return { memoryStore, mockStorage };
});

vi.mock('@/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    storage: mockStorage,
    markDirty: vi.fn(),
    triggerSave: vi.fn(async () => {}),
    clearAutoSaveTimer: vi.fn(),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// ============ fetch mock：可控 SSE 流 ============
// 默认 fetch 占位；具体测试在用例内通过 mockFetch.mockImplementation 覆盖
const mockFetch = vi.fn();
// 保存原始 proxyStream 引用，测试后恢复
let originalProxyStream: unknown;
beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  // callLLMStream 会优先走 window.electronAPI.ai.proxyStream（Electron IPC 代理）路径，
  // 而非 fetch。为测试 fetch SSE 流式路径，临时移除 proxyStream，模拟 Web 环境
  originalProxyStream = window.electronAPI?.ai?.proxyStream;
  if (window.electronAPI?.ai) {
    // @ts-expect-error 测试中临时清除 IPC 代理方法
    delete window.electronAPI.ai.proxyStream;
  }
});
afterEach(() => {
  // 恢复 proxyStream，避免影响其他测试
  if (window.electronAPI?.ai) {
    // @ts-expect-error 测试恢复
    window.electronAPI.ai.proxyStream = originalProxyStream;
  }
  vi.restoreAllMocks();
});

const EMPTY_STORE_STATE = {
  projects: [] as Project[],
  currentProjectId: null as string | null,
  currentProjectFilePath: null as string | null,
  lastSavedAt: null as string | null,
  isSaving: false,
  chapters: [],
  currentChapterId: null as string | null,
  aiSettings: { ...DEFAULT_AI_SETTINGS },
};

beforeEach(() => {
  memoryStore.clear();
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  mockStorage.saveAISettings.mockClear();
  mockStorage.loadAISettings.mockClear();
  useAppStore.setState(EMPTY_STORE_STATE);
});

// ============ fixture ============
function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'proj-1',
    name: '林墨',
    role: 'protagonist',
    color: '#000',
    profile: { personality: '冷静', background: '侦探' },
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// 构造一个返回 SSE 流的 fetch Response：每个 chunk 之间插入 microtask 延迟，
// 让 AbortController.abort() 有机会在 chunk 之间介入
function makeSSEStreamResponse(chunks: string[], opts?: { delayMs?: number }): Response {
  const encoder = new TextEncoder();
  const delayMs = opts?.delayMs ?? 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        // 让 abort 信号有机会在 chunk 之间生效
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
      }
      // flush [DONE]
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, statusText: 'OK' });
}

describe('流程 2：AI 流式生成中断', () => {
  it('mock provider：abort 在 chunk 之间生效 → 不再有 onChunk 调用、不触发 onComplete', async () => {
    // 通过 store 配置 aiSettings（模拟用户在设置面板配置 mock provider）
    await useAppStore.getState().updateAISettings({ provider: 'mock', style: 'balanced' });
    // store → aiService 同步（与 useEditorAI 调用路径一致）
    aiService.updateSettings(useAppStore.getState().aiSettings);

    const characters = [makeCharacter()];
    const abortController = new AbortController();
    const chunks: string[] = [];
    const handler: StreamHandler = {
      onChunk: (c: string) => {
        chunks.push(c);
        // 收到第 2 个 chunk 后立即 abort
        if (chunks.length >= 2) {
          abortController.abort();
        }
      },
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    // 触发流式生成：mock provider 内部用 llmClient.delay(50+) 制造 chunk 间隔
    const result = await aiService.generateContinuationStream(
      '他走进了房间。',
      '章节摘要',
      characters,
      'balanced',
      handler,
      abortController.signal,
    );

    // abort 后不会再有新 chunk（mock provider for 循环 break）
    const chunkCountAtAbort = chunks.length;
    expect(chunkCountAtAbort).toBeGreaterThanOrEqual(1);
    expect(chunkCountAtAbort).toBeLessThanOrEqual(2);

    // onComplete 在 abort 路径下不被调用（mock provider 显式 return 不回调）
    expect(handler.onComplete).not.toHaveBeenCalled();
    expect(handler.onError).not.toHaveBeenCalled();

    // signal 已 aborted
    expect(abortController.signal.aborted).toBe(true);

    // 返回值是已生成的部分内容（abort 后保留部分结果）
    expect(typeof result).toBe('string');
  });

  it('mock provider：abort 后可立即重新触发生成（llmClient 无残留状态）', async () => {
    await useAppStore.getState().updateAISettings({ provider: 'mock', style: 'balanced' });
    aiService.updateSettings(useAppStore.getState().aiSettings);

    const characters = [makeCharacter()];

    // 第一次：触发并 abort
    const ac1 = new AbortController();
    const chunks1: string[] = [];
    const handler1: StreamHandler = {
      onChunk: (c: string) => {
        chunks1.push(c);
        if (chunks1.length >= 1) ac1.abort();
      },
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    await aiService.generateContinuationStream('他走进了房间。', '', characters, 'balanced', handler1, ac1.signal);
    expect(ac1.signal.aborted).toBe(true);

    // 第二次：用全新的 AbortController 立即重新触发，应该正常完成
    const ac2 = new AbortController();
    const chunks2: string[] = [];
    let onComplete2Called = false;
    const handler2: StreamHandler = {
      onChunk: (c: string) => { chunks2.push(c); },
      onComplete: () => { onComplete2Called = true; },
      onError: vi.fn(),
    };
    await aiService.generateContinuationStream('他走进了房间。', '', characters, 'balanced', handler2, ac2.signal);

    // 第二次生成完整完成：onChunk 被调用，onComplete 被调用，signal 未 aborted
    expect(chunks2.length).toBeGreaterThan(0);
    expect(onComplete2Called).toBe(true);
    expect(ac2.signal.aborted).toBe(false);

    // 第二次的 chunks 数量应严格大于第一次（第一次被 abort 截断）
    expect(chunks2.length).toBeGreaterThan(chunks1.length);
  });

  it('openai provider：fetch SSE 流中 abort → 仅收到部分 chunk、onComplete 走 abort 路径', async () => {
    // 通过 store 配置 openai provider（mock fetch 模拟真实 SSE 流）
    await useAppStore.getState().updateAISettings({
      provider: 'openai',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      style: 'balanced',
    });
    aiService.updateSettings(useAppStore.getState().aiSettings);

    // 准备 5 个 chunk，每个间隔 30ms，让 abort 有机会在第 2 个 chunk 后介入
    const plannedChunks = ['第一段', '第二段', '第三段', '第四段', '第五段'];
    mockFetch.mockResolvedValue(makeSSEStreamResponse(plannedChunks, { delayMs: 30 }));

    const abortController = new AbortController();
    const receivedChunks: string[] = [];
    const handler: StreamHandler = {
      onChunk: (c: string) => {
        receivedChunks.push(c);
        // 收到第 2 个 chunk 后 abort
        if (receivedChunks.length >= 2) {
          abortController.abort();
        }
      },
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    // 直接调 llmClient.callLLMStream（跳过 aiService 的 humanize 包装，专注 fetch 路径）
    await llmClient.callLLMStream('续写：', 'system prompt', handler, abortController.signal);

    // 断言：只收到部分 chunk（abort 后流被取消，后续 chunk 不再 onChunk）
    expect(receivedChunks.length).toBeGreaterThanOrEqual(1);
    expect(receivedChunks.length).toBeLessThan(plannedChunks.length);

    // abort 路径：onComplete 被调用（用已收到的部分内容），onError 不被调用
    expect(handler.onComplete).toHaveBeenCalledTimes(1);
    expect(handler.onError).not.toHaveBeenCalled();

    // signal 已 aborted
    expect(abortController.signal.aborted).toBe(true);

    // fetch 被调用过一次
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('openai provider：abort 后可立即重新触发 fetch 流式生成', async () => {
    await useAppStore.getState().updateAISettings({
      provider: 'openai',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
    });
    aiService.updateSettings(useAppStore.getState().aiSettings);

    // 第一次：mock fetch 返回慢流，触发 abort
    const planned1 = ['A1', 'A2', 'A3', 'A4', 'A5'];
    mockFetch.mockResolvedValueOnce(makeSSEStreamResponse(planned1, { delayMs: 30 }));

    const ac1 = new AbortController();
    const received1: string[] = [];
    const handler1: StreamHandler = {
      onChunk: (c: string) => {
        received1.push(c);
        if (received1.length >= 1) ac1.abort();
      },
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    await llmClient.callLLMStream('p', 's', handler1, ac1.signal);
    expect(ac1.signal.aborted).toBe(true);
    expect(received1.length).toBeLessThan(planned1.length);

    // 第二次：全新的 fetch 流，应该完整跑完
    const planned2 = ['B1', 'B2'];
    mockFetch.mockResolvedValueOnce(makeSSEStreamResponse(planned2, { delayMs: 5 }));

    const ac2 = new AbortController();
    const received2: string[] = [];
    let complete2Called = false;
    let complete2Content = '';
    const handler2: StreamHandler = {
      onChunk: (c: string) => { received2.push(c); },
      onComplete: (full: string) => { complete2Called = true; complete2Content = full; },
      onError: vi.fn(),
    };
    await llmClient.callLLMStream('p', 's', handler2, ac2.signal);

    // 第二次完整完成
    expect(received2.length).toBe(planned2.length);
    expect(complete2Called).toBe(true);
    expect(complete2Content).toBe(planned2.join(''));
    expect(ac2.signal.aborted).toBe(false);
  });

  it('abort 前的 chunk 保留 → 重新触发生成不会插入上次残留 chunk', async () => {
    // 验证 "无残留 chunk"：连续两次生成，第二次的内容不应包含第一次的部分 chunk
    await useAppStore.getState().updateAISettings({ provider: 'mock', style: 'balanced' });
    aiService.updateSettings(useAppStore.getState().aiSettings);
    const characters = [makeCharacter()];

    // 第一次：在第 1 个 chunk 后 abort
    const ac1 = new AbortController();
    const chunks1: string[] = [];
    await aiService.generateContinuationStream('他走进了房间。', '', characters, 'balanced', {
      onChunk: (c: string) => { chunks1.push(c); if (chunks1.length >= 1) ac1.abort(); },
      onComplete: vi.fn(),
      onError: vi.fn(),
    }, ac1.signal);

    // 第二次：完整跑完
    const ac2 = new AbortController();
    const chunks2: string[] = [];
    let fullContent2 = '';
    await aiService.generateContinuationStream('他走进了房间。', '', characters, 'balanced', {
      onChunk: (c: string) => { chunks2.push(c); },
      onComplete: (full: string) => { fullContent2 = full; },
      onError: vi.fn(),
    }, ac2.signal);

    // 第二次的内容是完整的 generateSmartContinuation 结果，不应包含第一次的部分 chunk
    // （即 chunks2 拼接后等于 fullContent2，不应包含 chunks1 的内容片段作为前缀）
    const joined2 = chunks2.join('');
    expect(joined2).toBe(fullContent2);

    // 第二次的第一个 chunk 不应等于"第一次的所有 chunk 拼接"（排除残留）
    // 注：mock provider 的第一个 chunk 通常是 <p> 标签开头，与第一次相同是正常的；
    // 这里验证的是 "拼接结果等于 onComplete 给出的内容"，即没有遗漏或额外拼接
    expect(fullContent2.length).toBeGreaterThan(0);
  });
});
