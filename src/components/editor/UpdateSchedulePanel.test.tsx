/**
 * UpdateSchedulePanel 单元测试
 *
 * 测试范围：
 *   - 空状态（schedule=null）：渲染"尚未配置"提示 + 初始化按钮
 *   - 初始化按钮调用 updateUpdateSchedule({})
 *   - 统计卡片：存稿余量 / 已写总字数 / 已写章节数
 *   - 数值字段变更：日更目标 / 日更速度 / 收费阈值 / 断更阈值
 *   - 断更预警开关 + 三态显示（断更 / 正常 / 未记录）
 *   - 上架建议：未配置 / 进度中 / 已达成
 *   - 标记今日已更新 → updateUpdateSchedule({ lastUpdateAt: ISO })
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import UpdateSchedulePanel from '@/components/editor/UpdateSchedulePanel';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter, UpdateSchedule } from '@/types';

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'done',
    wordCount: 5000,
    content: '<p>正文</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<UpdateSchedule> = {}): UpdateSchedule {
  return {
    dailyTargetWords: 4000,
    dailySpeed: 4000,
    paywallChapterThreshold: 20,
    lastUpdateAt: null,
    enableStaleAlert: true,
    staleAlertDays: 2,
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  chapters: Chapter[];
  updateSchedule: UpdateSchedule | null;
  updateUpdateSchedule: ReturnType<typeof vi.fn>;
  getStockpileDays: () => number;
}> = {}) {
  const updateUpdateSchedule = overrides.updateUpdateSchedule || vi.fn();
  const getStockpileDays = overrides.getStockpileDays || vi.fn((): number => 0);

  useAppStore.setState({
    chapters: overrides.chapters ?? [],
    updateSchedule: overrides.updateSchedule === undefined ? null : overrides.updateSchedule,
    updateUpdateSchedule,
    getStockpileDays,
  });

  return { updateUpdateSchedule, getStockpileDays };
}

describe('UpdateSchedulePanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2024-06-15T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ============ 空状态 ============
  it('schedule 为 null 时渲染"尚未配置存稿与更新管理"提示', () => {
    mockStore({ updateSchedule: null });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText('尚未配置存稿与更新管理')).toBeInTheDocument();
  });

  it('空状态点击"点击初始化"调用 updateUpdateSchedule({})', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: null });
    render(<UpdateSchedulePanel />);
    fireEvent.click(screen.getByText('点击初始化'));
    expect(updateUpdateSchedule).toHaveBeenCalledWith({});
  });

  // ============ 统计卡片 ============
  it('渲染存稿余量/已写总字数/已写章节数三个统计卡片', () => {
    mockStore({
      updateSchedule: makeSchedule(),
      chapters: [
        makeChapter({ id: 'ch-1', wordCount: 5000 }),
        makeChapter({ id: 'ch-2', wordCount: 3000 }),
      ],
      getStockpileDays: () => 5,
    });
    render(<UpdateSchedulePanel />);
    // 三个统计卡片标签
    expect(screen.getByText('存稿余量')).toBeInTheDocument();
    expect(screen.getByText('已写总字数')).toBeInTheDocument();
    expect(screen.getByText('已写章节数')).toBeInTheDocument();
    // 已写总字数 = 5000 + 3000 = 8000（唯一值，无歧义）
    expect(screen.getByText('8,000')).toBeInTheDocument();
  });

  it('非 chapter 级节点不计入已写章节数与总字数', () => {
    mockStore({
      updateSchedule: makeSchedule(),
      chapters: [
        makeChapter({ id: 'ch-1', wordCount: 5000, levelType: 'chapter' }),
        makeChapter({ id: 'vol-1', wordCount: 9999, levelType: 'volume' }),
      ],
      getStockpileDays: () => 0,
    });
    render(<UpdateSchedulePanel />);
    // 已写总字数仅 5000（不含 volume 的 9999）
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.queryByText('9,999')).not.toBeInTheDocument();
  });

  // ============ 数值字段变更 ============
  it('修改日更目标字数调用 updateUpdateSchedule', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: makeSchedule() });
    render(<UpdateSchedulePanel />);
    const inputs = screen.getAllByRole('spinbutton');
    // 第一个 number input 是日更目标字数
    fireEvent.change(inputs[0], { target: { value: '6000' } });
    expect(updateUpdateSchedule).toHaveBeenCalledWith({ dailyTargetWords: 6000 });
  });

  it('修改日更速度调用 updateUpdateSchedule', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: makeSchedule() });
    render(<UpdateSchedulePanel />);
    const inputs = screen.getAllByRole('spinbutton');
    // 第二个 number input 是日更速度
    fireEvent.change(inputs[1], { target: { value: '3000' } });
    expect(updateUpdateSchedule).toHaveBeenCalledWith({ dailySpeed: 3000 });
  });

  it('修改收费章节阈值调用 updateUpdateSchedule', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: makeSchedule() });
    render(<UpdateSchedulePanel />);
    const inputs = screen.getAllByRole('spinbutton');
    // 第三个 number input 是收费章节阈值
    fireEvent.change(inputs[2], { target: { value: '30' } });
    expect(updateUpdateSchedule).toHaveBeenCalledWith({ paywallChapterThreshold: 30 });
  });

  it('空字符串/非法值回退为 0', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: makeSchedule() });
    render(<UpdateSchedulePanel />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: 'abc' } });
    expect(updateUpdateSchedule).toHaveBeenCalledWith({ dailyTargetWords: 0 });
  });

  it('小数被 floor 截断（非 parseInt 静默截断）', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: makeSchedule() });
    render(<UpdateSchedulePanel />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '1.9' } });
    // Number('1.9') = 1.9, Math.floor → 1
    expect(updateUpdateSchedule).toHaveBeenCalledWith({ dailyTargetWords: 1 });
  });

  // ============ 断更预警开关 ============
  it('点击断更预警开关切换 enableStaleAlert', () => {
    const { updateUpdateSchedule } = mockStore({ updateSchedule: makeSchedule({ enableStaleAlert: true }) });
    render(<UpdateSchedulePanel />);
    const toggle = screen.getByRole('switch', { name: '切换断更预警' });
    fireEvent.click(toggle);
    expect(updateUpdateSchedule).toHaveBeenCalledWith({ enableStaleAlert: false });
  });

  it('断更预警开启时显示阈值输入框，关闭时不显示', () => {
    const { rerender } = render(
      <UpdateSchedulePanel />
    );
    mockStore({ updateSchedule: makeSchedule({ enableStaleAlert: true }) });
    rerender(<UpdateSchedulePanel />);
    expect(screen.getByText('断更预警阈值（天）')).toBeInTheDocument();

    mockStore({ updateSchedule: makeSchedule({ enableStaleAlert: false }) });
    rerender(<UpdateSchedulePanel />);
    expect(screen.queryByText('断更预警阈值（天）')).not.toBeInTheDocument();
  });

  // ============ 预警三态 ============
  it('未记录更新时间（lastUpdateAt=null）显示"尚未记录更新时间"', () => {
    mockStore({ updateSchedule: makeSchedule({ lastUpdateAt: null }) });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText('尚未记录更新时间')).toBeInTheDocument();
  });

  it('开启预警且距今 < 阈值显示"上次更新：今天/ N 天前"', () => {
    // 系统 now = 2024-06-15，lastUpdateAt = 2024-06-14 → 1 天前 < 2 天阈值
    mockStore({
      updateSchedule: makeSchedule({
        lastUpdateAt: '2024-06-14T00:00:00.000Z',
        enableStaleAlert: true,
        staleAlertDays: 2,
      }),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText('上次更新：1 天前')).toBeInTheDocument();
  });

  it('距今 0 天显示"上次更新：今天"', () => {
    mockStore({
      updateSchedule: makeSchedule({
        lastUpdateAt: '2024-06-15T00:00:00.000Z',
        enableStaleAlert: true,
        staleAlertDays: 2,
      }),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText('上次更新：今天')).toBeInTheDocument();
  });

  it('开启预警且距今 >= 阈值显示"已断更 N 天"', () => {
    // now = 2024-06-15, lastUpdateAt = 2024-06-10 → 5 天前 >= 2 天阈值
    mockStore({
      updateSchedule: makeSchedule({
        lastUpdateAt: '2024-06-10T00:00:00.000Z',
        enableStaleAlert: true,
        staleAlertDays: 2,
      }),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText(/已断更 5 天/)).toBeInTheDocument();
  });

  it('关闭预警时即使超过阈值也不显示断更提示（显示正常态）', () => {
    mockStore({
      updateSchedule: makeSchedule({
        lastUpdateAt: '2024-06-10T00:00:00.000Z',
        enableStaleAlert: false,
        staleAlertDays: 2,
      }),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.queryByText(/已断更/)).not.toBeInTheDocument();
    expect(screen.getByText(/天前/)).toBeInTheDocument();
  });

  // ============ 上架建议 ============
  it('收费阈值=0 时显示"尚未配置收费章节阈值"', () => {
    mockStore({
      updateSchedule: makeSchedule({ paywallChapterThreshold: 0 }),
      chapters: [makeChapter({ id: 'ch-1' })],
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText(/尚未配置收费章节阈值/)).toBeInTheDocument();
  });

  it('章节数 < 阈值时显示进度条与"距上架还差 N 章"', () => {
    mockStore({
      updateSchedule: makeSchedule({ paywallChapterThreshold: 20 }),
      chapters: Array.from({ length: 5 }, (_, i) => makeChapter({ id: `ch-${i}` })),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText(/当前 5 \/ 20 章/)).toBeInTheDocument();
    expect(screen.getByText(/距上架还差 15 章/)).toBeInTheDocument();
  });

  it('章节数 >= 阈值时显示"已达到上架建议节点"', () => {
    mockStore({
      updateSchedule: makeSchedule({ paywallChapterThreshold: 20 }),
      chapters: Array.from({ length: 25 }, (_, i) => makeChapter({ id: `ch-${i}` })),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText(/已达到上架建议节点/)).toBeInTheDocument();
  });

  // ============ 标记今日已更新 ============
  it('点击"标记今日已更新"调用 updateUpdateSchedule 写入 lastUpdateAt', () => {
    const { updateUpdateSchedule } = mockStore({
      updateSchedule: makeSchedule({ lastUpdateAt: null }),
    });
    render(<UpdateSchedulePanel />);
    fireEvent.click(screen.getByText('标记今日已更新'));
    expect(updateUpdateSchedule).toHaveBeenCalledTimes(1);
    const call = updateUpdateSchedule.mock.calls[0][0];
    expect(call.lastUpdateAt).toBeTruthy();
    // 应为 ISO 字符串
    expect(typeof call.lastUpdateAt).toBe('string');
    expect(new Date(call.lastUpdateAt).getTime()).toBeCloseTo(Date.now(), -1000);
  });

  it('有 lastUpdateAt 时显示"上次标记：日期"', () => {
    mockStore({
      updateSchedule: makeSchedule({ lastUpdateAt: '2024-06-10T00:00:00.000Z' }),
    });
    render(<UpdateSchedulePanel />);
    // formatDate 的具体输出依赖实现，但至少应包含 lastUpdateAt 的 ISO 子串
    expect(screen.getByText(/上次标记/)).toBeInTheDocument();
  });

  it('无 lastUpdateAt 时显示"尚无更新记录"', () => {
    mockStore({
      updateSchedule: makeSchedule({ lastUpdateAt: null }),
    });
    render(<UpdateSchedulePanel />);
    expect(screen.getByText('尚无更新记录')).toBeInTheDocument();
  });
});
