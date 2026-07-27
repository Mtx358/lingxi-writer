/**
 * CharactersPanel 单元测试
 *
 * 测试范围：
 *   - 顶层：标题"角色列表" / + 按钮 / 空状态
 *   - 新增角色：input + Enter/click + 取消 + 空姓名保护
 *   - 角色列表：name + role label + 展开/收起 + 切换选中
 *   - 详情面板：personality/motivation/weakness 显示 + 编辑/删除按钮
 *   - 删除：confirm true/false + 删除后清空选中
 *   - CharacterEditor:
 *     - 12 个内置字段渲染 + onBlur commit（单行/多行）
 *     - 自定义字段：+ / 添加(空/重名/正常/Enter) / 取消 / 删除 / 已有字段渲染
 *     - 角色关系：+ / 添加 / 双向同步(REVERSE_RELATIONSHIP_MAP) / 自定义类型回退 / 删除双向同步 / 已存在去重
 *     - 完成按钮
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import CharactersPanel from '@/components/editor/CharactersPanel';
import { useAppStore } from '@/store/useAppStore';
import type { Character } from '@/types';

// ============ fixtures ============
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

// ============ store mock ============
// updateCharacter 默认真实更新 store，便于编辑器内部 getLatestChar 读取最新状态
// 否则连续修改字段时闭包过期会导致后一次覆盖前一次
function mockStore(overrides: Partial<{
  characters: Character[];
  addCharacter: ReturnType<typeof vi.fn>;
  updateCharacter: ReturnType<typeof vi.fn>;
  deleteCharacter: ReturnType<typeof vi.fn>;
}> = {}) {
  const addCharacter = overrides.addCharacter || vi.fn();
  const deleteCharacter = overrides.deleteCharacter || vi.fn();
  const updateCharacter = overrides.updateCharacter || vi.fn((id: string, updates: Partial<Character>) => {
    useAppStore.setState(s => ({
      characters: s.characters.map(c => (c.id === id ? { ...c, ...updates } : c)),
    }));
  });

  useAppStore.setState({
    characters: overrides.characters ?? [],
    addCharacter,
    updateCharacter,
    deleteCharacter,
  });

  return { addCharacter, updateCharacter, deleteCharacter };
}

// 顶部 + 按钮（无 title，通过 svg.lucide-plus 定位）
function findTopAddButton() {
  return screen.getAllByRole('button').find(
    b => b.querySelector('svg.lucide-plus') !== null
  );
}

// 关系表单中"关联角色" select：与"选择或输入关系类型..." input（带 list 属性 → role=combobox）
// 共存时均为 combobox，需通过 SELECT 标签或首个 option 文本精确定位
function findRelationTargetSelect() {
  return screen.getAllByRole('combobox').find(
    c => c.tagName === 'SELECT' &&
      Array.from(c.querySelectorAll('option')).some(o => o.textContent === '选择角色...')
  )!;
}

describe('CharactersPanel', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  // ============ 顶层渲染 ============
  it('空状态渲染"还没有角色"+提示', () => {
    mockStore({ characters: [] });
    render(<CharactersPanel />);
    expect(screen.getByText('还没有角色')).toBeInTheDocument();
    expect(screen.getByText('点击 + 添加第一个角色')).toBeInTheDocument();
  });

  it('标题"角色列表"始终渲染', () => {
    mockStore({ characters: [] });
    render(<CharactersPanel />);
    expect(screen.getByText('角色列表')).toBeInTheDocument();
  });

  // ============ 新增角色 ============
  it('点击顶部 + 按钮展开新增表单', () => {
    mockStore({ characters: [] });
    render(<CharactersPanel />);
    expect(screen.queryByPlaceholderText('角色姓名...')).not.toBeInTheDocument();
    fireEvent.click(findTopAddButton()!);
    expect(screen.getByPlaceholderText('角色姓名...')).toBeInTheDocument();
  });

  it('输入姓名 + Enter 调用 addCharacter（默认 supporting 角色）', () => {
    const { addCharacter } = mockStore({ characters: [] });
    render(<CharactersPanel />);
    fireEvent.click(findTopAddButton()!);
    const input = screen.getByPlaceholderText('角色姓名...');
    fireEvent.change(input, { target: { value: '李四' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addCharacter).toHaveBeenCalledWith({ name: '李四', role: 'supporting' });
  });

  it('输入姓名 + 点击"添加"调用 addCharacter', () => {
    const { addCharacter } = mockStore({ characters: [] });
    render(<CharactersPanel />);
    fireEvent.click(findTopAddButton()!);
    fireEvent.change(screen.getByPlaceholderText('角色姓名...'), { target: { value: '王五' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addCharacter).toHaveBeenCalledWith({ name: '王五', role: 'supporting' });
  });

  it('点击"取消"收起新增表单', () => {
    mockStore({ characters: [] });
    render(<CharactersPanel />);
    fireEvent.click(findTopAddButton()!);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('角色姓名...')).not.toBeInTheDocument();
  });

  it('空姓名不调用 addCharacter', () => {
    const { addCharacter } = mockStore({ characters: [] });
    render(<CharactersPanel />);
    fireEvent.click(findTopAddButton()!);
    fireEvent.change(screen.getByPlaceholderText('角色姓名...'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addCharacter).not.toHaveBeenCalled();
  });

  // ============ 角色列表 ============
  it('渲染角色姓名 + 角色定位 label', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', role: 'protagonist' })],
    });
    render(<CharactersPanel />);
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('主角')).toBeInTheDocument();
  });

  it('点击角色展开详情，再次点击收起', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    const name = screen.getByText('张三');
    expect(screen.queryByText('编辑')).not.toBeInTheDocument();
    fireEvent.click(name);
    expect(screen.getByText('编辑')).toBeInTheDocument();
    fireEvent.click(name);
    expect(screen.queryByText('编辑')).not.toBeInTheDocument();
  });

  it('切换选中角色时前一个自动收起', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    expect(screen.getAllByText('编辑').length).toBe(1);
    fireEvent.click(screen.getByText('李四'));
    expect(screen.getAllByText('编辑').length).toBe(1);
  });

  it('多角色渲染所有姓名 + label', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三', role: 'protagonist' }),
        makeCharacter({ id: 'c2', name: '李四', role: 'antagonist' }),
        makeCharacter({ id: 'c3', name: '王五', role: 'supporting' }),
      ],
    });
    render(<CharactersPanel />);
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('王五')).toBeInTheDocument();
    expect(screen.getByText('主角')).toBeInTheDocument();
    expect(screen.getByText('反派')).toBeInTheDocument();
    expect(screen.getByText('配角')).toBeInTheDocument();
  });

  // ============ 详情面板 ============
  it('展开详情显示性格/动机/弱点', () => {
    mockStore({
      characters: [makeCharacter({
        id: 'c1',
        name: '张三',
        profile: {
          personality: '冷静果断',
          motivation: '为父报仇',
          weakness: '过度自信',
        },
      })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    expect(screen.getByText('冷静果断')).toBeInTheDocument();
    expect(screen.getByText('为父报仇')).toBeInTheDocument();
    expect(screen.getByText('过度自信')).toBeInTheDocument();
  });

  it('无 profile 字段时不显示对应行', () => {
    mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    expect(screen.queryByText('性格：')).not.toBeInTheDocument();
  });

  it('点击"编辑"展开 CharacterEditor', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    // 编辑器渲染内置字段 label（取一个标志性 label）
    expect(screen.getByText('成长弧光')).toBeInTheDocument();
  });

  // ============ 删除 ============
  it('点击"删除"+ confirm true 调用 deleteCharacter', async () => {
    const { deleteCharacter } = mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('删除'));
    expect(confirmMock).toHaveBeenCalledWith('删除角色"张三"？');
    await waitFor(() => expect(deleteCharacter).toHaveBeenCalledWith('c1'));
  });

  it('confirm false 不调用 deleteCharacter', () => {
    confirmMock.mockResolvedValue(false);
    const { deleteCharacter } = mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三' })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('删除'));
    expect(deleteCharacter).not.toHaveBeenCalled();
  });

  it('删除后清空选中状态', async () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    expect(screen.getByText('编辑')).toBeInTheDocument();
    fireEvent.click(screen.getByText('删除'));
    // 删除后选中清空 → 编辑按钮消失
    await waitFor(() => expect(screen.queryByText('编辑')).not.toBeInTheDocument());
  });

  // ============ CharacterEditor: 内置字段 ============
  it('渲染所有 12 个内置字段 label', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    const labels = ['年龄', '性别', '外貌', '性格', '背景', '动机', '目标', '弱点', '恐惧', '成长弧光', '职业', '技能'];
    labels.forEach(label => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
  });

  it('编辑单行字段 + blur 提交 updateCharacter', () => {
    const { updateCharacter } = mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    const ageInput = screen.getByPlaceholderText('输入年龄...');
    fireEvent.change(ageInput, { target: { value: '25' } });
    fireEvent.blur(ageInput);
    expect(updateCharacter).toHaveBeenCalledWith('c1', { profile: { age: '25' } });
  });

  it('编辑多行字段 + blur 提交 updateCharacter', () => {
    const { updateCharacter } = mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    const personalityInput = screen.getByPlaceholderText('输入性格...');
    fireEvent.change(personalityInput, { target: { value: '沉稳' } });
    fireEvent.blur(personalityInput);
    expect(updateCharacter).toHaveBeenCalledWith('c1', { profile: { personality: '沉稳' } });
  });

  // ============ CharacterEditor: 自定义字段 ============
  it('无自定义字段时显示"点击 + 添加自定义字段"', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByText('点击 + 添加自定义字段')).toBeInTheDocument();
  });

  it('点击 + 展开自定义字段添加表单', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    expect(screen.getByPlaceholderText('字段名（如：口头禅）')).toBeInTheDocument();
  });

  it('添加空字段名显示"字段名不能为空"', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    fireEvent.click(screen.getByText('添加'));
    expect(screen.getByText('字段名不能为空')).toBeInTheDocument();
  });

  it('添加已存在自定义字段显示"该字段已存在"', () => {
    mockStore({
      characters: [makeCharacter({
        id: 'c1', name: '张三',
        profile: { 口头禅: '呵呵' },
      })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    fireEvent.change(
      screen.getByPlaceholderText('字段名（如：口头禅）'),
      { target: { value: '口头禅' } }
    );
    fireEvent.click(screen.getByText('添加'));
    expect(screen.getByText('该字段已存在')).toBeInTheDocument();
  });

  it('添加与内置 key 重名显示"该字段已存在"', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    // 内置 key 为英文（age/gender/...），输入 age 触发 BUILTIN_PROFILE_KEYS 冲突
    fireEvent.change(
      screen.getByPlaceholderText('字段名（如：口头禅）'),
      { target: { value: 'age' } }
    );
    fireEvent.click(screen.getByText('添加'));
    expect(screen.getByText('该字段已存在')).toBeInTheDocument();
  });

  it('添加新字段调用 updateCharacter', () => {
    const { updateCharacter } = mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    fireEvent.change(
      screen.getByPlaceholderText('字段名（如：口头禅）'),
      { target: { value: '口头禅' } }
    );
    fireEvent.click(screen.getByText('添加'));
    expect(updateCharacter).toHaveBeenCalledWith('c1', { profile: { 口头禅: '' } });
  });

  it('Enter 键提交自定义字段添加', () => {
    const { updateCharacter } = mockStore({
      characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    const input = screen.getByPlaceholderText('字段名（如：口头禅）');
    fireEvent.change(input, { target: { value: '口头禅' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateCharacter).toHaveBeenCalledWith('c1', { profile: { 口头禅: '' } });
  });

  it('取消自定义字段添加收起表单', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三', profile: {} })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加字段'));
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('字段名（如：口头禅）')).not.toBeInTheDocument();
  });

  it('渲染已有自定义字段 + 值', () => {
    mockStore({
      characters: [makeCharacter({
        id: 'c1', name: '张三',
        profile: { 口头禅: '呵呵' },
      })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByText('口头禅')).toBeInTheDocument();
    expect(screen.getByDisplayValue('呵呵')).toBeInTheDocument();
  });

  it('删除自定义字段调用 updateCharacter（过滤后 profile）', () => {
    const { updateCharacter } = mockStore({
      characters: [makeCharacter({
        id: 'c1', name: '张三',
        profile: { 口头禅: '呵呵' },
      })],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('删除字段'));
    expect(updateCharacter).toHaveBeenCalledWith('c1', { profile: {} });
  });

  // ============ CharacterEditor: 角色关系 ============
  it('无关系时显示"点击 + 添加角色关系"', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByText('点击 + 添加角色关系')).toBeInTheDocument();
  });

  it('点击 + 展开关系添加表单', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加关系'));
    expect(screen.getByText('关联角色')).toBeInTheDocument();
    expect(screen.getByText('关系类型')).toBeInTheDocument();
    expect(screen.getByText('关系描述')).toBeInTheDocument();
    expect(screen.getByText('关系强度')).toBeInTheDocument();
  });

  it('关联角色 select 只显示其他角色（不含当前角色）', () => {
    mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加关系'));
    const targetSelect = findRelationTargetSelect();
    const options = Array.from(targetSelect.querySelectorAll('option')).map(o => o.textContent);
    expect(options).toContain('李四');
    expect(options).not.toContain('张三');
  });

  it('未选关联角色 + 点击添加 不调用 updateCharacter', () => {
    const { updateCharacter } = mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加关系'));
    // 只填关系类型，不选关联角色
    fireEvent.change(
      screen.getByPlaceholderText('选择或输入关系类型...'),
      { target: { value: '父子' } }
    );
    fireEvent.click(screen.getByText('添加'));
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('添加关系触发双向同步（父子 → 子父）', () => {
    const { updateCharacter } = mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加关系'));
    fireEvent.change(findRelationTargetSelect(), { target: { value: 'c2' } });
    fireEvent.change(
      screen.getByPlaceholderText('选择或输入关系类型...'),
      { target: { value: '父子' } }
    );
    fireEvent.click(screen.getByText('添加'));
    // 源 → 目标：父子
    expect(updateCharacter).toHaveBeenCalledWith('c1', {
      relationships: [{ targetId: 'c2', type: '父子', description: '', intensity: 50 }],
    });
    // 目标 → 源：子父（REVERSE_RELATIONSHIP_MAP）
    expect(updateCharacter).toHaveBeenCalledWith('c2', {
      relationships: [{ targetId: 'c1', type: '子父', description: '', intensity: 50 }],
    });
  });

  it('自定义关系类型不在映射表中时反向使用原类型', () => {
    const { updateCharacter } = mockStore({
      characters: [
        makeCharacter({ id: 'c1', name: '张三' }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加关系'));
    fireEvent.change(findRelationTargetSelect(), { target: { value: 'c2' } });
    fireEvent.change(
      screen.getByPlaceholderText('选择或输入关系类型...'),
      { target: { value: '青梅竹马' } }
    );
    fireEvent.click(screen.getByText('添加'));
    // 不在 REVERSE_RELATIONSHIP_MAP 中 → 反向使用原类型
    expect(updateCharacter).toHaveBeenCalledWith('c2', {
      relationships: [{ targetId: 'c1', type: '青梅竹马', description: '', intensity: 50 }],
    });
  });

  it('删除关系触发双向同步', () => {
    const { updateCharacter } = mockStore({
      characters: [
        makeCharacter({
          id: 'c1', name: '张三',
          relationships: [{ targetId: 'c2', type: '父子', description: '', intensity: 50 }],
        }),
        makeCharacter({
          id: 'c2', name: '李四',
          relationships: [{ targetId: 'c1', type: '子父', description: '', intensity: 50 }],
        }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    // 关系卡片上的 X 按钮（lucide-x svg）
    const xBtn = screen.getAllByRole('button').find(
      b => b.querySelector('svg.lucide-x') !== null
    );
    fireEvent.click(xBtn!);
    expect(updateCharacter).toHaveBeenCalledWith('c1', { relationships: [] });
    expect(updateCharacter).toHaveBeenCalledWith('c2', { relationships: [] });
  });

  it('反向关系已存在时不重复添加到目标', () => {
    const { updateCharacter } = mockStore({
      characters: [
        makeCharacter({
          id: 'c1', name: '张三',
          relationships: [{ targetId: 'c2', type: '父子', description: '', intensity: 50 }],
        }),
        makeCharacter({
          id: 'c2', name: '李四',
          relationships: [{ targetId: 'c1', type: '子父', description: '', intensity: 50 }],
        }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加关系'));
    fireEvent.change(findRelationTargetSelect(), { target: { value: 'c2' } });
    fireEvent.change(
      screen.getByPlaceholderText('选择或输入关系类型...'),
      { target: { value: '父子' } }
    );
    fireEvent.click(screen.getByText('添加'));
    // c1 调用一次（源始终追加），c2 不调用（alreadyExists 阻止）
    const c1Calls = updateCharacter.mock.calls.filter(([id]) => id === 'c1');
    const c2Calls = updateCharacter.mock.calls.filter(([id]) => id === 'c2');
    expect(c1Calls.length).toBe(1);
    expect(c2Calls.length).toBe(0);
  });

  it('已存在关系卡片渲染（名称 + 类型徽章 + 描述）', () => {
    mockStore({
      characters: [
        makeCharacter({
          id: 'c1', name: '张三',
          relationships: [{ targetId: 'c2', type: '父子', description: '血缘至亲', intensity: 90 }],
        }),
        makeCharacter({ id: 'c2', name: '李四' }),
      ],
    });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    // 关系卡片渲染：关系类型徽章 + 描述（这两个文本仅在卡片中）
    // "李四"在角色列表 + 关系卡片均出现，用 getAllByText 验证存在
    expect(screen.getAllByText('李四').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('父子')).toBeInTheDocument();
    expect(screen.getByText('血缘至亲')).toBeInTheDocument();
  });

  // ============ 完成按钮 ============
  it('点击"完成"收起编辑器（详情面板重新显示）', () => {
    mockStore({ characters: [makeCharacter({ id: 'c1', name: '张三' })] });
    render(<CharactersPanel />);
    fireEvent.click(screen.getByText('张三'));
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByText('完成'));
    // 编辑器收起 → "成长弧光" label 消失
    expect(screen.queryByText('成长弧光')).not.toBeInTheDocument();
    // 详情面板重新显示 → 编辑按钮可见
    expect(screen.getByText('编辑')).toBeInTheDocument();
  });
});
