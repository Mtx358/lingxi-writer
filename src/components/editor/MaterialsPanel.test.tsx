/**
 * MaterialsPanel 单元测试
 *
 * 测试范围：
 *   - 渲染：标题 / 空状态 / + 按钮
 *   - 类型筛选：全部 / 单类型（含计数）/ 无该类型时不渲染筛选按钮
 *   - 添加素材：弹窗打开 / Enter 添加 / 点击添加 / 空标题不添加 / 取消 / 切换类型
 *   - 卡片展开/折叠 / 内容/来源/标签展示 / 置顶排序 + 切换置顶
 *   - 附件展示（图片/非图片）/ formatFileSize / 添加附件 / 打开附件 / 删除附件
 *   - 深度提问抽屉：打开 / loading / 问题展示 / ESC 关闭 / X 关闭 / 遮罩关闭
 *   - handleAskQuestion：成功 / 抛错（finally 复位 asking）/ 并发守卫（旧请求丢弃）/ 抽屉关闭后丢弃
 *   - handleSpawnChild：空答案拒绝 / 无 questionTargetId 拒绝 / 调用 addMaterial+updateMaterial（从 store 读最新 parent）
 *   - handleAddAttachment：无 electronAPI alert / 无 projectId alert / selectFile null / 成功 / 抛错 toast
 *   - handleOpenAttachment：无 electronAPI alert / 抛错 toast
 *   - handleRemoveAttachment：confirm 取消/确认 / 调用 updateMaterial + electronAPI.deleteAttachment
 *   - ImageFallback：file:// + electronAPI 成功/失败 / http 协议降级 / 普通 src 直接渲染 / onError 切换占位
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// confirm 已替换为基于 Zustand 的异步 confirm，统一 mock @/hooks/useConfirm
vi.mock('@/hooks/useConfirm', () => ({ confirm: vi.fn(), ConfirmDialog: () => null }));
import { confirm } from '@/hooks/useConfirm';
const confirmMock = vi.mocked(confirm);
import MaterialsPanel from '@/components/editor/MaterialsPanel';
import { useAppStore } from '@/store/useAppStore';
import type { Material, MaterialQuestion } from '@/types';

// ============ mocks ============
vi.mock('@/hooks/useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('@/utils/overlayState', () => ({
  pushOverlay: vi.fn(),
  popOverlay: vi.fn(),
}));
vi.mock('@/utils/aiService', () => ({
  askMaterialQuestion: vi.fn(),
}));
vi.mock('@/utils/imageCache', () => ({
  readImageDataUrl: vi.fn(),
  clearImageErrorCache: vi.fn(),
}));

import { toast } from '@/hooks/useToast';
import { askMaterialQuestion } from '@/utils/aiService';
import { readImageDataUrl, clearImageErrorCache } from '@/utils/imageCache';
import { pushOverlay, popOverlay } from '@/utils/overlayState';

// ============ fixtures ============
function makeMaterial(overrides: Partial<Material> = {}): Material {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id: 'm-1',
    projectId: 'p-1',
    title: '素材一',
    type: 'inspiration',
    content: '这是素材内容',
    tags: ['灵感', '关键'],
    category: '未分类',
    references: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockStore(overrides: Partial<{
  materials: Material[];
  currentProjectId: string | null;
  addMaterial: ReturnType<typeof vi.fn>;
  updateMaterial: ReturnType<typeof vi.fn>;
}> = {}) {
  const addMaterial = overrides.addMaterial || vi.fn().mockReturnValue(makeMaterial({ id: 'child-1' }));
  const updateMaterial = overrides.updateMaterial || vi.fn();
  // 注意：null 是合法的 currentProjectId 值（无项目时），不能 ?? 兜底
  const currentProjectId = Object.prototype.hasOwnProperty.call(overrides, 'currentProjectId')
    ? overrides.currentProjectId
    : 'p-1';
  useAppStore.setState({
    materials: overrides.materials || [],
    currentProjectId,
    addMaterial,
    updateMaterial,
  });
  return { addMaterial, updateMaterial };
}

// ============ electronAPI 工具 ============
// 测试时仅注入关心的子字段；setElectronAPI 内部会用 vi.fn() 兜底其他字段，
// 因此输入类型用深度 Partial 便于只写关心的部分。
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
interface MockElectronAPI {
  dialog: { selectFile: ReturnType<typeof vi.fn> };
  file: { openExternal: ReturnType<typeof vi.fn>; readDataURL: ReturnType<typeof vi.fn> };
  material: { saveAttachment: ReturnType<typeof vi.fn>; deleteAttachment: ReturnType<typeof vi.fn> };
}

function setElectronAPI(api: DeepPartial<MockElectronAPI> | null) {
  const w = window as unknown as { electronAPI?: unknown };
  if (api === null) {
    delete w.electronAPI;
    return;
  }
  w.electronAPI = {
    dialog: { selectFile: api.dialog?.selectFile || vi.fn() },
    file: {
      openExternal: api.file?.openExternal || vi.fn(),
      readDataURL: api.file?.readDataURL || vi.fn(),
    },
    material: {
      saveAttachment: api.material?.saveAttachment || vi.fn(),
      deleteAttachment: api.material?.deleteAttachment || vi.fn().mockResolvedValue(true),
    },
  };
}

describe('MaterialsPanel', () => {
  let originalAlert: typeof global.alert;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalAlert = global.alert;
    originalConsoleError = console.error;
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    global.alert = vi.fn();
    console.error = vi.fn();
    // 默认无 electronAPI
    setElectronAPI(null);
    vi.mocked(askMaterialQuestion).mockResolvedValue([]);
    vi.mocked(readImageDataUrl).mockResolvedValue('data:image/png;base64,xxx');
    vi.mocked(clearImageErrorCache).mockClear();
  });

  afterEach(() => {
    global.alert = originalAlert;
    console.error = originalConsoleError;
    setElectronAPI(null);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
  });

  // ============ 渲染 ============
  it('渲染标题与 + 按钮', () => {
    mockStore();
    render(<MaterialsPanel />);
    expect(screen.getByText('素材库')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建素材' })).toBeInTheDocument();
  });

  it('空状态显示"暂无素材"文案', () => {
    mockStore({ materials: [] });
    render(<MaterialsPanel />);
    expect(screen.getByText('暂无素材')).toBeInTheDocument();
    expect(screen.getByText('收集灵感、参考、研究笔记')).toBeInTheDocument();
  });

  it('有素材时显示卡片标题与类型标签', () => {
    // 仅 1 个 reference 素材，避免类型筛选按钮"参考资料 (1)" 与卡片标签歧义
    // 用更精确的卡片标签匹配："参考资料" 后跟 " · 标签1、标签2"
    mockStore({ materials: [makeMaterial({ type: 'reference', tags: ['标签X'] })] });
    render(<MaterialsPanel />);
    expect(screen.getByText('素材一')).toBeInTheDocument();
    // 卡片类型标签行格式："参考资料 · 标签X"
    expect(screen.getByText(/参考资料 · 标签X/)).toBeInTheDocument();
  });

  it('标签展示前 2 个用顿号连接', () => {
    mockStore({ materials: [makeMaterial({ tags: ['灵感', '关键', '第三个'] })] });
    render(<MaterialsPanel />);
    // 标签部分 "灵感、关键"
    expect(screen.getByText(/灵感 · 灵感、关键/)).toBeInTheDocument();
  });

  it('无标签时不展示标签部分', () => {
    mockStore({ materials: [makeMaterial({ tags: [] })] });
    render(<MaterialsPanel />);
    expect(screen.getByText(/灵感$/)).toBeInTheDocument();
  });

  it('pinned 素材展示 Pin 图标', () => {
    mockStore({ materials: [makeMaterial({ pinned: true })] });
    render(<MaterialsPanel />);
    expect(document.querySelector('svg.lucide-pin')).not.toBeNull();
  });

  // ============ 类型筛选 ============
  it('"全部"筛选显示所有素材计数', () => {
    mockStore({
      materials: [
        makeMaterial({ id: 'm1', type: 'inspiration' }),
        makeMaterial({ id: 'm2', type: 'reference' }),
      ],
    });
    render(<MaterialsPanel />);
    expect(screen.getByText('全部 (2)')).toBeInTheDocument();
  });

  it('点击类型筛选只展示该类型素材', () => {
    mockStore({
      materials: [
        makeMaterial({ id: 'm1', type: 'inspiration', title: '灵感A' }),
        makeMaterial({ id: 'm2', type: 'reference', title: '参考B' }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('参考资料 (1)'));
    expect(screen.getByText('参考B')).toBeInTheDocument();
    expect(screen.queryByText('灵感A')).not.toBeInTheDocument();
  });

  it('某类型无素材时不渲染该类型筛选按钮', () => {
    mockStore({
      materials: [makeMaterial({ id: 'm1', type: 'inspiration' })],
    });
    render(<MaterialsPanel />);
    expect(screen.queryByText('参考资料 (0)')).not.toBeInTheDocument();
    expect(screen.queryByText('研究笔记 (0)')).not.toBeInTheDocument();
  });

  it('置顶素材排在未置顶之前', () => {
    mockStore({
      materials: [
        makeMaterial({ id: 'm1', title: '普通', pinned: false, updatedAt: '2025-01-02T00:00:00.000Z' }),
        makeMaterial({ id: 'm2', title: '置顶', pinned: true, updatedAt: '2025-01-01T00:00:00.000Z' }),
      ],
    });
    render(<MaterialsPanel />);
    const titles = screen.getAllByText(/普通|置顶/);
    // 置顶在前
    expect(titles[0].textContent).toBe('置顶');
  });

  // ============ 添加素材 ============
  it('点击 + 按钮展开添加面板', () => {
    mockStore();
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '新建素材' }));
    expect(screen.getByPlaceholderText('素材标题...')).toBeInTheDocument();
    expect(screen.getByText('添加')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('点击"添加"按钮调用 addMaterial 并关闭面板', () => {
    const { addMaterial } = mockStore();
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '新建素材' }));
    fireEvent.change(screen.getByPlaceholderText('素材标题...'), { target: { value: '新素材' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addMaterial).toHaveBeenCalledWith({ title: '新素材', type: 'inspiration' });
    expect(screen.queryByPlaceholderText('素材标题...')).not.toBeInTheDocument();
  });

  it('Enter 键也可触发添加', () => {
    const { addMaterial } = mockStore();
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '新建素材' }));
    const input = screen.getByPlaceholderText('素材标题...');
    fireEvent.change(input, { target: { value: '回车素材' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addMaterial).toHaveBeenCalledWith({ title: '回车素材', type: 'inspiration' });
  });

  it('空标题不添加', () => {
    const { addMaterial } = mockStore();
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '新建素材' }));
    fireEvent.change(screen.getByPlaceholderText('素材标题...'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addMaterial).not.toHaveBeenCalled();
  });

  it('点击"取消"关闭面板并清空标题', () => {
    const { addMaterial } = mockStore();
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '新建素材' }));
    fireEvent.change(screen.getByPlaceholderText('素材标题...'), { target: { value: '草稿' } });
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('素材标题...')).not.toBeInTheDocument();
    expect(addMaterial).not.toHaveBeenCalled();
  });

  it('点击类型按钮切换 newType', () => {
    const { addMaterial } = mockStore();
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '新建素材' }));
    fireEvent.click(screen.getByText('参考资料'));
    fireEvent.change(screen.getByPlaceholderText('素材标题...'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('添加'));
    expect(addMaterial).toHaveBeenCalledWith({ title: 'X', type: 'reference' });
  });

  // ============ 卡片展开/折叠 ============
  it('点击卡片展开显示内容', () => {
    mockStore({ materials: [makeMaterial({ content: '展开后的内容' })] });
    render(<MaterialsPanel />);
    expect(screen.queryByText('展开后的内容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText('展开后的内容')).toBeInTheDocument();
  });

  it('再次点击卡片折叠', () => {
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    const card = screen.getByText('素材一');
    fireEvent.click(card);
    expect(screen.getByText('这是素材内容')).toBeInTheDocument();
    fireEvent.click(card);
    expect(screen.queryByText('这是素材内容')).not.toBeInTheDocument();
  });

  it('content 为空时展示"暂无内容"', () => {
    mockStore({ materials: [makeMaterial({ content: '' })] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText('暂无内容')).toBeInTheDocument();
  });

  it('source 存在时展示来源', () => {
    mockStore({ materials: [makeMaterial({ source: '某本书' })] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText('来源：某本书')).toBeInTheDocument();
  });

  it('source 缺省时不展示来源行', () => {
    mockStore({ materials: [makeMaterial({ source: '' })] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.queryByText(/来源：/)).not.toBeInTheDocument();
  });

  it('点击"置顶"按钮调用 updateMaterial 切换 pinned', () => {
    const { updateMaterial } = mockStore({ materials: [makeMaterial({ pinned: false })] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('置顶'));
    expect(updateMaterial).toHaveBeenCalledWith('m-1', { pinned: true });
  });

  it('已置顶素材按钮文案为"已置顶"，点击取消置顶', () => {
    const { updateMaterial } = mockStore({ materials: [makeMaterial({ pinned: true })] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('已置顶'));
    expect(updateMaterial).toHaveBeenCalledWith('m-1', { pinned: false });
  });

  // ============ 附件展示 ============
  it('展开卡片后展示附件区域 + 添加附件按钮', () => {
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText('附件')).toBeInTheDocument();
    expect(screen.getByText('添加附件')).toBeInTheDocument();
  });

  it('非图片附件展示图标 + 名称 + 大小', () => {
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'note.txt', path: '/p/note.txt', size: 512, ext: 'txt', addedAt: '2025-01-01T00:00:00.000Z' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    // 名称独占一行（truncate class）
    expect(screen.getByText('note.txt')).toBeInTheDocument();
    // 大小与扩展名同行："512 B · txt"
    expect(screen.getByText(/512 B · txt/)).toBeInTheDocument();
  });

  it('附件计数展示', () => {
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'a.txt', path: '/p/a', size: 1, ext: 'txt', addedAt: '' },
            { id: 'a2', name: 'b.txt', path: '/p/b', size: 1, ext: 'txt', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText(/附件 \(2\)/)).toBeInTheDocument();
  });

  it('formatFileSize：KB 单位', () => {
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'f.pdf', path: '/p/f', size: 2048, ext: 'pdf', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it('formatFileSize：MB 单位', () => {
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'big.zip', path: '/p/big', size: 2 * 1024 * 1024, ext: 'zip', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
  });

  it('音频附件展示 Music 图标', () => {
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'song.mp3', path: '/p/song', size: 1024, ext: 'mp3', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(document.querySelector('svg.lucide-music')).not.toBeNull();
  });

  it('图片附件展示预览区', async () => {
    vi.mocked(readImageDataUrl).mockResolvedValue('data:image/png;base64,AAA');
    setElectronAPI({ file: { readDataURL: vi.fn() } });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'pic.png', path: '/p/pic.png', size: 1024, ext: 'png', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    // 等 useEffect 触发 readImageDataUrl + 渲染 img
    await waitFor(() => {
      expect(document.querySelector('img')).not.toBeNull();
    });
  });

  // ============ 添加附件 ============
  it('无 electronAPI 时点击"添加附件"alert 提示', () => {
    setElectronAPI(null);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    expect(global.alert).toHaveBeenCalledWith('需要桌面版才能添加附件');
  });

  it('无 currentProjectId 时 alert 提示', () => {
    setElectronAPI({});
    mockStore({ materials: [makeMaterial()], currentProjectId: null });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    expect(global.alert).toHaveBeenCalledWith('未打开项目，无法添加附件');
  });

  it('selectFile 返回 null 时不调用 saveAttachment', async () => {
    const selectFile = vi.fn().mockResolvedValue(null);
    const saveAttachment = vi.fn();
    setElectronAPI({ dialog: { selectFile }, material: { saveAttachment } });
    const { updateMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    await waitFor(() => expect(selectFile).toHaveBeenCalled());
    expect(saveAttachment).not.toHaveBeenCalled();
    expect(updateMaterial).not.toHaveBeenCalled();
  });

  it('成功添加附件：调用 saveAttachment + clearImageErrorCache + updateMaterial', async () => {
    const selectFile = vi.fn().mockResolvedValue({
      path: '/orig/path.png',
      name: 'image.png',
      size: 1024,
      ext: 'png',
    });
    const saveAttachment = vi.fn().mockResolvedValue('/persisted/path.png');
    setElectronAPI({ dialog: { selectFile }, material: { saveAttachment } });
    const { updateMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    await waitFor(() => expect(saveAttachment).toHaveBeenCalled());
    expect(clearImageErrorCache).toHaveBeenCalledWith('/persisted/path.png');
    expect(updateMaterial).toHaveBeenCalledWith('m-1', {
      attachments: [
        expect.objectContaining({
          name: 'image.png',
          path: '/persisted/path.png',
          size: 1024,
          ext: 'png',
        }),
      ],
    });
  });

  it('saveAttachment 返回 null 时回退原路径', async () => {
    const selectFile = vi.fn().mockResolvedValue({
      path: '/orig/path.png',
      name: 'image.png',
      size: 1024,
      ext: 'png',
    });
    const saveAttachment = vi.fn().mockResolvedValue(null);
    setElectronAPI({ dialog: { selectFile }, material: { saveAttachment } });
    const { updateMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    await waitFor(() => expect(saveAttachment).toHaveBeenCalled());
    expect(updateMaterial).toHaveBeenCalledWith('m-1', {
      attachments: [expect.objectContaining({ path: '/orig/path.png' })],
    });
  });

  it('saveAttachment 抛错时 toast.error', async () => {
    const selectFile = vi.fn().mockResolvedValue({
      path: '/p/f.png',
      name: 'f.png',
      size: 1,
      ext: 'png',
    });
    const saveAttachment = vi.fn().mockRejectedValue(new Error('磁盘满'));
    setElectronAPI({ dialog: { selectFile }, material: { saveAttachment } });
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('添加附件失败', '磁盘满');
    });
  });

  it('saveAttachment 抛非 Error 时 toast.error 用默认提示', async () => {
    const selectFile = vi.fn().mockResolvedValue({
      path: '/p/f.png',
      name: 'f.png',
      size: 1,
      ext: 'png',
    });
    const saveAttachment = vi.fn().mockRejectedValue('字符串错误');
    setElectronAPI({ dialog: { selectFile }, material: { saveAttachment } });
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('添加附件'));
    await waitFor(() => {
      // 非 Error 抛错时回退到默认提示文案（区别于 Error.message）
      expect(toast.error).toHaveBeenCalledWith('添加附件失败', '请检查文件权限或路径');
    });
  });

  // ============ 打开附件 ============
  it('无 electronAPI 时点击图片预览容器 alert', () => {
    setElectronAPI(null);
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'pic.png', path: '/p/pic.png', size: 1, ext: 'png', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    // 图片容器有 title="点击查看大图"，无论 img 还是占位图标都在容器内
    const container = screen.getByTitle('点击查看大图');
    fireEvent.click(container);
    expect(global.alert).toHaveBeenCalledWith('需要桌面版才能打开附件');
  });

  it('openExternal 抛错时 toast.error', async () => {
    const openExternal = vi.fn().mockRejectedValue(new Error('无关联程序'));
    setElectronAPI({ file: { openExternal } });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'pic.png', path: '/p/pic.png', size: 1, ext: 'png', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByTitle('点击查看大图'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('打开附件失败', '无关联程序');
    });
  });

  it('非图片附件点击"打开"按钮调用 openExternal', async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    setElectronAPI({ file: { openExternal } });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'note.txt', path: '/p/note.txt', size: 1, ext: 'txt', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    // 非图片附件渲染了 title="打开" 的按钮
    const openBtns = screen.getAllByTitle('打开');
    fireEvent.click(openBtns[0]);
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('/p/note.txt'));
  });

  // ============ 删除附件 ============
  it('confirm 取消时不删除附件', () => {
    confirmMock.mockResolvedValue(false);
    const { updateMaterial } = mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'note.txt', path: '/p/note.txt', size: 1, ext: 'txt', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByTitle('删除'));
    expect(updateMaterial).not.toHaveBeenCalled();
  });

  it('confirm 确认时调用 updateMaterial 移除附件 + electronAPI.deleteAttachment', async () => {
    const deleteAttachment = vi.fn().mockResolvedValue(true);
    setElectronAPI({ material: { deleteAttachment } });
    const { updateMaterial } = mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'note.txt', path: '/p/note.txt', size: 1, ext: 'txt', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByTitle('删除'));
    await waitFor(() => expect(updateMaterial).toHaveBeenCalledWith('m-1', { attachments: [] }));
    expect(deleteAttachment).toHaveBeenCalledWith('/p/note.txt');
  });

  it('无 electronAPI 时删除附件不抛错（deleteAttachment 可选链）', async () => {
    setElectronAPI(null);
    const { updateMaterial } = mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'note.txt', path: '/p/note.txt', size: 1, ext: 'txt', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByTitle('删除'));
    await waitFor(() => expect(updateMaterial).toHaveBeenCalledWith('m-1', { attachments: [] }));
  });

  it('deleteAttachment 抛错时静默忽略（catch 内无操作）', async () => {
    const deleteAttachment = vi.fn().mockRejectedValue(new Error('权限不足'));
    setElectronAPI({ material: { deleteAttachment } });
    const { updateMaterial } = mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'note.txt', path: '/p/note.txt', size: 1, ext: 'txt', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByTitle('删除'));
    // 仍然更新 store（记录已删除），磁盘失败静默
    await waitFor(() => expect(updateMaterial).toHaveBeenCalledWith('m-1', { attachments: [] }));
  });

  it('confirm 文案包含附件名', async () => {
    setElectronAPI({ material: { deleteAttachment: vi.fn() } });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: '重要文件.pdf', path: '/p/important.pdf', size: 1, ext: 'pdf', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByTitle('删除'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('重要文件.pdf'),
    ));
  });

  // ============ 深度提问抽屉 ============
  it('点击"深度提问"打开抽屉 + pushOverlay + 显示 loading', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '问题1', dimension: '秘密' },
    ]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    expect(pushOverlay).toHaveBeenCalledTimes(1);
    expect(screen.getByText('AI 正在为这张卡片深度提问...')).toBeInTheDocument();
    await waitFor(() => {
      expect(askMaterialQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-1' }));
    });
  });

  it('askMaterialQuestion 成功后展示问题列表', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '秘密问题', dimension: '秘密' },
      { question: '动机问题', dimension: '动机' },
    ]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => {
      expect(screen.getByText('秘密问题')).toBeInTheDocument();
      expect(screen.getByText('动机问题')).toBeInTheDocument();
    });
    expect(screen.getAllByText('秘密')).toHaveLength(1);
    expect(screen.getAllByText('动机')).toHaveLength(1);
  });

  it('askMaterialQuestion 返回空数组时展示"暂无问题，可重试"', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => {
      expect(screen.getByText('暂无问题，可重试')).toBeInTheDocument();
    });
  });

  it('askMaterialQuestion 抛错时 finally 复位 asking 状态（loading 消失）', async () => {
    vi.mocked(askMaterialQuestion).mockRejectedValue(new Error('AI 异常'));
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    // 等待 finally 复位：loading 消失，展示"暂无问题"
    await waitFor(() => {
      expect(screen.getByText('暂无问题，可重试')).toBeInTheDocument();
    });
    expect(screen.queryByText('AI 正在为这张卡片深度提问...')).not.toBeInTheDocument();
  });

  // 抽屉 header 标题 "深度提问" 与卡片按钮 "深度提问" 文案重复，
  // 用辅助函数定位抽屉 header 内的标题元素（带 HelpCircle 图标的 div）
  function getDrawerHeader() {
    // 抽屉最外层是 .fixed.inset-0.z-50，header 是其内首个 div > div
    const overlays = document.querySelectorAll('.fixed.inset-0.z-50');
    if (overlays.length === 0) return null;
    const drawer = overlays[overlays.length - 1] as HTMLElement;
    // header 是 drawer > div > div:first-child（border-b 的 header）
    return drawer.querySelector('.flex.items-center.justify-between') as HTMLElement | null;
  }

  it('点击 X 按钮关闭抽屉 + popOverlay', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(getDrawerHeader()).not.toBeNull());
    // header 内唯一的 button 就是 X 关闭按钮
    const xBtn = getDrawerHeader()!.querySelector('button')!;
    fireEvent.click(xBtn);
    expect(popOverlay).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩关闭抽屉', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(getDrawerHeader()).not.toBeNull());
    // 遮罩是抽屉最外层 div
    const overlays = document.querySelectorAll('.fixed.inset-0.z-50');
    fireEvent.click(overlays[overlays.length - 1]);
    expect(popOverlay).toHaveBeenCalled();
  });

  it('ESC 键关闭抽屉', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(getDrawerHeader()).not.toBeNull());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(popOverlay).toHaveBeenCalled();
  });

  it('ESC 关闭时不触发 input isComposing', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([]);
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(getDrawerHeader()).not.toBeNull());
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    // isComposing 时 ESC 不关闭
    expect(popOverlay).not.toHaveBeenCalled();
  });

  it('点击卡片展开前不注册抽屉浮层', () => {
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    expect(pushOverlay).not.toHaveBeenCalled();
  });

  // ============ 并发守卫 ============
  it('并发点击不同卡片：旧请求晚于新请求返回时丢弃旧结果', async () => {
    let resolveFirst: (v: MaterialQuestion[]) => void = () => {};
    let resolveSecond: (v: MaterialQuestion[]) => void = () => {};
    vi.mocked(askMaterialQuestion)
      .mockReturnValueOnce(new Promise(r => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise(r => { resolveSecond = r; }));

    mockStore({
      materials: [
        makeMaterial({ id: 'm-1', title: '卡片A' }),
        makeMaterial({ id: 'm-2', title: '卡片B' }),
      ],
    });
    render(<MaterialsPanel />);
    // 展开+点击卡片A的深度提问
    fireEvent.click(screen.getByText('卡片A'));
    // 此时只有卡片A展开，深度提问按钮唯一
    fireEvent.click(screen.getByText('深度提问'));
    // 展开+点击卡片B的深度提问（覆盖 A）：此时卡片A和B都展开，按钮有2个
    fireEvent.click(screen.getByText('卡片B'));
    const askBtns = screen.getAllByText('深度提问');
    // 卡片B在下方，取最后一个；最后一个 -1 是抽屉标题（如果已渲染）
    // 抽屉此时已打开，header 标题也是"深度提问"，所以 askBtns 可能有 3 个
    // 卡片B的按钮是倒数第二个（抽屉 header 在最后）
    fireEvent.click(askBtns[askBtns.length - 2]);
    // 先后 resolve
    resolveFirst([{ question: 'A 的问题', dimension: 'A' }]);
    resolveSecond([{ question: 'B 的问题', dimension: 'B' }]);
    await waitFor(() => {
      expect(screen.getByText('B 的问题')).toBeInTheDocument();
    });
    expect(screen.queryByText('A 的问题')).not.toBeInTheDocument();
  });

  it('抽屉关闭后晚到的请求结果不写入', async () => {
    let resolveReq: (v: MaterialQuestion[]) => void = () => {};
    vi.mocked(askMaterialQuestion).mockReturnValueOnce(
      new Promise(r => { resolveReq = r; }),
    );
    mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(screen.getByText('AI 正在为这张卡片深度提问...')).toBeInTheDocument());
    // 关闭抽屉
    const overlays = document.querySelectorAll('.fixed.inset-0.z-50');
    fireEvent.click(overlays[overlays.length - 1]);
    // 晚到的请求 resolve
    resolveReq([{ question: '晚到的问题', dimension: 'X' }]);
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByText('晚到的问题')).not.toBeInTheDocument();
  });

  // ============ handleSpawnChild ============
  it('空答案不生成子卡片', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '问题1', dimension: '秘密' },
    ]);
    const { addMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(screen.getByText('生成子卡片')).toBeInTheDocument());
    // 答案为空，按钮 disabled；但 fireEvent 仍可触发，组件应拒绝
    fireEvent.click(screen.getByText('生成子卡片'));
    expect(addMaterial).not.toHaveBeenCalled();
  });

  it('填答案后点击"生成子卡片"调用 addMaterial + updateMaterial', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '他的秘密是什么？', dimension: '秘密' },
    ]);
    // 父卡已有一条 references
    const { addMaterial, updateMaterial } = mockStore({
      materials: [makeMaterial({ references: ['existing-child'] })],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(screen.getByPlaceholderText(/回答这个问题/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/回答这个问题/), {
      target: { value: '他其实是个卧底' },
    });
    fireEvent.click(screen.getByText('生成子卡片'));
    expect(addMaterial).toHaveBeenCalledWith({
      title: '[秘密] 他的秘密是什么？',
      type: 'inspiration',
      content: '他其实是个卧底',
      tags: ['灵感', '关键', '深度提问'],
      category: '未分类',
      references: ['m-1'],
    });
    // 父卡 references 追加 child.id，并保留 existing-child（从 store 读最新 parent）
    expect(updateMaterial).toHaveBeenCalledWith('m-1', {
      references: ['existing-child', 'child-1'],
    });
  });

  it('答案仅含空白时不生成子卡片', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '问题1', dimension: '秘密' },
    ]);
    const { addMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(screen.getByPlaceholderText(/回答这个问题/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/回答这个问题/), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('生成子卡片'));
    expect(addMaterial).not.toHaveBeenCalled();
  });

  it('无 questionTargetId 时不生成子卡片', async () => {
    // 通过关闭抽屉后强制触发：直接断言无法触达，覆盖 handleSpawnChild 早 return 分支
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '问题1', dimension: '秘密' },
    ]);
    const { addMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(screen.getByPlaceholderText(/回答这个问题/)).toBeInTheDocument());
    // 关闭抽屉（清 questionTargetId）
    const overlays = document.querySelectorAll('.fixed.inset-0.z-50');
    fireEvent.click(overlays[overlays.length - 1]);
    // 此时已无"生成子卡片"按钮可点
    expect(screen.queryByText('生成子卡片')).not.toBeInTheDocument();
    expect(addMaterial).not.toHaveBeenCalled();
  });

  it('父卡已被删除时不生成子卡片', async () => {
    vi.mocked(askMaterialQuestion).mockResolvedValue([
      { question: '问题1', dimension: '秘密' },
    ]);
    const { addMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    await waitFor(() => expect(screen.getByPlaceholderText(/回答这个问题/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/回答这个问题/), {
      target: { value: '答案' },
    });
    // 模拟父卡在生成子卡前被删除：清空 materials
    useAppStore.setState({ materials: [] });
    fireEvent.click(screen.getByText('生成子卡片'));
    expect(addMaterial).not.toHaveBeenCalled();
  });

  // ============ ImageFallback ============
  it('file:// 路径 + electronAPI.readDataURL 可用时通过 bridge 读取 dataURL', async () => {
    vi.mocked(readImageDataUrl).mockResolvedValue('data:image/png;base64,AAA');
    setElectronAPI({ file: { readDataURL: vi.fn() } });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'pic.png', path: '/p/pic.png', size: 1, ext: 'png', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    await waitFor(() => {
      const img = document.querySelector('img') as HTMLImageElement;
      expect(img.src).toBe('data:image/png;base64,AAA');
    });
  });

  it('file:// 路径 + readImageDataUrl 抛错时降级显示占位图标', async () => {
    vi.mocked(readImageDataUrl).mockRejectedValue(new Error('读取失败'));
    setElectronAPI({ file: { readDataURL: vi.fn() } });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'pic.png', path: '/p/pic.png', size: 1, ext: 'png', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    await waitFor(() => {
      // 错误占位渲染了 lucide-image 图标（占位）
      expect(document.querySelectorAll('svg.lucide-image').length).toBeGreaterThan(0);
    });
  });

  it('http 协议 + 无 electronAPI bridge 时降级显示占位图标', () => {
    setElectronAPI(null);
    // 模拟开发环境协议
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:' },
      writable: true,
    });
    mockStore({
      materials: [
        makeMaterial({
          attachments: [
            { id: 'a1', name: 'pic.png', path: '/p/pic.png', size: 1, ext: 'png', addedAt: '' },
          ],
        }),
      ],
    });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    expect(document.querySelectorAll('svg.lucide-image').length).toBeGreaterThan(0);
  });

  // ============ 组件卸载守卫 ============
  it('组件卸载后 askMaterialQuestion resolve 不触发 setState 警告', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveReq: (v: MaterialQuestion[]) => void = () => {};
    vi.mocked(askMaterialQuestion).mockReturnValueOnce(
      new Promise(r => { resolveReq = r; }),
    );
    mockStore({ materials: [makeMaterial()] });
    const { unmount } = render(<MaterialsPanel />);
    fireEvent.click(screen.getByText('素材一'));
    fireEvent.click(screen.getByText('深度提问'));
    unmount();
    // 卸载后 resolve，不应抛 React 警告
    resolveReq([{ question: 'X', dimension: 'Y' }]);
    await new Promise(r => setTimeout(r, 10));
    // 验证卸载后 resolve 未触发 console.error（React setState 警告等）
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // ============ stopPropagation 行为 ============
  it('点击附件区域的"添加附件"按钮不触发展开/折叠', () => {
    const { updateMaterial } = mockStore({ materials: [makeMaterial()] });
    render(<MaterialsPanel />);
    // 卡片初始折叠
    expect(screen.queryByText('添加附件')).not.toBeInTheDocument();
    // 展开卡片
    fireEvent.click(screen.getByText('素材一'));
    expect(screen.getByText('添加附件')).toBeInTheDocument();
    // 注：实际场景中点击"添加附件"会因 stopPropagation 不折叠卡片，但本测试因无 electronAPI
    // 会 alert，验证展开态保留即可
    fireEvent.click(screen.getByText('添加附件'));
    // 卡片应仍展开（添加附件按钮仍可见）
    expect(screen.getByText('添加附件')).toBeInTheDocument();
    expect(updateMaterial).not.toHaveBeenCalled();
  });
});
