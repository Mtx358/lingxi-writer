/**
 * ImportModal 单元测试
 *
 * 测试范围：
 *   - 顶层：标题"导入作品" / X 关闭 / 背景点击关闭 / 卡片阻止冒泡
 *   - 拖拽区域：点击触发 fileInput / dragOver / dragLeave / drop
 *   - handleFile：扩展名校验 / 大小限制 / 错误提示
 *   - 标题映射配置：默认值 / 切换 h1/h2/h3 映射 / 仅 md/docx 显示
 *   - 解析流程：parseMarkdown / parsePlainText / parseDocx（成功 + 抛错）
 *   - 解析结果为空：显示"未识别到有效内容"
 *   - 解析结果渲染：标题 / 章节数 / 总字数 / 章节列表
 *   - 确认导入：createProject + addChapter + updateChapterContent + saveProject + navigate + onClose
 *   - 导入失败：deleteProject 回滚 + 错误提示
 *   - 重新选择：清空所有状态 + 释放 object URL
 *   - 卸载守卫：isMountedRef 阻止 setState
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ImportModal from '@/components/ImportModal';
import { useAppStore } from '@/store/useAppStore';
import type { ImportResult } from '@/utils/importUtils';

// ============ mocks ============
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/utils/importUtils', () => ({
  parseMarkdown: vi.fn(),
  parsePlainText: vi.fn(),
  parseDocx: vi.fn(),
}));

import { parseMarkdown, parsePlainText, parseDocx } from '@/utils/importUtils';

// ============ fixtures ============
function makeResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    title: '测试作品',
    chapters: [
      { title: '第一章', content: '<p>章节1内容</p>', level: 2, order: 0 },
      { title: '第二章', content: '<p>章节2内容</p>', level: 2, order: 1 },
    ],
    totalWords: 100,
    ...overrides,
  };
}

function makeFile(name: string, content: string, type = 'text/plain'): File {
  const file = new File([content], name, { type });
  // jsdom 未实现 File.prototype.text()，挂载 own property 让 await file.text() 可用
  // 直接挂 own property 而非 prototype，便于单测中 vi.spyOn(file, 'text') 覆盖
  Object.defineProperty(file, 'text', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(content),
  });
  return file;
}

// ============ store mock ============
function mockStore(overrides: Partial<{
  createProject: ReturnType<typeof vi.fn>;
  addChapter: ReturnType<typeof vi.fn>;
  updateChapterContent: ReturnType<typeof vi.fn>;
  saveProject: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
}> = {}) {
  const createProject = overrides.createProject || vi.fn().mockResolvedValue({ id: 'p-new', title: '导入作品' });
  const addChapter = overrides.addChapter || vi.fn().mockReturnValue({ id: 'chap-new', title: '章节' });
  const updateChapterContent = overrides.updateChapterContent || vi.fn();
  const saveProject = overrides.saveProject || vi.fn().mockResolvedValue(true);
  const deleteProject = overrides.deleteProject || vi.fn().mockResolvedValue(undefined);

  useAppStore.setState({
    createProject,
    addChapter,
    updateChapterContent,
    saveProject,
    deleteProject,
  });

  return { createProject, addChapter, updateChapterContent, saveProject, deleteProject };
}

describe('ImportModal', () => {
  let originalConsoleError: typeof console.error;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.mocked(parseMarkdown).mockReset();
    vi.mocked(parsePlainText).mockReset();
    vi.mocked(parseDocx).mockReset();
    originalConsoleError = console.error;
    console.error = vi.fn();

    // jsdom 未实现 URL.createObjectURL / revokeObjectURL，polyfill 成 mock
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    // jsdom 的 fetch 不支持 blob: URL，mock 成返回空 ArrayBuffer 的 Response
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response)) as typeof global.fetch;
  });

  afterEach(() => {
    // 先 cleanup（触发组件卸载的 useEffect cleanup，此时 URL.revokeObjectURL 仍是 mock）
    cleanup();
    vi.useRealTimers();
    console.error = originalConsoleError;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // 显式 advance parseTimerRef 的 setTimeout(300)
  // 需要两轮：第一轮让 file.text() 微任务 resolve 并触发 setFileContent（state 批处理），
  // act 结束时 useEffect 才执行并调度 setTimeout(300)；第二轮才真正 fire setTimeout 回调。
  async function flushParse(ms = 350) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // ============ 顶层渲染 ============
  it('标题"导入作品"始终渲染', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    expect(screen.getByText('导入作品')).toBeInTheDocument();
  });

  it('点击 X 按钮调用 onClose', () => {
    mockStore();
    const onClose = vi.fn();
    render(<ImportModal onClose={onClose} />);
    const xBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    fireEvent.click(xBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景遮罩调用 onClose', () => {
    mockStore();
    const onClose = vi.fn();
    const { container } = render(<ImportModal onClose={onClose} />);
    // 遮罩是外层 fixed inset-0 div
    const overlay = container.firstElementChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击卡片不触发 onClose（stopPropagation）', () => {
    mockStore();
    const onClose = vi.fn();
    const { container } = render(<ImportModal onClose={onClose} />);
    const overlay = container.firstElementChild as HTMLElement;
    const card = overlay.firstElementChild as HTMLElement;
    fireEvent.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('拖拽区域渲染提示文本', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    expect(screen.getByText('拖拽文件到此处，或点击选择')).toBeInTheDocument();
    expect(screen.getByText(/支持 .md .txt .docx/)).toBeInTheDocument();
  });

  // ============ 文件校验 ============
  it('不支持的扩展名显示错误', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.pdf', 'content')] },
    });
    expect(screen.getByText('仅支持 .md .markdown .txt .docx 格式')).toBeInTheDocument();
  });

  it('文件过大显示错误（> 20 MB）', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    const bigFile = makeFile('big.txt', 'x');
    Object.defineProperty(bigFile, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [bigFile] },
    });
    expect(screen.getByText('文件过大，请控制在 20 MB 以内')).toBeInTheDocument();
  });

  it('扩展名大小写不敏感校验（.MD 识别为 markdown）', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.MD', '# 标题\n内容')] },
    });
    // 应调用 parseMarkdown（说明 isMarkdown=true）
    await flushParse();
    expect(parseMarkdown).toHaveBeenCalledTimes(1);
  });

  // ============ 拖拽视觉反馈 ============
  it('dragOver 切换样式（amber border）', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.dragOver(dropZone!);
    expect(dropZone?.className).toContain('border-amber-400');
    fireEvent.dragLeave(dropZone!);
    expect(dropZone?.className).not.toContain('border-amber-400');
  });

  // ============ 解析流程：markdown ============
  it('Markdown 文件成功解析显示结果', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult({ title: '我的作品' }));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题\n内容')] },
    });
    await flushParse();
    expect(parseMarkdown).toHaveBeenCalledTimes(1);
    expect(screen.getByText('文件解析成功')).toBeInTheDocument();
    expect(screen.getByText('我的作品')).toBeInTheDocument();
  });

  it('parseMarkdown 抛错显示"文件解析失败"', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockImplementation(() => { throw new Error('parse failed'); });
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    expect(screen.getByText('文件解析失败，请检查文件格式')).toBeInTheDocument();
  });

  it('解析结果 chapters 为空显示"未识别到有效内容"', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue({ title: '', chapters: [], totalWords: 0 });
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    // fileContent 不能为空字符串——useEffect 的 `!fileContent && !isDocx` 会提前 return
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', 'some content')] },
    });
    await flushParse();
    expect(screen.getByText('未识别到有效内容，请检查文件格式或标题映射配置')).toBeInTheDocument();
  });

  // ============ 解析流程：txt ============
  it('txt 文件调用 parsePlainText', async () => {
    mockStore();
    vi.mocked(parsePlainText).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.txt', '第一章\n内容')] },
    });
    await flushParse();
    expect(parsePlainText).toHaveBeenCalledTimes(1);
    expect(parseMarkdown).not.toHaveBeenCalled();
  });

  // ============ 解析流程：docx ============
  it('docx 文件调用 parseDocx', async () => {
    mockStore();
    vi.mocked(parseDocx).mockResolvedValue(makeResult({ title: 'docx 作品' }));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.docx', 'fake-content')] },
    });
    await flushParse();
    expect(parseDocx).toHaveBeenCalledTimes(1);
    expect(screen.getByText('docx 作品')).toBeInTheDocument();
  });

  it('parseDocx 抛错显示"DOCX 解析失败"', async () => {
    mockStore();
    vi.mocked(parseDocx).mockRejectedValue(new Error('docx error'));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.docx', 'fake')] },
    });
    await flushParse();
    expect(screen.getByText('DOCX 解析失败，请确保文件格式正确')).toBeInTheDocument();
  });

  // ============ 标题映射配置 ============
  it('渲染标题层级映射（3 行 × 4 选项 = 12 个按钮）', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    // 4 个选项 × 3 个层级 = 12 个映射按钮（其中"作品"按钮在每行都有）
    const optionBtns = screen.getAllByText('作品');
    expect(optionBtns.length).toBe(3); // h1/h2/h3 各一行
    expect(screen.getAllByText('分卷').length).toBe(3);
    expect(screen.getAllByText('章节').length).toBe(3);
    expect(screen.getAllByText('忽略').length).toBe(3);
  });

  it('切换 h1 映射为"分卷"调用 parseMarkdown 更新参数', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    // 默认 mapping：{ h1: 'title', h2: 'chapter', h3: 'ignore' }
    expect(parseMarkdown).toHaveBeenLastCalledWith(expect.any(String), {
      h1: 'title', h2: 'chapter', h3: 'ignore',
    });
    // 找到 h1 行的"分卷"按钮并点击
    const h1Row = screen.getByText('# 一级标题').closest('div');
    const volumeBtn = h1Row!.querySelector('button:nth-child(2)')!;
    fireEvent.click(volumeBtn);
    await flushParse();
    expect(parseMarkdown).toHaveBeenLastCalledWith(expect.any(String), {
      h1: 'volume', h2: 'chapter', h3: 'ignore',
    });
  });

  it('解析结果页仍显示标题映射（用于重新解析）', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    // 解析结果页也应有标题映射（showMappingConfig = !fileName || isMarkdown）
    expect(screen.getByText('标题层级映射')).toBeInTheDocument();
  });

  // ============ 解析结果渲染 ============
  it('显示作品标题 / 章节数 / 总字数', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult({
      title: '测试作品', totalWords: 12345,
    }));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    expect(screen.getByText('测试作品')).toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByText('12,345 字')).toBeInTheDocument();
  });

  it('渲染章节列表（每个章节标题）', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult({
      chapters: [
        { title: '第一章 开端', content: '<p>a</p>', level: 2, order: 0 },
        { title: '第二章 发展', content: '<p>b</p>', level: 2, order: 1 },
        { title: '第三章 高潮', content: '<p>c</p>', level: 2, order: 2 },
      ],
    }));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    expect(screen.getByText('第一章 开端')).toBeInTheDocument();
    expect(screen.getByText('第二章 发展')).toBeInTheDocument();
    expect(screen.getByText('第三章 高潮')).toBeInTheDocument();
  });

  it('level=1 章节显示"分卷"徽章', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult({
      chapters: [
        { title: '第一卷', content: '<p>卷</p>', level: 1, order: 0 },
        { title: '第一章', content: '<p>章</p>', level: 2, order: 1 },
      ],
    }));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    // 只有第一卷有"分卷"徽章
    const badges = screen.getAllByText('分卷');
    // 包括映射按钮中的 3 个"分卷" + 1 个章节徽章 = 4
    expect(badges.length).toBe(4);
  });

  // ============ 确认导入 ============
  it('点击"确认导入"调用 createProject + addChapter + updateChapterContent + saveProject', async () => {
    const { createProject, addChapter, updateChapterContent, saveProject } = mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult({
      title: '导入测试',
      chapters: [
        { title: '第一章', content: '<p>内容1</p>', level: 2, order: 0 },
        { title: '第二章', content: '<p>内容2</p>', level: 2, order: 1 },
      ],
    }));
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    fireEvent.click(screen.getByText('确认导入'));
    // 异步等待所有 await 完成
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(createProject).toHaveBeenCalledWith('导入测试', 'blank');
    expect(addChapter).toHaveBeenCalledTimes(2);
    expect(updateChapterContent).toHaveBeenCalledTimes(2);
    expect(saveProject).toHaveBeenCalledTimes(1);
  });

  it('导入成功后调用 onClose', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    const onClose = vi.fn();
    render(<ImportModal onClose={onClose} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    fireEvent.click(screen.getByText('确认导入'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('importing 状态下按钮文本变为"导入中..."', async () => {
    // saveProject 不 resolve，模拟 importing 中间态
    let resolveSave: (v: boolean) => void;
    mockStore({
      saveProject: vi.fn().mockReturnValue(new Promise<boolean>(r => { resolveSave = r; })),
    });
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    fireEvent.click(screen.getByText('确认导入'));
    // 进入 importing 状态（saveProject pending）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByText('导入中...')).toBeInTheDocument();
    // 解析完成
    resolveSave!(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  });

  // ============ 导入失败回滚 ============
  it('createProject 抛错时不调用 saveProject/deleteProject（createdProjectId 仍为 null）', async () => {
    const { saveProject, deleteProject } = mockStore({
      createProject: vi.fn().mockRejectedValue(new Error('create failed')),
    });
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    fireEvent.click(screen.getByText('确认导入'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    // 组件 catch 块调用 console.error('导入失败:', e) 并 setImportResult(null) 回退到输入区
    // 修复 H2：现在 error 文案在输入区可见
    expect(console.error).toHaveBeenCalledWith('导入失败:', expect.any(Error));
    expect(screen.getByText('导入失败，请重试')).toBeInTheDocument();
    expect(saveProject).not.toHaveBeenCalled();
    expect(deleteProject).not.toHaveBeenCalled(); // createdProjectId 仍为 null
  });

  it('saveProject 抛错时回滚 deleteProject', async () => {
    const { deleteProject } = mockStore({
      saveProject: vi.fn().mockRejectedValue(new Error('save failed')),
    });
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    fireEvent.click(screen.getByText('确认导入'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(deleteProject).toHaveBeenCalledWith('p-new');
    expect(console.error).toHaveBeenCalledWith('导入失败:', expect.any(Error));
    // 修复 H2：导入失败回退输入区，error 文案可见
    expect(screen.getByText('导入失败，请重试')).toBeInTheDocument();
  });

  // ============ 重新选择 ============
  it('点击"重新选择"清空解析结果回到拖拽状态', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    await flushParse();
    expect(screen.getByText('文件解析成功')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重新选择'));
    expect(screen.queryByText('文件解析成功')).not.toBeInTheDocument();
    expect(screen.getByText('拖拽文件到此处，或点击选择')).toBeInTheDocument();
  });

  it('重新选择时清空文件名', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('my-novel.md', '# 标题')] },
    });
    await flushParse();
    // 解析结果页显示文件名
    expect(screen.getByText('my-novel.md')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重新选择'));
    expect(screen.queryByText('my-novel.md')).not.toBeInTheDocument();
  });

  // ============ 点击拖拽区域触发 file input ============
  it('点击拖拽区域触发 fileInput.click()', () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(dropZone!);
    expect(clickSpy).toHaveBeenCalled();
  });

  // ============ 卸载守卫 ============
  it('卸载后 parseTimerRef 回调不报错', async () => {
    mockStore();
    vi.mocked(parseMarkdown).mockReturnValue(makeResult());
    const { unmount } = render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [makeFile('test.md', '# 标题')] },
    });
    // 卸载后 advance timers 不应抛错（isMountedRef 守卫）
    unmount();
    expect(() => {
      act(() => { vi.advanceTimersByTime(500); });
    }).not.toThrow();
  });

  // ============ file.text() 失败兜底 ============
  it('文件读取失败显示"文件读取失败"', async () => {
    mockStore();
    render(<ImportModal onClose={vi.fn()} />);
    const dropZone = screen.getByText('拖拽文件到此处，或点击选择').closest('div');
    const badFile = makeFile('test.md', 'content');
    // mock text() 抛错
    vi.spyOn(badFile, 'text').mockRejectedValue(new Error('read failed'));
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [badFile] },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText('文件读取失败，请重试')).toBeInTheDocument();
  });
});
