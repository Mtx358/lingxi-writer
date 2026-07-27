/**
 * rendererLogger 单元测试
 *
 * 测试范围：
 * 1. logError：console.error 输出 + 转发 electronAPI.logger.write（含 error/stack 字段）
 * 2. logWarn：console.warn 输出 + 转发 logger.write
 * 3. 非 Error 异常：String(e) 兜底
 * 4. logger 桥同步抛错：forward 的 try/catch 静默兜底
 * 5. logger.write reject：?.catch 静默兜底，不产生 unhandledrejection
 * 6. 非 Electron 环境（无 electronAPI）：静默跳过转发
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logError, logWarn } from '@/utils/rendererLogger';

describe('rendererLogger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let originalElectronAPI: unknown;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    originalElectronAPI = (globalThis as Record<string, unknown>).electronAPI;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    (globalThis as Record<string, unknown>).electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  it('logError 输出 console.error 并转发 logger.write（Error 实例含 error/stack）', () => {
    const writeMock = vi.fn().mockReturnValue(Promise.resolve());
    Object.defineProperty(globalThis, 'electronAPI', {
      value: { logger: { write: writeMock } },
      configurable: true,
      writable: true,
    });

    const err = new Error('boom');
    logError('操作失败', err, { projectId: 'p1' });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [msg, extra] = consoleErrorSpy.mock.calls[0];
    expect(msg).toBe('操作失败');
    expect(extra).toMatchObject({ projectId: 'p1', error: 'boom' });
    expect((extra as Record<string, unknown>).stack).toBe(err.stack);

    expect(writeMock).toHaveBeenCalledWith('error', '操作失败', expect.objectContaining({
      projectId: 'p1',
      error: 'boom',
    }));
  });

  it('logError 非 Error 异常用 String(e) 兜底（无 stack）', () => {
    const writeMock = vi.fn().mockReturnValue(Promise.resolve());
    Object.defineProperty(globalThis, 'electronAPI', {
      value: { logger: { write: writeMock } },
      configurable: true,
      writable: true,
    });

    logError('字符串异常', 'plain string error');

    const [, extra] = consoleErrorSpy.mock.calls[0];
    expect((extra as Record<string, unknown>).error).toBe('plain string error');
    expect((extra as Record<string, unknown>).stack).toBe('');
  });

  it('logWarn 输出 console.warn 并转发 logger.write（warn 级别）', () => {
    const writeMock = vi.fn().mockReturnValue(Promise.resolve());
    Object.defineProperty(globalThis, 'electronAPI', {
      value: { logger: { write: writeMock } },
      configurable: true,
      writable: true,
    });

    logWarn('警告信息', { reason: 'timeout' });

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const [msg, extra] = consoleWarnSpy.mock.calls[0];
    expect(msg).toBe('警告信息');
    expect(extra).toMatchObject({ reason: 'timeout' });

    expect(writeMock).toHaveBeenCalledWith('warn', '警告信息', { reason: 'timeout' });
  });

  it('logger.write 同步抛错时静默兜底（不向上抛出）', () => {
    Object.defineProperty(globalThis, 'electronAPI', {
      value: {
        logger: {
          write: () => {
            throw new Error('IPC bridge broken');
          },
        },
      },
      configurable: true,
      writable: true,
    });

    // 不应抛出
    expect(() => logError('x', new Error('e'))).not.toThrow();
    // console.error 仍应输出（在 throw 之前）
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('logger.write 返回 rejected promise 时静默兜底（不产生 unhandledrejection）', async () => {
    const rejectPromise = Promise.reject(new Error('IPC reject'));
    Object.defineProperty(globalThis, 'electronAPI', {
      value: { logger: { write: () => rejectPromise } },
      configurable: true,
      writable: true,
    });

    logError('x', new Error('e'));

    // 等待一个微任务让 rejected promise 的 .catch 处理完成
    await new Promise((r) => setTimeout(r, 0));
    // 若 .catch 未正确接住，unhandledrejection 会在测试中抛出；此处到达即说明兜底成功
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('非 Electron 环境（无 electronAPI）静默跳过转发，仅 console 输出', () => {
    // 完全移除 electronAPI
    Object.defineProperty(globalThis, 'electronAPI', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(() => logError('x', new Error('e'))).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('electronAPI.logger 缺失时静默跳过转发', () => {
    Object.defineProperty(globalThis, 'electronAPI', {
      value: {}, // 有 electronAPI 但无 logger
      configurable: true,
      writable: true,
    });

    expect(() => logWarn('x', { a: 1 })).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});
