/**
 * BaseModal 单元测试
 *
 * 测试范围：
 *   - isOpen=false 时不渲染
 *   - isOpen=true 时渲染 title/children/close button
 *   - 点击关闭按钮调用 onClose
 *   - 点击 overlay 调用 onClose
 *   - closeOnOverlayClick=false 时点击 overlay 不关闭
 *   - 按 Escape 调用 onClose
 *   - closeOnEscape=false 时按 Escape 不关闭
 *   - showCloseButton=false 时不渲染关闭按钮
 *   - body.overflow 在打开时设为 hidden，关闭时恢复
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BaseModal } from '@/components/BaseModal';

describe('BaseModal', () => {
  beforeEach(() => {
    // 重置 body overflow 状态
    document.body.style.overflow = '';
  });

  it('isOpen=false 时不渲染', () => {
    render(
      <BaseModal isOpen={false} onClose={vi.fn()}>
        <div>内容</div>
      </BaseModal>
    );
    expect(screen.queryByText('内容')).not.toBeInTheDocument();
  });

  it('isOpen=true 时渲染 title 和 children', () => {
    render(
      <BaseModal isOpen={true} onClose={vi.fn()} title="测试标题">
        <div>模态内容</div>
      </BaseModal>
    );
    expect(screen.getByText('测试标题')).toBeInTheDocument();
    expect(screen.getByText('模态内容')).toBeInTheDocument();
  });

  it('点击关闭按钮调用 onClose', () => {
    const onClose = vi.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose} title="标题">
        <div>内容</div>
      </BaseModal>
    );
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击 overlay（非内容区）调用 onClose', () => {
    const onClose = vi.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose}>
        <div>内容</div>
      </BaseModal>
    );
    // BaseModal 用 createPortal 渲染到 document.body，需从 body 查找
    const overlay = document.body.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnOverlayClick=false 时点击 overlay 不关闭', () => {
    const onClose = vi.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose} closeOnOverlayClick={false}>
        <div>内容</div>
      </BaseModal>
    );
    const overlay = document.body.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击内容区不触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose}>
        <div>内容区</div>
      </BaseModal>
    );
    fireEvent.click(screen.getByText('内容区'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('按 Escape 调用 onClose', () => {
    const onClose = vi.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose}>
        <div>内容</div>
      </BaseModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnEscape=false 时按 Escape 不关闭', () => {
    const onClose = vi.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose} closeOnEscape={false}>
        <div>内容</div>
      </BaseModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('showCloseButton=false 时不渲染关闭按钮', () => {
    render(
      <BaseModal isOpen={true} onClose={vi.fn()} title="标题" showCloseButton={false}>
        <div>内容</div>
      </BaseModal>
    );
    expect(screen.queryByLabelText('关闭')).not.toBeInTheDocument();
  });

  it('打开时 body.overflow 设为 hidden', () => {
    const { unmount } = render(
      <BaseModal isOpen={true} onClose={vi.fn()}>
        <div>内容</div>
      </BaseModal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
  });

  it('关闭后 body.overflow 恢复', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(
      <BaseModal isOpen={true} onClose={vi.fn()}>
        <div>内容</div>
      </BaseModal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <BaseModal isOpen={false} onClose={vi.fn()}>
        <div>内容</div>
      </BaseModal>
    );
    expect(document.body.style.overflow).toBe('auto');
  });

  it('无 title 且 showCloseButton=false 时不渲染头部', () => {
    render(
      <BaseModal isOpen={true} onClose={vi.fn()} showCloseButton={false}>
        <div>内容</div>
      </BaseModal>
    );
    // 不应有 header 区（flex items-center 的 div）
    const headerDivs = document.body.querySelectorAll('.flex.items-center.justify-between');
    expect(headerDivs.length).toBe(0);
  });

  it('width 属性应用对应 class', () => {
    const { rerender } = render(
      <BaseModal isOpen={true} onClose={vi.fn()} width="sm">
        <div>内容</div>
      </BaseModal>
    );
    let card = document.body.querySelector('.card') as HTMLElement;
    expect(card.className).toContain('max-w-sm');

    rerender(
      <BaseModal isOpen={true} onClose={vi.fn()} width="xl">
        <div>内容</div>
      </BaseModal>
    );
    card = document.body.querySelector('.card') as HTMLElement;
    expect(card.className).toContain('max-w-xl');
  });
});
