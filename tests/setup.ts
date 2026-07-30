/**
 * Vitest 全局 setup
 *
 * 在每个测试文件执行前运行一次。职责：
 * 1. 注入 @testing-library/jest-dom 的 matchers（toBeInTheDocument 等）
 * 2. mock Electron API（window.electronAPI）让依赖 IPC 的代码可在 jsdom 下测试
 * 3. 提供 localStorage 的 jsdom 兜底（jsdom 内置实现偶尔有边界 bug）
 */
import '@testing-library/jest-dom/vitest';
import { vi, beforeEach } from 'vitest';

// ============ Node 23+ 内置 localStorage 兜底 ============
// Node 23+ 在全局注入了简化版 localStorage（仅 getItem/setItem/removeItem/key/length），
// 缺少 clear()，且会在 jsdom 实例化前覆盖 globalThis.localStorage。测试中大量用
// localStorage.clear() 清理状态会抛 "clear is not a function"（影响 useTheme/safeStorage/
// storage/localStorageAdapter.security 等约 70 个测试）。
// 此处在最早处补全 clear 实现：用已存储键逐个 removeItem 实现清空，幂等且无副作用。
// jsdom 真正的 localStorage 实例若有 clear() 会直接调用自身；缺失时用兜底。
const _ls = (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined) as
  | (Storage & { clear?: () => void })
  | undefined;
if (_ls && typeof _ls.clear !== 'function') {
  _ls.clear = function clear() {
    // 用快照避免遍历中修改索引
    const keys: string[] = [];
    for (let i = 0; i < _ls.length; i++) {
      const k = _ls.key(i);
      if (k !== null) keys.push(k);
    }
    for (const k of keys) _ls.removeItem(k);
  };
}

// ============ window.electronAPI mock ============
// 渲染层代码大量依赖 window.electronAPI.storage / ai / file 等 IPC。
// 单元测试中不真正跨进程通信，统一 mock 为内存实现，让被测代码可正常运行。
// 各测试文件可针对具体 case 用 vi.mocked 覆盖更精确的行为。
const memoryStore = new Map<string, unknown>();

// ---- 默认实现函数：既用于初始 vi.fn(impl)，也用于 resetAllMocks 后重新注入 ----
const storageGetImpl = async (key: string, defaultValue: unknown) => {
  return memoryStore.has(key) ? memoryStore.get(key) : defaultValue;
};
const storageSetImpl = async (key: string, value: unknown) => {
  memoryStore.set(key, value);
};
const storageRemoveImpl = async (key: string) => {
  memoryStore.delete(key);
};
const storagePatchProjectsImpl = async (op: { type: string; project?: { id: string }; id?: string }) => {
  const cur = (memoryStore.get('projects') as Array<{ id: string }>) || [];
  let next = cur;
  if (op.type === 'add' && op.project) next = [...cur, op.project];
  else if (op.type === 'remove' && op.id) next = cur.filter(p => p.id !== op.id);
  else if (op.type === 'update' && op.project) {
    next = cur.some(p => p.id === op.project!.id)
      ? cur.map(p => (p.id === op.project!.id ? { ...p, ...op.project } : p))
      : [...cur, op.project];
  } else if (op.type === 'clear') next = [];
  memoryStore.set('projects', next);
  return next;
};
const aiProxyStreamImpl = () => ({ promise: Promise.resolve(''), cleanup: () => {} });

const electronApiMock = {
  storage: {
    get: vi.fn(storageGetImpl),
    set: vi.fn(storageSetImpl),
    setMany: vi.fn(async (entries: Record<string, unknown>): Promise<void> => {
      for (const [key, value] of Object.entries(entries)) {
        await storageSetImpl(key, value);
      }
    }),
    remove: vi.fn(storageRemoveImpl),
    patchProjects: vi.fn(storagePatchProjectsImpl),
    readFileBase64: vi.fn().mockResolvedValue(null),
    writeFile: vi.fn().mockResolvedValue(false),
    writeFileBuffer: vi.fn().mockResolvedValue(false),
    listProjectDirs: vi.fn().mockResolvedValue([]),
    backupProject: vi.fn().mockResolvedValue(false),
  },
  file: {
    readDataURL: vi.fn().mockRejectedValue(new Error('not implemented in test')),
    openExternal: vi.fn().mockResolvedValue(true),
  },
  dialog: {
    selectFile: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue(null),
  },
  material: {
    saveAttachment: vi.fn().mockResolvedValue(null),
    deleteAttachment: vi.fn().mockResolvedValue(false),
  },
  ai: {
    proxyStream: vi.fn(aiProxyStreamImpl),
    abort: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(true),
    // 默认返回 null：模拟"aiSettings 文件不存在"的首次启动场景。
    // 测试需要明文 settings 的用例可用 vi.mocked(...)mockResolvedValueOnce 覆盖
    loadSettings: vi.fn().mockResolvedValue(null),
  },
  projectFile: {
    read: vi.fn().mockResolvedValue({ success: false, error: 'mock' }),
    write: vi.fn().mockResolvedValue({ success: false, error: 'mock' }),
    openDialog: vi.fn().mockResolvedValue(null),
    listBackups: vi.fn().mockResolvedValue({ success: true, backups: [] }),
  },
  system: {
    checkCrashRecovery: vi.fn().mockResolvedValue({ recovered: false, projects: [] }),
    getPlatform: vi.fn().mockReturnValue(process.platform),
  },
  // 渲染层日志转发 IPC：默认 no-op，测试需要断言时用 vi.mocked 覆盖
  logger: {
    write: vi.fn().mockResolvedValue(undefined),
  },
  // 导出文件专用 IPC：默认返回 true（成功），测试需要模拟失败时用 vi.mocked 覆盖
  exportFile: {
    write: vi.fn().mockResolvedValue(true),
    writeBuffer: vi.fn().mockResolvedValue(true),
  },
};

// 注入到 globalThis.window（jsdom 已创建 window）与 globalThis 顶层
// 部分 storage 工具代码用 typeof window !== 'undefined' 检测环境，需保证一致
Object.defineProperty(globalThis, 'electronAPI', {
  value: electronApiMock,
  writable: true,
  configurable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electronAPI', {
    value: electronApiMock,
    writable: true,
    configurable: true,
  });
}

// 缓存模块级 reset 函数（动态导入后缓存，避免每个 beforeEach 都 await import）
let moduleStateResetters: Array<() => void> | null = null;

// ============ 全局 beforeEach：重置 mock + 模块级状态 ============
// 避免测试之间通过 memoryStore / mock 实现 / 模块级变量相互污染
beforeEach(async () => {
  memoryStore.clear();
  // clearAllMocks：清除调用记录但保留实现。
  // 不用 resetAllMocks：它会清除测试文件在 vi.hoisted 中定义的 mock 实现，
  // 导致 81+ 测试失败（MentionPanel/OutlinePolishPanel 等的 editor/store mock 被清空）。
  // 模块级变量重置（下方）是更有价值的隔离修复。
  vi.clearAllMocks();

  // 重置各 slice 的模块级变量，避免跨测试泄漏。
  // 使用动态导入：此时测试文件的 vi.mock 已生效，动态导入获取的是 mock 后的模块。
  // 缓存后后续 beforeEach 直接调用，无需重复 import。
  if (moduleStateResetters === null) {
    const [chapterMod, outlineMod, projectMod, coreMod, llmMod] = await Promise.all([
      import('@/store/slices/chapterSlice'),
      import('@/store/slices/outlinePolishSlice'),
      import('@/store/slices/projectSlice'),
      import('@/utils/aiService/core'),
      import('@/utils/llmClient'),
    ]);
    moduleStateResetters = [
      chapterMod._resetRecoveryState,
      outlineMod._resetOutlinePolishRequestState,
      projectMod._resetOpenProjectRequestId,
      // 重置 aiService/core 的 activeLLMClient 为默认单例：测试通过 setLLMClient
      // 注入 mock client 后若未在 afterEach 恢复，会泄漏到后续测试。此处作为安全网兜底。
      // 用 try/catch 守护：部分测试文件 vi.mock('@/utils/llmClient') 但未导出 llmClient
      // （如 axe.test.tsx 仅导出 LLMClient 类），访问 llmMod.llmClient 会抛
      // "No llmClient export" 错误；这些文件不使用 setLLMClient，跳过重置无害。
      () => {
        try {
          const def = (llmMod as { llmClient?: unknown }).llmClient;
          if (def) coreMod.setLLMClient(def as import('@/utils/llmClient').LLMClient);
        } catch {
          // llmClient 被模拟但未导出 llmClient：跳过重置
        }
      },
    ];
  }
  for (const reset of moduleStateResetters) reset();
});

export { memoryStore };
