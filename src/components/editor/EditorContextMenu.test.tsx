/**
 * EditorContextMenu 单元测试
 *
 * 测试范围：
 *   - 渲染 7 个菜单项：撤销/重做/加粗/斜体/高亮/标记为伏笔/插入@提及
 *   - 撤销/重做 disabled 状态跟随 editor.can().undo()/redo()
 *   - 点击撤销/重做/加粗/斜体/高亮 → 触发对应 editor.chain 命令并 onClose
 *   - 点击 "标记为伏笔" → 调用 onMarkAsForeshadow
 *   - 点击 "插入@提及" → 调用 onInsertMention
 *   - 点击透明遮罩 → onClose
 *   - 按 Esc → onClose
 *   - isComposing 期间 Esc 不关闭
 *   - mount/unmount 配对调用 pushOverlay/popOverlay
 *   - 菜单定位做视口右下边距 clamp
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EditorContextMenu from '@/components/editor/EditorContextMenu';
import { isOverlayOpen } from '@/utils/overlayState';

// ============ 构造 mock editor ============
// 编辑器命令链：chain().focus().<cmd>().run()
// boundChain 各方法 push 命令名到 callLog 后返回自身，实现链式调用与调用记录
function createMockEditor(canUndo = true, canRedo = false) {
  const callLog: string[] = [];
  const boundChain: {
    focus: () => typeof boundChain;
    undo: () => typeof boundChain;
    redo: () => typeof boundChain;
    toggleBold: () => typeof boundChain;
    toggleItalic: () => typeof boundChain;
    toggleHighlight: () => typeof boundChain;
    run: () => boolean;
  } = {} as never;

  boundChain.focus = () => {
    callLog.push('focus');
    return boundChain;
  };
  boundChain.undo = () => {
    callLog.push('undo');
    return boundChain;
  };
  boundChain.redo = () => {
    callLog.push('redo');
    return boundChain;
  };
  boundChain.toggleBold = () => {
    callLog.push('toggleBold');
    return boundChain;
  };
  boundChain.toggleItalic = () => {
    callLog.push('toggleItalic');
    return boundChain;
  };
  boundChain.toggleHighlight = () => {
    callLog.push('toggleHighlight');
    return boundChain;
  };
  boundChain.run = () => true;

  const editor = {
    chain: vi.fn(() => boundChain),
    can: vi.fn(() => ({
      undo: () => canUndo,
      redo: () => canRedo,
    })),
  };

  return { editor, callLog, boundChain };
}

describe('EditorContextMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('渲染全部 7 个菜单项', () => {
    const { editor } = createMockEditor();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('重做')).toBeInTheDocument();
    expect(screen.getByText('加粗')).toBeInTheDocument();
    expect(screen.getByText('斜体')).toBeInTheDocument();
    expect(screen.getByText('高亮')).toBeInTheDocument();
    expect(screen.getByText('标记为伏笔')).toBeInTheDocument();
    expect(screen.getByText('插入@提及')).toBeInTheDocument();
  });

  it('editor.can().undo()=false 时撤销按钮 disabled', () => {
    const { editor } = createMockEditor(false, false);
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    expect(screen.getByText('撤销')).toBeDisabled();
    expect(screen.getByText('重做')).toBeDisabled();
  });

  it('editor.can().undo()=true 时撤销按钮可点', () => {
    const { editor } = createMockEditor(true, true);
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    expect(screen.getByText('撤销')).not.toBeDisabled();
    expect(screen.getByText('重做')).not.toBeDisabled();
  });

  it('点击撤销 → editor.chain().focus().undo().run() + onClose', () => {
    const { editor, callLog } = createMockEditor(true, false);
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('撤销'));
    expect(callLog).toContain('focus');
    expect(callLog).toContain('undo');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击重做 → editor.chain().focus().redo().run() + onClose', () => {
    const { editor, callLog } = createMockEditor(false, true);
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('重做'));
    expect(callLog).toContain('redo');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击加粗 → toggleBold + onClose', () => {
    const { editor, callLog } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('加粗'));
    expect(callLog).toContain('toggleBold');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击斜体 → toggleItalic + onClose', () => {
    const { editor, callLog } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('斜体'));
    expect(callLog).toContain('toggleItalic');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击高亮 → toggleHighlight + onClose', () => {
    const { editor, callLog } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('高亮'));
    expect(callLog).toContain('toggleHighlight');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击 "标记为伏笔" → 调用 onMarkAsForeshadow', () => {
    const { editor } = createMockEditor();
    const onMarkAsForeshadow = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={onMarkAsForeshadow}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('标记为伏笔'));
    expect(onMarkAsForeshadow).toHaveBeenCalledTimes(1);
  });

  it('点击 "插入@提及" → 调用 onInsertMention', () => {
    const { editor } = createMockEditor();
    const onInsertMention = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={onInsertMention}
      />,
    );
    fireEvent.click(screen.getByText('插入@提及'));
    expect(onInsertMention).toHaveBeenCalledTimes(1);
  });

  it('点击透明遮罩 → onClose', () => {
    const { editor } = createMockEditor();
    const onClose = vi.fn();
    const { container } = render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    // 透明遮罩是第一个 fixed inset-0 z-40 的 div
    const overlay = container.querySelector('.fixed.inset-0.z-40') as HTMLElement;
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('按 Esc → onClose', () => {
    const { editor } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('isComposing=true 时 Esc 不关闭', () => {
    const { editor } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keyCode 229（输入法合成）时 Esc 不关闭', () => {
    const { editor } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape', keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('非 Escape 按键不触发 onClose', () => {
    const { editor } = createMockEditor();
    const onClose = vi.fn();
    render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mount 时 pushOverlay，unmount 时 popOverlay', () => {
    const { editor } = createMockEditor();
    // 渲染前 overlay 关闭
    expect(isOverlayOpen()).toBe(false);
    const { unmount } = render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    // mount 后 overlay 开启
    expect(isOverlayOpen()).toBe(true);
    unmount();
    // unmount 后 overlay 关闭（计数器归零）
    expect(isOverlayOpen()).toBe(false);
  });

  it('多个实例并行 mount/unmount 时 overlay 计数器配对', () => {
    const { editor: e1 } = createMockEditor();
    const { editor: e2 } = createMockEditor();
    expect(isOverlayOpen()).toBe(false);
    const r1 = render(
      <EditorContextMenu
        editor={e1 as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    expect(isOverlayOpen()).toBe(true);
    const r2 = render(
      <EditorContextMenu
        editor={e2 as never}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    expect(isOverlayOpen()).toBe(true);
    r1.unmount();
    // 仍有一个开启
    expect(isOverlayOpen()).toBe(true);
    r2.unmount();
    expect(isOverlayOpen()).toBe(false);
  });

  it('菜单 left/top 在视口内做 clamp（x 超出右边界）', () => {
    const { editor } = createMockEditor();
    // window.innerWidth 默认 1024 (jsdom)
    const { container } = render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 5000, y: 100 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    // 第二个 fixed div 是菜单本体（z-50）
    const menu = container.querySelector('.fixed.z-50') as HTMLElement;
    expect(menu).toBeInTheDocument();
    const left = parseInt(menu.style.left, 10);
    // Math.min(5000, 1024 - 200) = 824
    expect(left).toBe(window.innerWidth - 200);
  });

  it('菜单 top 在视口内做 clamp（y 超出下边界）', () => {
    const { editor } = createMockEditor();
    const { container } = render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 100, y: 5000 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    const menu = container.querySelector('.fixed.z-50') as HTMLElement;
    const top = parseInt(menu.style.top, 10);
    // Math.min(5000, innerHeight - 320)
    expect(top).toBe(window.innerHeight - 320);
  });

  it('position 在视口内时不 clamp', () => {
    const { editor } = createMockEditor();
    const { container } = render(
      <EditorContextMenu
        editor={editor as never}
        position={{ x: 200, y: 200 }}
        onClose={vi.fn()}
        onMarkAsForeshadow={vi.fn()}
        onInsertMention={vi.fn()}
      />,
    );
    const menu = container.querySelector('.fixed.z-50') as HTMLElement;
    expect(menu.style.left).toBe('200px');
    expect(menu.style.top).toBe('200px');
  });
});
