/**
 * OnboardingGuide 单元测试
 *
 * 测试范围：
 *   - 首步渲染欢迎页 / 进度条 / 步骤计数
 *   - "下一步"逐步推进直至末步 → "开始创作" → onComplete
 *   - "上一步"回退；首步禁用回退
 *   - "跳过引导"按钮触发 onSkip
 *   - X 关闭按钮触发 onSkip
 *   - 步骤指示器（点点）反映当前步骤
 *   - 动画期间禁用按钮（防止快速点击越步）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import OnboardingGuide from '@/components/OnboardingGuide';

describe('OnboardingGuide', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ============ 首步 ============
  it('首步渲染欢迎标题与描述', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText('欢迎来到灵犀写作助手')).toBeInTheDocument();
    expect(screen.getByText(/一个以"人主导、AI 辅助"为核心理念/)).toBeInTheDocument();
  });

  it('首步显示"下一步"按钮，不显示"上一步"', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText('下一步')).toBeInTheDocument();
    expect(screen.queryByText('上一步')).not.toBeInTheDocument();
  });

  it('步骤计数显示 1 / 3', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('进度条宽度为 33.33%（1/3）', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    const progressBar = document.querySelector('.bg-gradient-to-r') as HTMLElement;
    expect(progressBar).not.toBeNull();
    expect(progressBar.style.width).toBe('33.33333333333333%');
  });

  // ============ 推进步骤 ============
  it('点击"下一步"推进到第二步', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('冲突检测')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('推进到第二步时显示"上一步"按钮', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('上一步')).toBeInTheDocument();
  });

  it('点击"上一步"回退到第一步', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    // 先前进到第二步
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    // 回退
    fireEvent.click(screen.getByText('上一步'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText('欢迎来到灵犀写作助手')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('末步显示"开始创作"按钮', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    // 前进两次到末步
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText('开始创作')).toBeInTheDocument();
    expect(screen.getByText('准备就绪！')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('末步点击"开始创作"调用 onComplete', () => {
    const onComplete = vi.fn();
    render(<OnboardingGuide onComplete={onComplete} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByText('开始创作'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('末步不再显示"跳过引导"按钮', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('跳过引导')).not.toBeInTheDocument();
  });

  // ============ 跳过/关闭 ============
  it('点击"跳过引导"调用 onSkip', () => {
    const onSkip = vi.fn();
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('跳过引导'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('点击 X 按钮调用 onSkip', () => {
    const onSkip = vi.fn();
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={onSkip} />);
    // X 按钮在卡片右上角，无文字，用 svg 选择器
    const closeBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn!);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // ============ 动画期间禁用 ============
  it('动画期间禁用"下一步"按钮', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    // 还未推进定时器 → isAnimating=true
    const nextBtn = screen.getByText('下一步').closest('button');
    expect(nextBtn?.disabled).toBe(true);
    // 推进定时器后启用
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText('冲突检测')).toBeInTheDocument();
  });

  it('动画期间点击"下一步"不重复推进', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    // 在动画期间再次点击（按钮已 disabled）
    const nextBtn = screen.getByText('下一步').closest('button')!;
    expect(nextBtn.disabled).toBe(true);
    fireEvent.click(nextBtn);
    // 推进定时器
    act(() => vi.advanceTimersByTime(200));
    // 仍在第二步，未跳到第三步
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  // ============ 步骤指示器 ============
  it('步骤指示器渲染 3 个点，已访问的为高亮色', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    // 首步：第一个点高亮（w-6 bg-amber-400），其余为 w-1.5 bg-ink-700
    const dots = document.querySelectorAll('.h-1\\.5.rounded-full');
    expect(dots.length).toBe(3);
    expect(dots[0].className).toContain('w-6');
    expect(dots[0].className).toContain('bg-amber-400');
    expect(dots[1].className).toContain('w-1.5');
    expect(dots[1].className).toContain('bg-ink-700');
  });

  it('推进到第二步后，前两个点亮起', () => {
    render(<OnboardingGuide onComplete={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('下一步'));
    act(() => vi.advanceTimersByTime(200));
    const dots = document.querySelectorAll('.h-1\\.5.rounded-full');
    expect(dots[0].className).toContain('w-6');
    expect(dots[1].className).toContain('w-6');
    expect(dots[2].className).toContain('w-1.5');
  });
});
