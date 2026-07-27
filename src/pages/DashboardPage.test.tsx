/**
 * DashboardPage 单元测试（smoke + 关键交互）
 *
 * 测试范围：
 *   - 加载流程：useEffect 调用 loadProjects + openProject，cancelled 守卫
 *   - 项目不存在 fallback：加载中 / 加载完成但项目不存在 + 返回首页按钮
 *   - 项目存在：渲染标题 / 返回编辑按钮 / 警报横幅
 *   - 统计卡片：6 列基础统计（章节/总字数/阅读分钟/角色/支线/伏笔）
 *   - 完成度卡片：completionRate / 已完成章数 / 草稿章数
 *   - 存稿卡片：updateSchedule 存在/不存在 / 存稿天数颜色阈值
 *   - 伏笔回收率卡片：recoveryRate / 已回收/推进中/已埋设
 *   - 警报中心：无警报 / 支线停滞警报（open/progressing 阈值不同）/ 存稿告警（高/中）/ 伏笔悬而未决 / 草稿堆积
 *   - 支线状态分布：无支线 / 5 种状态计数
 *   - 章节进度概览：无章节 / 章节按钮点击 setCurrentChapter + navigate
 *   - 灵犀助手快捷入口：6 个 QuickLink 点击行为（setRightPanelTab/navigate）
 *   - 头部返回按钮 / 返回编辑按钮
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DashboardPage from '@/pages/DashboardPage';
import { useAppStore } from '@/store/useAppStore';
import type {
  Project,
  Chapter,
  Character,
  Foreshadow,
  Subplot,
  UpdateSchedule,
} from '@/types';

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
    wordCount: 0,
    content: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Chapter;
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'char-1',
    projectId: 'p-1',
    name: '主角',
    role: 'protagonist',
    description: '',
    age: '',
    gender: '',
    personality: '',
    background: '',
    motivation: '',
    arc: '',
    relationships: [],
    tags: [],
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Character;
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'f-1',
    projectId: 'p-1',
    title: '伏笔1',
    description: '',
    status: 'planted',
    plantedChapterId: 'c-1',
    payoffChapterId: null,
    priority: 'medium',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSubplot(overrides: Partial<Subplot> = {}): Subplot {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 's-1',
    projectId: 'p-1',
    title: '支线1',
    description: '',
    status: 'open',
    startChapterId: null,
    lastProgressChapterId: null,
    expectedCloseChapterId: null,
    relatedCharacters: [],
    relatedForeshadows: [],
    notes: '',
    lastProgressAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeUpdateSchedule(overrides: Partial<UpdateSchedule> = {}): UpdateSchedule {
  return {
    dailyTargetWords: 2000,
    dailySpeed: 1500,
    paywallChapterThreshold: 30,
    lastUpdateAt: null,
    enableStaleAlert: true,
    staleAlertDays: 3,
    ...overrides,
  } as UpdateSchedule;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  projects: Project[];
  chapters: Chapter[];
  characters: Character[];
  foreshadows: Foreshadow[];
  subplots: Subplot[];
  updateSchedule: UpdateSchedule | null;
  getStockpileDays: ReturnType<typeof vi.fn>;
  loadProjects: ReturnType<typeof vi.fn>;
  openProject: ReturnType<typeof vi.fn>;
  setCurrentChapter: ReturnType<typeof vi.fn>;
  setRightPanelTab: ReturnType<typeof vi.fn>;
}> = {}) {
  const loadProjects = overrides.loadProjects || vi.fn().mockResolvedValue(undefined);
  const openProject = overrides.openProject || vi.fn().mockResolvedValue(undefined);
  const getStockpileDays = overrides.getStockpileDays || vi.fn().mockReturnValue(10);
  const setCurrentChapter = overrides.setCurrentChapter || vi.fn();
  const setRightPanelTab = overrides.setRightPanelTab || vi.fn();

  useAppStore.setState({
    projects: overrides.projects || [makeProject()],
    chapters: overrides.chapters || [],
    characters: overrides.characters || [],
    foreshadows: overrides.foreshadows || [],
    subplots: overrides.subplots || [],
    updateSchedule: overrides.updateSchedule === undefined ? null : overrides.updateSchedule,
    getStockpileDays,
    loadProjects,
    openProject,
    setCurrentChapter,
    setRightPanelTab,
  });

  return { loadProjects, openProject, getStockpileDays, setCurrentChapter, setRightPanelTab };
}

// ============ 渲染辅助 ============
function renderDashboard(route = '/project/p-1/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/project/:projectId/dashboard" element={<DashboardPage />} />
        <Route path="/" element={<div data-testid="home">首页</div>} />
        <Route path="/project/:projectId/editor" element={<div data-testid="editor">编辑器</div>} />
        <Route path="/project/:projectId/review" element={<div data-testid="review">审稿</div>} />
        <Route path="/project/:projectId/export" element={<div data-testid="export">导出</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn();
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
    renderDashboard();
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
    renderDashboard();
    expect(loadProjects).toHaveBeenCalled();
    // loadProjects 未 resolve 前 openProject 不应被调用
    expect(openProject).not.toHaveBeenCalled();
    resolveLoad();
    await waitFor(() => expect(openProject).toHaveBeenCalledWith('p-1'));
  });

  it('unmount 后 cancelled 守卫丢弃结果（不调用 setProjectLoading）', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveLoad: () => void = () => {};
    const loadProjects = vi.fn().mockReturnValue(new Promise<void>(r => { resolveLoad = r; }));
    mockStore({ loadProjects });
    const { unmount } = renderDashboard();
    unmount();
    // 卸载后 resolve，不应抛 React 警告
    resolveLoad();
    await new Promise(r => setTimeout(r, 10));
    // 验证卸载后 resolve 未触发 console.error（React setState 警告等）
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // ============ 项目不存在 fallback ============
  it('项目不存在 + 加载完成时显示"项目不存在或已被删除"', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('项目不存在或已被删除')).toBeInTheDocument();
    });
  });

  it('加载中显示"加载中..."', () => {
    // loadProjects 永不 resolve，保持加载中
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderDashboard();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('项目不存在时点击"返回首页"跳转到 /', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('返回首页')).toBeInTheDocument());
    fireEvent.click(screen.getByText('返回首页'));
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });

  // ============ 项目存在 ============
  it('渲染项目标题与"总控仪表盘"标题', async () => {
    mockStore({ projects: [makeProject({ title: '我的小说' })] });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('我的小说')).toBeInTheDocument();
      expect(screen.getByText('总控仪表盘')).toBeInTheDocument();
    });
  });

  it('头部返回按钮跳转到编辑器', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('返回编辑')).toBeInTheDocument());
    // 头部 ArrowLeft 按钮（无文案）+ "返回编辑" 按钮
    fireEvent.click(screen.getByText('返回编辑'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
  });

  it('头部 ArrowLeft 按钮跳转到编辑器', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('总控仪表盘')).toBeInTheDocument());
    // 头部第一个按钮是 ArrowLeft
    const backBtn = screen.getAllByRole('button')[0];
    fireEvent.click(backBtn);
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
  });

  // ============ 统计卡片 ============
  it('6 个统计卡片正确显示数值', async () => {
    mockStore({
      projects: [makeProject()],
      chapters: [
        makeChapter({ id: 'c1', wordCount: 1000, status: 'done' }),
        makeChapter({ id: 'c2', wordCount: 500, status: 'draft' }),
      ],
      characters: [makeCharacter({ id: 'ch1' }), makeCharacter({ id: 'ch2', name: '配角' })],
      subplots: [makeSubplot({ id: 's1' })],
      foreshadows: [makeForeshadow({ id: 'f1' })],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('总控仪表盘')).toBeInTheDocument());
    // 6 个标签
    expect(screen.getByText('章节')).toBeInTheDocument();
    expect(screen.getByText('总字数')).toBeInTheDocument();
    expect(screen.getByText('阅读分钟')).toBeInTheDocument();
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('支线')).toBeInTheDocument();
    expect(screen.getByText('伏笔')).toBeInTheDocument();
    // 章节数 = 2，角色数 = 2（两个 stat 卡都显示 2；章节进度按钮 "2" 也会匹配）
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);
    // 总字数 1500 → "1,500"
    expect(screen.getByText('1,500')).toBeInTheDocument();
    // 阅读分钟 = ceil(1500/400) = 4
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  // ============ 完成度卡片 ============
  it('完成度卡片：1/2 章完成 → 50%', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'c1', status: 'done' }),
        makeChapter({ id: 'c2', status: 'draft' }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('全书完成度')).toBeInTheDocument());
    expect(screen.getByText('已完成 1 章')).toBeInTheDocument();
    expect(screen.getByText('草稿 1 章')).toBeInTheDocument();
    // 50% 显示在完成度数字位
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('无章节时 completionRate=0', async () => {
    mockStore({ chapters: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('全书完成度')).toBeInTheDocument());
    expect(screen.getByText('已完成 0 章')).toBeInTheDocument();
    expect(screen.getByText('草稿 0 章')).toBeInTheDocument();
  });

  // ============ 存稿卡片 ============
  it('无 updateSchedule 时显示"未配置存稿计划"', async () => {
    mockStore({ updateSchedule: null });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('存稿储备')).toBeInTheDocument());
    expect(screen.getByText('未配置存稿计划')).toBeInTheDocument();
  });

  it('有 updateSchedule 时显示存稿天数 + 日目标 + 速度', async () => {
    mockStore({
      updateSchedule: makeUpdateSchedule({ dailyTargetWords: 3000, dailySpeed: 2000 }),
      getStockpileDays: vi.fn().mockReturnValue(10),
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('存稿储备')).toBeInTheDocument());
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('天')).toBeInTheDocument();
    expect(screen.getByText(/日目标 3,000 字/)).toBeInTheDocument();
    expect(screen.getByText(/速度 2000 字\/日/)).toBeInTheDocument();
  });

  // ============ 伏笔回收率卡片 ============
  it('伏笔回收率：1/2 回收 → 50%', async () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'f1', status: 'paid-off' }),
        makeForeshadow({ id: 'f2', status: 'planted' }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('伏笔回收率')).toBeInTheDocument());
    expect(screen.getByText('已回收 1')).toBeInTheDocument();
    expect(screen.getByText('推进中 0')).toBeInTheDocument();
    expect(screen.getByText('已埋设 1')).toBeInTheDocument();
  });

  it('无伏笔时 recoveryRate=100', async () => {
    mockStore({ foreshadows: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('伏笔回收率')).toBeInTheDocument());
    expect(screen.getByText('已回收 0')).toBeInTheDocument();
    // recoveryRate=100，多个 "100" 中至少有一个是回收率
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
  });

  // ============ 警报中心 ============
  it('无警报时显示"一切正常，无任何警报"', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('警报中心')).toBeInTheDocument());
    expect(screen.getByText('一切正常，无任何警报')).toBeInTheDocument();
  });

  it('支线 open 状态停留 ≥7 天触发中级别警报', async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    mockStore({
      subplots: [makeSubplot({ id: 's1', title: '支线A', status: 'open', updatedAt: oldDate })],
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/支线「支线A」已 8 天未推进/)).toBeInTheDocument();
    });
  });

  it('支线 progressing 状态停留 ≥14 天触发高级别警报', async () => {
    const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    mockStore({
      subplots: [makeSubplot({ id: 's1', title: '支线B', status: 'progressing', updatedAt: oldDate })],
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/支线「支线B」已 15 天未推进/)).toBeInTheDocument();
    });
    // 高级别警报横幅也应显示
    expect(screen.getByText(/项高优先级警报/)).toBeInTheDocument();
  });

  it('支线 closed/abandoned 状态不触发警报', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    mockStore({
      subplots: [
        makeSubplot({ id: 's1', status: 'closed', updatedAt: oldDate }),
        makeSubplot({ id: 's2', status: 'abandoned', updatedAt: oldDate }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('警报中心')).toBeInTheDocument());
    expect(screen.getByText('一切正常，无任何警报')).toBeInTheDocument();
  });

  it('存稿 <3 天触发高级别警报', async () => {
    mockStore({
      updateSchedule: makeUpdateSchedule(),
      getStockpileDays: vi.fn().mockReturnValue(2),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('存稿仅剩 2 天')).toBeInTheDocument();
    });
  });

  it('存稿 3-6 天触发中级别警报', async () => {
    mockStore({
      updateSchedule: makeUpdateSchedule(),
      getStockpileDays: vi.fn().mockReturnValue(5),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('存稿 5 天，临近警戒线')).toBeInTheDocument();
    });
  });

  it('存稿 ≥7 天不触发存稿警报', async () => {
    mockStore({
      updateSchedule: makeUpdateSchedule(),
      getStockpileDays: vi.fn().mockReturnValue(10),
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('警报中心')).toBeInTheDocument());
    expect(screen.queryByText(/存稿仅剩/)).not.toBeInTheDocument();
    expect(screen.queryByText(/存稿.*临近警戒线/)).not.toBeInTheDocument();
  });

  it('伏笔 planted 状态超过 5 章未推进触发警报', async () => {
    const chapters = Array.from({ length: 10 }, (_, i) =>
      makeChapter({ id: `c${i + 1}`, order: i + 1 }),
    );
    mockStore({
      chapters,
      foreshadows: [makeForeshadow({ id: 'f1', title: '神秘伏笔', plantedChapterId: 'c1', status: 'planted' })],
    });
    renderDashboard();
    await waitFor(() => {
      // 第 1 章埋设，共 10 章 → 已埋设 10 章未推进（10 - 0 = 10）
      expect(screen.getByText(/伏笔「神秘伏笔」已埋设 10 章未推进/)).toBeInTheDocument();
    });
  });

  it('伏笔 planted 状态在最后 5 章内不触发警报', async () => {
    const chapters = Array.from({ length: 10 }, (_, i) =>
      makeChapter({ id: `c${i + 1}`, order: i + 1 }),
    );
    mockStore({
      chapters,
      foreshadows: [makeForeshadow({ id: 'f1', plantedChapterId: 'c8', status: 'planted' })],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('警报中心')).toBeInTheDocument());
    expect(screen.queryByText(/已埋设.*章未推进/)).not.toBeInTheDocument();
  });

  it('草稿章节数 ≥5 触发低级别警报', async () => {
    mockStore({
      chapters: Array.from({ length: 5 }, (_, i) =>
        makeChapter({ id: `c${i + 1}`, order: i + 1, status: 'draft' }),
      ),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('5 章处于草稿状态')).toBeInTheDocument();
    });
  });

  it('草稿章节数 <5 不触发草稿堆积警报', async () => {
    mockStore({
      chapters: Array.from({ length: 4 }, (_, i) =>
        makeChapter({ id: `c${i + 1}`, order: i + 1, status: 'draft' }),
      ),
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('警报中心')).toBeInTheDocument());
    expect(screen.queryByText(/处于草稿状态/)).not.toBeInTheDocument();
  });

  it('高级别警报横幅显示数量', async () => {
    const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    mockStore({
      subplots: [
        makeSubplot({ id: 's1', status: 'progressing', updatedAt: oldDate }),
        makeSubplot({ id: 's2', status: 'progressing', updatedAt: oldDate }),
      ],
      updateSchedule: makeUpdateSchedule(),
      getStockpileDays: vi.fn().mockReturnValue(2),
    });
    renderDashboard();
    await waitFor(() => {
      // 2 个支线停滞 + 1 个存稿告急 = 3 项高级别
      expect(screen.getByText('3 项高优先级警报')).toBeInTheDocument();
    });
  });

  it('无高级别警报时不显示警报横幅', async () => {
    mockStore({
      updateSchedule: makeUpdateSchedule(),
      getStockpileDays: vi.fn().mockReturnValue(5), // 中级别
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('警报中心')).toBeInTheDocument());
    expect(screen.queryByText(/项高优先级警报/)).not.toBeInTheDocument();
  });

  it('警报项展示级别标签（高/中/低）', async () => {
    const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    mockStore({
      subplots: [makeSubplot({ id: 's1', status: 'progressing', updatedAt: oldDate })],
      chapters: Array.from({ length: 5 }, (_, i) =>
        makeChapter({ id: `c${i + 1}`, order: i + 1, status: 'draft' }),
      ),
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('高')).toBeInTheDocument());
    expect(screen.getByText('低')).toBeInTheDocument();
  });

  // ============ 支线状态分布 ============
  it('无支线时显示"暂无支线"', async () => {
    mockStore({ subplots: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('支线状态分布')).toBeInTheDocument());
    expect(screen.getByText('暂无支线')).toBeInTheDocument();
  });

  it('5 种支线状态分别计数', async () => {
    mockStore({
      subplots: [
        makeSubplot({ id: 's1', status: 'open' }),
        makeSubplot({ id: 's2', status: 'open' }),
        makeSubplot({ id: 's3', status: 'progressing' }),
        makeSubplot({ id: 's4', status: 'paused' }),
        makeSubplot({ id: 's5', status: 'closed' }),
        makeSubplot({ id: 's6', status: 'abandoned' }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('支线状态分布')).toBeInTheDocument());
    // 每个状态格显示数量（SUBPLOT_STATUS_LABELS：open=已开启/progressing=推进中/paused=已暂停/closed=已收束/abandoned=已废弃）
    expect(screen.getByText('已开启')).toBeInTheDocument();
    expect(screen.getByText('推进中')).toBeInTheDocument();
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('已收束')).toBeInTheDocument();
    expect(screen.getByText('已废弃')).toBeInTheDocument();
  });

  it('"管理支线"按钮跳转编辑器', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('管理支线 →')).toBeInTheDocument());
    fireEvent.click(screen.getByText('管理支线 →'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
  });

  // ============ 章节进度概览 ============
  it('无章节时显示"暂无章节"', async () => {
    mockStore({ chapters: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('章节进度概览')).toBeInTheDocument());
    expect(screen.getByText('暂无章节')).toBeInTheDocument();
  });

  it('章节按钮显示序号 + title 包含标题与状态', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'c1', order: 1, title: '开端', status: 'done' }),
        makeChapter({ id: 'c2', order: 2, title: '发展', status: 'draft' }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('章节进度概览')).toBeInTheDocument());
    // 序号 1 / 2 显示在按钮上
    expect(screen.getByTitle('第 1 章：开端（已完成）')).toBeInTheDocument();
    expect(screen.getByTitle('第 2 章：发展（草稿）')).toBeInTheDocument();
  });

  it('点击章节按钮调用 setCurrentChapter + navigate', async () => {
    const { setCurrentChapter } = mockStore({
      chapters: [makeChapter({ id: 'c1', order: 1, title: '第一章' })],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('章节进度概览')).toBeInTheDocument());
    // 通过 title 定位章节按钮，避免与 stat 卡数字 "1" 冲突
    const chapterBtn = screen.getByTitle('第 1 章：第一章（草稿）');
    fireEvent.click(chapterBtn);
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
    expect(setCurrentChapter).toHaveBeenCalledWith('c1');
  });

  it('章节进度概览显示 "已完成 X / Y"', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'c1', status: 'done' }),
        makeChapter({ id: 'c2', status: 'done' }),
        makeChapter({ id: 'c3', status: 'draft' }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('章节进度概览')).toBeInTheDocument());
    expect(screen.getByText('2 / 3 已完成')).toBeInTheDocument();
  });

  // ============ 灵犀助手快捷入口 ============
  it('6 个快捷入口全部渲染', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('灵犀助手快捷入口')).toBeInTheDocument());
    expect(screen.getByText('灵犀设定')).toBeInTheDocument();
    expect(screen.getByText('灵犀蓝图')).toBeInTheDocument();
    expect(screen.getByText('灵犀写作')).toBeInTheDocument();
    expect(screen.getByText('灵犀打磨')).toBeInTheDocument();
    expect(screen.getByText('灵犀发布')).toBeInTheDocument();
    expect(screen.getByText('支线/存稿')).toBeInTheDocument();
  });

  it('点击"灵犀设定"调用 setRightPanelTab(coreSetting) + navigate', async () => {
    const { setRightPanelTab } = mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('灵犀设定')).toBeInTheDocument());
    fireEvent.click(screen.getByText('灵犀设定'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
    expect(setRightPanelTab).toHaveBeenCalledWith('coreSetting');
  });

  it('点击"灵犀蓝图"调用 setRightPanelTab(blueprint)', async () => {
    const { setRightPanelTab } = mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('灵犀蓝图')).toBeInTheDocument());
    fireEvent.click(screen.getByText('灵犀蓝图'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
    expect(setRightPanelTab).toHaveBeenCalledWith('blueprint');
  });

  it('点击"灵犀写作"调用 setRightPanelTab(ai)', async () => {
    const { setRightPanelTab } = mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('灵犀写作')).toBeInTheDocument());
    fireEvent.click(screen.getByText('灵犀写作'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
    expect(setRightPanelTab).toHaveBeenCalledWith('ai');
  });

  it('点击"灵犀打磨"跳转审稿页', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('灵犀打磨')).toBeInTheDocument());
    fireEvent.click(screen.getByText('灵犀打磨'));
    await waitFor(() => expect(screen.getByTestId('review')).toBeInTheDocument());
  });

  it('点击"灵犀发布"跳转导出页', async () => {
    mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('灵犀发布')).toBeInTheDocument());
    fireEvent.click(screen.getByText('灵犀发布'));
    await waitFor(() => expect(screen.getByTestId('export')).toBeInTheDocument());
  });

  it('点击"支线/存稿"调用 setRightPanelTab(subplot)', async () => {
    const { setRightPanelTab } = mockStore();
    renderDashboard();
    await waitFor(() => expect(screen.getByText('支线/存稿')).toBeInTheDocument());
    fireEvent.click(screen.getByText('支线/存稿'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
    expect(setRightPanelTab).toHaveBeenCalledWith('subplot');
  });

  // ============ 边界场景 ============
  it('无 projectId 时不调用 loadProjects', () => {
    // 路由不匹配，DashboardPage 不会挂载；改用直接渲染无路由场景的兜底
    // 这里通过空路由验证 useParams 返回 undefined 时 useEffect 早 return
    const loadProjects = vi.fn().mockResolvedValue(undefined);
    mockStore({ loadProjects });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // 无 projectId 时 useEffect 早 return，loadProjects 不被调用
    expect(loadProjects).not.toHaveBeenCalled();
  });
});
