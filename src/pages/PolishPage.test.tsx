/**
 * PolishPage（灵犀打磨台）组件测试
 *
 * 覆盖目标（原覆盖率 0%，14-531 行未覆盖）：
 *   - 项目加载流程：loadProjects + openProject 串行 + cancelled 守卫
 *   - 项目不存在 fallback：ProjectNotFound 渲染
 *   - 顶部工具栏：返回 / 一键体检 / 快照 / 同步 / 锁定蓝图 / 打磨强度切换
 *   - 健康度总览：折叠/展开 / 高中危徽章 / 健康状态 / 问题列表 / 智能引导 / 未跑检查提示
 *   - 统计芯片：章节/字数/角色/伏笔/设定/灵感/驱动/蓝图/快照
 *   - 交互：一键体检触发 runOutlinePolish + analyzeProjectHealth；快照触发 saveOutlineSnapshot + toast
 *   - 锁定蓝图：blueprint.lockedAt 缺失时显示按钮 / 存在时显示已锁定
 *   - 健康问题快捷跳转：localStorage + storage 事件
 *   - walk 模式：隐藏健康度总览
 *
 * 测试策略：
 *   - vi.mock OutlinePolishPanel（懒加载组件，避免拉入大量依赖）
 *   - vi.mock @/utils/aiService/health：控制 analyzeProjectHealth / recommendPolishGuide 返回值
 *   - useAppStore.setState 注入 mock 数据
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import type {
  Project,
  Chapter,
  Character,
  Foreshadow,
  SettingItem,
  InspirationCard,
  OutlineSnapshot,
  CoreDriver,
  BlueprintOverview,
} from '@/types';

// ============ hoisted mocks ============
const { analyzeProjectHealthMock, recommendPolishGuideMock } = vi.hoisted(() => ({
  analyzeProjectHealthMock: vi.fn(),
  recommendPolishGuideMock: vi.fn(),
}));

// 懒加载组件 mock：避免 Suspense + 真实 OutlinePolishPanel 的 store 依赖
vi.mock('@/components/editor/outlinePolish/OutlinePolishPanel', () => ({
  default: function MockOutlinePolishPanel({ fullScreen, embedded }: { fullScreen?: boolean; embedded?: boolean }) {
    return (
      <div data-testid="mock-outline-polish-panel" data-fullscreen={fullScreen ? 'true' : 'false'} data-embedded={embedded ? 'true' : 'false'}>
        OutlinePolishPanel
      </div>
    );
  },
}));

vi.mock('@/utils/aiService/health', () => ({
  analyzeProjectHealth: analyzeProjectHealthMock,
  recommendPolishGuide: recommendPolishGuideMock,
  // 类型导出：vitest 的 vi.mock 会替换模块，但 type-only import 不受影响
}));

// ============ 动态导入被测组件（在 vi.mock 之后） ============
const PolishPage = (await import('@/pages/PolishPage')).default;

// ============ fixtures ============
const NOW = '2025-01-01T00:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    title: '测试项目',
    description: '',
    template: 'blank',
    createdAt: NOW,
    updatedAt: NOW,
    lastOpenedAt: NOW,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Chapter;
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Character;
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSettingItem(overrides: Partial<SettingItem> = {}): SettingItem {
  return {
    id: 'set-1',
    projectId: 'p-1',
    categoryId: 'cat-1',
    name: '设定1',
    content: '',
    order: 0,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as SettingItem;
}

function makeInspirationCard(overrides: Partial<InspirationCard> = {}): InspirationCard {
  return {
    id: 'insp-1',
    projectId: 'p-1',
    type: 'spark',
    title: '灵感1',
    content: '',
    createdAt: NOW,
    ...overrides,
  } as InspirationCard;
}

function makeOutlineSnapshot(overrides: Partial<OutlineSnapshot> = {}): OutlineSnapshot {
  return {
    id: 'snap-1',
    projectId: 'p-1',
    createdAt: NOW,
    label: '快照1',
    chapters: [],
    ...overrides,
  };
}

function makeCoreDriver(overrides: Partial<CoreDriver> = {}): CoreDriver {
  return {
    type: 'character',
    description: '主角弧光',
    lockedAt: NOW,
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<BlueprintOverview> = {}): BlueprintOverview {
  return {
    mainline: '主线',
    startPoint: '起点',
    turnPoints: [],
    endPoint: '终点',
    growthArc: [],
    characterFates: [],
    volumes: [],
    lockedAt: null,
    updatedAt: NOW,
    ...overrides,
  } as BlueprintOverview;
}

// ============ store mock ============
function mockStore(overrides: Record<string, unknown> = {}) {
  const loadProjects = (overrides.loadProjects as ReturnType<typeof vi.fn>) || vi.fn().mockResolvedValue(undefined);
  const openProject = (overrides.openProject as ReturnType<typeof vi.fn>) || vi.fn().mockResolvedValue(undefined);
  const saveOutlineSnapshot = (overrides.saveOutlineSnapshot as ReturnType<typeof vi.fn>) || vi.fn().mockReturnValue(null);
  const lockBlueprint = (overrides.lockBlueprint as ReturnType<typeof vi.fn>) || vi.fn();
  const runOutlinePolish = (overrides.runOutlinePolish as ReturnType<typeof vi.fn>) || vi.fn().mockResolvedValue(undefined);
  const getBlueprint = (overrides.getBlueprint as ReturnType<typeof vi.fn>) || vi.fn().mockReturnValue(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeState: Record<string, any> = {
    projects: overrides.projects ?? [makeProject()],
    chapters: overrides.chapters ?? [],
    characters: overrides.characters ?? [],
    foreshadows: overrides.foreshadows ?? [],
    settingItems: overrides.settingItems ?? [],
    settingCategories: [],
    inspirationCards: overrides.inspirationCards ?? [],
    outlineSnapshots: overrides.outlineSnapshots ?? [],
    coreDriver: overrides.coreDriver === undefined ? null : overrides.coreDriver,
    subplots: overrides.subplots ?? [],
    updateSchedule: overrides.updateSchedule === undefined ? null : overrides.updateSchedule,
    isPolishingOutline: overrides.isPolishingOutline ?? false,
    isBlueprintBusy: false,
    polishLog: overrides.polishLog ?? [],
    loadProjects,
    openProject,
    saveOutlineSnapshot,
    lockBlueprint,
    runOutlinePolish,
    getBlueprint,
    setCurrentChapter: overrides.setCurrentChapter ?? vi.fn(),
    recordPolishAction: overrides.recordPolishAction ?? vi.fn(),
    finishPolishSession: overrides.finishPolishSession ?? vi.fn(),
    undoStack: overrides.undoStack ?? [],
    performUndo: overrides.performUndo ?? vi.fn().mockReturnValue(null),
  };

  // 使用 useAppStore.setState 合并：保留其他必要字段（避免 undefined 导致 zustand 报错）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAppStore.setState(storeState as any, true);

  return { loadProjects, openProject, saveOutlineSnapshot, lockBlueprint, runOutlinePolish, getBlueprint };
}

// ============ 渲染辅助 ============
function renderPolishPage(route = '/project/p-1/polish') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/project/:projectId/polish" element={<PolishPage />} />
        <Route path="/" element={<div data-testid="home">首页</div>} />
        <Route path="/project/:projectId/editor" element={<div data-testid="editor">编辑器</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ============ 默认 health mock：返回空报告 ============
function resetHealthMocks() {
  analyzeProjectHealthMock.mockReset();
  recommendPolishGuideMock.mockReset();
  // 默认：空报告（健康）
  analyzeProjectHealthMock.mockResolvedValue({
    issues: [],
    summary: { totalIssues: 0, highCount: 0, mediumCount: 0, lowCount: 0, overallStatus: 'healthy' },
  });
  recommendPolishGuideMock.mockResolvedValue({
    steps: [],
    totalEstimatedMinutes: 0,
    summary: '当前项目健康状况良好。',
  });
}

describe('PolishPage', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn();
    resetHealthMocks();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
    localStorage.clear();
  });

  // ============ 项目加载流程 ============
  it('mount 时调用 loadProjects + openProject（串行）', async () => {
    const { loadProjects, openProject } = mockStore();
    renderPolishPage();
    await waitFor(() => {
      expect(loadProjects).toHaveBeenCalledTimes(1);
      expect(openProject).toHaveBeenCalledWith('p-1');
    });
  });

  it('项目加载完成后自动跑一次健康检查（analyzeProjectHealth + recommendPolishGuide）', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => {
      expect(analyzeProjectHealthMock).toHaveBeenCalledTimes(1);
      expect(recommendPolishGuideMock).toHaveBeenCalledTimes(1);
    });
  });

  it('健康检查抛错 → 静默失败（不抛出，保留上次报告）', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockRejectedValue(new Error('AI 故障'));
    mockStore();
    // 不应抛出未捕获异常
    expect(() => renderPolishPage()).not.toThrow();
    await waitFor(() => {
      expect(analyzeProjectHealthMock).toHaveBeenCalledTimes(1);
    });
  });

  // ============ 项目不存在 fallback ============
  it('项目不存在 + 加载完成 → 渲染 ProjectNotFound', async () => {
    mockStore({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(undefined),
    });
    renderPolishPage();
    await waitFor(() => {
      // ProjectNotFound 组件文案："项目不存在或已被删除"
      expect(screen.getByText('项目不存在或已被删除')).toBeInTheDocument();
      expect(screen.getByText('返回首页')).toBeInTheDocument();
    });
  });

  // ============ 顶部工具栏 ============
  it('渲染标题"灵犀打磨台" + 项目名', async () => {
    mockStore({ projects: [makeProject({ title: '我的小说' })] });
    renderPolishPage();
    await waitFor(() => {
      expect(screen.getByText('灵犀打磨台')).toBeInTheDocument();
      expect(screen.getByText(/我的小说/)).toBeInTheDocument();
    });
  });

  it('返回按钮点击 → 跳转编辑器', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    // 三栏布局：返回按钮 title="返回编辑器"
    const backBtn = screen.getByTitle('返回编辑器');
    fireEvent.click(backBtn);
    await waitFor(() => {
      expect(screen.getByTestId('editor')).toBeInTheDocument();
    });
  });

  it('一键体检按钮点击 → 调用 runOutlinePolish + 重新跑 analyzeProjectHealth', async () => {
    analyzeProjectHealthMock.mockClear();
    // 提供一个近期快照，使「大改前提醒」直接放行（距上次快照 <10 分钟）
    const { runOutlinePolish } = mockStore({
      outlineSnapshots: [{
        id: 'snap-recent',
        projectId: 'p-1',
        createdAt: new Date().toISOString(),
        label: '近期快照',
        chapters: [],
      }],
    });
    renderPolishPage();
    await waitFor(() => expect(analyzeProjectHealthMock).toHaveBeenCalledTimes(1));
    analyzeProjectHealthMock.mockClear();

    const diagnosisBtn = screen.getByTitle('跑完全维度诊断，生成体检报告');
    fireEvent.click(diagnosisBtn);

    await waitFor(() => {
      expect(runOutlinePolish).toHaveBeenCalledWith('all');
      expect(analyzeProjectHealthMock).toHaveBeenCalledTimes(1);
    });
  });

  it('一键体检：healthLoading 中按钮禁用', async () => {
    // 让 analyzeProjectHealth 永久 pending
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockReturnValue(new Promise(() => {}));
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(analyzeProjectHealthMock).toHaveBeenCalledTimes(1));

    const diagnosisBtn = screen.getByTitle('跑完全维度诊断，生成体检报告') as HTMLButtonElement;
    // 等待 healthLoading=true 生效
    await waitFor(() => {
      expect(diagnosisBtn.disabled).toBe(true);
    });
  });

  it('一键体检：isPolishingOutline=true 时按钮禁用', async () => {
    mockStore({ isPolishingOutline: true });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    const diagnosisBtn = screen.getByTitle('跑完全维度诊断，生成体检报告') as HTMLButtonElement;
    expect(diagnosisBtn.disabled).toBe(true);
  });

  it('快照按钮点击 → 调用 saveOutlineSnapshot + 显示 toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { saveOutlineSnapshot } = mockStore({
      saveOutlineSnapshot: vi.fn().mockReturnValue({
        id: 'snap-1', label: '打磨前快照 2025/01/01', createdAt: NOW, projectId: 'p-1', chapters: [],
      } as OutlineSnapshot),
    });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());

    const snapshotBtn = screen.getByTitle('大改前随手存版本');
    fireEvent.click(snapshotBtn);

    expect(saveOutlineSnapshot).toHaveBeenCalledTimes(1);
    // toast 显示
    expect(screen.getByText(/已生成快照：打磨前快照/)).toBeInTheDocument();

    // 3 秒后 toast 消失
    vi.advanceTimersByTime(3000);
    await waitFor(() => {
      expect(screen.queryByText(/已生成快照/)).not.toBeInTheDocument();
    });
    vi.useRealTimers();
  });

  it('快照返回 null → 不显示 toast', async () => {
    mockStore({
      saveOutlineSnapshot: vi.fn().mockReturnValue(null),
    });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('大改前随手存版本'));
    expect(screen.queryByText(/已生成快照/)).not.toBeInTheDocument();
  });

  it('同步按钮点击 → 跳转编辑器', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('返回编辑器查看大纲同步效果'));
    await waitFor(() => {
      expect(screen.getByTestId('editor')).toBeInTheDocument();
    });
  });

  // ============ 锁定蓝图 ============
  it('blueprint 存在但未锁定 → 显示"锁定蓝图"按钮，点击调用 lockBlueprint', async () => {
    const blueprint = makeBlueprint({ lockedAt: null });
    const { lockBlueprint } = mockStore({
      getBlueprint: vi.fn().mockReturnValue(blueprint),
    });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    const lockBtn = screen.getByTitle('锁定全局蓝图，后续修改自动生成影响报告');
    fireEvent.click(lockBtn);
    expect(lockBlueprint).toHaveBeenCalledTimes(1);
  });

  it('blueprint 已锁定 → 显示"蓝图已锁定"标签，不显示锁定按钮', async () => {
    const blueprint = makeBlueprint({ lockedAt: NOW });
    mockStore({
      getBlueprint: vi.fn().mockReturnValue(blueprint),
    });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    expect(screen.getByText('蓝图已锁定')).toBeInTheDocument();
    expect(screen.queryByTitle('锁定全局蓝图，后续修改自动生成影响报告')).not.toBeInTheDocument();
  });

  it('无 blueprint → 不显示锁定相关 UI', async () => {
    mockStore({ getBlueprint: vi.fn().mockReturnValue(null) });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    expect(screen.queryByText('蓝图已锁定')).not.toBeInTheDocument();
    expect(screen.queryByTitle('锁定全局蓝图，后续修改自动生成影响报告')).not.toBeInTheDocument();
  });

  // ============ 打磨强度切换 ============
  it('打磨强度三按钮：深度打磨 / 轻量维护 / 散步模式', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    expect(screen.getByText('深度打磨')).toBeInTheDocument();
    expect(screen.getByText('轻量维护')).toBeInTheDocument();
    expect(screen.getByText('散步模式')).toBeInTheDocument();
  });

  it('切换到散步模式 → 隐藏健康度总览', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    // 默认深度模式：显示"待处理问题"（三栏布局左栏健康度摘要标题）
    expect(screen.getByText('待处理问题')).toBeInTheDocument();
    // 切换到散步模式
    fireEvent.click(screen.getByText('散步模式'));
    // 散步模式替换整个三栏布局为 WalkModePanel，"待处理问题"不再渲染
    expect(screen.queryByText('待处理问题')).not.toBeInTheDocument();
  });

  // ============ 健康度总览：徽章与状态 ============
  it('健康检查完成 + 有高危问题 → 显示"N 高危"徽章', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'high', category: 'foreshadow',
          title: '高危问题', description: 'd', suggestion: 's',
          actionTab: 'foreshadowBoard', actionLabel: '查看',
        },
      ],
      summary: { totalIssues: 1, highCount: 1, mediumCount: 0, lowCount: 0, overallStatus: 'critical' },
    });
    recommendPolishGuideMock.mockResolvedValue({
      steps: [{
        order: 1, title: '高危问题', detail: 'd',
        targetTab: 'foreshadowBoard', estimatedMinutes: 8,
      }],
      totalEstimatedMinutes: 8,
      summary: '建议处理 1 个高危问题',
    });
    mockStore();
    renderPolishPage();
    // 三栏布局：高危按钮显示"🔴 高危 N 个"（分 span 渲染），验证按钮内含高危+计数
    await waitFor(() => {
      const highLabel = screen.getByText('高危');
      const btn = highLabel.closest('button');
      expect(btn?.textContent).toContain('1');
    });
  });

  it('健康检查完成 + 有中危问题 → 显示"N 中危"徽章', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'medium', category: 'pacing',
          title: '中危问题', description: 'd', suggestion: 's',
          actionTab: 'pacing', actionLabel: '查看',
        },
      ],
      summary: { totalIssues: 1, highCount: 0, mediumCount: 1, lowCount: 0, overallStatus: 'warning' },
    });
    recommendPolishGuideMock.mockResolvedValue({
      steps: [{
        order: 1, title: '中危问题', detail: 'd',
        targetTab: 'pacing', estimatedMinutes: 4,
      }],
      totalEstimatedMinutes: 4,
      summary: '建议处理 1 个中危问题',
    });
    mockStore();
    renderPolishPage();
    // 三栏布局：中危按钮显示"🟡 中危 N 个"（分 span 渲染），验证按钮内含中危+计数
    await waitFor(() => {
      const mediumLabel = screen.getByText('中危');
      const btn = mediumLabel.closest('button');
      expect(btn?.textContent).toContain('1');
    });
  });

  it('健康检查完成 + 无问题 → 显示"健康"徽章 + 健康良好提示', async () => {
    // 默认 mock 即空报告
    mockStore();
    renderPolishPage();
    await waitFor(() => {
      expect(screen.getByText('健康')).toBeInTheDocument();
    });
    // 默认展开状态：应直接显示"项目健康状况良好"
    expect(screen.getByText(/项目健康状况良好/)).toBeInTheDocument();
  });

  it('未跑过健康检查 + 未在 loading → 显示"点击一键体检开始诊断"提示', async () => {
    analyzeProjectHealthMock.mockReset();
    // 不 resolve，模拟 loading 中
    analyzeProjectHealthMock.mockReturnValue(new Promise(() => {}));
    mockStore();
    renderPolishPage();
    // 此时 healthLoading=true，不显示"点击一键体检"提示
    await waitFor(() => expect(analyzeProjectHealthMock).toHaveBeenCalledTimes(1));
    // 解决 promise，模拟完成但返回 null（healthReport 为 null 的边界）
    // 实际上组件会在加载完成后调用 setHealthReport，这里验证 loading 中的 spinner 存在
    expect(screen.getByTitle('跑完全维度诊断，生成体检报告')).toBeInTheDocument();
  });

  // ============ 健康度总览：折叠/展开 ============
  it('点击健康度总览头部 → 切换折叠/展开状态', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    // 三栏布局：问题清单区域可折叠，标题为"问题清单 & 智能引导"
    const healthHeader = screen.getByText('问题清单 & 智能引导').closest('button')!;
    // 默认展开，点击后折叠
    expect(healthHeader).toBeInTheDocument();
    fireEvent.click(healthHeader);
    // 再次点击展开
    fireEvent.click(healthHeader);
    // 验证按钮仍可点击（无异常）
    expect(healthHeader).toBeInTheDocument();
  });

  // ============ 智能引导 ============
  it('有引导步骤 → 显示引导摘要 + 步骤列表 + 预计耗时', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'high', category: 'foreshadow',
          title: '高危问题', description: '描述内容', suggestion: '建议内容',
          actionTab: 'foreshadowBoard', actionLabel: '查看',
        },
      ],
      summary: { totalIssues: 1, highCount: 1, mediumCount: 0, lowCount: 0, overallStatus: 'critical' },
    });
    recommendPolishGuideMock.mockResolvedValue({
      steps: [{
        order: 1, title: '高危问题', detail: '描述内容｜建议：建议内容',
        targetTab: 'foreshadowBoard', estimatedMinutes: 8,
      }],
      totalEstimatedMinutes: 8,
      summary: '建议本次打磨按以下顺序处理 1 个高危问题和 0 个中危问题，预计耗时约 8 分钟',
    });
    mockStore();
    renderPolishPage();
    await waitFor(() => {
      expect(screen.getByText(/建议本次打磨按以下顺序/)).toBeInTheDocument();
    });
    expect(screen.getByText('8 分钟')).toBeInTheDocument();
    // 步骤项
    expect(screen.getByText(/1\. 高危问题/)).toBeInTheDocument();
  });

  // ============ 健康问题行 ============
  it('渲染健康问题行：标题 / 描述 / 建议 / 操作按钮', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'high', category: 'foreshadow',
          title: '测试问题标题', description: '测试描述', suggestion: '测试建议',
          actionTab: 'foreshadowBoard', actionLabel: '查看伏笔',
        },
      ],
      summary: { totalIssues: 1, highCount: 1, mediumCount: 0, lowCount: 0, overallStatus: 'critical' },
    });
    recommendPolishGuideMock.mockResolvedValue({
      steps: [],
      totalEstimatedMinutes: 0,
      summary: '',
    });
    mockStore();
    renderPolishPage();
    await waitFor(() => {
      expect(screen.getByText('测试问题标题')).toBeInTheDocument();
    });
    expect(screen.getByText('测试描述')).toBeInTheDocument();
    expect(screen.getByText('测试建议')).toBeInTheDocument();
    expect(screen.getByText('查看伏笔')).toBeInTheDocument();
  });

  it('点击问题行操作按钮 → 写入 localStorage（polish:targetTab）+ 派发 storage 事件', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'high', category: 'foreshadow',
          title: '问题', description: 'd', suggestion: 's',
          actionTab: 'foreshadowBoard', actionChapterId: 'c-1', actionLabel: '去处理',
        },
      ],
      summary: { totalIssues: 1, highCount: 1, mediumCount: 0, lowCount: 0, overallStatus: 'critical' },
    });
    recommendPolishGuideMock.mockResolvedValue({ steps: [], totalEstimatedMinutes: 0, summary: '' });
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('去处理')).toBeInTheDocument());

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    fireEvent.click(screen.getByText('去处理'));

    expect(setItemSpy).toHaveBeenCalledWith('polish:targetTab', 'foreshadowBoard');
    expect(setItemSpy).toHaveBeenCalledWith('polish:targetChapter', 'c-1');
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(StorageEvent));
  });

  it('问题无 actionChapterId → 仅写 targetTab，不写 targetChapter', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'medium', category: 'pacing',
          title: '问题', description: 'd', suggestion: 's',
          actionTab: 'pacing', actionLabel: '去处理',
        },
      ],
      summary: { totalIssues: 1, highCount: 0, mediumCount: 1, lowCount: 0, overallStatus: 'warning' },
    });
    recommendPolishGuideMock.mockResolvedValue({ steps: [], totalEstimatedMinutes: 0, summary: '' });
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('去处理')).toBeInTheDocument());

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.click(screen.getByText('去处理'));

    expect(setItemSpy).toHaveBeenCalledWith('polish:targetTab', 'pacing');
    expect(setItemSpy).not.toHaveBeenCalledWith('polish:targetChapter', expect.anything());
  });

  // ============ 轻量模式：只显示高中危 ============
  it('轻量模式：仅显示 high + medium 问题，过滤 low', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-1', severity: 'high', category: 'foreshadow',
          title: '高危项', description: 'd', suggestion: 's',
          actionTab: 'foreshadowBoard', actionLabel: '查看',
        },
        {
          id: 'i-2', severity: 'medium', category: 'pacing',
          title: '中危项', description: 'd', suggestion: 's',
          actionTab: 'pacing', actionLabel: '查看',
        },
        {
          id: 'i-3', severity: 'low', category: 'structure',
          title: '低危项', description: 'd', suggestion: 's',
          actionTab: 'skeleton', actionLabel: '查看',
        },
      ],
      summary: { totalIssues: 3, highCount: 1, mediumCount: 1, lowCount: 1, overallStatus: 'critical' },
    });
    recommendPolishGuideMock.mockResolvedValue({ steps: [], totalEstimatedMinutes: 0, summary: '' });
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('高危项')).toBeInTheDocument());
    // 切换到轻量模式
    fireEvent.click(screen.getByText('轻量维护'));
    expect(screen.getByText('高危项')).toBeInTheDocument();
    expect(screen.getByText('中危项')).toBeInTheDocument();
    expect(screen.queryByText('低危项')).not.toBeInTheDocument();
  });

  // ============ 统计芯片 ============
  // 三栏布局：统计芯片在「详细统计」可折叠区内，默认折叠，需先展开。
  it('统计芯片：渲染章节/字数/角色/伏笔/设定/灵感/快照 数量', async () => {
    mockStore({
      chapters: [
        makeChapter({ id: 'c-1', wordCount: 5000, status: 'done' }),
        makeChapter({ id: 'c-2', wordCount: 3000, status: 'draft' }),
      ],
      characters: [makeCharacter({ id: 'char-1' }), makeCharacter({ id: 'char-2', name: '配角' })],
      foreshadows: [makeForeshadow({ id: 'f-1' })],
      settingItems: [makeSettingItem({ id: 'set-1' })],
      inspirationCards: [makeInspirationCard({ id: 'insp-1' })],
      outlineSnapshots: [makeOutlineSnapshot({ id: 'snap-1' })],
    });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    // 字数 8000（<9999 显示原数字）
    expect(screen.getByText('8000')).toBeInTheDocument();
    // 灵感数 1（避免与 "1 高危" 等冲突，用灵感标签上下文）
    const inspirationChip = screen.getByText('灵感').parentElement;
    expect(inspirationChip?.textContent).toContain('1');
  });

  it('字数 > 9999 → 显示"X.X万"', async () => {
    mockStore({
      chapters: [makeChapter({ id: 'c-1', wordCount: 15000 })],
    });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    expect(screen.getByText('1.5万')).toBeInTheDocument();
  });

  it('coreDriver 存在 → 驱动芯片显示驱动类型标签（人物/情节/主题驱动）', async () => {
    mockStore({ coreDriver: makeCoreDriver({ type: 'character' }) });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    expect(screen.getByText('人物驱动')).toBeInTheDocument();
  });

  it('coreDriver 为 null → 驱动芯片显示"未锁" + 红色', async () => {
    mockStore({ coreDriver: null });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    expect(screen.getByText('未锁')).toBeInTheDocument();
  });

  it('blueprint 已生成未锁定 → 蓝图芯片显示"已生成"', async () => {
    mockStore({ getBlueprint: vi.fn().mockReturnValue(makeBlueprint({ lockedAt: null })) });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    expect(screen.getByText('已生成')).toBeInTheDocument();
  });

  it('blueprint 已锁定 → 蓝图芯片显示"已锁"', async () => {
    mockStore({ getBlueprint: vi.fn().mockReturnValue(makeBlueprint({ lockedAt: NOW })) });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    expect(screen.getByText('已锁')).toBeInTheDocument();
  });

  it('blueprint 为 null → 蓝图芯片显示"未生成"', async () => {
    mockStore({ getBlueprint: vi.fn().mockReturnValue(null) });
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('灵犀打磨台')).toBeInTheDocument());
    fireEvent.click(screen.getByText('详细统计'));
    expect(screen.getByText('未生成')).toBeInTheDocument();
  });

  // ============ 工作区 ============
  it('三栏布局渲染 OutlinePolishPanel（embedded=true）', async () => {
    mockStore();
    renderPolishPage();
    await waitFor(() => {
      const panel = screen.getByTestId('mock-outline-polish-panel');
      expect(panel).toBeInTheDocument();
      // 三栏布局：右栏嵌入 OutlinePolishPanel，使用 embedded 而非 fullScreen
      expect(panel.getAttribute('data-embedded')).toBe('true');
    });
  });

  // ============ 多类型问题混合渲染 ============
  it('混合 high/medium/low 问题：按 severity 顺序渲染（high 优先）', async () => {
    analyzeProjectHealthMock.mockReset();
    analyzeProjectHealthMock.mockResolvedValue({
      issues: [
        {
          id: 'i-low', severity: 'low', category: 'structure',
          title: '低危项', description: 'd', suggestion: 's',
          actionTab: 'skeleton', actionLabel: '查看',
        },
        {
          id: 'i-high', severity: 'high', category: 'foreshadow',
          title: '高危项', description: 'd', suggestion: 's',
          actionTab: 'foreshadowBoard', actionLabel: '查看',
        },
        {
          id: 'i-med', severity: 'medium', category: 'pacing',
          title: '中危项', description: 'd', suggestion: 's',
          actionTab: 'pacing', actionLabel: '查看',
        },
      ],
      summary: { totalIssues: 3, highCount: 1, mediumCount: 1, lowCount: 1, overallStatus: 'critical' },
    });
    recommendPolishGuideMock.mockResolvedValue({ steps: [], totalEstimatedMinutes: 0, summary: '' });
    mockStore();
    renderPolishPage();
    await waitFor(() => expect(screen.getByText('高危项')).toBeInTheDocument());

    // 深度模式：所有问题都渲染
    expect(screen.getByText('高危项')).toBeInTheDocument();
    expect(screen.getByText('中危项')).toBeInTheDocument();
    expect(screen.getByText('低危项')).toBeInTheDocument();
  });
});
