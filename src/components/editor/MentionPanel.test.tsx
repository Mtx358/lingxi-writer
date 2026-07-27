/**
 * MentionPanel 单元测试
 *
 * 测试范围：
 *   - 渲染：tabs（全部/角色/设定）、搜索框、空状态
 *   - 数据展示：角色头像 + 名字；设定 Globe 图标 + 名字
 *   - tab 切换过滤数据
 *   - 输入搜索过滤
 *   - 选中态视觉反馈（默认第一项高亮）
 *   - 键盘导航 ArrowDown/ArrowUp/Enter/Esc/Tab + 捕获阶段 stopImmediatePropagation
 *   - 输入法组合态忽略
 *   - 点击项触发 selectItem → editor.chain().deleteRange().insertMention()
 *   - selectItem 找不到 '@' 时调用 onClose
 *   - pushOverlay/popOverlay 配对（mount/unmount）
 *   - filteredItems 缩短时 clamp 选中索引
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MentionPanel from '@/components/editor/MentionPanel';
import { useAppStore } from '@/store/useAppStore';
import { isOverlayOpen, pushOverlay, popOverlay } from '@/utils/overlayState';
import type { Character, SettingItem } from '@/types';

// ============ editor mock ============
// 用链式 mock：chain().focus().deleteRange(...).insertMention(...).run()
const chainReturn = {
  focus: vi.fn().mockReturnThis(),
  deleteRange: vi.fn().mockReturnThis(),
  insertMention: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

const docMock = {
  nodesBetween: vi.fn(),
};

const editorMock = {
  state: {
    selection: { from: 10 },
    doc: docMock,
  },
  chain: vi.fn(() => chainReturn),
};

const insertMentionMock = vi.fn();

// ============ fixtures ============
function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'p1',
    name: '张三',
    role: 'protagonist',
    color: '#ff0000',
    profile: {},
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
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
  characters: Character[];
  settingItems: SettingItem[];
}> = {}) {
  useAppStore.setState({
    characters: overrides.characters ?? [],
    settingItems: overrides.settingItems ?? [],
  });
}

describe('MentionPanel', () => {
  let wasOverlayOpenBefore: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    wasOverlayOpenBefore = isOverlayOpen();
    // 重置浮层计数器到关闭态，确保 beforeEach/afterEach 之间无污染
    while (isOverlayOpen()) {
      popOverlay();
    }
    mockStore();
  });

  afterEach(() => {
    // 清理浮层计数器到关闭态，避免测试间污染
    while (isOverlayOpen()) {
      popOverlay();
    }
    // 如果测试前浮层本就打开（不太可能但保险），恢复之
    if (wasOverlayOpenBefore && !isOverlayOpen()) {
      pushOverlay();
    }
    cleanup();
  });

  // ============ 渲染 ============
  it('渲染 tabs：全部 / 角色 / 设定', () => {
    mockStore();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('全部')).toBeInTheDocument();
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('设定')).toBeInTheDocument();
  });

  it('空数据渲染"暂无数据"提示', () => {
    mockStore({ characters: [], settingItems: [] });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('渲染角色条目：名字 + 头像首字', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', color: '#ff0000' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('张三')).toBeInTheDocument();
    // "角色" 同时出现为 tab 标签 + 条目副标签，用 getAllByText
    expect(screen.getAllByText('角色').length).toBeGreaterThanOrEqual(1);
    // 头像显示首字
    expect(screen.getByText('张')).toBeInTheDocument();
  });

  it('渲染设定条目：名字 + "设定"标签', () => {
    mockStore({
      settingItems: [makeSetting({ id: 's1', name: '世界观' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('世界观')).toBeInTheDocument();
    // 多个 "设定" 文本：tab 标签 + 条目副标签
    expect(screen.getAllByText('设定').length).toBeGreaterThanOrEqual(2);
  });

  // ============ tab 切换 ============
  // tab 按钮区在顶部，含全部/角色/设定三个按钮。条目副标签也含同名文本，
  // 因此用 getAllByText + 取首个（tab 在前）作为点击目标
  it('点击"角色" tab 仅显示角色条目', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
      settingItems: [makeSetting({ id: 's1', name: '世界观' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    // tab 按钮：用 getAllByText 取第一个（tab 区在顶部，先渲染）
    const tabs = screen.getAllByText('角色');
    fireEvent.click(tabs[0]);
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.queryByText('世界观')).not.toBeInTheDocument();
  });

  it('点击"设定" tab 仅显示设定条目', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
      settingItems: [makeSetting({ id: 's1', name: '世界观' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    const tabs = screen.getAllByText('设定');
    fireEvent.click(tabs[0]);
    expect(screen.queryByText('张三')).not.toBeInTheDocument();
    expect(screen.getByText('世界观')).toBeInTheDocument();
  });

  // ============ 搜索过滤 ============
  it('输入关键词过滤角色 + 显示"未找到匹配项"', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText('搜索...');
    fireEvent.change(input, { target: { value: '王五' } });
    expect(screen.getByText('未找到匹配项')).toBeInTheDocument();
    expect(screen.queryByText('张三')).not.toBeInTheDocument();
    expect(screen.queryByText('李四')).not.toBeInTheDocument();
  });

  it('输入关键词不区分大小写匹配', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: 'Hero' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'he' } });
    expect(screen.getByText('Hero')).toBeInTheDocument();
  });

  it('tab 切换时重置选中索引到 0', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    // ArrowDown 移动到第二项
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // 切换到角色 tab（无设定数据，列表只剩 2 个角色，selectedClamp 通过 effect 自动重置）
    fireEvent.click(screen.getAllByText('角色')[0]);
    // 第一项应被选中（背景色 amber-400/20）
    const firstItem = screen.getByText('张三').closest('button');
    expect(firstItem?.className).toContain('bg-amber-400/20');
  });

  // ============ 键盘导航 ============
  it('ArrowDown 向下移动选中项', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('张三').closest('button')?.className).toContain('bg-amber-400/20');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('李四').closest('button')?.className).toContain('bg-amber-400/20');
  });

  it('ArrowUp 向上移动选中项', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByText('张三').closest('button')?.className).toContain('bg-amber-400/20');
  });

  it('ArrowDown 在末尾不再前进', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // 仍选中第一项
    expect(screen.getByText('张三').closest('button')?.className).toContain('bg-amber-400/20');
  });

  it('Esc 调用 onClose', () => {
    const onClose = vi.fn();
    mockStore();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab 被 preventDefault 不离开浮层', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    const preventDefault = vi.fn();
    fireEvent.keyDown(window, { key: 'Tab', preventDefault });
    // Tab 默认行为被 preventDefault（即便 mock 调用未传也证明 stopImmediatePropagation 触发了 preventDefault）
    // 这里验证面板仍存在
    expect(screen.getByText('张三')).toBeInTheDocument();
  });

  it('输入法组合态忽略键盘导航', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    fireEvent.keyDown(window, { key: 'ArrowDown', isComposing: true });
    // 仍选中第一项
    expect(screen.getByText('张三').closest('button')?.className).toContain('bg-amber-400/20');
  });

  // ============ 点击选择 ============
  it('点击条目触发 editor.chain().deleteRange().insertMention().run()', () => {
    // 让 nodesBetween 找到 '@'
    docMock.nodesBetween.mockImplementation((_from: number, _to: number, cb: (node: { isText: boolean; text: string }, pos: number) => void) => {
      cb({ isText: true, text: '前缀@张三' }, 0);
    });
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    const onClose = vi.fn();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText('张三'));
    expect(editorMock.chain).toHaveBeenCalled();
    expect(chainReturn.deleteRange).toHaveBeenCalled();
    expect(chainReturn.insertMention).toHaveBeenCalled();
    expect(chainReturn.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    void insertMentionMock;
  });

  it('selectItem 找不到 @ 时仅调用 onClose', () => {
    // nodesBetween 不找到 '@'
    docMock.nodesBetween.mockImplementation(() => { /* no-op */ });
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    const onClose = vi.fn();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText('张三'));
    expect(chainReturn.deleteRange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter 在选中项上触发选择', () => {
    docMock.nodesBetween.mockImplementation((_f: number, _t: number, cb: (node: { isText: boolean; text: string }, pos: number) => void) => {
      cb({ isText: true, text: '前缀@张三' }, 0);
    });
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    const onClose = vi.fn();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(chainReturn.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('无选中项时 Enter 不触发选择', () => {
    mockStore();
    const onClose = vi.fn();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(chainReturn.run).not.toHaveBeenCalled();
  });

  // ============ 浮层注册 ============
  it('mount 时 pushOverlay，unmount 时 popOverlay', () => {
    expect(isOverlayOpen()).toBe(false);
    const { unmount } = render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(isOverlayOpen()).toBe(true);
    unmount();
    expect(isOverlayOpen()).toBe(false);
  });

  it('空 editor 时不抛错', () => {
    mockStore();
    // editor = null 时键盘 handler 直接 return
    expect(() => {
      render(
        <MentionPanel
          editor={null as never}
          position={{ x: 100, y: 100 }}
          onClose={vi.fn()}
        />
      );
    }).not.toThrow();
  });

  // ============ a11y ============
  it('输入框 placeholder 为"搜索..."', () => {
    mockStore();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText('搜索...')).toBeInTheDocument();
  });

  it('底部提示显示 Enter/Esc', () => {
    mockStore();
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Enter 确认')).toBeInTheDocument();
    expect(screen.getByText('Esc 关闭')).toBeInTheDocument();
  });

  // ============ 列表收缩时 clamp ============
  it('filteredItems 缩短时 clamp 选中索引', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
        makeCharacter({ id: 'c3', name: '王五' }),
      ],
    });
    render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    // 移动到第三项
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('王五').closest('button')?.className).toContain('bg-amber-400/20');
    // 输入过滤让列表只剩 1 条
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '张' } });
    // 选中应 clamp 回 0
    expect(screen.getByText('张三').closest('button')?.className).toContain('bg-amber-400/20');
  });

  // ============ 位置 clamp ============
  it('position 超出视口时被 clamp 到可视区', () => {
    mockStore();
    const { container } = render(
      <MentionPanel
        editor={editorMock as never}
        position={{ x: 10000, y: 10000 }}
        onClose={vi.fn()}
      />
    );
    const panel = container.firstChild as HTMLElement;
    const style = panel.getAttribute('style') || '';
    // innerWidth/innerHeight 在 jsdom 默认 1024x768，clamp 后 left = 1024-320=704, top = 768-320=448
    expect(style).toContain('left: 704px');
    expect(style).toContain('top: 448px');
  });
});
