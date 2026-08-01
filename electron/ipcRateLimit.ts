// IPC 速率限制器：按 channel + sender 维度做令牌桶限流。
//
// 设计目标：
// - 防止渲染层被 XSS 后高频刷 IPC 触发磁盘 IO/Fetch DoS
// - 按 channel + senderId 维度独立限流，单窗口的恶意调用不影响其他窗口
// - 令牌桶算法：允许突发（burst），但持续调用受限于 refill 速率
// - 不同 channel 可配置不同限额（写操作比读操作更严格）
// - 超限时返回 RateLimitError，调用方据此后续处理（throw / 返回错误响应）
//
// 用法：
//   const limiter = createIpcRateLimiter();
//   limiter.check('storage:write', senderId); // 不超限：返回 null；超限：返回 Error
//   limiter.configure('ai:proxyStream', { capacity: 2, refillPerSec: 0.1 });
//
// 导出 createIpcRateLimiter 与 RateLimitError 供单测

export interface RateLimitConfig {
  // 桶容量：允许瞬间突发的最大请求数
  capacity: number;
  // 每秒补充的令牌数（持续调用速率上限）
  refillPerSec: number;
}

export class RateLimitError extends Error {
  constructor(
    public readonly channel: string,
    public readonly senderId: number,
    message: string,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

interface BucketState {
  tokens: number;
  lastRefillTs: number;
}

// 默认限流配置：按 channel 类型分组
// - 读操作：60 req/min 持续，10 burst
// - 写操作：20 req/min 持续，5 burst
// - AI 调用：6 req/min 持续（每次 AI 调用可能耗时数十秒），2 burst
// - 文件对话框：10 req/min（用户操作频率天然受限，防 XSS 自动刷弹窗）
const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  // 读操作组（容量 10，每秒补充 1）
  'storage:read': { capacity: 10, refillPerSec: 1 },
  'storage:readFileBase64': { capacity: 10, refillPerSec: 1 },
  'storage:listProjectDirs': { capacity: 10, refillPerSec: 1 },
  'projectFile:read': { capacity: 10, refillPerSec: 1 },
  'projectFile:validate': { capacity: 10, refillPerSec: 1 },
  'projectFile:listBackups': { capacity: 10, refillPerSec: 1 },
  'file:readDataURL': { capacity: 10, refillPerSec: 1 },
  'system:checkCrashRecovery': { capacity: 5, refillPerSec: 0.5 },
  'ai:loadSettings': { capacity: 5, refillPerSec: 0.5 },

  // 写操作组（容量 500，每秒补充 100 = 6000/min）
  // 一次保存项目会顺序触发 8 次 storage:write（chapters/characters/settings/foreshadows/
  // materials/versions/patchProjects 等），capacity=30 时 4 次保存即超限。
  // capacity=500 可支撑 62 次保存的 burst，refillPerSec=100 支撑 12.5 次/秒持续保存。
  // XSS 防护：主进程对单 key 有 50MB size limit，每秒 100 次写入无法撑爆磁盘
  'storage:write': { capacity: 500, refillPerSec: 100 },
  'storage:writeBatch': { capacity: 500, refillPerSec: 100 },
  'storage:readBatch': { capacity: 500, refillPerSec: 100 },
  'storage:remove': { capacity: 500, refillPerSec: 100 },
  'storage:patchProjects': { capacity: 500, refillPerSec: 100 },
  'storage:writeFile': { capacity: 500, refillPerSec: 100 },
  'storage:writeFileBuffer': { capacity: 500, refillPerSec: 100 },
  // 导出文件专用通道（与 storage:writeFileBuffer 同档）
  'export:writeFile': { capacity: 500, refillPerSec: 100 },
  'export:writeFileBuffer': { capacity: 500, refillPerSec: 100 },
  'storage:backupProject': { capacity: 10, refillPerSec: 1 },
  'projectFile:write': { capacity: 500, refillPerSec: 100 },
  'projectFile:backup': { capacity: 10, refillPerSec: 1 },
  'projectFile:restoreBackup': { capacity: 10, refillPerSec: 1 },
  'ai:saveSettings': { capacity: 10, refillPerSec: 1 },
  'material:saveAttachment': { capacity: 15, refillPerSec: 2 },
  'material:deleteAttachment': { capacity: 20, refillPerSec: 3 },
  'file:openExternal': { capacity: 20, refillPerSec: 3 },

  // AI 调用（容量 2，每秒补充 0.1 = 6/min）
  // proxyStream 与 proxyLLM 都是带密钥的 AI API 调用，XSS 后可借此高频刷请求
  // 烧光用户 OpenAI 配额，故两者限流保持一致，均回落到 6 次/分钟
  'ai:proxyStream': { capacity: 2, refillPerSec: 0.1 },
  'ai:proxyLLM': { capacity: 2, refillPerSec: 0.1 },
  'ai:abort': { capacity: 10, refillPerSec: 1 },

  // 文件对话框（容量 2，每秒补充 0.16 = 10/min）
  'projectFile:openDialog': { capacity: 2, refillPerSec: 1 / 6 },
  'projectFile:saveDialog': { capacity: 2, refillPerSec: 1 / 6 },
  'dialog:selectFile': { capacity: 2, refillPerSec: 1 / 6 },
  'dialog:saveFile': { capacity: 2, refillPerSec: 1 / 6 },

  // 渲染层日志上报（容量 10，每秒补充 1 = 60/min）
  // 渲染层 catch 块 + window.onerror + unhandledrejection 都会通过此 channel 转发到主进程日志。
  // 容量 10 允许 burst（短时间内多个错误同时上报），refillPerSec=1 防止 XSS 后刷日志撑爆磁盘
  'logger:write': { capacity: 10, refillPerSec: 1 },
};

// 全局默认：未在 DEFAULT_CONFIGS 中显式配置的 channel 使用此配置
const GLOBAL_DEFAULT: RateLimitConfig = { capacity: 10, refillPerSec: 1 };

export interface IpcRateLimiter {
  // 检查是否超限。超限返回 RateLimitError，调用方据此 throw / 返回错误。
  // 不超限返回 null 并消费一个令牌
  check(channel: string, senderId: number): RateLimitError | null;

  // 动态配置某 channel 的限流参数（仅供测试与未来扩展使用）
  configure(channel: string, config: RateLimitConfig): void;

  // 重置所有状态：仅供单测隔离使用
  reset(): void;

  // 获取内部状态快照（仅供测试与诊断使用）
  getSnapshot(): Map<string, BucketState>;
}

export function createIpcRateLimiter(): IpcRateLimiter {
  // key 格式：`${channel}:${senderId}`，按 channel + sender 独立限流
  const buckets = new Map<string, BucketState>();
  // 允许运行时覆盖默认配置（测试用）
  const customConfigs = new Map<string, RateLimitConfig>();

  const getConfig = (channel: string): RateLimitConfig => {
    return customConfigs.get(channel) ?? DEFAULT_CONFIGS[channel] ?? GLOBAL_DEFAULT;
  };

  const refill = (state: BucketState, config: RateLimitConfig, now: number): void => {
    const elapsed = (now - state.lastRefillTs) / 1000;
    if (elapsed <= 0) return;
    const refilled = state.tokens + elapsed * config.refillPerSec;
    state.tokens = Math.min(config.capacity, refilled);
    state.lastRefillTs = now;
  };

  return {
    check(channel: string, senderId: number): RateLimitError | null {
      const config = getConfig(channel);
      const key = `${channel}:${senderId}`;
      const now = Date.now();
      let state = buckets.get(key);
      if (!state) {
        // 初始桶：满载令牌（首次调用允许 burst）
        state = { tokens: config.capacity, lastRefillTs: now };
        buckets.set(key, state);
      } else {
        refill(state, config, now);
      }
      if (state.tokens < 1) {
        return new RateLimitError(
          channel,
          senderId,
          `IPC rate limit exceeded: channel=${channel} senderId=${senderId} (capacity=${config.capacity} refillPerSec=${config.refillPerSec})`,
        );
      }
      state.tokens -= 1;
      return null;
    },

    configure(channel: string, config: RateLimitConfig): void {
      customConfigs.set(channel, config);
    },

    reset(): void {
      buckets.clear();
      customConfigs.clear();
    },

    getSnapshot(): Map<string, BucketState> {
      return new Map(buckets);
    },
  };
}

// 单例限流器：全应用共享，所有 IPC handler 通过 safeIpcHandle 自动接入
export const ipcRateLimiter = createIpcRateLimiter();

// 仅供单测：暴露内部常量
export const __test__ = {
  DEFAULT_CONFIGS,
  GLOBAL_DEFAULT,
};
