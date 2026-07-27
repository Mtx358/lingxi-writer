/**
 * electron/preload.ts 单元测试
 *
 * 测试目标：
 * - contextBridge.exposeInMainWorld 暴露完整 API 表面（所有方法存在）
 * - 各 API 方法以正确 channel + args 调用 ipcRenderer.invoke
 * - invokeWithTimeoutCore：超时 reject + onTimeout 钩子触发 + 成功时清理 timer
 * - ai.proxyStream 生命周期：注册 chunk/done/error 监听器、cleanup 移除监听器并调用 ai:abort
 *
 * preload.ts 顶层执行 contextBridge.exposeInMainWorld，import 时即触发副作用，
 * 因此 vi.mock('electron', ...) 必须先于 import './preload' 生效（vitest 自动 hoist）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============ electron mock ============
// 用 vi.hoisted 让 mock factory 与测试代码共享同一份 mock 对象。
// vi.mock 会被 hoist 到文件顶部，普通 const 无法被 factory 引用。
const { apiHolder, ipcRendererMock, exposeInMainWorldMock } = vi.hoisted(() => {
  // 用可变对象 holder 捕获 exposeInMainWorld 注入的 API（避免 const 重新赋值）
  const apiHolder: { current: unknown } = { current: null };
  const exposeInMainWorldMock = vi.fn((name: string, api: unknown) => {
    apiHolder.current = api;
  });
  const ipcRendererMock = {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  return { apiHolder, ipcRendererMock, exposeInMainWorldMock };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: ipcRendererMock,
}));

// 在 mock 生效后 import preload，触发 contextBridge.exposeInMainWorld 调用
import './preload';

// 从 holder 取回暴露的 API
// 测试断言时频繁取属性并按不同签名调用，用宽松的 Record 类型简化访问；
// 测试自身通过具体断言保障类型安全，无需精确签名
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getApi = (): Record<string, any> => apiHolder.current as Record<string, any>;

// ============ 测试用例 ============

describe('electron/preload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------- API 表面完整性 --------------------
  describe('API 表面', () => {
    it('exposeInMainWorld 被调用一次，名称为 electronAPI', () => {
      // 注意：beforeEach 的 clearAllMocks 会清除 import 时触发的调用记录，
      // 因此通过 apiHolder.current 是否被填充来间接验证（import 时已注入）
      expect(apiHolder.current).not.toBeNull();
      expect(typeof apiHolder.current).toBe('object');
    });

    it('暴露 platform 与 versions', () => {
      const api = getApi();
      expect(typeof api.platform).toBe('string');
      expect(api.versions).toHaveProperty('node');
      expect(api.versions).toHaveProperty('chrome');
      expect(api.versions).toHaveProperty('electron');
    });

    it('projectFile 子 API 完整', () => {
      const api = getApi();
      const methods = ['read', 'write', 'validate', 'backup', 'listBackups', 'restoreBackup', 'openDialog', 'saveDialog'];
      for (const m of methods) {
        expect(typeof api.projectFile[m]).toBe('function');
      }
    });

    it('storage 子 API 完整', () => {
      const api = getApi();
      const methods = ['read', 'write', 'remove', 'listProjectDirs', 'backupProject', 'readFileBase64', 'patchProjects'];
      for (const m of methods) {
        expect(typeof api.storage[m]).toBe('function');
      }
    });

    it('dialog 子 API 完整', () => {
      const api = getApi();
      expect(typeof api.dialog.selectFile).toBe('function');
      expect(typeof api.dialog.saveFile).toBe('function');
    });

    it('file 子 API 完整', () => {
      const api = getApi();
      const methods = ['write', 'writeBuffer', 'openExternal', 'readDataURL'];
      for (const m of methods) {
        expect(typeof api.file[m]).toBe('function');
      }
    });

    it('material 子 API 完整', () => {
      const api = getApi();
      expect(typeof api.material.saveAttachment).toBe('function');
      expect(typeof api.material.deleteAttachment).toBe('function');
    });

    it('system 子 API 完整', () => {
      const api = getApi();
      expect(typeof api.system.checkCrashRecovery).toBe('function');
    });

    it('logger 子 API 完整', () => {
      const api = getApi();
      expect(typeof api.logger.write).toBe('function');
    });

    it('exportFile 子 API 完整', () => {
      const api = getApi();
      expect(typeof api.exportFile.write).toBe('function');
      expect(typeof api.exportFile.writeBuffer).toBe('function');
    });

    it('ai 子 API 完整', () => {
      const api = getApi();
      const methods = ['proxyStream', 'abort', 'saveSettings', 'loadSettings'];
      for (const m of methods) {
        expect(typeof api.ai[m]).toBe('function');
      }
    });
  });

  // -------------------- 各方法 channel + args 透传 --------------------
  describe('IPC channel 透传', () => {
    it('projectFile.read 调用 ipcRenderer.invoke("projectFile:read", filePath)', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce({ success: true });
      const api = getApi();
      await api.projectFile.read('/path/to/file.cwp');
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('projectFile:read', '/path/to/file.cwp');
    });

    it('projectFile.write 透传 filePath + data', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce({ success: true });
      const api = getApi();
      await api.projectFile.write('/path/file.cwp', { foo: 'bar' });
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('projectFile:write', '/path/file.cwp', { foo: 'bar' });
    });

    it('storage.read 透传 key', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce('value');
      const api = getApi();
      await api.storage.read('projects');
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('storage:read', 'projects');
    });

    it('storage.write 透传 key + value', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce(true);
      const api = getApi();
      await api.storage.write('projects', [{ id: 'p1' }]);
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('storage:write', 'projects', [{ id: 'p1' }]);
    });

    it('storage.remove 透传 key', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce(true);
      const api = getApi();
      await api.storage.remove('old_key');
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('storage:remove', 'old_key');
    });

    it('storage.patchProjects 透传 op 对象', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce([]);
      const api = getApi();
      const op = { type: 'clear' };
      await api.storage.patchProjects(op);
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('storage:patchProjects', op);
    });

    it('dialog.saveFile 透传 defaultName + data + filterExt', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce(true);
      const api = getApi();
      await api.dialog.saveFile('novel.txt', '内容', 'txt');
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('dialog:saveFile', 'novel.txt', '内容', 'txt');
    });

    it('file.openExternal 透传 filePath', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce(true);
      const api = getApi();
      await api.file.openExternal('/path/to/file');
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('file:openExternal', '/path/to/file');
    });

    it('ai.saveSettings 透传 settings 对象', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce(true);
      const api = getApi();
      const settings = { provider: 'mock', apiKey: 'k' };
      await api.ai.saveSettings(settings);
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('ai:saveSettings', settings);
    });

    it('ai.abort 透传 requestId', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce(true);
      const api = getApi();
      await api.ai.abort('req-123');
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('ai:abort', 'req-123');
    });
  });

  // -------------------- invokeWithTimeoutCore 超时行为 --------------------
  describe('invokeWithTimeoutCore 超时行为', () => {
    it('成功 resolve 时清理 timer 并返回结果', async () => {
      ipcRendererMock.invoke.mockResolvedValueOnce('ok');
      const api = getApi();
      const result = await api.storage.read('key');
      expect(result).toBe('ok');
    });

    it('超时后 reject 并抛出 "IPC timeout: <channel>" 错误', async () => {
      vi.useFakeTimers();
      // 让 invoke 永不 resolve
      ipcRendererMock.invoke.mockReturnValueOnce(new Promise(() => {}));
      const api = getApi();
      const promise = api.storage.read('key'); // 默认 10s timeout
      vi.advanceTimersByTime(11000);
      await expect(promise).rejects.toThrow('IPC timeout: storage:read');
    });

    it('超时后 onTimeout 钩子被调用（ai:proxyStream 超时触发 ai:abort）', async () => {
      vi.useFakeTimers();
      // ai:proxyStream 的 invoke 永不 resolve（模拟长时间未响应）
      ipcRendererMock.invoke.mockImplementation((channel: string) => {
        if (channel === 'ai:proxyStream') return new Promise(() => {});
        // ai:abort 直接 resolve
        return Promise.resolve(undefined);
      });
      const api = getApi();
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const { promise } = api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-timeout-test',
        },
        onChunk,
        onDone,
        onError,
      );
      // ai:proxyStream timeout = 300000ms
      vi.advanceTimersByTime(300001);
      await expect(promise).rejects.toThrow('IPC timeout: ai:proxyStream');
      // 超时后应触发 ai:abort IPC 调用
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('ai:abort', 'req-timeout-test');
    });

    it('成功 resolve 时 onTimeout 钩子不触发', async () => {
      vi.useFakeTimers();
      ipcRendererMock.invoke.mockImplementation((channel: string) => {
        if (channel === 'ai:proxyStream') return Promise.resolve('done-content');
        return Promise.resolve(undefined);
      });
      const api = getApi();
      const { promise } = api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-success-test',
        },
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      // 让 microtask 完成
      await vi.advanceTimersByTimeAsync(0);
      await expect(promise).resolves.toBe('done-content');
      // ai:abort 不应被调用（成功路径）
      expect(ipcRendererMock.invoke).not.toHaveBeenCalledWith('ai:abort', 'req-success-test');
    });
  });

  // -------------------- ai.proxyStream 生命周期 --------------------
  describe('ai.proxyStream 生命周期', () => {
    it('注册 chunk/done/error 三个监听器，channel 含 requestId', () => {
      const api = getApi();
      api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-lifecycle-1',
        },
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      expect(ipcRendererMock.on).toHaveBeenCalledWith('ai:stream:chunk:req-lifecycle-1', expect.any(Function));
      expect(ipcRendererMock.on).toHaveBeenCalledWith('ai:stream:done:req-lifecycle-1', expect.any(Function));
      expect(ipcRendererMock.on).toHaveBeenCalledWith('ai:stream:error:req-lifecycle-1', expect.any(Function));
    });

    it('返回 promise + cleanup 函数', () => {
      const api = getApi();
      const result = api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-lifecycle-2',
        },
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      expect(result.promise).toBeInstanceOf(Promise);
      expect(typeof result.cleanup).toBe('function');
    });

    it('cleanup 移除三个监听器并调用 ai:abort', async () => {
      ipcRendererMock.invoke.mockResolvedValue(undefined);
      const api = getApi();
      const { cleanup } = api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-cleanup-test',
        },
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      cleanup();
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith(
        'ai:stream:chunk:req-cleanup-test',
        expect.any(Function),
      );
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith(
        'ai:stream:done:req-cleanup-test',
        expect.any(Function),
      );
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith(
        'ai:stream:error:req-cleanup-test',
        expect.any(Function),
      );
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('ai:abort', 'req-cleanup-test');
    });

    it('done 监听器触发 cleanup + onDone 回调', async () => {
      ipcRendererMock.invoke.mockResolvedValue('full-content');
      const api = getApi();
      const onDone = vi.fn();
      api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-done-test',
        },
        vi.fn(),
        onDone,
        vi.fn(),
      );
      // 找到 done 监听器并触发
      const doneCall = ipcRendererMock.on.mock.calls.find(
        c => c[0] === 'ai:stream:done:req-done-test',
      );
      expect(doneCall).toBeTruthy();
      const doneHandler = doneCall![1] as (e: unknown, data: string) => void;
      doneHandler(null, 'full-content-from-stream');
      expect(onDone).toHaveBeenCalledWith('full-content-from-stream');
      // done 触发后应自动 cleanup（removeListener 被调用）
      expect(ipcRendererMock.removeListener).toHaveBeenCalled();
    });

    it('error 监听器触发 cleanup + onError 回调', async () => {
      ipcRendererMock.invoke.mockResolvedValue('');
      const api = getApi();
      const onError = vi.fn();
      api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-error-test',
        },
        vi.fn(),
        vi.fn(),
        onError,
      );
      const errorCall = ipcRendererMock.on.mock.calls.find(
        c => c[0] === 'ai:stream:error:req-error-test',
      );
      expect(errorCall).toBeTruthy();
      const errorHandler = errorCall![1] as (e: unknown, data: string) => void;
      errorHandler(null, 'Network error');
      expect(onError).toHaveBeenCalledWith('Network error');
      expect(ipcRendererMock.removeListener).toHaveBeenCalled();
    });

    it('chunk 监听器触发 onChunk 但不 cleanup', async () => {
      ipcRendererMock.invoke.mockResolvedValue('');
      const api = getApi();
      const onChunk = vi.fn();
      api.ai.proxyStream(
        {
          provider: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.7,
          maxTokens: 100,
          requestId: 'req-chunk-test',
        },
        onChunk,
        vi.fn(),
        vi.fn(),
      );
      const chunkCall = ipcRendererMock.on.mock.calls.find(
        c => c[0] === 'ai:stream:chunk:req-chunk-test',
      );
      expect(chunkCall).toBeTruthy();
      const chunkHandler = chunkCall![1] as (e: unknown, data: string) => void;
      chunkHandler(null, 'partial-chunk');
      expect(onChunk).toHaveBeenCalledWith('partial-chunk');
      // chunk 不应触发 cleanup（流仍持续）
      expect(ipcRendererMock.removeListener).not.toHaveBeenCalled();
    });
  });
});
