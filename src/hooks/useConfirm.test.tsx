/**
 * useConfirm 测试
 *
 * 测试范围：
 * 1. useConfirmStore 基本流程：openConfirm → close(true/false) → Promise resolve
 * 2. 连续调用：第一个未 close 时第二次 openConfirm 让第一个 resolve(false)
 * 3. ConfirmDialog 组件渲染：isOpen 切换、message/title 展示
 * 4. 按钮交互：确定/取消 → close(true/false)
 * 5. BaseModal onClose：X 按钮 / Escape → close(false)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useConfirmStore, ConfirmDialog } from '@/hooks/useConfirm';

describe('useConfirmStore', () => {
  beforeEach(() => {
    // 关闭任何可能残留的 pending confirm（若有 resolve 则 resolve(false)，无则 no-op），
    // 避免跨用例悬挂 Promise 导致 unhandled rejection
    useConfirmStore.getState().close(false);
    useConfirmStore.setState({ isOpen: false, message: '', title: '确认操作' });
  });

  afterEach(() => {
    cleanup();
  });

  it('基本流程：openConfirm → close(true) → Promise resolve true', async () => {
    const promise = useConfirmStore.getState().openConfirm('确认删除？', '删除');
    // openConfirm 后状态切换
    expect(useConfirmStore.getState().isOpen).toBe(true);
    expect(useConfirmStore.getState().message).toBe('确认删除？');
    expect(useConfirmStore.getState().title).toBe('删除');
    expect(useConfirmStore.getState().resolve).toBeDefined();

    useConfirmStore.getState().close(true);
    await expect(promise).resolves.toBe(true);
    // close 后状态归位
    expect(useConfirmStore.getState().isOpen).toBe(false);
    expect(useConfirmStore.getState().resolve).toBeUndefined();
  });

  it('拒绝路径：openConfirm → close(false) → Promise resolve false', async () => {
    const promise = useConfirmStore.getState().openConfirm('确认取消？');
    useConfirmStore.getState().close(false);
    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().isOpen).toBe(false);
  });

  it('未传 title 时使用默认标题"确认操作"', () => {
    useConfirmStore.getState().openConfirm('消息内容');
    expect(useConfirmStore.getState().title).toBe('确认操作');
    // 收尾避免悬挂 Promise
    useConfirmStore.getState().close(false);
  });

  it('连续调用：第一个未 close 时第二次 openConfirm 让第一个 resolve(false)', async () => {
    const first = useConfirmStore.getState().openConfirm('first');
    // 第二次 openConfirm：旧的 resolve 被以 false 调用
    const second = useConfirmStore.getState().openConfirm('second', '新标题');

    await expect(first).resolves.toBe(false);
    // 第二个仍处于 open 态，message/title 已切换到第二个
    expect(useConfirmStore.getState().isOpen).toBe(true);
    expect(useConfirmStore.getState().message).toBe('second');
    expect(useConfirmStore.getState().title).toBe('新标题');
    // 收尾第二个，避免悬挂 Promise
    useConfirmStore.getState().close(true);
    await expect(second).resolves.toBe(true);
  });
});

describe('ConfirmDialog 组件', () => {
  beforeEach(() => {
    useConfirmStore.getState().close(false);
    useConfirmStore.setState({ isOpen: false, message: '', title: '确认操作' });
  });

  afterEach(() => {
    cleanup();
  });

  it('isOpen=false 时不渲染弹窗（BaseModal 返回 null）', () => {
    render(<ConfirmDialog />);
    // 无 dialog 角色节点，也无 message 文本
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('isOpen=true 时渲染 message 与 title', () => {
    useConfirmStore.getState().openConfirm('请确认此操作', '操作确认');
    render(<ConfirmDialog />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('请确认此操作')).toBeInTheDocument();
    expect(screen.getByText('操作确认')).toBeInTheDocument();
    // 收尾：用 act 包裹状态更新，避免未包裹的 setState 触发 act 警告
    act(() => {
      useConfirmStore.getState().close(false);
    });
  });

  it('点击"确定"按钮 → close(true) 且 Promise resolve true', async () => {
    const promise = useConfirmStore.getState().openConfirm('确定吗');
    render(<ConfirmDialog />);

    fireEvent.click(screen.getByText('确定'));
    await expect(promise).resolves.toBe(true);
    expect(useConfirmStore.getState().isOpen).toBe(false);
  });

  it('点击"取消"按钮 → close(false) 且 Promise resolve false', async () => {
    const promise = useConfirmStore.getState().openConfirm('取消吗');
    render(<ConfirmDialog />);

    fireEvent.click(screen.getByText('取消'));
    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().isOpen).toBe(false);
  });

  it('BaseModal onClose：点击右上角关闭按钮（X）→ close(false)', async () => {
    const promise = useConfirmStore.getState().openConfirm('内容');
    render(<ConfirmDialog />);

    // BaseModal 关闭按钮 aria-label="关闭"
    fireEvent.click(screen.getByLabelText('关闭'));
    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().isOpen).toBe(false);
  });

  it('BaseModal onClose：按 Escape → close(false)', async () => {
    const promise = useConfirmStore.getState().openConfirm('内容');
    render(<ConfirmDialog />);

    // BaseModal 在 window 捕获阶段监听 keydown，closeOnEscape 默认 true
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().isOpen).toBe(false);
  });

  it('closeOnOverlayClick=false：点击遮罩不关闭', () => {
    useConfirmStore.getState().openConfirm('内容');
    render(<ConfirmDialog />);

    // ConfirmDialog 传 closeOnOverlayClick={false}，点击外层遮罩不应关闭
    const overlay = document.body.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as HTMLElement);
    expect(useConfirmStore.getState().isOpen).toBe(true);
    // 收尾：用 act 包裹状态更新
    act(() => {
      useConfirmStore.getState().close(false);
    });
  });
});
