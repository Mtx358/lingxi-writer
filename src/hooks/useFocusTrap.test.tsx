/**
 * useFocusTrap hook 测试
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

function TestModal({ active, onClose }: { active: boolean; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(active);
  if (!active) return null;
  return (
    <div ref={trapRef} role="dialog" aria-modal="true">
      <input data-testid="first" placeholder="first" />
      <button onClick={onClose}>关闭</button>
      <input data-testid="last" placeholder="last" />
    </div>
  );
}

function TestWrapper() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="opener" onClick={() => setOpen(true)}>打开</button>
      <TestModal active={open} onClose={() => setOpen(false)} />
    </div>
  );
}

describe('useFocusTrap', () => {
  it('打开模态时聚焦第一个可聚焦元素', () => {
    render(<TestWrapper />);
    fireEvent.click(screen.getByTestId('opener'));
    expect(screen.getByPlaceholderText('first')).toHaveFocus();
  });

  it('Tab 在模态内循环（从最后一个跳回第一个）', () => {
    render(<TestWrapper />);
    fireEvent.click(screen.getByTestId('opener'));
    // 聚焦最后一个
    screen.getByPlaceholderText('last').focus();
    expect(screen.getByPlaceholderText('last')).toHaveFocus();
    // Tab 应跳回第一个
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(screen.getByPlaceholderText('first')).toHaveFocus();
  });

  it('Shift+Tab 从第一个跳到最后一个', () => {
    render(<TestWrapper />);
    fireEvent.click(screen.getByTestId('opener'));
    // 此时 first 有焦点
    expect(screen.getByPlaceholderText('first')).toHaveFocus();
    // Shift+Tab 应跳到最后一个
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(screen.getByPlaceholderText('last')).toHaveFocus();
  });

  it('关闭模态时恢复焦点到打开前的元素', () => {
    render(<TestWrapper />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    // 焦点已移到模态内
    expect(screen.getByPlaceholderText('first')).toHaveFocus();
    // 关闭模态
    fireEvent.click(screen.getByText('关闭'));
    // 焦点应恢复到 opener
    expect(opener).toHaveFocus();
  });

  it('active=false 时不做任何事', () => {
    function InactiveTest() {
      const trapRef = useFocusTrap<HTMLDivElement>(false);
      return <div ref={trapRef} data-testid="container"><input /></div>;
    }
    render(<InactiveTest />);
    expect(screen.getByTestId('container')).toBeInTheDocument();
  });
});
