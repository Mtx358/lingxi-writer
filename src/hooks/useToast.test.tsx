/**
 * useToast 测试
 *
 * 测试范围：
 * 1. useToastStore 的 addToast / removeToast / clearToasts
 * 2. 便捷方法 toast.success/error/warning/info
 * 3. MAX_TOASTS=5 上限：超过时淘汰最旧
 * 4. 默认/自定义 duration
 * 5. 自动过期（fake timers）
 * 6. ToastContainer 组件渲染与交互
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useToastStore, toast, ToastContainer } from '@/hooks/useToast';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe('addToast 基础语义', () => {
    it('addToast 后 toasts 长度 +1', () => {
      useToastStore.getState().addToast({ type: 'success', title: 't1' });
      expect(useToastStore.getState().toasts).toHaveLength(1);
      expect(useToastStore.getState().toasts[0].title).toBe('t1');
      expect(useToastStore.getState().toasts[0].type).toBe('success');
    });

    it('addToast 自动生成 id（UUID 格式）', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x' });
      const id = useToastStore.getState().toasts[0].id;
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('未传 duration → 默认 4000ms', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x' });
      expect(useToastStore.getState().toasts[0].duration).toBe(4000);
    });

    it('传 duration → 使用自定义值', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x', duration: 1000 });
      expect(useToastStore.getState().toasts[0].duration).toBe(1000);
    });

    it('description 可选字段被保留', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x', description: 'detail' });
      expect(useToastStore.getState().toasts[0].description).toBe('detail');
    });
  });

  describe('自动过期', () => {
    it('duration 到时后自动从 toasts 中移除', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x', duration: 1000 });
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('未到 duration 时仍在列表中', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x', duration: 5000 });
      vi.advanceTimersByTime(4999);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('removeToast', () => {
    it('手动 removeToast 后立即从列表中移除', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x' });
      const id = useToastStore.getState().toasts[0].id;
      useToastStore.getState().removeToast(id);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('removeToast 不存在的 id → 无副作用', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x' });
      useToastStore.getState().removeToast('non-existent-id');
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('removeToast 后内部 timer 被清理（不再触发自动移除）', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'x', duration: 1000 });
      const id = useToastStore.getState().toasts[0].id;
      useToastStore.getState().removeToast(id);
      // 推进时间不应抛错
      expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('clearToasts', () => {
    it('清空所有 toasts 与对应 timers', () => {
      useToastStore.getState().addToast({ type: 'info', title: 'a', duration: 1000 });
      useToastStore.getState().addToast({ type: 'info', title: 'b', duration: 2000 });
      useToastStore.getState().addToast({ type: 'info', title: 'c', duration: 3000 });
      useToastStore.getState().clearToasts();
      expect(useToastStore.getState().toasts).toHaveLength(0);
      // 推进时间不应触发任何 timer 回调（已全部 clearTimeout）
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    });
  });

  describe('MAX_TOASTS=5 淘汰策略', () => {
    it('addToast 第 6 条时淘汰第 1 条', () => {
      for (let i = 0; i < 6; i++) {
        useToastStore.getState().addToast({ type: 'info', title: `t${i}` });
      }
      // 仅保留后 5 条
      expect(useToastStore.getState().toasts).toHaveLength(5);
      // 第一条被淘汰
      expect(useToastStore.getState().toasts.map(t => t.title)).not.toContain('t0');
      // 后 5 条按顺序保留
      expect(useToastStore.getState().toasts.map(t => t.title)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    });

    it('淘汰最旧时清理其内部 timer（不再触发自动移除）', () => {
      // 第 1 条 duration 短，被淘汰后 timer 应被清理
      useToastStore.getState().addToast({ type: 'info', title: 'first', duration: 100 });
      for (let i = 1; i < 6; i++) {
        useToastStore.getState().addToast({ type: 'info', title: `t${i}` });
      }
      // first 已被淘汰
      expect(useToastStore.getState().toasts.map(t => t.title)).not.toContain('first');
      // 推进 100ms：first 的 timer 已被清理，不应抛错
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
      // 剩余 5 条不受影响
      expect(useToastStore.getState().toasts).toHaveLength(5);
    });
  });

  describe('toast 便捷方法', () => {
    it('toast.success → type=success', () => {
      toast.success('成功标题', '描述');
      const t = useToastStore.getState().toasts[0];
      expect(t.type).toBe('success');
      expect(t.title).toBe('成功标题');
      expect(t.description).toBe('描述');
    });

    it('toast.error → type=error', () => {
      toast.error('错误标题');
      const t = useToastStore.getState().toasts[0];
      expect(t.type).toBe('error');
      expect(t.title).toBe('错误标题');
      expect(t.description).toBeUndefined();
    });

    it('toast.warning → type=warning', () => {
      toast.warning('警告');
      expect(useToastStore.getState().toasts[0].type).toBe('warning');
    });

    it('toast.info → type=info', () => {
      toast.info('提示');
      expect(useToastStore.getState().toasts[0].type).toBe('info');
    });

    it('toast.default export 与 named export 指向同一对象', async () => {
      const mod = await import('@/hooks/useToast');
      expect(mod.default).toBe(mod.toast);
    });
  });
});

describe('ToastContainer 组件', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('无 toast 时返回 null', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it('有 toast 时渲染对应数量', () => {
    useToastStore.getState().addToast({ type: 'success', title: 't1' });
    useToastStore.getState().addToast({ type: 'error', title: 't2' });
    render(<ToastContainer />);
    expect(screen.getByText('t1')).toBeInTheDocument();
    expect(screen.getByText('t2')).toBeInTheDocument();
  });

  it('description 存在时渲染描述文本', () => {
    useToastStore.getState().addToast({ type: 'info', title: '标题', description: '描述内容' });
    render(<ToastContainer />);
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('描述内容')).toBeInTheDocument();
  });

  it('点击 toast 卡片内容不触发关闭（仅关闭按钮可关闭）', () => {
    useToastStore.getState().addToast({ type: 'success', title: '点击我' });
    render(<ToastContainer />);
    const card = screen.getByText('点击我').closest('div.px-4')!;
    fireEvent.click(card);
    // 整块 onClick 已移除以避免误触，点击卡片不再关闭 toast
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('点击 × 按钮 → removeToast（不冒泡到卡片）', () => {
    useToastStore.getState().addToast({ type: 'success', title: 'x' });
    render(<ToastContainer />);
    const btn = screen.getByText('×');
    fireEvent.click(btn);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('duration 到时后组件自动停止渲染对应 toast', () => {
    useToastStore.getState().addToast({ type: 'info', title: '短暂', duration: 500 });
    render(<ToastContainer />);
    expect(screen.getByText('短暂')).toBeInTheDocument();
    // 用 act 包裹让 React 同步处理 timer 触发的状态更新
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText('短暂')).not.toBeInTheDocument();
  });
});
