/**
 * App 入口组件测试
 *
 * 测试范围：
 *   - 默认挂载渲染 Home（路由 "/" ）
 *   - mount 时调用 window.electronAPI.system.checkCrashRecovery
 *   - 检测到崩溃恢复且有项目时通过 toast.info 提示
 *   - recovered=false 或 projects 为空时不提示
 *   - checkCrashRecovery reject 时仅 console.warn，不抛错
 *   - ErrorBoundary 兜底子组件异常
 *
 * 说明：Home 与各 lazy 页面组件依赖较多 store/IPC，此处统一 mock 为简单占位
 * 组件，仅验证 App 自身的路由装配、effect 副作用与错误兜底行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ============ mock 页面组件 ============
// Home 直接 import，需在导入 App 之前 mock
vi.mock('@/pages/Home', () => ({
  default: function MockHome() {
    return <div data-testid="mock-home">MockHome</div>;
  },
}));

// 各 lazy 页面：default export 一个简单组件
vi.mock('@/pages/EditorPage', () => ({
  default: function MockEditorPage() {
    return <div data-testid="mock-editor">MockEditorPage</div>;
  },
}));
vi.mock('@/pages/ReviewPage', () => ({
  default: function MockReviewPage() {
    return <div data-testid="mock-review">MockReviewPage</div>;
  },
}));
vi.mock('@/pages/ExportPage', () => ({
  default: function MockExportPage() {
    return <div data-testid="mock-export">MockExportPage</div>;
  },
}));
vi.mock('@/pages/DashboardPage', () => ({
  default: function MockDashboardPage() {
    return <div data-testid="mock-dashboard">MockDashboardPage</div>;
  },
}));

// ============ 监听 toast.info / console.warn ============
// toast 模块内部用 Zustand store，真实导入即可，仅需 spy info 方法
import { toast, useToastStore } from '@/hooks/useToast';
import App from '@/App';

describe('App 入口组件', () => {
  let toastInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useToastStore.getState().clearToasts();
    toastInfoSpy = vi.spyOn(toast, 'info').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 默认 mock：未恢复
    vi.mocked(window.electronAPI!.system.checkCrashRecovery).mockResolvedValue({
      recovered: false,
      projects: [],
    });
  });

  afterEach(() => {
    toastInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    cleanup();
  });

  it('默认渲染 Home 路由', async () => {
    render(<App />);
    // Suspense fallback 会被 Home 替换（Home 非 lazy）
    expect(await screen.findByTestId('mock-home')).toBeInTheDocument();
  });

  it('mount 时调用 checkCrashRecovery', async () => {
    render(<App />);
    await screen.findByTestId('mock-home');
    expect(window.electronAPI!.system.checkCrashRecovery).toHaveBeenCalledTimes(1);
  });

  it('recovered=true 且有项目时调用 toast.info', async () => {
    vi.mocked(window.electronAPI!.system.checkCrashRecovery).mockResolvedValue({
      recovered: true,
      projects: [{ id: 'p1' } as never, { id: 'p2' } as never],
    });
    render(<App />);
    await screen.findByTestId('mock-home');
    // effect 内的 promise 是微任务，await 一次微任务循环
    await Promise.resolve();
    await Promise.resolve();
    expect(toastInfoSpy).toHaveBeenCalledTimes(1);
    // 第一参数标题
    expect(toastInfoSpy.mock.calls[0][0]).toBe('已恢复异常退出的数据');
    // 第二参数描述包含项目数
    expect(toastInfoSpy.mock.calls[0][1]).toContain('2');
  });

  it('recovered=true 但 projects 为空时不调用 toast.info', async () => {
    vi.mocked(window.electronAPI!.system.checkCrashRecovery).mockResolvedValue({
      recovered: true,
      projects: [],
    });
    render(<App />);
    await screen.findByTestId('mock-home');
    await Promise.resolve();
    await Promise.resolve();
    expect(toastInfoSpy).not.toHaveBeenCalled();
  });

  it('recovered=false 时不调用 toast.info', async () => {
    vi.mocked(window.electronAPI!.system.checkCrashRecovery).mockResolvedValue({
      recovered: false,
      projects: [],
    });
    render(<App />);
    await screen.findByTestId('mock-home');
    await Promise.resolve();
    await Promise.resolve();
    expect(toastInfoSpy).not.toHaveBeenCalled();
  });

  it('checkCrashRecovery reject 时仅 console.warn 不抛错', async () => {
    vi.mocked(window.electronAPI!.system.checkCrashRecovery).mockRejectedValue(
      new Error('ipc failed'),
    );
    render(<App />);
    await screen.findByTestId('mock-home');
    // 等待 promise rejection 处理完
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleWarnSpy).toHaveBeenCalled();
    // 不调用 toast
    expect(toastInfoSpy).not.toHaveBeenCalled();
  });

  it('checkCrashRecovery 不存在时不报错', async () => {
    // 临时清除 system.checkCrashRecovery
    const original = window.electronAPI!.system.checkCrashRecovery;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window.electronAPI!.system as any).checkCrashRecovery;
    // 不应抛错
    expect(() => render(<App />)).not.toThrow();
    await screen.findByTestId('mock-home');
    // 恢复
    window.electronAPI!.system.checkCrashRecovery = original;
  });

  it('ErrorBoundary 兜底捕获子组件异常', async () => {
    // 通过临时让 Home 抛错验证 ErrorBoundary 兜底
    vi.doMock('@/pages/Home', () => ({
      default: function ThrowingHome() {
        throw new Error('boom from home');
      },
    }));
    // 重新导入 App 以让 doMock 生效
    vi.resetModules();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: AppWithThrowingHome } = await import('@/App');
    render(<AppWithThrowingHome />);
    // 路由级 RouteBoundary 的兜底 UI 包含 "页面发生错误"
    expect(await screen.findByText('页面发生错误')).toBeInTheDocument();
    // "返回首页" 与 "重试" 按钮存在
    expect(screen.getByText('返回首页')).toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
    vi.doUnmock('@/pages/Home');
  });

  it('点击 "返回首页" 触发路由跳转', async () => {
    vi.doMock('@/pages/Home', () => ({
      default: function ThrowingHome() {
        throw new Error('boom');
      },
    }));
    vi.resetModules();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: AppWithThrowingHome } = await import('@/App');
    render(<AppWithThrowingHome />);
    const backBtn = await screen.findByText('返回首页');
    fireEvent.click(backBtn);
    // navigate('/') 调用后 hash 改变（Home 仍抛错会再次显示错误页，但路由已切换）
    expect(window.location.hash).toMatch(/#\/$/);
    consoleErrorSpy.mockRestore();
    vi.doUnmock('@/pages/Home');
  });
});
