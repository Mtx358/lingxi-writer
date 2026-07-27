/**
 * SubplotPanel 单元测试
 *
 * 测试范围：
 *   - 顶层：标题"支线管理" / 新增支线按钮 / 空状态 + 创建按钮
 *   - 新增支线调用 addSubplot
 *   - SubplotCard：
 *     - 标题显示 / 未命名支线 fallback / 点击进入编辑 + Enter 提交 / Esc 取消
 *     - 状态徽章 + status select 切换
 *     - 简介双向绑定
 *     - 关联章节三个 select（开启/最近推进/预计收束）+ orphan 警告
 *     - 关联角色 chips toggle / 关联伏笔 chips toggle
 *     - 备注双向绑定
 *     - 元信息：创建/最近推进时间显示
 *     - 推进按钮 disabled（无当前章节）+ 点击调用 progressSubplot
 *     - 删除按钮 + confirm true/false
 *     - 状态预警：progressing > 14 天 / open > 7 天
 *     - 已关闭状态显示 opacity-60
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import SubplotPanel from '@/components/editor/SubplotPanel';
import { useAppStore } from '@/store/useAppStore';
import type { Subplot, Chapter, Character, Foreshadow } from '@/types';

// ============ fixtures ============
function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'chap-1',
    projectId: 'p1',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 0,
    level: 1,
    levelType: 'chapter',
    status: 'writing',
    wordCount: 100,
    content: '<p>章节内容</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSubplot(overrides: Partial<Subplot> = {}): Subplot {
  return {
    id: 'sub-1',
    projectId: 'p1',
    title: '复仇支线',
    description: '主角为父报仇',
    status: 'open',
    startChapterId: null,
    lastProgressChapterId: null,
    expectedCloseChapterId: null,
    relatedCharacters: [],
    relatedForeshadows: [],
    notes: '',
    lastProgressAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    projectId: 'p1',
    name: '张三',
    role: 'protagonist',
    color: '#ff0000',
    profile: {},
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    id: 'fore-1',
    projectId: 'p1',
    title: '神秘信物',
    description: '',
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
  subplots: Subplot[];
  chapters: Chapter[];
  characters: Character[];
  foreshadows: Foreshadow[];
  currentChapterId: string | null;
  addSubplot: ReturnType<typeof vi.fn>;
  updateSubplot: ReturnType<typeof vi.fn>;
  deleteSubplot: ReturnType<typeof vi.fn>;
  progressSubplot: ReturnType<typeof vi.fn>;
}> = {}) {
  const addSubplot = overrides.addSubplot || vi.fn();
  const updateSubplot = overrides.updateSubplot || vi.fn();
  const deleteSubplot = overrides.deleteSubplot || vi.fn();
  const progressSubplot = overrides.progressSubplot || vi.fn();

  useAppStore.setState({
    subplots: overrides.subplots ?? [],
    chapters: overrides.chapters ?? [],
    characters: overrides.characters ?? [],
    foreshadows: overrides.foreshadows ?? [],
    currentChapterId: overrides.currentChapterId ?? null,
    addSubplot,
    updateSubplot,
    deleteSubplot,
    progressSubplot,
  });

  return { addSubplot, updateSubplot, deleteSubplot, progressSubplot };
}

describe('SubplotPanel', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  // ============ 顶层渲染 ============
  it('空状态渲染"暂无支线"+创建按钮', () => {
    mockStore({ subplots: [] });
    render(<SubplotPanel />);
    expect(screen.getByText('暂无支线')).toBeInTheDocument();
    expect(screen.getByText('创建第一条支线')).toBeInTheDocument();
  });

  it('标题"支线管理"始终渲染', () => {
    mockStore({ subplots: [] });
    render(<SubplotPanel />);
    expect(screen.getByText('支线管理')).toBeInTheDocument();
  });

  it('点击顶部"新增支线"按钮调用 addSubplot', () => {
    const { addSubplot } = mockStore({ subplots: [] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('新增支线'));
    expect(addSubplot).toHaveBeenCalledWith({ title: '新支线', description: '' });
  });

  it('点击空状态"创建第一条支线"按钮调用 addSubplot', () => {
    const { addSubplot } = mockStore({ subplots: [] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('创建第一条支线'));
    expect(addSubplot).toHaveBeenCalledTimes(1);
  });

  // ============ SubplotCard: 标题 ============
  it('渲染支线标题', () => {
    mockStore({ subplots: [makeSubplot({ title: '复仇支线' })] });
    render(<SubplotPanel />);
    expect(screen.getByText('复仇支线')).toBeInTheDocument();
  });

  it('空标题显示"（未命名支线）"', () => {
    mockStore({ subplots: [makeSubplot({ title: '' })] });
    render(<SubplotPanel />);
    expect(screen.getByText('（未命名支线）')).toBeInTheDocument();
  });

  it('点击标题进入编辑模式', () => {
    mockStore({ subplots: [makeSubplot({ title: '原标题' })] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('原标题'));
    // 编辑框出现
    expect(screen.getByDisplayValue('原标题')).toBeInTheDocument();
  });

  it('Enter 提交标题修改', () => {
    const { updateSubplot } = mockStore({ subplots: [makeSubplot({ title: '原标题' })] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('原标题'));
    const input = screen.getByDisplayValue('原标题');
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { title: '新标题' });
  });

  it('Esc 取消标题编辑不提交', () => {
    const { updateSubplot } = mockStore({ subplots: [makeSubplot({ title: '原标题' })] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('原标题'));
    const input = screen.getByDisplayValue('原标题');
    fireEvent.change(input, { target: { value: '不该提交' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(updateSubplot).not.toHaveBeenCalled();
  });

  it('空字符串提交时回滚到原标题', () => {
    const { updateSubplot } = mockStore({ subplots: [makeSubplot({ title: '原标题' })] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('原标题'));
    const input = screen.getByDisplayValue('原标题');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 空白 trim 后为空，应回滚不调用 updateSubplot
    expect(updateSubplot).not.toHaveBeenCalled();
  });

  // ============ 状态徽章 + select ============
  // 状态标签同时出现在 select options 和徽章中，需用 getAllByText
  it('渲染状态徽章（已开启）', () => {
    mockStore({ subplots: [makeSubplot({ status: 'open' })] });
    render(<SubplotPanel />);
    expect(screen.getAllByText('已开启').length).toBeGreaterThanOrEqual(1);
  });

  it('切换 status select 调用 updateSubplot', () => {
    const { updateSubplot } = mockStore({ subplots: [makeSubplot({ status: 'open' })] });
    render(<SubplotPanel />);
    const select = screen.getByLabelText('切换支线状态');
    fireEvent.change(select, { target: { value: 'progressing' } });
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { status: 'progressing' });
  });

  it('已关闭支线 opacity-60', () => {
    mockStore({ subplots: [makeSubplot({ status: 'closed' })] });
    render(<SubplotPanel />);
    // 状态徽章是 span（不是 select option），用 getAllByText 后过滤 span
    const labels = screen.getAllByText('已收束');
    const badge = labels.find(el => el.tagName === 'SPAN');
    const card = badge?.closest('.card');
    expect(card?.className).toContain('opacity-60');
  });

  // ============ 简介 ============
  it('修改简介调用 updateSubplot', () => {
    const { updateSubplot } = mockStore({ subplots: [makeSubplot()] });
    render(<SubplotPanel />);
    const textarea = screen.getByPlaceholderText('一句话描述支线目标…');
    fireEvent.change(textarea, { target: { value: '新简介' } });
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { description: '新简介' });
  });

  // ============ 关联章节 ============
  it('无章节时显示"尚无章节可关联"', () => {
    mockStore({
      subplots: [makeSubplot()],
      chapters: [],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('尚无章节可关联')).toBeInTheDocument();
  });

  it('有章节时三个 select 渲染章节选项', () => {
    mockStore({
      subplots: [makeSubplot()],
      chapters: [makeChapter({ id: 'c1', title: '第一章' })],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('开启章节')).toBeInTheDocument();
    expect(screen.getByText('最近推进章节')).toBeInTheDocument();
    expect(screen.getByText('预计收束章节')).toBeInTheDocument();
  });

  it('非 chapter levelType 不进入选项', () => {
    mockStore({
      subplots: [makeSubplot()],
      chapters: [
        makeChapter({ id: 'vol1', title: '第一卷', levelType: 'volume' }),
        makeChapter({ id: 'c1', title: '第一章', levelType: 'chapter' }),
      ],
    });
    render(<SubplotPanel />);
    // "第一卷"不出现在 select options 中（select 默认会渲染所有 option，但选中态显示其 value 对应的 label）
    // 通过查询开启章节 select 的 options
    const selects = screen.getAllByRole('combobox');
    // 第二个 select 是开启章节（第一个是 status select）
    const startSelect = selects[1];
    const options = Array.from(startSelect.querySelectorAll('option'));
    const optionTexts = options.map(o => o.textContent);
    expect(optionTexts).toContain('第一章');
    expect(optionTexts).not.toContain('第一卷');
  });

  it('orphan 章节显示警告', () => {
    mockStore({
      subplots: [makeSubplot({ startChapterId: 'deleted-chap' })],
      chapters: [makeChapter({ id: 'c1', title: '第一章' })],
    });
    render(<SubplotPanel />);
    expect(screen.getAllByText('引用的章节已被删除，请重新选择').length).toBeGreaterThan(0);
  });

  it('修改开启章节调用 updateSubplot', () => {
    const { updateSubplot } = mockStore({
      subplots: [makeSubplot({ startChapterId: null })],
      chapters: [makeChapter({ id: 'c1', title: '第一章' })],
    });
    render(<SubplotPanel />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'c1' } });
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { startChapterId: 'c1' });
  });

  it('清空开启章节调用 updateSubplot 传 null', () => {
    const { updateSubplot } = mockStore({
      subplots: [makeSubplot({ startChapterId: 'c1' })],
      chapters: [makeChapter({ id: 'c1', title: '第一章' })],
    });
    render(<SubplotPanel />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: '' } });
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { startChapterId: null });
  });

  // ============ 关联角色 chips ============
  it('无角色时显示"尚无角色可关联"', () => {
    mockStore({
      subplots: [makeSubplot()],
      characters: [],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('尚无角色可关联')).toBeInTheDocument();
  });

  it('点击角色 chip toggle 关联', () => {
    const { updateSubplot } = mockStore({
      subplots: [makeSubplot({ relatedCharacters: [] })],
      characters: [makeCharacter({ id: 'char-1', name: '张三' })],
    });
    render(<SubplotPanel />);
    const chip = screen.getByText('张三');
    fireEvent.click(chip);
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { relatedCharacters: ['char-1'] });
  });

  it('已关联角色再点击取消关联', () => {
    const { updateSubplot } = mockStore({
      subplots: [makeSubplot({ relatedCharacters: ['char-1'] })],
      characters: [makeCharacter({ id: 'char-1', name: '张三' })],
    });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('张三'));
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { relatedCharacters: [] });
  });

  // ============ 关联伏笔 chips ============
  it('无伏笔时显示"尚无伏笔可关联"', () => {
    mockStore({
      subplots: [makeSubplot()],
      foreshadows: [],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('尚无伏笔可关联')).toBeInTheDocument();
  });

  it('点击伏笔 chip toggle 关联', () => {
    const { updateSubplot } = mockStore({
      subplots: [makeSubplot({ relatedForeshadows: [] })],
      foreshadows: [makeForeshadow({ id: 'fore-1', title: '神秘信物' })],
    });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('神秘信物'));
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { relatedForeshadows: ['fore-1'] });
  });

  // ============ 备注 ============
  it('修改备注调用 updateSubplot', () => {
    const { updateSubplot } = mockStore({ subplots: [makeSubplot()] });
    render(<SubplotPanel />);
    const textarea = screen.getByPlaceholderText('支线推进要点、注意事项…');
    fireEvent.change(textarea, { target: { value: '新备注' } });
    expect(updateSubplot).toHaveBeenCalledWith('sub-1', { notes: '新备注' });
  });

  // ============ 元信息 ============
  it('显示创建时间 + 最近推进时间', () => {
    mockStore({
      subplots: [makeSubplot({
        createdAt: '2024-03-15T10:00:00.000Z',
        lastProgressAt: '2024-04-20T10:00:00.000Z',
      })],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('创建于 2024-03-15')).toBeInTheDocument();
    expect(screen.getByText('最近推进 2024-04-20')).toBeInTheDocument();
  });

  it('lastProgressAt 为 null 显示"—"', () => {
    mockStore({
      subplots: [makeSubplot({ lastProgressAt: null })],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('最近推进 —')).toBeInTheDocument();
  });

  // ============ 推进按钮 ============
  it('无当前章节时推进按钮 disabled + 提示', () => {
    mockStore({
      subplots: [makeSubplot()],
      currentChapterId: null,
    });
    render(<SubplotPanel />);
    const progressBtn = screen.getByText('推进到本章').closest('button');
    expect(progressBtn?.disabled).toBe(true);
    expect(screen.getByText('尚未选中章节，无法推进')).toBeInTheDocument();
  });

  it('点击推进按钮调用 progressSubplot', () => {
    const { progressSubplot } = mockStore({
      subplots: [makeSubplot()],
      chapters: [makeChapter({ id: 'chap-1', title: '第一章' })],
      currentChapterId: 'chap-1',
    });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('推进到本章'));
    expect(progressSubplot).toHaveBeenCalledWith('sub-1', 'chap-1');
  });

  it('有当前章节时推进按钮 title 显示章节标题', () => {
    mockStore({
      subplots: [makeSubplot()],
      chapters: [makeChapter({ id: 'chap-1', title: '序章' })],
      currentChapterId: 'chap-1',
    });
    render(<SubplotPanel />);
    const progressBtn = screen.getByText('推进到本章').closest('button');
    expect(progressBtn?.title).toBe('推进到「序章」');
  });

  // ============ 删除按钮 ============
  it('点击删除 + confirm true 调用 deleteSubplot', async () => {
    const { deleteSubplot } = mockStore({ subplots: [makeSubplot({ title: '复仇支线' })] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('删除'));
    expect(confirmMock).toHaveBeenCalledWith('删除支线「复仇支线」？');
    await waitFor(() => expect(deleteSubplot).toHaveBeenCalledWith('sub-1'));
  });

  it('confirm false 时不调用 deleteSubplot', () => {
    confirmMock.mockResolvedValue(false);
    const { deleteSubplot } = mockStore({ subplots: [makeSubplot()] });
    render(<SubplotPanel />);
    fireEvent.click(screen.getByText('删除'));
    expect(deleteSubplot).not.toHaveBeenCalled();
  });

  // ============ 状态预警 ============
  it('progressing 状态 + >14 天未推进显示橙色预警', () => {
    const oldDate = new Date('2024-06-01T00:00:00.000Z');
    const twentyDaysAgo = new Date(oldDate.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(oldDate);
    mockStore({
      subplots: [makeSubplot({
        status: 'progressing',
        lastProgressAt: twentyDaysAgo,
      })],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('已 20 天未推进')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('open 状态 + >7 天未推进显示琥珀色预警', () => {
    const oldDate = new Date('2024-06-01T00:00:00.000Z');
    const tenDaysAgo = new Date(oldDate.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(oldDate);
    mockStore({
      subplots: [makeSubplot({
        status: 'open',
        createdAt: tenDaysAgo,
        lastProgressAt: null,
      })],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('开启已久未推进')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('closed 状态不显示推进预警', () => {
    const oldDate = new Date('2024-06-01T00:00:00.000Z');
    const twentyDaysAgo = new Date(oldDate.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(oldDate);
    mockStore({
      subplots: [makeSubplot({
        status: 'closed',
        lastProgressAt: twentyDaysAgo,
      })],
    });
    render(<SubplotPanel />);
    expect(screen.queryByText(/天未推进/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('非法 lastProgressAt 不显示预警', () => {
    mockStore({
      subplots: [makeSubplot({
        status: 'progressing',
        lastProgressAt: 'invalid-date',
      })],
    });
    render(<SubplotPanel />);
    expect(screen.queryByText(/天未推进/)).not.toBeInTheDocument();
  });

  // ============ 多卡片渲染 ============
  it('多个支线渲染多张卡片', () => {
    mockStore({
      subplots: [
        makeSubplot({ id: 'sub-1', title: '支线一' }),
        makeSubplot({ id: 'sub-2', title: '支线二' }),
        makeSubplot({ id: 'sub-3', title: '支线三' }),
      ],
    });
    render(<SubplotPanel />);
    expect(screen.getByText('支线一')).toBeInTheDocument();
    expect(screen.getByText('支线二')).toBeInTheDocument();
    expect(screen.getByText('支线三')).toBeInTheDocument();
  });
});
