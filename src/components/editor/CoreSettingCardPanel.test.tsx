/**
 * CoreSettingCardPanel 单元测试
 *
 * 测试范围：
 *   - 空状态：无 settingCard 时显示"还没有核心设定卡" + 初始化按钮
 *   - 初始化按钮调用 initSettingCard
 *   - 顶部行动区：AI 提问 / 矛盾检查 + isSettingCardBusy 时 Loader2 + disabled
 *   - AI 提问成功/失败（toast.error）
 *   - 矛盾检查成功/失败（toast.error）
 *   - 基础字段：书名 / 卖点 / 预计字数（含 undefined）
 *   - 类型标签：自定义添加（Enter/click/空/已存在）+ 移除 + 常用标签快选
 *   - 性格关键词：添加（Enter/click/空/已存在）+ 移除
 *   - 主角字段：姓名 / 年龄 / 初始身份 / 核心欲望 / 致命弱点 / 金手指 / 成长主线
 *   - 世界观字段：基本规则 / 力量体系 / 势力格局 / 关键历史
 *   - 核心冲突字段：主线冲突 / 主要反派 / 终极目标
 *   - 情感基调切换 / 感情线切换
 *   - AI 提问结果展示（含序号 + 提示文本）
 *   - 矛盾点检查结果展示：error/warning severity / resolved 状态 / 标记已解决按钮
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CoreSettingCardPanel from '@/components/editor/CoreSettingCardPanel';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectSettingCard, Project } from '@/types';

// 捕获 toast.error 调用参数以断言
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from '@/hooks/useToast';

// ============ fixtures ============
function makeCard(overrides: Partial<ProjectSettingCard> = {}): ProjectSettingCard {
  return {
    title: '我的小说',
    genreTags: ['都市'],
    sellingPoint: '爽文一篇',
    estimatedTotalWords: 100,
    protagonist: {
      name: '李四',
      age: '20',
      initialIdentity: '高三学生',
      personalityKeywords: ['冷静'],
      coreDesire: '变强',
      fatalFlaw: '冲动',
      goldenFinger: '系统',
      growthArc: '从弱到强',
    },
    worldview: {
      basicRules: '规则',
      powerSystem: '体系',
      factionLandscape: '格局',
      keyHistory: '历史',
    },
    coreConflict: {
      mainConflict: '主线冲突',
      mainAntagonist: '反派',
      ultimateGoal: '终极目标',
    },
    emotionalTone: 'hot-blooded',
    romanceType: 'single',
    contradictions: [],
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    title: '测试项目',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    settingCard: makeCard(),
    ...overrides,
  } as Project;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  projects: Project[];
  currentProjectId: string;
  settingCardQuestions: string[];
  isSettingCardBusy: boolean;
  initSettingCard: ReturnType<typeof vi.fn>;
  updateSettingCard: ReturnType<typeof vi.fn>;
  askSettingCardQuestions: ReturnType<typeof vi.fn>;
  checkSettingCard: ReturnType<typeof vi.fn>;
  resolveSettingCardContradiction: ReturnType<typeof vi.fn>;
}> = {}) {
  const project = overrides.projects?.[0] || makeProject();
  const initSettingCard = overrides.initSettingCard || vi.fn();
  const updateSettingCard = overrides.updateSettingCard || vi.fn();
  const askSettingCardQuestions = overrides.askSettingCardQuestions || vi.fn().mockResolvedValue(['问题1']);
  const checkSettingCard = overrides.checkSettingCard || vi.fn().mockResolvedValue(undefined);
  const resolveSettingCardContradiction = overrides.resolveSettingCardContradiction || vi.fn();

  useAppStore.setState({
    projects: overrides.projects || [project],
    currentProjectId: overrides.currentProjectId || project.id,
    settingCardQuestions: overrides.settingCardQuestions || [],
    isSettingCardBusy: overrides.isSettingCardBusy ?? false,
    initSettingCard,
    updateSettingCard,
    askSettingCardQuestions,
    checkSettingCard,
    resolveSettingCardContradiction,
  });

  return {
    initSettingCard,
    updateSettingCard,
    askSettingCardQuestions,
    checkSettingCard,
    resolveSettingCardContradiction,
  };
}

describe('CoreSettingCardPanel', () => {
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    console.error = vi.fn();
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    vi.restoreAllMocks();
    cleanup();
  });

  // ============ 空状态 ============
  it('无 settingCard 时显示空状态文案', () => {
    mockStore({
      projects: [
        { ...makeProject(), settingCard: undefined } as Project,
      ],
    });
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('还没有核心设定卡')).toBeInTheDocument();
  });

  it('点击"初始化核心设定卡"调用 initSettingCard', () => {
    const { initSettingCard } = mockStore({
      projects: [
        { ...makeProject(), settingCard: undefined } as Project,
      ],
    });
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('初始化核心设定卡'));
    expect(initSettingCard).toHaveBeenCalledTimes(1);
  });

  // ============ 顶部行动区 ============
  it('渲染"AI 提问"与"矛盾检查"按钮', () => {
    mockStore();
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('AI 提问')).toBeInTheDocument();
    expect(screen.getByText('矛盾检查')).toBeInTheDocument();
  });

  it('isSettingCardBusy=true 时两按钮 disabled', () => {
    mockStore({ isSettingCardBusy: true });
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('AI 提问').closest('button')!.disabled).toBe(true);
    expect(screen.getByText('矛盾检查').closest('button')!.disabled).toBe(true);
  });

  it('isSettingCardBusy=true 时 AI 提问按钮显示 Loader2', () => {
    mockStore({ isSettingCardBusy: true });
    render(<CoreSettingCardPanel />);
    const askBtn = screen.getByText('AI 提问').closest('button')!;
    expect(askBtn.querySelector('svg.lucide-loader-circle, svg.lucide-loader-2')).not.toBeNull();
  });

  it('点击"AI 提问"调用 askSettingCardQuestions', async () => {
    const { askSettingCardQuestions } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('AI 提问'));
    await waitFor(() => {
      expect(askSettingCardQuestions).toHaveBeenCalledTimes(1);
    });
  });

  it('askSettingCardQuestions 抛错时 toast.error', async () => {
    mockStore({
      askSettingCardQuestions: vi.fn().mockRejectedValue(new Error('AI 失败')),
    });
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('AI 提问'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('AI 提问失败', 'AI 失败');
    });
  });

  it('点击"矛盾检查"调用 checkSettingCard', async () => {
    const { checkSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('矛盾检查'));
    await waitFor(() => {
      expect(checkSettingCard).toHaveBeenCalledTimes(1);
    });
  });

  it('checkSettingCard 抛错时 toast.error', async () => {
    mockStore({
      checkSettingCard: vi.fn().mockRejectedValue(new Error('检查失败')),
    });
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('矛盾检查'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('矛盾检查失败', '检查失败');
    });
  });

  // ============ 基础字段 ============
  it('修改书名调用 updateSettingCard({ title })', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('我的小说'), { target: { value: '新书名' } });
    expect(updateSettingCard).toHaveBeenCalledWith({ title: '新书名' });
  });

  it('修改卖点', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('爽文一篇'), { target: { value: '新卖点' } });
    expect(updateSettingCard).toHaveBeenCalledWith({ sellingPoint: '新卖点' });
  });

  it('修改预计字数（数字）', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '200' } });
    expect(updateSettingCard).toHaveBeenCalledWith({ estimatedTotalWords: 200 });
  });

  it('清空预计字数回退 undefined', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '' } });
    expect(updateSettingCard).toHaveBeenCalledWith({ estimatedTotalWords: undefined });
  });

  // ============ 类型标签 ============
  it('自定义添加类型标签（点击按钮）', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('自定义标签');
    fireEvent.change(input, { target: { value: '末世' } });
    fireEvent.click(screen.getByLabelText('添加标签'));
    expect(updateSettingCard).toHaveBeenCalledWith({ genreTags: ['都市', '末世'] });
  });

  it('自定义添加类型标签（Enter 键）', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('自定义标签');
    fireEvent.change(input, { target: { value: '末世' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateSettingCard).toHaveBeenCalledWith({ genreTags: ['都市', '末世'] });
  });

  it('空字符串不添加类型标签', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('自定义标签');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('添加标签'));
    expect(updateSettingCard).not.toHaveBeenCalled();
  });

  it('已存在的类型标签不重复添加', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('自定义标签');
    fireEvent.change(input, { target: { value: '都市' } });
    fireEvent.click(screen.getByLabelText('添加标签'));
    expect(updateSettingCard).not.toHaveBeenCalled();
  });

  it('点击常用标签快速添加', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    // 都市已存在，第一个可点击的常用标签是 + 玄幻
    fireEvent.click(screen.getByText('+ 玄幻'));
    expect(updateSettingCard).toHaveBeenCalledWith({ genreTags: ['都市', '玄幻'] });
  });

  it('移除类型标签', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByLabelText('移除标签 都市'));
    expect(updateSettingCard).toHaveBeenCalledWith({ genreTags: [] });
  });

  // ============ 性格关键词 ============
  it('添加性格关键词（点击按钮）', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('如：冷静、执着、有点腹黑');
    fireEvent.change(input, { target: { value: '执着' } });
    fireEvent.click(screen.getByLabelText('添加关键词'));
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({
        personalityKeywords: ['冷静', '执着'],
      }),
    });
  });

  it('添加性格关键词（Enter 键）', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('如：冷静、执着、有点腹黑');
    fireEvent.change(input, { target: { value: '执着' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({
        personalityKeywords: ['冷静', '执着'],
      }),
    });
  });

  it('空字符串不添加性格关键词', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('如：冷静、执着、有点腹黑');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByLabelText('添加关键词'));
    expect(updateSettingCard).not.toHaveBeenCalled();
  });

  it('已存在的性格关键词不重复添加', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    const input = screen.getByPlaceholderText('如：冷静、执着、有点腹黑');
    fireEvent.change(input, { target: { value: '冷静' } });
    fireEvent.click(screen.getByLabelText('添加关键词'));
    expect(updateSettingCard).not.toHaveBeenCalled();
  });

  it('移除性格关键词', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByLabelText('移除关键词 冷静'));
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({
        personalityKeywords: [],
      }),
    });
  });

  // ============ 主角字段 ============
  it('修改主角姓名', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('李四'), { target: { value: '王五' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ name: '王五' }),
    });
  });

  it('修改主角年龄', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '25' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ age: '25' }),
    });
  });

  it('修改主角初始身份', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('高三学生'), { target: { value: '新身份' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ initialIdentity: '新身份' }),
    });
  });

  it('修改主角核心欲望', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('变强'), { target: { value: '复仇' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ coreDesire: '复仇' }),
    });
  });

  it('修改主角致命弱点', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('冲动'), { target: { value: '多疑' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ fatalFlaw: '多疑' }),
    });
  });

  it('修改金手指', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('系统'), { target: { value: '血脉' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ goldenFinger: '血脉' }),
    });
  });

  it('修改成长主线', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('从弱到强'), { target: { value: '从弱到神' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      protagonist: expect.objectContaining({ growthArc: '从弱到神' }),
    });
  });

  // ============ 世界观字段 ============
  it('修改世界基本规则', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('规则'), { target: { value: '新规则' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      worldview: expect.objectContaining({ basicRules: '新规则' }),
    });
  });

  it('修改力量体系', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('体系'), { target: { value: '新体系' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      worldview: expect.objectContaining({ powerSystem: '新体系' }),
    });
  });

  it('修改势力格局', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('格局'), { target: { value: '新格局' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      worldview: expect.objectContaining({ factionLandscape: '新格局' }),
    });
  });

  it('修改关键历史事件', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('历史'), { target: { value: '新历史' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      worldview: expect.objectContaining({ keyHistory: '新历史' }),
    });
  });

  // ============ 核心冲突字段 ============
  it('修改主线冲突', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('主线冲突'), { target: { value: '新冲突' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      coreConflict: expect.objectContaining({ mainConflict: '新冲突' }),
    });
  });

  it('修改主要反派', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('反派'), { target: { value: '新反派' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      coreConflict: expect.objectContaining({ mainAntagonist: '新反派' }),
    });
  });

  it('修改终极目标', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.change(screen.getByDisplayValue('终极目标'), { target: { value: '新目标' } });
    expect(updateSettingCard).toHaveBeenCalledWith({
      coreConflict: expect.objectContaining({ ultimateGoal: '新目标' }),
    });
  });

  // ============ 情感基调 / 感情线 ============
  it('切换情感基调', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('轻松'));
    expect(updateSettingCard).toHaveBeenCalledWith({ emotionalTone: 'light' });
  });

  it('切换感情线', () => {
    const { updateSettingCard } = mockStore();
    render(<CoreSettingCardPanel />);
    fireEvent.click(screen.getByText('后宫'));
    expect(updateSettingCard).toHaveBeenCalledWith({ romanceType: 'harem' });
  });

  // ============ AI 提问结果 ============
  it('settingCardQuestions 不为空时展示问题列表', () => {
    mockStore({ settingCardQuestions: ['问题1', '问题2'] });
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('1. 问题1')).toBeInTheDocument();
    expect(screen.getByText('2. 问题2')).toBeInTheDocument();
    expect(screen.getByText('回答这些问题后，把答案填回对应字段')).toBeInTheDocument();
  });

  it('settingCardQuestions 为空时不展示问题列表', () => {
    mockStore({ settingCardQuestions: [] });
    render(<CoreSettingCardPanel />);
    expect(screen.queryByText('AI 深化提问')).not.toBeInTheDocument();
  });

  // ============ 矛盾点检查结果 ============
  it('渲染未解决的 error 矛盾点 + "标记已解决"按钮', () => {
    mockStore({
      projects: [makeProject({
        settingCard: makeCard({
          contradictions: [
            { description: '致命错误', severity: 'error', resolved: false },
          ],
        }),
      })],
    });
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('致命错误')).toBeInTheDocument();
    expect(screen.getByText('错误')).toBeInTheDocument();
    expect(screen.getByText('标记已解决')).toBeInTheDocument();
  });

  it('渲染未解决的 warning 矛盾点', () => {
    mockStore({
      projects: [makeProject({
        settingCard: makeCard({
          contradictions: [
            { description: '警告项', severity: 'warning', resolved: false },
          ],
        }),
      })],
    });
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('警告项')).toBeInTheDocument();
    expect(screen.getByText('警告')).toBeInTheDocument();
  });

  it('渲染已解决的矛盾点不显示"标记已解决"按钮', () => {
    mockStore({
      projects: [makeProject({
        settingCard: makeCard({
          contradictions: [
            { description: '已解决', severity: 'error', resolved: true },
          ],
        }),
      })],
    });
    render(<CoreSettingCardPanel />);
    expect(screen.getByText('已解决')).toBeInTheDocument();
    expect(screen.getByText('已处理')).toBeInTheDocument();
    expect(screen.queryByText('标记已解决')).not.toBeInTheDocument();
  });

  it('点击"标记已解决"调用 resolveSettingCardContradiction', () => {
    const { resolveSettingCardContradiction } = mockStore({
      projects: [makeProject({
        settingCard: makeCard({
          contradictions: [
            { description: '矛盾1', severity: 'error', resolved: false },
            { description: '矛盾2', severity: 'warning', resolved: false },
          ],
        }),
      })],
    });
    render(<CoreSettingCardPanel />);
    const buttons = screen.getAllByText('标记已解决');
    fireEvent.click(buttons[1]); // 标记第 2 个矛盾
    expect(resolveSettingCardContradiction).toHaveBeenCalledWith(1);
  });

  it('无矛盾点时不展示矛盾区', () => {
    mockStore();
    render(<CoreSettingCardPanel />);
    expect(screen.queryByText(/矛盾点/)).not.toBeInTheDocument();
  });

  // ============ 空字段处理 ============
  it('estimatedTotalWords 为 undefined 时 number input 显示空', () => {
    mockStore({
      projects: [makeProject({
        settingCard: makeCard({ estimatedTotalWords: undefined }),
      })],
    });
    render(<CoreSettingCardPanel />);
    const wordsInput = screen.getByPlaceholderText('如 100、200、300') as HTMLInputElement;
    expect(wordsInput.value).toBe('');
  });
});
