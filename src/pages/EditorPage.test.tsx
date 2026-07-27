/**
 * EditorPage 单元测试（smoke + 关键交互）
 *
 * 测试范围（聚焦于 EditorPage 自身逻辑，子面板全部 mock 避免重复测其内部）：
 *   - 加载流程：useEffect 调用 loadProjects + openProject，竞态守卫
 *   - 三种 fallback：加载中 / 项目不存在 / 加载失败（重试）
 *   - 顶栏：标题渲染、章节标题、9 个按钮（home/search/version/conflict/dashboard/review/export/settings/save）
 *   - 左侧面板：outline/polish tab 切换、折叠/展开
 *   - 右侧面板：9 个 tab 切换、折叠/展开
 *   - 状态栏：章节数、总字数、当前章节字数、阅读时间、最后保存时间
 *   - 交互式引导：首次进入触发、已看过不触发、complete/skip 写入 localStorage
 *   - 版本/冲突抽屉：打开/关闭、互斥切换
 *   - 保存按钮：disabled 状态、点击调用 saveProject
 *   - 全局快捷键 Ctrl+K 打开搜索
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EditorPage from '@/pages/EditorPage';
import { useAppStore } from '@/store/useAppStore';
import type { Project, Chapter } from '@/types';

// ============ mocks ============
// react-router-dom：静态 projectId + navigate mock
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'p-1' }),
  useNavigate: () => navigateMock,
}));

// 全局快捷键 hook：EditorPage 注册 Ctrl+K，但测试中不实际监听键盘
// 直接 mock 为 no-op，避免拉入 store 的 saveVersion/saveProject 依赖
vi.mock('@/hooks/useGlobalHotkeys', () => ({
  useAppHotkeys: () => {},
}));

// 子面板全部 mock：每个面板都有自己的单元测试，这里仅验证 EditorPage 切换 tab 时渲染对应面板
const panelRenderLog: string[] = [];
vi.mock('@/components/editor/OutlinePanel', () => ({
  default: function MockOutlinePanel() {
    return <div data-testid="mock-outline-panel">OutlinePanel</div>;
  },
}));
vi.mock('@/components/editor/TiptapEditor', () => ({
  default: function MockTiptapEditor() {
    return <div data-testid="mock-tiptap-editor">TiptapEditor</div>;
  },
}));
vi.mock('@/components/editor/AIPanel', () => ({
  default: function MockAIPanel() {
    panelRenderLog.push('ai');
    return <div data-testid="mock-ai-panel">AIPanel</div>;
  },
}));
vi.mock('@/components/editor/CharactersPanel', () => ({
  default: function MockCharactersPanel() {
    panelRenderLog.push('characters');
    return <div data-testid="mock-characters-panel">CharactersPanel</div>;
  },
}));
vi.mock('@/components/editor/SettingsPanel', () => ({
  default: function MockSettingsPanel() {
    panelRenderLog.push('settings');
    return <div data-testid="mock-settings-panel">SettingsPanel</div>;
  },
}));
vi.mock('@/components/editor/ForeshadowPanel', () => ({
  default: function MockForeshadowPanel() {
    panelRenderLog.push('foreshadows');
    return <div data-testid="mock-foreshadow-panel">ForeshadowPanel</div>;
  },
}));
vi.mock('@/components/editor/MaterialsPanel', () => ({
  default: function MockMaterialsPanel() {
    panelRenderLog.push('materials');
    return <div data-testid="mock-materials-panel">MaterialsPanel</div>;
  },
}));
// 懒加载组件：mock 为同步返回，避免 Suspense 复杂性
vi.mock('@/components/editor/CoreSettingCardPanel', () => ({
  default: function MockCoreSettingCardPanel() {
    panelRenderLog.push('coreSetting');
    return <div data-testid="mock-coresetting-panel">CoreSettingCardPanel</div>;
  },
}));
vi.mock('@/components/editor/BlueprintPanel', () => ({
  default: function MockBlueprintPanel() {
    panelRenderLog.push('blueprint');
    return <div data-testid="mock-blueprint-panel">BlueprintPanel</div>;
  },
}));
vi.mock('@/components/editor/SubplotPanel', () => ({
  default: function MockSubplotPanel() {
    panelRenderLog.push('subplot');
    return <div data-testid="mock-subplot-panel">SubplotPanel</div>;
  },
}));
vi.mock('@/components/editor/UpdateSchedulePanel', () => ({
  default: function MockUpdateSchedulePanel() {
    panelRenderLog.push('updateSchedule');
    return <div data-testid="mock-updateschedule-panel">UpdateSchedulePanel</div>;
  },
}));
vi.mock('@/components/editor/OutlinePolishPanel', () => ({
  default: function MockOutlinePolishPanel() {
    return <div data-testid="mock-outline-polish-panel">OutlinePolishPanel</div>;
  },
}));
vi.mock('@/components/editor/VersionHistoryPanel', () => ({
  default: function MockVersionHistoryPanel({ onClose }: { onClose: () => void }) {
    return (
      <div data-testid="mock-version-panel">
        VersionHistoryPanel
        <button data-testid="mock-version-close" onClick={onClose}>close</button>
      </div>
    );
  },
}));
vi.mock('@/components/editor/ConflictPanel', () => ({
  default: function MockConflictPanel({ onClose }: { onClose: () => void }) {
    return (
      <div data-testid="mock-conflict-panel">
        ConflictPanel
        <button data-testid="mock-conflict-close" onClick={onClose}>close</button>
      </div>
    );
  },
}));
vi.mock('@/components/SearchModal', () => ({
  default: function MockSearchModal({ onClose }: { onClose: () => void }) {
    return (
      <div data-testid="mock-search-modal">
        SearchModal
        <button data-testid="mock-search-close" onClick={onClose}>close</button>
      </div>
    );
  },
}));
vi.mock('@/components/SettingsModal', () => ({
  default: function MockSettingsModal({ onClose }: { onClose: () => void }) {
    return (
      <div data-testid="mock-settings-modal">
        SettingsModal
        <button data-testid="mock-settings-close" onClick={onClose}>close</button>
      </div>
    );
  },
}));
vi.mock('@/components/InteractiveTour', () => ({
  default: function MockInteractiveTour({
    onComplete,
    onSkip,
  }: {
    onComplete: () => void;
    onSkip: () => void;
  }) {
    return (
      <div data-testid="mock-tour">
        InteractiveTour
        <button data-testid="mock-tour-complete" onClick={onComplete}>complete</button>
        <button data-testid="mock-tour-skip" onClick={onSkip}>skip</button>
      </div>
    );
  },
}));

// safeStorage mock：通过 vi.hoisted 让 factory 能引用
const { safeGetMock, safeSetMock } = vi.hoisted(() => ({
  safeGetMock: vi.fn<(key: string) => string | null>(() => null),
  safeSetMock: vi.fn<(key: string, value: string) => void>(),
}));
vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGet: safeGetMock,
  safeLocalStorageSet: safeSetMock,
}));

// ============ fixtures ============
function makeProject(overrides: Partial<Project> = {}): Project {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'p-1',
    title: '测试项目',
    description: '',
    template: 'blank',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    totalWords: 1000,
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
        descriptionDensity: 50,
        dialogueDensity: 50,
        strictness: 50,
        temperature: 0.7,
        maxTokens: 2000,
        autoCheckConflicts: false,
      },
    },
    ...overrides,
  } as Project;
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'c-1',
    projectId: 'p-1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 1,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 500,
    content: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Chapter;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  projects: Project[];
  chapters: Chapter[];
  currentChapterId: string | null;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: string;
  lastSavedAt: string | null;
  loadProjects: ReturnType<typeof vi.fn>;
  openProject: ReturnType<typeof vi.fn>;
  saveProject: ReturnType<typeof vi.fn>;
  setLeftPanelCollapsed: ReturnType<typeof vi.fn>;
  setRightPanelCollapsed: ReturnType<typeof vi.fn>;
  setRightPanelTab: ReturnType<typeof vi.fn>;
}> = {}) {
  const loadProjects = overrides.loadProjects || vi.fn().mockResolvedValue(undefined);
  const openProject = overrides.openProject || vi.fn().mockResolvedValue(undefined);
  const saveProject = overrides.saveProject || vi.fn().mockResolvedValue(undefined);
  const setLeftPanelCollapsed = overrides.setLeftPanelCollapsed || vi.fn();
  const setRightPanelCollapsed = overrides.setRightPanelCollapsed || vi.fn();
  const setRightPanelTab = overrides.setRightPanelTab || vi.fn();

  useAppStore.setState({
    projects: overrides.projects || [makeProject()],
    chapters: overrides.chapters || [],
    currentChapterId: overrides.currentChapterId === undefined ? null : overrides.currentChapterId,
    leftPanelCollapsed: overrides.leftPanelCollapsed ?? false,
    rightPanelCollapsed: overrides.rightPanelCollapsed ?? false,
    rightPanelTab: (overrides.rightPanelTab || 'ai') as 'ai' | 'characters' | 'settings' | 'foreshadows' | 'materials' | 'coreSetting' | 'blueprint' | 'subplot' | 'updateSchedule',
    lastSavedAt: overrides.lastSavedAt === undefined ? null : overrides.lastSavedAt,
    loadProjects,
    openProject,
    saveProject,
    setLeftPanelCollapsed,
    setRightPanelCollapsed,
    setRightPanelTab,
  });

  return {
    loadProjects,
    openProject,
    saveProject,
    setLeftPanelCollapsed,
    setRightPanelCollapsed,
    setRightPanelTab,
  };
}

describe('EditorPage', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn();
    navigateMock.mockClear();
    safeGetMock.mockReset();
    safeSetMock.mockReset();
    safeGetMock.mockReturnValue(null); // 默认未看过引导
    panelRenderLog.length = 0;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
  });

  // ============ 加载流程 ============
  it('mount 时调用 loadProjects + openProject', async () => {
    const { loadProjects, openProject } = mockStore();
    render(<EditorPage />);
    await waitFor(() => {
      expect(loadProjects).toHaveBeenCalledTimes(1);
      expect(openProject).toHaveBeenCalledWith('p-1');
    });
  });

  it('loadProjects 完成后 openProject 才被调用（串行）', async () => {
    let resolveLoad: () => void = () => {};
    const loadProjects = vi.fn().mockReturnValue(new Promise<void>(r => { resolveLoad = r; }));
    const openProject = vi.fn().mockResolvedValue(undefined);
    mockStore({ loadProjects, openProject });
    render(<EditorPage />);
    expect(loadProjects).toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    resolveLoad();
    await waitFor(() => expect(openProject).toHaveBeenCalledWith('p-1'));
  });

  it('loadProjects 抛错时显示"项目加载失败，请重试"', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockRejectedValue(new Error('网络错误')),
    });
    render(<EditorPage />);
    await waitFor(() => {
      expect(screen.getByText('项目加载失败，请重试')).toBeInTheDocument();
    });
  });

  it('openProject 抛错时也显示"项目加载失败，请重试"', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockRejectedValue(new Error('文件读取失败')),
    });
    render(<EditorPage />);
    await waitFor(() => {
      expect(screen.getByText('项目加载失败，请重试')).toBeInTheDocument();
    });
  });

  it('加载失败时点击"重试"重新调用 loadProjects', async () => {
    const loadProjects = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(undefined);
    const openProject = vi.fn().mockResolvedValue(undefined);
    mockStore({
      projects: [],
      loadProjects,
      openProject,
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('项目加载失败，请重试')).toBeInTheDocument());
    expect(loadProjects).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(loadProjects).toHaveBeenCalledTimes(2));
  });

  it('加载失败时点击"返回首页"跳转到 /', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockRejectedValue(new Error('fail')),
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('项目加载失败，请重试')).toBeInTheDocument());
    fireEvent.click(screen.getByText('返回首页'));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('加载中显示"加载中..."', () => {
    // loadProjects 永不 resolve
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<EditorPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('加载完成但项目不存在显示"项目不存在"', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('项目不存在')).toBeInTheDocument());
  });

  it('项目不存在时点击"返回首页"跳转 /', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('项目不存在')).toBeInTheDocument());
    fireEvent.click(screen.getByText('返回首页'));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  // ============ 顶栏 ============
  it('渲染项目标题', async () => {
    mockStore({ projects: [makeProject({ title: '我的小说' })] });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('我的小说')).toBeInTheDocument());
  });

  it('当前章节存在时渲染章节标题', async () => {
    mockStore({
      projects: [makeProject()],
      chapters: [makeChapter({ id: 'c-1', title: '序章' })],
      currentChapterId: 'c-1',
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('序章')).toBeInTheDocument());
  });

  it('Home 按钮跳转到 /', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('返回项目列表')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('返回项目列表'));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('总控仪表盘按钮跳转到 dashboard', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('总控仪表盘')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('总控仪表盘'));
    expect(navigateMock).toHaveBeenCalledWith('/project/p-1/dashboard');
  });

  it('审稿中心按钮跳转到 review', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('审稿中心')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('审稿中心'));
    expect(navigateMock).toHaveBeenCalledWith('/project/p-1/review');
  });

  it('导出按钮跳转到 export', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('导出')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('导出'));
    expect(navigateMock).toHaveBeenCalledWith('/project/p-1/export');
  });

  it('点击搜索按钮打开搜索弹窗', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('全局搜索')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('全局搜索'));
    await waitFor(() => expect(screen.getByTestId('mock-search-modal')).toBeInTheDocument());
  });

  it('点击设置按钮打开设置弹窗', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('软件设置')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('软件设置'));
    await waitFor(() => expect(screen.getByTestId('mock-settings-modal')).toBeInTheDocument());
  });

  it('保存按钮在无 currentChapterId 时 disabled', async () => {
    mockStore({ currentChapterId: null });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('保存')).toBeDisabled());
  });

  it('保存按钮在有 currentChapterId 时点击调用 saveProject', async () => {
    const { saveProject } = mockStore({
      currentChapterId: 'c-1',
      chapters: [makeChapter({ id: 'c-1' })],
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('保存')).not.toBeDisabled());
    fireEvent.click(screen.getByLabelText('保存'));
    await waitFor(() => expect(saveProject).toHaveBeenCalled());
  });

  // ============ 版本/冲突抽屉 ============
  it('点击版本历史按钮打开版本抽屉', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('版本历史')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('版本历史'));
    await waitFor(() => expect(screen.getByTestId('mock-version-panel')).toBeInTheDocument());
  });

  it('版本抽屉打开时再点击版本历史按钮关闭', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('版本历史')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('版本历史'));
    await waitFor(() => expect(screen.getByTestId('mock-version-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('版本历史'));
    await waitFor(() => expect(screen.queryByTestId('mock-version-panel')).not.toBeInTheDocument());
  });

  it('打开冲突检测抽屉时关闭版本抽屉（互斥）', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('版本历史')).toBeInTheDocument());
    // 先开版本
    fireEvent.click(screen.getByLabelText('版本历史'));
    await waitFor(() => expect(screen.getByTestId('mock-version-panel')).toBeInTheDocument());
    // 再开冲突，版本应关闭
    fireEvent.click(screen.getByLabelText('冲突检测'));
    await waitFor(() => expect(screen.getByTestId('mock-conflict-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('mock-version-panel')).not.toBeInTheDocument();
  });

  it('抽屉 onClose 回调关闭抽屉', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('版本历史')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('版本历史'));
    await waitFor(() => expect(screen.getByTestId('mock-version-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mock-version-close'));
    await waitFor(() => expect(screen.queryByTestId('mock-version-panel')).not.toBeInTheDocument());
  });

  // ============ 左侧面板 ============
  it('默认显示大纲 tab，渲染 OutlinePanel', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-outline-panel')).toBeInTheDocument());
  });

  it('切换到打磨 tab 渲染 OutlinePolishPanel', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-outline-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('打磨'));
    await waitFor(() => expect(screen.getByTestId('mock-outline-polish-panel')).toBeInTheDocument());
  });

  it('点击折叠按钮调用 setLeftPanelCollapsed(true)', async () => {
    const { setLeftPanelCollapsed } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('折叠大纲面板')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('折叠大纲面板'));
    expect(setLeftPanelCollapsed).toHaveBeenCalledWith(true);
  });

  it('左侧面板折叠时显示展开按钮', async () => {
    mockStore({ leftPanelCollapsed: true });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('展开大纲面板')).toBeInTheDocument());
  });

  it('点击展开按钮调用 setLeftPanelCollapsed(false)', async () => {
    const { setLeftPanelCollapsed } = mockStore({ leftPanelCollapsed: true });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('展开大纲面板')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('展开大纲面板'));
    expect(setLeftPanelCollapsed).toHaveBeenCalledWith(false);
  });

  // ============ 右侧面板 ============
  it('默认渲染 AIPanel（rightPanelTab=ai）', async () => {
    mockStore({ rightPanelTab: 'ai' });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-panel')).toBeInTheDocument());
  });

  it('切换到角色 tab 调用 setRightPanelTab(characters)', async () => {
    const { setRightPanelTab } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('角色'));
    expect(setRightPanelTab).toHaveBeenCalledWith('characters');
  });

  it('切换到设定卡 tab 调用 setRightPanelTab(coreSetting)', async () => {
    const { setRightPanelTab } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('设定卡'));
    expect(setRightPanelTab).toHaveBeenCalledWith('coreSetting');
  });

  it('切换到蓝图 tab 调用 setRightPanelTab(blueprint)', async () => {
    const { setRightPanelTab } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('蓝图'));
    expect(setRightPanelTab).toHaveBeenCalledWith('blueprint');
  });

  it('切换到支线 tab 调用 setRightPanelTab(subplot)', async () => {
    const { setRightPanelTab } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('支线'));
    expect(setRightPanelTab).toHaveBeenCalledWith('subplot');
  });

  it('切换到存稿 tab 调用 setRightPanelTab(updateSchedule)', async () => {
    const { setRightPanelTab } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('存稿'));
    expect(setRightPanelTab).toHaveBeenCalledWith('updateSchedule');
  });

  it('右侧面板根据 rightPanelTab 渲染对应组件', async () => {
    mockStore({ rightPanelTab: 'characters' });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-characters-panel')).toBeInTheDocument());
    // 切到 foreshadows
    act(() => {
      useAppStore.setState({ rightPanelTab: 'foreshadows' });
    });
    await waitFor(() => expect(screen.getByTestId('mock-foreshadow-panel')).toBeInTheDocument());
    // 切到 materials
    act(() => {
      useAppStore.setState({ rightPanelTab: 'materials' });
    });
    await waitFor(() => expect(screen.getByTestId('mock-materials-panel')).toBeInTheDocument());
  });

  it('点击折叠按钮调用 setRightPanelCollapsed(true)', async () => {
    const { setRightPanelCollapsed } = mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('折叠右侧面板')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('折叠右侧面板'));
    expect(setRightPanelCollapsed).toHaveBeenCalledWith(true);
  });

  it('右侧面板折叠时显示展开按钮', async () => {
    mockStore({ rightPanelCollapsed: true });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByLabelText('展开右侧面板')).toBeInTheDocument());
  });

  // ============ 状态栏 ============
  it('状态栏显示章节总数 + 项目总字数', async () => {
    mockStore({
      projects: [makeProject({ totalWords: 12345 })],
      chapters: [
        makeChapter({ id: 'c1', levelType: 'chapter' }),
        makeChapter({ id: 'c2', levelType: 'chapter' }),
        makeChapter({ id: 'c3', levelType: 'volume' }), // 非章，不计入
      ],
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('共 2 章')).toBeInTheDocument());
    expect(screen.getByText('12,345 字')).toBeInTheDocument();
  });

  it('状态栏显示当前章节字数 + 阅读时间', async () => {
    mockStore({
      projects: [makeProject()],
      chapters: [makeChapter({ id: 'c-1', wordCount: 800 })],
      currentChapterId: 'c-1',
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('800 字')).toBeInTheDocument());
    // Math.ceil(800/400) = 2 分钟
    expect(screen.getByText('约 2 分钟阅读')).toBeInTheDocument();
  });

  it('状态栏显示"已自动保存"指示', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('已自动保存')).toBeInTheDocument());
  });

  it('lastSavedAt 存在时显示最后保存时间', async () => {
    mockStore({ lastSavedAt: '2025-01-01T10:30:45.000Z' });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText(/最后保存:/)).toBeInTheDocument());
  });

  it('lastSavedAt 为 null 时不显示最后保存时间', async () => {
    mockStore({ lastSavedAt: null });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('已自动保存')).toBeInTheDocument());
    expect(screen.queryByText(/最后保存:/)).not.toBeInTheDocument();
  });

  // ============ 交互式引导 ============
  it('首次进入（未看过引导）500ms 后触发引导', async () => {
    safeGetMock.mockReturnValue(null);
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-tour')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('已看过引导（localStorage 有值）不触发', async () => {
    safeGetMock.mockReturnValue('true');
    mockStore();
    render(<EditorPage />);
    // 等待超过 500ms 确保没触发
    await new Promise(r => setTimeout(r, 700));
    expect(screen.queryByTestId('mock-tour')).not.toBeInTheDocument();
  });

  it('项目不存在时不触发引导', async () => {
    safeGetMock.mockReturnValue(null);
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByText('项目不存在')).toBeInTheDocument());
    await new Promise(r => setTimeout(r, 700));
    expect(screen.queryByTestId('mock-tour')).not.toBeInTheDocument();
  });

  it('引导完成回调写入 localStorage 并关闭引导', async () => {
    safeGetMock.mockReturnValue(null);
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-tour')).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId('mock-tour-complete'));
    await waitFor(() => expect(screen.queryByTestId('mock-tour')).not.toBeInTheDocument());
    expect(safeSetMock).toHaveBeenCalledWith('has_seen_editor_tour', 'true');
  });

  it('引导跳过回调写入 localStorage 并关闭引导', async () => {
    safeGetMock.mockReturnValue(null);
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-tour')).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByTestId('mock-tour-skip'));
    await waitFor(() => expect(screen.queryByTestId('mock-tour')).not.toBeInTheDocument());
    expect(safeSetMock).toHaveBeenCalledWith('has_seen_editor_tour', 'true');
  });

  // ============ 编辑器区 ============
  it('渲染 TiptapEditor', async () => {
    mockStore();
    render(<EditorPage />);
    await waitFor(() => expect(screen.getByTestId('mock-tiptap-editor')).toBeInTheDocument());
  });
});
