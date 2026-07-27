/**
 * axe-core 单元层 a11y 扫描
 *
 * 在 vitest（jsdom）中对关键组件跑 WCAG 2.1 AA 扫描。
 * 覆盖：BaseModal、SettingsModal、ImportModal、OutlineImportModal、SearchModal、AIPanel。
 * 与 E2E 层 @axe-core/playwright 互补：单元层快、定位到组件；E2E 层真实浏览器整页扫描。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ============ vi.mock（hoisted 到文件顶部） ============
// react-router-dom：ImportModal / OutlineImportModal 使用 useNavigate，DashboardPage 使用 useParams
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ projectId: 'p-1' }),
}));

// SettingsModal 依赖
vi.mock('@/hooks/useConfirm', () => ({
  confirm: vi.fn(),
  ConfirmDialog: () => null,
}));
vi.mock('@/utils/overlayState', () => ({
  pushOverlay: vi.fn(),
  popOverlay: vi.fn(),
}));
vi.mock('@/utils/llmClient', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    updateSettings: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  })),
}));

// ImportModal 依赖
vi.mock('@/utils/importUtils', () => ({
  parseMarkdown: vi.fn(),
  parsePlainText: vi.fn(),
  parseDocx: vi.fn(),
}));

// OutlineImportModal 依赖：parseOutline 返回完整预览结构，使 tabs 模式可被扫描
vi.mock('@/utils/outlineParser', () => ({
  parseOutline: vi.fn(() => ({
    title: '测试作品',
    description: '作品描述',
    volumes: [
      {
        title: '卷一：风起',
        order: 0,
        wordTarget: 800000,
        timeSpan: '春 — 夏',
        epicPositioning: '史诗定位',
        coreProposition: '核心命题',
        notes: '',
        parts: [
          { title: '上部·开端', order: 0, content: '<p>上部内容</p>', wordCount: 100 },
        ],
        foreshadows: [],
      },
    ],
    characters: [
      { name: '林墨', role: 'protagonist', profile: { background: '出身寒微' }, mentionCount: 10 },
    ],
    settings: [
      { categoryName: '核心设定', items: [{ name: '世界观', content: '架空王朝' }] },
    ],
    foreshadows: [
      { title: '神秘信物', description: '信物反噬', priority: 'high' },
    ],
  })),
}));

// AIPanel 依赖
vi.mock('@/utils/aiService', () => ({
  aiService: {
    updateSettings: vi.fn(),
    generateContinuationStream: vi.fn().mockResolvedValue(''),
    expandTextStream: vi.fn().mockResolvedValue(''),
    polishTextStream: vi.fn().mockResolvedValue(''),
    switchPerspective: vi.fn().mockResolvedValue({}),
    generateWritingByInstruction: vi.fn().mockResolvedValue(''),
    generateMultipleVersions: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  },
  // MaterialsPanel 深度提问 drawer 依赖
  askMaterialQuestion: vi.fn().mockResolvedValue([
    { question: '测试问题', dimension: '秘密' },
  ]),
  StreamHandler: {},
}));
vi.mock('@/hooks/useToast', async (importOriginal) => {
  // 保留真实 ToastContainer / useToastStore 供本文件的 axe 扫描用例使用，
  // 仅覆盖便捷 toast 方法（AIPanel / MaterialsPanel 等组件只需 mock 后的 toast）
  const actual = await importOriginal<typeof import('@/hooks/useToast')>();
  return {
    ...actual,
    toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});
vi.mock('@/hooks/useEditorAI', () => ({
  sanitizeAiHtml: vi.fn((s: string) => s),
}));
vi.mock('dompurify', () => ({
  default: { sanitize: vi.fn((s: string) => s) },
}));

// MaterialsPanel 图片缓存依赖
vi.mock('@/utils/imageCache', () => ({
  readImageDataUrl: vi.fn(),
  clearImageErrorCache: vi.fn(),
}));

// ============ imports ============
import { BaseModal } from '@/components/BaseModal';
import SettingsModal from '@/components/SettingsModal';
import ImportModal from '@/components/ImportModal';
import OutlineImportModal from '@/components/OutlineImportModal';
import SearchModal from '@/components/SearchModal';
import AIPanel from '@/components/editor/AIPanel';
import MaterialsPanel from '@/components/editor/MaterialsPanel';
import OnboardingGuide from '@/components/OnboardingGuide';
import InteractiveTour from '@/components/InteractiveTour';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastContainer, useToastStore } from '@/hooks/useToast';
import { ExportFormatSelector } from '@/pages/export/ExportFormatSelector';
import DashboardPage from '@/pages/DashboardPage';
import ChapterNode from '@/components/editor/outline/ChapterNode';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useAppStore } from '@/store/useAppStore';
import { expectNoA11yViolations } from '@/test/axe';
import type { AppPreferences, AISettings } from '@/types';
import type { SearchEntry } from '@/store/appState';
import type { Material, Chapter, Project } from '@/types';

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

function makeSearchEntry(overrides: Partial<SearchEntry> = {}): SearchEntry {
  return {
    type: 'chapter',
    id: 'e1',
    title: '测试条目',
    preview: '预览内容',
    matchCount: 1,
    ...overrides,
  };
}

function makeMaterial(overrides: Partial<Material> = {}): Material {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'm-1',
    projectId: 'p-1',
    title: '素材一',
    type: 'inspiration',
    content: '这是素材内容',
    tags: ['灵感'],
    category: '未分类',
    references: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
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
    },
    ...overrides,
  } as Project;
}

// ============ 全局 afterEach ============
afterEach(() => {
  cleanup();
});

// ============ BaseModal ============
describe('axe-core 单元 a11y 扫描', () => {
  describe('BaseModal', () => {
    it('打开状态无 a11y 违规', async () => {
      render(
        <BaseModal isOpen onClose={() => {}} title="测试对话框" width="md">
          <p>对话框正文内容</p>
          <button onClick={() => {}}>确认</button>
        </BaseModal>,
      );

      // BaseModal 通过 createPortal 渲染到 document.body，扫描整个 body
      await expectNoA11yViolations(document.body);
    });

    it('无标题 BaseModal 仍满足 a11y（aria-labelledby 缺失时不应有 dialog-name 违规）', async () => {
      render(
        <BaseModal isOpen onClose={() => {}} showCloseButton>
          <button onClick={() => {}}>操作</button>
        </BaseModal>,
      );

      await expectNoA11yViolations(document.body);
    });

    it('辅助函数能捕获违规：按钮缺少可访问名称时抛错', async () => {
      // 故意渲染一个无文本/无 aria-label 的按钮，证明扫描器确实在工作。
      const { container } = render(
        <div>
          <button onClick={() => {}} aria-label="" />
        </div>,
      );

      await expect(
        expectNoA11yViolations(container, {
          runOptions: { rules: { 'button-name': { enabled: true } } },
        }),
      ).rejects.toThrow(/发现 \d+ 项 a11y 违规/);
    });
  });

  // ============ SettingsModal ============
  describe('SettingsModal', () => {
    beforeEach(() => {
      useAppStore.setState({
        appPreferences: makePrefs(),
        aiSettings: makeAI(),
        updateAppPreferences: vi.fn().mockResolvedValue(undefined),
        updateAISettings: vi.fn().mockResolvedValue(undefined),
      });
    });

    it('AI 助手 section 打开状态无 a11y 违规（含 Toggle role=switch、Slider aria-valuetext）', async () => {
      render(<SettingsModal onClose={vi.fn()} />);
      // 切换到 AI 助手 section，使 Slider（aria-valuetext）与 Toggle（role=switch）进入 DOM
      fireEvent.click(screen.getByText('AI 助手'));

      // 扫描整个模态：模态未使用 portal，渲染在 container 内
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ ImportModal ============
  describe('ImportModal', () => {
    beforeEach(() => {
      useAppStore.setState({
        createProject: vi.fn().mockResolvedValue({ id: 'p-new', title: '导入作品' }),
        addChapter: vi.fn().mockReturnValue({ id: 'chap-new', title: '章节' }),
        updateChapterContent: vi.fn(),
        saveProject: vi.fn().mockResolvedValue(true),
        deleteProject: vi.fn().mockResolvedValue(undefined),
      });
    });

    it('打开状态无 a11y 违规（含拖拽区 role=button）', async () => {
      render(<ImportModal onClose={vi.fn()} />);

      // 拖拽区有 role="button" + tabIndex=0 + aria-label，扫描整个模态
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ OutlineImportModal ============
  describe('OutlineImportModal', () => {
    beforeEach(() => {
      useAppStore.setState({
        createProject: vi.fn().mockResolvedValue({ id: 'p-new', title: '测试作品' }),
        addChapter: vi.fn().mockReturnValue({ id: 'chap-new', title: '章节' }),
        updateChapter: vi.fn(),
        updateChapterContent: vi.fn(),
        addCharacter: vi.fn(),
        addSettingCategory: vi.fn().mockReturnValue({ id: 'cat-new', name: '分类' }),
        addSettingItem: vi.fn().mockReturnValue({ id: 'item-new', name: '条目' }),
        addForeshadow: vi.fn(),
        updateSettingItem: vi.fn(),
        updateProject: vi.fn(),
        saveProject: vi.fn().mockResolvedValue(true),
        deleteProject: vi.fn().mockResolvedValue(undefined),
      });
    });

    it('预览状态无 a11y 违规（含 tabs role=tablist/tab/tabpanel）', async () => {
      render(<OutlineImportModal onClose={vi.fn()} />);
      // 输入文本触发防抖解析（parseOutline 已 mock 为返回完整结构）
      const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '# 测试\n## 卷一：x' } });
      });
      // 等待防抖（400ms）完成，预览渲染出 tablist/tab/tabpanel
      await waitFor(() => {
        expect(screen.getByRole('tablist')).toBeInTheDocument();
      });

      await expectNoA11yViolations(document.body);
    });
  });

  // ============ SearchModal ============
  describe('SearchModal', () => {
    let originalScrollIntoView: Element['scrollIntoView'];

    beforeEach(() => {
      originalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = vi.fn();
      useAppStore.setState({
        searchResults: [
          makeSearchEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
          makeSearchEntry({ type: 'character', id: 'ch1', title: '主角' }),
        ],
        search: vi.fn(),
        setCurrentChapter: vi.fn(),
        setRightPanelTab: vi.fn(),
        setRightPanelCollapsed: vi.fn(),
      });
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it('有结果状态无 a11y 违规（含 listbox/combobox 模式）', async () => {
      render(<SearchModal onClose={vi.fn()} />);
      // 输入查询使 listbox 展开（aria-expanded=true），结果 option 渲染
      const input = screen.getByLabelText('搜索关键词');
      fireEvent.change(input, { target: { value: '测试' } });

      // combobox（input aria-autocomplete=list + aria-controls）+ listbox（role=listbox）+ option（role=option）
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ AIPanel ============
  describe('AIPanel', () => {
    beforeEach(() => {
      useAppStore.setState({
        currentChapterId: null,
        chapters: [],
        aiSuggestions: [],
        characters: [],
        aiSettings: makeAI(),
        clearAISuggestions: vi.fn(),
        setPendingEditorInsert: vi.fn(),
        updateAISettings: vi.fn(),
        addAISuggestion: vi.fn(),
        getSettingCard: vi.fn().mockReturnValue(null),
        getBlueprint: vi.fn().mockReturnValue(null),
      });
    });

    it('空状态无 a11y 违规（含 aria-live 流式区域容器）', async () => {
      // 空状态：无章节、无建议。AIPanel 的 aria-live 区域在生成时才填充内容，
      // 但容器结构（按钮、标题、指令输入区）始终渲染，扫描基础结构。
      const { container } = render(<AIPanel />);

      await expectNoA11yViolations(container);
    });
  });

  // ============ MaterialsPanel 深度提问 drawer ============
  describe('MaterialsPanel 深度提问 drawer', () => {
    beforeEach(() => {
      useAppStore.setState({
        materials: [makeMaterial()],
        currentProjectId: 'p-1',
        addMaterial: vi.fn().mockReturnValue(makeMaterial({ id: 'child-1' })),
        updateMaterial: vi.fn(),
      });
    });

    it('drawer 打开状态无 a11y 违规（含 role=dialog + aria-modal + focus trap）', async () => {
      render(<MaterialsPanel />);
      // 展开素材卡片，点击"深度提问"打开 drawer
      fireEvent.click(screen.getByText('素材一'));
      fireEvent.click(screen.getByText('深度提问'));
      // 等待 drawer 渲染（loading 文案出现即代表 drawer 已挂载）
      await waitFor(() => {
        expect(screen.getByText('AI 正在为这张卡片深度提问...')).toBeInTheDocument();
      });

      // drawer 通过条件渲染挂在组件树内（非 portal），扫描整个 body
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ OnboardingGuide ============
  describe('OnboardingGuide', () => {
    it('打开状态无 a11y 违规（含 role=dialog + aria-modal + focus trap）', async () => {
      render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);

      // 全屏覆盖层渲染在组件树内（非 portal），扫描整个 body
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ InteractiveTour ============
  describe('InteractiveTour', () => {
    let originalScrollIntoView: Element['scrollIntoView'];

    beforeEach(() => {
      originalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it('打开状态无 a11y 违规（含 role=dialog + aria-modal + focus trap）', async () => {
      // jsdom 的 getBoundingClientRect 默认返回全 0，会被 resolveAndLayout 视为"未找到"。
      // 通过 spy 返回非零 rect 使 tooltip 渲染出来，扫描完整结构。
      const spy = vi.spyOn(document, 'querySelector');
      spy.mockImplementation((selector: string) => {
        if (!selector) return null;
        const el = document.createElement('div');
        el.getBoundingClientRect = () => ({
          width: 100, height: 50, top: 200, left: 300,
          right: 400, bottom: 250, x: 300, y: 200, toJSON: () => ({}),
        } as DOMRect);
        return el as unknown as HTMLElement;
      });

      render(
        <InteractiveTour
          steps={[{ selector: '.step-1', title: '第一步', description: '第一步描述' }]}
          onComplete={vi.fn()}
          onSkip={vi.fn()}
        />,
      );
      // useLayoutEffect 内 setTimeout(0) 触发 resolveAndLayout，等待 tooltip 出现
      await waitFor(() => {
        expect(screen.getByText('第一步')).toBeInTheDocument();
      });

      spy.mockRestore();

      // 覆盖层渲染在组件树内（非 portal），扫描整个 body
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ ErrorBoundary 降级 UI ============
  describe('ErrorBoundary 降级 UI', () => {
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
      originalConsoleError = console.error;
      console.error = vi.fn();
    });

    afterEach(() => {
      console.error = originalConsoleError;
    });

    it('默认兜底 UI 无 a11y 违规（含 h2 标题 + 重新加载按钮）', async () => {
      function Boom(): never {
        throw new Error('axe test boom');
      }
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      // 扫描整个 body：兜底 UI 含错误图标 + h2 + 描述 + reload 按钮
      await expectNoA11yViolations(document.body);
    });

    it('自定义 fallback 无 a11y 违规（含 role=alert + 重试按钮）', async () => {
      function Boom(): never {
        throw new Error('custom boom');
      }
      render(
        <ErrorBoundary fallback={(err, reset) => (
          <div role="alert">
            <h2>出错了</h2>
            <p>{err.message}</p>
            <button onClick={reset}>重试</button>
          </div>
        )}>
          <Boom />
        </ErrorBoundary>,
      );
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ ToastContainer（toast 通知） ============
  describe('ToastContainer', () => {
    beforeEach(() => {
      useToastStore.getState().clearToasts();
    });

    it('多种类型 toast 同时存在时无 a11y 违规（含 role=alert/status + aria-live）', async () => {
      useToastStore.getState().addToast({ type: 'success', title: '保存成功', description: '内容已写入磁盘' });
      useToastStore.getState().addToast({ type: 'error', title: '同步失败', description: '网络不可用' });
      useToastStore.getState().addToast({ type: 'warning', title: '存稿不足' });
      useToastStore.getState().addToast({ type: 'info', title: '提示信息' });

      render(<ToastContainer />);
      // 扫描整个 body：容器 role=region + 每个 toast role=alert/status + 关闭按钮 aria-label
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ ExportFormatSelector（导出格式选择器） ============
  describe('ExportFormatSelector', () => {
    it('格式选择器无 a11y 违规（含 6 个格式按钮的 accessible name）', async () => {
      const { container } = render(
        <ExportFormatSelector format="markdown" onFormatChange={vi.fn()} />,
      );
      // 每个按钮含图标 + label + desc 文本，accessible name 来自文本内容
      await expectNoA11yViolations(container);
    });

    it('选中 PDF 格式时无 a11y 违规', async () => {
      const { container } = render(
        <ExportFormatSelector format="pdf" onFormatChange={vi.fn()} />,
      );
      await expectNoA11yViolations(container);
    });
  });

  // ============ DashboardPage（项目仪表盘） ============
  describe('DashboardPage', () => {
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
      originalConsoleError = console.error;
      console.error = vi.fn();
      useAppStore.setState({
        projects: [makeProject()],
        chapters: [
          makeChapter({ id: 'c1', title: '第一章', order: 1, status: 'done', wordCount: 1000 }),
          makeChapter({ id: 'c2', title: '第二章', order: 2, status: 'draft', wordCount: 500 }),
        ],
        characters: [],
        foreshadows: [],
        subplots: [],
        updateSchedule: null,
        getStockpileDays: vi.fn().mockReturnValue(10),
        loadProjects: vi.fn().mockResolvedValue(undefined),
        openProject: vi.fn().mockResolvedValue(undefined),
        setCurrentChapter: vi.fn(),
        setRightPanelTab: vi.fn(),
      });
    });

    afterEach(() => {
      console.error = originalConsoleError;
    });

    it('项目仪表盘无 a11y 违规（含统计卡片/警报/章节进度按钮/快捷入口）', async () => {
      render(<DashboardPage />);
      // 等待 loadProjects + openProject 完成后仪表盘渲染
      await waitFor(() => {
        expect(screen.getByText('总控仪表盘')).toBeInTheDocument();
      });
      // 扫描整个 body：header(main landmark) + 6 统计卡片 + 警报中心 + 章节进度按钮
      await expectNoA11yViolations(document.body);
    });
  });

  // ============ ChapterNode（大纲树节点） ============
  describe('ChapterNode', () => {
    beforeEach(() => {
      useAppStore.setState({
        updateChapter: vi.fn(),
        deleteChapter: vi.fn(),
        addChapter: vi.fn().mockReturnValue({ id: 'new-1', title: '新章节' }),
        setCurrentChapter: vi.fn(),
      });
    });

    it('有子节点的展开状态无 a11y 违规（含折叠按钮 aria-expanded + 拖拽手柄）', async () => {
      const parent = makeChapter({
        id: 'c-parent',
        title: '全书',
        levelType: 'book',
        level: 0,
        order: 0,
      });
      const child = makeChapter({
        id: 'c-child',
        title: '卷一',
        levelType: 'volume',
        level: 1,
        parentId: 'c-parent',
        order: 0,
      });
      const childrenByParent = new Map<string | null, Chapter[]>([
        [null, [parent]],
        ['c-parent', [child]],
      ]);

      const { container } = render(
        <DndContext>
          <SortableContext items={['c-parent', 'c-child']} strategy={verticalListSortingStrategy}>
            <ChapterNode
              chapter={parent}
              depth={0}
              collapsedIds={new Set()}
              onToggleExpanded={vi.fn()}
              onSelect={vi.fn()}
              isSelected={false}
              children={[child]}
              childrenByParent={childrenByParent}
            />
          </SortableContext>
        </DndContext>,
      );
      // 扫描树节点：折叠/展开按钮（aria-label + aria-expanded）、拖拽手柄（aria-label）、
      // 字数标签、添加/更多菜单按钮（aria-label）、递归渲染的子节点
      await expectNoA11yViolations(container);
    });
  });
});
