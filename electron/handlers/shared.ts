// 共享工具与状态：供各 handler 模块复用。
// 依赖 electron app / node 内置模块 / logger / ipcRateLimit / ./security（路径校验）。
import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { logger } from '../logger';
import { ipcRateLimiter } from '../ipcRateLimit';
// 反向依赖 ./security：本模块被 security 导入（getDataDir/getBackupsDir），
// 此处再导入 assertRealPathInside 构成循环。CommonJS 下对"运行时函数引用"安全：
// 双方仅在函数体内调用对方导出，模块加载时不执行，partial exports 不影响运行时解析
import { assertRealPathInside } from './security';

const FILE_VERSION = '1.0.0';

// storage:write 单个 value 序列化后最大字节数：50MB。
// 防止渲染层被 XSS 后写入超大 value 撑爆磁盘（DoS）。
// 50MB 足以容纳最长小说的章节内容 + recovery_draft；超出此阈值几乎必然是异常
const MAX_STORAGE_VALUE_SIZE = 50 * 1024 * 1024;

// IPC 幂等注册：防止热重载或多次调用导致
// "Attempted to register a second handler for 'xxx'" 错误
// 同时接入速率限制：所有 IPC handler 自动按 channel 配置限流（防 XSS 后 DoS）
//
// rate-limit audit 节流：每个 channel 每 60s 最多落盘 1 条 security.rate_limit audit。
// 攻击者可高频触发被限流的 IPC（每次命中都同步落盘 audit）制造日志洪水撑爆磁盘，
// 故命中时若距上次记录 <60s 仅递增计数器不记录；60s 窗口到期后若被抑制命中 >1
// 补一条 "suppressed (×N in last 60s)" 汇总。before-quit 清理 timer 防泄漏。
const RATE_LIMIT_AUDIT_WINDOW_MS = 60_000;
const rateLimitAuditState = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> | null }>();

function clearRateLimitAuditTimers(): void {
  for (const entry of rateLimitAuditState.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
  rateLimitAuditState.clear();
}

function safeIpcHandle(
  channel: string,
  // IPC handler 的剩余参数由各调用方自行声明具体类型（如 filePath: string），
  // 此处用 any[] 是合理的分发点，强制 unknown 会与调用方逆变冲突。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  try { ipcMain.removeHandler(channel); } catch { /* 首次注册时无已存在 handler，忽略 */ }
  // 包装 listener：先做速率限制检查，超限直接抛错不执行业务逻辑
  // 使用方括号访问避免与下方 replace_all 字面量冲突
  ipcMain['handle'](channel, (event, ...args) => {
    const rateLimitError = ipcRateLimiter.check(channel, event.sender.id);
    if (rateLimitError) {
      const existing = rateLimitAuditState.get(channel);
      if (existing && existing.timer) {
        // 距上次记录 <60s：仅递增计数器，不落盘（防日志洪水）
        existing.count++;
      } else {
        // 窗口已过期或首次命中：落盘本次，开启 60s 窗口
        logger.audit('security.rate_limit', 'IPC rejected: rate limit exceeded', {
          channel,
          senderId: rateLimitError.senderId,
        });
        const entry: { count: number; timer: ReturnType<typeof setTimeout> | null } = { count: 1, timer: null };
        entry.timer = setTimeout(() => {
          // 60s 窗口到期：若期间有被抑制的额外命中，补一条汇总日志
          if (entry.count > 1) {
            logger.audit('security.rate_limit', `rate limit suppressed (×${entry.count} in last 60s)`, { channel });
          }
          rateLimitAuditState.delete(channel);
        }, RATE_LIMIT_AUDIT_WINDOW_MS);
        rateLimitAuditState.set(channel, entry);
      }
      throw rateLimitError;
    }
    return listener(event, ...args);
  });
}

// ipcMain 已在文件顶部与 app 一起导入，供 safeIpcHandle 使用。

// 允许的存储 key 白名单（非 project_ 前缀的全局 key）
// project_ 前缀的 key 由 resolveFilePath 单独处理，按 projectId 分目录存储
// 注意：'aiSettings' 不在此白名单中——写入走专用 ai:saveSettings IPC，
// 防止渲染层被 XSS 后任意覆写 apiKey/provider 等字段，绕过 CSP 把章节内容外传到
// 攻击者控制的 OpenAI 账号（attacker-key 计费，OpenAI 控制台可读全部章节内容）
const ALLOWED_GLOBAL_STORAGE_KEYS = new Set([
  'projects',
  'recovery_draft',
  'app_migration_version',
  'lastOpenedProject',
]);

// 仅允许 storage:read / storage:remove 但禁止 storage:write 的 key。
// aiSettings 已从此集合移除：渲染层被 XSS 后 storage:read('aiSettings') 仍可读到
// 磁盘密文（含 safeStorage 加密的 apiKey），属于敏感数据泄漏面。
// loadAISettings 已改走专用 ai:loadSettings IPC（主进程内部解密后返回明文），
// 故 storage:read('aiSettings') 不再需要放行——返回 null 即可
const READ_ONLY_STORAGE_KEYS = new Set<string>([
  // 暂无 key 需要走 READ_ONLY 路径；aiSettings 已移除
]);

function isValidStorageKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) return false;
  // project_ 前缀的 key 由 resolveFilePath 处理（格式 project_{id} 或 project_{id}_{subkey}）
  // 必须带非空 projectId，否则 storage:remove 会落到 resolveDirPath('project_')
  // 而 resolveDirPath 对空 projectId 返回 projects 根目录，导致 rm -rf 删除全部项目数据
  if (key.startsWith('project_')) {
    const rest = key.slice('project_'.length);
    if (!rest) return false; // 拒绝 'project_' 单独前缀
    // projectId 部分不允许含分隔符/穿越符，由 resolveFilePath 二次校验
    const projectIdPart = rest.split('_')[0];
    if (!projectIdPart) return false;
    return true;
  }
  // 全局 key 必须在白名单中
  return ALLOWED_GLOBAL_STORAGE_KEYS.has(key);
}

function getDataDir(): string {
  return app.getPath('userData');
}

function getProjectsDir(): string {
  return path.join(getDataDir(), 'projects');
}

function getBackupsDir(): string {
  return path.join(getDataDir(), 'backups');
}

function ensureDir(filePath: string): Promise<void> {
  return fs.mkdir(path.dirname(filePath), { recursive: true }).then(() => undefined);
}

function pathExists(p: string): Promise<boolean> {
  try {
    return fs.access(p).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

// 写入互斥锁：按 filePath 串行化并发写入，避免 tmp/bak 互相覆盖导致数据错乱。
// key 为最终目标文件路径，同一 key 的写入会排队执行；不同 key 互不阻塞。
const writeMutex = new Map<string, Promise<unknown>>();

// 退出流程标志：before-quit 进入后置 true，withWriteMutex 据此拒绝新写入排队，
// 避免退出期间渲染层又触发新 save 导致 quit 永远等不到 pending writes 清空
let isQuitting = false;

// 主进程入口在 before-quit 中调用，标记进入退出流程
function setQuitting(value: boolean): void {
  isQuitting = value;
}

// 等待所有 pending writes 完成：拷贝当前 mutex 快照后 await，
// 期间新进入的写入（被 isQuitting 拒绝，正常不会发生）不计入本次等待
async function awaitPendingWrites(): Promise<void> {
  const pending = Array.from(writeMutex.values());
  if (pending.length === 0) return;
  logger.info('Quit: awaiting pending writes', { count: pending.length });
  // catch 每条 promise：单条写入失败不应阻断退出流程
  await Promise.all(pending.map(p => p.catch(() => {})));
}

// 串行化同一 key 的并发写入：A/B 同时写同一 filePath 时，B 必须等 A release 才能开始。
// 避免"A 写 tmp → B 覆盖 tmp → A rename 把 B 内容落盘返回成功但数据丢失"的不一致问题。
// 退出流程中（isQuitting=true）拒绝新写入排队：避免 before-quit 等待 pending writes 时
// 渲染层又触发新 save 导致 quit 永远等不到清空。拒绝时抛错让调用方感知并提示用户。
async function withWriteMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (isQuitting) {
    throw new Error('Application is quitting, new writes rejected');
  }
  // 取出前一个未完成的写入 promise，本任务必须等它完成才能开始
  const prev = writeMutex.get(key) || Promise.resolve();
  // 创建本任务的 release 回调；next 在 release 调用后才 resolve（无 reject 路径）
  let release!: () => void;
  const next = new Promise<void>(r => { release = r; });
  // 把 next.then(()=>undefined) 放入 Map 作为后续任务的 prev：
  // .then 包装隔离 promise 链，保证本任务 fn 的 rejection 不会传染到后续任务的 await prev
  const stored = next.then(() => undefined);
  writeMutex.set(key, stored);
  try {
    await prev;
    // 记录 mutex 实际持有起始时间（获得锁后、执行 fn 前），finally 中检测
    // 是否超 30s：超时视为资源泄漏仅告警，不强制释放（强制释放会让后续任务
    // 提前进入临界区，破坏串行化保证导致并发写丢失数据）
    const startTime = Date.now();
    try {
      return await fn();
    } finally {
      const heldMs = Date.now() - startTime;
      if (heldMs > 30000) {
        logger.warn?.(`withWriteMutex ${key} held for ${heldMs}ms, possible resource leak`);
      }
    }
  } finally {
    release();
    // 仅当 Map 中存的仍是本任务的 stored 时才删除，避免误删后续任务的 mutex
    if (writeMutex.get(key) === stored) {
      writeMutex.delete(key);
    }
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function generateChecksum(data: string): string {
  // 改用 sha256：DJB2 32 位哈希碰撞概率过高，无法可靠校验工程文件完整性
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

// 主窗口引用：createWindow 创建后通过 setMainWindow 写入，各 handler 通过 getMainWindow 读取。
// 关闭后置 null，防止 IPC handler 拿到已销毁的窗口引用调用 dialog/BrowserWindow API
let mainWindowRef: BrowserWindow | null = null;
function getMainWindow(): BrowserWindow | null {
  return mainWindowRef;
}
function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

// ============================================================================
// 路径校验样板抽取
// ============================================================================
// projectFile / exportFile 等 handler 中重复出现"lexical 校验 + realpath 断言 +
// audit 日志 + 错误返回"四段式样板（单文件内重复 6+ 次）。统一抽到此函数消除重复，
// 各 handler 只需声明 validator + roots + 错误文案，校验与审计逻辑收敛到一处。
//
// 调用方约定：
//   const result = await validatePathAndAudit(
//     'projectFile:read', filePath, isSafeProjectFilePath, getAllowedProjectFileRoots(),
//     { invalidError: '非法的工程文件路径' },
//   );
//   if (!result.ok) return { success: false, error: result.error };
//   // result.ok === true，继续业务逻辑
export type PathValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function validatePathAndAudit(
  channel: string,
  filePath: unknown,
  validator: (p: unknown) => boolean,
  roots: string[],
  options?: {
    invalidError?: string;
    outsideError?: string;
  },
): Promise<PathValidationResult> {
  // 1. lexical 校验（path.normalize + 前缀匹配，不解析 symlink）
  if (!validator(filePath)) {
    logger.audit('security.path', `${channel} rejected: invalid path`, { filePath: String(filePath) });
    return { ok: false, error: options?.invalidError ?? '非法的路径' };
  }
  // validator 多为 type guard（如 isSafeProjectFilePath），但跨函数边界 TS 不传播窄化，
  // 此处断言为 string 以满足 assertRealPathInside 的入参类型
  const fp = filePath as string;
  // 2. realpath 校验：递归解析符号链接，防止 lexical 检查被 symlink 绕过
  if (!(await assertRealPathInside(fp, roots))) {
    logger.audit('security.path', `${channel} rejected: realpath outside allowed roots (symlink?)`, { filePath: fp });
    return { ok: false, error: options?.outsideError ?? '路径解析失败或位于允许目录外（可能是符号链接）' };
  }
  return { ok: true };
}

export {
  FILE_VERSION,
  MAX_STORAGE_VALUE_SIZE,
  RATE_LIMIT_AUDIT_WINDOW_MS,
  clearRateLimitAuditTimers,
  safeIpcHandle,
  ALLOWED_GLOBAL_STORAGE_KEYS,
  READ_ONLY_STORAGE_KEYS,
  isValidStorageKey,
  getDataDir,
  getProjectsDir,
  getBackupsDir,
  ensureDir,
  pathExists,
  setQuitting,
  awaitPendingWrites,
  withWriteMutex,
  copyDir,
  generateChecksum,
  getMainWindow,
  setMainWindow,
};
