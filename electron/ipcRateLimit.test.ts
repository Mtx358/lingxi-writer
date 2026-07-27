/**
 * electron/ipcRateLimit.ts 单元测试
 *
 * 测试目标：
 * - 令牌桶算法：首次满载允许 burst，耗尽后拒绝
 * - 按需补充：等待一段时间后令牌恢复
 * - 按 channel + sender 独立限流：不同 sender 互不影响
 * - 不同 channel 不同配置：写操作比读操作更严格
 * - 默认配置覆盖所有已注册 IPC channel
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createIpcRateLimiter,
  RateLimitError,
  __test__,
} from './ipcRateLimit';

describe('ipcRateLimit', () => {
  let limiter: ReturnType<typeof createIpcRateLimiter>;

  beforeEach(() => {
    limiter = createIpcRateLimiter();
  });

  // -------------------- 令牌桶基础行为 --------------------
  describe('令牌桶基础', () => {
    it('首次调用不超限（满载令牌）', () => {
      const err = limiter.check('storage:read', 1);
      expect(err).toBeNull();
    });

    it('连续调用超过 capacity 后超限', () => {
      // storage:read capacity=10，前 10 次通过，第 11 次超限
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('storage:read', 1)).toBeNull();
      }
      const err = limiter.check('storage:read', 1);
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err?.channel).toBe('storage:read');
      expect(err?.senderId).toBe(1);
    });

    it('超限错误信息包含 channel / senderId / 配置', () => {
      // ai:proxyStream capacity=2，2 次后超限
      limiter.check('ai:proxyStream', 1);
      limiter.check('ai:proxyStream', 1);
      const err = limiter.check('ai:proxyStream', 1);
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err?.message).toContain('ai:proxyStream');
      expect(err?.message).toContain('senderId=1');
      expect(err?.message).toContain('capacity=2');
    });
  });

  // -------------------- 令牌补充 --------------------
  describe('令牌补充', () => {
    it('等待足够时间后令牌恢复', () => {
      // storage:read refillPerSec=1，capacity=10
      // 耗尽 10 个令牌后等待 1.1s，应补充 1 个令牌可再调 1 次
      for (let i = 0; i < 10; i++) {
        limiter.check('storage:read', 1);
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);

      // 用 vi.useFakeTimers 模拟时间流逝
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);
      // Date.now 被 fake，但 limiter 内部用 Date.now() 读时间
      const err = limiter.check('storage:read', 1);
      vi.useRealTimers();
      expect(err).toBeNull(); // 补充 1.1 个令牌，消费 1 个
    });

    it('令牌恢复不超过 capacity（封顶）', () => {
      // 耗尽令牌后等待很长时间，恢复后的令牌数不应超过 capacity
      for (let i = 0; i < 10; i++) {
        limiter.check('storage:read', 1);
      }
      vi.useFakeTimers();
      vi.advanceTimersByTime(100_000); // 等待 100s，应恢复并封顶到 capacity=10
      // 关键：必须在 fake timers 活跃期间调用 check()，refill 才会用 fake 时间计算
      // 否则 vi.useRealTimers() 后 Date.now 回到真实时间（≈ T0），elapsed≈0 无法补充
      // capacity=10，应允许 10 次（恢复封顶，不应是 100 次）
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('storage:read', 1)).toBeNull();
      }
      // 第 11 次应超限
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);
      vi.useRealTimers();
    });

    it('短时间等待不补充足够令牌', () => {
      for (let i = 0; i < 10; i++) {
        limiter.check('storage:read', 1);
      }
      vi.useFakeTimers();
      vi.advanceTimersByTime(100); // 0.1s = 0.1 令牌
      // 必须在 fake timers 活跃期间调用 check() 触发 refill 计算
      // 0.1 令牌 < 1，仍应超限
      const err = limiter.check('storage:read', 1);
      vi.useRealTimers();
      expect(err).toBeInstanceOf(RateLimitError);
    });
  });

  // -------------------- 多 sender 隔离 --------------------
  describe('多 sender 隔离', () => {
    it('不同 senderId 独立限流', () => {
      // sender 1 耗尽 storage:read 令牌
      for (let i = 0; i < 10; i++) {
        limiter.check('storage:read', 1);
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);
      // sender 2 不受影响，仍可调用
      expect(limiter.check('storage:read', 2)).toBeNull();
    });

    it('同一 sender 不同 channel 独立限流', () => {
      // 耗尽 storage:read（capacity=10）
      for (let i = 0; i < 10; i++) {
        limiter.check('storage:read', 1);
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);
      // storage:write 是不同 channel，独立桶（capacity=5）
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('storage:write', 1)).toBeNull();
      }
      expect(limiter.check('storage:write', 1)).toBeInstanceOf(RateLimitError);
    });
  });

  // -------------------- 不同 channel 不同配置 --------------------
  describe('channel 配置', () => {
    it('写操作 capacity 比读操作小', () => {
      // storage:read capacity=10
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('storage:read', 1)).toBeNull();
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);

      // storage:write capacity=5
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('storage:write', 1)).toBeNull();
      }
      expect(limiter.check('storage:write', 1)).toBeInstanceOf(RateLimitError);
    });

    it('ai:proxyStream capacity=2（AI 调用最严格）', () => {
      expect(limiter.check('ai:proxyStream', 1)).toBeNull();
      expect(limiter.check('ai:proxyStream', 1)).toBeNull();
      expect(limiter.check('ai:proxyStream', 1)).toBeInstanceOf(RateLimitError);
    });

    it('对话框 channel capacity=2', () => {
      expect(limiter.check('dialog:selectFile', 1)).toBeNull();
      expect(limiter.check('dialog:selectFile', 1)).toBeNull();
      expect(limiter.check('dialog:selectFile', 1)).toBeInstanceOf(RateLimitError);
    });

    it('未配置的 channel 使用 GLOBAL_DEFAULT', () => {
      // GLOBAL_DEFAULT capacity=10
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('unknown:channel', 1)).toBeNull();
      }
      expect(limiter.check('unknown:channel', 1)).toBeInstanceOf(RateLimitError);
    });
  });

  // -------------------- 动态配置 --------------------
  describe('动态配置', () => {
    it('configure 可覆盖默认配置', () => {
      // 默认 storage:read capacity=10
      // configure 改为 capacity=3
      limiter.configure('storage:read', { capacity: 3, refillPerSec: 0.5 });
      for (let i = 0; i < 3; i++) {
        expect(limiter.check('storage:read', 1)).toBeNull();
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);
    });

    it('configure 不影响其他 channel', () => {
      limiter.configure('storage:read', { capacity: 3, refillPerSec: 0.5 });
      // storage:write 仍用默认 capacity=5
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('storage:write', 1)).toBeNull();
      }
      expect(limiter.check('storage:write', 1)).toBeInstanceOf(RateLimitError);
    });
  });

  // -------------------- reset --------------------
  describe('reset', () => {
    it('reset 后所有状态清空', () => {
      for (let i = 0; i < 10; i++) {
        limiter.check('storage:read', 1);
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);
      limiter.reset();
      // reset 后首次调用应通过（满载令牌）
      expect(limiter.check('storage:read', 1)).toBeNull();
    });

    it('reset 后自定义配置也清空', () => {
      limiter.configure('storage:read', { capacity: 3, refillPerSec: 0.5 });
      limiter.reset();
      // reset 后恢复默认 capacity=10
      for (let i = 0; i < 10; i++) {
        expect(limiter.check('storage:read', 1)).toBeNull();
      }
      expect(limiter.check('storage:read', 1)).toBeInstanceOf(RateLimitError);
    });
  });

  // -------------------- getSnapshot --------------------
  describe('getSnapshot', () => {
    it('返回内部状态副本', () => {
      limiter.check('storage:read', 1);
      const snap = limiter.getSnapshot();
      expect(snap.size).toBe(1);
      expect(snap.has('storage:read:1')).toBe(true);
      // capacity=10，消费 1 个后剩 9
      const state = snap.get('storage:read:1');
      expect(state?.tokens).toBeCloseTo(9, 5);
    });

    it('修改 snapshot 不影响内部状态', () => {
      limiter.check('storage:read', 1);
      const snap = limiter.getSnapshot();
      snap.set('storage:read:1', { tokens: 999, lastRefillTs: 0 });
      // 内部状态应未变
      const snap2 = limiter.getSnapshot();
      expect(snap2.get('storage:read:1')?.tokens).toBeCloseTo(9, 5);
    });
  });

  // -------------------- 内部默认配置 --------------------
  describe('内部默认配置', () => {
    it('DEFAULT_CONFIGS 覆盖所有已注册 IPC channel', () => {
      // 验证关键 channel 都有显式配置
      const channels = Object.keys(__test__.DEFAULT_CONFIGS);
      expect(channels).toContain('storage:read');
      expect(channels).toContain('storage:write');
      expect(channels).toContain('storage:remove');
      expect(channels).toContain('storage:patchProjects');
      expect(channels).toContain('storage:readFileBase64');
      expect(channels).toContain('storage:writeFile');
      expect(channels).toContain('storage:writeFileBuffer');
      expect(channels).toContain('storage:backupProject');
      expect(channels).toContain('storage:listProjectDirs');
      expect(channels).toContain('projectFile:read');
      expect(channels).toContain('projectFile:write');
      expect(channels).toContain('projectFile:validate');
      expect(channels).toContain('projectFile:backup');
      expect(channels).toContain('projectFile:listBackups');
      expect(channels).toContain('projectFile:restoreBackup');
      expect(channels).toContain('projectFile:openDialog');
      expect(channels).toContain('projectFile:saveDialog');
      expect(channels).toContain('ai:proxyStream');
      expect(channels).toContain('ai:abort');
      expect(channels).toContain('ai:saveSettings');
      expect(channels).toContain('ai:loadSettings');
      expect(channels).toContain('dialog:selectFile');
      expect(channels).toContain('dialog:saveFile');
      expect(channels).toContain('file:openExternal');
      expect(channels).toContain('file:readDataURL');
      expect(channels).toContain('material:saveAttachment');
      expect(channels).toContain('material:deleteAttachment');
      expect(channels).toContain('system:checkCrashRecovery');
    });

    it('读操作 capacity >= 写操作 capacity', () => {
      const readCap = __test__.DEFAULT_CONFIGS['storage:read'].capacity;
      const writeCap = __test__.DEFAULT_CONFIGS['storage:write'].capacity;
      expect(readCap).toBeGreaterThan(writeCap);
    });

    it('ai:proxyStream capacity 最小（2）', () => {
      expect(__test__.DEFAULT_CONFIGS['ai:proxyStream'].capacity).toBe(2);
    });

    it('GLOBAL_DEFAULT capacity=10', () => {
      expect(__test__.GLOBAL_DEFAULT.capacity).toBe(10);
    });
  });
});
