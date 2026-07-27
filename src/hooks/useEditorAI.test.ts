/**
 * useEditorAI 单元测试
 *
 * 测试范围：
 *   - sanitizeAiHtml 纯函数：DOMPurify 消毒配置（允许标签/属性、剥离危险标签/事件/style）
 *   - useEditorAI Hook：
 *     · 初始返回值
 *     · abortGeneration：无操作/有请求中止/编辑器销毁/编辑器 null
 *     · handleContinue：前置 guard / 正常成功流 / onError 路径 / 用户 abort / 章节切换防串章
 *     · handlePolish：前置 guard / 选中文本替换 / 全章替换 / onError 跳过 saveVersion / 用户 abort
 *     · useEffect 卸载清理
 *
 * Mock 策略：
 *   - @/utils/aiService：mock aiService.updateSettings/generateContinuationStream/polishTextStream
 *   - @/store/useAppStore：mock useAppStore.getState() 返回 {characters, aiSettings, updateChapterContent}
 *   - @/hooks/useToast：mock toast.error
 *   - dompurify：使用真实实现（jsdom 环境 DOMPurify 可正常工作）
 *   - Tiptap Editor：构造链式 mock 对象（chain/commands/state/view）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useEditorAI, sanitizeAiHtml } from '@/hooks/useEditorAI';
import { aiService, type StreamHandler } from '@/utils/aiService';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/hooks/useToast';
import type { Chapter, AISettings } from '@/types';

// ============ AISettings fixture ============
function makeAISettings(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'mock',
    style: 'balanced',
    descriptionDensity: 50,
    dialogueDensity: 50,
    strictness: 50,
    temperature: 0.7,
    maxTokens: 2000,
    autoCheckConflicts: false,
    ...overrides,
  };
}

// ============ 模块级 mock ============
vi.mock('@/utils/aiService', () => ({
  aiService: {
    updateSettings: vi.fn(),
    generateContinuationStream: vi.fn().mockResolvedValue(''),
    polishTextStream: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      characters: [],
      aiSettings: { style: 'balanced' },
      updateChapterContent: vi.fn(),
    })),
  },
}));

vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ============ 测试 fixtures ============
function createEditorMock(opts?: {
  contentSize?: number;
  selection?: { from: number; to: number; empty: boolean };
  isDestroyed?: boolean;
  html?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  const chainReturn = {
    insertContentAt: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    focus: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    isDestroyed: opts?.isDestroyed ?? false,
    setEditable: vi.fn(),
    getHTML: vi.fn().mockReturnValue(opts?.html ?? '<p>mock html</p>'),
    chain: vi.fn(() => chainReturn),
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
    },
    state: {
      doc: {
        content: { size: opts?.contentSize ?? 100 },
        textBetween: vi.fn().mockReturnValue('selected text'),
      },
      selection: opts?.selection ?? { from: 0, to: 0, empty: true },
    },
    view: {
      dom: { scrollTop: 0, scrollHeight: 500 },
    },
    _chainReturn: chainReturn,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'proj-1',
    parentId: null,
    title: '第一章',
    summary: '章节摘要',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 1000,
    content: '<p>章节内容</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============ 公共 setup ============
beforeEach(() => {
  vi.clearAllMocks();
  // 默认：generateContinuationStream 和 polishTextStream 调用 onComplete 后返回
  vi.mocked(aiService.generateContinuationStream).mockImplementation(
    async (_ctx, _sum, _chars, _style, handler, _signal) => {
      handler?.onComplete('');
      return '';
    },
  );
  vi.mocked(aiService.polishTextStream).mockImplementation(
    async (_text, _style, handler, _signal) => {
      handler?.onComplete('');
      return '';
    },
  );
  vi.mocked(useAppStore.getState).mockReturnValue({
    characters: [],
    aiSettings: makeAISettings(),
    updateChapterContent: vi.fn(),
    // useEditorAI 仅使用上述 3 个字段；其余 AppState 字段在测试中不需要
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============ sanitizeAiHtml ============
describe('sanitizeAiHtml', () => {
  it('允许的标签通过（p/strong/em/a 等）', () => {
    const input = '<p>段落 <strong>加粗</strong> <em>斜体</em> <a href="https://example.com">链接</a></p>';
    const result = sanitizeAiHtml(input);
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
    expect(result).toContain('<a');
    expect(result).toContain('href="https://example.com"');
  });

  it('剥离 script 标签', () => {
    const input = '<p>正常</p><script>alert("xss")</script>';
    const result = sanitizeAiHtml(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('<p>正常</p>');
  });

  it('剥离 iframe 标签', () => {
    const input = '<p>正常</p><iframe src="https://evil.com"></iframe>';
    const result = sanitizeAiHtml(input);
    expect(result).not.toContain('<iframe');
    expect(result).toContain('<p>正常</p>');
  });

  it('剥离事件处理器（onclick/onerror）', () => {
    const input = '<p onclick="alert(1)">正常</p><img src="x" onerror="alert(1)">';
    const result = sanitizeAiHtml(input);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onerror');
  });

  it('剥离 style 属性', () => {
    const input = '<p style="color: red;">正常</p>';
    const result = sanitizeAiHtml(input);
    expect(result).not.toContain('style');
    expect(result).not.toContain('color:');
    expect(result).toContain('正常');
  });

  it('保留允许的属性（href/target/rel/class）', () => {
    const input = '<a href="https://example.com" target="_blank" rel="noopener" class="link">链接</a>';
    const result = sanitizeAiHtml(input);
    expect(result).toContain('href=');
    expect(result).toContain('target=');
    expect(result).toContain('rel=');
    expect(result).toContain('class=');
  });

  it('空字符串返回空字符串', () => {
    expect(sanitizeAiHtml('')).toBe('');
  });
});

// ============ useEditorAI 初始返回值 ============
describe('useEditorAI 初始返回值', () => {
  it('isGenerating 初始为 false，返回 4 个字段', () => {
    const editor = createEditorMock();
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    expect(result.current.isGenerating).toBe(false);
    expect(typeof result.current.handleContinue).toBe('function');
    expect(typeof result.current.handlePolish).toBe('function');
    expect(typeof result.current.abortGeneration).toBe('function');
  });
});

// ============ abortGeneration ============
describe('abortGeneration', () => {
  it('无进行中请求时为 noop（不抛错）', () => {
    const editor = createEditorMock();
    const isGeneratingRef = { current: false };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    expect(() => act(() => result.current.abortGeneration())).not.toThrow();
  });

  it('isGeneratingRef=true 时重置状态并恢复编辑器可编辑', () => {
    const editor = createEditorMock();
    // 初始为 false，避免被 useEffect 同步覆盖；挂载后再置 true 模拟生成中
    const isGeneratingRef = { current: false };
    const setAIGenerating = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion: vi.fn(),
      setAIGenerating,
    }));
    isGeneratingRef.current = true;

    act(() => result.current.abortGeneration());

    expect(editor.setEditable).toHaveBeenCalledWith(true);
    expect(setAIGenerating).toHaveBeenCalledWith(false);
    // isGenerating state 在 abortGeneration 中通过 setIsGenerating(false) 重置
    expect(result.current.isGenerating).toBe(false);
    // 注：isGeneratingRef.current 的同步由 useEffect 负责（见 isGeneratingRef 同步 专用测试），
    // 当 isGenerating state 因 bailout 未变化时 effect 不会重新触发，此处不验证 ref
  });

  it('编辑器已销毁时不调用 setEditable', () => {
    const editor = createEditorMock({ isDestroyed: true });
    const isGeneratingRef = { current: false };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));
    isGeneratingRef.current = true;

    act(() => result.current.abortGeneration());

    expect(editor.setEditable).not.toHaveBeenCalled();
  });

  it('编辑器为 null 时不调用 setEditable', () => {
    const isGeneratingRef = { current: false };
    const { result } = renderHook(() => useEditorAI({
      editor: null,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));
    isGeneratingRef.current = true;

    expect(() => act(() => result.current.abortGeneration())).not.toThrow();
  });
});

// ============ handleContinue 前置 guard ============
describe('handleContinue 前置 guard', () => {
  it('editor 为 null 时直接 return', async () => {
    const saveVersion = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor: null,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(saveVersion).not.toHaveBeenCalled();
    expect(aiService.generateContinuationStream).not.toHaveBeenCalled();
  });

  it('currentChapterId 为 null 时直接 return', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: null,
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: null },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(saveVersion).not.toHaveBeenCalled();
    expect(aiService.generateContinuationStream).not.toHaveBeenCalled();
  });

  it('currentChapter 为 undefined 时直接 return', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: undefined,
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(saveVersion).not.toHaveBeenCalled();
    expect(aiService.generateContinuationStream).not.toHaveBeenCalled();
  });
});

// ============ handleContinue 正常成功流 ============
describe('handleContinue 正常成功流', () => {
  it('调用 updateSettings 和 generateContinuationStream，context 取 content 末尾 2000 字', async () => {
    const editor = createEditorMock();
    const longContent = 'A'.repeat(3000);
    const chapter = makeChapter({ content: longContent, summary: '摘要' });
    const updateChapterContent = vi.fn();
    vi.mocked(useAppStore.getState).mockReturnValue({
      characters: [],
      aiSettings: makeAISettings({ style: 'action' }),
      updateChapterContent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: chapter,
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(aiService.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ style: 'action' }));
    expect(aiService.generateContinuationStream).toHaveBeenCalledTimes(1);
    // 验证 context 是 content.slice(-2000)
    const callArgs = vi.mocked(aiService.generateContinuationStream).mock.calls[0];
    expect(callArgs[0]).toBe(longContent.slice(-2000));
    expect(callArgs[1]).toBe('摘要');
  });

  it('成功后调用 saveVersion("AI 续写")', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(saveVersion).toHaveBeenCalledWith('ch-1', 'AI 续写');
  });

  it('生成期间 setEditable(false)，完成后 setEditable(true)', async () => {
    const editor = createEditorMock();

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    // setEditable(false) 在开始时，setEditable(true) 在 onComplete 和 finally 中
    expect(editor.setEditable).toHaveBeenCalledWith(false);
    expect(editor.setEditable).toHaveBeenCalledWith(true);
  });

  it('onComplete 调用 updateChapterContent flush 编辑器内容到 store', async () => {
    const editor = createEditorMock({ html: '<p>final content</p>' });
    const updateChapterContent = vi.fn();
    vi.mocked(useAppStore.getState).mockReturnValue({
      characters: [],
      aiSettings: makeAISettings(),
      updateChapterContent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(updateChapterContent).toHaveBeenCalledWith('ch-1', '<p>final content</p>');
  });
});

// ============ handleContinue onError 路径 ============
describe('handleContinue onError 路径', () => {
  it('onError 触发 toast.error，saveVersion 标签为"AI 续写（失败，已保留部分）"', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const updateChapterContent = vi.fn();
    vi.mocked(useAppStore.getState).mockReturnValue({
      characters: [],
      aiSettings: makeAISettings(),
      updateChapterContent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        handler?.onError(new Error('stream error'));
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(toast.error).toHaveBeenCalledWith('AI 续写失败', 'stream error');
    expect(saveVersion).toHaveBeenCalledWith('ch-1', 'AI 续写（失败，已保留部分）');
  });

  it('aiService.generateContinuationStream 抛错时触发 catch toast.error', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiService.generateContinuationStream).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(toast.error).toHaveBeenCalledWith('AI 续写失败', 'network error');
    expect(saveVersion).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ============ handleContinue 章节切换防串章 ============
describe('handleContinue 章节切换防串章', () => {
  it('onChunk 检测到章节切换时 abort', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const currentChapterIdRef = { current: 'ch-1' };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef,
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    // 启动续写（不 await，因为要中途切换章节）
    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    // 等待 mock 被调用并捕获 handler
    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    // 模拟章节切换
    currentChapterIdRef.current = 'ch-2';

    // 触发 onChunk（abort signal），再让 mock resolve
    await act(async () => {
      capturedHandler?.onChunk('<p>chunk</p>');
      resolveMock();
      await promise;
    });

    // 章节切换后 abort 路径不 saveVersion
    expect(saveVersion).not.toHaveBeenCalled();
  });
});

// ============ handlePolish 前置 guard ============
describe('handlePolish 前置 guard', () => {
  it('editor 为 null 时直接 return', async () => {
    const saveVersion = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor: null,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(saveVersion).not.toHaveBeenCalled();
    expect(aiService.polishTextStream).not.toHaveBeenCalled();
  });

  it('currentChapterId 为 null 时直接 return', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: null,
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: null },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(saveVersion).not.toHaveBeenCalled();
    expect(aiService.polishTextStream).not.toHaveBeenCalled();
  });
});

// ============ handlePolish 选中文本替换 ============
describe('handlePolish 选中文本替换', () => {
  it('选中文本时使用 deleteRange + insertContent 替换选区', async () => {
    const editor = createEditorMock({
      selection: { from: 10, to: 20, empty: false },
    });
    const saveVersion = vi.fn();

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    // 验证 chain().focus().deleteRange().insertContent().run() 被调用
    expect(editor.chain).toHaveBeenCalled();
    expect(editor._chainReturn.focus).toHaveBeenCalled();
    expect(editor._chainReturn.deleteRange).toHaveBeenCalledWith({ from: 10, to: 20 });
    expect(editor._chainReturn.insertContent).toHaveBeenCalled();
    expect(editor._chainReturn.run).toHaveBeenCalled();
    // 不应调用 setContent（那是全章替换路径）
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('选中文本时 saveVersion 标签为 "AI 润色"', async () => {
    const editor = createEditorMock({
      selection: { from: 10, to: 20, empty: false },
    });
    const saveVersion = vi.fn();

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(saveVersion).toHaveBeenCalledWith('ch-1', 'AI 润色');
  });

  it('polishTextStream 第一个参数为选中文本', async () => {
    const editor = createEditorMock({
      selection: { from: 10, to: 20, empty: false },
    });

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    const callArgs = vi.mocked(aiService.polishTextStream).mock.calls[0];
    // textBetween 返回 'selected text'
    expect(callArgs[0]).toBe('selected text');
  });
});

// ============ handlePolish 全章替换 ============
describe('handlePolish 全章替换', () => {
  it('未选中文本时使用 setContent 全章替换', async () => {
    const editor = createEditorMock({
      selection: { from: 0, to: 0, empty: true },
    });
    const saveVersion = vi.fn();

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter({ content: '<p>原内容</p>' }),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    // 验证 setContent 被调用（全章替换路径）
    expect(editor.commands.setContent).toHaveBeenCalled();
    expect(editor.commands.focus).toHaveBeenCalled();
    // 不应调用 deleteRange（那是选区替换路径）
    expect(editor._chainReturn.deleteRange).not.toHaveBeenCalled();
  });

  it('全章润色后 saveVersion 标签为 "AI 润色"', async () => {
    const editor = createEditorMock({
      selection: { from: 0, to: 0, empty: true },
    });
    const saveVersion = vi.fn();

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(saveVersion).toHaveBeenCalledWith('ch-1', 'AI 润色');
  });

  it('polishTextStream 第一个参数为 currentChapter.content', async () => {
    const editor = createEditorMock({
      selection: { from: 0, to: 0, empty: true },
    });
    const chapter = makeChapter({ content: '<p>原内容</p>' });

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: chapter,
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    const callArgs = vi.mocked(aiService.polishTextStream).mock.calls[0];
    expect(callArgs[0]).toBe('<p>原内容</p>');
  });
});

// ============ handlePolish onError 路径 ============
describe('handlePolish onError 路径', () => {
  it('onError 触发 toast.error，跳过 saveVersion（关键差异点）', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        handler?.onError(new Error('polish error'));
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(toast.error).toHaveBeenCalledWith('AI 润色失败', 'polish error');
    // 关键差异：润色 onError 不修改编辑器，saveVersion 会保存"未变化"版本，应跳过
    expect(saveVersion).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('aiService.polishTextStream 抛错时触发 catch toast.error', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiService.polishTextStream).mockRejectedValueOnce(new Error('polish network error'));

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(toast.error).toHaveBeenCalledWith('AI 润色失败', 'polish network error');
    expect(saveVersion).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ============ handlePolish 章节切换防串章 ============
describe('handlePolish 章节切换防串章', () => {
  it('onComplete 检测到章节切换时丢弃 buffer，不写入编辑器', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const currentChapterIdRef = { current: 'ch-1' };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef,
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handlePolish(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    // 模拟章节切换
    currentChapterIdRef.current = 'ch-2';

    await act(async () => {
      capturedHandler?.onChunk('<p>polished</p>');
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // 章节切换后不写入编辑器，不 saveVersion
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    expect(editor._chainReturn.insertContent).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
  });
});

// ============ useEffect 卸载清理 ============
describe('useEffect 卸载清理', () => {
  it('卸载后 mountedRef 为 false，finally 中不 setState', async () => {
    const editor = createEditorMock();
    const setAIGenerating = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result, unmount } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating,
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    // 卸载组件（同步触发 useEffect cleanup → mountedRef=false）
    unmount();

    // 完成 AI 生成
    await act(async () => {
      resolveMock();
      await promise;
    });

    // 卸载后 finally 中 mountedRef=false 跳过 setState
    // setAIGenerating 只在 handleContinue 开始时被调用 true，finally 中不应再调用 false
    expect(setAIGenerating).not.toHaveBeenCalledWith(false);
  });
});

// ============ isGeneratingRef 同步 ============
describe('isGeneratingRef 同步', () => {
  it('isGenerating 变化时 isGeneratingRef 同步更新', async () => {
    const editor = createEditorMock();
    const isGeneratingRef = { current: false };

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));

    // 初始为 false
    expect(isGeneratingRef.current).toBe(false);

    // handleContinue 期间 isGenerating 变 true
    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    // 等待 isGenerating 变 true
    await vi.waitFor(() => expect(isGeneratingRef.current).toBe(true));

    await act(async () => { await promise; });

    // 完成后 isGenerating 变 false
    expect(isGeneratingRef.current).toBe(false);
  });
});

// ============ 分支补测 ============
describe('useEditorAI 分支补测', () => {
  it('abortGeneration：abortControllerRef 为 null 时 noop', () => {
    const editor = createEditorMock();
    const isGeneratingRef = { current: false };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion: vi.fn(),
      setAIGenerating: vi.fn(),
    }));
    // 未启动生成直接调 abort，abortControllerRef 应为 null
    expect(() => act(() => result.current.abortGeneration())).not.toThrow();
  });

  it('abortGeneration：continueFlushTimerRef 存在时 clearTimeout，节流 flush 不再触发', async () => {
    const editor = createEditorMock();
    const isGeneratingRef = { current: false };
    const saveVersion = vi.fn();
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef,
      saveVersion,
      setAIGenerating: vi.fn(),
    }));
    isGeneratingRef.current = true;
    // 先通过 onChunk 启动节流定时器，再 abort 清除
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<string>(resolve => { resolveMock = () => resolve(''); });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        return mockPromise;
      },
    );

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());
    // 触发 onChunk 启动节流 timer（continueFlushTimerRef.current 被设置）
    act(() => capturedHandler?.onChunk('<p>chunk</p>'));
    // 立即 abort：clearTimeout 清除节流 timer，continueBufferRef/continueFlushTimerRef 清空
    // 此处验证 abort 不抛错且 isGenerating 复位
    expect(() => act(() => result.current.abortGeneration())).not.toThrow();
    expect(isGeneratingRef.current).toBe(false);
    resolveMock();
    await act(async () => { await promise; });
    // 修复后：abortGeneration 设置 wasAbortedRef=true，await 后 handleContinue 检测到
    // wasAbortedRef.current 为 true，提前 return，不再调用 saveVersion。
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it('handleContinue：catch 中 e 非 Error 实例时用 String(e)', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 抛出非 Error 实例（字符串）
    vi.mocked(aiService.generateContinuationStream).mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    expect(toast.error).toHaveBeenCalledWith('AI 续写失败', 'string error');
    expect(saveVersion).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('handleContinue onChunk：editor.isDestroyed 时 noop', async () => {
    const editor = createEditorMock({ isDestroyed: true });
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      capturedHandler?.onChunk('<p>chunk</p>');
      resolveMock();
      await promise;
    });

    // editor.isDestroyed → onChunk 早返回，不调用 chain
    expect(editor.chain).not.toHaveBeenCalled();
  });

  it('handleContinue onComplete：editor.isDestroyed 时 noop', async () => {
    const editor = createEditorMock({ isDestroyed: true });
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      capturedHandler?.onComplete('<p>final</p>');
      resolveMock();
      await promise;
    });

    // editor.isDestroyed → onComplete 早返回
    expect(editor.chain).not.toHaveBeenCalled();
  });

  it('handleContinue onComplete：buffer 为空时跳过 insertContentAt', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      // 不调用 onChunk，直接 onComplete，buffer 为空
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // buffer 为空，不应调用 insertContentAt（但 setEditable(true) 和 commands.focus() 仍会调用）
    expect(editor._chainReturn.insertContentAt).not.toHaveBeenCalled();
  });

  it('handleContinue onComplete：节流 timer 存在时 clearTimeout', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      // 触发 onChunk 启动 timer，再 onComplete（应清除 timer 并立即 flush）
      capturedHandler?.onChunk('<p>chunk</p>');
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // 应该调用 insertContentAt（因为 onComplete 会立即 flush 残留 buffer）
    expect(editor._chainReturn.insertContentAt).toHaveBeenCalled();
  });

  it('handleContinue onError：error.message 为空时使用默认消息', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        // message 为空字符串
        handler?.onError(new Error(''));
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handleContinue(); });

    // 空消息时使用 '请检查网络或 API 配置'
    expect(toast.error).toHaveBeenCalledWith('AI 续写失败', '请检查网络或 API 配置');
    consoleError.mockRestore();
  });

  it('handleContinue onError：节流 timer 存在时清除', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      // 先触发 onChunk 启动 timer
      capturedHandler?.onChunk('<p>chunk</p>');
      // 立即 onError（应清除 timer 并清空 buffer）
      capturedHandler?.onError(new Error('with timer'));
      resolveMock();
      await promise;
    });

    expect(toast.error).toHaveBeenCalledWith('AI 续写失败', 'with timer');
    consoleError.mockRestore();
  });

  it('handlePolish：catch 中 e 非 Error 实例时用 String(e)', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiService.polishTextStream).mockRejectedValueOnce(42);

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(toast.error).toHaveBeenCalledWith('AI 润色失败', '42');
    consoleError.mockRestore();
  });

  it('handlePolish onChunk：editor.isDestroyed 时 noop', async () => {
    const editor = createEditorMock({ isDestroyed: true });
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handlePolish(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      capturedHandler?.onChunk('<p>chunk</p>');
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // editor.isDestroyed → onChunk 早返回，不写入 buffer
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('handlePolish onChunk：章节切换时 abort', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const currentChapterIdRef = { current: 'ch-1' };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef,
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handlePolish(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    // 模拟章节切换
    currentChapterIdRef.current = 'ch-2';

    await act(async () => {
      capturedHandler?.onChunk('<p>chunk</p>');
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // 章节切换后不写入编辑器
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    expect(editor._chainReturn.insertContent).not.toHaveBeenCalled();
  });

  it('handlePolish onComplete：editor.isDestroyed 时 noop', async () => {
    const editor = createEditorMock({ isDestroyed: true });
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handlePolish(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      capturedHandler?.onComplete('<p>final</p>');
      resolveMock();
      await promise;
    });

    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('handlePolish onError：error.message 为空时使用默认消息', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        handler?.onError(new Error(''));
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    await act(async () => { await result.current.handlePolish(); });

    expect(toast.error).toHaveBeenCalledWith('AI 润色失败', '请检查网络或 API 配置');
    consoleError.mockRestore();
  });

  it('卸载清理：continueFlushTimerRef 存在时 clearTimeout', async () => {
    const editor = createEditorMock();
    const setAIGenerating = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result, unmount } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion: vi.fn(),
      setAIGenerating,
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    // 触发 onChunk 启动 timer
    act(() => capturedHandler?.onChunk('<p>chunk</p>'));

    // 卸载（应触发 cleanup 中的 clearTimeout）
    expect(() => unmount()).not.toThrow();

    resolveMock();
    await act(async () => { await promise; });
  });

  it('handleContinue onComplete：章节切换时丢弃 buffer 并 clearTimeout', async () => {
    const editor = createEditorMock();
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.generateContinuationStream).mockImplementationOnce(
      async (_ctx, _sum, _chars, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const currentChapterIdRef = { current: 'ch-1' };
    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef,
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handleContinue(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    // 先触发 onChunk 启动节流 timer 并写入 buffer
    act(() => capturedHandler?.onChunk('<p>chunk</p>'));

    // 模拟章节切换后再触发 onComplete
    currentChapterIdRef.current = 'ch-2';

    await act(async () => {
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // 章节切换：onComplete 走丢弃 buffer 分支，不写入编辑器（buffer 被丢弃 + timer 被清除）
    // 注：onComplete 的章节切换分支不调用 abortController.abort()，
    // 因此 await 后仍会 saveVersion（这是当前实现的预期行为）
    expect(editor._chainReturn.insertContentAt).not.toHaveBeenCalled();
  });

  it('handlePolish onChunk：正常路径追加到 streamingBufferRef', async () => {
    const editor = createEditorMock({ selection: { from: 0, to: 0, empty: true } });
    const saveVersion = vi.fn();
    let capturedHandler: StreamHandler | undefined;
    let resolveMock: () => void = () => {};
    const mockPromise = new Promise<void>(resolve => { resolveMock = resolve; });
    vi.mocked(aiService.polishTextStream).mockImplementationOnce(
      async (_text, _style, handler, _signal) => {
        capturedHandler = handler;
        await mockPromise;
        return '';
      },
    );

    const { result } = renderHook(() => useEditorAI({
      editor,
      currentChapterId: 'ch-1',
      currentChapter: makeChapter(),
      currentChapterIdRef: { current: 'ch-1' },
      isGeneratingRef: { current: false },
      saveVersion,
      setAIGenerating: vi.fn(),
    }));

    let promise: Promise<void> | undefined;
    act(() => { promise = result.current.handlePolish(); });

    await vi.waitFor(() => expect(capturedHandler).toBeDefined());

    await act(async () => {
      // 正常追加 chunk 到 streamingBufferRef
      capturedHandler?.onChunk('<p>chunk1</p>');
      capturedHandler?.onChunk('<p>chunk2</p>');
      capturedHandler?.onComplete('');
      resolveMock();
      await promise;
    });

    // onChunk 累积后 onComplete 走全章替换路径（setContent）
    expect(editor.commands.setContent).toHaveBeenCalled();
  });
});
