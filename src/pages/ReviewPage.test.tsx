/**
 * ReviewPage 单元测试（smoke + 关键交互）
 *
 * 测试范围：
 *   - 加载流程：useEffect 调用 loadProjects + openProject，cancelled 守卫
 *   - 项目不存在 fallback：加载中 / 加载完成但项目不存在 + 返回首页按钮
 *   - 头部：标题、ArrowLeft + 返回编辑按钮
 *   - 4 个统计卡片：章节数 / 总字数（实时聚合）/ 阅读分钟 / 角色数
 *   - 情绪心电图 + 节奏曲线：loading / 有数据 / 暂无数据
 *   - AI 审稿建议：loading / 空 issues / 有 issues（结构/节奏/风格 三类）
 *   - 全书深度审阅：开始审阅 / 审阅中 / 结果展示（issues + summary）/ 错误 toast / 无章节提示
 *   - 风格一致性：开始检查 / 检查中 / 结果展示 / 错误 toast
 *   - 章节阅读体验：章节按钮 / 钩子分数 / 长句 / 重复词 / 错误 toast / 并发互斥
 *   - 各章数据表格：渲染 + 点击行调用 setCurrentChapter + navigate
 *   - 防抖 + 哈希缓存：未变更章节不重复分析
 *   - AI 率检测：2 个 AITracePanel 渲染
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ReviewPage from '@/pages/ReviewPage';
import { useAppStore } from '@/store/useAppStore';
import type { Project, Chapter, Character } from '@/types';

// ============ mocks ============
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'p-1' }),
  useNavigate: () => navigateMock,
}));

// 把 debounce 改为 0ms，避免测试等待 2s
vi.mock('@/constants/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/constants/config')>();
  return {
    ...actual,
    REVIEW_ANALYSIS_DEBOUNCE_MS: 0,
    REVIEW_ANALYSIS_CONCURRENCY: 2,
  };
});

// aiService 全量 mock
const {
  analyzeStructureMock,
  analyzeChapterMock,
  generateFullBookReviewMock,
  checkStyleConsistencyMock,
  analyzeChapterForReadingMock,
  toastMock,
} = vi.hoisted(() => ({
  analyzeStructureMock: vi.fn(),
  analyzeChapterMock: vi.fn(),
  generateFullBookReviewMock: vi.fn(),
  checkStyleConsistencyMock: vi.fn(),
  analyzeChapterForReadingMock: vi.fn(),
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/utils/aiService', () => ({
  aiService: {
    analyzeStructure: analyzeStructureMock,
    analyzeChapter: analyzeChapterMock,
    generateFullBookReview: generateFullBookReviewMock,
    checkStyleConsistency: checkStyleConsistencyMock,
    analyzeChapterForReading: analyzeChapterForReadingMock,
  },
}));

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

// AITracePanel mock：避免拉入真实组件的 store 依赖
vi.mock('@/components/editor/AITracePanel', () => ({
  default: function MockAITracePanel({ scope }: { scope: 'chapter' | 'book' }) {
    return <div data-testid={`mock-ai-trace-${scope}`}>AITracePanel:{scope}</div>;
  },
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
    content: '章节内容',
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
    color: '#ffffff',
    profile: {},
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Character;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  projects: Project[];
  chapters: Chapter[];
  characters: Character[];
  loadProjects: ReturnType<typeof vi.fn>;
  openProject: ReturnType<typeof vi.fn>;
  setCurrentChapter: ReturnType<typeof vi.fn>;
}> = {}) {
  const loadProjects = overrides.loadProjects || vi.fn().mockResolvedValue(undefined);
  const openProject = overrides.openProject || vi.fn().mockResolvedValue(undefined);
  const setCurrentChapter = overrides.setCurrentChapter || vi.fn();

  useAppStore.setState({
    projects: overrides.projects || [makeProject()],
    chapters: overrides.chapters || [],
    characters: overrides.characters || [],
    loadProjects,
    openProject,
    setCurrentChapter,
  });

  return { loadProjects, openProject, setCurrentChapter };
}

describe('ReviewPage', () => {
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    console.error = vi.fn();
    console.warn = vi.fn();
    navigateMock.mockClear();
    analyzeStructureMock.mockReset();
    analyzeChapterMock.mockReset();
    generateFullBookReviewMock.mockReset();
    checkStyleConsistencyMock.mockReset();
    analyzeChapterForReadingMock.mockReset();
    toastMock.error.mockClear();
    toastMock.success.mockClear();
    toastMock.info.mockClear();
    toastMock.warning.mockClear();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
  });

  // ============ 加载流程 ============
  it('mount 时调用 loadProjects + openProject', async () => {
    const { loadProjects, openProject } = mockStore();
    render(<ReviewPage />);
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
    render(<ReviewPage />);
    expect(loadProjects).toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    resolveLoad();
    await waitFor(() => expect(openProject).toHaveBeenCalledWith('p-1'));
  });

  it('加载中显示"加载中..."', () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<ReviewPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('项目不存在 + 加载完成时显示"项目不存在或已被删除"', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('项目不存在或已被删除')).toBeInTheDocument());
  });

  it('项目不存在时点击"返回首页"跳转 /', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('返回首页')).toBeInTheDocument());
    fireEvent.click(screen.getByText('返回首页'));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  // ============ 头部 ============
  it('渲染"审稿中心"标题 + 项目标题', async () => {
    mockStore({ projects: [makeProject({ title: '我的小说' })] });
    render(<ReviewPage />);
    await waitFor(() => {
      expect(screen.getByText('审稿中心')).toBeInTheDocument();
      expect(screen.getByText('我的小说')).toBeInTheDocument();
    });
  });

  it('点击"返回编辑"跳转 editor', async () => {
    mockStore();
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('返回编辑')).toBeInTheDocument());
    fireEvent.click(screen.getByText('返回编辑'));
    expect(navigateMock).toHaveBeenCalledWith('/project/p-1/editor');
  });

  it('头部 ArrowLeft 按钮跳转 editor', async () => {
    mockStore();
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('审稿中心')).toBeInTheDocument());
    // 头部第一个按钮是 ArrowLeft
    const backBtn = screen.getAllByRole('button')[0];
    fireEvent.click(backBtn);
    expect(navigateMock).toHaveBeenCalledWith('/project/p-1/editor');
  });

  // ============ 4 个统计卡片 ============
  it('4 个统计卡片正确显示数值', async () => {
    mockStore({
      projects: [makeProject()],
      chapters: [
        makeChapter({ id: 'c1', wordCount: 1000, levelType: 'chapter' }),
        makeChapter({ id: 'c2', wordCount: 500, levelType: 'chapter' }),
        makeChapter({ id: 'v1', levelType: 'volume' }), // 非章，不计入
      ],
      characters: [makeCharacter({ id: 'ch1' }), makeCharacter({ id: 'ch2', name: '配角' })],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节数')).toBeInTheDocument());
    // mainChapters.length = 2，角色数 = 2（两个 stat 卡都显示 2）
    expect(screen.getAllByText('2').length).toBe(2);
    // 总字数 = 1000+500 = 1500 → "1,500"
    expect(screen.getByText('1,500')).toBeInTheDocument();
    // 阅读分钟 = ceil(1500/400) = 4
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('角色数')).toBeInTheDocument();
  });

  // ============ 情绪心电图 + 节奏曲线 ============
  it('loading 时情绪心电图显示"分析中..."', async () => {
    // chapters 非空但 analyzeStructure 永不 resolve → loading=true
    analyzeStructureMock.mockReturnValue(new Promise(() => {}));
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getAllByText('分析中...').length).toBeGreaterThan(0));
  });

  it('有数据时情绪心电图渲染柱状图', async () => {
    analyzeStructureMock.mockResolvedValue({
      issues: [],
      pacing: [30, 60, 90],
      emotionCurve: [20, 50, 80],
    });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    // title="第1章：情绪值 20"
    await waitFor(() => expect(screen.getByTitle('第1章：情绪值 20')).toBeInTheDocument());
    expect(screen.getByTitle('第3章：情绪值 80')).toBeInTheDocument();
  });

  it('有数据时节奏曲线渲染柱状图', async () => {
    analyzeStructureMock.mockResolvedValue({
      issues: [],
      pacing: [30, 60, 90],
      emotionCurve: [20, 50, 80],
    });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByTitle('第1章：节奏值 30')).toBeInTheDocument());
    expect(screen.getByTitle('第3章：节奏值 90')).toBeInTheDocument();
  });

  it('analysis 为空时显示"暂无数据，编写章节后自动分析"', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [], emotionCurve: [] });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => {
      expect(screen.getAllByText('暂无数据，编写章节后自动分析').length).toBeGreaterThan(0);
    });
  });

  it('空章节时情绪心电图不显示"分析中..."', async () => {
    mockStore({ chapters: [] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节数')).toBeInTheDocument());
    // chapters.length===0 时直接 setLoading(false)，应显示"暂无数据"
    expect(screen.getAllByText('暂无数据，编写章节后自动分析').length).toBeGreaterThan(0);
  });

  // ============ AI 审稿建议 ============
  it('loading 时显示"分析中..."占位', async () => {
    analyzeStructureMock.mockReturnValue(new Promise(() => {}));
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('AI 审稿建议')).toBeInTheDocument());
    // AI 审稿建议区域显示"分析中..."
    expect(screen.getAllByText('分析中...').length).toBeGreaterThan(0);
  });

  it('空 issues 显示"结构完整，节奏良好！"', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [50], emotionCurve: [50] });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('结构完整，节奏良好！')).toBeInTheDocument());
  });

  it('issues 渲染结构/节奏/风格 三类标签 + 章节关联', async () => {
    analyzeStructureMock.mockResolvedValue({
      issues: [
        { type: 'structure', severity: 'error', chapterId: 'c1', description: '结构描述', suggestion: '结构建议' },
        { type: 'pacing', severity: 'warning', chapterId: 'c2', description: '节奏描述', suggestion: '节奏建议' },
        { type: 'style', severity: 'info', description: '风格描述', suggestion: '风格建议' },
      ],
      pacing: [50],
      emotionCurve: [50],
    });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({
      chapters: [
        makeChapter({ id: 'c1', title: '第一章' }),
        makeChapter({ id: 'c2', title: '第二章' }),
      ],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('结构问题')).toBeInTheDocument());
    expect(screen.getByText('节奏问题')).toBeInTheDocument();
    expect(screen.getByText('风格问题')).toBeInTheDocument();
    // 章节关联
    expect(screen.getByText('相关章节：第一章')).toBeInTheDocument();
    expect(screen.getByText('相关章节：第二章')).toBeInTheDocument();
    // 描述与建议
    expect(screen.getByText('结构描述')).toBeInTheDocument();
    expect(screen.getByText('💡 结构建议')).toBeInTheDocument();
    // severity 标签
    expect(screen.getByText('共 3 条')).toBeInTheDocument();
  });

  it('analyzeStructure 抛错时显示 toast.error 并清空 analysis', async () => {
    analyzeStructureMock.mockRejectedValue(new Error('AI 服务不可用'));
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('结构分析失败', 'AI 服务不可用'));
    // analysis 被清空 → 显示"暂无数据"
    await waitFor(() => {
      expect(screen.getAllByText('暂无数据，编写章节后自动分析').length).toBeGreaterThan(0);
    });
  });

  it('analyzeChapter 抛错时 console.warn 不中断整体流程', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [50], emotionCurve: [50] });
    analyzeChapterMock.mockRejectedValue(new Error('单章失败'));
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    // 结构分析仍正常显示
    await waitFor(() => expect(screen.getByText('结构完整，节奏良好！')).toBeInTheDocument());
  });

  // ============ 全书深度审阅 ============
  it('初始状态显示"开始审阅"按钮 + 引导文案', async () => {
    mockStore();
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    expect(screen.getByText(/点击"开始审阅"/)).toBeInTheDocument();
  });

  it('点击"开始审阅"调用 generateFullBookReview + 展示结果', async () => {
    generateFullBookReviewMock.mockResolvedValue({
      issues: [
        { type: 'rhythm', chapterId: 'c1', description: '节奏问题描述', suggestion: '节奏建议', priority: 'high' },
      ],
      summary: '总体评价文本',
    });
    mockStore({
      chapters: [makeChapter({ id: 'c1', title: '第一章' })],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(generateFullBookReviewMock).toHaveBeenCalled());
    // summary + issue 展示
    await waitFor(() => expect(screen.getByText(/总评：/)).toBeInTheDocument());
    expect(screen.getByText('总体评价文本')).toBeInTheDocument();
    // "节奏" 同时出现在 review issue 标签 + 各章数据表头，scope 到 review 卡片
    const reviewCard = screen.getByText('全书深度审阅').closest('.card') as HTMLElement;
    expect(within(reviewCard).getByText('节奏')).toBeInTheDocument();
    expect(within(reviewCard).getByText('节奏问题描述')).toBeInTheDocument();
    expect(within(reviewCard).getByText('💡 节奏建议')).toBeInTheDocument();
  });

  it('审阅完成后按钮文案变为"重新审阅"', async () => {
    generateFullBookReviewMock.mockResolvedValue({ issues: [], summary: '' });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(screen.getByText('重新审阅')).toBeInTheDocument());
  });

  it('审阅 issues 为空时 toast.success', async () => {
    generateFullBookReviewMock.mockResolvedValue({ issues: [], summary: '' });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('全书审阅通过', '未发现明显的节奏/一致性/重复问题'));
  });

  it('审阅 issues 非空时 toast.info', async () => {
    generateFullBookReviewMock.mockResolvedValue({
      issues: [{ type: 'rhythm', description: 'd', suggestion: 's', priority: 'low' }],
      summary: '',
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith('全书审阅完成', '发现 1 条可改进项'));
  });

  it('审阅中按钮 disabled + 显示"审阅中"', async () => {
    let resolveReview: (v: unknown) => void = () => {};
    generateFullBookReviewMock.mockReturnValue(new Promise(r => { resolveReview = r; }));
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(screen.getByText('审阅中')).toBeInTheDocument());
    // disabled 期间再次点击不应触发第二次
    fireEvent.click(screen.getByText('审阅中'));
    expect(generateFullBookReviewMock).toHaveBeenCalledTimes(1);
    resolveReview({ issues: [], summary: '' });
    await waitFor(() => expect(screen.getByText('重新审阅')).toBeInTheDocument());
  });

  it('无章节时点击审阅 toast.info 提示', async () => {
    mockStore({ chapters: [] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    expect(toastMock.info).toHaveBeenCalledWith('暂无章节', '请先在编辑器中创建章节');
    expect(generateFullBookReviewMock).not.toHaveBeenCalled();
  });

  it('审阅抛错时 toast.error', async () => {
    generateFullBookReviewMock.mockRejectedValue(new Error('AI 失败'));
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('全书审阅失败', 'AI 失败'));
  });

  it('审阅无 issues 时显示"✨ 全书节奏与一致性良好"', async () => {
    generateFullBookReviewMock.mockResolvedValue({ issues: [], summary: '良好' });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始审阅')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始审阅'));
    await waitFor(() => expect(screen.getByText('✨ 全书节奏与一致性良好')).toBeInTheDocument());
  });

  // ============ 风格一致性 ============
  it('点击"开始检查"调用 checkStyleConsistency + 展示结果', async () => {
    checkStyleConsistencyMock.mockResolvedValue({
      issues: [
        { type: '视角冲突', severity: 'warning', chapterId: 'c1', description: '视角描述' },
      ],
    });
    mockStore({
      chapters: [makeChapter({ id: 'c1', title: '第一章' })],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始检查')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始检查'));
    await waitFor(() => expect(checkStyleConsistencyMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('视角冲突')).toBeInTheDocument());
    expect(screen.getByText('视角描述')).toBeInTheDocument();
    expect(screen.getByText('章节：第一章')).toBeInTheDocument();
  });

  it('风格检查 issues 为空时显示"✨ 风格一致性良好"', async () => {
    checkStyleConsistencyMock.mockResolvedValue({ issues: [] });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始检查')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始检查'));
    await waitFor(() => expect(screen.getByText('✨ 风格一致性良好')).toBeInTheDocument());
    expect(toastMock.success).toHaveBeenCalledWith('风格一致性良好', '未发现跨章节风格冲突');
  });

  it('无章节时点击风格检查 toast.info 提示', async () => {
    mockStore({ chapters: [] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始检查')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始检查'));
    expect(toastMock.info).toHaveBeenCalledWith('暂无章节', '请先在编辑器中创建章节');
    expect(checkStyleConsistencyMock).not.toHaveBeenCalled();
  });

  it('风格检查抛错时 toast.error', async () => {
    checkStyleConsistencyMock.mockRejectedValue(new Error('风格失败'));
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始检查')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始检查'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('风格一致性检查失败', '风格失败'));
  });

  it('风格检查中按钮显示"检查中"且 disabled', async () => {
    let resolveCheck: (v: unknown) => void = () => {};
    checkStyleConsistencyMock.mockReturnValue(new Promise(r => { resolveCheck = r; }));
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('开始检查')).toBeInTheDocument());
    fireEvent.click(screen.getByText('开始检查'));
    await waitFor(() => expect(screen.getByText('检查中')).toBeInTheDocument());
    fireEvent.click(screen.getByText('检查中'));
    expect(checkStyleConsistencyMock).toHaveBeenCalledTimes(1);
    resolveCheck({ issues: [] });
    await waitFor(() => expect(screen.getByText('重新检查')).toBeInTheDocument());
  });

  // ============ 章节阅读体验 ============
  it('章节按钮渲染前 20 章', async () => {
    const chapters = Array.from({ length: 25 }, (_, i) =>
      makeChapter({ id: `c${i + 1}`, order: i + 1, title: `第${i + 1}章` }),
    );
    mockStore({ chapters });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    // slice(0, 20)，前 20 章 + "…共 25 章"
    // 各章数据表格会渲染全部 25 章，scope 到阅读体验卡片验证按钮区只显示前 20
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    expect(within(readingCard).getAllByText('第1章').length).toBeGreaterThanOrEqual(1);
    expect(within(readingCard).getAllByText('第20章').length).toBeGreaterThanOrEqual(1);
    expect(within(readingCard).queryByText('第21章')).not.toBeInTheDocument();
    expect(screen.getByText(/…共 25 章/)).toBeInTheDocument();
  });

  it('点击章节按钮调用 analyzeChapterForReading + 展示钩子分数', async () => {
    analyzeChapterForReadingMock.mockResolvedValue({
      longSentences: [],
      repeatedWords: [],
      hookScore: 85,
    });
    mockStore({ chapters: [makeChapter({ id: 'c1', title: '第一章' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    // 章节标题同时出现在阅读按钮 + 各章数据表格，scope 到阅读体验卡片
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    fireEvent.click(within(readingCard).getByText('第一章'));
    await waitFor(() => expect(analyzeChapterForReadingMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('钩子分数')).toBeInTheDocument());
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('阅读分析有长句时展示段落预览', async () => {
    analyzeChapterForReadingMock.mockResolvedValue({
      longSentences: [{ paragraphIndex: 2, preview: '这是一段很长很长的句子' }],
      repeatedWords: [],
      hookScore: 50,
    });
    mockStore({ chapters: [makeChapter({ id: 'c1', title: '第一章' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    fireEvent.click(within(readingCard).getByText('第一章'));
    await waitFor(() => expect(screen.getByText(/长句/)).toBeInTheDocument());
    expect(screen.getByText(/第 3 段：/)).toBeInTheDocument();
    expect(screen.getByText(/这是一段很长很长的句子/)).toBeInTheDocument();
  });

  it('阅读分析有重复词时展示词频', async () => {
    analyzeChapterForReadingMock.mockResolvedValue({
      longSentences: [],
      repeatedWords: [{ word: '突然', count: 5 }],
      hookScore: 50,
    });
    mockStore({ chapters: [makeChapter({ id: 'c1', title: '第一章' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    fireEvent.click(within(readingCard).getByText('第一章'));
    await waitFor(() => expect(screen.getByText('高频重复词')).toBeInTheDocument());
    expect(screen.getByText('突然 × 5')).toBeInTheDocument();
  });

  it('阅读分析无长句无重复词时显示"✨ 本章未发现长句与高频重复词"', async () => {
    analyzeChapterForReadingMock.mockResolvedValue({
      longSentences: [],
      repeatedWords: [],
      hookScore: 90,
    });
    mockStore({ chapters: [makeChapter({ id: 'c1', title: '第一章' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    fireEvent.click(within(readingCard).getByText('第一章'));
    await waitFor(() => expect(screen.getByText('✨ 本章未发现长句与高频重复词')).toBeInTheDocument());
  });

  it('阅读分析抛错时 toast.error', async () => {
    analyzeChapterForReadingMock.mockRejectedValue(new Error('阅读分析失败'));
    mockStore({ chapters: [makeChapter({ id: 'c1', title: '第一章' })] });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    fireEvent.click(within(readingCard).getByText('第一章'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('章节阅读分析失败', '阅读分析失败'));
  });

  it('阅读分析中其他章节按钮 disabled', async () => {
    let resolveReading: (v: unknown) => void = () => {};
    analyzeChapterForReadingMock.mockReturnValue(new Promise(r => { resolveReading = r; }));
    mockStore({
      chapters: [
        makeChapter({ id: 'c1', title: '第一章' }),
        makeChapter({ id: 'c2', order: 2, title: '第二章' }),
      ],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('章节阅读体验')).toBeInTheDocument());
    const readingCard = screen.getByText('章节阅读体验').closest('.card') as HTMLElement;
    fireEvent.click(within(readingCard).getByText('第一章'));
    // 第二章按钮在阅读分析期间应 disabled
    await waitFor(() => expect(within(readingCard).getByText('第二章').closest('button')).toBeDisabled());
    resolveReading({ longSentences: [], repeatedWords: [], hookScore: 50 });
    await waitFor(() => expect(within(readingCard).getByText('第二章').closest('button')).not.toBeDisabled());
  });

  // ============ 各章数据表格 ============
  it('各章数据表格渲染章节标题 + 状态标签', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [50], emotionCurve: [50] });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 800, readingTime: 2,
      emotionScore: 60, conflictIntensity: 70, hookStrength: 80, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({
      chapters: [makeChapter({ id: 'c1', title: '开端', status: 'done', wordCount: 800 })],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('各章数据')).toBeInTheDocument());
    // "开端" 同时出现在各章数据表格 + 阅读体验按钮，scope 到表格卡片
    const tableCard = screen.getByText('各章数据').closest('.card') as HTMLElement;
    expect(within(tableCard).getByText('开端')).toBeInTheDocument();
    expect(within(tableCard).getByText('已完成')).toBeInTheDocument(); // CHAPTER_STATUS_LABELS.done
    // 800 字 → "800"
    expect(within(tableCard).getByText('800')).toBeInTheDocument();
    // chapterAnalyses 数据：emotionScore=60
    expect(within(tableCard).getByText('60')).toBeInTheDocument();
  });

  it('点击表格行调用 setCurrentChapter + navigate', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [50], emotionCurve: [50] });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    const { setCurrentChapter } = mockStore({
      chapters: [makeChapter({ id: 'c1', title: '开端' })],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('各章数据')).toBeInTheDocument());
    // 点击各章数据表格中的"开端"行
    const tableCard = screen.getByText('各章数据').closest('.card') as HTMLElement;
    const row = within(tableCard).getByText('开端').closest('tr')!;
    fireEvent.click(row);
    expect(setCurrentChapter).toHaveBeenCalledWith('c1');
    expect(navigateMock).toHaveBeenCalledWith('/project/p-1/editor');
  });

  it('无 chapterAnalyses 数据时表格显示章节原始 wordCount + "-"', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [50], emotionCurve: [50] });
    // analyzeChapter 永不 resolve，chapterAnalyses 保持空
    analyzeChapterMock.mockReturnValue(new Promise(() => {}));
    mockStore({
      chapters: [makeChapter({ id: 'c1', title: '开端', wordCount: 1234 })],
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText('各章数据')).toBeInTheDocument());
    const tableCard = screen.getByText('各章数据').closest('.card') as HTMLElement;
    expect(within(tableCard).getByText('1,234')).toBeInTheDocument(); // 章节原始字数
    // 数据为空时显示 "-"
    expect(within(tableCard).getAllByText('-').length).toBeGreaterThan(0);
  });

  // ============ AI 率检测 ============
  it('渲染 2 个 AITracePanel（chapter + book）', async () => {
    mockStore();
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByTestId('mock-ai-trace-chapter')).toBeInTheDocument());
    expect(screen.getByTestId('mock-ai-trace-book')).toBeInTheDocument();
  });

  // ============ 防抖 + 哈希缓存 ============
  it('章节内容未变更时不重复调用 analyzeStructure', async () => {
    analyzeStructureMock.mockResolvedValue({ issues: [], pacing: [50], emotionCurve: [50] });
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1', content: '固定内容' })] });
    const { rerender } = render(<ReviewPage />);
    await waitFor(() => expect(analyzeStructureMock).toHaveBeenCalledTimes(1));
    // chapters 引用变化但内容哈希不变，应跳过分析
    act(() => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'c1', content: '固定内容' })],
      });
    });
    rerender(<ReviewPage />);
    // 等待 debounce 触发
    await new Promise(r => setTimeout(r, 50));
    expect(analyzeStructureMock).toHaveBeenCalledTimes(1);
  });

  it('卸载守卫：组件卸载后不 setState', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveStructure: (v: unknown) => void = () => {};
    analyzeStructureMock.mockReturnValue(new Promise(r => { resolveStructure = r; }));
    analyzeChapterMock.mockResolvedValue({
      chapterId: 'c1', wordCount: 100, readingTime: 1,
      emotionScore: 50, conflictIntensity: 50, hookStrength: 50, pacingScore: 50,
      characters: [], settings: [], foreshadows: [],
    });
    mockStore({ chapters: [makeChapter({ id: 'c1' })] });
    const { unmount } = render(<ReviewPage />);
    await waitFor(() => expect(analyzeStructureMock).toHaveBeenCalled());
    unmount();
    // 卸载后 resolve，不应抛 React 警告
    resolveStructure({ issues: [], pacing: [50], emotionCurve: [50] });
    await new Promise(r => setTimeout(r, 10));
    // 验证卸载后 resolve 未触发 console.error（React setState 警告等）
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
