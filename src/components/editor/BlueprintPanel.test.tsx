/**
 * BlueprintPanel 单元测试
 *
 * 测试范围：
 *   - 空状态：无 blueprint 时显示"还没有全局走向概览" + AI 生成蓝图按钮
 *   - 空状态下点击 AI 生成按钮调用 generateBlueprint（无 confirm）
 *   - 空状态下 isBlueprintBusy=true 时按钮 disabled + Loader2
 *   - handleGenerate confirm 流程：已有未锁定蓝图时弹 confirm（yes/no）
 *   - handleGenerate 锁定时无 confirm
 *   - handleGenerate 抛错时 toast.error('蓝图生成失败', ...)
 *   - handleToggleLock：未锁定→lockBlueprint / 已锁定→unlockBlueprint
 *   - 评估改动影响：toggle 输入区 / 取消 / 空描述拒绝 / 提交 / 抛错 / 卸载守卫
 *   - 顶部行动区：锁定徽章 / 按钮文案 / disabled 状态 / title / 隐藏评估按钮（锁定时）
 *   - 锁定提示条
 *   - 主体内容：主线 / 起点 / 终点（读写 + readOnly 锁定态）
 *   - 转折节点 CRUD：空提示 / 添加 / 改 progress（含 clamp 0-100）/ 改标题 / 改描述 / 删除
 *   - 成长弧线编辑：空提示 / 改卷号（min 1）/ 改起始状态 / 改经历 / 改结束状态
 *   - 主要人物命运线显示：空提示 / 渲染 / 未命名兜底 / ending 可选
 *   - 分卷概览显示：空提示 / 渲染 / 未命名兜底 / chapterRange 可选 / endingHook 可选
 *   - ChangeImpactReport：3 种风险等级 / 描述 / 建议 / 受影响卷/章节/伏笔 / 清除按钮 / 无 impact 时不渲染
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import BlueprintPanel from '@/components/editor/BlueprintPanel';
import { useAppStore } from '@/store/useAppStore';
import type {
  BlueprintOverview,
  BlueprintChangeImpact,
  Project,
} from '@/types';
import * as storageUtil from '@/utils/storage';

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
function makeImpact(overrides: Partial<BlueprintChangeImpact> = {}): BlueprintChangeImpact {
  return {
    changeDescription: '把反派从 A 改为 B',
    affectedVolumes: [2],
    affectedChapters: ['第 15 章'],
    affectedForeshadows: ['伏笔1'],
    riskLevel: 'medium',
    suggestion: '建议先重写第 15 章再调整后续',
    generatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<BlueprintOverview> = {}): BlueprintOverview {
  return {
    mainline: '主角从弱到强逆袭',
    startPoint: '小镇少年离家',
    turnPoints: [
      { id: 'tp-1', progress: 30, title: '初遇反派', description: '酒馆冲突' },
      { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
    ],
    endPoint: '主角登顶称王',
    growthArc: [
      { id: 'ga-1', volumeIndex: 1, fromState: '自卑', experiences: '被欺辱', toState: '觉醒' },
    ],
    characterFates: [
      { characterName: '主角', keyNodes: '觉醒 / 复仇 / 称王', ending: '登基' },
    ],
    volumes: [
      {
        index: 1,
        title: '初出茅庐',
        chapterRange: '第 1-30 章',
        coreTask: '建立人设与世界观',
        endingHook: '反派现身',
      },
    ],
    lockedAt: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    title: '测试项目',
    description: '',
    template: 'blank',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    lastOpenedAt: '2025-01-01T00:00:00.000Z',
    totalWords: 0,
    config: {
      theme: 'dark',
      fontSize: 16,
      lineHeight: 1.6,
      fontFamily: 'system-ui',
      showLineNumbers: false,
      showWordCount: true,
      zenMode: false,
      aiSettings: {
        provider: 'mock',
        apiKey: '',
        model: '',
        baseUrl: '',
        style: 'balanced',
        density: 'medium',
        temperature: 0.7,
        maxTokens: 2000,
        autoCheckConflicts: false,
      },
    },
    ...overrides,
  } as Project;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  projects: Project[];
  currentProjectId: string;
  isBlueprintBusy: boolean;
  generateBlueprint: ReturnType<typeof vi.fn>;
  updateBlueprint: ReturnType<typeof vi.fn>;
  lockBlueprint: ReturnType<typeof vi.fn>;
  unlockBlueprint: ReturnType<typeof vi.fn>;
  generateBlueprintImpact: ReturnType<typeof vi.fn>;
  clearBlueprintImpact: ReturnType<typeof vi.fn>;
}> = {}) {
  // 默认注入一份未锁定的 blueprint，让面板进入主视图；测试可通过 overrides.projects 覆盖
  const project = overrides.projects?.[0] || makeProject({ blueprint: makeBlueprint() });
  const generateBlueprint = overrides.generateBlueprint || vi.fn().mockResolvedValue(undefined);
  const updateBlueprint = overrides.updateBlueprint || vi.fn();
  const lockBlueprint = overrides.lockBlueprint || vi.fn();
  const unlockBlueprint = overrides.unlockBlueprint || vi.fn();
  const generateBlueprintImpact = overrides.generateBlueprintImpact || vi.fn().mockResolvedValue(undefined);
  const clearBlueprintImpact = overrides.clearBlueprintImpact || vi.fn();

  useAppStore.setState({
    projects: overrides.projects || [project],
    currentProjectId: overrides.currentProjectId || project.id,
    isBlueprintBusy: overrides.isBlueprintBusy ?? false,
    generateBlueprint,
    updateBlueprint,
    lockBlueprint,
    unlockBlueprint,
    generateBlueprintImpact,
    clearBlueprintImpact,
  });

  return {
    generateBlueprint,
    updateBlueprint,
    lockBlueprint,
    unlockBlueprint,
    generateBlueprintImpact,
    clearBlueprintImpact,
  };
}

describe('BlueprintPanel', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    console.error = vi.fn();
    // generateId 默认返回稳定字符串，便于断言
    vi.spyOn(storageUtil, 'generateId').mockReturnValue('new-id');
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.restoreAllMocks();
    cleanup();
  });

  // ============ 空状态 ============
  it('无 blueprint 时显示空状态文案', () => {
    mockStore({
      projects: [{ ...makeProject(), blueprint: undefined } as Project],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('还没有全局走向概览')).toBeInTheDocument();
    expect(screen.getByText('AI 生成蓝图')).toBeInTheDocument();
  });

  it('空状态下点击 AI 生成按钮调用 generateBlueprint（无 confirm）', async () => {
    const { generateBlueprint } = mockStore({
      projects: [{ ...makeProject(), blueprint: undefined } as Project],
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByText('AI 生成蓝图'));
    await waitFor(() => {
      expect(generateBlueprint).toHaveBeenCalledTimes(1);
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('空状态下 isBlueprintBusy=true 时按钮 disabled + 显示 Loader2', () => {
    mockStore({
      projects: [{ ...makeProject(), blueprint: undefined } as Project],
      isBlueprintBusy: true,
    });
    render(<BlueprintPanel />);
    const btn = screen.getByText('AI 生成蓝图').closest('button')!;
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('svg.lucide-loader-circle, svg.lucide-loader-2')).not.toBeNull();
  });

  // ============ handleGenerate confirm 流程 ============
  it('已有未锁定蓝图时点击 AI 生成弹 confirm，确认后调用 generateBlueprint', async () => {
    const { generateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('AI 生成蓝图'));
    await waitFor(() => {
      expect(generateBlueprint).toHaveBeenCalledTimes(1);
    });
    expect(confirmMock).toHaveBeenCalledWith('已有蓝图将被覆盖，确定要重新生成吗？');
  });

  it('已有未锁定蓝图时 confirm 返回 false 不调用 generateBlueprint', () => {
    confirmMock.mockResolvedValue(false);
    const { generateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('AI 生成蓝图'));
    expect(generateBlueprint).not.toHaveBeenCalled();
  });

  it('已锁定蓝图时点击 AI 生成不弹 confirm（按钮 disabled 无法触发，直接调也跳过）', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    const btn = screen.getByLabelText('AI 生成蓝图') as HTMLButtonElement;
    // 锁定时按钮 disabled
    expect(btn.disabled).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('generateBlueprint 抛错时 toast.error', async () => {
    mockStore({
      generateBlueprint: vi.fn().mockRejectedValue(new Error('AI 服务异常')),
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('AI 生成蓝图'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('蓝图生成失败', 'AI 服务异常');
    });
  });

  it('generateBlueprint 抛非 Error 时 toast.error 用 String', async () => {
    mockStore({
      generateBlueprint: vi.fn().mockRejectedValue('字符串错误'),
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('AI 生成蓝图'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('蓝图生成失败', '字符串错误');
    });
  });

  // ============ handleToggleLock ============
  it('未锁定时点击"锁定蓝图"调用 lockBlueprint', () => {
    const { lockBlueprint, unlockBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByText('锁定蓝图'));
    expect(lockBlueprint).toHaveBeenCalledTimes(1);
    expect(unlockBlueprint).not.toHaveBeenCalled();
  });

  it('已锁定时点击"解锁蓝图"调用 unlockBlueprint', () => {
    const { lockBlueprint, unlockBlueprint } = mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByText('解锁蓝图'));
    expect(unlockBlueprint).toHaveBeenCalledTimes(1);
    expect(lockBlueprint).not.toHaveBeenCalled();
  });

  it('isBlueprintBusy=true 时锁定/解锁按钮 disabled', () => {
    mockStore({ isBlueprintBusy: true });
    render(<BlueprintPanel />);
    expect(screen.getByText('锁定蓝图').closest('button')!.disabled).toBe(true);
  });

  // ============ 顶部行动区 ============
  it('未锁定时不显示"已锁定"徽章，显示"评估改动影响"按钮', () => {
    mockStore();
    render(<BlueprintPanel />);
    expect(screen.queryByText('已锁定')).not.toBeInTheDocument();
    expect(screen.getByLabelText('评估改动影响')).toBeInTheDocument();
  });

  it('已锁定时显示"已锁定"徽章，隐藏"评估改动影响"按钮', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('已锁定')).toBeInTheDocument();
    expect(screen.queryByLabelText('评估改动影响')).not.toBeInTheDocument();
  });

  it('已锁定时 AI 生成按钮 title 提示"蓝图已锁定，请先解锁"', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByLabelText('AI 生成蓝图')).toHaveAttribute('title', '蓝图已锁定，请先解锁');
  });

  it('未锁定时 AI 生成按钮 title 为"AI 生成蓝图"', () => {
    mockStore();
    render(<BlueprintPanel />);
    expect(screen.getByLabelText('AI 生成蓝图')).toHaveAttribute('title', 'AI 生成蓝图');
  });

  it('isBlueprintBusy=true 时 AI 生成按钮显示 Loader2', () => {
    mockStore({ isBlueprintBusy: true });
    render(<BlueprintPanel />);
    const btn = screen.getByLabelText('AI 生成蓝图');
    expect(btn.querySelector('svg.lucide-loader-circle, svg.lucide-loader-2')).not.toBeNull();
  });

  it('已锁定时 AI 生成按钮显示 Lock 图标', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    const btn = screen.getByLabelText('AI 生成蓝图');
    expect(btn.querySelector('svg.lucide-lock')).not.toBeNull();
  });

  // ============ 锁定提示条 ============
  it('已锁定时显示锁定提示条文案', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(
      screen.getByText('蓝图已锁定，正文创作将基于此蓝图。修改前请先解锁并评估改动影响。'),
    ).toBeInTheDocument();
  });

  it('未锁定时不显示锁定提示条', () => {
    mockStore();
    render(<BlueprintPanel />);
    expect(
      screen.queryByText('蓝图已锁定，正文创作将基于此蓝图。修改前请先解锁并评估改动影响。'),
    ).not.toBeInTheDocument();
  });

  // ============ 评估改动影响 ============
  it('点击"评估改动影响"展开输入区', () => {
    mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    expect(screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B')).toBeInTheDocument();
    expect(screen.getByText('提交评估')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('再次点击"评估改动影响"折叠输入区', () => {
    mockStore();
    render(<BlueprintPanel />);
    const toggleBtn = screen.getByLabelText('评估改动影响');
    fireEvent.click(toggleBtn);
    expect(screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B')).toBeInTheDocument();
    fireEvent.click(toggleBtn);
    expect(screen.queryByPlaceholderText('如：把第二卷的反派从 A 改为 B')).not.toBeInTheDocument();
  });

  it('点击"取消"折叠输入区并清空描述', () => {
    mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    const textarea = screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '一些描述' } });
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('如：把第二卷的反派从 A 改为 B')).not.toBeInTheDocument();
  });

  it('提交评估按钮在描述为空时 disabled', () => {
    mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    expect(screen.getByLabelText('提交评估').closest('button')!.disabled).toBe(true);
  });

  it('点击"提交评估"调用 generateBlueprintImpact 并关闭输入区', async () => {
    const { generateBlueprintImpact } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    const textarea = screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B');
    fireEvent.change(textarea, { target: { value: '  把反派改为 B  ' } });
    fireEvent.click(screen.getByLabelText('提交评估'));
    await waitFor(() => {
      expect(generateBlueprintImpact).toHaveBeenCalledWith('把反派改为 B');
    });
    // 输入区被关闭
    expect(screen.queryByPlaceholderText('如：把第二卷的反派从 A 改为 B')).not.toBeInTheDocument();
  });

  it('isBlueprintBusy=true 时输入区 textarea 与按钮均 disabled', () => {
    // 先以非 busy 态打开输入区，再切到 busy 态触发组件 re-render
    mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    act(() => {
      useAppStore.setState({ isBlueprintBusy: true });
    });
    const textarea = screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(screen.getByText('取消').closest('button')!.disabled).toBe(true);
    expect(screen.getByLabelText('提交评估').closest('button')!.disabled).toBe(true);
  });

  it('isBlueprintBusy=true 时提交按钮显示 Loader2', () => {
    mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    act(() => {
      useAppStore.setState({ isBlueprintBusy: true });
    });
    const submitBtn = screen.getByLabelText('提交评估');
    expect(submitBtn.querySelector('svg.lucide-loader-circle, svg.lucide-loader-2')).not.toBeNull();
  });

  it('generateBlueprintImpact 抛错时 toast.error', async () => {
    mockStore({
      generateBlueprintImpact: vi.fn().mockRejectedValue(new Error('评估失败')),
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    fireEvent.change(screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B'), {
      target: { value: '描述' },
    });
    fireEvent.click(screen.getByLabelText('提交评估'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('改动影响评估失败', '评估失败');
    });
  });

  it('generateBlueprintImpact 抛非 Error 时 toast.error 用 String', async () => {
    mockStore({
      generateBlueprintImpact: vi.fn().mockRejectedValue('字符串错误'),
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    fireEvent.change(screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B'), {
      target: { value: '描述' },
    });
    fireEvent.click(screen.getByLabelText('提交评估'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('改动影响评估失败', '字符串错误');
    });
  });

  it('组件卸载后 generateBlueprintImpact 抛错不触发 toast.error', async () => {
    const reject = vi.fn().mockImplementation(() => new Promise<void>((_, rej) => setTimeout(() => rej(new Error('晚到的错误')), 50)));
    mockStore({
      generateBlueprintImpact: reject,
    });
    const { unmount } = render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('评估改动影响'));
    fireEvent.change(screen.getByPlaceholderText('如：把第二卷的反派从 A 改为 B'), {
      target: { value: '描述' },
    });
    fireEvent.click(screen.getByLabelText('提交评估'));
    unmount();
    // 等待 reject 落地
    await new Promise(r => setTimeout(r, 80));
    expect(toast.error).not.toHaveBeenCalled();
  });

  // ============ 主体内容：主线 / 起点 / 终点 ============
  it('修改主线调用 updateBlueprint({ mainline })', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByDisplayValue('主角从弱到强逆袭'), { target: { value: '新主线' } });
    expect(updateBlueprint).toHaveBeenCalledWith({ mainline: '新主线' });
  });

  it('修改起点调用 updateBlueprint({ startPoint })', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByDisplayValue('小镇少年离家'), { target: { value: '新起点' } });
    expect(updateBlueprint).toHaveBeenCalledWith({ startPoint: '新起点' });
  });

  it('修改终点调用 updateBlueprint({ endPoint })', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByDisplayValue('主角登顶称王'), { target: { value: '新终点' } });
    expect(updateBlueprint).toHaveBeenCalledWith({ endPoint: '新终点' });
  });

  it('锁定态下主线/起点/终点 textarea readOnly', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByDisplayValue('主角从弱到强逆袭')).toHaveAttribute('readonly');
    expect(screen.getByDisplayValue('小镇少年离家')).toHaveAttribute('readonly');
    expect(screen.getByDisplayValue('主角登顶称王')).toHaveAttribute('readonly');
  });

  // ============ 转折节点 CRUD ============
  it('无转折节点时显示空提示', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ turnPoints: [] }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('暂无转折节点，点击右上角添加。')).toBeInTheDocument();
  });

  it('点击"添加转折点"调用 generateId + updateBlueprint 追加节点', () => {
    const { updateBlueprint } = mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ turnPoints: [] }) })],
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('添加转折点'));
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [{ id: 'new-id', progress: 50, title: '', description: '' }],
    });
  });

  it('锁定态下"添加转折点"按钮 disabled', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByLabelText('添加转折点').closest('button')!.disabled).toBe(true);
  });

  it('修改转折点 progress（含 clamp 0-100）', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    const progressInput = screen.getByLabelText('转折点 1 进度百分比') as HTMLInputElement;
    fireEvent.change(progressInput, { target: { value: '150' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [
        { id: 'tp-1', progress: 100, title: '初遇反派', description: '酒馆冲突' },
        { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
      ],
    });
  });

  it('修改转折点 progress 为负数 clamp 到 0', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByLabelText('转折点 1 进度百分比'), { target: { value: '-10' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [
        { id: 'tp-1', progress: 0, title: '初遇反派', description: '酒馆冲突' },
        { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
      ],
    });
  });

  it('修改转折点 progress 为非数字回退 0', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByLabelText('转折点 1 进度百分比'), { target: { value: 'abc' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [
        { id: 'tp-1', progress: 0, title: '初遇反派', description: '酒馆冲突' },
        { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
      ],
    });
  });

  it('修改转折点标题', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByLabelText('转折点 1 标题'), { target: { value: '新标题' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [
        { id: 'tp-1', progress: 30, title: '新标题', description: '酒馆冲突' },
        { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
      ],
    });
  });

  it('修改转折点描述', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    // 两个转折点各有一个"转折描述"textarea，取第一个
    const descTextareas = screen.getAllByPlaceholderText('转折描述');
    fireEvent.change(descTextareas[0], { target: { value: '新描述' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [
        { id: 'tp-1', progress: 30, title: '初遇反派', description: '新描述' },
        { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
      ],
    });
  });

  it('删除转折点', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('删除转折点 1'));
    expect(updateBlueprint).toHaveBeenCalledWith({
      turnPoints: [
        { id: 'tp-2', progress: 60, title: '金手指觉醒', description: '危难中激活系统' },
      ],
    });
  });

  it('锁定态下"删除转折点"按钮 disabled', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByLabelText('删除转折点 1').closest('button')!.disabled).toBe(true);
  });

  it('锁定态下转折点 progress/title/description readOnly', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByLabelText('转折点 1 进度百分比')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('转折点 1 标题')).toHaveAttribute('readonly');
    // 两个转折点各有一个"转折描述"textarea，取第一个
    expect(screen.getAllByPlaceholderText('转折描述')[0]).toHaveAttribute('readonly');
  });

  // ============ 成长弧线编辑 ============
  it('无成长弧线段时显示空提示', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ growthArc: [] }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('暂无成长弧线段。')).toBeInTheDocument();
  });

  it('修改成长弧线段卷号（min 1）', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByLabelText('成长弧线段 1 卷号'), { target: { value: '0' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      growthArc: [
        { id: 'ga-1', volumeIndex: 1, fromState: '自卑', experiences: '被欺辱', toState: '觉醒' },
      ],
    });
  });

  it('修改成长弧线段卷号为非数字回退 1', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByLabelText('成长弧线段 1 卷号'), { target: { value: 'abc' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      growthArc: [
        { id: 'ga-1', volumeIndex: 1, fromState: '自卑', experiences: '被欺辱', toState: '觉醒' },
      ],
    });
  });

  it('修改成长弧线段起始状态', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByDisplayValue('自卑'), { target: { value: '懦弱' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      growthArc: [
        { id: 'ga-1', volumeIndex: 1, fromState: '懦弱', experiences: '被欺辱', toState: '觉醒' },
      ],
    });
  });

  it('修改成长弧线段经历', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByPlaceholderText('该卷关键经历'), { target: { value: '新经历' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      growthArc: [
        { id: 'ga-1', volumeIndex: 1, fromState: '自卑', experiences: '新经历', toState: '觉醒' },
      ],
    });
  });

  it('修改成长弧线段结束状态', () => {
    const { updateBlueprint } = mockStore();
    render(<BlueprintPanel />);
    fireEvent.change(screen.getByDisplayValue('觉醒'), { target: { value: '自信' } });
    expect(updateBlueprint).toHaveBeenCalledWith({
      growthArc: [
        { id: 'ga-1', volumeIndex: 1, fromState: '自卑', experiences: '被欺辱', toState: '自信' },
      ],
    });
  });

  it('锁定态下成长弧线段所有字段 readOnly', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ lockedAt: '2025-01-01T00:00:00.000Z' }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByLabelText('成长弧线段 1 卷号')).toHaveAttribute('readonly');
    expect(screen.getByDisplayValue('自卑')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('该卷关键经历')).toHaveAttribute('readonly');
    expect(screen.getByDisplayValue('觉醒')).toHaveAttribute('readonly');
  });

  // ============ 主要人物命运线 ============
  it('无人物命运线时显示空提示', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ characterFates: [] }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('暂无人物命运线。')).toBeInTheDocument();
  });

  it('渲染人物命运线：姓名 + 关键节点 + 结局', () => {
    mockStore();
    render(<BlueprintPanel />);
    expect(screen.getByText('主角')).toBeInTheDocument();
    expect(screen.getByText('觉醒 / 复仇 / 称王')).toBeInTheDocument();
    expect(screen.getByText('登基')).toBeInTheDocument();
  });

  it('characterName 为空时兜底显示"未命名角色"', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            characterFates: [{ characterName: '', keyNodes: '节点', ending: '结局' }],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('未命名角色')).toBeInTheDocument();
  });

  it('无 ending 时不渲染结局行', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            characterFates: [{ characterName: '配角', keyNodes: '节点', ending: undefined }],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('配角')).toBeInTheDocument();
    expect(screen.queryByText('结局：')).not.toBeInTheDocument();
  });

  it('keyNodes 为空时显示"—"', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            characterFates: [{ characterName: '配角', keyNodes: '', ending: '结局' }],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // ============ 分卷概览 ============
  it('无分卷概览时显示空提示', () => {
    mockStore({
      projects: [makeProject({ blueprint: makeBlueprint({ volumes: [] }) })],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('暂无分卷概览。')).toBeInTheDocument();
  });

  it('渲染分卷概览：卷号 + 标题 + 章节范围 + 核心任务 + 结尾钩子', () => {
    mockStore();
    render(<BlueprintPanel />);
    expect(screen.getByText('第 1 卷')).toBeInTheDocument();
    expect(screen.getByText('初出茅庐')).toBeInTheDocument();
    expect(screen.getByText('· 第 1-30 章')).toBeInTheDocument();
    expect(screen.getByText('建立人设与世界观')).toBeInTheDocument();
    expect(screen.getByText('反派现身')).toBeInTheDocument();
  });

  it('分卷标题为空时兜底显示"未命名"', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            volumes: [
              { index: 1, title: '', chapterRange: '', coreTask: '', endingHook: undefined },
            ],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('未命名')).toBeInTheDocument();
  });

  it('无 chapterRange 时不渲染范围行', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            volumes: [
              { index: 1, title: '卷一', chapterRange: '', coreTask: '任务', endingHook: undefined },
            ],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.queryByText(/·\s/)).not.toBeInTheDocument();
  });

  it('无 endingHook 时不渲染钩子行', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            volumes: [
              { index: 1, title: '卷一', chapterRange: '第 1-10 章', coreTask: '任务', endingHook: undefined },
            ],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.queryByText('结尾钩子：')).not.toBeInTheDocument();
  });

  it('coreTask 为空时显示"—"', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            volumes: [
              { index: 1, title: '卷一', chapterRange: '', coreTask: '', endingHook: undefined },
            ],
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    // 第 1 卷卡片内的 "—" 出现在 coreTask 位置
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  // ============ ChangeImpactReport ============
  it('无 lastChangeImpact 时不渲染报告区', () => {
    mockStore();
    render(<BlueprintPanel />);
    expect(screen.queryByText('改动影响报告')).not.toBeInTheDocument();
  });

  it('渲染 high 风险等级报告', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({ lastChangeImpact: makeImpact({ riskLevel: 'high' }) }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('改动影响报告')).toBeInTheDocument();
    expect(screen.getByText('高风险')).toBeInTheDocument();
  });

  it('渲染 medium 风险等级报告', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({ lastChangeImpact: makeImpact({ riskLevel: 'medium' }) }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('中风险')).toBeInTheDocument();
  });

  it('渲染 low 风险等级报告', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({ lastChangeImpact: makeImpact({ riskLevel: 'low' }) }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('低风险')).toBeInTheDocument();
  });

  it('渲染报告：改动描述 + 建议 + 受影响卷/章节/伏笔', () => {
    mockStore({
      projects: [
        makeProject({ blueprint: makeBlueprint({ lastChangeImpact: makeImpact() }) }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('把反派从 A 改为 B')).toBeInTheDocument();
    expect(screen.getByText('建议先重写第 15 章再调整后续')).toBeInTheDocument();
    expect(screen.getByText('第 2 卷')).toBeInTheDocument();
    expect(screen.getByText('第 15 章')).toBeInTheDocument();
    expect(screen.getByText('伏笔1')).toBeInTheDocument();
  });

  it('affectedVolumes 为空时不渲染受影响卷行', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            lastChangeImpact: makeImpact({ affectedVolumes: [] }),
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.queryByText('受影响卷：')).not.toBeInTheDocument();
  });

  it('affectedChapters 为空时不渲染受影响章节行', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            lastChangeImpact: makeImpact({ affectedChapters: [] }),
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.queryByText('受影响章节：')).not.toBeInTheDocument();
  });

  it('affectedForeshadows 为空时不渲染受影响伏笔行', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            lastChangeImpact: makeImpact({ affectedForeshadows: [] }),
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.queryByText('受影响伏笔：')).not.toBeInTheDocument();
  });

  it('点击"清除报告"调用 clearBlueprintImpact', () => {
    const { clearBlueprintImpact } = mockStore({
      projects: [
        makeProject({ blueprint: makeBlueprint({ lastChangeImpact: makeImpact() }) }),
      ],
    });
    render(<BlueprintPanel />);
    fireEvent.click(screen.getByLabelText('清除报告'));
    expect(clearBlueprintImpact).toHaveBeenCalledTimes(1);
  });

  it('多个受影响卷用顿号连接', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            lastChangeImpact: makeImpact({ affectedVolumes: [1, 2, 3] }),
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('第 1 卷、第 2 卷、第 3 卷')).toBeInTheDocument();
  });

  it('多个受影响章节用顿号连接', () => {
    mockStore({
      projects: [
        makeProject({
          blueprint: makeBlueprint({
            lastChangeImpact: makeImpact({ affectedChapters: ['第 1 章', '第 2 章'] }),
          }),
        }),
      ],
    });
    render(<BlueprintPanel />);
    expect(screen.getByText('第 1 章、第 2 章')).toBeInTheDocument();
  });
});
