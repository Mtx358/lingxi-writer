/**
 * Empty 组件单元测试
 *
 * 增强后的通用空状态占位组件：支持 icon / title / description / action props，
 * 根元素带 role="status" + aria-live="polite" 以满足 a11y 要求。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Empty from '@/components/Empty';

describe('Empty', () => {
  it('渲染 title 文本', () => {
    render(<Empty title="暂无数据" />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('title 渲染为 h3 标题元素', () => {
    const { container } = render(<Empty title="标题" />);
    const heading = container.querySelector('h3');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('标题');
  });

  it('根元素含 flex 居中样式 class 与 h-full', () => {
    const { container } = render(<Empty title="x" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('flex');
    expect(root.className).toContain('items-center');
    expect(root.className).toContain('justify-center');
    expect(root.className).toContain('h-full');
  });

  it('根元素带 role="status" 与 aria-live="polite"（a11y）', () => {
    const { container } = render(<Empty title="x" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
  });

  it('提供 description 时渲染描述段落', () => {
    render(<Empty title="标题" description="描述内容" />);
    expect(screen.getByText('描述内容')).toBeInTheDocument();
  });

  it('未提供 description 时不渲染描述段落', () => {
    const { container } = render(<Empty title="标题" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('提供 icon 时渲染图标节点', () => {
    render(<Empty title="标题" icon={<span data-testid="icon">ICON</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('未提供 icon 时不渲染图标节点', () => {
    const { container } = render(<Empty title="标题" />);
    // h3 是第一个子元素，没有其他节点在 h3 之前
    const heading = container.querySelector('h3');
    expect(heading).not.toBeNull();
    expect(heading?.previousElementSibling).toBeNull();
  });

  it('提供 action 时渲染动作节点', () => {
    render(<Empty title="标题" action={<button>创建大纲</button>} />);
    expect(screen.getByRole('button', { name: '创建大纲' })).toBeInTheDocument();
  });

  it('className 与默认 class 合并（twMerge）', () => {
    const { container } = render(<Empty title="x" className="py-8" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('py-8');
    expect(root.className).toContain('flex');
  });
});
