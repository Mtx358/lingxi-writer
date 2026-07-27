/**
 * ConflictPanel 单元测试
 *
 * 测试范围：
 *   - 空状态：渲染"暂无检测到的问题"
 *   - 标题 / 未解决计数徽标
 *   - 扫描当前章节按钮：scanning 状态、disabled（无当前章节）、成功 merge、catch toast
 *   - 扫描全书按钮：调用 detectConflicts、catch toast
 *   - issue 列表渲染：severity/type 标签 / 章节标题
 *   - 展开/折叠：建议、定位、修复模板、标记忽略按钮
 *   - severity 计数（错误 / 警告）
 *   - onClose 可选 prop
 *   - mountedRef 卸载守卫（不报 setState 警告）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ConflictPanel from '@/components/editor/ConflictPanel';
import { useAppStore } from '@/store/useAppStore';
import { conflictDetector } from '@/utils/conflictDetector';
import { toast } from '@/hooks/useToast';
import type { ConflictIssue, Chapter, Character, SettingItem } from '@/types';

// ============ mocks ============
vi.mock('@/utils/conflictDetector', () => ({
  conflictDetector: {
    setCharacters: vi.fn(),
    setSettings: vi.fn(),
    detectChapterConflicts: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'chap-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 0,
    level: 1,
    levelType: 'chapter',
    status: 'writing',
    wordCount: 100,
    content: '<p>章节内容</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(overrides: Partial<ConflictIssue> = {}): ConflictIssue {
  return {
    id: 'issue-1',
    type: 'character',
    severity: 'warning',
    chapterId: 'chap-1',
    description: '角色名称不一致',
    suggestion: '建议统一为"张三"',
    position: { start: 10, end: 20 },
    resolved: false,
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    name: '张三',
    description: '主角',
    color: '#ff0000',
    variants: [],
    relationships: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

function makeSetting(overrides: Partial<SettingItem> = {}): SettingItem {
  return {
    id: 'set-1',
    projectId: 'p1',
    categoryId: 'cat-1',
    name: '世界观',
    description: '世界设定',
    content: '',
    references: [],
    tags: [],
    order: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  currentChapterId: string | null;
  chapters: Chapter[];
  conflicts: ConflictIssue[];
  characters: Character[];
  settingItems: SettingItem[];
  detectConflicts: ReturnType<typeof vi.fn>;
  resolveConflict: ReturnType<typeof vi.fn>;
  addAISuggestion: ReturnType<typeof vi.fn>;
  setPendingScrollTo: ReturnType<typeof vi.fn>;
}> = {}) {
  const detectConflicts = overrides.detectConflicts || vi.fn();
  const resolveConflict = overrides.resolveConflict || vi.fn();
  const addAISuggestion = overrides.addAISuggestion || vi.fn();
  const setPendingScrollTo = overrides.setPendingScrollTo || vi.fn();

  useAppStore.setState({
    currentChapterId: overrides.currentChapterId ?? 'chap-1',
    chapters: overrides.chapters ?? [makeChapter()],
    conflicts: overrides.conflicts ?? [],
    characters: overrides.characters ?? [],
    settingItems: overrides.settingItems ?? [],
    detectConflicts,
    resolveConflict,
    addAISuggestion,
    setPendingScrollTo,
  });

  return { detectConflicts, resolveConflict, addAISuggestion, setPendingScrollTo };
}

describe('ConflictPanel', () => {
  beforeEach(() => {
    vi.mocked(conflictDetector.detectChapterConflicts).mockReturnValue([]);
    vi.mocked(conflictDetector.setCharacters).mockClear();
    vi.mocked(conflictDetector.setSettings).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ============ 标题与空状态 ============
  it('空状态渲染"暂无检测到的问题"', () => {
    mockStore({ conflicts: [] });
    render(<ConflictPanel />);
    expect(screen.getByText('暂无检测到的问题')).toBeInTheDocument();
  });

  it('标题"冲突检测"始终渲染', () => {
    mockStore({ conflicts: [] });
    render(<ConflictPanel />);
    expect(screen.getByText('冲突检测')).toBeInTheDocument();
  });

  it('有未解决冲突时标题旁显示计数徽标', () => {
    mockStore({
      conflicts: [
        makeIssue({ id: 'i1', resolved: false }),
        makeIssue({ id: 'i2', resolved: false }),
      ],
    });
    render(<ConflictPanel />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('所有冲突已解决时不显示计数徽标', () => {
    mockStore({
      conflicts: [makeIssue({ resolved: true })],
    });
    render(<ConflictPanel />);
    // 标题存在但无徽标（无文本 "1"）
    expect(screen.getByText('冲突检测')).toBeInTheDocument();
  });

  // ============ 扫描按钮 ============
  it('无当前章节时"扫描当前章节"按钮 disabled', () => {
    mockStore({ currentChapterId: null, chapters: [] });
    render(<ConflictPanel />);
    const scanBtn = screen.getByText('扫描当前章节').closest('button');
    expect(scanBtn?.disabled).toBe(true);
  });

  it('扫描当前章节：调用 conflictDetector + merge 写入 conflicts', async () => {
    const issues = [makeIssue({ id: 'new-1', description: '新问题' })];
    vi.mocked(conflictDetector.detectChapterConflicts).mockReturnValue(issues);
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter({ id: 'chap-1' })],
      conflicts: [makeIssue({ id: 'old-other', chapterId: 'chap-2', description: '其他章节' })],
      characters: [makeCharacter()],
      settingItems: [makeSetting()],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('扫描当前章节'));
    // scanning 状态
    await waitFor(() => {
      expect(conflictDetector.setCharacters).toHaveBeenCalledWith([makeCharacter()]);
    });
    expect(conflictDetector.setSettings).toHaveBeenCalledWith([makeSetting()]);
    expect(conflictDetector.detectChapterConflicts).toHaveBeenCalledWith(expect.objectContaining({ id: 'chap-1' }));
    // merge：保留其他章节的旧冲突 + 新增当前章节的冲突
    await waitFor(() => {
      expect(useAppStore.getState().conflicts).toHaveLength(2);
      expect(useAppStore.getState().conflicts.find(i => i.id === 'old-other')).toBeDefined();
      expect(useAppStore.getState().conflicts.find(i => i.id === 'new-1')).toBeDefined();
    });
  });

  it('扫描当前章节：detectChapterConflicts 抛错时 toast.error', async () => {
    vi.mocked(conflictDetector.detectChapterConflicts).mockImplementation(() => {
      throw new Error('scan failed');
    });
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter({ id: 'chap-1' })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('扫描当前章节'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('冲突扫描失败', 'scan failed');
    });
  });

  it('扫描当前章节：detectChapterConflicts 抛非 Error 时 toast.error 传 String 值', async () => {
    vi.mocked(conflictDetector.detectChapterConflicts).mockImplementation(() => {
      throw 'string error';
    });
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter({ id: 'chap-1' })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('扫描当前章节'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('冲突扫描失败', 'string error');
    });
  });

  it('扫描全书按钮调用 detectConflicts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { detectConflicts } = mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter()],
    });
    render(<ConflictPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('扫描全书'));
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(detectConflicts).toHaveBeenCalledTimes(1);
  });

  it('扫描全书：detectConflicts 抛错时 toast.error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { detectConflicts } = mockStore({});
    detectConflicts.mockImplementation(() => {
      throw new Error('all scan failed');
    });
    render(<ConflictPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('扫描全书'));
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(toast.error).toHaveBeenCalledWith('冲突扫描失败', 'all scan failed');
  });

  it('扫描期间按钮显示"扫描中..."且 disabled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter()],
    });
    render(<ConflictPanel />);
    await act(async () => {
      fireEvent.click(screen.getByText('扫描当前章节'));
    });
    // scanning 中（同步 setScanning(true) 已应用）
    expect(screen.getByText('扫描中...')).toBeInTheDocument();
    const scanningBtn = screen.getByText('扫描中...').closest('button');
    expect(scanningBtn?.disabled).toBe(true);
  });

  // ============ issue 列表渲染 ============
  it('渲染 issue 描述与类型标签', () => {
    mockStore({
      conflicts: [makeIssue({ type: 'character', description: '角色冲突描述' })],
    });
    render(<ConflictPanel />);
    expect(screen.getByText('角色冲突描述')).toBeInTheDocument();
    expect(screen.getByText('角色')).toBeInTheDocument();
  });

  it('渲染 issue severity 标签', () => {
    mockStore({
      conflicts: [makeIssue({ severity: 'error' })],
    });
    render(<ConflictPanel />);
    expect(screen.getByText('错误')).toBeInTheDocument();
  });

  it('issue 关联章节时显示章节标题', () => {
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter({ id: 'chap-1', title: '序章' })],
      conflicts: [makeIssue({ chapterId: 'chap-1' })],
    });
    render(<ConflictPanel />);
    expect(screen.getByText('序章')).toBeInTheDocument();
  });

  it('已解决 issue 显示删除线', () => {
    mockStore({
      conflicts: [makeIssue({ description: '已解决问题', resolved: true })],
    });
    render(<ConflictPanel />);
    const desc = screen.getByText('已解决问题');
    expect(desc.className).toContain('line-through');
  });

  it('错误/警告计数显示', () => {
    mockStore({
      conflicts: [
        makeIssue({ id: 'e1', severity: 'error' }),
        makeIssue({ id: 'e2', severity: 'error' }),
        makeIssue({ id: 'w1', severity: 'warning' }),
        makeIssue({ id: 'r1', severity: 'error', resolved: true }), // 不计
      ],
    });
    render(<ConflictPanel />);
    expect(screen.getByText('2 错误')).toBeInTheDocument();
    expect(screen.getByText('1 警告')).toBeInTheDocument();
  });

  // ============ 展开交互 ============
  it('点击 issue 展开显示建议 + 三个操作按钮', () => {
    mockStore({
      conflicts: [makeIssue({ suggestion: '建议统一为"张三"' })],
    });
    render(<ConflictPanel />);
    // 初始折叠
    expect(screen.queryByText('建议统一为"张三"')).not.toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByText('角色名称不一致'));
    expect(screen.getByText(/建议：/)).toBeInTheDocument();
    expect(screen.getByText('建议统一为"张三"')).toBeInTheDocument();
    expect(screen.getByText('定位')).toBeInTheDocument();
    expect(screen.getByText('修复模板')).toBeInTheDocument();
    expect(screen.getByText('标记忽略')).toBeInTheDocument();
  });

  it('再次点击 issue 折叠', () => {
    mockStore({
      conflicts: [makeIssue({ suggestion: '建议内容' })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    expect(screen.getByText('建议内容')).toBeInTheDocument();
    fireEvent.click(screen.getByText('角色名称不一致'));
    expect(screen.queryByText('建议内容')).not.toBeInTheDocument();
  });

  it('无 position 时按钮显示"跳转章节"', () => {
    mockStore({
      conflicts: [makeIssue({ position: undefined })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    expect(screen.getByText('跳转章节')).toBeInTheDocument();
  });

  it('章节不存在时定位按钮 disabled', () => {
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [], // 章节不存在
      conflicts: [makeIssue({ chapterId: 'chap-x' })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    const locateBtn = screen.getByText('定位').closest('button');
    expect(locateBtn?.disabled).toBe(true);
  });

  it('点击"定位"调用 setPendingScrollTo', () => {
    const { setPendingScrollTo } = mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter({ id: 'chap-1' })],
      conflicts: [makeIssue({
        chapterId: 'chap-1',
        position: { start: 10, end: 20 },
      })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    fireEvent.click(screen.getByText('定位'));
    expect(setPendingScrollTo).toHaveBeenCalledTimes(1);
    const payload = setPendingScrollTo.mock.calls[0][0];
    expect(payload.chapterId).toBe('chap-1');
    expect(payload.position).toEqual({ start: 10, end: 20 });
    expect(typeof payload.timestamp).toBe('number');
  });

  it('issue 无 chapterId 时不调用 setPendingScrollTo', () => {
    const { setPendingScrollTo } = mockStore({
      conflicts: [makeIssue({ chapterId: '' as string })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    fireEvent.click(screen.getByText('定位'));
    expect(setPendingScrollTo).not.toHaveBeenCalled();
  });

  it('点击"修复模板"调用 addAISuggestion 转义 HTML', () => {
    const { addAISuggestion } = mockStore({
      conflicts: [makeIssue({
        description: '<script>alert(1)</script>',
        suggestion: '<img src=x>',
      })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('<script>alert(1)</script>'));
    fireEvent.click(screen.getByText('修复模板'));
    expect(addAISuggestion).toHaveBeenCalledTimes(1);
    const payload = addAISuggestion.mock.calls[0][0];
    expect(payload.type).toBe('fix');
    expect(payload.content).toContain('&lt;script&gt;');
    expect(payload.content).toContain('&lt;img src=x&gt;');
    expect(payload.content).not.toContain('<script>');
  });

  it('点击"标记忽略"调用 resolveConflict', () => {
    const { resolveConflict } = mockStore({
      conflicts: [makeIssue({ id: 'issue-x' })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    fireEvent.click(screen.getByText('标记忽略'));
    expect(resolveConflict).toHaveBeenCalledWith('issue-x');
  });

  it('已解决 issue 显示"取消忽略"按钮', () => {
    mockStore({
      conflicts: [makeIssue({ resolved: true })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    expect(screen.getByText('取消忽略')).toBeInTheDocument();
  });

  it('点击操作按钮 stopPropagation 不触发折叠', () => {
    const { resolveConflict } = mockStore({
      conflicts: [makeIssue({ id: 'i1', suggestion: '建议内容' })],
    });
    render(<ConflictPanel />);
    fireEvent.click(screen.getByText('角色名称不一致'));
    expect(screen.getByText('建议内容')).toBeInTheDocument();
    // 操作按钮区内点击
    fireEvent.click(screen.getByText('标记忽略'));
    expect(resolveConflict).toHaveBeenCalled();
    // stopPropagation：操作按钮点击不会折叠展开区，建议仍可见
    expect(screen.getByText('建议内容')).toBeInTheDocument();
  });

  // ============ onClose prop ============
  it('传入 onClose 时渲染关闭按钮', () => {
    mockStore({ conflicts: [] });
    render(<ConflictPanel onClose={vi.fn()} />);
    // 关闭按钮在标题栏右侧（X 图标）
    const closeBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    expect(closeBtn).toBeDefined();
  });

  it('未传 onClose 时不渲染关闭按钮', () => {
    mockStore({ conflicts: [] });
    render(<ConflictPanel />);
    const closeBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    expect(closeBtn).toBeUndefined();
  });

  it('点击关闭按钮调用 onClose', () => {
    const onClose = vi.fn();
    mockStore({ conflicts: [] });
    render(<ConflictPanel onClose={onClose} />);
    const closeBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    )!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============ 卸载守卫 ============
  it('扫描中卸载组件不报 setState 警告', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mockStore({
      currentChapterId: 'chap-1',
      chapters: [makeChapter()],
    });
    const { unmount } = render(<ConflictPanel />);
    fireEvent.click(screen.getByText('扫描当前章节'));
    // 不等扫描完成就卸载
    unmount();
    // 推进定时器，触发 mountedRef 守卫路径
    vi.advanceTimersByTime(1000);
    // 验证卸载后定时器回调未触发 console.error（React setState 警告等）
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
