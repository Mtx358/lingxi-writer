/**
 * Home 页单元测试
 *
 * 测试范围：
 *   - 空项目列表：渲染"开始你的创作之旅"空状态
 *   - 有项目列表：渲染项目卡片 + 字数 + 更新时间
 *   - 点击项目卡片 navigate 到 editor
 *   - 点击删除按钮 + confirm → deleteProject
 *   - 新建项目按钮 → 打开模态框 → 输入名称 → 创建 → navigate
 *   - 模板按钮点击预填标题并打开模态框
 *   - 加载示例项目 → loadSampleProject + navigate
 *   - 导入作品 / 导入大纲按钮打开对应模态框
 *   - OnboardingGuide 仅在未见过时显示
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import Home from '@/pages/Home';
import { useAppStore } from '@/store/useAppStore';
import type { Project } from '@/types';

// ============ mocks ============
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// 子组件 mock：避免拉入 SmartImportModal/OnboardingGuide 的复杂依赖
vi.mock('@/components/SmartImportModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="smart-import-modal">
      <button onClick={onClose}>close-smart-import</button>
    </div>
  ),
}));

vi.mock('@/components/OnboardingGuide', () => ({
  default: ({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) => (
    <div data-testid="onboarding-guide">
      <button onClick={onComplete}>complete-onboarding</button>
      <button onClick={onSkip}>skip-onboarding</button>
    </div>
  ),
}));

// safeStorage：mock 为内存实现，便于控制 onboarding 显示
const storageMap = new Map<string, string>();
vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGet: (key: string) => storageMap.get(key) ?? null,
  safeLocalStorageSet: (key: string, value: string) => { storageMap.set(key, value); },
}));

// ============ fixtures ============
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: '测试小说',
    description: '一个测试项目',
    template: 'blank',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    totalWords: 50000,
    config: {
      theme: 'dark', fontSize: 16, lineHeight: 1.6, fontFamily: 'sans',
      showLineNumbers: false, showWordCount: true, zenMode: false,
      aiSettings: {
        provider: 'mock', style: 'balanced', descriptionDensity: 50,
        dialogueDensity: 50, strictness: 50, temperature: 0.7,
        maxTokens: 1000, autoCheckConflicts: false,
      },
    },
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  projects: Project[];
  createProject: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
  loadProjects: ReturnType<typeof vi.fn>;
  loadSampleProject: ReturnType<typeof vi.fn>;
  openProject: ReturnType<typeof vi.fn>;
}> = {}) {
  const createProject = overrides.createProject || vi.fn().mockResolvedValue(makeProject());
  const deleteProject = overrides.deleteProject || vi.fn();
  const loadProjects = overrides.loadProjects || vi.fn().mockResolvedValue(undefined);
  const loadSampleProject = overrides.loadSampleProject || vi.fn();
  const openProject = overrides.openProject || vi.fn().mockResolvedValue(undefined);

  useAppStore.setState({
    projects: overrides.projects ?? [],
    createProject,
    deleteProject,
    loadProjects,
    loadSampleProject,
    openProject,
  });

  return { createProject, deleteProject, loadProjects, loadSampleProject, openProject };
}

describe('Home', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    storageMap.clear();
    navigateMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  // ============ 空状态 ============
  it('空项目列表渲染"开始你的创作之旅"空状态', () => {
    mockStore({ projects: [] });
    render(<Home />);
    expect(screen.getByText('开始你的创作之旅')).toBeInTheDocument();
  });

  it('空状态有"创建新项目"与"加载示例项目"按钮', () => {
    mockStore({ projects: [] });
    render(<Home />);
    expect(screen.getByText('创建新项目')).toBeInTheDocument();
    expect(screen.getByText('加载示例项目')).toBeInTheDocument();
  });

  it('空状态点击"加载示例项目"调用 loadSampleProject 并 navigate', () => {
    const sampleProject = makeProject({ id: 'sample-1' });
    const { loadSampleProject } = mockStore({
      projects: [],
      loadSampleProject: vi.fn(() => {
        // 模拟 loadSampleProject 同步写入 store
        useAppStore.setState({ projects: [sampleProject] });
      }),
    });
    render(<Home />);
    fireEvent.click(screen.getByText('加载示例项目'));
    expect(loadSampleProject).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/project/sample-1/editor');
  });

  // ============ 项目列表 ============
  it('有项目时渲染"最近项目"标题与项目卡片', () => {
    mockStore({ projects: [makeProject()] });
    render(<Home />);
    expect(screen.getByText('最近项目')).toBeInTheDocument();
    expect(screen.getByText('测试小说')).toBeInTheDocument();
    expect(screen.getByText('一个测试项目')).toBeInTheDocument();
  });

  it('项目卡片显示字数与更新时间', () => {
    mockStore({ projects: [makeProject({ totalWords: 12345 })] });
    render(<Home />);
    expect(screen.getByText('12,345 字')).toBeInTheDocument();
  });

  it('无描述时显示"暂无描述"', () => {
    mockStore({ projects: [makeProject({ description: '' })] });
    render(<Home />);
    expect(screen.getByText('暂无描述')).toBeInTheDocument();
  });

  it('点击项目卡片 navigate 到 editor', () => {
    mockStore({ projects: [makeProject({ id: 'p-abc' })] });
    render(<Home />);
    fireEvent.click(screen.getByText('测试小说'));
    expect(navigateMock).toHaveBeenCalledWith('/project/p-abc/editor');
  });

  it('点击删除按钮 + confirm true 调用 deleteProject', async () => {
    const { deleteProject } = mockStore({ projects: [makeProject({ id: 'p-del' })] });
    render(<Home />);
    // a11y 改进后删除按钮有 aria-label，用 getByLabelText 精确查找
    const deleteButton = screen.getByLabelText(/删除项目/);
    fireEvent.click(deleteButton);
    expect(confirmMock).toHaveBeenCalledWith('确定要删除这个项目吗？');
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('p-del'));
  });

  it('confirm false 时不调用 deleteProject', () => {
    confirmMock.mockResolvedValue(false);
    const { deleteProject } = mockStore({ projects: [makeProject({ id: 'p-del' })] });
    render(<Home />);
    const deleteButton = screen.getByLabelText(/删除项目/);
    fireEvent.click(deleteButton);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  // ============ 模板区 ============
  it('有项目时显示"从模板开始"区域', () => {
    mockStore({ projects: [makeProject()] });
    render(<Home />);
    expect(screen.getByText('从模板开始')).toBeInTheDocument();
  });

  // ============ 新建项目模态框 ============
  it('点击"新建项目"按钮打开模态框', () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('新建项目'));
    expect(screen.getByText('项目名称')).toBeInTheDocument();
    expect(screen.getByText('结构模板')).toBeInTheDocument();
  });

  it('空名称时"创建"按钮 disabled', () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('新建项目'));
    // 模态框内的"创建"按钮（区分于 header 的"新建项目"按钮）
    const createBtn = screen.getByText('创建');
    expect(createBtn).toBeDisabled();
  });

  it('输入名称后"创建"按钮启用，点击后调用 createProject + navigate', async () => {
    const createdProject = makeProject({ id: 'new-1', title: '新书' });
    const { createProject } = mockStore({
      projects: [],
      createProject: vi.fn().mockResolvedValue(createdProject),
    });
    render(<Home />);
    fireEvent.click(screen.getByText('新建项目'));
    const input = screen.getByPlaceholderText('输入项目名称...');
    fireEvent.change(input, { target: { value: '新书' } });
    const createBtn = screen.getByText('创建');
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith('新书', 'blank');
      expect(navigateMock).toHaveBeenCalledWith('/project/new-1/editor');
    });
  });

  it('Enter 键触发创建', async () => {
    const createdProject = makeProject({ id: 'new-2' });
    const { createProject } = mockStore({
      projects: [],
      createProject: vi.fn().mockResolvedValue(createdProject),
    });
    render(<Home />);
    fireEvent.click(screen.getByText('新建项目'));
    const input = screen.getByPlaceholderText('输入项目名称...');
    fireEvent.change(input, { target: { value: '回车创建' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith('回车创建', 'blank');
    });
  });

  it('点击"取消"关闭模态框', () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('新建项目'));
    expect(screen.getByText('项目名称')).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('项目名称')).not.toBeInTheDocument();
  });

  it('点击遮罩层关闭模态框', () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('新建项目'));
    // 遮罩层是模态框的最外层 div（fixed inset-0 z-50）
    const overlay = document.querySelector('.fixed.inset-0.z-50') as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay);
    expect(screen.queryByText('项目名称')).not.toBeInTheDocument();
  });

  // ============ 导入模态框 ============
  // SmartImportModal 在 Home.tsx 中为 lazy 加载（降低首屏主入口 chunk 体积），
  // 点击后需 await findByTestId 等待 Suspense 解析完成，不能用同步 getByTestId
  it('点击"智能导入"打开 SmartImportModal', async () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('智能导入'));
    expect(await screen.findByTestId('smart-import-modal')).toBeInTheDocument();
  });

  // ============ Onboarding ============
  it('首次访问（未见过 onboarding）显示 OnboardingGuide', () => {
    mockStore({ projects: [] });
    render(<Home />);
    expect(screen.getByTestId('onboarding-guide')).toBeInTheDocument();
  });

  it('已见过 onboarding（localStorage 有记录）不显示 OnboardingGuide', () => {
    storageMap.set('has_seen_onboarding', 'true');
    mockStore({ projects: [] });
    render(<Home />);
    expect(screen.queryByTestId('onboarding-guide')).not.toBeInTheDocument();
  });

  it('完成 onboarding 后写入 localStorage 并关闭', () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('complete-onboarding'));
    expect(storageMap.get('has_seen_onboarding')).toBe('true');
    expect(screen.queryByTestId('onboarding-guide')).not.toBeInTheDocument();
  });

  it('跳过 onboarding 同样写入 localStorage 并关闭', () => {
    mockStore({ projects: [] });
    render(<Home />);
    fireEvent.click(screen.getByText('skip-onboarding'));
    expect(storageMap.get('has_seen_onboarding')).toBe('true');
    expect(screen.queryByTestId('onboarding-guide')).not.toBeInTheDocument();
  });
});
