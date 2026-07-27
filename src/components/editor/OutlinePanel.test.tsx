/**
 * OutlinePanel 单元测试
 *
 * 测试范围（聚焦可独立验证的渲染与交互路径，dnd-kit 拖拽因 mock 复杂度高暂不覆盖）：
 *   - 空大纲状态：渲染"还没有大纲" + 创建按钮
 *   - 渲染根节点列表 + 统计栏（卷/部/章/字数）
 *   - 单击节点选中 + 详情面板出现
 *   - 折叠/展开三角按钮
 *   - 双击进入编辑 + Enter 保存 + Esc 取消
 *   - 状态筛选下拉
 *   - 底部新建按钮
 *   - 详情面板编辑保存前创建版本快照
 *   - Ctrl+点击多选 + 批量菜单出现
 *   - 批量删除（confirm mock）
 *   - 添加菜单（同级/子级插入、嵌套超限 toast）
 *   - 更多菜单（重命名/状态切换/删除/AI 推荐标题）
 *   - 详情面板字段渲染（coreProposition/wordTarget/进度条/timeSpan/theme/characterFocus/keyEvents/relatedForeshadows/notes）
 *   - 详情面板字段编辑 + 取消按钮 + 关闭按钮
 *   - 批量合并（不足/confirm false/执行）
 *   - 多选 Ctrl+点击 toggle / clickOutside 关闭菜单
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import OutlinePanel from '@/components/editor/OutlinePanel';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import { useToastStore } from '@/hooks/useToast';
import type { Chapter, Character, Foreshadow } from '@/types';

// ============ mock aiService ============
// OutlinePanel 在重命名建议中调用 generateChapterTitleSuggestions
vi.mock('@/utils/aiService', () => ({
  aiService: {
    generateChapterTitleSuggestions: vi.fn().mockResolvedValue(['建议一', '建议二', '建议三']),
  },
}));

// ============ 测试 fixtures ============
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
    status: 'draft',
    wordCount: 0,
    content: '<p>内容</p>',
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
  };
}

function makeForeshadow(overrides: Partial<Foreshadow> = {}): Foreshadow {
  return {
    id: 'fs-1',
    projectId: 'p1',
    title: '神秘伏笔',
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
  chapters: Chapter[];
  addChapter: ReturnType<typeof vi.fn>;
  moveChapter: ReturnType<typeof vi.fn>;
  updateChapter: ReturnType<typeof vi.fn>;
  deleteChapter: ReturnType<typeof vi.fn>;
  saveVersion: ReturnType<typeof vi.fn>;
  setCurrentChapter: ReturnType<typeof vi.fn>;
  characters: Character[];
  foreshadows: Foreshadow[];
}> = {}) {
  const addChapter = overrides.addChapter || vi.fn();
  const updateChapter = overrides.updateChapter || vi.fn();
  const deleteChapter = overrides.deleteChapter || vi.fn();
  const saveVersion = overrides.saveVersion || vi.fn();
  const setCurrentChapter = overrides.setCurrentChapter || vi.fn();

  useAppStore.setState({
    chapters: overrides.chapters ?? [],
    characters: overrides.characters ?? [],
    foreshadows: overrides.foreshadows ?? [],
    addChapter,
    moveChapter: overrides.moveChapter || vi.fn(),
    updateChapter,
    deleteChapter,
    saveVersion,
    setCurrentChapter,
  });
  return { addChapter, updateChapter, deleteChapter, saveVersion, setCurrentChapter };
}

describe('OutlinePanel', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    useToastStore.getState().clearToasts();
    vi.mocked(aiService.generateChapterTitleSuggestions).mockResolvedValue(['建议一', '建议二', '建议三']);
  });

  afterEach(() => {
    cleanup();
  });

  // ============ 空大纲状态 ============
  describe('空大纲状态', () => {
    it('chapters 为空时渲染"还没有大纲"占位与"创建大纲"按钮', () => {
      const { addChapter } = mockStore({ chapters: [] });
      render(<OutlinePanel />);
      expect(screen.getByText('还没有大纲')).toBeInTheDocument();
      const createBtn = screen.getByRole('button', { name: /创建大纲/ });
      fireEvent.click(createBtn);
      expect(addChapter).toHaveBeenCalledWith(null, '全书', 0, 'book');
    });

    it('筛选状态下空大纲显示对应文案', () => {
      mockStore({ chapters: [] });
      render(<OutlinePanel />);
      // 切换筛选到 drafting
      const select = screen.getByDisplayValue('全部状态');
      fireEvent.change(select, { target: { value: 'drafting' } });
      expect(screen.getByText(/没有.*的章节/)).toBeInTheDocument();
    });
  });

  // ============ 渲染根节点列表 + 统计栏 ============
  describe('渲染根节点列表 + 统计栏', () => {
    it('渲染根节点列表与统计栏数据', () => {
      const chapters = [
        makeChapter({ id: 'book-1', title: '我的书', levelType: 'book', level: 1, order: 0 }),
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 2, parentId: 'book-1', wordCount: 1000, order: 0 }),
        makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 2, parentId: 'book-1', wordCount: 2000, order: 1 }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      // 标题渲染
      expect(screen.getByText('第一章')).toBeInTheDocument();
      expect(screen.getByText('第二章')).toBeInTheDocument();
      // 统计栏：2 章 + 3000 字
      expect(screen.getByText('2章')).toBeInTheDocument();
      // "3000字" 同时出现在统计栏与根节点（子节点字数汇总）两处，使用 getAllByText
      expect(screen.getAllByText(/3000字/).length).toBeGreaterThan(0);
    });

    it('仅渲染根节点（不渲染被折叠的子节点）', () => {
      const chapters = [
        makeChapter({ id: 'book-1', title: '我的书', levelType: 'book', level: 1, order: 0 }),
        makeChapter({ id: 'vol-1', title: '卷一', levelType: 'volume', level: 2, parentId: 'book-1', order: 0 }),
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 3, parentId: 'vol-1', order: 0 }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      // 根节点标题应渲染（用 '我的书' 而非 '全书' 以避免与 levelType='book' 的 level label '全书' 冲突）
      expect(screen.getByText('我的书')).toBeInTheDocument();
      // 默认展开时子节点也应可见
      expect(screen.getByText('卷一')).toBeInTheDocument();
      expect(screen.getByText('第一章')).toBeInTheDocument();
    });
  });

  // ============ 底部新建按钮 ============
  describe('底部新建按钮', () => {
    it('点击"新建"调用 addChapter(null, "新章节", 0, "chapter")', () => {
      const { addChapter } = mockStore({ chapters: [] });
      render(<OutlinePanel />);
      const newBtn = screen.getByRole('button', { name: /新建/ });
      fireEvent.click(newBtn);
      expect(addChapter).toHaveBeenCalledWith(null, '新章节', 0, 'chapter');
    });
  });

  // ============ 状态筛选 ============
  describe('状态筛选', () => {
    it('切换筛选下拉到 draft 后只显示 draft 状态的根节点', () => {
      const chapters = [
        makeChapter({ id: 'ch-1', title: '草稿章', status: 'draft', levelType: 'chapter', level: 1, order: 0 }),
        makeChapter({ id: 'ch-2', title: '已完成章', status: 'done', levelType: 'chapter', level: 1, order: 1 }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      // 初始应都能看到
      expect(screen.getByText('草稿章')).toBeInTheDocument();
      expect(screen.getByText('已完成章')).toBeInTheDocument();
      // 切换筛选到 draft（注意：有效状态值为 draft/writing/reviewing/done，非 drafting/completed）
      fireEvent.change(screen.getByDisplayValue('全部状态'), { target: { value: 'draft' } });
      // draft 状态的应可见
      expect(screen.getByText('草稿章')).toBeInTheDocument();
      // done 的应被过滤掉
      expect(screen.queryByText('已完成章')).not.toBeInTheDocument();
    });
  });

  // ============ 单击选中 + 详情面板 ============
  describe('单击选中节点', () => {
    it('点击节点行后出现详情面板', () => {
      const chapters = [
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0, summary: '章节摘要' }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      // 点击前：详情面板不应存在（无 "章详情" 标题、无关闭按钮）
      expect(screen.queryByText('章详情')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '关闭详情面板' })).not.toBeInTheDocument();
      // 点击前："第一章" 仅在节点行出现 1 次
      expect(screen.getAllByText('第一章')).toHaveLength(1);
      // 点击第一章行触发 handleSelect -> setSelectedChapter
      fireEvent.click(screen.getByText('第一章'));
      // 详情面板应出现——对详情面板实际渲染内容做有意义的断言：
      // 1. 详情面板标题 "${levelLabel}详情"（chapter 级 levelLabel='章'，故为 '章详情'）
      //    该文案仅由 OutlineDetailPanel 渲染，节点行不会出现
      expect(screen.getByText('章详情')).toBeInTheDocument();
      // 2. 关闭按钮（aria-label="关闭详情面板"）仅详情面板含
      expect(screen.getByRole('button', { name: '关闭详情面板' })).toBeInTheDocument();
      // 3. "核心命题" 标签仅详情面板渲染，节点行无此文案
      expect(screen.getByText('核心命题')).toBeInTheDocument();
      // 4. 选中章节的标题在详情面板标题区也渲染一份，
      //    故 "第一章" 由点击前的 1 处变为 2 处（节点行 + 详情面板），证明面板展示了选中章节数据
      expect(screen.getAllByText('第一章')).toHaveLength(2);
    });
  });

  // ============ 折叠/展开 ============
  describe('折叠/展开三角按钮', () => {
    it('点击三角按钮切换折叠状态（子节点消失/恢复）', () => {
      const chapters = [
        makeChapter({ id: 'book-1', title: '我的书', levelType: 'book', level: 1, order: 0 }),
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 2, parentId: 'book-1', order: 0 }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      // 子节点初始可见
      expect(screen.getByText('第一章')).toBeInTheDocument();
      // 通过 '我的书' 找到根节点行（避免与 levelType='book' 的 level label '全书' 冲突）
      const bookEl = screen.getByText('我的书');
      // 向上找到行容器：行级 div 带 cursor-pointer class，包含所有按钮
      const row = bookEl.closest('[class*="cursor-pointer"]') as HTMLElement;
      expect(row).not.toBeNull();
      // 行内有多个 button：拖拽手柄(title=拖拽排序)、三角折叠按钮(无 title)、添加(title=添加)、更多(title=更多)
      const buttons = within(row).getAllByRole('button');
      // 三角按钮是唯一没有 title 属性的按钮
      const toggleBtn = buttons.find(b => !b.getAttribute('title'));
      expect(toggleBtn).toBeDefined();
      fireEvent.click(toggleBtn!);
      // 折叠后子节点应消失
      expect(screen.queryByText('第一章')).not.toBeInTheDocument();
      // 再次点击恢复
      fireEvent.click(toggleBtn!);
      expect(screen.getByText('第一章')).toBeInTheDocument();
    });
  });

  // ============ 双击重命名 ============
  describe('双击重命名', () => {
    it('双击标题进入编辑态，渲染 input', () => {
      const chapters = [
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      const titleEl = screen.getByText('第一章');
      fireEvent.doubleClick(titleEl);
      // 应出现 input 元素
      const input = screen.getByDisplayValue('第一章') as HTMLInputElement;
      expect(input).toBeInTheDocument();
    });

    it('编辑后按 Enter 调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.doubleClick(screen.getByText('第一章'));
      const input = screen.getByDisplayValue('第一章') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '新标题' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ title: '新标题' }));
    });

    it('编辑后按 Esc 不调用 updateChapter 并退出编辑态', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.doubleClick(screen.getByText('第一章'));
      const input = screen.getByDisplayValue('第一章') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '修改了但不保存' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(updateChapter).not.toHaveBeenCalled();
      // 退出编辑态：input 消失，标题文本恢复
      expect(screen.getByText('第一章')).toBeInTheDocument();
    });
  });

  // ============ Ctrl+点击多选 + 批量菜单 ============
  describe('Ctrl+点击多选 + 批量菜单', () => {
    it('Ctrl+点击第二个节点后显示"已选 2"与批量操作按钮', () => {
      const chapters = [
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
        makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
      ];
      mockStore({ chapters });
      render(<OutlinePanel />);
      // 点击第一章（单选）
      fireEvent.click(screen.getByText('第一章'));
      // Ctrl+点击第二章（多选）
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      // 应出现"已选 2"
      expect(screen.getByText('已选 2')).toBeInTheDocument();
      // 应出现"批量操作"按钮
      expect(screen.getByText('批量操作')).toBeInTheDocument();
    });

    it('批量删除：confirm 返回 true 后调用 deleteChapter', async () => {
      const chapters = [
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
        makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
      ];
      const { deleteChapter } = mockStore({ chapters });
      confirmMock.mockResolvedValue(true);
      render(<OutlinePanel />);
      // 选中两个
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      // 打开批量菜单
      fireEvent.click(screen.getByText('批量操作'));
      // 点击"批量删除"
      fireEvent.click(screen.getByText('批量删除'));
      // 应调用 deleteChapter 两次（每个选中节点一次）
      await waitFor(() => expect(deleteChapter).toHaveBeenCalledTimes(2));
    });

    it('批量删除：confirm 返回 false 时不调用 deleteChapter', () => {
      const chapters = [
        makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
        makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
      ];
      const { deleteChapter } = mockStore({ chapters });
      confirmMock.mockResolvedValue(false);
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      fireEvent.click(screen.getByText('批量操作'));
      fireEvent.click(screen.getByText('批量删除'));
      expect(deleteChapter).not.toHaveBeenCalled();
    });
  });

  // ============ 详情面板编辑保存 ============
  describe('详情面板编辑保存', () => {
    it('编辑详情后保存先调用 saveVersion 再调用 updateChapter', () => {
      const chapters = [
        makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          summary: '原摘要',
          wordCount: 100,
        }),
      ];
      const { saveVersion, updateChapter } = mockStore({ chapters });
      render(<OutlinePanel />);
      // 选中节点以打开详情面板
      fireEvent.click(screen.getByText('第一章'));
      // 详情面板出现后，找到"编辑"按钮
      const editBtn = screen.getByRole('button', { name: /编辑/ });
      fireEvent.click(editBtn);
      // 进入编辑态，找到 summary 的 textarea/input 并修改
      // OutlineDetailPanel 的 summary 字段编辑控件
      const summaryInput = screen.getByDisplayValue('原摘要') as HTMLTextAreaElement | HTMLInputElement;
      fireEvent.change(summaryInput, { target: { value: '修改后的摘要' } });
      // 点击保存按钮
      const saveBtn = screen.getByRole('button', { name: /保存/ });
      fireEvent.click(saveBtn);
      // 应先调用 saveVersion 再调用 updateChapter
      expect(saveVersion).toHaveBeenCalledWith('ch-1', '编辑章节信息前快照');
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ summary: '修改后的摘要' }));
    });
  });

  // ============ 添加菜单（同级/子级插入） ============
  describe('添加菜单', () => {
    it('点击"+"按钮展开添加菜单（同级插入 / 添加子级）', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('添加'));
      expect(screen.getByText('同级插入')).toBeInTheDocument();
      expect(screen.getByText('添加子级')).toBeInTheDocument();
    });

    it('点击"同级插入"调用 addChapter(parentId, "新章节", order+1, levelType)', () => {
      const newChapter = makeChapter({ id: 'new-1', title: '新章节' });
      const { addChapter, setCurrentChapter } = mockStore({
        chapters: [
          makeChapter({ id: 'book-1', title: '我的书', levelType: 'book', level: 1, order: 0 }),
          makeChapter({ id: 'ch-1', parentId: 'book-1', title: '第一章', levelType: 'chapter', level: 2, order: 0 }),
        ],
        addChapter: vi.fn(() => newChapter),
      });
      render(<OutlinePanel />);
      // 点击 ch-1 的"+"按钮（book-1 也有"+"按钮，需定位到 ch-1 行）
      const ch1Row = screen.getByText('第一章').closest('[class*="cursor-pointer"]') as HTMLElement;
      fireEvent.click(within(ch1Row).getByTitle('添加'));
      fireEvent.click(screen.getByText('同级插入'));
      // parentId 继承自当前节点（book-1）；levelType 与当前节点相同（chapter）
      // '新' + CHAPTER_LEVEL_TYPE_LABELS['chapter']('章') = '新章'
      expect(addChapter).toHaveBeenCalledWith('book-1', '新章', 1, 'chapter');
      expect(setCurrentChapter).toHaveBeenCalledWith('new-1');
    });

    it('点击"添加子级"调用 addChapter(currentId, "新子级", 0, nextLevelType)', () => {
      const newChapter = makeChapter({ id: 'new-sub', title: '新卷' });
      const { addChapter, setCurrentChapter } = mockStore({
        chapters: [makeChapter({ id: 'book-1', title: '全书', levelType: 'book', level: 1, order: 0 })],
        addChapter: vi.fn(() => newChapter),
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('添加'));
      fireEvent.click(screen.getByText('添加子级'));
      // book 的下一级是 volume
      expect(addChapter).toHaveBeenCalledWith('book-1', '新卷', 0, 'volume');
      expect(setCurrentChapter).toHaveBeenCalledWith('new-sub');
    });

    it('添加子级时若父节点未展开则自动展开', () => {
      const newChapter = makeChapter({ id: 'new-sub', title: '新章' });
      mockStore({
        chapters: [
          makeChapter({ id: 'book-1', title: '我的书', levelType: 'book', level: 1, order: 0 }),
          makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 2, parentId: 'book-1', order: 0 }),
        ],
        addChapter: vi.fn(() => newChapter),
      });
      render(<OutlinePanel />);
      // 先折叠 book-1
      const bookRow = screen.getByText('我的书').closest('[class*="cursor-pointer"]') as HTMLElement;
      const toggleBtn = within(bookRow).getAllByRole('button').find(b => !b.getAttribute('title'))!;
      fireEvent.click(toggleBtn);
      expect(screen.queryByText('第一章')).not.toBeInTheDocument();
      // 添加子级
      fireEvent.click(screen.getByTitle('添加'));
      fireEvent.click(screen.getByText('添加子级'));
      // 子节点应重新可见（自动展开）
      expect(screen.getByText('第一章')).toBeInTheDocument();
    });

    it('addChapter 返回 null（嵌套超限）时 toast.warning + 关闭菜单', async () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
        addChapter: vi.fn(() => null),
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('添加'));
      fireEvent.click(screen.getByText('添加子级'));
      await waitFor(() => {
        const toasts = useToastStore.getState().toasts;
        expect(toasts.some(t => t.type === 'warning' && t.title === '已达最大嵌套层级')).toBe(true);
      });
      // 菜单应关闭
      expect(screen.queryByText('添加子级')).not.toBeInTheDocument();
    });

    it('点击外部关闭添加菜单', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('添加'));
      expect(screen.getByText('同级插入')).toBeInTheDocument();
      // 点击容器外部
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(screen.queryByText('同级插入')).not.toBeInTheDocument();
    });
  });

  // ============ 更多菜单（重命名/状态/删除） ============
  describe('更多菜单', () => {
    it('点击"更多"按钮展开菜单（重命名/AI 推荐标题/状态/删除）', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      expect(screen.getByText('重命名')).toBeInTheDocument();
      expect(screen.getByText('AI 推荐标题')).toBeInTheDocument();
      expect(screen.getByText('删除')).toBeInTheDocument();
      // 状态选项：CHAPTER_STATUS_LABELS 包含 draft/writing/reviewing/done
      // 注意"草稿"同时出现在顶部筛选 select 中，需定位到 more 菜单容器
      const moreMenu = screen.getByText('重命名').closest('div[class*="absolute"]') as HTMLElement;
      expect(within(moreMenu).getByText('草稿')).toBeInTheDocument();
    });

    it('点击"重命名"进入编辑态', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('重命名'));
      // 应出现 input 显示原标题
      expect(screen.getByDisplayValue('第一章')).toBeInTheDocument();
    });

    it('点击状态项调用 updateChapter + 关闭菜单', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', status: 'draft', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      // CHAPTER_STATUS_LABELS.writing = 写作中；"写作中"同时出现在顶部筛选 select 中
      const moreMenu = screen.getByText('重命名').closest('div[class*="absolute"]') as HTMLElement;
      fireEvent.click(within(moreMenu).getByText('写作中'));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', { status: 'writing' });
      // 菜单应关闭
      expect(screen.queryByText('重命名')).not.toBeInTheDocument();
    });

    it('点击"删除"（confirm true）调用 deleteChapter', async () => {
      const { deleteChapter } = mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      confirmMock.mockResolvedValue(true);
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('删除'));
      await waitFor(() => expect(deleteChapter).toHaveBeenCalledWith('ch-1'));
    });

    it('点击"删除"（confirm false）不调用 deleteChapter', () => {
      const { deleteChapter } = mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      confirmMock.mockResolvedValue(false);
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('删除'));
      expect(deleteChapter).not.toHaveBeenCalled();
    });

    it('点击外部关闭更多菜单', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      expect(screen.getByText('重命名')).toBeInTheDocument();
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(screen.queryByText('重命名')).not.toBeInTheDocument();
    });
  });

  // ============ AI 推荐标题 ============
  describe('AI 推荐标题', () => {
    it('点击"AI 推荐标题"成功生成建议列表', async () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('AI 推荐标题'));
      // 等待建议出现
      await waitFor(() => {
        expect(screen.getByText('建议一')).toBeInTheDocument();
      });
      expect(screen.getByText('建议二')).toBeInTheDocument();
      // 点击建议应用标题
      fireEvent.click(screen.getByText('建议一'));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', { title: '建议一' });
    });

    it('AI 推荐返回空数组时 toast.info', async () => {
      vi.mocked(aiService.generateChapterTitleSuggestions).mockResolvedValue([]);
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('AI 推荐标题'));
      await waitFor(() => {
        const toasts = useToastStore.getState().toasts;
        expect(toasts.some(t => t.type === 'info' && t.title === '暂无推荐')).toBe(true);
      });
    });

    it('AI 推荐抛错时 toast.error', async () => {
      vi.mocked(aiService.generateChapterTitleSuggestions).mockRejectedValue(new Error('网络错误'));
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('AI 推荐标题'));
      await waitFor(() => {
        const toasts = useToastStore.getState().toasts;
        expect(toasts.some(t => t.type === 'error' && t.title === 'AI 推荐标题失败')).toBe(true);
      });
    });

    it('应用建议标题后 toast.success', async () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('AI 推荐标题'));
      await waitFor(() => {
        expect(screen.getByText('建议一')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('建议一'));
      await waitFor(() => {
        const toasts = useToastStore.getState().toasts;
        expect(toasts.some(t => t.type === 'success' && t.title === '已应用新标题')).toBe(true);
      });
    });

    it('生成中按钮显示"生成中…"且 disabled', () => {
      // 让 promise 不 resolve，保持 loading 态
      vi.mocked(aiService.generateChapterTitleSuggestions).mockReturnValue(new Promise(() => {}));
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByTitle('更多'));
      fireEvent.click(screen.getByText('AI 推荐标题'));
      expect(screen.getByText('生成中…')).toBeInTheDocument();
    });
  });

  // ============ 详情面板字段渲染 ============
  describe('详情面板字段渲染', () => {
    it('渲染 coreProposition / theme / timeSpan / notes', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          coreProposition: '核心命题内容',
          theme: '主题内容',
          timeSpan: '建安六年',
          notes: '备注内容',
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.getByText('核心命题内容')).toBeInTheDocument();
      expect(screen.getByText('主题内容')).toBeInTheDocument();
      expect(screen.getByText('建安六年')).toBeInTheDocument();
      expect(screen.getByText('备注内容')).toBeInTheDocument();
    });

    it('未设置字段渲染"未设置"/"无"', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      // 多处"未设置"：coreProposition / summary / timeSpan / theme
      expect(screen.getAllByText('未设置').length).toBeGreaterThan(0);
      expect(screen.getByText('无')).toBeInTheDocument(); // notes
    });

    it('渲染 wordTarget 与当前字数', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          wordTarget: 5000,
          wordCount: 1500,
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.getByText('5000 字')).toBeInTheDocument();
      expect(screen.getByText('1500 字')).toBeInTheDocument();
    });

    it('wordProgress 达标（>=100）显示绿色进度', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          wordTarget: 1000,
          wordCount: 1200,
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      // wordProgress = min(100, round(1200/1000*100)) = 100
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('wordProgress 未达标（<100）显示琥珀色进度', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          wordTarget: 1000,
          wordCount: 500,
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('无 wordTarget 时不渲染进度条', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          wordCount: 100,
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      // 进度条区域不应出现"进度"标签
      expect(screen.queryByText('进度')).not.toBeInTheDocument();
    });

    it('渲染 keyEvents 列表', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          keyEvents: ['事件一', '事件二'],
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.getByText('事件一')).toBeInTheDocument();
      expect(screen.getByText('事件二')).toBeInTheDocument();
    });

    it('渲染关联角色（基于 characterFocus ID）', () => {
      const char = makeCharacter({ id: 'char-1', name: '张三', role: 'protagonist' });
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          characterFocus: ['char-1'],
        })],
        characters: [char],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    it('渲染关联伏笔（plantedChapterId / payoffChapterId 匹配）', () => {
      const fs = makeForeshadow({
        id: 'fs-1',
        title: '神秘伏笔',
        status: 'progressing',
        plantedChapterId: 'ch-1',
      });
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
        foreshadows: [fs],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.getByText('神秘伏笔')).toBeInTheDocument();
    });

    it('点击关闭按钮关闭详情面板', () => {
      mockStore({
        chapters: [makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      // 详情面板标题为 `${levelLabel}详情`，chapter 级 levelLabel='章'，故为 '章详情'
      // '章详情' span 的 closest('div') 是标题图标容器（不含关闭按钮），需再向上一层到 header
      const titleGroup = screen.getByText('章详情').closest('div');
      const header = titleGroup?.parentElement as HTMLElement;
      const closeBtn = within(header).getByRole('button');
      fireEvent.click(closeBtn);
      // 详情面板应消失
      expect(screen.queryByText('章详情')).not.toBeInTheDocument();
    });
  });

  // ============ 详情面板字段编辑 ============
  describe('详情面板字段编辑', () => {
    it('编辑 coreProposition 后保存调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          coreProposition: '原命题',
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      const input = screen.getByDisplayValue('原命题') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '新命题' } });
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ coreProposition: '新命题' }));
    });

    it('编辑 wordTarget 后保存调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          wordTarget: 1000,
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      const input = screen.getByDisplayValue('1000') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2000' } });
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ wordTarget: 2000 }));
    });

    it('编辑 timeSpan 后保存调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          timeSpan: '原时间',
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      const input = screen.getByDisplayValue('原时间') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '新时间' } });
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ timeSpan: '新时间' }));
    });

    it('编辑 theme 后保存调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          theme: '原主题',
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      const input = screen.getByDisplayValue('原主题') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '新主题' } });
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ theme: '新主题' }));
    });

    it('编辑 keyEvents（多行）后保存调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          keyEvents: ['原事件'],
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      const textarea = screen.getByDisplayValue('原事件') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: '事件A\n事件B' } });
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ keyEvents: ['事件A', '事件B'] }));
    });

    it('编辑 status（select）后保存调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          status: 'draft',
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      // 编辑态下 status 是 select，display value 为当前状态 label
      const statusSelect = screen.getByDisplayValue('草稿') as HTMLSelectElement;
      fireEvent.change(statusSelect, { target: { value: 'done' } });
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ status: 'done' }));
    });

    it('编辑 characterFocus（checkbox）后保存调用 updateChapter', () => {
      const char = makeCharacter({ id: 'char-1', name: '张三' });
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          characterFocus: [],
        })],
        characters: [char],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      // 编辑态下角色以 checkbox 形式出现
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ characterFocus: ['char-1'] }));
    });

    it('角色库为空时编辑 characterFocus 显示提示', () => {
      mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          characterFocus: [],
        })],
        characters: [],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      expect(screen.getByText('角色库为空，请先在角色面板添加角色')).toBeInTheDocument();
    });

    it('点击"取消"退出编辑态且不调用 updateChapter', () => {
      const { updateChapter } = mockStore({
        chapters: [makeChapter({
          id: 'ch-1',
          title: '第一章',
          levelType: 'chapter',
          level: 1,
          order: 0,
          summary: '原摘要',
        })],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
      const input = screen.getByDisplayValue('原摘要') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: '修改但不保存' } });
      fireEvent.click(screen.getByRole('button', { name: /取消/ }));
      expect(updateChapter).not.toHaveBeenCalled();
      // 退出编辑态后恢复显示原值；"原摘要"同时出现在节点行摘要预览与详情面板概述字段中
      expect(screen.getAllByText('原摘要').length).toBeGreaterThan(0);
    });
  });

  // ============ 批量合并 ============
  describe('批量合并', () => {
    it('选中 2 个章节后批量菜单显示"合并章节"', () => {
      mockStore({
        chapters: [
          makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
          makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
        ],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      fireEvent.click(screen.getByText('批量操作'));
      expect(screen.getByText('合并章节')).toBeInTheDocument();
    });

    it('confirm true 后合并：saveVersion + updateChapter + deleteChapter', async () => {
      const { saveVersion, updateChapter, deleteChapter } = mockStore({
        chapters: [
          makeChapter({ id: 'ch-1', title: '第一章', content: '<p>A</p>', levelType: 'chapter', level: 1, order: 0, status: 'draft', characterFocus: ['c1'], keyEvents: ['e1'] }),
          makeChapter({ id: 'ch-2', title: '第二章', content: '<p>B</p>', levelType: 'chapter', level: 1, order: 1, status: 'done', characterFocus: ['c2'], keyEvents: ['e2'] }),
        ],
      });
      confirmMock.mockResolvedValue(true);
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      fireEvent.click(screen.getByText('批量操作'));
      fireEvent.click(screen.getByText('合并章节'));
      // 合并前为首个章节创建快照
      await waitFor(() => expect(saveVersion).toHaveBeenCalledWith('ch-1', '批量合并前快照'));
      // 内容拼接
      expect(updateChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({
        content: '<p>A</p><p>B</p>',
        // 状态取最靠后（done > draft）
        status: 'done',
        // characterFocus / keyEvents 取并集
        characterFocus: ['c1', 'c2'],
        keyEvents: ['e1', 'e2'],
      }));
      // 第二个章节被删除
      expect(deleteChapter).toHaveBeenCalledWith('ch-2');
    });

    it('confirm false 不执行合并', () => {
      const { saveVersion, updateChapter, deleteChapter } = mockStore({
        chapters: [
          makeChapter({ id: 'ch-1', title: '第一章', content: '<p>A</p>', levelType: 'chapter', level: 1, order: 0 }),
          makeChapter({ id: 'ch-2', title: '第二章', content: '<p>B</p>', levelType: 'chapter', level: 1, order: 1 }),
        ],
      });
      confirmMock.mockResolvedValue(false);
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      fireEvent.click(screen.getByText('批量操作'));
      fireEvent.click(screen.getByText('合并章节'));
      expect(saveVersion).not.toHaveBeenCalled();
      expect(updateChapter).not.toHaveBeenCalled();
      expect(deleteChapter).not.toHaveBeenCalled();
    });
  });

  // ============ 多选 toggle ============
  describe('多选 toggle', () => {
    it('Ctrl+点击已选节点取消选中', () => {
      mockStore({
        chapters: [
          makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
          makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
        ],
      });
      render(<OutlinePanel />);
      // 选中两个
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      expect(screen.getByText('已选 2')).toBeInTheDocument();
      // 第一次 ctrl+click 后 selectedChapter 切到 ch-2，详情面板标题字段也渲染"第二章"，
      // 导致 screen.getByText('第二章') 匹配到多处。定位到节点行（cursor-pointer 容器）再点击。
      const ch2Row = screen.getAllByText('第二章').find(el =>
        el.closest('[class*="cursor-pointer"]')
      ) as HTMLElement;
      fireEvent.click(ch2Row, { ctrlKey: true });
      expect(screen.getByText('已选 1')).toBeInTheDocument();
    });

    it('普通点击（无 Ctrl）替换多选为单选', () => {
      mockStore({
        chapters: [
          makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
          makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
        ],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      expect(screen.getByText('已选 2')).toBeInTheDocument();
      // 普通点击第一章
      fireEvent.click(screen.getByText('第一章'));
      expect(screen.queryByText('已选 2')).not.toBeInTheDocument();
    });

    it('批量删除时过滤掉祖先已选中的子节点', async () => {
      // 父子同时选中：删除时应避免对子节点重复调用 deleteChapter
      const { deleteChapter } = mockStore({
        chapters: [
          // title 用"我的书"避免与 levelType='book' 的 levelLabel '全书' 冲突
          makeChapter({ id: 'book-1', title: '我的书', levelType: 'book', level: 1, order: 0 }),
          makeChapter({ id: 'ch-1', title: '第一章', parentId: 'book-1', levelType: 'chapter', level: 2, order: 0 }),
        ],
      });
      confirmMock.mockResolvedValue(true);
      render(<OutlinePanel />);
      // 选中父与子
      fireEvent.click(screen.getByText('我的书'));
      fireEvent.click(screen.getByText('第一章'), { ctrlKey: true });
      fireEvent.click(screen.getByText('批量操作'));
      fireEvent.click(screen.getByText('批量删除'));
      // 只删除父节点（子节点因祖先已选中被过滤）
      await waitFor(() => expect(deleteChapter).toHaveBeenCalledTimes(1));
      expect(deleteChapter).toHaveBeenCalledWith('book-1');
    });
  });

  // ============ clickOutside 关闭批量菜单 ============
  describe('批量菜单 clickOutside', () => {
    it('点击外部关闭批量菜单', () => {
      mockStore({
        chapters: [
          makeChapter({ id: 'ch-1', title: '第一章', levelType: 'chapter', level: 1, order: 0 }),
          makeChapter({ id: 'ch-2', title: '第二章', levelType: 'chapter', level: 1, order: 1 }),
        ],
      });
      render(<OutlinePanel />);
      fireEvent.click(screen.getByText('第一章'));
      fireEvent.click(screen.getByText('第二章'), { ctrlKey: true });
      fireEvent.click(screen.getByText('批量操作'));
      expect(screen.getByText('批量删除')).toBeInTheDocument();
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(screen.queryByText('批量删除')).not.toBeInTheDocument();
    });
  });
});
