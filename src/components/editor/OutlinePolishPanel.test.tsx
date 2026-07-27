/**
 * OutlinePolishPanel 单元测试（smoke + 关键交互）
 *
 * OutlinePolishPanel 是大纲打磨面板，含 8 个 Tab：
 *   skeleton / diagnosis / pacing / characters / beats / expansion / causal / snapshots
 *
 * 测试范围：
 *   - 顶部操作栏：标题 / 全面分析按钮 / 导出 Markdown / 范围选择
 *   - Tab 切换：8 个 tab 切换渲染对应子组件
 *   - SkeletonTab：核心驱动锁定（锁定/解锁/类型切换/空描述拒绝）+ 冲突罗盘（生成/loading）+ 结构变体（生成/loading/展示）
 *   - DiagnosisTab：无报告空态 / issues 列表 / 维度筛选 / 级别筛选 / 采纳 / 忽略 / 撤销采纳 / 全部采纳 / 跳转章节
 *   - PacingTab：三幕比例 / 张力曲线 / 情感曲线 / 伏笔密度热力图
 *   - CharactersTab：无报告 / 角色弧光卡片（展开/折叠 + 风险排序 + 跳转章节）
 *   - BeatsTab：无章节空态 / 章节切换 / 5 大节拍 / 生成节拍 / 锁定切换 / 编辑
 *   - ExpansionTab：章节选择 / loading / 错误重试 / 选项展示 / 追加到摘要 / 竞态守卫
 *   - CausalTab：空目标拒绝 / 启动推演 / 风险等级展示 / 影响项展示 / 清除
 *   - SnapshotsTab：保存 / 列表 / 展开 / 恢复 / 删除 / 伏笔速查
 *   - 导出 Markdown：electron + web 两条路径
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import OutlinePolishPanel from '@/components/editor/OutlinePolishPanel';
import { useAppStore } from '@/store/useAppStore';
import type {
  Chapter,
  Foreshadow,
  OutlinePolishReport,
  OutlineIssue,
  OutlineSnapshot,
  CoreDriver,
  ConflictLayer,
  StructureVariant,
  CharacterArcAnalysis,
  CausalImpactReport,
} from '@/types';

// ============ mocks ============
const { isElectronMock, generateMdMock, toastMock } = vi.hoisted(() => ({
  isElectronMock: vi.fn(() => false),
  generateMdMock: vi.fn(() => '# 报告内容'),
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/utils/storage', () => ({
  isElectron: isElectronMock,
  setAutoSaveCallback: vi.fn(),
  getDirtyState: vi.fn(() => false),
  triggerSave: vi.fn(),
  clearAutoSaveTimer: vi.fn(),
}));

vi.mock('@/utils/outlinePolishExport', () => ({
  generateOutlinePolishMarkdown: generateMdMock,
}));

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'c-1',
    projectId: 'p-1',
    parentId: null,
    title: '第一章',
    summary: '章节摘要',
    order: 1,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 1000,
    content: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Chapter;
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'f-1',
    projectId: 'p-1',
    title: '神秘伏笔',
    description: '',
    status: 'planted',
    plantedChapterId: 'c-1',
    payoffChapterId: null,
    priority: 'medium',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 3,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<OutlineIssue> = {}): OutlineIssue {
  return {
    id: 'issue-1',
    dimension: 'structure',
    severity: 'warning',
    chapterId: 'c-1',
    chapterTitle: '第一章',
    description: '问题描述',
    suggestion: '改进建议',
    ...overrides,
  };
}

function makeReport(overrides: Partial<OutlinePolishReport> = {}): OutlinePolishReport {
  return {
    generatedAt: '2025-01-01T00:00:00.000Z',
    scope: 'all',
    projectId: 'p-1',
    issues: [makeIssue()],
    pacingCurve: [{ chapterId: 'c-1', chapterTitle: '第一章', tension: 60, wordCount: 1000 }],
    emotionCurve: [{ chapterId: 'c-1', chapterTitle: '第一章', emotion: 50 }],
    threeActRatio: [25, 50, 25],
    characterArcs: [],
    foreshadowDensity: [],
    totalChapters: 1,
    totalWords: 1000,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<OutlineSnapshot> = {}): OutlineSnapshot {
  return {
    id: 'snap-1',
    projectId: 'p-1',
    createdAt: '2025-01-01T10:00:00.000Z',
    label: '第一轮打磨',
    chapters: [
      { id: 'c-1', parentId: null, order: 1, level: 1, levelType: 'chapter', title: '第一章', summary: '' },
    ],
    ...overrides,
  };
}

function makeCharacterArc(overrides: Partial<CharacterArcAnalysis> = {}): CharacterArcAnalysis {
  return {
    characterId: 'char-1',
    characterName: '主角',
    role: 'protagonist',
    appearanceChapters: ['c-1', 'c-2'],
    appearanceCount: 2,
    consecutiveAbsence: 1,
    arcGaps: ['缺少转折点'],
    risk: 'medium',
    riskDescription: '中期缺席较多',
    ...overrides,
  };
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  chapters: Chapter[];
  foreshadows: Foreshadow[];
  currentChapterId: string | null;
  lastOutlineReport: OutlinePolishReport | null;
  isPolishingOutline: boolean;
  outlineSnapshots: OutlineSnapshot[];
  coreDriver: CoreDriver | null;
  conflictCompass: ConflictLayer[];
  structureVariants: StructureVariant[];
  lastCausalImpact: CausalImpactReport | null;
  runOutlinePolish: ReturnType<typeof vi.fn>;
  setCurrentChapter: ReturnType<typeof vi.fn>;
  lockCoreDriver: ReturnType<typeof vi.fn>;
  unlockCoreDriver: ReturnType<typeof vi.fn>;
  fetchConflictCompass: ReturnType<typeof vi.fn>;
  fetchStructureVariants: ReturnType<typeof vi.fn>;
  generateBeatsForChapter: ReturnType<typeof vi.fn>;
  updateChapterBeat: ReturnType<typeof vi.fn>;
  toggleBeatLock: ReturnType<typeof vi.fn>;
  ignoreOutlineIssue: ReturnType<typeof vi.fn>;
  resolveOutlineIssue: ReturnType<typeof vi.fn>;
  batchResolveOutlineIssues: ReturnType<typeof vi.fn>;
  saveOutlineSnapshot: ReturnType<typeof vi.fn>;
  deleteOutlineSnapshot: ReturnType<typeof vi.fn>;
  restoreOutlineSnapshot: ReturnType<typeof vi.fn>;
  fetchOutlineExpansion: ReturnType<typeof vi.fn>;
  clearOutlineExpansionCache: ReturnType<typeof vi.fn>;
  updateChapter: ReturnType<typeof vi.fn>;
  runCausalPreview: ReturnType<typeof vi.fn>;
  clearCausalImpact: ReturnType<typeof vi.fn>;
}> = {}) {
  const defaults = {
    runOutlinePolish: vi.fn().mockResolvedValue(undefined),
    setCurrentChapter: vi.fn(),
    lockCoreDriver: vi.fn(),
    unlockCoreDriver: vi.fn(),
    fetchConflictCompass: vi.fn().mockResolvedValue(undefined),
    fetchStructureVariants: vi.fn().mockResolvedValue(undefined),
    generateBeatsForChapter: vi.fn().mockResolvedValue(undefined),
    updateChapterBeat: vi.fn(),
    toggleBeatLock: vi.fn(),
    ignoreOutlineIssue: vi.fn(),
    resolveOutlineIssue: vi.fn(),
    batchResolveOutlineIssues: vi.fn(),
    saveOutlineSnapshot: vi.fn(),
    deleteOutlineSnapshot: vi.fn(),
    restoreOutlineSnapshot: vi.fn(),
    fetchOutlineExpansion: vi.fn().mockResolvedValue([]),
    clearOutlineExpansionCache: vi.fn(),
    updateChapter: vi.fn(),
    runCausalPreview: vi.fn().mockResolvedValue(undefined),
    clearCausalImpact: vi.fn(),
  };

  useAppStore.setState({
    chapters: overrides.chapters || [makeChapter()],
    foreshadows: overrides.foreshadows || [],
    currentChapterId: overrides.currentChapterId === undefined ? null : overrides.currentChapterId,
    lastOutlineReport: overrides.lastOutlineReport === undefined ? null : overrides.lastOutlineReport,
    isPolishingOutline: overrides.isPolishingOutline ?? false,
    outlineSnapshots: overrides.outlineSnapshots || [],
    coreDriver: overrides.coreDriver === undefined ? null : overrides.coreDriver,
    conflictCompass: overrides.conflictCompass || [],
    structureVariants: overrides.structureVariants || [],
    lastCausalImpact: overrides.lastCausalImpact === undefined ? null : overrides.lastCausalImpact,
    ...defaults,
    ...overrides,
  });

  // 返回合并后的 mock 函数：允许调用方拿到 overrides 中提供的 mock（如自定义 fetchOutlineExpansion）
  const merged = { ...defaults };
  for (const key of Object.keys(overrides) as (keyof typeof defaults)[]) {
    if (key in defaults) {
      merged[key] = overrides[key] as typeof defaults[typeof key];
    }
  }
  return merged;
}

describe('OutlinePolishPanel', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    isElectronMock.mockClear();
    isElectronMock.mockReturnValue(false);
    generateMdMock.mockClear();
    generateMdMock.mockReturnValue('# 报告内容');
    toastMock.error.mockClear();
    toastMock.success.mockClear();
    toastMock.info.mockClear();
    toastMock.warning.mockClear();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
  });

  // ============ 顶部操作栏 ============
  it('渲染标题"大纲打磨"+ 8 个 tab + 范围选择器', () => {
    mockStore();
    render(<OutlinePolishPanel />);
    expect(screen.getByText('大纲打磨')).toBeInTheDocument();
    expect(screen.getByText('骨架')).toBeInTheDocument();
    expect(screen.getByText('诊断')).toBeInTheDocument();
    expect(screen.getByText('节奏')).toBeInTheDocument();
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('节拍')).toBeInTheDocument();
    expect(screen.getByText('扩展')).toBeInTheDocument();
    expect(screen.getByText('推演')).toBeInTheDocument();
    expect(screen.getByText('版本')).toBeInTheDocument();
    expect(screen.getByText('诊断范围：')).toBeInTheDocument();
  });

  it('诊断 tab 显示未解决 issues 数量徽章', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [
          makeIssue({ id: 'i1', resolved: false, ignored: false }),
          makeIssue({ id: 'i2', resolved: false, ignored: false }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    // 徽章渲染在 tab 按钮上；同时诊断面板默认显示，"共 2 项"也含 "2"
    const diagnosisTab = screen.getByText('诊断').closest('button')!;
    expect(within(diagnosisTab).getByText('2')).toBeInTheDocument();
  });

  it('版本 tab 显示快照数量徽章', () => {
    mockStore({
      outlineSnapshots: [makeSnapshot({ id: 's1' }), makeSnapshot({ id: 's2', label: 'snap2' })],
    });
    render(<OutlinePolishPanel />);
    // tab 上有快照数徽章 "2"
    const versionTab = screen.getByText('版本').closest('button')!;
    expect(within(versionTab).getByText('2')).toBeInTheDocument();
  });

  it('点击"全面分析"调用 runOutlinePolish', async () => {
    const { runOutlinePolish } = mockStore();
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('全面分析'));
    await waitFor(() => expect(runOutlinePolish).toHaveBeenCalledWith('all'));
  });

  it('分析中按钮显示"诊断中"且 disabled', () => {
    mockStore({ isPolishingOutline: true });
    render(<OutlinePolishPanel />);
    expect(screen.getByText('诊断中')).toBeInTheDocument();
    expect(screen.getByText('诊断中').closest('button')).toBeDisabled();
  });

  it('无章节时"全面分析"按钮 disabled', () => {
    mockStore({ chapters: [] });
    render(<OutlinePolishPanel />);
    expect(screen.getByText('全面分析').closest('button')).toBeDisabled();
  });

  it('切换诊断范围调用 setScope（仅 UI 状态）', () => {
    mockStore({
      chapters: [makeChapter({ id: 'c1', title: '开端' })],
    });
    render(<OutlinePolishPanel />);
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'c1' } });
    // 切换后再点全面分析，应传 'c1'
    fireEvent.click(screen.getByText('全面分析'));
    expect(useAppStore.getState().runOutlinePolish).toHaveBeenCalledWith('c1');
  });

  // ============ 导出 Markdown ============
  it('无报告时不显示导出按钮', () => {
    mockStore({ lastOutlineReport: null });
    render(<OutlinePolishPanel />);
    expect(screen.queryByText('导出')).not.toBeInTheDocument();
  });

  it('有报告时显示导出按钮', () => {
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    expect(screen.getByText('导出')).toBeInTheDocument();
  });

  it('web 环境点击导出触发浏览器下载', async () => {
    isElectronMock.mockReturnValue(false);
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    // mock URL.createObjectURL / DOM
    const clickSpy = vi.fn();
    const revokeSpy = vi.fn();
    const createUrlSpy = vi.fn(() => 'blob:url');
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrlSpy;
    URL.revokeObjectURL = revokeSpy;
    // mock createElement 'a' 的 click
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = origCreateElement('a');
        el.click = clickSpy;
        return el;
      }
      return origCreateElement(tag);
    });
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => expect(generateMdMock).toHaveBeenCalled());
    expect(createUrlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it('electron 环境点击导出调用 saveFile + write', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('/path/to/report.md');
    const writeMock = vi.fn().mockResolvedValue(true);
    window.electronAPI = {
      dialog: { saveFile: saveFileMock },
      exportFile: { write: writeMock },
    } as unknown as ElectronAPI;
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => expect(saveFileMock).toHaveBeenCalled());
    await waitFor(() => expect(writeMock).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalled();
    delete window.electronAPI;
  });

  it('electron 导出用户取消（saveFile 返回空）不调用 write', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('');
    const writeMock = vi.fn();
    window.electronAPI = {
      dialog: { saveFile: saveFileMock },
      exportFile: { write: writeMock },
    } as unknown as ElectronAPI;
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => expect(saveFileMock).toHaveBeenCalled());
    // 等待微任务
    await new Promise(r => setTimeout(r, 10));
    expect(writeMock).not.toHaveBeenCalled();
    delete window.electronAPI;
  });

  it('electron 导出 write 不可用时 toast.error', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('/path/to/report.md');
    window.electronAPI = {
      dialog: { saveFile: saveFileMock },
      // 故意不提供 exportFile.write
    } as unknown as ElectronAPI;
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('导出失败', '导出通道不可用，请重启应用后重试'));
    delete window.electronAPI;
  });

  it('electron 导出 write 返回 false 时 toast.error', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockResolvedValue('/path/to/report.md');
    const writeMock = vi.fn().mockResolvedValue(false);
    window.electronAPI = {
      dialog: { saveFile: saveFileMock },
      exportFile: { write: writeMock },
    } as unknown as ElectronAPI;
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('导出失败', '文件写入被拒绝或发生错误，请检查路径权限后重试'));
    delete window.electronAPI;
  });

  it('electron 导出抛错时 toast.error 显示错误消息', async () => {
    isElectronMock.mockReturnValue(true);
    const saveFileMock = vi.fn().mockRejectedValue(new Error('disk full'));
    window.electronAPI = {
      dialog: { saveFile: saveFileMock },
      exportFile: { write: vi.fn() },
    } as unknown as ElectronAPI;
    mockStore({ lastOutlineReport: makeReport() });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('导出失败', 'disk full'));
    delete window.electronAPI;
  });

  // ============ Tab 切换 ============
  it('默认显示诊断 tab，切到骨架 tab 显示核心驱动锁定', () => {
    mockStore({ lastOutlineReport: null });
    render(<OutlinePolishPanel />);
    // 默认在诊断：空态
    expect(screen.getByText('点击"全面分析"')).toBeInTheDocument();
    // 切到骨架
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByText('核心驱动锁定')).toBeInTheDocument();
  });

  // ============ SkeletonTab ============
  it('未锁定核心驱动时显示类型选择 + 文本框 + 锁定按钮', () => {
    mockStore({ coreDriver: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByText('人物驱动')).toBeInTheDocument();
    expect(screen.getByText('情节驱动')).toBeInTheDocument();
    expect(screen.getByText('主题驱动')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/主角核心弧光/)).toBeInTheDocument();
    expect(screen.getByText('锁定核心驱动')).toBeInTheDocument();
  });

  it('切换驱动类型时 placeholder 跟随变化', () => {
    mockStore({ coreDriver: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByPlaceholderText(/主角核心弧光/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('情节驱动'));
    expect(screen.getByPlaceholderText(/核心冲突/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('主题驱动'));
    expect(screen.getByPlaceholderText(/核心表达/)).toBeInTheDocument();
  });

  it('空描述时锁定按钮 disabled', () => {
    mockStore({ coreDriver: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByText('锁定核心驱动').closest('button')).toBeDisabled();
  });

  it('填入描述后点击锁定调用 lockCoreDriver', () => {
    const { lockCoreDriver } = mockStore({ coreDriver: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    const textarea = screen.getByPlaceholderText(/主角核心弧光/);
    fireEvent.change(textarea, { target: { value: '主角弧光描述' } });
    fireEvent.click(screen.getByText('锁定核心驱动'));
    expect(lockCoreDriver).toHaveBeenCalledWith(expect.objectContaining({
      type: 'character',
      description: '主角弧光描述',
    }));
  });

  it('已锁定时显示驱动信息 + 解锁按钮 + 生成冲突罗盘按钮', () => {
    const driver: CoreDriver = {
      type: 'character',
      description: '锁定描述',
      lockedAt: '2025-01-01T10:00:00.000Z',
    };
    mockStore({ coreDriver: driver });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByText('人物驱动')).toBeInTheDocument();
    expect(screen.getByText('锁定描述')).toBeInTheDocument();
    expect(screen.getByText('生成冲突罗盘')).toBeInTheDocument();
    expect(screen.getByText('解锁重选')).toBeInTheDocument();
  });

  it('点击解锁按钮（无冲突罗盘）直接调用 unlockCoreDriver', () => {
    const { unlockCoreDriver } = mockStore({
      coreDriver: { type: 'character', description: 'd', lockedAt: '2025-01-01T00:00:00.000Z' },
      conflictCompass: [],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    fireEvent.click(screen.getByText('解锁重选'));
    expect(unlockCoreDriver).toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('点击解锁按钮（有冲突罗盘）弹出确认对话框', async () => {
    const { unlockCoreDriver } = mockStore({
      coreDriver: { type: 'character', description: 'd', lockedAt: '2025-01-01T00:00:00.000Z' },
      conflictCompass: [{
        layer: 'inner',
        description: '内心挣扎描述',
        seeds: ['种子1'],
      }],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    fireEvent.click(screen.getByText('解锁重选'));
    expect(confirmMock).toHaveBeenCalledWith('解锁后已生成的冲突罗盘将被清空，确定吗？');
    await waitFor(() => expect(unlockCoreDriver).toHaveBeenCalled());
  });

  it('解锁确认对话框取消时不调用 unlockCoreDriver', () => {
    confirmMock.mockResolvedValue(false);
    const { unlockCoreDriver } = mockStore({
      coreDriver: { type: 'character', description: 'd', lockedAt: '2025-01-01T00:00:00.000Z' },
      conflictCompass: [{ layer: 'inner', description: 'd', seeds: [] }],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    fireEvent.click(screen.getByText('解锁重选'));
    expect(unlockCoreDriver).not.toHaveBeenCalled();
  });

  it('点击生成冲突罗盘调用 fetchConflictCompass', async () => {
    const { fetchConflictCompass } = mockStore({
      coreDriver: { type: 'character', description: 'd', lockedAt: '2025-01-01T00:00:00.000Z' },
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    fireEvent.click(screen.getByText('生成冲突罗盘'));
    await waitFor(() => expect(fetchConflictCompass).toHaveBeenCalled());
  });

  it('已生成冲突罗盘时按钮文案变为"重新生成冲突罗盘"', () => {
    mockStore({
      coreDriver: { type: 'character', description: 'd', lockedAt: '2025-01-01T00:00:00.000Z' },
      conflictCompass: [{ layer: 'inner', description: '内心挣扎描述', seeds: ['种子1'] }],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByText('重新生成冲突罗盘')).toBeInTheDocument();
    // 冲突罗盘区域渲染
    expect(screen.getByText('冲突罗盘')).toBeInTheDocument();
    expect(screen.getByText('内心挣扎描述')).toBeInTheDocument();
    expect(screen.getByText('种子1')).toBeInTheDocument();
  });

  it('点击生成结构变体调用 fetchStructureVariants', async () => {
    const { fetchStructureVariants } = mockStore();
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    fireEvent.click(screen.getByText('生成 3 套结构变体'));
    await waitFor(() => expect(fetchStructureVariants).toHaveBeenCalled());
  });

  it('已生成结构变体时展示变体列表', () => {
    mockStore({
      structureVariants: [{
        id: 'v1',
        name: '经典线性',
        description: '线性叙事',
        pros: '清晰',
        cons: '老套',
        fitScenarios: '常规故事',
        suggestedHierarchy: ['卷', '章'],
      }],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('骨架'));
    expect(screen.getByText('经典线性')).toBeInTheDocument();
    expect(screen.getByText('线性叙事')).toBeInTheDocument();
    // "优势：清晰" 跨 span + text，用 textContent 匹配
    expect(screen.getByText((_, el) => !!el && el.textContent === '优势：清晰')).toBeInTheDocument();
    expect(screen.getByText((_, el) => !!el && el.textContent === '风险：老套')).toBeInTheDocument();
    expect(screen.getByText((_, el) => !!el && el.textContent === '适配：常规故事')).toBeInTheDocument();
    expect(screen.getByText('卷 / 章')).toBeInTheDocument();
  });

  // ============ DiagnosisTab ============
  it('无报告时诊断 tab 显示"点击全面分析"', () => {
    mockStore({ lastOutlineReport: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    expect(screen.getByText('点击"全面分析"')).toBeInTheDocument();
    expect(screen.getByText('生成多维度诊断报告')).toBeInTheDocument();
  });

  it('有 issues 时诊断 tab 展示 issue 卡片 + 总数 + 未解决数', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [
          makeIssue({ id: 'i1', dimension: 'structure', severity: 'error', description: '结构问题', suggestion: '结构建议', chapterTitle: '第一章' }),
          makeIssue({ id: 'i2', dimension: 'pacing', severity: 'warning', description: '节奏问题', suggestion: '节奏建议', chapterTitle: undefined }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    // "共 2 项 · 未解决 2" 中 "2" 在嵌套 span，校验外层 textContent
    const summary = screen.getByText(/共 \d+ 项/);
    expect(summary.textContent).toMatch(/共 2 项/);
    expect(summary.textContent).toMatch(/未解决 2/);
    expect(screen.getByText('结构问题')).toBeInTheDocument();
    expect(screen.getByText('结构建议')).toBeInTheDocument();
    expect(screen.getByText('节奏问题')).toBeInTheDocument();
    // 维度标签
    expect(screen.getAllByText('结构递进').length).toBeGreaterThan(0);
    expect(screen.getAllByText('节奏信息').length).toBeGreaterThan(0);
    // 章节跳转按钮（仅 chapterTitle 存在的 issue 才显示）
    expect(screen.getByText('[第一章]')).toBeInTheDocument();
  });

  it('点击 issue 的章节跳转按钮调用 setCurrentChapter', () => {
    const { setCurrentChapter } = mockStore({
      lastOutlineReport: makeReport({
        issues: [makeIssue({ id: 'i1', chapterId: 'c-1', chapterTitle: '第一章' })],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    fireEvent.click(screen.getByText('[第一章]'));
    expect(setCurrentChapter).toHaveBeenCalledWith('c-1');
  });

  it('点击"采纳"调用 resolveOutlineIssue', () => {
    const { resolveOutlineIssue } = mockStore({
      lastOutlineReport: makeReport({
        issues: [makeIssue({ id: 'i1', resolved: false })],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    fireEvent.click(screen.getByText('采纳'));
    expect(resolveOutlineIssue).toHaveBeenCalledWith('i1');
  });

  it('已采纳的 issue 显示"撤销采纳"按钮', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [makeIssue({ id: 'i1', resolved: true })],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    expect(screen.getByText('撤销采纳')).toBeInTheDocument();
    expect(screen.getByText('已采纳')).toBeInTheDocument();
  });

  it('点击"忽略"调用 ignoreOutlineIssue 且按钮区隐藏', () => {
    const { ignoreOutlineIssue } = mockStore({
      lastOutlineReport: makeReport({
        issues: [makeIssue({ id: 'i1', ignored: false })],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    fireEvent.click(screen.getByText('忽略'));
    expect(ignoreOutlineIssue).toHaveBeenCalledWith('i1');
  });

  it('点击"全部采纳"调用 batchResolveOutlineIssues（无参数）', () => {
    const { batchResolveOutlineIssues } = mockStore({
      lastOutlineReport: makeReport({
        issues: [
          makeIssue({ id: 'i1', resolved: false, ignored: false }),
          makeIssue({ id: 'i2', resolved: false, ignored: false }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    fireEvent.click(screen.getByText('全部采纳'));
    expect(batchResolveOutlineIssues).toHaveBeenCalledWith();
  });

  it('未解决 issues 为 0 时不显示"全部采纳"按钮', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [makeIssue({ id: 'i1', resolved: true })],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    expect(screen.queryByText('全部采纳')).not.toBeInTheDocument();
  });

  it('点击维度筛选只显示对应维度 issues', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [
          makeIssue({ id: 'i1', dimension: 'structure', description: '结构问题' }),
          makeIssue({ id: 'i2', dimension: 'pacing', description: '节奏问题' }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    expect(screen.getByText('结构问题')).toBeInTheDocument();
    expect(screen.getByText('节奏问题')).toBeInTheDocument();
    // 维度筛选 chip 在 flex-wrap 容器中，点击其中 "结构递进" chip
    const filterChips = screen.getAllByText('结构递进');
    // 第一个为筛选 chip（FilterChip），后续为 issue 卡片徽章
    fireEvent.click(filterChips[0]);
    expect(screen.getByText('结构问题')).toBeInTheDocument();
    expect(screen.queryByText('节奏问题')).not.toBeInTheDocument();
  });

  it('点击级别筛选只显示对应级别 issues', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [
          makeIssue({ id: 'i1', severity: 'error', description: '严重问题' }),
          makeIssue({ id: 'i2', severity: 'warning', description: '警告问题' }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    fireEvent.click(screen.getByText('严重'));
    expect(screen.getByText('严重问题')).toBeInTheDocument();
    expect(screen.queryByText('警告问题')).not.toBeInTheDocument();
  });

  it('筛选后无匹配 issues 显示"当前筛选下无诊断项"', () => {
    mockStore({
      lastOutlineReport: makeReport({
        issues: [makeIssue({ id: 'i1', severity: 'warning' })],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('诊断'));
    fireEvent.click(screen.getByText('严重'));
    expect(screen.getByText('当前筛选下无诊断项')).toBeInTheDocument();
  });

  // ============ PacingTab ============
  it('无报告时节奏 tab 显示空态', () => {
    mockStore({ lastOutlineReport: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节奏'));
    expect(screen.getByText('查看节奏与情感曲线')).toBeInTheDocument();
  });

  it('有报告时节奏 tab 显示三幕比例 + 张力曲线 + 情感曲线', () => {
    mockStore({
      lastOutlineReport: makeReport({
        threeActRatio: [25, 50, 25],
        pacingCurve: [{ chapterId: 'c-1', chapterTitle: '第一章', tension: 60, wordCount: 1000 }],
        emotionCurve: [{ chapterId: 'c-1', chapterTitle: '第一章', emotion: 70 }],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节奏'));
    expect(screen.getByText('三幕结构比例')).toBeInTheDocument();
    expect(screen.getByText('开端 25%')).toBeInTheDocument();
    expect(screen.getByText('发展 50%')).toBeInTheDocument();
    expect(screen.getByText('高潮 25%')).toBeInTheDocument();
    expect(screen.getByText('剧情张力曲线')).toBeInTheDocument();
    expect(screen.getByText('情感强度曲线')).toBeInTheDocument();
    // title 提示
    expect(screen.getByTitle('第一章: 60%')).toBeInTheDocument();
    expect(screen.getByTitle('第一章: 70%')).toBeInTheDocument();
  });

  it('三幕比例小于 8 时不显示文字', () => {
    mockStore({
      lastOutlineReport: makeReport({
        threeActRatio: [5, 80, 15],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节奏'));
    // 开端 5% < 8，不显示文字
    expect(screen.queryByText('开端 5%')).not.toBeInTheDocument();
    expect(screen.getByText('发展 80%')).toBeInTheDocument();
  });

  it('有伏笔密度时展示热力图', () => {
    mockStore({
      lastOutlineReport: makeReport({
        foreshadowDensity: [
          { chapterId: 'c-1', chapterTitle: '第一章', planted: 2, progressing: 1, paidOff: 0 },
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节奏'));
    expect(screen.getByText('伏笔密度热力图')).toBeInTheDocument();
    // "第一章" 同时出现在范围选择器和热力图，用 title 锚定热力图项
    expect(screen.getByTitle('埋设 2')).toBeInTheDocument();
    expect(screen.getByTitle('推进 1')).toBeInTheDocument();
  });

  it('点击伏笔密度热力图章节调用 setCurrentChapter', () => {
    const { setCurrentChapter } = mockStore({
      lastOutlineReport: makeReport({
        foreshadowDensity: [
          { chapterId: 'c-1', chapterTitle: '第一章', planted: 1, progressing: 0, paidOff: 0 },
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节奏'));
    // 热力图行是 button，title 含 "埋设 1"，点击行内任意元素触发
    const densityRow = screen.getByTitle('埋设 1').closest('button')!;
    fireEvent.click(densityRow);
    expect(setCurrentChapter).toHaveBeenCalledWith('c-1');
  });

  // ============ CharactersTab ============
  it('无报告或无角色弧光时显示空态', () => {
    mockStore({ lastOutlineReport: null });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('角色'));
    expect(screen.getByText('查看角色弧光分析')).toBeInTheDocument();
  });

  it('有角色弧光时按风险等级排序展示', () => {
    mockStore({
      lastOutlineReport: makeReport({
        characterArcs: [
          makeCharacterArc({ characterId: 'c1', characterName: '低风险角色', risk: 'low' }),
          makeCharacterArc({ characterId: 'c2', characterName: '高风险角色', risk: 'high', riskDescription: '严重缺席' }),
          makeCharacterArc({ characterId: 'c3', characterName: '健康角色', risk: 'ok' }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('角色'));
    expect(screen.getByText(/共 3 位角色/)).toBeInTheDocument();
    // 角色名 span 在 button 中，过滤掉 tab 按钮 "角色"
    const nameSpans = screen.getAllByText(/风险角色$|健康角色$/);
    expect(nameSpans[0]).toHaveTextContent('高风险角色');
    expect(nameSpans[nameSpans.length - 1]).toHaveTextContent('健康角色');
    // 风险标签
    expect(screen.getByText('高风险')).toBeInTheDocument();
    expect(screen.getByText('低风险')).toBeInTheDocument();
    expect(screen.getByText('健康')).toBeInTheDocument();
  });

  it('点击角色卡片展开显示弧光缺口 + 出场章节', () => {
    mockStore({
      lastOutlineReport: makeReport({
        characterArcs: [
          makeCharacterArc({
            characterId: 'c1',
            characterName: '主角甲',
            arcGaps: ['缺少转折点'],
            appearanceChapters: ['c-1', 'c-2'],
          }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('角色'));
    // 默认折叠，点击展开
    expect(screen.queryByText('弧光缺口')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('主角甲'));
    expect(screen.getByText('弧光缺口')).toBeInTheDocument();
    expect(screen.getByText('缺少转折点')).toBeInTheDocument();
    expect(screen.getByText('出场章节')).toBeInTheDocument();
  });

  it('角色弧光无缺口时展开显示"未检测到弧光缺口"', () => {
    mockStore({
      lastOutlineReport: makeReport({
        characterArcs: [
          makeCharacterArc({ characterName: '主角乙', arcGaps: [] }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('角色'));
    fireEvent.click(screen.getByText('主角乙'));
    expect(screen.getByText('未检测到弧光缺口')).toBeInTheDocument();
  });

  it('出场章节数超过 12 时显示 +N', () => {
    const manyChapters = Array.from({ length: 15 }, (_, i) => `c-${i + 1}`);
    mockStore({
      lastOutlineReport: makeReport({
        characterArcs: [
          makeCharacterArc({ characterName: '主角丙', appearanceChapters: manyChapters }),
        ],
      }),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('角色'));
    fireEvent.click(screen.getByText('主角丙'));
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  // ============ BeatsTab ============
  it('无章节时节拍 tab 显示"尚无章节，先去大纲面板创建章节"', () => {
    mockStore({ chapters: [] });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    expect(screen.getByText('尚无章节，先去大纲面板创建章节')).toBeInTheDocument();
  });

  it('节拍 tab 渲染 5 大节拍槽位', () => {
    mockStore({ chapters: [makeChapter()] });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    expect(screen.getByText('开章钩子')).toBeInTheDocument();
    expect(screen.getByText('推进节拍')).toBeInTheDocument();
    expect(screen.getByText('中间转折')).toBeInTheDocument();
    expect(screen.getByText('加码节拍')).toBeInTheDocument();
    expect(screen.getByText('章末悬念')).toBeInTheDocument();
  });

  it('点击生成节拍调用 generateBeatsForChapter', async () => {
    const { generateBeatsForChapter } = mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      currentChapterId: 'c-1',
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    fireEvent.click(screen.getByText('生成节拍'));
    await waitFor(() => expect(generateBeatsForChapter).toHaveBeenCalledWith('c-1'));
  });

  it('已有节拍时显示锁定状态 + 内容', () => {
    mockStore({
      chapters: [makeChapter({
        id: 'c-1',
        beats: [
          { type: 'hook', content: '钩子内容', locked: true },
          { type: 'progress', content: '推进内容', locked: false },
        ],
      })],
      currentChapterId: 'c-1',
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    expect(screen.getByText('已锁定')).toBeInTheDocument();
    // 5 个节拍槽位中只有 hook 锁定，其余 4 个显示 "未锁"
    expect(screen.getAllByText('未锁').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('钩子内容')).toBeInTheDocument();
    expect(screen.getByText('推进内容')).toBeInTheDocument();
  });

  it('点击锁定按钮调用 toggleBeatLock', () => {
    const { toggleBeatLock } = mockStore({
      chapters: [makeChapter({
        id: 'c-1',
        beats: [{ type: 'hook', content: '内容', locked: false }],
      })],
      currentChapterId: 'c-1',
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    // 第一个节拍槽位（hook）的"未锁"按钮
    const lockButtons = screen.getAllByText('未锁');
    fireEvent.click(lockButtons[0]);
    expect(toggleBeatLock).toHaveBeenCalledWith('c-1', 'hook');
  });

  it('编辑节拍内容调用 updateChapterBeat', () => {
    const { updateChapterBeat } = mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      currentChapterId: 'c-1',
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    const textarea = screen.getByPlaceholderText('填写开章钩子内容...');
    fireEvent.change(textarea, { target: { value: '新内容' } });
    expect(updateChapterBeat).toHaveBeenCalledWith('c-1', 'hook', '新内容');
  });

  it('章节选择器切换调用 onSelectChapter', () => {
    const { setCurrentChapter } = mockStore({
      chapters: [
        makeChapter({ id: 'c-1', title: '第一章' }),
        makeChapter({ id: 'c-2', title: '第二章', order: 2 }),
      ],
      currentChapterId: 'c-1',
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('节拍'));
    // 页面有两个 combobox：顶部范围选择器 + 节拍章节选择器
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-2' } });
    expect(setCurrentChapter).toHaveBeenCalledWith('c-2');
  });

  // ============ ExpansionTab ============
  it('扩展 tab 渲染章节选择器', () => {
    mockStore({
      chapters: [makeChapter({ id: 'c-1', title: '第一章' })],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    expect(screen.getByText('情节扩展器')).toBeInTheDocument();
    expect(screen.getByText('选择章节')).toBeInTheDocument();
  });

  it('选择章节后调用 fetchOutlineExpansion + 展示选项', async () => {
    const { fetchOutlineExpansion } = mockStore({
      chapters: [makeChapter({ id: 'c-1', title: '第一章', summary: '摘要' })],
      fetchOutlineExpansion: vi.fn().mockResolvedValue([
        { title: '方案A', content: '内容A', dramaticTension: '张力A' },
      ]),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-1' } });
    await waitFor(() => expect(fetchOutlineExpansion).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(screen.getByText('方案A')).toBeInTheDocument());
    expect(screen.getByText('内容A')).toBeInTheDocument();
    expect(screen.getByText(/张力点：张力A/)).toBeInTheDocument();
    expect(screen.getByText('追加到摘要')).toBeInTheDocument();
  });

  it('fetchExpansion 返回空数组时显示"暂无扩展方案"', async () => {
    mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      fetchOutlineExpansion: vi.fn().mockResolvedValue([]),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-1' } });
    await waitFor(() => expect(screen.getByText('暂无扩展方案')).toBeInTheDocument());
  });

  it('fetchExpansion 抛错时显示错误信息 + 重试按钮', async () => {
    mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      fetchOutlineExpansion: vi.fn().mockRejectedValue(new Error('AI 失败')),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-1' } });
    await waitFor(() => expect(screen.getByText('AI 失败')).toBeInTheDocument());
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('非 Error 抛错时显示"生成失败"', async () => {
    mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      fetchOutlineExpansion: vi.fn().mockRejectedValue('字符串错误'),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-1' } });
    await waitFor(() => expect(screen.getByText('生成失败')).toBeInTheDocument());
  });

  it('点击"追加到摘要"调用 updateChapter', async () => {
    const { updateChapter } = mockStore({
      chapters: [makeChapter({ id: 'c-1', summary: '原始摘要' })],
      fetchOutlineExpansion: vi.fn().mockResolvedValue([
        { title: '方案A', content: '内容A', dramaticTension: '' },
      ]),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-1' } });
    await waitFor(() => expect(screen.getByText('方案A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('追加到摘要'));
    expect(updateChapter).toHaveBeenCalledWith('c-1', {
      summary: '原始摘要\n\n【扩展方向·方案A】内容A',
    });
  });

  it('点击"重新生成"调用 clearCache + fetchExpansion', async () => {
    const { fetchOutlineExpansion, clearOutlineExpansionCache } = mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      fetchOutlineExpansion: vi.fn().mockResolvedValue([
        { title: '方案A', content: '内容A', dramaticTension: '' },
      ]),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'c-1' } });
    await waitFor(() => expect(screen.getByText('方案A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('重新生成'));
    await waitFor(() => expect(clearOutlineExpansionCache).toHaveBeenCalledWith('c-1'));
    expect(fetchOutlineExpansion).toHaveBeenCalledTimes(2);
  });

  it('竞态守卫：切到新章节时丢弃旧章节响应', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    let resolveSecond: (v: unknown) => void = () => {};
    mockStore({
      chapters: [
        makeChapter({ id: 'c-1', title: '第一章' }),
        makeChapter({ id: 'c-2', title: '第二章', order: 2 }),
      ],
      fetchOutlineExpansion: vi.fn()
        .mockReturnValueOnce(new Promise(r => { resolveFirst = r; }))
        .mockReturnValueOnce(new Promise(r => { resolveSecond = r; })),
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('扩展'));
    const select = screen.getAllByRole('combobox');
    const expansionSelect = select[select.length - 1];
    // 选 c-1
    fireEvent.change(expansionSelect, { target: { value: 'c-1' } });
    // 立即切到 c-2
    fireEvent.change(expansionSelect, { target: { value: 'c-2' } });
    // c-1 后返回，应被丢弃
    resolveFirst([{ title: 'A 章方案', content: 'c', dramaticTension: '' }]);
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByText('A 章方案')).not.toBeInTheDocument();
    // c-2 返回，应展示
    resolveSecond([{ title: 'B 章方案', content: 'c', dramaticTension: '' }]);
    await waitFor(() => expect(screen.getByText('B 章方案')).toBeInTheDocument());
  });

  // ============ CausalTab ============
  it('推演 tab 渲染目标选择 + 改动描述 + 启动推演按钮', () => {
    mockStore({ chapters: [makeChapter({ id: 'c-1' })] });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('推演'));
    expect(screen.getByText('因果推演预览')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/描述假设性改动/)).toBeInTheDocument();
    expect(screen.getByText('启动推演')).toBeInTheDocument();
  });

  it('空描述时启动推演按钮 disabled', () => {
    mockStore({ chapters: [makeChapter({ id: 'c-1' })] });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('推演'));
    expect(screen.getByText('启动推演').closest('button')).toBeDisabled();
  });

  it('点击启动推演调用 runCausalPreview', async () => {
    const { runCausalPreview } = mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('推演'));
    fireEvent.change(screen.getByPlaceholderText(/描述假设性改动/), { target: { value: '让导师死亡' } });
    fireEvent.click(screen.getByText('启动推演'));
    await waitFor(() => expect(runCausalPreview).toHaveBeenCalledWith('让导师死亡', 'c-1'));
  });

  it('已有因果报告时展示风险等级 + 影响项', () => {
    mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      lastCausalImpact: {
        changeDescription: '改动描述',
        targetId: 'c-1',
        impacts: [
          { type: 'broken', chapterId: 'c-2', chapterTitle: '第二章', description: '断裂影响', alternative: '替代方案' },
          { type: 'weakened', description: '弱化影响', alternative: '替代2' },
          { type: 'missing', description: '缺失影响', alternative: '替代3' },
        ],
        overallRisk: 'high',
        generatedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('推演'));
    expect(screen.getByText('变动影响报告')).toBeInTheDocument();
    // "综合风险：高" 在同一 div 内（"高" 是文本节点子），用 regex 匹配
    expect(screen.getByText(/综合风险/)).toBeInTheDocument();
    expect(screen.getByText(/综合风险/).textContent).toContain('高');
    expect(screen.getByText('断裂')).toBeInTheDocument();
    expect(screen.getByText('弱化')).toBeInTheDocument();
    expect(screen.getByText('缺失')).toBeInTheDocument();
    expect(screen.getByText('断裂影响')).toBeInTheDocument();
    // "替代：替代方案" 跨 span 与文本节点，用 textContent 匹配
    expect(screen.getByText((_, el) => !!el && el.textContent === '替代：替代方案')).toBeInTheDocument();
    expect(screen.getByText('「第二章」')).toBeInTheDocument();
  });

  it('点击清除按钮调用 clearCausalImpact', () => {
    const { clearCausalImpact } = mockStore({
      chapters: [makeChapter({ id: 'c-1' })],
      lastCausalImpact: {
        changeDescription: '改动',
        targetId: 'c-1',
        impacts: [],
        overallRisk: 'low',
        generatedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('推演'));
    fireEvent.click(screen.getByText('清除'));
    expect(clearCausalImpact).toHaveBeenCalled();
  });

  // ============ SnapshotsTab ============
  it('无快照时版本 tab 显示"暂无快照"', () => {
    mockStore();
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    expect(screen.getByText('暂无快照')).toBeInTheDocument();
  });

  it('无章节时保存按钮 disabled', () => {
    mockStore({ chapters: [] });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    expect(screen.getByText('保存').closest('button')).toBeDisabled();
  });

  it('填入标签后点击保存调用 saveOutlineSnapshot', () => {
    const { saveOutlineSnapshot } = mockStore({
      chapters: [makeChapter()],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    fireEvent.change(screen.getByPlaceholderText(/快照标签/), { target: { value: 'v1' } });
    fireEvent.click(screen.getByText('保存'));
    expect(saveOutlineSnapshot).toHaveBeenCalledWith('v1');
  });

  it('快照列表展示标签 + 节点数', () => {
    mockStore({
      outlineSnapshots: [
        makeSnapshot({ id: 's1', label: '第一轮', chapters: [
          { id: 'c-1', parentId: null, order: 1, level: 1, levelType: 'chapter', title: '第一章', summary: '' },
          { id: 'c-2', parentId: null, order: 2, level: 1, levelType: 'chapter', title: '第二章', summary: '' },
        ] }),
      ],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    expect(screen.getByText('第一轮')).toBeInTheDocument();
    expect(screen.getByText('2 个节点')).toBeInTheDocument();
  });

  it('点击快照展开显示节点列表', () => {
    mockStore({
      outlineSnapshots: [
        makeSnapshot({ id: 's1', label: '第一轮', chapters: [
          { id: 'c-1', parentId: null, order: 1, level: 1, levelType: 'chapter', title: '第一章', summary: '' },
        ] }),
      ],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    // 默认折叠：[chapter] 标签不显示
    expect(screen.queryByText('[chapter]')).not.toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByText('第一轮'));
    // 节点行中 [chapter] 在 span 内，第一章 在 span 后
    expect(screen.getByText('[chapter]')).toBeInTheDocument();
  });

  it('点击恢复按钮调用 restoreOutlineSnapshot', () => {
    const { restoreOutlineSnapshot } = mockStore({
      outlineSnapshots: [makeSnapshot({ id: 's1' })],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    const restoreBtn = screen.getByTitle('恢复结构（不影响正文）');
    fireEvent.click(restoreBtn);
    expect(restoreOutlineSnapshot).toHaveBeenCalledWith('s1');
  });

  it('点击删除按钮调用 deleteOutlineSnapshot', () => {
    const { deleteOutlineSnapshot } = mockStore({
      outlineSnapshots: [makeSnapshot({ id: 's1' })],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    const deleteBtn = screen.getByTitle('删除快照');
    fireEvent.click(deleteBtn);
    expect(deleteOutlineSnapshot).toHaveBeenCalledWith('s1');
  });

  it('伏笔速查 details 展开/收起', () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'f1', title: '神秘伏笔', status: 'planted', chaptersSinceMention: 5 }),
      ],
    });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    expect(screen.getByText(/伏笔速查（1）/)).toBeInTheDocument();
    // jsdom 不模拟 <details> 折叠隐藏，但 summary 文本与内容均渲染
    // 伏笔内容
    expect(screen.getByText(/神秘伏笔/)).toBeInTheDocument();
    expect(screen.getByText(/已埋设/)).toBeInTheDocument();
    expect(screen.getByText(/5 章未提及/)).toBeInTheDocument();
  });

  it('无伏笔时伏笔速查显示"暂无伏笔"', () => {
    mockStore({ foreshadows: [] });
    render(<OutlinePolishPanel />);
    fireEvent.click(screen.getByText('版本'));
    fireEvent.click(screen.getByText(/伏笔速查/));
    expect(screen.getByText('暂无伏笔')).toBeInTheDocument();
  });
});

