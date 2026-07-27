/**
 * SearchModal 单元测试
 *
 * 测试范围：
 *   - 空查询渲染"输入关键词开始搜索"提示
 *   - 无结果渲染"没有找到相关结果"
 *   - 有结果时按 type 分组渲染（每组最多 5 条）
 *   - 输入触发 search() 调用 + 选中重置
 *   - 点击结果根据 type 调用对应面板切换函数
 *   - 键盘导航 ArrowDown/ArrowUp/Enter/Esc
 *   - 选中项变更触发滚动到可视区
 *   - 遮罩点击 / X 按钮调用 onClose
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SearchModal from '@/components/SearchModal';
import { useAppStore } from '@/store/useAppStore';
import type { SearchEntry } from '@/store/appState';

// ============ fixtures ============
function makeEntry(overrides: Partial<SearchEntry> = {}): SearchEntry {
  return {
    type: 'chapter',
    id: 'e1',
    title: '测试条目',
    preview: '预览内容',
    matchCount: 1,
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  searchResults: SearchEntry[];
  search: ReturnType<typeof vi.fn>;
  setCurrentChapter: ReturnType<typeof vi.fn>;
  setRightPanelTab: ReturnType<typeof vi.fn>;
  setRightPanelCollapsed: ReturnType<typeof vi.fn>;
}> = {}) {
  const search = overrides.search || vi.fn();
  const setCurrentChapter = overrides.setCurrentChapter || vi.fn();
  const setRightPanelTab = overrides.setRightPanelTab || vi.fn();
  const setRightPanelCollapsed = overrides.setRightPanelCollapsed || vi.fn();

  useAppStore.setState({
    searchResults: overrides.searchResults ?? [],
    search,
    setCurrentChapter,
    setRightPanelTab,
    setRightPanelCollapsed,
  });

  return { search, setCurrentChapter, setRightPanelTab, setRightPanelCollapsed };
}

describe('SearchModal', () => {
  let originalScrollIntoView: Element['scrollIntoView'];

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    cleanup();
  });

  // ============ 初始状态 ============
  it('空查询渲染"输入关键词开始搜索"提示', () => {
    mockStore({ searchResults: [] });
    render(<SearchModal onClose={vi.fn()} />);
    expect(screen.getByText('输入关键词开始搜索')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...')).toBeInTheDocument();
  });

  it('无结果时渲染"没有找到相关结果"', () => {
    mockStore({ searchResults: [] });
    render(<SearchModal onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '不存在的关键词' } });
    expect(screen.getByText('没有找到相关结果')).toBeInTheDocument();
  });

  // ============ 渲染结果 ============
  it('有结果时按 type 分组渲染', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'character', id: 'char1', title: '主角' }),
        makeEntry({ type: 'setting', id: 's1', title: '世界观' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '一' } });
    expect(screen.getByText('第一章')).toBeInTheDocument();
    expect(screen.getByText('主角')).toBeInTheDocument();
    expect(screen.getByText('世界观')).toBeInTheDocument();
    // 分组标签
    expect(screen.getByText('章节')).toBeInTheDocument();
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('设定')).toBeInTheDocument();
  });

  it('每个分组最多显示 5 条', () => {
    const entries: SearchEntry[] = Array.from({ length: 7 }, (_, i) =>
      makeEntry({ type: 'chapter', id: `c${i}`, title: `章节${i}` })
    );
    mockStore({ searchResults: entries });
    render(<SearchModal onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '章' } });
    // 前 5 条出现
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`章节${i}`)).toBeInTheDocument();
    }
    // 第 6、7 条不出现
    expect(screen.queryByText('章节5')).not.toBeInTheDocument();
    expect(screen.queryByText('章节6')).not.toBeInTheDocument();
    // totalCount 显示原始数量
    expect(screen.getByText('(7)')).toBeInTheDocument();
  });

  it('预览文本展示', () => {
    mockStore({
      searchResults: [makeEntry({ preview: '这是预览文本' })],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '测试' },
    });
    expect(screen.getByText('这是预览文本')).toBeInTheDocument();
  });

  // ============ 输入交互 ============
  it('输入触发 search 调用', () => {
    const search = vi.fn();
    mockStore({ search });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '关键词' },
    });
    expect(search).toHaveBeenCalledWith('关键词');
  });

  it('渲染结果数显示在 footer', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'character', id: 'char1', title: '主角' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '一' },
    });
    expect(screen.getByText('找到 2 个结果')).toBeInTheDocument();
  });

  // ============ 点击结果 ============
  it('点击 chapter 结果调用 setCurrentChapter + onClose', () => {
    const onClose = vi.fn();
    const { setCurrentChapter, setRightPanelTab, setRightPanelCollapsed } = mockStore({
      searchResults: [makeEntry({ type: 'chapter', id: 'chap-1', title: '第一章' })],
    });
    render(<SearchModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '一' },
    });
    fireEvent.click(screen.getByText('第一章'));
    expect(setCurrentChapter).toHaveBeenCalledWith('chap-1');
    expect(setRightPanelTab).not.toHaveBeenCalled();
    expect(setRightPanelCollapsed).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击 character 结果切换到 characters 面板', () => {
    const onClose = vi.fn();
    const { setRightPanelTab, setRightPanelCollapsed } = mockStore({
      searchResults: [makeEntry({ type: 'character', id: 'char-1', title: '主角' })],
    });
    render(<SearchModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '主' },
    });
    fireEvent.click(screen.getByText('主角'));
    expect(setRightPanelTab).toHaveBeenCalledWith('characters');
    expect(setRightPanelCollapsed).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击 setting 结果切换到 settings 面板', () => {
    const { setRightPanelTab } = mockStore({
      searchResults: [makeEntry({ type: 'setting', id: 's-1', title: '世界观' })],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '世' },
    });
    fireEvent.click(screen.getByText('世界观'));
    expect(setRightPanelTab).toHaveBeenCalledWith('settings');
  });

  it('点击 foreshadow 结果切换到 foreshadows 面板', () => {
    const { setRightPanelTab } = mockStore({
      searchResults: [makeEntry({ type: 'foreshadow', id: 'f-1', title: '伏笔1' })],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '伏' },
    });
    fireEvent.click(screen.getByText('伏笔1'));
    expect(setRightPanelTab).toHaveBeenCalledWith('foreshadows');
  });

  it('点击 material 结果切换到 materials 面板', () => {
    const { setRightPanelTab } = mockStore({
      searchResults: [makeEntry({ type: 'material', id: 'm-1', title: '素材1' })],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '素' },
    });
    fireEvent.click(screen.getByText('素材1'));
    expect(setRightPanelTab).toHaveBeenCalledWith('materials');
  });

  // ============ 关闭交互 ============
  it('点击 X 按钮调用 onClose', () => {
    const onClose = vi.fn();
    mockStore({ searchResults: [] });
    render(<SearchModal onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭搜索'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩调用 onClose', () => {
    const onClose = vi.fn();
    mockStore({ searchResults: [] });
    render(<SearchModal onClose={onClose} />);
    // 遮罩是外层 fixed inset-0 div
    const overlay = document.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击结果卡片 stopPropagation 不触发遮罩 onClose', () => {
    const onClose = vi.fn();
    mockStore({
      searchResults: [makeEntry({ type: 'chapter', id: 'c1', title: '第一章' })],
    });
    render(<SearchModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '一' },
    });
    fireEvent.click(screen.getByText('第一章'));
    // 点击结果会触发自身的 onClose（成功跳转），但不会因 stopPropagation 失败而重复
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============ 键盘导航 ============
  it('ArrowDown 向下移动选中项', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'chapter', id: 'c2', title: '第二章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '章' } });
    // 初始 selectedIndex=0 → 第一章被选中
    expect(screen.getByText('第一章').closest('button')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('第二章').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUp 向上移动选中项', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'chapter', id: 'c2', title: '第二章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '章' },
    });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByText('第一章').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown 在末尾不再前进', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '章' },
    });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // 仍在第一项
    expect(screen.getByText('第一章').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter 在选中项上触发点击跳转', () => {
    const onClose = vi.fn();
    const { setCurrentChapter } = mockStore({
      searchResults: [makeEntry({ type: 'chapter', id: 'chap-x', title: '第一章' })],
    });
    render(<SearchModal onClose={onClose} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '章' } });
    // input 仍为 activeElement
    input.focus();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(setCurrentChapter).toHaveBeenCalledWith('chap-x');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc 调用 onClose', () => {
    const onClose = vi.fn();
    mockStore({ searchResults: [] });
    render(<SearchModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('输入法组合状态不触发键盘导航', () => {
    mockStore({
      searchResults: [makeEntry({ type: 'chapter', id: 'c1', title: '第一章' })],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '一' },
    });
    // isComposing=true 时 ArrowDown 应被忽略
    fireEvent.keyDown(window, { key: 'ArrowDown', isComposing: true });
    expect(screen.getByText('第一章').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  // ============ 选中项滚动 ============
  it('选中项变更触发 scrollIntoView', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'chapter', id: 'c2', title: '第二章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '章' },
    });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('鼠标悬停切换选中项', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'chapter', id: 'c2', title: '第二章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...'), {
      target: { value: '章' },
    });
    fireEvent.mouseEnter(screen.getByText('第二章'));
    expect(screen.getByText('第二章').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  // ============ 输入重置选中项 ============
  it('输入变化时重置选中项到第一项', () => {
    mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'chapter', id: 'c2', title: '第二章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '章' } });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // 已移到第二项
    expect(screen.getByText('第二章').closest('button')).toHaveAttribute('aria-selected', 'true');
    // 重新输入重置选中
    fireEvent.change(input, { target: { value: '章一' } });
    expect(screen.getByText('第一章').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  // ============ 列表收缩时 clamp ============
  it('列表变短时 clamp 选中项到 0', async () => {
    const { search } = mockStore({
      searchResults: [
        makeEntry({ type: 'chapter', id: 'c1', title: '第一章' }),
        makeEntry({ type: 'chapter', id: 'c2', title: '第二章' }),
        makeEntry({ type: 'chapter', id: 'c3', title: '第三章' }),
      ],
    });
    render(<SearchModal onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('搜索章节、角色、设定、伏笔、素材...');
    fireEvent.change(input, { target: { value: '章' } });
    // 移动到第三项
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('第三章').closest('button')).toHaveAttribute('aria-selected', 'true');
    // 模拟搜索结果变短到只剩 1 条
    useAppStore.setState({
      searchResults: [makeEntry({ type: 'chapter', id: 'c1', title: '第一章' })],
    });
    // 选中项应被 clamp 到 0
    await waitFor(() => {
      expect(screen.getByText('第一章').closest('button')).toHaveAttribute('aria-selected', 'true');
    });
    void search;
  });

  // ============ a11y ============
  it('dialog 有正确的 aria-label', () => {
    mockStore({ searchResults: [] });
    render(<SearchModal onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', '全局搜索');
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', '搜索结果');
  });
});
