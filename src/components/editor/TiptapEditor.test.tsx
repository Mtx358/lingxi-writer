/**
 * TiptapEditor 单元测试
 *
 * TiptapEditor 是富文本编辑器主组件，594 行，依赖 ProseMirror（jsdom 无法真实启动）。
 * 采用 mock useEditor 策略：构造一个可控的编辑器实例，覆盖组件的渲染、工具栏交互、
 * 章节切换同步、内容纪元刷新、AI 插入请求、跳转请求、提及面板、右键菜单、滚动关闭等。
 *
 * Mock 策略：
 *   - @tiptap/react：mock useEditor 返回受控 editor 实例（vi.fn，可临时返回 null 测试加载态）；
 *     mock EditorContent 渲染占位 div
 *   - @tiptap/starter-kit 等扩展：mock 为空对象（不被实际使用）
 *   - @/hooks/useEditorAI：mock 返回受控的 isGenerating/handleContinue/handlePolish/abortGeneration
 *   - @/components/editor/MentionPanel / EditorContextMenu：mock 为简单 div 占位（避免触发其内部逻辑）
 *   - @/store/useAppStore：真实 store + setState 注入数据，便于测试 useEffect 响应
 *   - @/hooks/useToast：mock toast
 *
 * 测试范围：
 *   - 加载态：editor 为 null 时渲染 "加载编辑器..."
 *   - 工具栏渲染：所有按钮（加粗/斜体/下划线/删除线/H1-3/列表/引用/分割线/链接/提及/撤销/重做/续写/润色）
 *   - 工具栏按钮点击触发 editor.chain().focus().<cmd>().run()
 *   - 撤销/重做按钮 disabled 状态跟随 editor.can()
 *   - AI 按钮：非生成态显示续写/润色；生成态显示取消
 *   - 点击续写/润色/取消调用对应 hook 返回的方法
 *   - 右键菜单：onContextMenu 触发显示，点击菜单项调用对应回调
 *   - 提及面板：插入@提及按钮 / onUpdate @ 检测 / 点击外部关闭
 *   - handleMarkAsForeshadow：有选区调用 addForeshadow + toast；无选区无操作
 *   - 章节切换：setContent 同步 + flush 旧章节防抖 + abortGeneration
 *   - contentEpoch 变化触发 setContent
 *   - pendingEditorInsert：cursor / end 两种模式 + 跨章节清空
 *   - pendingScrollTo：position / blockText / 跨章节
 *   - 浮层打开时屏蔽导航键
 *   - 编辑器滚动关闭右键菜单
 *   - onUpdate 防抖写入 store + @ 检测触发提及面板
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import type { Chapter, Foreshadow } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { isOverlayOpen, popOverlay, pushOverlay } from '@/utils/overlayState';

// ============ hoisted mock 引用 ============
// useEditor mock 需要在 vi.mock 工厂内访问测试控制的 editor 实例与 onUpdate 捕获器，
// 故用 vi.hoisted 提升到 mock 工厂可访问的作用域
const {
  useEditorFn,
  editorMock,
  chainReturn,
  onUpdateCapturer,
  useEditorAIHook,
  mentionPanelMock,
  contextMenuMock,
  toastMock,
  internal,
} = vi.hoisted(() => {
  // 链式 mock：chain().focus().<cmd>().run() / chain().focus().insertContentAt().run()
  const callLog: string[] = [];
  const chain: Record<string, (...args: unknown[]) => typeof chain> = {};

  const cmds = [
    'focus', 'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike',
    'toggleHeading', 'toggleBulletList', 'toggleOrderedList', 'toggleBlockquote',
    'setHorizontalRule', 'toggleLink', 'undo', 'redo',
    'insertContent', 'insertContentAt', 'deleteRange', 'insertMention',
    'setTextSelection', 'scrollIntoView', 'toggleHighlight', 'setContent',
  ];
  for (const cmd of cmds) {
    chain[cmd] = vi.fn((..._args: unknown[]) => {
      callLog.push(cmd);
      return chain;
    }) as never;
  }
  chain.run = vi.fn(() => {
    callLog.push('run');
    return true;
  }) as never;
  const chainReturn = chain;

  // isActive 状态映射：测试可覆盖以模拟光标处的格式状态
  const activeState: Record<string, boolean> = {};

  // can() 状态：默认 undo=true / redo=false，测试可覆盖
  let canUndo = true;
  let canRedo = false;

  // 文档模拟：默认空段落，descendants/textBetween 可被覆盖
  // descendants 类型与 ProseMirror 真实签名对齐：cb 接收 node 与 pos，返回 boolean | void
  const docState = {
    content: { size: 10 },
    textBetween: vi.fn(() => ''),
    descendants: vi.fn((_cb: (node: unknown, pos: number) => boolean | void) => true),
  };

  const selection = { from: 1, to: 1, empty: true };

  // 实际 editor mock 实例
  const editorMock = {
    isDestroyed: false,
    setEditable: vi.fn(),
    getHTML: vi.fn(() => '<p>html</p>'),
    isActive: vi.fn((name: string) => !!activeState[name]),
    can: vi.fn(() => ({ undo: () => canUndo, redo: () => canRedo })),
    chain: vi.fn(() => chainReturn),
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
    },
    state: {
      doc: docState,
      selection,
    },
    view: {
      coordsAtPos: vi.fn(() => ({ left: 10, bottom: 10, top: 0, right: 10 })),
      dom: { scrollTop: 0, scrollHeight: 100 },
    },
  };

  // useEditor 是 vi.fn：默认返回 editorMock，测试可临时 mockImplementationOnce 返回 null
  const useEditorFn = vi.fn((options: { onUpdate?: (args: { editor: typeof editorMock }) => void }) => {
    onUpdateCapturer.cb = options.onUpdate || null;
    return editorMock;
  });

  // onUpdate 捕获器：测试可手动调用
  const onUpdateCapturer = { cb: null as null | ((args: { editor: typeof editorMock }) => void) };

  // useEditorAI mock：返回受控的 isGenerating/handleContinue/handlePolish/abortGeneration
  const useEditorAIHook = {
    isGenerating: false,
    handleContinue: vi.fn(),
    handlePolish: vi.fn(),
    abortGeneration: vi.fn(),
  };

  // MentionPanel / EditorContextMenu mock：渲染占位，暴露 props 用于断言
  const mentionPanelMock = {
    lastProps: null as null | Record<string, unknown>,
  };
  const contextMenuMock = {
    lastProps: null as null | Record<string, unknown>,
  };

  const toastMock = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  // 内部工具：暴露给测试用例重置编辑器状态
  const internal = {
    callLog,
    activeState,
    docState,
    selection,
    setCanUndo: (v: boolean) => { canUndo = v; },
    setCanRedo: (v: boolean) => { canRedo = v; },
    reset() {
      callLog.length = 0;
      for (const k of Object.keys(activeState)) delete activeState[k];
      canUndo = true;
      canRedo = false;
      docState.content.size = 10;
      docState.textBetween.mockReturnValue('');
      docState.descendants.mockReturnValue(true);
      selection.from = 1;
      selection.to = 1;
      selection.empty = true;
      editorMock.isDestroyed = false;
      editorMock.getHTML.mockReturnValue('<p>html</p>');
      editorMock.view.coordsAtPos.mockReturnValue({ left: 10, bottom: 10, top: 0, right: 10 });
    },
  };

  return {
    useEditorFn,
    editorMock,
    chainReturn,
    onUpdateCapturer,
    useEditorAIHook,
    mentionPanelMock,
    contextMenuMock,
    toastMock,
    internal,
  };
});

// ============ mock 模块 ============
vi.mock('@tiptap/react', () => ({
  useEditor: useEditorFn,
  EditorContent: ({ editor: _editor }: { editor: unknown }) => (
    <div data-testid="tiptap-editor-content" />
  ),
}));

// 扩展全部 mock 为带 configure 的对象，避免 jsdom 下 ProseMirror 节点创建失败
const { ext } = vi.hoisted(() => ({ ext: { configure: () => ({}) } }));
vi.mock('@tiptap/starter-kit', () => ({ default: ext }));
vi.mock('@tiptap/extension-underline', () => ({ default: ext }));
vi.mock('@tiptap/extension-link', () => ({ default: ext }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: ext }));
vi.mock('@tiptap/extension-focus', () => ({ default: ext }));
vi.mock('@tiptap/extension-highlight', () => ({ default: ext }));
vi.mock('@tiptap/extension-text-style', () => ({ TextStyle: ext }));
vi.mock('@tiptap/extension-color', () => ({ default: ext }));
// lucide-react：显式列出 TiptapEditor 用到的 19 个图标。
// 注意：不能用 Proxy，否则每次 render 返回新的函数引用，React 会无限重渲染导致测试挂死。
vi.mock('lucide-react', () => {
  const Icon = (props: Record<string, unknown>) => React.createElement('svg', props);
  return {
    Bold: Icon, Italic: Icon, Underline: Icon, Strikethrough: Icon,
    Heading1: Icon, Heading2: Icon, Heading3: Icon,
    List: Icon, ListOrdered: Icon, Quote: Icon, Minus: Icon, Link2: Icon,
    Undo2: Icon, Redo2: Icon, Wand2: Icon, Clock: Icon, AtSign: Icon,
    X: Icon, Loader2: Icon,
  };
});

// useEditorAI mock：返回受控值
vi.mock('@/hooks/useEditorAI', () => ({
  useEditorAI: () => useEditorAIHook,
  sanitizeAiHtml: (s: string) => s,
}));

// MentionPanel / EditorContextMenu mock：渲染占位 div，捕获 props
vi.mock('@/components/editor/MentionPanel', () => ({
  default: (props: Record<string, unknown>) => {
    mentionPanelMock.lastProps = props;
    return <div data-testid="mention-panel-mock" />;
  },
}));
vi.mock('@/components/editor/EditorContextMenu', () => ({
  default: (props: Record<string, unknown>) => {
    contextMenuMock.lastProps = props;
    return <div data-testid="context-menu-mock" />;
  },
}));

// MentionExtension mock
vi.mock('@/components/editor/extensions/MentionExtension', () => ({
  MentionExtension: {},
}));

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

import TiptapEditor from '@/components/editor/TiptapEditor';

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'c-1',
    projectId: 'p-1',
    parentId: null,
    title: '第一章',
    summary: '摘要',
    order: 1,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 100,
    content: '<p>正文</p>',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Chapter;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  chapters: Chapter[];
  currentChapterId: string | null;
  pendingEditorInsert: { chapterId: string; content: string; mode: 'cursor' | 'end' } | null;
  pendingScrollTo: { chapterId: string; position?: { start: number; end: number }; blockText?: string; timestamp: number } | null;
  contentEpoch: number;
  foreshadows: Foreshadow[];
}> = {}) {
  const defaults = {
    saveVersion: vi.fn(),
    addForeshadow: vi.fn(),
    setPendingEditorInsert: vi.fn(),
    setPendingScrollTo: vi.fn(),
    setCurrentChapter: vi.fn(),
    setAIGenerating: vi.fn(),
    updateChapterContent: vi.fn(),
  };
  useAppStore.setState({
    chapters: overrides.chapters ?? [makeChapter()],
    currentChapterId: overrides.currentChapterId === undefined ? 'c-1' : overrides.currentChapterId,
    pendingEditorInsert: overrides.pendingEditorInsert ?? null,
    pendingScrollTo: overrides.pendingScrollTo ?? null,
    contentEpoch: overrides.contentEpoch ?? 0,
    foreshadows: overrides.foreshadows ?? [],
    ...defaults,
  });
  return defaults;
}

describe('TiptapEditor', () => {
  beforeEach(() => {
    while (isOverlayOpen()) popOverlay();
    internal.reset();
    // 重置 useEditor mock：默认返回 editorMock
    (useEditorFn as unknown as {
      mockImplementation: (fn: (options: { onUpdate?: (args: { editor: typeof editorMock }) => void }) => typeof editorMock | null) => void;
    }).mockImplementation((options) => {
      onUpdateCapturer.cb = options.onUpdate || null;
      return editorMock;
    });
    // 重置所有 vi.fn 的调用记录
    useEditorFn.mockClear();
    editorMock.setEditable.mockClear();
    editorMock.getHTML.mockClear();
    editorMock.isActive.mockClear();
    editorMock.can.mockClear();
    editorMock.chain.mockClear();
    editorMock.commands.setContent.mockClear();
    editorMock.commands.focus.mockClear();
    editorMock.view.coordsAtPos.mockClear();
    internal.docState.textBetween.mockClear();
    internal.docState.descendants.mockClear();
    // 重置 chain 上所有命令的调用记录
    for (const key of Object.keys(chainReturn)) {
      (chainReturn[key] as { mockClear?: () => void }).mockClear?.();
    }
    // 重置 useEditorAI mock
    useEditorAIHook.isGenerating = false;
    useEditorAIHook.handleContinue.mockClear();
    useEditorAIHook.handlePolish.mockClear();
    useEditorAIHook.abortGeneration.mockClear();
    mentionPanelMock.lastProps = null;
    contextMenuMock.lastProps = null;
    toastMock.error.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
    toastMock.info.mockClear();
    onUpdateCapturer.cb = null;
  });

  afterEach(() => {
    while (isOverlayOpen()) popOverlay();
    cleanup();
  });

  // ============ 加载态 ============
  it('editor 为 null 时渲染加载态', () => {
    (useEditorFn as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() => null);
    mockStore();
    render(<TiptapEditor />);
    expect(screen.getByText('加载编辑器...')).toBeInTheDocument();
    // 恢复默认实现，避免后续测试受影响
    (useEditorFn as unknown as {
      mockImplementation: (fn: (options: { onUpdate?: (args: { editor: typeof editorMock }) => void }) => typeof editorMock) => void;
    }).mockImplementation((options) => {
      onUpdateCapturer.cb = options.onUpdate || null;
      return editorMock;
    });
  });

  it('editor 就绪后渲染 EditorContent', () => {
    mockStore();
    render(<TiptapEditor />);
    expect(screen.queryByText('加载编辑器...')).not.toBeInTheDocument();
    expect(screen.getByTestId('tiptap-editor-content')).toBeInTheDocument();
  });

  // ============ 工具栏渲染 ============
  it('渲染工具栏所有按钮', () => {
    mockStore();
    render(<TiptapEditor />);
    // 格式按钮
    expect(screen.getByTitle('加粗')).toBeInTheDocument();
    expect(screen.getByTitle('斜体')).toBeInTheDocument();
    expect(screen.getByTitle('下划线')).toBeInTheDocument();
    expect(screen.getByTitle('删除线')).toBeInTheDocument();
    // 标题
    expect(screen.getByTitle('标题1')).toBeInTheDocument();
    expect(screen.getByTitle('标题2')).toBeInTheDocument();
    expect(screen.getByTitle('标题3')).toBeInTheDocument();
    // 列表
    expect(screen.getByTitle('无序列表')).toBeInTheDocument();
    expect(screen.getByTitle('有序列表')).toBeInTheDocument();
    expect(screen.getByTitle('引用')).toBeInTheDocument();
    expect(screen.getByTitle('分割线')).toBeInTheDocument();
    // 链接/提及
    expect(screen.getByTitle('链接')).toBeInTheDocument();
    expect(screen.getByTitle('插入@提及')).toBeInTheDocument();
    // 撤销/重做
    expect(screen.getByTitle('撤销 (Ctrl+Z)')).toBeInTheDocument();
    expect(screen.getByTitle('重做 (Ctrl+Y)')).toBeInTheDocument();
    // AI 按钮
    expect(screen.getByTitle('智能续写')).toBeInTheDocument();
    expect(screen.getByTitle('AI 润色')).toBeInTheDocument();
  });

  // ============ 工具栏按钮点击 ============
  it('点击加粗按钮触发 editor.chain().focus().toggleBold().run()', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('加粗'));
    expect(editorMock.chain).toHaveBeenCalled();
    expect(chainReturn.toggleBold).toHaveBeenCalled();
    expect(chainReturn.focus).toHaveBeenCalled();
    expect(chainReturn.run).toHaveBeenCalled();
  });

  it('点击斜体按钮触发 toggleItalic', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('斜体'));
    expect(chainReturn.toggleItalic).toHaveBeenCalled();
  });

  it('点击下划线按钮触发 toggleUnderline', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('下划线'));
    expect(chainReturn.toggleUnderline).toHaveBeenCalled();
  });

  it('点击删除线按钮触发 toggleStrike', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('删除线'));
    expect(chainReturn.toggleStrike).toHaveBeenCalled();
  });

  it('点击标题按钮触发 toggleHeading 对应 level', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('标题1'));
    expect(chainReturn.toggleHeading).toHaveBeenCalledWith({ level: 1 });
    fireEvent.click(screen.getByTitle('标题2'));
    expect(chainReturn.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    fireEvent.click(screen.getByTitle('标题3'));
    expect(chainReturn.toggleHeading).toHaveBeenCalledWith({ level: 3 });
  });

  it('点击列表/引用/分割线按钮触发对应命令', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('无序列表'));
    expect(chainReturn.toggleBulletList).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('有序列表'));
    expect(chainReturn.toggleOrderedList).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('引用'));
    expect(chainReturn.toggleBlockquote).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('分割线'));
    expect(chainReturn.setHorizontalRule).toHaveBeenCalled();
  });

  it('点击链接按钮触发 toggleLink({ href: "#" })', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('链接'));
    expect(chainReturn.toggleLink).toHaveBeenCalledWith({ href: '#' });
  });

  it('点击撤销/重做按钮触发对应命令', () => {
    mockStore();
    // 默认 canUndo=true / canRedo=false，需打开 redo 才能点击重做按钮
    internal.setCanRedo(true);
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('撤销 (Ctrl+Z)'));
    expect(chainReturn.undo).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('重做 (Ctrl+Y)'));
    expect(chainReturn.redo).toHaveBeenCalled();
  });

  it('撤销按钮 disabled 跟随 editor.can().undo()', () => {
    mockStore();
    internal.setCanUndo(false);
    internal.setCanRedo(false);
    render(<TiptapEditor />);
    expect(screen.getByTitle('撤销 (Ctrl+Z)')).toBeDisabled();
    expect(screen.getByTitle('重做 (Ctrl+Y)')).toBeDisabled();
  });

  // ============ AI 按钮 ============
  it('点击续写按钮调用 handleContinue', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('智能续写'));
    expect(useEditorAIHook.handleContinue).toHaveBeenCalled();
  });

  it('点击润色按钮调用 handlePolish', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('AI 润色'));
    expect(useEditorAIHook.handlePolish).toHaveBeenCalled();
  });

  it('生成态显示取消按钮，点击调用 abortGeneration', () => {
    mockStore();
    useEditorAIHook.isGenerating = true;
    render(<TiptapEditor />);
    expect(screen.getByText('AI 生成中...')).toBeInTheDocument();
    expect(screen.queryByTitle('智能续写')).not.toBeInTheDocument();
    expect(screen.queryByTitle('AI 润色')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('取消生成'));
    expect(useEditorAIHook.abortGeneration).toHaveBeenCalled();
  });

  // ============ 右键菜单 ============
  it('右键编辑器区域打开上下文菜单', () => {
    mockStore();
    render(<TiptapEditor />);
    expect(screen.queryByTestId('context-menu-mock')).not.toBeInTheDocument();
    // onContextMenu 绑定在包含 EditorContent 的 div（class="flex-1 overflow-auto p-6"）
    const editorArea = document.querySelector('.flex-1.overflow-auto.p-6') as HTMLElement;
    expect(editorArea).not.toBeNull();
    fireEvent.contextMenu(editorArea!, { clientX: 100, clientY: 200 });
    expect(screen.getByTestId('context-menu-mock')).toBeInTheDocument();
    // 验证传入的位置
    expect(contextMenuMock.lastProps?.position).toEqual({ x: 100, y: 200 });
  });

  it('点击"插入@提及"按钮打开提及面板', () => {
    mockStore();
    render(<TiptapEditor />);
    expect(screen.queryByTestId('mention-panel-mock')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('插入@提及'));
    expect(screen.getByTestId('mention-panel-mock')).toBeInTheDocument();
  });

  // ============ handleMarkAsForeshadow ============
  it('右键菜单 onMarkAsForeshadow 在有选区时调用 addForeshadow + toast + 高亮', () => {
    const { addForeshadow } = mockStore();
    // 模拟有选区：textBetween 返回选中文本
    internal.selection.empty = false;
    internal.selection.from = 0;
    internal.selection.to = 5;
    internal.docState.textBetween.mockReturnValue('神秘伏笔文本');
    render(<TiptapEditor />);
    // 打开右键菜单
    const editorArea = document.querySelector('.flex-1.overflow-auto.p-6') as HTMLElement;
    fireEvent.contextMenu(editorArea!, { clientX: 10, clientY: 10 });
    // 调用 onMarkAsForeshadow（mock 的 ContextMenu 将 props 暴露）
    const onMark = contextMenuMock.lastProps?.onMarkAsForeshadow as () => void;
    expect(typeof onMark).toBe('function');
    act(() => {
      onMark();
    });
    expect(addForeshadow).toHaveBeenCalledWith(expect.objectContaining({
      title: '神秘伏笔文本',
      description: '神秘伏笔文本',
    }));
    expect(chainReturn.toggleHighlight).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('右键菜单 onMarkAsForeshadow 在无选区时不调用 addForeshadow', () => {
    const { addForeshadow } = mockStore();
    internal.selection.empty = true;
    render(<TiptapEditor />);
    const editorArea = document.querySelector('.flex-1.overflow-auto.p-6') as HTMLElement;
    fireEvent.contextMenu(editorArea!, { clientX: 10, clientY: 10 });
    const onMark = contextMenuMock.lastProps?.onMarkAsForeshadow as () => void;
    act(() => {
      onMark();
    });
    expect(addForeshadow).not.toHaveBeenCalled();
  });

  it('右键菜单 onInsertMention 调用 setShowMentionPanel(true)', () => {
    mockStore();
    render(<TiptapEditor />);
    const editorArea = document.querySelector('.flex-1.overflow-auto.p-6') as HTMLElement;
    fireEvent.contextMenu(editorArea!, { clientX: 10, clientY: 10 });
    const onInsert = contextMenuMock.lastProps?.onInsertMention as () => void;
    expect(screen.queryByTestId('mention-panel-mock')).not.toBeInTheDocument();
    act(() => {
      onInsert();
    });
    expect(screen.getByTestId('mention-panel-mock')).toBeInTheDocument();
  });

  it('右键菜单 onClose 关闭菜单', () => {
    mockStore();
    render(<TiptapEditor />);
    const editorArea = document.querySelector('.flex-1.overflow-auto.p-6') as HTMLElement;
    fireEvent.contextMenu(editorArea!, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId('context-menu-mock')).toBeInTheDocument();
    const onClose = contextMenuMock.lastProps?.onClose as () => void;
    act(() => {
      onClose();
    });
    expect(screen.queryByTestId('context-menu-mock')).not.toBeInTheDocument();
  });

  // ============ onUpdate 防抖 + @ 检测 ============
  it('onUpdate 防抖写入 store（EDITOR_CONTENT_UPDATE_DEBOUNCE 后 updateChapterContent）', async () => {
    const { updateChapterContent } = mockStore();
    render(<TiptapEditor />);
    expect(onUpdateCapturer.cb).not.toBeNull();
    editorMock.getHTML.mockReturnValue('<p>新内容</p>');
    // 首次挂载触发章节切换 effect，isSwitchingRef 在 EDITOR_SWITCH_DELAY(100ms) 内为 true，
    // 会阻断 onUpdate 写入。等待切换态清除后再触发 onUpdate。
    await new Promise(r => setTimeout(r, 150));
    act(() => {
      onUpdateCapturer.cb!({ editor: editorMock });
    });
    // 防抖未到期前不应调用
    expect(updateChapterContent).not.toHaveBeenCalled();
    // 等待防抖（500ms）
    await waitFor(() => {
      expect(updateChapterContent).toHaveBeenCalledWith('c-1', '<p>新内容</p>');
    }, { timeout: 2000 });
  });

  it('onUpdate 检测到光标前最后一个字符为 @ 时打开提及面板', async () => {
    mockStore();
    render(<TiptapEditor />);
    // 等待初始挂载的章节切换 effect 完成（isSwitchingRef 清除）
    await new Promise(r => setTimeout(r, 150));
    // textBetween 返回以 @ 结尾的文本
    internal.selection.from = 5;
    internal.docState.textBetween.mockReturnValue('前缀@');
    act(() => {
      onUpdateCapturer.cb!({ editor: editorMock });
    });
    expect(screen.getByTestId('mention-panel-mock')).toBeInTheDocument();
  });

  it('onUpdate 未检测到 @ 不打开提及面板', () => {
    mockStore();
    render(<TiptapEditor />);
    internal.selection.from = 5;
    internal.docState.textBetween.mockReturnValue('普通文本');
    act(() => {
      onUpdateCapturer.cb!({ editor: editorMock });
    });
    expect(screen.queryByTestId('mention-panel-mock')).not.toBeInTheDocument();
  });

  // ============ 章节切换同步 ============
  it('章节切换时调用 abortGeneration + setContent 同步新章节内容', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'c-1', content: '<p>旧章节</p>' }),
        makeChapter({ id: 'c-2', title: '第二章', content: '<p>新章节</p>' }),
      ],
      currentChapterId: 'c-1',
    });
    render(<TiptapEditor />);
    // 清空初始渲染可能调用的 setContent
    editorMock.commands.setContent.mockClear();
    useEditorAIHook.abortGeneration.mockClear();
    // 切换章节
    act(() => {
      useAppStore.setState({ currentChapterId: 'c-2' });
    });
    await waitFor(() => {
      expect(useEditorAIHook.abortGeneration).toHaveBeenCalled();
    });
    expect(editorMock.commands.setContent).toHaveBeenCalledWith(
      '<p>新章节</p>',
      { emitUpdate: false },
    );
  });

  it('章节切换时 flush 旧章节防抖写入 store', async () => {
    const { updateChapterContent } = mockStore({
      chapters: [
        makeChapter({ id: 'c-1', content: '<p>旧</p>' }),
        makeChapter({ id: 'c-2', title: '第二章', content: '<p>新</p>' }),
      ],
      currentChapterId: 'c-1',
    });
    render(<TiptapEditor />);
    editorMock.getHTML.mockReturnValue('<p>编辑后</p>');
    // 等待初始挂载的章节切换 effect 完成（isSwitchingRef 清除）后再触发 onUpdate
    await new Promise(r => setTimeout(r, 150));
    // 触发 onUpdate 但不等待防抖
    act(() => {
      onUpdateCapturer.cb!({ editor: editorMock });
    });
    // 立即切换章节，应 flush 旧章节
    act(() => {
      useAppStore.setState({ currentChapterId: 'c-2' });
    });
    await waitFor(() => {
      expect(updateChapterContent).toHaveBeenCalledWith('c-1', '<p>编辑后</p>');
    });
  });

  // ============ contentEpoch 刷新 ============
  it('contentEpoch 变化触发 setContent 刷新编辑器内容', async () => {
    mockStore({ contentEpoch: 0 });
    render(<TiptapEditor />);
    editorMock.commands.setContent.mockClear();
    // bumpContentEpoch：直接 setState 改 contentEpoch
    act(() => {
      useAppStore.setState({ contentEpoch: 1, chapters: [makeChapter({ id: 'c-1', content: '<p>恢复后</p>' })] });
    });
    await waitFor(() => {
      expect(editorMock.commands.setContent).toHaveBeenCalledWith(
        '<p>恢复后</p>',
        { emitUpdate: false },
      );
    });
  });

  it('contentEpoch 未变化不触发 setContent', () => {
    mockStore({ contentEpoch: 5 });
    render(<TiptapEditor />);
    editorMock.commands.setContent.mockClear();
    act(() => {
      useAppStore.setState({ contentEpoch: 5 });
    });
    expect(editorMock.commands.setContent).not.toHaveBeenCalled();
  });

  // ============ pendingEditorInsert ============
  it('pendingEditorInsert mode=end 在文档末尾插入', async () => {
    const { setPendingEditorInsert } = mockStore();
    render(<TiptapEditor />);
    // 初始章节 c-1，pendingEditorInsert null，触发插入请求
    act(() => {
      useAppStore.setState({
        pendingEditorInsert: { chapterId: 'c-1', content: '<p>追加</p>', mode: 'end' },
      });
    });
    await waitFor(() => {
      expect(chainReturn.insertContentAt).toHaveBeenCalled();
    });
    expect(setPendingEditorInsert).toHaveBeenCalledWith(null);
  });

  it('pendingEditorInsert mode=cursor 在光标位置插入', async () => {
    const { setPendingEditorInsert } = mockStore();
    render(<TiptapEditor />);
    act(() => {
      useAppStore.setState({
        pendingEditorInsert: { chapterId: 'c-1', content: '<p>光标处</p>', mode: 'cursor' },
      });
    });
    await waitFor(() => {
      expect(chainReturn.insertContent).toHaveBeenCalledWith('<p>光标处</p>');
    });
    expect(setPendingEditorInsert).toHaveBeenCalledWith(null);
  });

  it('pendingEditorInsert 跨章节（chapterId 不匹配）仅清空 pending', async () => {
    const { setPendingEditorInsert } = mockStore({ currentChapterId: 'c-1' });
    render(<TiptapEditor />);
    act(() => {
      useAppStore.setState({
        pendingEditorInsert: { chapterId: 'c-other', content: '<p>其他</p>', mode: 'cursor' },
      });
    });
    await waitFor(() => {
      expect(setPendingEditorInsert).toHaveBeenCalledWith(null);
    });
    expect(chainReturn.insertContent).not.toHaveBeenCalled();
    expect(chainReturn.insertContentAt).not.toHaveBeenCalled();
  });

  // ============ pendingScrollTo ============
  it('pendingScrollTo position 模式：setTextSelection + scrollIntoView', async () => {
    const { setPendingScrollTo } = mockStore();
    // descendants 模拟遍历：调用 cb 时传入 text 节点，累计长度后命中 targetPos
    (internal.docState.descendants as unknown as {
      mockImplementation: (fn: (cb: (node: { isText: boolean; text: string }, pos: number) => boolean | void) => boolean) => void;
    }).mockImplementation((cb) => {
      cb({ isText: true, text: '一二三' }, 1); // pos=1, len=3 → acc 3
      return true;
    });
    render(<TiptapEditor />);
    (chainReturn.setTextSelection as unknown as { mockClear: () => void }).mockClear();
    (chainReturn.scrollIntoView as unknown as { mockClear: () => void }).mockClear();
    act(() => {
      useAppStore.setState({
        pendingScrollTo: { chapterId: 'c-1', position: { start: 2, end: 3 }, timestamp: Date.now() },
      });
    });
    await waitFor(() => {
      expect(setPendingScrollTo).toHaveBeenCalledWith(null);
    });
    expect(chainReturn.setTextSelection).toHaveBeenCalled();
    expect(chainReturn.scrollIntoView).toHaveBeenCalled();
  });

  it('pendingScrollTo blockText 模式：选中包含该文本的块', async () => {
    const { setPendingScrollTo } = mockStore();
    (internal.docState.descendants as unknown as {
      mockImplementation: (fn: (cb: (node: { isBlock: boolean; textContent: string; nodeSize: number }, pos: number) => boolean | void) => boolean) => void;
    }).mockImplementation((cb) => {
      cb({ isBlock: true, textContent: '这是一个段落，包含目标文本', nodeSize: 20 }, 1);
      return false;
    });
    render(<TiptapEditor />);
    (chainReturn.setTextSelection as unknown as { mockClear: () => void }).mockClear();
    act(() => {
      useAppStore.setState({
        pendingScrollTo: { chapterId: 'c-1', blockText: '目标文本', timestamp: Date.now() },
      });
    });
    await waitFor(() => {
      expect(setPendingScrollTo).toHaveBeenCalledWith(null);
    });
    expect(chainReturn.setTextSelection).toHaveBeenCalled();
  });

  it('pendingScrollTo 跨章节：先 setCurrentChapter 再延迟滚动', async () => {
    const { setCurrentChapter, setPendingScrollTo } = mockStore({
      chapters: [
        makeChapter({ id: 'c-1', content: '<p>当前</p>' }),
        makeChapter({ id: 'c-2', title: '第二章', content: '<p>目标</p>' }),
      ],
      currentChapterId: 'c-1',
    });
    internal.docState.descendants.mockImplementation(() => true);
    render(<TiptapEditor />);
    act(() => {
      useAppStore.setState({
        pendingScrollTo: { chapterId: 'c-2', blockText: '目标', timestamp: Date.now() },
      });
    });
    await waitFor(() => {
      expect(setCurrentChapter).toHaveBeenCalledWith('c-2');
    });
    expect(setPendingScrollTo).toHaveBeenCalledWith(null);
  });

  // ============ 浮层按键屏蔽 ============
  it('浮层打开时屏蔽导航键（preventDefault + stopPropagation）', () => {
    mockStore();
    render(<TiptapEditor />);
    // MentionPanel 被 mock，不会调用 pushOverlay。手动 pushOverlay 模拟浮层打开。
    pushOverlay();
    expect(isOverlayOpen()).toBe(true);
    // 在容器内触发 keydown：捕获阶段监听器应 preventDefault + stopPropagation
    const container = document.querySelector('.flex.flex-col.h-full') as HTMLElement;
    expect(container).not.toBeNull();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
    container.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('浮层未打开时不屏蔽按键', () => {
    mockStore();
    render(<TiptapEditor />);
    expect(isOverlayOpen()).toBe(false);
    const container = document.querySelector('.flex.flex-col.h-full') as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    container.dispatchEvent(event);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('组合输入法（isComposing）期间不屏蔽按键', () => {
    mockStore();
    render(<TiptapEditor />);
    pushOverlay();
    expect(isOverlayOpen()).toBe(true);
    const container = document.querySelector('.flex.flex-col.h-full') as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    container.dispatchEvent(event);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  // ============ 滚动关闭右键菜单 ============
  it('右键菜单打开时编辑器滚动关闭菜单', () => {
    mockStore();
    render(<TiptapEditor />);
    const editorArea = document.querySelector('.flex-1.overflow-auto.p-6') as HTMLElement;
    fireEvent.contextMenu(editorArea!, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId('context-menu-mock')).toBeInTheDocument();
    // 触发滚动事件（capture 阶段）
    fireEvent.scroll(editorArea!);
    expect(screen.queryByTestId('context-menu-mock')).not.toBeInTheDocument();
  });

  // ============ 点击外部关闭提及面板 ============
  it('提及面板打开时点击外部关闭', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('插入@提及'));
    expect(screen.getByTestId('mention-panel-mock')).toBeInTheDocument();
    // useClickOutside 监听 document mousedown，目标在 editorContainerRef 之外才触发关闭。
    // 整个 TiptapEditor 都在 ref 内，故点击 body（ref 外）模拟外部点击。
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(screen.queryByTestId('mention-panel-mock')).not.toBeInTheDocument();
  });

  it('MentionPanel onClose 关闭提及面板', () => {
    mockStore();
    render(<TiptapEditor />);
    fireEvent.click(screen.getByTitle('插入@提及'));
    expect(screen.getByTestId('mention-panel-mock')).toBeInTheDocument();
    const onClose = mentionPanelMock.lastProps?.onClose as () => void;
    act(() => {
      onClose();
    });
    expect(screen.queryByTestId('mention-panel-mock')).not.toBeInTheDocument();
  });

  // ============ 卸载清理 ============
  it('卸载不抛错（清理定时器）', () => {
    mockStore();
    const { unmount } = render(<TiptapEditor />);
    expect(() => unmount()).not.toThrow();
  });
});
