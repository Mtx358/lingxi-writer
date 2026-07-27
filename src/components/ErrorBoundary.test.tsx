/**
 * ErrorBoundary 单元测试
 *
 * 测试范围：
 *   - 正常渲染 children（无错误时）
 *   - 捕获子组件抛出的错误，渲染默认兜底 UI
 *   - 自定义 fallback 渲染（接收 error 与 reset）
 *   - onError 回调被调用
 *   - reset 恢复正常渲染
 *   - resetKey 变化时自动 reset
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ErrorBoundary from '@/components/ErrorBoundary';

// 抑制 componentDidCatch 内的 console.error 噪音
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// 抛错的子组件
function ThrowOnRender({ error }: { error: Error }): React.ReactNode {
  throw error;
}

// 受控抛错的子组件：通过 prop 控制是否抛错
function MaybeThrow({ shouldThrow }: { shouldThrow: boolean }): React.ReactNode {
  if (shouldThrow) throw new Error('test error');
  return <div>正常内容</div>;
}

describe('ErrorBoundary', () => {
  it('无错误时渲染 children', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('捕获子组件错误，渲染默认兜底 UI', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender error={new Error('boom')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('应用发生错误')).toBeInTheDocument();
    expect(screen.getByText('重新加载')).toBeInTheDocument();
  });

  it('使用自定义 fallback', () => {
    render(
      <ErrorBoundary fallback={(err, reset) => (
        <div>
          <span>自定义错误：{err.message}</span>
          <button onClick={reset}>重试</button>
        </div>
      )}>
        <ThrowOnRender error={new Error('custom boom')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('自定义错误：custom boom')).toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('调用 onError 回调', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowOnRender error={new Error('reported boom')} />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('reported boom');
  });

  it('fallback 的 reset 函数恢复正常渲染', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={(_err, reset) => (
        <button onClick={reset}>重试</button>
      )}>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('重试')).toBeInTheDocument();

    // 先 rerender 不抛错的子组件（此时仍在 error 状态，显示 fallback）
    rerender(
      <ErrorBoundary fallback={(_err, reset) => (
        <button onClick={reset}>重试</button>
      )}>
        <MaybeThrow shouldThrow={false} />
      </ErrorBoundary>
    );
    // 点击 reset 清除 error 状态 → 重新渲染当前 children（已是不抛错版本）
    fireEvent.click(screen.getByText('重试'));
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('resetKey 变化时自动 reset', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="page1" fallback={() => <div>错误页</div>}>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('错误页')).toBeInTheDocument();

    // resetKey 变化触发自动 reset，但子组件仍会抛错，所以又回到错误页
    // 此处验证的是 reset 逻辑被触发（state 被清空后又因渲染抛错再次进入 error 状态）
    rerender(
      <ErrorBoundary resetKey="page2" fallback={() => <div>错误页</div>}>
        <MaybeThrow shouldThrow={false} />
      </ErrorBoundary>
    );
    // resetKey 变化 + 子组件不再抛错 → 正常渲染
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('resetKey 不变时不 reset', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="same" fallback={() => <div>错误页</div>}>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('错误页')).toBeInTheDocument();

    // resetKey 不变，即使子组件不再抛错，也不会自动 reset（仍在 error 状态）
    rerender(
      <ErrorBoundary resetKey="same" fallback={() => <div>错误页</div>}>
        <MaybeThrow shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('错误页')).toBeInTheDocument();
  });
});
