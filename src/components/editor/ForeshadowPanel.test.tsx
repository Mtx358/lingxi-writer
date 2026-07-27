/**
 * ForeshadowPanel 单元测试
 *
 * 测试范围：
 *   - 空状态：渲染"暂无伏笔"
 *   - 添加伏笔：打开输入框 → 输入 → Enter/点击添加 → addForeshadow
 *   - 状态筛选标签：全部/已埋/推进/已收/废弃
 *   - 各状态计数显示
 *   - 点击伏笔展开/折叠（显示 description / notes）
 *   - 点击状态图标循环切换状态 → updateForeshadow
 *   - 长时间未提及的"已埋"伏笔显示警告样式
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ForeshadowPanel from '@/components/editor/ForeshadowPanel';
import { useAppStore } from '@/store/useAppStore';
import { FORESHADOW_STALE_THRESHOLD } from '@/constants/config';
import type { Foreshadow } from '@/types';

// ============ fixtures ============
function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    id: 'fs-1',
    projectId: 'p1',
    title: '神秘戒指',
    description: '主角父亲临终前留下的戒指',
    status: 'planted',
    plantedChapterId: null,
    payoffChapterId: null,
    priority: 'medium',
    relatedCharacters: [],
    relatedSettings: [],
    chaptersSinceMention: 0,
    notes: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============ store mock 辅助 ============
function mockStore(overrides: Partial<{
  foreshadows: Foreshadow[];
  addForeshadow: ReturnType<typeof vi.fn>;
  updateForeshadow: ReturnType<typeof vi.fn>;
}> = {}) {
  const addForeshadow = overrides.addForeshadow || vi.fn();
  const updateForeshadow = overrides.updateForeshadow || vi.fn();

  useAppStore.setState({
    foreshadows: overrides.foreshadows ?? [],
    addForeshadow,
    updateForeshadow,
  });

  return { addForeshadow, updateForeshadow };
}

describe('ForeshadowPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ============ 空状态 ============
  it('无伏笔时渲染"暂无伏笔"', () => {
    mockStore({ foreshadows: [] });
    render(<ForeshadowPanel />);
    expect(screen.getByText('暂无伏笔')).toBeInTheDocument();
  });

  it('标题"伏笔看板"始终渲染', () => {
    mockStore();
    render(<ForeshadowPanel />);
    expect(screen.getByText('伏笔看板')).toBeInTheDocument();
  });

  // ============ 添加伏笔 ============
  it('点击 + 按钮打开添加输入框', () => {
    mockStore({ foreshadows: [] });
    render(<ForeshadowPanel />);
    const addBtn = screen.getByText('伏笔看板').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    expect(screen.getByPlaceholderText('伏笔名称...')).toBeInTheDocument();
  });

  it('输入名称 + Enter 调用 addForeshadow', () => {
    const { addForeshadow } = mockStore({ foreshadows: [] });
    render(<ForeshadowPanel />);
    const addBtn = screen.getByText('伏笔看板').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    const input = screen.getByPlaceholderText('伏笔名称...');
    fireEvent.change(input, { target: { value: '神秘信件' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addForeshadow).toHaveBeenCalledWith({ title: '神秘信件', status: 'planted' });
  });

  it('输入名称 + 点击"添加"按钮调用 addForeshadow', () => {
    const { addForeshadow } = mockStore({ foreshadows: [] });
    render(<ForeshadowPanel />);
    const addBtn = screen.getByText('伏笔看板').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    fireEvent.change(screen.getByPlaceholderText('伏笔名称...'), { target: { value: '古老地图' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addForeshadow).toHaveBeenCalledWith({ title: '古老地图', status: 'planted' });
  });

  it('空名称时不调用 addForeshadow', () => {
    const { addForeshadow } = mockStore({ foreshadows: [] });
    render(<ForeshadowPanel />);
    const addBtn = screen.getByText('伏笔看板').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    fireEvent.click(screen.getByText('添加'));
    expect(addForeshadow).not.toHaveBeenCalled();
  });

  it('点击"取消"关闭添加输入框', () => {
    mockStore({ foreshadows: [] });
    render(<ForeshadowPanel />);
    const addBtn = screen.getByText('伏笔看板').parentElement?.querySelector('button');
    fireEvent.click(addBtn!);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('伏笔名称...')).not.toBeInTheDocument();
  });

  // ============ 列表渲染 ============
  it('渲染伏笔标题', () => {
    mockStore({ foreshadows: [makeForeshadow({ title: '神秘戒指' })] });
    render(<ForeshadowPanel />);
    expect(screen.getByText('神秘戒指')).toBeInTheDocument();
  });

  it('渲染状态标签（已埋/推进/已收/废弃）', () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'fs-1', title: '伏笔1', status: 'planted' }),
        makeForeshadow({ id: 'fs-2', title: '伏笔2', status: 'progressing' }),
        makeForeshadow({ id: 'fs-3', title: '伏笔3', status: 'paid-off' }),
        makeForeshadow({ id: 'fs-4', title: '伏笔4', status: 'abandoned' }),
      ],
    });
    render(<ForeshadowPanel />);
    // 状态标签会出现在筛选 tab + 每个 foreshadow 卡片
    expect(screen.getAllByText('已埋').length).toBeGreaterThan(0);
    expect(screen.getAllByText('推进中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已回收').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已废弃').length).toBeGreaterThan(0);
  });

  it('chaptersSinceMention > 0 时显示"N章未提"', () => {
    mockStore({
      foreshadows: [makeForeshadow({ chaptersSinceMention: 5 })],
    });
    render(<ForeshadowPanel />);
    expect(screen.getByText(/5章未提/)).toBeInTheDocument();
  });

  it('chaptersSinceMention = 0 时不显示"N章未提"', () => {
    mockStore({
      foreshadows: [makeForeshadow({ chaptersSinceMention: 0 })],
    });
    render(<ForeshadowPanel />);
    expect(screen.queryByText(/章未提/)).not.toBeInTheDocument();
  });

  // ============ 筛选 ============
  it('筛选 tab 显示各状态计数', () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'fs-1', status: 'planted' }),
        makeForeshadow({ id: 'fs-2', status: 'planted' }),
        makeForeshadow({ id: 'fs-3', status: 'paid-off' }),
      ],
    });
    render(<ForeshadowPanel />);
    // 全部=3, 已埋=2, 已收=1
    // 各 tab 后跟一个 span 显示计数
    const allTab = screen.getByText('全部').closest('button')!;
    expect(allTab.querySelector('span')?.textContent).toBe('3');
    const plantedTab = screen.getByText('已埋').closest('button')!;
    expect(plantedTab.querySelector('span')?.textContent).toBe('2');
    const paidOffTab = screen.getByText('已收').closest('button')!;
    expect(paidOffTab.querySelector('span')?.textContent).toBe('1');
  });

  it('点击"已收"筛选 tab 仅显示已回收的伏笔', () => {
    mockStore({
      foreshadows: [
        makeForeshadow({ id: 'fs-1', title: '埋设的', status: 'planted' }),
        makeForeshadow({ id: 'fs-2', title: '回收的', status: 'paid-off' }),
      ],
    });
    render(<ForeshadowPanel />);
    // 初始全部显示
    expect(screen.getByText('埋设的')).toBeInTheDocument();
    expect(screen.getByText('回收的')).toBeInTheDocument();
    // 点击"已收"筛选
    fireEvent.click(screen.getByText('已收'));
    expect(screen.queryByText('埋设的')).not.toBeInTheDocument();
    expect(screen.getByText('回收的')).toBeInTheDocument();
  });

  it('筛选后无匹配项时显示"暂无伏笔"', () => {
    mockStore({
      foreshadows: [makeForeshadow({ id: 'fs-1', status: 'planted' })],
    });
    render(<ForeshadowPanel />);
    fireEvent.click(screen.getByText('已收'));
    expect(screen.getByText('暂无伏笔')).toBeInTheDocument();
  });

  // ============ 展开/折叠 ============
  it('点击伏笔卡片展开显示 description', () => {
    mockStore({
      foreshadows: [makeForeshadow({ description: '详细描述内容' })],
    });
    render(<ForeshadowPanel />);
    // 初始未展开
    expect(screen.queryByText('详细描述内容')).not.toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByText('神秘戒指'));
    expect(screen.getByText('详细描述内容')).toBeInTheDocument();
  });

  it('展开时显示 notes（若有）', () => {
    mockStore({
      foreshadows: [makeForeshadow({ notes: '作者备忘录' })],
    });
    render(<ForeshadowPanel />);
    fireEvent.click(screen.getByText('神秘戒指'));
    expect(screen.getByText('作者备忘录')).toBeInTheDocument();
  });

  it('再次点击伏笔卡片折叠', () => {
    mockStore({
      foreshadows: [makeForeshadow({ description: '详细描述' })],
    });
    render(<ForeshadowPanel />);
    fireEvent.click(screen.getByText('神秘戒指'));
    expect(screen.getByText('详细描述')).toBeInTheDocument();
    fireEvent.click(screen.getByText('神秘戒指'));
    expect(screen.queryByText('详细描述')).not.toBeInTheDocument();
  });

  // ============ 状态切换 ============
  it('点击状态图标循环切换状态 → updateForeshadow', () => {
    const { updateForeshadow } = mockStore({
      foreshadows: [makeForeshadow({ id: 'fs-x', status: 'planted' })],
    });
    render(<ForeshadowPanel />);
    // title 文本来自 FORESHADOW_STATUS_LABELS.planted = '已埋设'
    const statusBtn = screen.getByTitle('点击切换状态：已埋设');
    fireEvent.click(statusBtn);
    // planted → progressing
    expect(updateForeshadow).toHaveBeenCalledWith('fs-x', { status: 'progressing' });
  });

  it('循环到末尾回到首个状态', () => {
    const { updateForeshadow } = mockStore({
      foreshadows: [makeForeshadow({ id: 'fs-x', status: 'abandoned' })],
    });
    render(<ForeshadowPanel />);
    const statusBtn = screen.getByTitle('点击切换状态：已废弃');
    fireEvent.click(statusBtn);
    // abandoned → planted (循环)
    expect(updateForeshadow).toHaveBeenCalledWith('fs-x', { status: 'planted' });
  });

  // ============ 警告状态 ============
  it('planted 状态 + chaptersSinceMention >= 阈值时显示警告图标', () => {
    mockStore({
      foreshadows: [makeForeshadow({
        status: 'planted',
        chaptersSinceMention: FORESHADOW_STALE_THRESHOLD,
      })],
    });
    render(<ForeshadowPanel />);
    // 警告图标 AlertCircle：用 class 选择器（lucide-react 渲染为 svg.lucide-alert-circle）
    // 当 isWarning=true 时渲染；用 find 遍历所有 svg 避免选择器细节差异
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    const alertSvg = allSvgs.find(s => {
      const cls = s.getAttribute('class') || '';
      return cls.includes('alert');
    });
    expect(alertSvg).toBeDefined();
  });

  it('planted 状态但 chaptersSinceMention < 阈值时不显示警告', () => {
    mockStore({
      foreshadows: [makeForeshadow({
        status: 'planted',
        chaptersSinceMention: FORESHADOW_STALE_THRESHOLD - 1,
      })],
    });
    render(<ForeshadowPanel />);
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    const alertSvg = allSvgs.find(s => {
      const cls = s.getAttribute('class') || '';
      return cls.includes('alert');
    });
    expect(alertSvg).toBeUndefined();
  });

  it('非 planted 状态即使 chaptersSinceMention 高也不显示警告', () => {
    mockStore({
      foreshadows: [makeForeshadow({
        status: 'progressing',
        chaptersSinceMention: FORESHADOW_STALE_THRESHOLD + 10,
      })],
    });
    render(<ForeshadowPanel />);
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    const alertSvg = allSvgs.find(s => {
      const cls = s.getAttribute('class') || '';
      return cls.includes('alert');
    });
    expect(alertSvg).toBeUndefined();
  });
});
