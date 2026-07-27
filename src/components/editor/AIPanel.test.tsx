/**
 * AIPanel 单元测试
 *
 * 测试范围（聚焦可独立验证的渲染、交互与异步流程）：
 *   - 空状态渲染（无章节、无建议时的占位）
 *   - 设置面板开合 + provider/style 切换 → updateAISettings
 *   - 无章节时各生成按钮 disabled
 *   - 空指令点击"按指令生成" → toast.error
 *   - 按指令生成 / 智能续写 / 扩写 / 润色 / 换视角 成功+失败路径
 *   - 扩写 4 种类型（detail/dialogue/environment/psychology）
 *   - 生成中显示"中止生成"按钮
 *   - 多版本生成成功 → 渲染版本卡片 + 采纳/插入光标处 → setPendingEditorInsert
 *   - 多版本生成空结果 → toast.error
 *   - 多版本生成中卡片 + 中止 + 清空
 *   - 测试连接成功 / 失败 / 抛错 → testResult 区块
 *   - 采纳建议 → setPendingEditorInsert(mode: 'end') + clearAISuggestions
 *   - 设定巡航面板渲染 + 折叠交互
 *   - 防抖更新（baseUrl/model/apiKey）+ slider onChange
 *   - 流式 chunk 回调 → streamingContent 卡片渲染
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AIPanel from '@/components/editor/AIPanel';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import { toast } from '@/hooks/useToast';
import type { AISettings, Chapter, AISuggestion, Character, ProjectSettingCard, BlueprintOverview } from '@/types';

// ============ mock aiService ============
// 每个方法独立 vi.fn，测试用 mockResolvedValueOnce 控制单次行为
vi.mock('@/utils/aiService', () => ({
  aiService: {
    updateSettings: vi.fn(),
    generateContinuationStream: vi.fn().mockResolvedValue(''),
    expandTextStream: vi.fn().mockResolvedValue(''),
    polishTextStream: vi.fn().mockResolvedValue(''),
    switchPerspective: vi.fn().mockResolvedValue({}),
    generateWritingByInstruction: vi.fn().mockResolvedValue(''),
    generateMultipleVersions: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  },
  StreamHandler: {},
}));

// ============ mock toast ============
// 捕获 error/success 调用参数以断言
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ============ mock sanitizeAiHtml ============
// 直接透传，便于断言原始内容
vi.mock('@/hooks/useEditorAI', () => ({
  sanitizeAiHtml: vi.fn((html: string) => html),
  // 其他可能的命名导出占位
}));

// ============ mock DOMPurify ============
// 透传 sanitize，避免 jsdom 下 DOMPurify 边缘行为
vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((s: string) => s),
  },
}));

// ============ 测试 fixtures ============
function makeAISettings(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'mock',
    apiKey: '',
    baseUrl: '',
    model: '',
    style: 'balanced',
    descriptionDensity: 0.5,
    dialogueDensity: 0.5,
    strictness: 0.5,
    temperature: 0.7,
    maxTokens: 2048,
    autoCheckConflicts: false,
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '章节摘要',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 100,
    content: '<p>这是正文内容。</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAISuggestion(overrides: Partial<AISuggestion> = {}): AISuggestion {
  return {
    id: 'sug-1',
    type: 'continue',
    title: 'AI 续写',
    content: '<p>建议内容</p>',
    reasoning: '基于上下文生成',
    contextUsed: ['当前章节末尾', '角色设定'],
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'p1',
    name: '主角',
    role: 'protagonist',
    color: '#amber-400',
    profile: {},
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

// ============ settingCard / blueprint fixtures ============
function makeSettingCard(overrides: Partial<ProjectSettingCard> = {}): ProjectSettingCard {
  return {
    title: '测试项目',
    genreTags: [],
    protagonist: {
      name: '林川',
      personalityKeywords: ['冷静', '果断'],
      coreDesire: '守护家族荣耀',
      goldenFinger: '时间回溯',
    },
    worldview: {
      powerSystem: '灵气修炼体系',
      basicRules: '强者为尊',
    },
    coreConflict: {},
    emotionalTone: 'hot-blooded',
    romanceType: 'none',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<BlueprintOverview> = {}): BlueprintOverview {
  return {
    mainline: '少年从低谷崛起，最终拯救世界',
    startPoint: '起点',
    turnPoints: [],
    endPoint: '终点',
    growthArc: [],
    characterFates: [],
    volumes: [],
    lockedAt: null,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  currentChapterId: string | null;
  chapters: Chapter[];
  aiSuggestions: AISuggestion[];
  characters: Character[];
  aiSettings: AISettings;
  clearAISuggestions: ReturnType<typeof vi.fn>;
  setPendingEditorInsert: ReturnType<typeof vi.fn>;
  updateAISettings: ReturnType<typeof vi.fn>;
  addAISuggestion: ReturnType<typeof vi.fn>;
  getSettingCard: ReturnType<typeof vi.fn>;
  getBlueprint: ReturnType<typeof vi.fn>;
}> = {}) {
  const clearAISuggestions = overrides.clearAISuggestions || vi.fn();
  const setPendingEditorInsert = overrides.setPendingEditorInsert || vi.fn();
  const updateAISettings = overrides.updateAISettings || vi.fn();
  const addAISuggestion = overrides.addAISuggestion || vi.fn();
  const getSettingCard = overrides.getSettingCard || vi.fn().mockReturnValue(null);
  const getBlueprint = overrides.getBlueprint || vi.fn().mockReturnValue(null);

  useAppStore.setState({
    currentChapterId: overrides.currentChapterId ?? null,
    chapters: overrides.chapters ?? [],
    aiSuggestions: overrides.aiSuggestions ?? [],
    characters: overrides.characters ?? [],
    aiSettings: overrides.aiSettings ?? makeAISettings(),
    clearAISuggestions,
    setPendingEditorInsert,
    updateAISettings,
    addAISuggestion,
    getSettingCard,
    getBlueprint,
  });

  return { clearAISuggestions, setPendingEditorInsert, updateAISettings, addAISuggestion, getSettingCard, getBlueprint };
}

describe('AIPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ============ 空状态渲染 ============
  describe('空状态渲染', () => {
    it('无章节、无建议时渲染空状态占位', () => {
      mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      expect(screen.getByText('点击上方按钮')).toBeInTheDocument();
      expect(screen.getByText('让 AI 帮你续写故事')).toBeInTheDocument();
    });

    it('标题渲染 "AI 助手"', () => {
      mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      expect(screen.getByText('AI 助手')).toBeInTheDocument();
    });
  });

  // ============ 设置面板 ============
  describe('设置面板', () => {
    it('默认隐藏，点击齿轮按钮后显示', () => {
      mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      // 默认不显示 "AI 提供商" 标签
      expect(screen.queryByText('AI 提供商')).not.toBeInTheDocument();
      // 点击齿轮按钮（SlidersHorizontal 图标的 button）
      const buttons = screen.getAllByRole('button');
      // 第一个 button 是齿轮（在 "AI 助手" 标题右侧）
      fireEvent.click(buttons[0]);
      expect(screen.getByText('AI 提供商')).toBeInTheDocument();
    });

    it('点击 Mock/Ollama/OpenAI/DeepSeek 调用 updateAISettings', () => {
      const { updateAISettings } = mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      // 打开设置
      fireEvent.click(screen.getAllByRole('button')[0]);
      // 点击 Ollama（local provider）
      fireEvent.click(screen.getByText('Ollama'));
      expect(updateAISettings).toHaveBeenCalledWith(expect.objectContaining({ provider: 'local' }));
    });

    it('点击风格按钮 "动作" 调用 updateAISettings({ style: "action" })', () => {
      const { updateAISettings } = mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('动作'));
      expect(updateAISettings).toHaveBeenCalledWith({ style: 'action' });
    });

    it('点击 "心理" 风格调用 updateAISettings({ style: "psychology" })', () => {
      const { updateAISettings } = mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('心理'));
      expect(updateAISettings).toHaveBeenCalledWith({ style: 'psychology' });
    });
  });

  // ============ Disabled 状态 ============
  describe('无章节时按钮 disabled', () => {
    it('无章节时各生成按钮均 disabled', () => {
      mockStore({ currentChapterId: null, chapters: [] });
      render(<AIPanel />);
      // 按指令生成（默认无指令文本，也会 disabled）
      expect(screen.getByText('按指令生成').closest('button')).toBeDisabled();
      // 智能续写
      expect(screen.getByText('智能续写').closest('button')).toBeDisabled();
      // 扩写
      expect(screen.getByText('扩写').closest('button')).toBeDisabled();
      // 润色
      expect(screen.getByText('润色').closest('button')).toBeDisabled();
    });

    it('有章节但无指令时"按指令生成"仍 disabled', () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      render(<AIPanel />);
      expect(screen.getByText('按指令生成').closest('button')).toBeDisabled();
      // 智能续写应可用（有章节且无生成中）
      expect(screen.getByText('智能续写').closest('button')).not.toBeDisabled();
    });

    it('有章节且有指令时"按指令生成"可点击', () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      expect(screen.getByText('按指令生成').closest('button')).not.toBeDisabled();
    });
  });

  // ============ 空指令错误 ============
  describe('空指令错误', () => {
    it('有章节但空指令时"按指令生成"按钮 disabled 且不调用 aiService', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      render(<AIPanel />);
      // 填入空白字符串（trim 后为空）
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '   ' } });
      // 按钮仍 disabled（instructionText.trim() 为空）
      expect(screen.getByText('按指令生成').closest('button')).toBeDisabled();
      // aiService.generateWritingByInstruction 不应被调用
      expect(aiService.generateWritingByInstruction).not.toHaveBeenCalled();
    });
  });

  // ============ 按指令生成成功 ============
  describe('按指令生成', () => {
    it('成功后调用 addAISuggestion({ title: "按指令生成" })', async () => {
      const chapter = makeChapter();
      const { addAISuggestion, clearAISuggestions } = mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateWritingByInstruction).mockResolvedValue('<p>生成的内容</p>');
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('按指令生成'));
      // 等待异步完成
      await waitFor(() => {
        expect(addAISuggestion).toHaveBeenCalledTimes(1);
      });
      expect(addAISuggestion).toHaveBeenCalledWith(expect.objectContaining({
        title: '按指令生成',
        content: '<p>生成的内容</p>',
      }));
      expect(clearAISuggestions).toHaveBeenCalled();
      expect(aiService.updateSettings).toHaveBeenCalled();
    });

    it('失败时调用 toast.error("按指令生成失败")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateWritingByInstruction).mockRejectedValue(new Error('网络错误'));
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('按指令生成'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('按指令生成失败', '网络错误');
      });
    });
  });

  // ============ 智能续写 ============
  describe('智能续写', () => {
    it('成功后调用 addAISuggestion({ title: "AI 续写" })', async () => {
      const chapter = makeChapter();
      const { addAISuggestion } = mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateContinuationStream).mockResolvedValue('<p>续写内容</p>');
      render(<AIPanel />);
      fireEvent.click(screen.getByText('智能续写'));
      await waitFor(() => {
        expect(addAISuggestion).toHaveBeenCalledTimes(1);
      });
      expect(addAISuggestion).toHaveBeenCalledWith(expect.objectContaining({
        title: 'AI 续写',
        content: '<p>续写内容</p>',
      }));
      expect(aiService.generateContinuationStream).toHaveBeenCalled();
    });

    it('失败时调用 toast.error("AI 续写失败")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateContinuationStream).mockRejectedValue(new Error('超时'));
      render(<AIPanel />);
      fireEvent.click(screen.getByText('智能续写'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('AI 续写失败', '超时');
      });
    });
  });

  // ============ 中止生成 ============
  describe('中止生成', () => {
    it('生成中显示"中止生成"按钮', async () => {
      const chapter = makeChapter();
      // 用一个 pending 的 Promise 让 isGenerating 保持 true
      vi.mocked(aiService.generateContinuationStream).mockImplementation(
        () => new Promise(() => {}), // 永不 resolve，保持生成中
      );
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      render(<AIPanel />);
      fireEvent.click(screen.getByText('智能续写'));
      // 等待 isGenerating=true 后渲染
      await waitFor(() => {
        expect(screen.getByText('中止生成')).toBeInTheDocument();
      });
    });
  });

  // ============ 多版本生成 ============
  describe('多版本生成', () => {
    it('成功后渲染版本卡片与"已生成 N 个版本"', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateMultipleVersions).mockResolvedValue([
        '<p>版本一</p>',
        '<p>版本二</p>',
        '<p>版本三</p>',
      ]);
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('生成多版本'));
      await waitFor(() => {
        expect(screen.getByText('已生成 3 个版本')).toBeInTheDocument();
      });
      expect(screen.getByText('版本 1')).toBeInTheDocument();
      expect(screen.getByText('版本 2')).toBeInTheDocument();
      expect(screen.getByText('版本 3')).toBeInTheDocument();
      // 温度描述
      expect(screen.getByText('基准温度')).toBeInTheDocument();
      expect(screen.getByText('温度 -0.2（保守）')).toBeInTheDocument();
      expect(screen.getByText('温度 +0.2（创意）')).toBeInTheDocument();
    });

    it('空结果时调用 toast.error("多版本生成失败", "所有版本均生成失败...")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateMultipleVersions).mockResolvedValue([]);
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('生成多版本'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('多版本生成失败', '所有版本均生成失败，请重试');
      });
    });

    it('点击"采纳"版本调用 setPendingEditorInsert(mode: "end") 并清空 versions', async () => {
      const chapter = makeChapter();
      const { setPendingEditorInsert } = mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateMultipleVersions).mockResolvedValue(['<p>版本一</p>']);
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('生成多版本'));
      await waitFor(() => {
        expect(screen.getByText('版本 1')).toBeInTheDocument();
      });
      // 点击"采纳"按钮（getAllByText 因为建议卡片也有"采纳"，但这里只有版本卡片）
      const applyBtns = screen.getAllByText('采纳');
      fireEvent.click(applyBtns[0]);
      expect(setPendingEditorInsert).toHaveBeenCalledWith(expect.objectContaining({
        chapterId: 'ch-1',
        content: '<p>版本一</p>',
        mode: 'end',
      }));
      // versions 清空后回到空状态
      await waitFor(() => {
        expect(screen.queryByText('版本 1')).not.toBeInTheDocument();
      });
    });
  });

  // ============ 采纳建议 ============
  describe('采纳建议', () => {
    it('点击建议"采纳"调用 setPendingEditorInsert + clearAISuggestions', async () => {
      const chapter = makeChapter();
      const suggestion = makeAISuggestion({ content: '<p>建议内容</p>' });
      const { setPendingEditorInsert, clearAISuggestions } = mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        aiSuggestions: [suggestion],
      });
      render(<AIPanel />);
      // 建议卡片渲染后，找到"采纳"按钮
      const applyBtn = screen.getByText('采纳');
      fireEvent.click(applyBtn);
      expect(setPendingEditorInsert).toHaveBeenCalledWith(expect.objectContaining({
        chapterId: 'ch-1',
        content: '<p>建议内容</p>',
        mode: 'end',
      }));
      expect(clearAISuggestions).toHaveBeenCalled();
    });

    it('点击"插入光标处"调用 setPendingEditorInsert(mode: "cursor")', () => {
      const chapter = makeChapter();
      const suggestion = makeAISuggestion({ content: '<p>建议内容</p>' });
      const { setPendingEditorInsert } = mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        aiSuggestions: [suggestion],
      });
      render(<AIPanel />);
      fireEvent.click(screen.getByText('插入光标处'));
      expect(setPendingEditorInsert).toHaveBeenCalledWith(expect.objectContaining({
        chapterId: 'ch-1',
        mode: 'cursor',
      }));
    });
  });

  // ============ 扩写菜单 ============
  describe('扩写菜单', () => {
    it('点击"扩写"展开 4 个子项', () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      render(<AIPanel />);
      // 默认子项不可见
      expect(screen.queryByText('丰富细节')).not.toBeInTheDocument();
      // 点击扩写按钮
      fireEvent.click(screen.getByText('扩写'));
      expect(screen.getByText('丰富细节')).toBeInTheDocument();
      expect(screen.getByText('增加对话')).toBeInTheDocument();
      expect(screen.getByText('环境描写')).toBeInTheDocument();
      expect(screen.getByText('心理活动')).toBeInTheDocument();
    });

    it('点击"丰富细节"调用 aiService.expandTextStream(type: "detail")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.expandTextStream).mockResolvedValue('<p>扩写后</p>');
      render(<AIPanel />);
      fireEvent.click(screen.getByText('扩写'));
      fireEvent.click(screen.getByText('丰富细节'));
      await waitFor(() => {
        expect(aiService.expandTextStream).toHaveBeenCalledWith(
          expect.any(String),
          'detail',
          expect.any(Object),
          expect.any(AbortSignal),
        );
      });
    });
  });

  // ============ 测试连接 ============
  describe('测试连接', () => {
    it('成功时显示成功提示', async () => {
      mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'local' }),
      });
      vi.mocked(aiService.testConnection).mockResolvedValue({ success: true, message: '连接成功' });
      render(<AIPanel />);
      // 打开设置
      fireEvent.click(screen.getAllByRole('button')[0]);
      // provider 已是 local，"测试连接" 按钮可见
      fireEvent.click(screen.getByText('测试连接'));
      await waitFor(() => {
        expect(screen.getByText('连接成功')).toBeInTheDocument();
      });
    });

    it('失败时显示错误提示', async () => {
      mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'local' }),
      });
      vi.mocked(aiService.testConnection).mockResolvedValue({ success: false, message: '连接失败' });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('测试连接'));
      await waitFor(() => {
        expect(screen.getByText('连接失败')).toBeInTheDocument();
      });
    });
  });

  // ============ 建议卡片渲染 ============
  describe('建议卡片', () => {
    it('渲染建议标题与"生成依据"', () => {
      const chapter = makeChapter();
      const suggestion = makeAISuggestion({
        title: 'AI 续写',
        content: '<p>建议内容</p>',
        contextUsed: ['当前章节末尾', '角色设定'],
      });
      mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        aiSuggestions: [suggestion],
      });
      render(<AIPanel />);
      expect(screen.getByText('AI 续写')).toBeInTheDocument();
      // 生成依据拼接为 "当前章节末尾、角色设定"
      expect(screen.getByText(/当前章节末尾/)).toBeInTheDocument();
      expect(screen.getByText(/角色设定/)).toBeInTheDocument();
    });
  });

  // ============ 润色 ============
  describe('润色', () => {
    it('成功后调用 addAISuggestion({ title: "润色优化" })', async () => {
      const chapter = makeChapter();
      const { addAISuggestion, clearAISuggestions } = mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.polishTextStream).mockResolvedValue('<p>润色后</p>');
      render(<AIPanel />);
      fireEvent.click(screen.getByText('润色'));
      await waitFor(() => {
        expect(addAISuggestion).toHaveBeenCalledTimes(1);
      });
      expect(addAISuggestion).toHaveBeenCalledWith(expect.objectContaining({
        type: 'polish',
        title: '润色优化',
        content: '<p>润色后</p>',
      }));
      expect(clearAISuggestions).toHaveBeenCalled();
      expect(aiService.polishTextStream).toHaveBeenCalled();
    });

    it('失败时调用 toast.error("AI 润色失败")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.polishTextStream).mockRejectedValue(new Error('润色超时'));
      render(<AIPanel />);
      fireEvent.click(screen.getByText('润色'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('AI 润色失败', '润色超时');
      });
    });
  });

  // ============ 换视角 ============
  describe('换视角', () => {
    it('成功后调用 addAISuggestion（以主角名为参数）', async () => {
      const chapter = makeChapter();
      const character = makeCharacter({ id: 'char-1', name: '林川', role: 'protagonist' });
      const { addAISuggestion } = mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        characters: [character],
      });
      const suggestion = makeAISuggestion({ title: '换视角', content: '<p>换视角内容</p>' });
      vi.mocked(aiService.switchPerspective).mockResolvedValue(suggestion);
      render(<AIPanel />);
      fireEvent.click(screen.getByText('换视角'));
      await waitFor(() => {
        expect(addAISuggestion).toHaveBeenCalledWith(suggestion);
      });
      expect(aiService.switchPerspective).toHaveBeenCalledWith(expect.any(String), '林川');
    });

    it('失败时调用 toast.error("换视角失败")', async () => {
      const chapter = makeChapter();
      const character = makeCharacter({ id: 'char-1', name: '林川' });
      mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        characters: [character],
      });
      vi.mocked(aiService.switchPerspective).mockRejectedValue(new Error('不支持换视角'));
      render(<AIPanel />);
      fireEvent.click(screen.getByText('换视角'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('换视角失败', '不支持换视角');
      });
    });

    it('无角色时"换视角"按钮 disabled', () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter], characters: [] });
      render(<AIPanel />);
      expect(screen.getByText('换视角').closest('button')).toBeDisabled();
    });
  });

  // ============ 扩写其他类型 + catch ============
  describe('扩写其他类型', () => {
    it('点击"增加对话"调用 expandTextStream(type: "dialogue")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.expandTextStream).mockResolvedValue('<p>对话内容</p>');
      render(<AIPanel />);
      fireEvent.click(screen.getByText('扩写'));
      fireEvent.click(screen.getByText('增加对话'));
      await waitFor(() => {
        expect(aiService.expandTextStream).toHaveBeenCalledWith(
          expect.any(String),
          'dialogue',
          expect.any(Object),
          expect.any(AbortSignal),
        );
      });
    });

    it('点击"环境描写"调用 expandTextStream(type: "environment")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.expandTextStream).mockResolvedValue('<p>环境描写</p>');
      render(<AIPanel />);
      fireEvent.click(screen.getByText('扩写'));
      fireEvent.click(screen.getByText('环境描写'));
      await waitFor(() => {
        expect(aiService.expandTextStream).toHaveBeenCalledWith(
          expect.any(String), 'environment', expect.any(Object), expect.any(AbortSignal),
        );
      });
    });

    it('点击"心理活动"调用 expandTextStream(type: "psychology")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.expandTextStream).mockResolvedValue('<p>心理活动</p>');
      render(<AIPanel />);
      fireEvent.click(screen.getByText('扩写'));
      fireEvent.click(screen.getByText('心理活动'));
      await waitFor(() => {
        expect(aiService.expandTextStream).toHaveBeenCalledWith(
          expect.any(String), 'psychology', expect.any(Object), expect.any(AbortSignal),
        );
      });
    });

    it('扩写失败时调用 toast.error("AI 扩写失败")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.expandTextStream).mockRejectedValue(new Error('扩写超时'));
      render(<AIPanel />);
      fireEvent.click(screen.getByText('扩写'));
      fireEvent.click(screen.getByText('丰富细节'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('AI 扩写失败', '扩写超时');
      });
    });
  });

  // ============ 多版本插入光标处 ============
  describe('多版本插入光标处', () => {
    it('点击版本"插入光标处"调用 setPendingEditorInsert(mode: "cursor")', async () => {
      const chapter = makeChapter();
      const { setPendingEditorInsert } = mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateMultipleVersions).mockResolvedValue(['<p>版本一</p>']);
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('生成多版本'));
      await waitFor(() => {
        expect(screen.getByText('版本 1')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('插入光标处'));
      expect(setPendingEditorInsert).toHaveBeenCalledWith(expect.objectContaining({
        chapterId: 'ch-1',
        content: '<p>版本一</p>',
        mode: 'cursor',
      }));
      // versions 清空
      await waitFor(() => {
        expect(screen.queryByText('版本 1')).not.toBeInTheDocument();
      });
    });
  });

  // ============ 多版本生成中 + 清空 ============
  describe('多版本生成中卡片', () => {
    it('生成中显示"正在并发生成多个版本..."', async () => {
      const chapter = makeChapter();
      vi.mocked(aiService.generateMultipleVersions).mockImplementation(() => new Promise(() => {}));
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('生成多版本'));
      await waitFor(() => {
        expect(screen.getByText('正在并发生成多个版本...')).toBeInTheDocument();
      });
    });

    it('版本列表"清空"按钮点击后版本消失', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateMultipleVersions).mockResolvedValue(['<p>V1</p>', '<p>V2</p>']);
      render(<AIPanel />);
      const textarea = screen.getByPlaceholderText(/写一段主角与反派/);
      fireEvent.change(textarea, { target: { value: '写一段对峙场景' } });
      fireEvent.click(screen.getByText('生成多版本'));
      await waitFor(() => {
        expect(screen.getByText('已生成 2 个版本')).toBeInTheDocument();
      });
      // 点击"已生成 N 个版本"右侧的 X 清空按钮
      const versionHeader = screen.getByText('已生成 2 个版本').closest('div');
      const clearBtn = versionHeader?.querySelector('button') as HTMLElement;
      fireEvent.click(clearBtn);
      await waitFor(() => {
        expect(screen.queryByText('已生成 2 个版本')).not.toBeInTheDocument();
      });
    });
  });

  // ============ 设定巡航面板 ============
  describe('设定巡航面板', () => {
    it('settingCard 非空时渲染设定巡航面板（主角/世界观/故事主线）', () => {
      const chapter = makeChapter();
      mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        getSettingCard: vi.fn().mockReturnValue(makeSettingCard()),
        getBlueprint: vi.fn().mockReturnValue(makeBlueprint()),
      });
      render(<AIPanel />);
      expect(screen.getByText('设定巡航')).toBeInTheDocument();
      // 主角卡
      expect(screen.getByText('主角 · 林川')).toBeInTheDocument();
      expect(screen.getByText(/性格：冷静、果断/)).toBeInTheDocument();
      expect(screen.getByText(/核心欲望：守护家族荣耀/)).toBeInTheDocument();
      expect(screen.getByText(/金手指：时间回溯/)).toBeInTheDocument();
      // 世界观
      expect(screen.getByText(/力量体系：灵气修炼体系/)).toBeInTheDocument();
      expect(screen.getByText(/基础规则：强者为尊/)).toBeInTheDocument();
      // 故事主线
      expect(screen.getByText('故事主线')).toBeInTheDocument();
      expect(screen.getByText('少年从低谷崛起，最终拯救世界')).toBeInTheDocument();
    });

    it('settingCard 各字段为空时仅渲染标题行', () => {
      const chapter = makeChapter();
      mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        getSettingCard: vi.fn().mockReturnValue(makeSettingCard({
          protagonist: { name: '', personalityKeywords: [], coreDesire: undefined, goldenFinger: undefined },
          worldview: { powerSystem: undefined, basicRules: undefined },
        })),
        getBlueprint: vi.fn().mockReturnValue(makeBlueprint({ mainline: '' })),
      });
      render(<AIPanel />);
      expect(screen.getByText('设定巡航')).toBeInTheDocument();
      // 名字为空时显示"未命名"
      expect(screen.getByText('主角 · 未命名')).toBeInTheDocument();
      // 各字段为空时不渲染对应行
      expect(screen.queryByText(/性格：/)).not.toBeInTheDocument();
      expect(screen.queryByText(/核心欲望：/)).not.toBeInTheDocument();
      expect(screen.queryByText(/金手指：/)).not.toBeInTheDocument();
      expect(screen.queryByText(/力量体系：/)).not.toBeInTheDocument();
      expect(screen.queryByText(/基础规则：/)).not.toBeInTheDocument();
      // 无 mainline 时不渲染故事主线
      expect(screen.queryByText('故事主线')).not.toBeInTheDocument();
    });

    it('点击"设定巡航"按钮切换折叠状态', () => {
      const chapter = makeChapter();
      mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        getSettingCard: vi.fn().mockReturnValue(makeSettingCard()),
      });
      render(<AIPanel />);
      // 初始展开（showCruise 默认 true）
      expect(screen.getByText('主角 · 林川')).toBeInTheDocument();
      // 点击折叠
      fireEvent.click(screen.getByText('设定巡航'));
      expect(screen.queryByText('主角 · 林川')).not.toBeInTheDocument();
      // 再次点击展开
      fireEvent.click(screen.getByText('设定巡航'));
      expect(screen.getByText('主角 · 林川')).toBeInTheDocument();
    });

    it('settingCard 为 null 时不渲染设定巡航面板', () => {
      const chapter = makeChapter();
      mockStore({
        currentChapterId: 'ch-1',
        chapters: [chapter],
        getSettingCard: vi.fn().mockReturnValue(null),
      });
      render(<AIPanel />);
      expect(screen.queryByText('设定巡航')).not.toBeInTheDocument();
    });
  });

  // ============ 防抖更新 ============
  describe('防抖更新', () => {
    it('baseUrl 输入后 300ms 调用 updateAISettings', async () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'local', baseUrl: '' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]); // 打开设置
      const baseUrlInput = screen.getByPlaceholderText('http://localhost:11434');
      fireEvent.change(baseUrlInput, { target: { value: 'http://new-host:1234' } });
      // 未到 300ms 时不应写入
      expect(updateAISettings).not.toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'http://new-host:1234' }));
      // 推进 300ms
      await vi.advanceTimersByTimeAsync(300);
      expect(updateAISettings).toHaveBeenCalledWith({ baseUrl: 'http://new-host:1234' });
    });

    it('model 输入后 300ms 调用 updateAISettings', async () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'local', model: '' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      const modelInput = screen.getByPlaceholderText('qwen2.5:7b');
      fireEvent.change(modelInput, { target: { value: 'llama3:8b' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(updateAISettings).toHaveBeenCalledWith({ model: 'llama3:8b' });
    });

    it('连续输入两次合并为一次 updateAISettings', async () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'local', baseUrl: '' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      const baseUrlInput = screen.getByPlaceholderText('http://localhost:11434');
      fireEvent.change(baseUrlInput, { target: { value: 'http://a' } });
      fireEvent.change(baseUrlInput, { target: { value: 'http://ab' } });
      await vi.advanceTimersByTimeAsync(300);
      // 合并为最后一次的值
      expect(updateAISettings).toHaveBeenCalledWith({ baseUrl: 'http://ab' });
      // 只调用一次
      const debouncedCalls = vi.mocked(updateAISettings).mock.calls.filter(
        (call: unknown[]) => call[0] && typeof call[0] === 'object' && 'baseUrl' in (call[0] as Record<string, unknown>)
      );
      expect(debouncedCalls.length).toBe(1);
    });
  });

  // ============ provider 切换 openai / deepseek ============
  describe('provider 切换默认值', () => {
    it('切换到 OpenAI 且无 baseUrl/model 时填充默认值', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'mock', baseUrl: '', model: '' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('OpenAI'));
      expect(updateAISettings).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4o-mini',
      }));
    });

    it('切换到 DeepSeek 且无 baseUrl/model 时填充默认值', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'mock', baseUrl: '', model: '' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('DeepSeek'));
      expect(updateAISettings).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
      }));
    });

    it('切换到 OpenAI 时已有 baseUrl/model 不被覆盖', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'mock', baseUrl: 'https://custom', model: 'custom-model' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('OpenAI'));
      expect(updateAISettings).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'openai',
        // 不应包含 baseUrl/model（已有值时不覆盖）
      }));
      // 确认 baseUrl/model 未被覆盖
      const call = vi.mocked(updateAISettings).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.provider === 'openai'
      );
      expect((call?.[0] as Record<string, unknown>)?.baseUrl).toBeUndefined();
      expect((call?.[0] as Record<string, unknown>)?.model).toBeUndefined();
    });

    it('provider 为 openai 时渲染 API Key 输入框', () => {
      mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      expect(screen.getByText('API Key')).toBeInTheDocument();
    });
  });

  // ============ slider / number input onChange ============
  describe('写作风格参数 onChange', () => {
    it('调整"描写浓度" slider 调用 updateAISettings', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ descriptionDensity: 50 }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      // 找到"描写浓度"对应的 range input
      const label = screen.getByText('描写浓度');
      const sliderWrapper = label.closest('div')?.parentElement;
      const rangeInput = sliderWrapper?.querySelector('input[type="range"]') as HTMLElement;
      fireEvent.change(rangeInput, { target: { value: '80' } });
      expect(updateAISettings).toHaveBeenCalledWith({ descriptionDensity: 80 });
    });

    it('调整"对话浓度" slider 调用 updateAISettings', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ dialogueDensity: 50 }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      const label = screen.getByText('对话浓度');
      const sliderWrapper = label.closest('div')?.parentElement;
      const rangeInput = sliderWrapper?.querySelector('input[type="range"]') as HTMLElement;
      fireEvent.change(rangeInput, { target: { value: '30' } });
      expect(updateAISettings).toHaveBeenCalledWith({ dialogueDensity: 30 });
    });

    it('调整"严守设定" slider 调用 updateAISettings', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ strictness: 50 }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      const label = screen.getByText('严守设定');
      const sliderWrapper = label.closest('div')?.parentElement;
      const rangeInput = sliderWrapper?.querySelector('input[type="range"]') as HTMLElement;
      fireEvent.change(rangeInput, { target: { value: '90' } });
      expect(updateAISettings).toHaveBeenCalledWith({ strictness: 90 });
    });

    it('调整"创造性" slider 调用 updateAISettings', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ temperature: 0.7 }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      const label = screen.getByText('创造性 (Temperature)');
      const sliderWrapper = label.closest('div')?.parentElement;
      const rangeInput = sliderWrapper?.querySelector('input[type="range"]') as HTMLElement;
      fireEvent.change(rangeInput, { target: { value: '1.5' } });
      expect(updateAISettings).toHaveBeenCalledWith({ temperature: 1.5 });
    });

    it('修改"最大生成长度" input 调用 updateAISettings', () => {
      const { updateAISettings } = mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ maxTokens: 2048 }),
      });
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      const maxTokensInput = screen.getByPlaceholderText('2000');
      fireEvent.change(maxTokensInput, { target: { value: '4096' } });
      expect(updateAISettings).toHaveBeenCalledWith({ maxTokens: 4096 });
    });
  });

  // ============ 测试连接抛错 ============
  describe('测试连接抛错', () => {
    it('testConnection 抛出异常时 toast.error("连接测试失败")', async () => {
      mockStore({
        currentChapterId: null,
        chapters: [],
        aiSettings: makeAISettings({ provider: 'local' }),
      });
      vi.mocked(aiService.testConnection).mockRejectedValue(new Error('网络异常'));
      render(<AIPanel />);
      fireEvent.click(screen.getAllByRole('button')[0]);
      fireEvent.click(screen.getByText('测试连接'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('连接测试失败', '网络异常');
      });
      // testResult 也应被设置为失败
      expect(screen.getByText('网络异常')).toBeInTheDocument();
    });
  });

  // ============ 流式 chunk 回调 ============
  describe('流式 chunk 回调', () => {
    it('续写流式 onChunk 触发后渲染"AI 生成中..."卡片与 streamingContent', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateContinuationStream).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_text: any, _summary: any, _chars: any, _style: any, handler: any, _signal: any) => {
          handler.onChunk('片段一');
          handler.onChunk('片段二');
          handler.onComplete();
          return Promise.resolve('完整内容');
        },
      );
      render(<AIPanel />);
      fireEvent.click(screen.getByText('智能续写'));
      await waitFor(() => {
        expect(screen.getByText('AI 生成中...')).toBeInTheDocument();
      });
    });

    it('续写流式 onError 触发后 toast.error("AI 续写失败")', async () => {
      const chapter = makeChapter();
      mockStore({ currentChapterId: 'ch-1', chapters: [chapter] });
      vi.mocked(aiService.generateContinuationStream).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_text: any, _summary: any, _chars: any, _style: any, handler: any, _signal: any) => {
          handler.onError(new Error('流式中断'));
          return Promise.resolve('');
        },
      );
      render(<AIPanel />);
      fireEvent.click(screen.getByText('智能续写'));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('AI 续写失败', '流式中断');
      });
    });
  });
});
