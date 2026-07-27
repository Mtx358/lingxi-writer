/**
 * autoSave 独立单元测试
 *
 * 直接 import './autoSave' 模块，聚焦模块级状态机（isDirty/dirtyVersion/
 * autoSaveTimer/inflightSave）的转移与时序。与 storage.test.ts 的 auto-save 边界
 * 用例互补：本文件重点验证 timer 重置不累积、triggerSave 成功后清理 timer、
 * 串行化保存链与 dirtyVersion 冲突保护等调度不变量。
 *
 * 关键不变量：
 *   - markDirty 多次只保留最后一个 timer（不累积多次自动保存）
 *   - triggerSave 成功且无新 dirty 时清理 autoSaveTimer
 *   - triggerSave 期间 markDirty 不丢失（dirtyVersion 自增，不清 isDirty/timer）
 *   - 串行化保存（inflightSave 链）：并发 triggerSave 各执行一次
 *   - saveCallback 抛错 → isDirty 保持 true 以便下周期重试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  markDirty,
  triggerSave,
  setAutoSaveCallback,
  clearAutoSaveTimer,
  getDirtyState,
} from './autoSave';
import { AUTOSAVE_INTERVAL } from '@/constants/config';

describe('autoSave 调度', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    clearAutoSaveTimer();
    setAutoSaveCallback(async () => {});
    // 若上一个测试遗留 dirty，先保存清掉
    if (getDirtyState()) {
      await triggerSave();
    }
  });

  afterEach(() => {
    clearAutoSaveTimer();
    setAutoSaveCallback(async () => {});
    vi.useRealTimers();
  });

  it('markDirty 设置 isDirty 为 true', () => {
    expect(getDirtyState()).toBe(false);
    markDirty();
    expect(getDirtyState()).toBe(true);
  });

  it('markDirty 多次只保留最后一个 timer（不累积多次自动保存）', async () => {
    const cb = vi.fn(async () => {});
    setAutoSaveCallback(cb);
    markDirty();
    markDirty(); // 应 clearTimeout 旧 timer 并设新 timer
    markDirty();
    expect(cb).not.toHaveBeenCalled();
    // 推进一个完整周期：三个 markDirty 仅触发一次自动保存
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getDirtyState()).toBe(false);
  });

  it('markDirty 触发的自动保存 timer 到期后调用 saveCallback 并清 isDirty', async () => {
    const cb = vi.fn(async () => {});
    setAutoSaveCallback(cb);
    markDirty();
    expect(cb).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getDirtyState()).toBe(false);
  });

  it('triggerSave 成功且无新 markDirty 时清理 autoSaveTimer（不再触发自动保存）', async () => {
    const cb = vi.fn(async () => {});
    setAutoSaveCallback(cb);
    markDirty(); // 设置自动保存 timer
    // 手动保存成功：无新 dirty → 应清理 timer
    await triggerSave();
    expect(cb).toHaveBeenCalledTimes(1);
    // 推进超过自动保存周期：timer 已被 triggerSave 清理，不应再触发
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL + 5000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getDirtyState()).toBe(false);
  });

  it('triggerSave 期间 markDirty 不丢失（dirtyVersion 冲突保护，isDirty 保持 true）', async () => {
    let resolveSave!: () => void;
    const blocking = new Promise<void>(resolve => {
      resolveSave = resolve;
    });
    const cb = vi.fn(() => blocking);
    setAutoSaveCallback(cb);
    markDirty();
    const triggerPromise = triggerSave();
    // 保存进行中时再次 markDirty → dirtyVersion 自增
    markDirty();
    resolveSave();
    await triggerPromise;
    // 新 dirty 不应被覆盖
    expect(getDirtyState()).toBe(true);
  });

  it('串行化保存：并发 triggerSave 通过 inflightSave 链各执行一次（不跳过）', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>(resolve => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    const cb = vi.fn(async () => {
      callCount++;
      if (callCount === 1) await first;
    });
    setAutoSaveCallback(cb);
    markDirty();
    const a = triggerSave();
    const b = triggerSave();
    resolveFirst();
    await Promise.all([a, b]);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('saveCallback 抛错 → isDirty 保持 true 以便下周期重试', async () => {
    const cb = vi.fn(async () => {
      throw new Error('disk full');
    });
    setAutoSaveCallback(cb);
    markDirty();
    expect(getDirtyState()).toBe(true);
    await triggerSave();
    expect(getDirtyState()).toBe(true);
  });

  it('markDirty 自动保存失败 → isDirty 保持 true 供下次周期重试', async () => {
    const cb = vi.fn(async () => {
      throw new Error('disk full');
    });
    setAutoSaveCallback(cb);
    markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL);
    // 自动保存失败：保留 dirty 以便下个周期重试
    expect(getDirtyState()).toBe(true);
  });
});
