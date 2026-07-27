/**
 * ExportPage 单元测试
 *
 * 测试范围（聚焦于导出页的 UI 行为与导出流程触发，不重复测 exporters 内部逻辑）：
 *   - 加载中状态 / 项目不存在的 fallback
 *   - 6 种格式选择按钮（markdown / docx / pdf / epub / html / txt）
 *   - 包含目录开关
 *   - 排版风格（小说/文章/剧本）切换
 *   - 6 种平台预设切换
 *   - PDF 选中时显示联网字体提示横幅
 *   - 导出前检查：伏笔未回收 / 草稿章节 / 健康度评分
 *   - 点击"开始导出"触发对应生成器（markdown/txt 走本地 Blob；docx/pdf/epub/html 走动态 import）
 *   - 简介优化 / 应用优化后简介 / 标签推荐 / 敏感词扫描（mock aiService 与 store action）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ExportPage from '@/pages/ExportPage';
import { useAppStore } from '@/store/useAppStore';
import type { Project, Chapter, Foreshadow, SensitiveWordCheckResult, ProjectSettingCard, PlatformTagRecommendation } from '@/types';

// ============ mocks ============
// react-router-dom：提供静态 projectId，避免 MemoryRouter 包装
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: 'p1' }),
  useNavigate: () => navigateMock,
}));

// exporters 模块整体 mock：避免拉入 pdf-lib/docx/jszip 等重型依赖
// 使用 vi.hoisted 让 mock 引用在 vi.mock factory 中可见（factory 会被提升到文件顶部）
const {
  generateHtmlMock,
  generateDocxMock,
  generatePdfMock,
  generateEpubMock,
  aiServiceMock,
  toastMock,
  isElectronMock,
} = vi.hoisted(() => ({
  generateHtmlMock: vi.fn().mockResolvedValue('<html>mock</html>'),
  generateDocxMock: vi.fn().mockResolvedValue(btoa('docx-mock')),
  generatePdfMock: vi.fn().mockResolvedValue({ base64: btoa('pdf-mock'), chineseFontLoaded: true }),
  generateEpubMock: vi.fn().mockResolvedValue(btoa('epub-mock')),
  aiServiceMock: {
    optimizeSynopsis: vi.fn().mockResolvedValue(''),
    recommendPlatformTags: vi.fn().mockResolvedValue(null),
    scanSensitiveWords: vi.fn().mockResolvedValue(null),
  },
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  isElectronMock: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/exporters', () => ({
  generateHtml: generateHtmlMock,
  generateDocx: generateDocxMock,
  generatePdf: generatePdfMock,
  generateEpub: generateEpubMock,
}));

// storage：partial mock，仅覆盖 isElectron（避免拉入真实 storage 实现的副作用）
// isElectronMock 为 vi.fn，测试中可用 mockReturnValue 切换 Electron/非 Electron 场景
vi.mock('@/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    isElectron: isElectronMock,
  };
});

vi.mock('@/utils/aiService', () => ({
  aiService: aiServiceMock,
}));

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

// ============ fixtures ============
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: '测试小说',
    description: '一个用于测试的故事',
    template: 'blank',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    totalWords: 1000,
    config: {
      theme: 'dark',
      fontSize: 16,
      lineHeight: 1.6,
      fontFamily: 'sans',
      showLineNumbers: false,
      showWordCount: true,
      zenMode: false,
      aiSettings: {
        provider: 'mock',
        style: 'balanced',
        descriptionDensity: 50,
        dialogueDensity: 50,
        strictness: 50,
        temperature: 0.7,
        maxTokens: 1000,
        autoCheckConflicts: false,
      },
    },
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '开篇',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'done',
    wordCount: 100,
    content: '<p>正文内容</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    id: 'fs-1',
    projectId: 'p1',
    title: '伏笔一',
    description: '一个未回收的伏笔',
    status: 'planted',
    plantedChapterId: null,
    payoffChapterId: null,
    priority: 'medium',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 0,
    notes: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSettingCard(overrides: Partial<ProjectSettingCard> = {}): ProjectSettingCard {
  return {
    title: '测试项目',
    genreTags: ['玄幻'],
    protagonist: {
      name: '林川',
      personalityKeywords: ['冷静'],
      coreDesire: '守护家族',
    },
    worldview: { powerSystem: '灵气' },
    coreConflict: {},
    emotionalTone: 'hot-blooded',
    romanceType: 'none',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTagRecommendation(overrides: Partial<PlatformTagRecommendation> = {}): PlatformTagRecommendation {
  return {
    tags: ['玄幻', '热血'],
    categories: ['东方玄幻'],
    reason: '基于设定卡与简介推荐',
    ...overrides,
  };
}

function makeSensitiveResult(overrides: Partial<SensitiveWordCheckResult> = {}): SensitiveWordCheckResult {
  return {
    totalHits: 1,
    hits: [
      {
        word: '敏感词',
        chapterId: 'ch-1',
        chapterTitle: '第一章',
        paragraphIndex: 0,
        context: '这里出现了敏感词',
        severity: 'high',
        suggestion: '请替换为其他表述',
      },
    ],
    byParagraph: { 'ch-1:0': 1 },
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  projects: Project[];
  chapters: Chapter[];
  foreshadows: Foreshadow[];
  updateProject: ReturnType<typeof vi.fn>;
  getSettingCard: ReturnType<typeof vi.fn>;
  updateSettingCard: ReturnType<typeof vi.fn>;
  runSensitiveWordCheck: ReturnType<typeof vi.fn>;
  clearSensitiveWordCheck: ReturnType<typeof vi.fn>;
  lastSensitiveWordCheck: SensitiveWordCheckResult | null;
  loadProjects: ReturnType<typeof vi.fn>;
  openProject: ReturnType<typeof vi.fn>;
}> = {}) {
  const updateProject = overrides.updateProject || vi.fn();
  const getSettingCard = overrides.getSettingCard || vi.fn(() => null);
  const updateSettingCard = overrides.updateSettingCard || vi.fn();
  const runSensitiveWordCheck = overrides.runSensitiveWordCheck || vi.fn();
  const clearSensitiveWordCheck = overrides.clearSensitiveWordCheck || vi.fn();
  const loadProjects = overrides.loadProjects || vi.fn().mockResolvedValue(undefined);
  const openProject = overrides.openProject || vi.fn().mockResolvedValue(undefined);

  useAppStore.setState({
    projects: overrides.projects ?? [makeProject()],
    chapters: overrides.chapters ?? [makeChapter()],
    foreshadows: overrides.foreshadows ?? [],
    updateProject,
    getSettingCard,
    updateSettingCard,
    runSensitiveWordCheck,
    clearSensitiveWordCheck,
    lastSensitiveWordCheck: overrides.lastSensitiveWordCheck ?? null,
    loadProjects,
    openProject,
  });

  return { updateProject, getSettingCard, updateSettingCard, runSensitiveWordCheck, clearSensitiveWordCheck, loadProjects, openProject };
}

describe('ExportPage', () => {
  let originalConfirm: typeof window.confirm;
  let originalAlert: typeof window.alert;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalConfirm = window.confirm;
    originalAlert = window.alert;
    window.confirm = vi.fn(() => true) as never;
    window.alert = vi.fn() as never;

    // Blob 下载需要 URL.createObjectURL/revokeObjectURL，jsdom 默认未实现
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock') as never;
    URL.revokeObjectURL = vi.fn() as never;

    navigateMock.mockClear();
    generateHtmlMock.mockClear();
    generateDocxMock.mockClear();
    generatePdfMock.mockClear();
    generateEpubMock.mockClear();
    // 重置默认行为：单个测试可用 mockResolvedValueOnce 覆盖
    generateHtmlMock.mockResolvedValue('<html>mock</html>');
    generateDocxMock.mockResolvedValue(btoa('docx-mock'));
    generatePdfMock.mockResolvedValue({ base64: btoa('pdf-mock'), chineseFontLoaded: true });
    generateEpubMock.mockResolvedValue(btoa('epub-mock'));
    aiServiceMock.optimizeSynopsis.mockResolvedValue('');
    aiServiceMock.recommendPlatformTags.mockResolvedValue(null);
    aiServiceMock.scanSensitiveWords.mockResolvedValue(null);
    aiServiceMock.optimizeSynopsis.mockClear();
    aiServiceMock.recommendPlatformTags.mockClear();
    aiServiceMock.scanSensitiveWords.mockClear();
    toastMock.error.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
    toastMock.info.mockClear();
    isElectronMock.mockReturnValue(false);
    // 默认不弹载入中：loadProjects/openProject 立即 resolve
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    window.alert = originalAlert;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.useRealTimers();
    cleanup();
  });

  // ============ 项目加载 / 不存在 ============
  it('项目存在时渲染页面标题与项目名', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('导出发布')).toBeInTheDocument();
    });
    // 项目标题在 header 与多处展示，使用 getAllByText
    expect(screen.getAllByText('测试小说').length).toBeGreaterThan(0);
  });

  it('项目不存在时渲染"项目不存在或已被删除"提示与"返回首页"按钮', async () => {
    mockStore({ projects: [], loadProjects: vi.fn().mockResolvedValue(undefined), openProject: vi.fn().mockResolvedValue(undefined) });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('项目不存在或已被删除')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('返回首页'));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  // ============ 格式选择 ============
  it('默认选中 markdown 格式，点击 PDF 后切换为 PDF 并显示联网字体提示', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('导出发布')).toBeInTheDocument();
    });
    // PDF 提示初始不显示
    expect(screen.queryByText(/PDF 导出需联网加载中文字体/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('PDF'));
    expect(screen.getByText(/PDF 导出需联网加载中文字体/)).toBeInTheDocument();
  });

  it('点击 HTML / Word / EPUB / 纯文本 切换格式：激活按钮获得 amber 边框', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('导出发布')).toBeInTheDocument();
    });
    // 默认 markdown 激活；点击 HTML 后 HTML 按钮应有 amber 边框
    const htmlBtn = screen.getByText('HTML').closest('button')!;
    expect(htmlBtn.className).not.toContain('border-amber-400/50');
    fireEvent.click(screen.getByText('HTML'));
    expect(htmlBtn.className).toContain('border-amber-400/50');
    // 切到 Word 后 HTML 失活、Word 激活
    const wordBtn = screen.getByText('Word').closest('button')!;
    fireEvent.click(screen.getByText('Word'));
    expect(htmlBtn.className).not.toContain('border-amber-400/50');
    expect(wordBtn.className).toContain('border-amber-400/50');
  });

  // ============ 导出选项 ============
  it('点击"包含目录"开关切换状态：toggle 滑块位移', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('导出选项')).toBeInTheDocument();
    });
    const tocToggle = screen.getByText('包含目录').closest('div.cursor-pointer') as HTMLElement;
    expect(tocToggle).not.toBeNull();
    // 默认 includeToc=true，滑块在右侧（left-5）
    const knob = tocToggle.querySelector('.absolute.top-0\\.5') as HTMLElement;
    expect(knob.className).toContain('left-5');
    // 切换为不包含：滑块左移（left-0.5）
    fireEvent.click(tocToggle);
    expect(knob.className).toContain('left-0.5');
  });

  it('点击排版风格按钮切换 style：激活按钮获得 amber 文字', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('排版风格')).toBeInTheDocument();
    });
    // 默认"小说"激活（text-amber-300）；切到"文章"后文章激活、小说失活
    const novelBtn = screen.getAllByText('小说')[0].closest('button')!;
    const articleBtn = screen.getAllByText('文章')[0].closest('button')!;
    expect(novelBtn.className).toContain('text-amber-300');
    fireEvent.click(screen.getAllByText('文章')[0]);
    expect(articleBtn.className).toContain('text-amber-300');
    expect(novelBtn.className).not.toContain('text-amber-300');
  });

  it('点击平台预设按钮切换 platform：激活按钮获得 amber 边框', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('平台预设')).toBeInTheDocument();
    });
    // 默认"通用"激活；切到"起点"后起点激活
    const generalBtn = screen.getByText('通用').closest('button')!;
    const qidianBtn = screen.getByText('起点').closest('button')!;
    expect(generalBtn.className).toContain('border-amber-400/30');
    fireEvent.click(screen.getByText('起点'));
    expect(qidianBtn.className).toContain('border-amber-400/30');
    expect(generalBtn.className).not.toContain('border-amber-400/30');
  });

  // ============ 导出前检查 ============
  it('有未回收伏笔时显示"有 N 个伏笔尚未回收"提示', async () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'fs-1', status: 'planted' }),
        makeForeshadow({ id: 'fs-2', status: 'progressing' }),
      ],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText(/2 个伏笔尚未回收/)).toBeInTheDocument();
    });
  });

  it('有草稿章节时显示"N 个章节状态为草稿"提示', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'ch-1', status: 'draft' }),
        makeChapter({ id: 'ch-2', status: 'writing' }),
        makeChapter({ id: 'ch-3', status: 'draft' }),
      ],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText(/2 个章节状态为草稿/)).toBeInTheDocument();
    });
  });

  it('伏笔全回收 + 章节全完成时显示"暂无待处理问题"', async () => {
    mockStore({
      foreshadows: [makeForeshadow({ id: 'fs-1', status: 'paid-off' })],
      chapters: [makeChapter({ id: 'ch-1', status: 'done' })],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('暂无待处理问题')).toBeInTheDocument();
    });
  });

  it('健康度评分：伏笔 0% + 章节 0% → "需改进"', async () => {
    mockStore({
      foreshadows: [makeForeshadow({ id: 'fs-1', status: 'planted' })],
      chapters: [makeChapter({ id: 'ch-1', status: 'draft' })],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('需改进')).toBeInTheDocument();
    });
  });

  it('健康度评分：全部完成 → "良好"', async () => {
    mockStore({
      foreshadows: [makeForeshadow({ id: 'fs-1', status: 'paid-off' })],
      chapters: [makeChapter({ id: 'ch-1', status: 'done' })],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('良好')).toBeInTheDocument();
    });
  });

  it('显示"N 个章节结构完整"统计', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'ch-1' }),
        makeChapter({ id: 'ch-2' }),
        makeChapter({ id: 'ch-3' }),
      ],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText(/3 个章节结构完整/)).toBeInTheDocument();
    });
  });

  // ============ 导出按钮触发对应生成器 ============
  it('markdown 格式点击"开始导出"生成 Blob 下载（不调用动态 import 的生成器）', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('开始导出'));
    // markdown 不调用动态 import 的生成器
    await waitFor(() => {
      expect(generateHtmlMock).not.toHaveBeenCalled();
      expect(generateDocxMock).not.toHaveBeenCalled();
      expect(generatePdfMock).not.toHaveBeenCalled();
      expect(generateEpubMock).not.toHaveBeenCalled();
    });
  });

  it('docx 格式点击"开始导出"调用 generateDocx', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(generateDocxMock).toHaveBeenCalledTimes(1);
    });
  });

  it('pdf 格式点击"开始导出"调用 generatePdf', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('PDF'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(generatePdfMock).toHaveBeenCalledTimes(1);
    });
  });

  it('epub 格式点击"开始导出"调用 generateEpub', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('EPUB'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(generateEpubMock).toHaveBeenCalledTimes(1);
    });
  });

  it('html 格式点击"开始导出"调用 generateHtml', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('HTML'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(generateHtmlMock).toHaveBeenCalledTimes(1);
    });
  });

  it('返回按钮 navigate 到 /project/{id}/editor', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('导出发布')).toBeInTheDocument();
    });
    // 头部的返回按钮（包含 ArrowLeft 图标，无文字）—— 用 aria-label 或直接定位 button
    const backBtn = screen.getAllByRole('button').find(b =>
      b.querySelector('svg.lucide-arrow-left')
    ) as HTMLElement;
    expect(backBtn).toBeDefined();
    fireEvent.click(backBtn);
    expect(navigateMock).toHaveBeenCalledWith('/project/p1/editor');
  });

  // ============ 简介优化 ============
  it('点击"按 X 风格优化"按钮调用 aiService.optimizeSynopsis', async () => {
    aiServiceMock.optimizeSynopsis.mockResolvedValueOnce('优化后的简介');
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    // 默认 platform=general → 按钮文字"按 通用 风格优化"
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(aiServiceMock.optimizeSynopsis).toHaveBeenCalledTimes(1);
    });
  });

  it('optimizeSynopsis 抛错时调用 toast.error', async () => {
    aiServiceMock.optimizeSynopsis.mockRejectedValueOnce(new Error('AI 失败'));
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });

  // ============ 导出成功路径 ============
  it('markdown 导出成功后显示"已导出"并 3 秒后重置', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
    // 3 秒后重置
    vi.advanceTimersByTime(3000);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
  });

  it('txt 格式导出成功（Blob 下载）', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('纯文本'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('html 格式导出成功', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('HTML'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
    expect(generateHtmlMock).toHaveBeenCalledTimes(1);
  });

  it('docx 格式导出成功（非 Electron 走 Blob 下载）', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
  });

  it('pdf 格式导出成功', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('PDF'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
  });

  it('epub 格式导出成功', async () => {
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('EPUB'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
  });

  // ============ 导出失败路径 ============
  it('docx 导出抛错时显示"导出失败"消息', async () => {
    generateDocxMock.mockRejectedValueOnce(new Error('生成失败'));
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText(/导出失败：生成失败/)).toBeInTheDocument();
    });
  });

  it('pdf 中文字体加载失败时显示警告', async () => {
    generatePdfMock.mockResolvedValueOnce({ base64: btoa('pdf'), chineseFontLoaded: false });
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('PDF'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText(/中文字体加载失败/)).toBeInTheDocument();
    });
  });

  // ============ 进度回调 ============
  it('onProgress 回调推进进度条（generating 阶段）', async () => {
    // 用 mockImplementation 捕获 onProgress 回调
    let capturedProgress: ((info: { current: number; total: number; stage: 'preparing' | 'generating' | 'packing' | 'saving' }) => void) | null = null;
    generateDocxMock.mockImplementationOnce(async (exportData: { onProgress: NonNullable<typeof capturedProgress> }) => {
      capturedProgress = exportData.onProgress;
      return btoa('docx');
    });
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(capturedProgress).not.toBeNull();
    });
    // 触发 preparing 阶段
    capturedProgress!({ current: 0, total: 10, stage: 'preparing' });
    // 触发 generating 阶段
    capturedProgress!({ current: 5, total: 10, stage: 'generating' });
    // 触发 packing 阶段
    capturedProgress!({ current: 10, total: 10, stage: 'packing' });
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
  });

  // ============ Electron 保存路径 ============
  it('Electron 保存对话框取消时显示"已取消保存"', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue(null);
    const originalSaveFile = window.electronAPI!.dialog!.saveFile;
    window.electronAPI!.dialog!.saveFile = saveFileMock as never;
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已取消保存')).toBeInTheDocument();
    });
    window.electronAPI!.dialog!.saveFile = originalSaveFile as never;
  });

  it('Electron writeBuffer 不可用时显示"导出通道不可用"', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('/path/to/file.docx');
    const originalSaveFile = window.electronAPI!.dialog!.saveFile;
    const originalWriteBuffer = window.electronAPI!.exportFile!.writeBuffer;
    window.electronAPI!.dialog!.saveFile = saveFileMock as never;
    // 删除 writeBuffer 使其不可用
    delete (window.electronAPI!.exportFile as Partial<ElectronExportFileAPI>).writeBuffer;
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText(/导出通道不可用/)).toBeInTheDocument();
    });
    window.electronAPI!.dialog!.saveFile = originalSaveFile as never;
    (window.electronAPI!.exportFile as Partial<ElectronExportFileAPI>).writeBuffer = originalWriteBuffer;
  });

  it('Electron writeBuffer 返回 false 时显示"文件写入被拒绝"', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('/path/to/file.docx');
    const writeBufferMock = vi.fn().mockResolvedValue(false);
    const originalSaveFile = window.electronAPI!.dialog!.saveFile;
    const originalWriteBuffer = window.electronAPI!.exportFile!.writeBuffer;
    window.electronAPI!.dialog!.saveFile = saveFileMock as never;
    window.electronAPI!.exportFile!.writeBuffer = writeBufferMock as never;
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText(/文件写入被拒绝/)).toBeInTheDocument();
    });
    window.electronAPI!.dialog!.saveFile = originalSaveFile as never;
    window.electronAPI!.exportFile!.writeBuffer = originalWriteBuffer as never;
  });

  it('Electron 保存成功时调用 writeBuffer', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('/path/to/file.docx');
    const writeBufferMock = vi.fn().mockResolvedValue(true);
    const originalSaveFile = window.electronAPI!.dialog!.saveFile;
    const originalWriteBuffer = window.electronAPI!.exportFile!.writeBuffer;
    window.electronAPI!.dialog!.saveFile = saveFileMock as never;
    window.electronAPI!.exportFile!.writeBuffer = writeBufferMock as never;
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    await waitFor(() => {
      expect(screen.getByText('已导出')).toBeInTheDocument();
    });
    expect(writeBufferMock).toHaveBeenCalledWith('/path/to/file.docx', btoa('docx-mock'));
    window.electronAPI!.dialog!.saveFile = originalSaveFile as never;
    window.electronAPI!.exportFile!.writeBuffer = originalWriteBuffer as never;
  });

  // ============ 健康度"一般" ============
  it('健康度评分：伏笔 100% + 章节 50% → "一般"（score=75）', async () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'fs-1', status: 'paid-off' }),
        makeForeshadow({ id: 'fs-2', status: 'paid-off' }),
      ],
      chapters: [
        makeChapter({ id: 'ch-1', status: 'done' }),
        makeChapter({ id: 'ch-2', status: 'draft' }),
      ],
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('一般')).toBeInTheDocument();
    });
  });

  // ============ 简介优化：边界场景 ============
  it('优化结果与当前简介相同时调用 toast.info("简介已是最优")', async () => {
    const project = makeProject({ description: '原始简介' });
    aiServiceMock.optimizeSynopsis.mockResolvedValueOnce('原始简介');
    mockStore({ projects: [project] });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith('简介已是最优', '当前简介无需进一步优化');
    });
  });

  it('优化结果为空时调用 toast.info("简介已是最优")', async () => {
    aiServiceMock.optimizeSynopsis.mockResolvedValueOnce('');
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith('简介已是最优', '当前简介无需进一步优化');
    });
  });

  it('点击"采纳并保存"调用 updateProject 写入优化后简介', async () => {
    const project = makeProject({ description: '原始简介' });
    aiServiceMock.optimizeSynopsis.mockResolvedValueOnce('优化后的简介');
    const { updateProject } = mockStore({ projects: [project] });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(screen.getByText('采纳并保存')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('采纳并保存'));
    expect(updateProject).toHaveBeenCalledWith('p1', { description: '优化后的简介' });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('点击"放弃"清空优化后的简介', async () => {
    const project = makeProject({ description: '原始简介' });
    aiServiceMock.optimizeSynopsis.mockResolvedValueOnce('优化后的简介');
    mockStore({ projects: [project] });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(screen.getByText('放弃')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('放弃'));
    // 放弃后"采纳并保存"与"放弃"按钮消失
    expect(screen.queryByText('采纳并保存')).not.toBeInTheDocument();
  });

  it('优化后简介可编辑（textarea onChange）', async () => {
    const project = makeProject({ description: '原始简介' });
    aiServiceMock.optimizeSynopsis.mockResolvedValueOnce('优化后的简介');
    mockStore({ projects: [project] });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('作品简介')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(screen.getByDisplayValue('优化后的简介')).toBeInTheDocument();
    });
    const textarea = screen.getByDisplayValue('优化后的简介');
    fireEvent.change(textarea, { target: { value: '手动编辑后的简介' } });
    expect(screen.getByDisplayValue('手动编辑后的简介')).toBeInTheDocument();
  });

  // ============ 标签推荐 ============
  it('点击"AI 推荐标签"成功后渲染标签与分类', async () => {
    aiServiceMock.recommendPlatformTags.mockResolvedValueOnce(makeTagRecommendation());
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('平台标签与分类')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('AI 推荐标签'));
    await waitFor(() => {
      expect(screen.getByText('玄幻')).toBeInTheDocument();
      expect(screen.getByText('热血')).toBeInTheDocument();
      expect(screen.getByText('东方玄幻')).toBeInTheDocument();
      expect(screen.getByText(/推荐理由：基于设定卡与简介推荐/)).toBeInTheDocument();
    });
  });

  it('recommendPlatformTags 抛错时调用 toast.error', async () => {
    aiServiceMock.recommendPlatformTags.mockRejectedValueOnce(new Error('AI 标签失败'));
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('平台标签与分类')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('AI 推荐标签'));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('标签推荐失败', 'AI 标签失败');
    });
  });

  it('点击"关闭"清空标签推荐结果', async () => {
    aiServiceMock.recommendPlatformTags.mockResolvedValueOnce(makeTagRecommendation());
    mockStore();
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('平台标签与分类')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('AI 推荐标签'));
    await waitFor(() => {
      expect(screen.getByText('合并到设定卡')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('关闭'));
    expect(screen.queryByText('合并到设定卡')).not.toBeInTheDocument();
  });

  it('无设定卡时点击"合并到设定卡"调用 toast.error("请先创建设定卡")', async () => {
    aiServiceMock.recommendPlatformTags.mockResolvedValueOnce(makeTagRecommendation());
    mockStore({ getSettingCard: vi.fn(() => null) });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('平台标签与分类')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('AI 推荐标签'));
    await waitFor(() => {
      expect(screen.getByText('合并到设定卡')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('合并到设定卡'));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('请先创建设定卡', '在右侧"设定卡"标签页中创建后再使用标签推荐');
    });
  });

  it('有设定卡时点击"合并到设定卡"调用 updateSettingCard 合并去重', async () => {
    aiServiceMock.recommendPlatformTags.mockResolvedValueOnce(makeTagRecommendation({
      tags: ['玄幻', '热血', '修仙'],
    }));
    const card = makeSettingCard({ genreTags: ['玄幻', '升级流'] });
    const { updateSettingCard } = mockStore({ getSettingCard: vi.fn(() => card) });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('平台标签与分类')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('AI 推荐标签'));
    await waitFor(() => {
      expect(screen.getByText('合并到设定卡')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('合并到设定卡'));
    expect(updateSettingCard).toHaveBeenCalledWith({ genreTags: ['玄幻', '升级流', '热血', '修仙'] });
    expect(toastMock.success).toHaveBeenCalled();
  });

  // ============ 敏感词扫描 ============
  it('扫描无敏感词时调用 toast.success("未发现敏感词")', async () => {
    const runSensitiveWordCheck = vi.fn().mockReturnValue(makeSensitiveResult({ totalHits: 0, hits: [] }));
    mockStore({ runSensitiveWordCheck });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('扫描全书')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('扫描全书'));
    // handleScanSensitiveWords 用 setTimeout(50) 延迟执行
    vi.advanceTimersByTime(50);
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('未发现敏感词', '全书章节已通过本地词库扫描');
    });
  });

  it('扫描到敏感词时调用 toast.warning', async () => {
    const runSensitiveWordCheck = vi.fn().mockReturnValue(makeSensitiveResult({ totalHits: 3 }));
    mockStore({ runSensitiveWordCheck });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('扫描全书')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('扫描全书'));
    vi.advanceTimersByTime(50);
    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith('发现 3 处敏感词', '请查看下方详情并修改正文');
    });
  });

  it('扫描抛错时调用 toast.error("敏感词扫描失败")', async () => {
    const runSensitiveWordCheck = vi.fn().mockImplementation(() => {
      throw new Error('扫描异常');
    });
    mockStore({ runSensitiveWordCheck });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('扫描全书')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('扫描全书'));
    vi.advanceTimersByTime(50);
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('敏感词扫描失败', '扫描异常');
    });
  });

  it('扫描中按钮显示"扫描中"且 disabled', async () => {
    // runSensitiveWordCheck 不立即返回（通过不推进 timer 保持 scanning 状态）
    const runSensitiveWordCheck = vi.fn().mockReturnValue(makeSensitiveResult({ totalHits: 0, hits: [] }));
    mockStore({ runSensitiveWordCheck });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('扫描全书')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('扫描全书'));
    // 未推进 timer，应处于"扫描中"
    expect(screen.getByText('扫描中')).toBeInTheDocument();
    expect(screen.getByText('扫描中').closest('button')).toBeDisabled();
    // 推进 timer 完成
    vi.advanceTimersByTime(50);
    await waitFor(() => {
      expect(screen.getByText('扫描全书')).toBeInTheDocument();
    });
  });

  // ============ 敏感词结果渲染 ============
  it('敏感词结果有命中时渲染命中详情（含 severity 样式与建议）', async () => {
    const result = makeSensitiveResult({
      totalHits: 2,
      hits: [
        {
          word: '敏感词A',
          chapterId: 'ch-1',
          chapterTitle: '第一章',
          paragraphIndex: 0,
          context: '上下文A',
          severity: 'high',
          suggestion: '建议A',
        },
        {
          word: '敏感词B',
          chapterId: 'ch-2',
          chapterTitle: '第二章',
          paragraphIndex: 1,
          context: '上下文B',
          severity: 'low',
        },
      ],
    });
    mockStore({ lastSensitiveWordCheck: result });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('命中 2 处')).toBeInTheDocument();
    });
    expect(screen.getByText('「敏感词A」')).toBeInTheDocument();
    expect(screen.getByText('「敏感词B」')).toBeInTheDocument();
    expect(screen.getByText(/建议：建议A/)).toBeInTheDocument();
    // 高风险 1 · 中风险 0 · 低风险 1
    expect(screen.getByText(/高风险 1/)).toBeInTheDocument();
    expect(screen.getByText(/低风险 1/)).toBeInTheDocument();
  });

  it('敏感词结果无命中时显示"未发现敏感词"详情', async () => {
    mockStore({ lastSensitiveWordCheck: makeSensitiveResult({ totalHits: 0, hits: [] }) });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('未发现敏感词，全书章节已通过本地词库扫描')).toBeInTheDocument();
    });
  });

  it('点击"清空结果"调用 clearSensitiveWordCheck', async () => {
    const { clearSensitiveWordCheck } = mockStore({
      lastSensitiveWordCheck: makeSensitiveResult({ totalHits: 0, hits: [] }),
    });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('清空结果')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('清空结果'));
    expect(clearSensitiveWordCheck).toHaveBeenCalled();
  });

  // ============ 切换平台清空 optimizedSynopsis ============
  it('切换平台后"按 X 风格优化"按钮文字更新', async () => {
    const project = makeProject({ description: '原始简介' });
    aiServiceMock.optimizeSynopsis.mockResolvedValue('优化后的简介');
    mockStore({ projects: [project] });
    render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText(/按 通用 风格优化/)).toBeInTheDocument();
    });
    // 先优化
    fireEvent.click(screen.getByText(/按 通用 风格优化/));
    await waitFor(() => {
      expect(screen.getByText('采纳并保存')).toBeInTheDocument();
    });
    // 切换到起点 → optimizedSynopsis 被清空，按钮文字更新
    fireEvent.click(screen.getByText('起点'));
    expect(screen.getByText(/按 起点 风格优化/)).toBeInTheDocument();
    // 采纳按钮消失（optimizedSynopsis 被清空）
    expect(screen.queryByText('采纳并保存')).not.toBeInTheDocument();
  });

  // ============ 卸载清理 ============
  it('导出过程中卸载组件不抛错', async () => {
    // 让 generateDocx 永远 pending
    generateDocxMock.mockImplementationOnce(() => new Promise(() => {}));
    mockStore();
    const { unmount } = render(<ExportPage />);
    await waitFor(() => {
      expect(screen.getByText('开始导出')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Word'));
    fireEvent.click(screen.getByText('开始导出'));
    // 卸载不应抛错
    expect(() => unmount()).not.toThrow();
  });

  // ============ 项目加载状态 ============
  it('项目加载中显示"加载中..."', async () => {
    // loadProjects 永远 pending → projectLoading 保持 true
    const loadProjects = vi.fn(() => new Promise(() => {}));
    mockStore({ projects: [], loadProjects });
    render(<ExportPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });
});
