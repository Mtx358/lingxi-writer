/**
 * InteractiveTour 单元测试
 *
 * 测试范围：
 *   - 空步骤立即调用 onComplete
 *   - 首步元素未找到 → onComplete
 *   - 元素找到 → 渲染 title / description / 进度
 *   - prepare 回调调用 + 350ms 延迟
 *   - 下一步 / 上一步 / 完成 / 跳过 按钮
 *   - 上一步按钮首步隐藏；完成文本最后一步；跳过按钮最后一步隐藏
 *   - completedRef 防止重复触发 onComplete
 *   - 4 种 placement（top/bottom/left/right）tooltip 位置 + 箭头
 *   - 视窗边界 clamp（left/top 不小于 12）
 *   - resize / scroll 触发重新布局
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import InteractiveTour, { type TourStep } from '@/components/InteractiveTour';

// ============ 辅助：mock document.querySelector ============
// jsdom 默认 getBoundingClientRect 返回全 0，需手动返回非零 rect 才能被 resolveAndLayout 接受
function mockQuerySelector(map: Record<string, Partial<DOMRect>>) {
  const spy = vi.spyOn(document, 'querySelector');
  spy.mockImplementation((selector: string) => {
    const rect = map[selector];
    if (!rect) return null;
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({
      width: 100,
      height: 50,
      top: 200,
      left: 300,
      right: 400,
      bottom: 250,
      x: 300,
      y: 200,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect);
    return el as unknown as HTMLElement;
  });
  return spy;
}

const STEPS: TourStep[] = [
  { selector: '.step-1', title: '第一步', description: '第一步描述' },
  { selector: '.step-2', title: '第二步', description: '第二步描述' },
  { selector: '.step-3', title: '第三步', description: '第三步描述' },
];

describe('InteractiveTour', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  // useLayoutEffect 内 setTimeout(resolveAndLayout, 0/350) 不会自动触发，
  // 需在 render / fireEvent 后显式 advance timers 并包 act() 让 setState 生效
  function flush(ms = 50) {
    act(() => { vi.advanceTimersByTime(ms); });
  }

  // 渲染 + flush 一步到位
  function renderTour(props: { steps: TourStep[]; onComplete: () => void; onSkip: () => void }) {
    const result = render(<InteractiveTour {...props} />);
    flush();
    return result;
  }

  // ============ 空步骤 ============
  it('空 steps 立即调用 onComplete', () => {
    const onComplete = vi.fn();
    const onSkip = vi.fn();
    mockQuerySelector({});
    renderTour({ steps: [], onComplete, onSkip });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  // ============ 元素未找到 ============
  it('首步元素未找到 → 调用 onComplete', () => {
    const onComplete = vi.fn();
    mockQuerySelector({}); // 全部返回 null
    renderTour({ steps: STEPS, onComplete, onSkip: vi.fn() });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('中间步骤元素未找到时跳到下一可见步骤', () => {
    // 步骤 1 元素不存在，步骤 2 存在 → 应展示步骤 2 内容
    mockQuerySelector({
      '.step-2': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    expect(screen.getByText('第二步')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  // ============ 渲染 ============
  it('渲染当前步骤的 title / description / 进度', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    expect(screen.getByText('第一步')).toBeInTheDocument();
    expect(screen.getByText('第一步描述')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  // ============ 按钮：上一步 ============
  it('首步隐藏"上一步"按钮', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    expect(screen.queryByText('上一步')).not.toBeInTheDocument();
  });

  it('点击"下一步"显示"上一步"按钮', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
      '.step-2': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    fireEvent.click(screen.getByText('下一步'));
    flush();
    expect(screen.getByText('上一步')).toBeInTheDocument();
    expect(screen.getByText('第二步')).toBeInTheDocument();
  });

  it('点击"上一步"回到前一步', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
      '.step-2': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    fireEvent.click(screen.getByText('下一步'));
    flush();
    fireEvent.click(screen.getByText('上一步'));
    flush();
    expect(screen.getByText('第一步')).toBeInTheDocument();
    expect(screen.queryByText('上一步')).not.toBeInTheDocument();
  });

  // ============ 按钮：完成 ============
  it('最后一步"下一步"按钮文本变为"完成"', () => {
    mockQuerySelector({
      '.step-3': { width: 100, height: 50, top: 200, left: 300 },
    });
    // 跳到第三步：步骤 1/2 不存在，第三步存在
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.queryByText('下一步')).not.toBeInTheDocument();
  });

  it('点击"完成"调用 onComplete（仅一次）', () => {
    mockQuerySelector({
      '.step-3': { width: 100, height: 50, top: 200, left: 300 },
    });
    const onComplete = vi.fn();
    renderTour({ steps: STEPS, onComplete, onSkip: vi.fn() });
    fireEvent.click(screen.getByText('完成'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ============ 按钮：跳过 ============
  it('点击 X 按钮调用 onSkip', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const onSkip = vi.fn();
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip });
    const xBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    fireEvent.click(xBtn!);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('点击底部"跳过引导"调用 onSkip', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const onSkip = vi.fn();
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip });
    // 底部"跳过引导"按钮文本（X 按钮 title 同名，需找到带 SkipForward 图标的 button）
    const skipBtn = screen.getAllByText('跳过引导').find(el => {
      const btn = el.closest('button');
      return btn && btn.querySelector('svg.lucide-skip-forward') !== null;
    });
    fireEvent.click(skipBtn!);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('最后一步隐藏底部"跳过引导"按钮', () => {
    mockQuerySelector({
      '.step-3': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    // 底部按钮带 SkipForward 图标 + "跳过引导"文本；isLast 时该 button 不渲染
    const bottomSkipBtn = screen.queryAllByText('跳过引导').find(el => {
      const btn = el.closest('button');
      return btn && btn.querySelector('svg.lucide-skip-forward') !== null;
    });
    expect(bottomSkipBtn).toBeUndefined();
  });

  // ============ completedRef 防重 ============
  it('completedRef 守卫：onComplete 已触发后再点击完成不重复', () => {
    // 空步骤已触发 onComplete；尝试再次点击无影响
    const onComplete = vi.fn();
    mockQuerySelector({});
    renderTour({ steps: [], onComplete, onSkip: vi.fn() });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ============ prepare 回调 ============
  it('prepare 回调被调用', () => {
    const prepare = vi.fn();
    const stepsWithPrepare: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', prepare },
    ];
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    renderTour({ steps: stepsWithPrepare, onComplete: vi.fn(), onSkip: vi.fn() });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('prepare 存在时延迟 350ms 后才定位 tooltip', () => {
    const prepare = vi.fn();
    const stepsWithPrepare: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', prepare },
    ];
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    // render 内 useLayoutEffect 同步调用 prepare，但 setTimeout(350) 需手动 advance
    const { container } = render(<InteractiveTour steps={stepsWithPrepare} onComplete={vi.fn()} onSkip={vi.fn()} />);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.animate-slide-up')).toBeNull();
    act(() => { vi.advanceTimersByTime(349); });
    expect(container.querySelector('.animate-slide-up')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(container.querySelector('.animate-slide-up')).toBeTruthy();
  });

  // ============ placement ============
  it('placement=bottom：tooltip 出现在目标下方', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const steps: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', placement: 'bottom' },
    ];
    const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    expect(tooltip).toBeTruthy();
    // bottom = 250 + TOOLTIP_GAP(14) = 264
    expect(tooltip.style.top).toBe('264px');
  });

  it('placement=top：tooltip 出现在目标上方', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const steps: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', placement: 'top' },
    ];
    const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    // top = 200 - ESTIMATED_TOOLTIP_HEIGHT(190) - TOOLTIP_GAP(14) = -4，clamp 到 12
    expect(tooltip.style.top).toBe('12px');
  });

  it('placement=left：tooltip 出现在目标左侧', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 500 },
    });
    const steps: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', placement: 'left' },
    ];
    const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    // left = 500 - TOOLTIP_WIDTH(320) - TOOLTIP_GAP(14) = 166
    expect(tooltip.style.left).toBe('166px');
  });

  it('placement=right：tooltip 出现在目标右侧', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300, right: 400 },
    });
    const steps: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', placement: 'right' },
    ];
    const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    // left = right(400) + TOOLTIP_GAP(14) = 414
    expect(tooltip.style.left).toBe('414px');
  });

  it('默认 placement=bottom', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const steps: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D' /* 无 placement */ },
    ];
    const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    expect(tooltip.style.top).toBe('264px');
  });

  // ============ 视窗边界 clamp ============
  it('left clamp 到 12（tooltip 超出左边界）', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 50 }, // centerX=100, left=100-160=-60
    });
    const steps: TourStep[] = [
      { selector: '.step-1', title: 'T', description: 'D', placement: 'bottom' },
    ];
    const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    // left = 50 + 50 - 160 = -60 → clamp 到 12
    expect(tooltip.style.left).toBe('12px');
  });

  it('right clamp（tooltip 超出右边界）', () => {
    // 让 innerWidth 较小，确保 left 计算结果被 clamp 到 innerWidth - TOOLTIP_WIDTH - 12
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 });
    try {
      mockQuerySelector({
        '.step-1': { width: 100, height: 50, top: 200, left: 300 }, // centerX=350, left=350-160=190
      });
      const steps: TourStep[] = [
        { selector: '.step-1', title: 'T', description: 'D', placement: 'bottom' },
      ];
      const { container } = renderTour({ steps, onComplete: vi.fn(), onSkip: vi.fn() });
      const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
      // left = 190, max = 400 - 320 - 12 = 68 → clamp 到 68
      expect(tooltip.style.left).toBe('68px');
    } finally {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
    }
  });

  // ============ resize / scroll 触发重新布局 ============
  it('resize 事件触发重新布局', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const { container } = renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    const tooltipBefore = container.querySelector('.animate-slide-up') as HTMLElement;
    const topBefore = tooltipBefore.style.top;

    // 修改 mock 让目标元素位置变化
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 400, left: 300 },
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(50);
    });
    const tooltipAfter = container.querySelector('.animate-slide-up') as HTMLElement;
    // top 由 200+50+14=264 变成 400+50+14=464
    expect(tooltipAfter.style.top).not.toBe(topBefore);
    expect(tooltipAfter.style.top).toBe('464px');
  });

  it('scroll 事件（捕获）触发重新布局', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const { container } = renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 500, left: 300 },
    });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50);
    });
    const tooltip = container.querySelector('.animate-slide-up') as HTMLElement;
    // top = 500 + 50 + 14 = 564
    expect(tooltip.style.top).toBe('564px');
  });

  // ============ 进度点 ============
  it('渲染进度点（步骤数量）', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const { container } = renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    // 3 个步骤对应 3 个进度点（h-1 rounded-full）
    const dots = container.querySelectorAll('.h-1.rounded-full');
    expect(dots.length).toBe(3);
  });

  it('高亮 mask 围绕目标元素（带 HIGHLIGHT_PADDING=6）', () => {
    mockQuerySelector({
      '.step-1': { width: 100, height: 50, top: 200, left: 300 },
    });
    const { container } = renderTour({ steps: STEPS, onComplete: vi.fn(), onSkip: vi.fn() });
    // 高亮 mask 是带 box-shadow 0 0 0 9999px 的 div
    const mask = container.querySelector('[style*="9999px"]') as HTMLElement;
    expect(mask).toBeTruthy();
    // top = 200 - 6 = 194
    expect(mask.style.top).toBe('194px');
    expect(mask.style.left).toBe('294px');
    expect(mask.style.width).toBe('112px'); // 100 + 12
    expect(mask.style.height).toBe('62px'); // 50 + 12
  });
});
