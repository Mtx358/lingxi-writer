/**
 * OutlineImportModal 单元测试
 *
 * 测试范围：
 *   - 顶层：标题"导入大纲" / X 关闭 / 背景点击关闭 / 卡片阻止冒泡
 *   - 防抖解析：成功显示预览 / 空结果显示错误 / parseOutline 抛错显示错误 / 空文本清空状态
 *   - 剪贴板：成功粘贴 / 失败显示错误
 *   - 确认导入：createProject + 设定 + 卷·部 + 人物 + 伏笔 + saveProject + navigate + onClose
 *   - 导入失败：deleteProject 回滚 + 内存状态清空 + 错误提示 / 回滚失败不抛错
 *   - Tab 切换：volumes / characters / settings / foreshadows
 *   - 重新输入：清空 parsed/rawText/error
 *   - 卸载守卫：isMountedRef 阻止 setState
 *   - importing 期间禁用按钮
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import OutlineImportModal from '@/components/OutlineImportModal';
import { useAppStore } from '@/store/useAppStore';
import type { ParsedOutline } from '@/utils/outlineParser';

// ============ mocks ============
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// ============ fixtures ============
function makeParsed(overrides: Partial<ParsedOutline> = {}): ParsedOutline {
  return {
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
        notes: '卷备注',
        parts: [
          { title: '上部·开端', order: 0, content: '<p>上部内容</p>', wordCount: 100 },
          { title: '下部·转折', order: 1, content: '<p>下部内容</p>', wordCount: 200 },
        ],
        foreshadows: [],
      },
    ],
    characters: [
      {
        name: '林墨',
        role: 'protagonist',
        profile: { background: '出身寒微', motivation: '复仇', arc: '觉醒' },
        mentionCount: 10,
      },
      {
        name: '苏婉',
        role: 'supporting',
        profile: { background: '世家女' },
        mentionCount: 5,
      },
    ],
    settings: [
      {
        categoryName: '核心设定',
        items: [
          { name: '世界观', content: '架空王朝' },
          { name: '力量体系', content: '内力分级' },
        ],
      },
    ],
    foreshadows: [
      { title: '神秘信物', description: '信物反噬', priority: 'high' },
      { title: '血色誓言', description: '誓言应验', priority: 'medium' },
    ],
    totalWords: 300,
    ...overrides,
  };
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  createProject: ReturnType<typeof vi.fn>;
  addChapter: ReturnType<typeof vi.fn>;
  updateChapter: ReturnType<typeof vi.fn>;
  updateChapterContent: ReturnType<typeof vi.fn>;
  addCharacter: ReturnType<typeof vi.fn>;
  addSettingCategory: ReturnType<typeof vi.fn>;
  addSettingItem: ReturnType<typeof vi.fn>;
  addForeshadow: ReturnType<typeof vi.fn>;
  updateSettingItem: ReturnType<typeof vi.fn>;
  updateProject: ReturnType<typeof vi.fn>;
  saveProject: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
}> = {}) {
  const createProject = overrides.createProject || vi.fn().mockResolvedValue({ id: 'p-new', title: '测试作品' });
  const addChapter = overrides.addChapter || vi.fn().mockReturnValue({ id: 'chap-new', title: '章节' });
  const updateChapter = overrides.updateChapter || vi.fn();
  const updateChapterContent = overrides.updateChapterContent || vi.fn();
  const addCharacter = overrides.addCharacter || vi.fn();
  const addSettingCategory = overrides.addSettingCategory || vi.fn().mockReturnValue({ id: 'cat-new', name: '分类' });
  const addSettingItem = overrides.addSettingItem || vi.fn().mockReturnValue({ id: 'item-new', name: '条目' });
  const addForeshadow = overrides.addForeshadow || vi.fn();
  const updateSettingItem = overrides.updateSettingItem || vi.fn();
  const updateProject = overrides.updateProject || vi.fn();
  const saveProject = overrides.saveProject || vi.fn().mockResolvedValue(true);
  const deleteProject = overrides.deleteProject || vi.fn().mockResolvedValue(undefined);

  useAppStore.setState({
    createProject,
    addChapter,
    updateChapter,
    updateChapterContent,
    addCharacter,
    addSettingCategory,
    addSettingItem,
    addForeshadow,
    updateSettingItem,
    updateProject,
    saveProject,
    deleteProject,
  });

  return {
    createProject, addChapter, updateChapter, updateChapterContent,
    addCharacter, addSettingCategory, addSettingItem, addForeshadow,
    updateSettingItem, updateProject, saveProject, deleteProject,
  };
}

describe('OutlineImportModal', () => {
  let originalConsoleError: typeof console.error;
  let originalClipboard: Navigator['clipboard'];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    navigateMock.mockReset();
    originalConsoleError = console.error;
    console.error = vi.fn();
    originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    console.error = originalConsoleError;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    vi.restoreAllMocks();
  });

  // 显式 advance 防抖 setTimeout(400)
  async function flushParse(ms = 450) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // 输入文本并触发防抖解析
  async function inputAndParse(text: string) {
    mockStore();
    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: text } });
    });
    await flushParse();
  }

  // ============ 顶层渲染 ============
  it('标题"导入大纲"始终渲染', () => {
    mockStore();
    render(<OutlineImportModal onClose={vi.fn()} />);
    expect(screen.getByText('导入大纲')).toBeInTheDocument();
  });

  it('点击 X 按钮调用 onClose', () => {
    mockStore();
    const onClose = vi.fn();
    render(<OutlineImportModal onClose={onClose} />);
    const xBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    fireEvent.click(xBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景遮罩调用 onClose', () => {
    mockStore();
    const onClose = vi.fn();
    const { container } = render(<OutlineImportModal onClose={onClose} />);
    const overlay = container.firstElementChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击卡片不触发 onClose（stopPropagation）', () => {
    mockStore();
    const onClose = vi.fn();
    const { container } = render(<OutlineImportModal onClose={onClose} />);
    const overlay = container.firstElementChild as HTMLElement;
    const card = overlay.firstElementChild as HTMLElement;
    fireEvent.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('初始渲染显示识别规则提示', () => {
    mockStore();
    render(<OutlineImportModal onClose={vi.fn()} />);
    expect(screen.getByText('💡 识别规则')).toBeInTheDocument();
    expect(screen.getByText(/作品名/)).toBeInTheDocument();
  });

  // ============ 防抖解析 ============
  it('空文本清空 parsed 与 error', async () => {
    mockStore();
    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    // 先输入再清空
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# 测试\n## 卷一：x' } });
    });
    await flushParse();
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '' } });
    });
    await flushParse();
    // 回到输入态，无 error
    expect(screen.queryByText('大纲解析失败，请检查格式')).not.toBeInTheDocument();
  });

  it('解析成功显示预览统计', async () => {
    await inputAndParse('# 测试作品\n## 卷一：风起\n### 上部·开端\n内容');
    // 预览区显示卷数与部数
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/卷 \/ 1 部/)).toBeInTheDocument();
    // 标题预览
    expect(screen.getByText('测试作品')).toBeInTheDocument();
  });

  it('解析结果无卷无设定时显示错误', async () => {
    // 只有标题，没有 ## 卷X 或 ## 设定分类
    await inputAndParse('# 只有标题');
    expect(screen.getByText(/未识别到大纲结构/)).toBeInTheDocument();
  });

  it('parseOutline 抛错时显示错误', async () => {
    // 使用极长的输入触发可能的解析异常不现实，改用 spy 让 parseOutline 抛错
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockImplementation(() => {
      throw new Error('解析异常');
    });
    await inputAndParse('# 测试\n## 卷一：x');
    expect(screen.getByText('大纲解析失败，请检查格式')).toBeInTheDocument();
  });

  // ============ 剪贴板 ============
  it('点击"从剪贴板粘贴"成功读取文本', async () => {
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('# 剪贴板内容\n## 卷一：x');
    mockStore();
    render(<OutlineImportModal onClose={vi.fn()} />);
    const pasteBtn = screen.getByText('从剪贴板粘贴');
    await act(async () => {
      fireEvent.click(pasteBtn);
    });
    expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('# 剪贴板内容\n## 卷一：x');
  });

  it('剪贴板读取失败显示错误', async () => {
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('权限拒绝'));
    mockStore();
    render(<OutlineImportModal onClose={vi.fn()} />);
    const pasteBtn = screen.getByText('从剪贴板粘贴');
    await act(async () => {
      fireEvent.click(pasteBtn);
    });
    expect(screen.getByText('无法读取剪贴板，请手动粘贴')).toBeInTheDocument();
  });

  // ============ 确认导入 ============
  it('确认导入成功：创建项目/设定/卷·部/人物/伏笔/saveProject/navigate/onClose', async () => {
    const store = mockStore();
    // 直接通过 mock parseOutline 返回完整结构，避免依赖真实解析器
    const parseOutlineModule = await import('@/utils/outlineParser');
    const parsed = makeParsed();
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(parsed);

    const onClose = vi.fn();
    render(<OutlineImportModal onClose={onClose} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# 任意输入' } });
    });
    await flushParse();

    // 点击确认导入
    const confirmBtn = screen.getByText('确认导入并填充').closest('button')!;
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // 1. 创建项目
    expect(store.createProject).toHaveBeenCalledWith('测试作品', 'blank');
    // 2. 更新项目描述
    expect(store.updateProject).toHaveBeenCalledWith('p-new', { description: '作品描述' });
    // 3. 设定分类与条目
    expect(store.addSettingCategory).toHaveBeenCalledWith('核心设定', '📖');
    expect(store.addSettingItem).toHaveBeenCalledWith('cat-new', '世界观');
    expect(store.addSettingItem).toHaveBeenCalledWith('cat-new', '力量体系');
    expect(store.updateSettingItem).toHaveBeenCalledWith('item-new', expect.objectContaining({ content: '架空王朝' }));
    // 4. 卷（volume 级）
    expect(store.addChapter).toHaveBeenCalledWith(null, '卷一：风起', 0, 'volume');
    // 卷元数据更新
    expect(store.updateChapter).toHaveBeenCalledWith('chap-new', expect.objectContaining({
      wordTarget: 800000,
      timeSpan: '春 — 夏',
      epigraph: '史诗定位',
      coreProposition: '核心命题',
      notes: '卷备注',
    }));
    // 部（part 级，父级为卷）
    expect(store.addChapter).toHaveBeenCalledWith('chap-new', '上部·开端', 0, 'part');
    expect(store.addChapter).toHaveBeenCalledWith('chap-new', '下部·转折', 1, 'part');
    expect(store.updateChapterContent).toHaveBeenCalledWith('chap-new', '<p>上部内容</p>');
    // 5. 人物（主角带 tags）
    expect(store.addCharacter).toHaveBeenCalledWith(expect.objectContaining({
      name: '林墨',
      role: 'protagonist',
      tags: ['主角'],
    }));
    expect(store.addCharacter).toHaveBeenCalledWith(expect.objectContaining({
      name: '苏婉',
      role: 'supporting',
      tags: [],
    }));
    // 6. 伏笔
    expect(store.addForeshadow).toHaveBeenCalledWith(expect.objectContaining({
      title: '神秘信物',
      status: 'planted',
    }));
    // 7. saveProject
    expect(store.saveProject).toHaveBeenCalledTimes(1);
    // 8. navigate + onClose
    expect(navigateMock).toHaveBeenCalledWith('/project/p-new/editor');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('无 description 时不调用 updateProject', async () => {
    const store = mockStore();
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed({ description: '' }));

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();
    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });
    expect(store.updateProject).not.toHaveBeenCalled();
  });

  it('导入失败：deleteProject 回滚 + 清空内存状态 + 不 navigate', async () => {
    const store = mockStore({
      saveProject: vi.fn().mockRejectedValue(new Error('保存失败')),
    });
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();
    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });

    // 回滚：deleteProject 被调用
    expect(store.deleteProject).toHaveBeenCalledWith('p-new');
    // 内存状态被清空（避免首页留下半成品项目）
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(useAppStore.getState().chapters).toEqual([]);
    expect(useAppStore.getState().characters).toEqual([]);
    expect(useAppStore.getState().settingCategories).toEqual([]);
    expect(useAppStore.getState().settingItems).toEqual([]);
    expect(useAppStore.getState().foreshadows).toEqual([]);
    expect(useAppStore.getState().materials).toEqual([]);
    // navigate 未调用
    expect(navigateMock).not.toHaveBeenCalled();
    // 修复 H1：catch 中 setParsed(null) 让视图回退到输入区，error 文案现在可见
    expect(screen.getByText('导入失败，请重试')).toBeInTheDocument();
  });

  it('回滚失败时不抛错（仅 console.error）', async () => {
    mockStore({
      saveProject: vi.fn().mockRejectedValue(new Error('保存失败')),
      deleteProject: vi.fn().mockRejectedValue(new Error('回滚失败')),
    });
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();
    // 不应抛错（回滚失败被 catch）
    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });
    expect(console.error).toHaveBeenCalledWith('回滚半成品项目失败:', expect.any(Error));
    // 仍尝试清空内存状态
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('createProject 抛错时（projectId 为 null）不回滚', async () => {
    const store = mockStore({
      createProject: vi.fn().mockRejectedValue(new Error('创建失败')),
    });
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();
    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });
    // projectId 为 null，deleteProject 不应被调用
    expect(store.deleteProject).not.toHaveBeenCalled();
    // navigate 未调用
    expect(navigateMock).not.toHaveBeenCalled();
    // 修复 H1：error 文案现在可见
    expect(screen.getByText('导入失败，请重试')).toBeInTheDocument();
  });

  // ============ Tab 切换 ============
  it('Tab 切换到人物显示人物列表', async () => {
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());
    mockStore();

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    // 默认 volumes tab，切换到 characters
    await act(async () => {
      fireEvent.click(screen.getByText(/人物 \(2\)/));
    });
    expect(screen.getByText('林墨')).toBeInTheDocument();
    expect(screen.getByText('苏婉')).toBeInTheDocument();
    expect(screen.getByText('主角')).toBeInTheDocument();
    expect(screen.getByText('配角')).toBeInTheDocument();
  });

  it('Tab 切换到设定显示设定列表', async () => {
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());
    mockStore();

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    await act(async () => {
      fireEvent.click(screen.getByText(/设定 \(2\)/));
    });
    expect(screen.getByText('核心设定')).toBeInTheDocument();
    expect(screen.getByText('世界观')).toBeInTheDocument();
    expect(screen.getByText('架空王朝')).toBeInTheDocument();
  });

  it('Tab 切换到伏笔显示伏笔列表', async () => {
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());
    mockStore();

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    await act(async () => {
      fireEvent.click(screen.getByText(/伏笔 \(2\)/));
    });
    expect(screen.getByText('神秘信物')).toBeInTheDocument();
    expect(screen.getByText('血色誓言')).toBeInTheDocument();
  });

  it('volumes tab 渲染卷元数据（字数目标/时间跨度/核心命题/部列表）', async () => {
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());
    mockStore();

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    // 默认 volumes tab
    expect(screen.getByText('卷一：风起')).toBeInTheDocument();
    expect(screen.getByText(/目标 800,000 字/)).toBeInTheDocument();
    expect(screen.getByText('春 — 夏')).toBeInTheDocument();
    expect(screen.getByText('核心命题')).toBeInTheDocument();
    // 部列表
    expect(screen.getByText('上部·开端')).toBeInTheDocument();
    expect(screen.getByText('下部·转折')).toBeInTheDocument();
  });

  // ============ 重新输入 ============
  it('点击"重新输入"清空 parsed/rawText/error', async () => {
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());
    mockStore();

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    // 已进入预览态
    expect(screen.getByText('测试作品')).toBeInTheDocument();

    // 点击重新输入
    await act(async () => {
      fireEvent.click(screen.getByText('重新输入'));
    });
    // 回到输入态，textarea 清空
    expect(screen.queryByText('测试作品')).not.toBeInTheDocument();
    const textareaAfter = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe('');
  });

  // ============ 导入中状态 ============
  it('importing 期间按钮禁用并显示"导入中..."', async () => {
    // saveProject 返回永不 resolve 的 promise，让 importing 状态保持
    let resolveSave: () => void;
    const neverResolve = new Promise<void>((resolve) => { resolveSave = resolve; });
    mockStore({
      saveProject: vi.fn().mockReturnValue(neverResolve),
    });
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });
    // importing 状态
    expect(screen.getByText('导入中...')).toBeInTheDocument();
    // 重新输入按钮禁用
    expect(screen.getByText('重新输入').closest('button')).toBeDisabled();

    // 释放 promise 避免悬挂
    await act(async () => {
      resolveSave!();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  // ============ 卸载守卫 ============
  it('卸载后防抖回调不触发 setState（不抛错）', async () => {
    mockStore();
    const { unmount } = render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    // 在防抖回调触发前卸载
    unmount();
    // 推进 timer，不应抛错（isMountedRef.current === false 守卫）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('卸载后导入回调不触发 setState（不抛错）', async () => {
    let resolveSave: () => void;
    const neverResolve = new Promise<void>((resolve) => { resolveSave = resolve; });
    mockStore({
      saveProject: vi.fn().mockReturnValue(neverResolve),
    });
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed());

    const { unmount } = render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();

    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });
    // 导入进行中卸载
    unmount();
    // 释放 promise，不应抛错（isMountedRef.current === false 守卫）
    await act(async () => {
      resolveSave!();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  // ============ 无卷元数据的精简导入 ============
  it('卷无元数据时仅写入空 summary（无 wordTarget/timeSpan 等）', async () => {
    const store = mockStore();
    const parseOutlineModule = await import('@/utils/outlineParser');
    vi.spyOn(parseOutlineModule, 'parseOutline').mockReturnValue(makeParsed({
      volumes: [{
        title: '卷一：简',
        order: 0,
        parts: [],
        foreshadows: [],
      }],
    }));

    render(<OutlineImportModal onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/粘贴格式示例/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# x\n## 卷一：y' } });
    });
    await flushParse();
    await act(async () => {
      fireEvent.click(screen.getByText('确认导入并填充').closest('button')!);
    });
    // 卷已创建
    expect(store.addChapter).toHaveBeenCalledWith(null, '卷一：简', 0, 'volume');
    // 无元数据时仍会写入 summary: ''（summaryParts 为空 join 后为 ''），
    // 但不会写入 wordTarget/timeSpan/epigraph/coreProposition/notes
    expect(store.updateChapter).toHaveBeenCalledTimes(1);
    expect(store.updateChapter).toHaveBeenCalledWith('chap-new', expect.objectContaining({
      summary: '',
    }));
    // 确认未携带任何元数据字段
    const updateArg = store.updateChapter.mock.calls[0][1] as Record<string, unknown>;
    expect(updateArg.wordTarget).toBeUndefined();
    expect(updateArg.timeSpan).toBeUndefined();
    expect(updateArg.epigraph).toBeUndefined();
    expect(updateArg.coreProposition).toBeUndefined();
    expect(updateArg.notes).toBeUndefined();
  });
});
