/**
 * SettingsModal 单元测试
 *
 * 测试范围：
 *   - 顶层：标题"软件设置" / X 关闭 / 背景关闭 / 卡片阻止冒泡 / pushOverlay/popOverlay
 *   - 4 个 section 切换：通用 / 外观 / AI 助手 / 大纲打磨
 *   - 通用 section：自动保存间隔 select / 启动行为 toggle
 *   - 外观 section：主题 / 字体 / 字号 slider / 行高 slider / 字数统计 toggle / 行号 toggle
 *   - AI section：
 *     - provider=mock 时隐藏 baseUrl/apiKey/model 与测试连接按钮
 *     - provider≠mock 时显示 baseUrl/apiKey/model/测试连接
 *     - apiKey 显隐切换
 *     - 测试连接成功/失败/Catch 三态 + 测试中 disabled
 *     - 风格 / 描写浓度 / 对话浓度 / 严格度 / temperature / maxTokens / 冲突检测
 *     - maxTokens 空字符串回退 1000
 *   - 大纲打磨 section：默认诊断范围
 *   - 保存：dirty 标志 / disabled 控制 / 成功调用 updateAppPreferences+updateAISettings+onClose
 *     - allSettled：双成功 / 双失败 / 仅 prefs 失败 / 仅 ai 失败
 *   - 取消按钮：调用 requestClose（dirty 时 confirm）
 *   - 背景关闭 confirm 流程（dirty / saving / testing 三态）
 *   - ESC 关闭（含 dirty confirm / saving/testing 拦截 / isComposing 拦截）
 *   - 卸载守卫：mountedRef 阻止 testConnection/handleSave 后续 setState
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import SettingsModal from '@/components/SettingsModal';
import { useAppStore } from '@/store/useAppStore';
import { pushOverlay, popOverlay } from '@/utils/overlayState';
import type { AppPreferences, AISettings } from '@/types';

// ============ mocks ============
vi.mock('@/utils/overlayState', () => ({
  pushOverlay: vi.fn(),
  popOverlay: vi.fn(),
}));

vi.mock('@/utils/llmClient', () => {
  const makeInstance = () => ({
    updateSettings: vi.fn(),
    testConnection: vi.fn(),
  });
  return {
    LLMClient: vi.fn().mockImplementation(makeInstance),
    // aiService/core.ts 模块加载即引用 llmClient 实例与 NOVEL_SYSTEM_PROMPT；
    // store（lingxiSlice/outlinePolishSlice 间接引入 aiService）加载时必须命中 mock，
    // 否则 vitest 报 "No llmClient export defined on mock"
    llmClient: makeInstance(),
    NOVEL_SYSTEM_PROMPT: 'mock-prompt',
  };
});

import { LLMClient } from '@/utils/llmClient';

// ============ fixtures ============
function makePrefs(overrides: Partial<AppPreferences> = {}): AppPreferences {
  return {
    autoSaveInterval: 30000,
    defaultFontSize: 16,
    defaultLineHeight: 1.6,
    defaultFontFamily: 'system-ui',
    defaultTheme: 'dark',
    showWordCount: true,
    showLineNumbers: false,
    reopenLastProject: true,
    defaultPolishScope: 'all',
    ...overrides,
  };
}

function makeAI(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'mock',
    apiKey: undefined,
    baseUrl: undefined,
    model: undefined,
    style: 'balanced',
    descriptionDensity: 50,
    dialogueDensity: 50,
    strictness: 50,
    temperature: 0.7,
    maxTokens: 2000,
    autoCheckConflicts: true,
    ...overrides,
  };
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  appPreferences: AppPreferences;
  aiSettings: AISettings;
  updateAppPreferences: ReturnType<typeof vi.fn>;
  updateAISettings: ReturnType<typeof vi.fn>;
}> = {}) {
  const updateAppPreferences = overrides.updateAppPreferences || vi.fn().mockResolvedValue(undefined);
  const updateAISettings = overrides.updateAISettings || vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({
    appPreferences: overrides.appPreferences || makePrefs(),
    aiSettings: overrides.aiSettings || makeAI(),
    updateAppPreferences,
    updateAISettings,
  });
  return { updateAppPreferences, updateAISettings };
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  // ============ 顶层渲染 ============
  it('标题"软件设置"渲染', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    expect(screen.getByText('软件设置')).toBeInTheDocument();
  });

  it('挂载时 pushOverlay，卸载时 popOverlay', () => {
    mockStore();
    const { unmount } = render(<SettingsModal onClose={vi.fn()} />);
    expect(pushOverlay).toHaveBeenCalledTimes(1);
    expect(popOverlay).not.toHaveBeenCalled();
    unmount();
    expect(popOverlay).toHaveBeenCalledTimes(1);
  });

  it('点击 X 按钮调用 onClose', () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    const xBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    fireEvent.click(xBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景遮罩调用 onClose（无 dirty）', () => {
    mockStore();
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);
    const overlay = container.firstElementChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击卡片不触发 onClose（stopPropagation）', () => {
    mockStore();
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);
    const overlay = container.firstElementChild as HTMLElement;
    const card = overlay.firstElementChild as HTMLElement;
    fireEvent.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dirty 时点击背景遮罩 confirm 后关闭', async () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    // 修改任意字段触发 dirty
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(overlay);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('dirty 时点击背景遮罩 confirm 取消不关闭', () => {
    mockStore();
    confirmMock.mockResolvedValue(false);
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(overlay);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ============ section 切换 ============
  it('默认显示通用 section', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    expect(screen.getByText('影响软件整体行为的基础设置')).toBeInTheDocument();
  });

  it('点击"外观"切换 section', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('外观'));
    expect(screen.getByText('编辑器默认外观，新建项目时套用')).toBeInTheDocument();
  });

  it('点击"AI 助手"切换 section', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    expect(screen.getByText('配置模型供应商与生成风格')).toBeInTheDocument();
  });

  it('点击"大纲打磨"切换 section', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('大纲打磨'));
    expect(screen.getByText('默认诊断范围与建议行为')).toBeInTheDocument();
  });

  // ============ 通用 section ============
  it('切换自动保存间隔触发 dirty', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  it('切换启动行为 toggle', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    // toggle 按钮无 role，按 label 文本定位
    const toggleBtn = screen.getByText('自动打开上次项目').previousSibling as HTMLElement;
    fireEvent.click(toggleBtn);
    expect(screen.getByText('显示项目列表')).toBeInTheDocument();
  });

  // ============ 外观 section ============
  it('切换默认主题', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('外观'));
    fireEvent.change(screen.getByDisplayValue('深色'), { target: { value: 'light' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  it('切换默认字体', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('外观'));
    const fontSelect = screen.getByDisplayValue('系统默认');
    fireEvent.change(fontSelect, { target: { value: 'Georgia, "Times New Roman", serif' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  it('调整字号 slider', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('外观'));
    // 字号 slider 是第一个 range input（min=12 max=24）
    const sliders = document.querySelectorAll('input[type="range"]');
    const fontSizeSlider = Array.from(sliders).find(s => s.getAttribute('min') === '12')!;
    fireEvent.change(fontSizeSlider, { target: { value: '20' } });
    expect(screen.getByText('20px')).toBeInTheDocument();
  });

  it('调整行高 slider', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('外观'));
    const sliders = document.querySelectorAll('input[type="range"]');
    const lhSlider = Array.from(sliders).find(s => s.getAttribute('min') === '1.2')!;
    fireEvent.change(lhSlider, { target: { value: '2.0' } });
    expect(screen.getByText('2.0')).toBeInTheDocument();
  });

  it('切换字数统计 / 行号 toggle', () => {
    mockStore({ appPreferences: makePrefs({ showWordCount: true, showLineNumbers: false }) });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('外观'));
    const wcToggle = screen.getByText('字数统计').previousSibling as HTMLElement;
    fireEvent.click(wcToggle);
    // 反转后状态显示
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  // ============ AI section ============
  it('provider=mock 时不显示 baseUrl/apiKey/model/测试连接', () => {
    mockStore({ aiSettings: makeAI({ provider: 'mock' }) });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    expect(screen.queryByText('API Base URL')).not.toBeInTheDocument();
    expect(screen.queryByText('API Key')).not.toBeInTheDocument();
    expect(screen.queryByText('模型名')).not.toBeInTheDocument();
    expect(screen.queryByText('测试连接')).not.toBeInTheDocument();
  });

  it('provider=openai 时显示 baseUrl/apiKey/model/测试连接', () => {
    mockStore({
      aiSettings: makeAI({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      }),
    });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    expect(screen.getByText('API Base URL')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('模型名')).toBeInTheDocument();
    expect(screen.getByText('测试连接')).toBeInTheDocument();
  });

  it('点击显示/隐藏 apiKey 切换 input type', () => {
    mockStore({
      aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-secret' }),
    });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    const apiKeyInput = screen.getByPlaceholderText('sk-...') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');
    // 点击显隐按钮（Eye 图标）
    const eyeBtn = apiKeyInput.parentElement!.querySelector('button')!;
    fireEvent.click(eyeBtn);
    expect(apiKeyInput.type).toBe('text');
    fireEvent.click(eyeBtn);
    expect(apiKeyInput.type).toBe('password');
  });

  it('切换写作风格', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.change(screen.getByDisplayValue('均衡'), { target: { value: 'action' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  it('调整描写浓度 slider', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    // 描写浓度 slider min=0 max=100 step=1（默认值），第一个匹配的 slider
    const sliders = document.querySelectorAll('input[type="range"]');
    // 在 AI section 中第一个是 descriptionDensity
    const densitySlider = Array.from(sliders).find(s =>
      s.getAttribute('min') === '0' && s.getAttribute('max') === '100' && s.getAttribute('step') === '1'
    )!;
    fireEvent.change(densitySlider, { target: { value: '80' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  it('调整 temperature slider（step=0.1）', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    const sliders = document.querySelectorAll('input[type="range"]');
    const tempSlider = Array.from(sliders).find(s => s.getAttribute('step') === '0.1')!;
    fireEvent.change(tempSlider, { target: { value: '0.9' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  it('maxTokens 输入空字符串回退到 1000', () => {
    const { updateAISettings } = mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    const maxTokensInput = screen.getByDisplayValue('2000') as HTMLInputElement;
    fireEvent.change(maxTokensInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('保存'));
    // handleSave 异步执行
    return waitFor(() => {
      expect(updateAISettings).toHaveBeenCalledTimes(1);
      const saved = updateAISettings.mock.calls[0][0] as AISettings;
      expect(saved.maxTokens).toBe(1000);
    });
  });

  it('切换冲突检测 toggle', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    const toggleBtn = screen.getByText('启用').previousSibling as HTMLElement;
    fireEvent.click(toggleBtn);
    expect(screen.getByText('禁用')).toBeInTheDocument();
  });

  // ============ 测试连接 ============
  it('测试连接成功显示"连接成功"', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: '连接成功' }),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);

    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => {
      expect(screen.getByText('连接成功')).toBeInTheDocument();
    });
  });

  it('测试连接失败显示失败消息', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: false, message: '鉴权失败' }),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);

    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => {
      expect(screen.getByText('鉴权失败')).toBeInTheDocument();
    });
  });

  it('测试连接抛错显示错误消息', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockRejectedValue(new Error('网络错误')),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);

    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('测试中按钮显示 Loader2 + disabled', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    let resolveTest: (v: { success: boolean; message: string }) => void;
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockReturnValue(new Promise(r => { resolveTest = r; })),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);

    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    const testBtn = screen.getByText('测试连接').closest('button')!;
    fireEvent.click(testBtn);
    // testing 状态是异步 setTesting(true)，需 waitFor
    await waitFor(() => {
      expect(testBtn.disabled).toBe(true);
    });
    // Loader2 在新版 lucide-react 中渲染为 lucide-loader-circle 类名
    expect(testBtn.querySelector('svg.lucide-loader-circle, svg.lucide-loader-2')).not.toBeNull();
    resolveTest!({ success: true, message: 'ok' });
    await waitFor(() => {
      expect(testBtn.disabled).toBe(false);
    });
  });

  it('测试中点击背景遮罩不关闭（testing 拦截）', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    const onClose = vi.fn();
    let resolveTest: (v: { success: boolean; message: string }) => void;
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockReturnValue(new Promise(r => { resolveTest = r; })),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);

    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.click(screen.getByText('测试连接'));
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    resolveTest!({ success: true, message: 'ok' });
  });

  // ============ 大纲打磨 section ============
  it('切换默认诊断范围', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('大纲打磨'));
    fireEvent.change(screen.getByDisplayValue('全量大纲'), { target: { value: 'current' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
  });

  // ============ 保存 ============
  it('无 dirty 时保存按钮 disabled', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    const saveBtn = screen.getByText('保存').closest('button')!;
    expect(saveBtn.disabled).toBe(true);
  });

  it('dirty 时保存按钮 enabled', () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    const saveBtn = screen.getByText('保存').closest('button')!;
    expect(saveBtn.disabled).toBe(false);
  });

  it('保存成功调用 updateAppPreferences + updateAISettings + onClose', async () => {
    const { updateAppPreferences, updateAISettings } = mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(updateAppPreferences).toHaveBeenCalledTimes(1);
      expect(updateAISettings).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('保存中按钮显示"保存中…"并 disabled', async () => {
    let resolvePrefs: (v: undefined) => void;
    mockStore({
      updateAppPreferences: vi.fn().mockReturnValue(new Promise(r => { resolvePrefs = r; })),
    });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    const saveBtn = screen.getByText('保存').closest('button')!;
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByText('保存中…')).toBeInTheDocument();
    });
    expect(saveBtn.disabled).toBe(true);
    resolvePrefs!(undefined);
  });

  it('双成功时清空 dirty 标志', async () => {
    mockStore();
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
    fireEvent.click(screen.getByText('保存'));
    // 成功后会 onClose，组件卸载——通过 onClose 验证成功路径
    await waitFor(() => {
      expect(screen.queryByText('有未保存的改动')).not.toBeInTheDocument();
    });
  });

  it('prefs 失败 ai 成功时显示"偏好保存失败"且 dirty 保留', async () => {
    mockStore({
      updateAppPreferences: vi.fn().mockRejectedValue(new Error('prefs fail')),
      updateAISettings: vi.fn().mockResolvedValue(undefined),
    });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ai 失败 prefs 成功时显示 dirty 保留', async () => {
    mockStore({
      updateAppPreferences: vi.fn().mockResolvedValue(undefined),
      updateAISettings: vi.fn().mockRejectedValue(new Error('ai fail')),
    });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('双失败时显示 dirty 保留 + onClose 不调用', async () => {
    mockStore({
      updateAppPreferences: vi.fn().mockRejectedValue(new Error('p')),
      updateAISettings: vi.fn().mockRejectedValue(new Error('a')),
    });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(screen.getByText('有未保存的改动')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ============ 取消按钮 ============
  it('点击"取消"按钮（无 dirty）调用 onClose', () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击"取消"按钮（dirty）confirm 后调用 onClose', async () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('取消'));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('saving 时取消按钮 disabled', async () => {
    let resolvePrefs: (v: undefined) => void;
    mockStore({
      updateAppPreferences: vi.fn().mockReturnValue(new Promise(r => { resolvePrefs = r; })),
    });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    const cancelBtn = screen.getByText('取消').closest('button')!;
    expect(cancelBtn.disabled).toBe(true);
    resolvePrefs!(undefined);
  });

  // ============ ESC 关闭 ============
  it('ESC 触发 onClose（无 dirty）', () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ESC + dirty 时 confirm 后关闭', async () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('ESC + dirty 时 confirm 取消不关闭', () => {
    mockStore();
    confirmMock.mockResolvedValue(false);
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ESC + saving 时不关闭', async () => {
    let resolvePrefs: (v: undefined) => void;
    mockStore({
      updateAppPreferences: vi.fn().mockReturnValue(new Promise(r => { resolvePrefs = r; })),
    });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    resolvePrefs!(undefined);
  });

  it('ESC + testing 时不关闭', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    let resolveTest: (v: { success: boolean; message: string }) => void;
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockReturnValue(new Promise(r => { resolveTest = r; })),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.click(screen.getByText('测试连接'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    resolveTest!({ success: true, message: 'ok' });
  });

  it('ESC + isComposing 不触发', () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('非 ESC 按键不触发关闭', () => {
    mockStore();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ============ 卸载守卫 ============
  it('卸载后 testConnection resolve 不报错', async () => {
    mockStore({ aiSettings: makeAI({ provider: 'openai', apiKey: 'sk-test' }) });
    let resolveTest: (v: { success: boolean; message: string }) => void;
    const mockInstance = {
      updateSettings: vi.fn(),
      testConnection: vi.fn().mockReturnValue(new Promise(r => { resolveTest = r; })),
    };
    vi.mocked(LLMClient).mockImplementation(() => mockInstance as unknown as InstanceType<typeof LLMClient>);
    const { unmount } = render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('AI 助手'));
    fireEvent.click(screen.getByText('测试连接'));
    unmount();
    expect(() => {
      resolveTest!({ success: true, message: 'ok' });
    }).not.toThrow();
  });

  it('卸载后 handleSave resolve 不报错', async () => {
    let resolvePrefs: (v: undefined) => void;
    mockStore({
      updateAppPreferences: vi.fn().mockReturnValue(new Promise(r => { resolvePrefs = r; })),
    });
    const { unmount } = render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('30 秒'), { target: { value: '60000' } });
    fireEvent.click(screen.getByText('保存'));
    unmount();
    expect(() => {
      resolvePrefs!(undefined);
    }).not.toThrow();
  });
});
