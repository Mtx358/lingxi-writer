/**
 * SettingsPanel 单元测试
 *
 * 测试范围：
 *   - 空状态：渲染"还没有设定" + 提示
 *   - 添加分类：打开输入框 → 输入 → Enter/点击添加 → addSettingCategory
 *   - 分类展开/折叠
 *   - 添加设定条目：点击 + → 输入 → Enter → addSettingItem
 *   - 设定条目编辑器：点击条目进入编辑 → 保存/删除/取消
 *   - 分类计数显示
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import SettingsPanel from '@/components/editor/SettingsPanel';
import { useAppStore } from '@/store/useAppStore';
import type { SettingCategory, SettingItem } from '@/types';

// ============ fixtures ============
function makeCategory(overrides: Partial<SettingCategory> = {}): SettingCategory {
  return {
    id: 'cat-1',
    projectId: 'p1',
    name: '世界观',
    icon: 'globe',
    color: '#3b82f6',
    order: 0,
    parentId: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<SettingItem> = {}): SettingItem {
  return {
    id: 'item-1',
    projectId: 'p1',
    categoryId: 'cat-1',
    name: '魔法体系',
    description: '元素魔法',
    content: '基于元素的系统',
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
  settingCategories: SettingCategory[];
  settingItems: SettingItem[];
  addSettingCategory: ReturnType<typeof vi.fn>;
  addSettingItem: ReturnType<typeof vi.fn>;
  updateSettingItem: ReturnType<typeof vi.fn>;
  deleteSettingItem: ReturnType<typeof vi.fn>;
}> = {}) {
  const addSettingCategory = overrides.addSettingCategory || vi.fn();
  const addSettingItem = overrides.addSettingItem || vi.fn();
  const updateSettingItem = overrides.updateSettingItem || vi.fn();
  const deleteSettingItem = overrides.deleteSettingItem || vi.fn();

  useAppStore.setState({
    settingCategories: overrides.settingCategories ?? [],
    settingItems: overrides.settingItems ?? [],
    addSettingCategory,
    addSettingItem,
    updateSettingItem,
    deleteSettingItem,
  });

  return { addSettingCategory, addSettingItem, updateSettingItem, deleteSettingItem };
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  // ============ 空状态 ============
  it('无分类时渲染"还没有设定"空状态', () => {
    mockStore({ settingCategories: [] });
    render(<SettingsPanel />);
    expect(screen.getByText('还没有设定')).toBeInTheDocument();
    expect(screen.getByText('点击 + 添加第一个设定分类')).toBeInTheDocument();
  });

  it('标题"设定库"始终渲染', () => {
    mockStore();
    render(<SettingsPanel />);
    expect(screen.getByText('设定库')).toBeInTheDocument();
  });

  // ============ 添加分类 ============
  it('点击 + 按钮打开分类添加输入框', () => {
    mockStore({ settingCategories: [] });
    render(<SettingsPanel />);
    // header 内的 + 按钮（Plus 图标）
    const addBtn = screen.getByText('设定库').parentElement?.querySelector('button');
    expect(addBtn).toBeDefined();
    fireEvent.click(addBtn!);
    expect(screen.getByPlaceholderText('分类名称...')).toBeInTheDocument();
  });

  it('输入分类名 + Enter 调用 addSettingCategory', () => {
    const { addSettingCategory } = mockStore({ settingCategories: [] });
    render(<SettingsPanel />);
    const addBtn = screen.getByText('设定库').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    const input = screen.getByPlaceholderText('分类名称...');
    fireEvent.change(input, { target: { value: '地理' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addSettingCategory).toHaveBeenCalledWith('地理', 'folder');
  });

  it('输入分类名 + 点击"添加"按钮调用 addSettingCategory', () => {
    const { addSettingCategory } = mockStore({ settingCategories: [] });
    render(<SettingsPanel />);
    const addBtn = screen.getByText('设定库').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    const input = screen.getByPlaceholderText('分类名称...');
    fireEvent.change(input, { target: { value: '历史' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addSettingCategory).toHaveBeenCalledWith('历史', 'folder');
  });

  it('空分类名时不调用 addSettingCategory', () => {
    const { addSettingCategory } = mockStore({ settingCategories: [] });
    render(<SettingsPanel />);
    const addBtn = screen.getByText('设定库').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    fireEvent.click(screen.getByText('添加'));
    expect(addSettingCategory).not.toHaveBeenCalled();
  });

  it('点击"取消"关闭分类添加框', () => {
    mockStore({ settingCategories: [] });
    render(<SettingsPanel />);
    const addBtn = screen.getByText('设定库').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('分类名称...')).not.toBeInTheDocument();
  });

  // ============ 分类展开/折叠 ============
  it('渲染分类名与条目计数', () => {
    mockStore({
      settingCategories: [makeCategory()],
      settingItems: [
        makeItem({ id: 'i1', name: '魔法' }),
        makeItem({ id: 'i2', name: '种族' }),
      ],
    });
    render(<SettingsPanel />);
    expect(screen.getByText('世界观')).toBeInTheDocument();
    // 条目计数 "2"
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('点击分类名展开/折叠条目列表', () => {
    mockStore({
      settingCategories: [makeCategory()],
      settingItems: [makeItem({ name: '魔法体系' })],
    });
    render(<SettingsPanel />);
    // 第一个分类默认展开（expandedCat 初始化为 settingCategories[0]?.id）
    expect(screen.getByText('魔法体系')).toBeInTheDocument();
    // 点击分类名折叠
    fireEvent.click(screen.getByText('世界观'));
    expect(screen.queryByText('魔法体系')).not.toBeInTheDocument();
    // 再点击展开
    fireEvent.click(screen.getByText('世界观'));
    expect(screen.getByText('魔法体系')).toBeInTheDocument();
  });

  // ============ 添加设定条目 ============
  it('展开分类时显示"添加条目"按钮', () => {
    mockStore({
      settingCategories: [makeCategory()],
      settingItems: [],
    });
    render(<SettingsPanel />);
    expect(screen.getByText('添加条目')).toBeInTheDocument();
  });

  it('点击"添加条目"打开输入框，输入名称 + Enter 调用 addSettingItem', () => {
    const { addSettingItem } = mockStore({
      settingCategories: [makeCategory({ id: 'cat-x' })],
      settingItems: [],
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('添加条目'));
    const input = screen.getByPlaceholderText('名称...');
    fireEvent.change(input, { target: { value: '新设定' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addSettingItem).toHaveBeenCalledWith('cat-x', '新设定');
  });

  it('空名称时不调用 addSettingItem', () => {
    const { addSettingItem } = mockStore({
      settingCategories: [makeCategory()],
      settingItems: [],
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('添加条目'));
    fireEvent.keyDown(screen.getByPlaceholderText('名称...'), { key: 'Enter' });
    expect(addSettingItem).not.toHaveBeenCalled();
  });

  // ============ 设定条目编辑 ============
  it('点击设定条目进入编辑模式', () => {
    mockStore({
      settingCategories: [makeCategory()],
      settingItems: [makeItem({ name: '魔法体系', description: '元素魔法', content: '详细内容' })],
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('魔法体系'));
    // 编辑模式下应有名称/详情/内容输入框
    expect(screen.getByDisplayValue('魔法体系')).toBeInTheDocument();
    expect(screen.getByDisplayValue('元素魔法')).toBeInTheDocument();
    expect(screen.getByDisplayValue('详细内容')).toBeInTheDocument();
  });

  it('编辑模式下点击"保存"调用 updateSettingItem 并退出编辑', () => {
    const { updateSettingItem } = mockStore({
      settingCategories: [makeCategory()],
      settingItems: [makeItem({ id: 'item-edit', name: '魔法', description: '旧描述', content: '旧内容' })],
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('魔法'));
    // 修改名称
    fireEvent.change(screen.getByDisplayValue('魔法'), { target: { value: '新魔法' } });
    fireEvent.click(screen.getByText('保存'));
    expect(updateSettingItem).toHaveBeenCalledWith('item-edit', {
      name: '新魔法',
      description: '旧描述',
      content: '旧内容',
    });
  });

  it('编辑模式下点击"删除" + confirm true 调用 deleteSettingItem', async () => {
    const { deleteSettingItem } = mockStore({
      settingCategories: [makeCategory()],
      settingItems: [makeItem({ id: 'item-del', name: '要删除的设定' })],
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('要删除的设定'));
    fireEvent.click(screen.getByText('删除'));
    expect(confirmMock).toHaveBeenCalled();
    await waitFor(() => expect(deleteSettingItem).toHaveBeenCalledWith('item-del'));
  });

  it('编辑模式下点击"取消"退出编辑不调用 updateSettingItem', () => {
    const { updateSettingItem } = mockStore({
      settingCategories: [makeCategory()],
      settingItems: [makeItem({ name: '魔法' })],
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('魔法'));
    fireEvent.click(screen.getByText('取消'));
    expect(updateSettingItem).not.toHaveBeenCalled();
    // 退出编辑后应回到列表显示
    expect(screen.getByText('魔法')).toBeInTheDocument();
  });

  // ============ 多分类 ============
  it('多个分类只展开一个（手风琴模式）', () => {
    mockStore({
      settingCategories: [
        makeCategory({ id: 'cat-1', name: '世界观' }),
        makeCategory({ id: 'cat-2', name: '人物' }),
      ],
      settingItems: [
        makeItem({ id: 'i1', categoryId: 'cat-1', name: '魔法' }),
        makeItem({ id: 'i2', categoryId: 'cat-2', name: '主角' }),
      ],
    });
    render(<SettingsPanel />);
    // 默认展开第一个
    expect(screen.getByText('魔法')).toBeInTheDocument();
    // 点击第二个分类
    fireEvent.click(screen.getByText('人物'));
    expect(screen.getByText('主角')).toBeInTheDocument();
    // 第一个应折叠
    expect(screen.queryByText('魔法')).not.toBeInTheDocument();
  });

  it('设定条目显示 description（若有）', () => {
    mockStore({
      settingCategories: [makeCategory()],
      settingItems: [makeItem({ name: '魔法', description: '元素系' })],
    });
    render(<SettingsPanel />);
    expect(screen.getByText('元素系')).toBeInTheDocument();
  });

  // ============ withAlpha 颜色转换（通过渲染间接验证各分支） ============
  // withAlpha 未导出，组件内以 withAlpha(cat.color, 0.19) 作为分类图标 div 的
  // backgroundColor。此处渲染单一分类，取首字母 span 的父节点读取 backgroundColor。
  describe('withAlpha 颜色转换', () => {
    function renderCategoryIcon(color: string | undefined, letter = 'Q'): HTMLElement {
      mockStore({
        settingCategories: [makeCategory({ id: 'c1', name: letter + 'cat', color: color as string })],
        settingItems: [],
      });
      render(<SettingsPanel />);
      return screen.getByText(letter).parentElement as HTMLElement;
    }

    it('6 位 hex 转为 rgba(r, g, b, alpha)', () => {
      const icon = renderCategoryIcon('#3b82f6');
      expect(icon.style.backgroundColor).toBe('rgba(59, 130, 246, 0.19)');
    });

    it('3 位 hex 扩展为 6 位后转为 rgba', () => {
      const icon = renderCategoryIcon('#abc');
      expect(icon.style.backgroundColor).toBe('rgba(170, 187, 204, 0.19)');
    });

    it('rgb() 函数色通过 DOM 解析后附加 alpha', () => {
      const icon = renderCategoryIcon('rgb(1, 2, 3)');
      expect(icon.style.backgroundColor).toBe('rgba(1, 2, 3, 0.19)');
    });

    it('命名色 red 通过 DOM 解析为 rgb(255, 0, 0) 后附加 alpha', () => {
      const icon = renderCategoryIcon('red');
      expect(icon.style.backgroundColor).toBe('rgba(255, 0, 0, 0.19)');
    });

    it('空字符串返回 transparent', () => {
      const icon = renderCategoryIcon('');
      expect(icon.style.backgroundColor).toBe('transparent');
    });

    it('undefined 返回 transparent', () => {
      const icon = renderCategoryIcon(undefined);
      expect(icon.style.backgroundColor).toBe('transparent');
    });

    it('无效输入回退到透明色（jsdom 下可能为黑透明，二者均接受）', () => {
      const icon = renderCategoryIcon('not-a-color');
      expect(icon.style.backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\.19\))$/);
    });
  });

  // ============ SettingItemEditor 保存 onDone / 删除 confirm 取消 ============
  describe('SettingItemEditor 保存与删除', () => {
    it('保存后调用 updateSettingItem 并退出编辑模式（onDone 触发）', () => {
      const { updateSettingItem } = mockStore({
        settingCategories: [makeCategory()],
        settingItems: [makeItem({ id: 'item-edit', name: '魔法', description: '旧描述', content: '旧内容' })],
      });
      render(<SettingsPanel />);
      fireEvent.click(screen.getByText('魔法'));
      fireEvent.change(screen.getByDisplayValue('魔法'), { target: { value: '新魔法' } });
      fireEvent.click(screen.getByText('保存'));
      expect(updateSettingItem).toHaveBeenCalledWith('item-edit', {
        name: '新魔法',
        description: '旧描述',
        content: '旧内容',
      });
      // onDone 触发：退出编辑，编辑器按钮消失
      expect(screen.queryByText('保存')).not.toBeInTheDocument();
      expect(screen.queryByText('删除')).not.toBeInTheDocument();
    });

    it('删除时 confirm 返回 false 不调用 deleteSettingItem 且保持编辑模式', () => {
      const { deleteSettingItem } = mockStore({
        settingCategories: [makeCategory()],
        settingItems: [makeItem({ id: 'item-del', name: '要删除的设定' })],
      });
      confirmMock.mockResolvedValue(false);
      render(<SettingsPanel />);
      fireEvent.click(screen.getByText('要删除的设定'));
      fireEvent.click(screen.getByText('删除'));
      expect(confirmMock).toHaveBeenCalled();
      expect(deleteSettingItem).not.toHaveBeenCalled();
      // 仍在编辑模式
      expect(screen.getByText('删除')).toBeInTheDocument();
      expect(screen.getByText('保存')).toBeInTheDocument();
    });

    it('删除时 confirm 返回 true 调用 deleteSettingItem 并退出编辑模式（onDone 触发）', async () => {
      const { deleteSettingItem } = mockStore({
        settingCategories: [makeCategory()],
        settingItems: [makeItem({ id: 'item-del2', name: '删除项' })],
      });
      // beforeEach 默认 confirm 返回 true
      render(<SettingsPanel />);
      fireEvent.click(screen.getByText('删除项'));
      fireEvent.click(screen.getByText('删除'));
      await waitFor(() => expect(deleteSettingItem).toHaveBeenCalledWith('item-del2'));
      // onDone 触发：退出编辑
      expect(screen.queryByText('删除')).not.toBeInTheDocument();
    });
  });

  // ============ 添加条目输入框 onBlur 两个分支 ============
  describe('添加条目输入框 onBlur', () => {
    it('有内容时 blur 触发提交（调用 addSettingItem 并关闭输入框）', () => {
      const { addSettingItem } = mockStore({
        settingCategories: [makeCategory({ id: 'cat-blur' })],
        settingItems: [],
      });
      render(<SettingsPanel />);
      fireEvent.click(screen.getByText('添加条目'));
      const input = screen.getByPlaceholderText('名称...');
      fireEvent.change(input, { target: { value: '新设定' } });
      fireEvent.blur(input);
      expect(addSettingItem).toHaveBeenCalledWith('cat-blur', '新设定');
      expect(screen.queryByPlaceholderText('名称...')).not.toBeInTheDocument();
    });

    it('无内容时 blur 取消（不调用 addSettingItem 且关闭输入框）', () => {
      const { addSettingItem } = mockStore({
        settingCategories: [makeCategory({ id: 'cat-blur2' })],
        settingItems: [],
      });
      render(<SettingsPanel />);
      fireEvent.click(screen.getByText('添加条目'));
      const input = screen.getByPlaceholderText('名称...');
      fireEvent.blur(input);
      expect(addSettingItem).not.toHaveBeenCalled();
      // addingItemTo 置空，输入框消失
      expect(screen.queryByPlaceholderText('名称...')).not.toBeInTheDocument();
    });
  });
});
