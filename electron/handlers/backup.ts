// 自动备份、崩溃恢复、临时文件清理。
// 本模块仅依赖 ./shared 与 node 内置模块 / logger，不依赖其他 handler。
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { logger } from '../logger';
import { safeIpcHandle, getDataDir, getProjectsDir, getBackupsDir, ensureDir, pathExists } from './shared';

// 自动备份计时器：startAutoBackup 启动，before-quit / stopAutoBackup 清理
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

function startAutoBackup() {
  if (autoBackupTimer) return;
  // 每 5 分钟执行一次增量备份
  autoBackupTimer = setInterval(() => {
    void runAutoBackup().catch(err => logger.error('Auto backup failed', err instanceof Error ? err : { error: String(err) }));
  }, 5 * 60 * 1000);
  // unref：让 timer 不阻止进程退出。before-quit 中 clearInterval 是同步执行的，
  // 但若 before-quit 因 await pending write 延迟，timer 可能在最后周期再触发一次
  // runAutoBackup，与正在 abort 的逻辑竞争。unref 后进程可随时退出。
  autoBackupTimer.unref?.();
}

// 主进程入口在 before-quit 中调用，清理自动备份计时器
function stopAutoBackup(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

async function runAutoBackup(): Promise<void> {
  const projectsDir = getProjectsDir();
  const backupsDir = getBackupsDir();
  try {
    await fs.access(projectsDir);
  } catch {
    return; // 没有项目目录则跳过
  }

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  if (projectDirs.length === 0) return;

  await ensureDir(backupsDir);
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (const projectId of projectDirs) {
    const projectDir = path.join(projectsDir, projectId);
    const backupDir = path.join(backupsDir, projectId, dateStr);
    try {
      const exists = await fs.access(backupDir).then(() => true).catch(() => false);
      if (!exists) {
        // 使用 fs.cp 递归并发复制，替代阻塞主进程的 copyDir 串行递归
        await fs.cp(projectDir, backupDir, { recursive: true });
      }
    } catch (err) {
      logger.warn('Backup failed for project', { projectId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 清理超过 7 天的备份
  await cleanupOldDatedBackups(7);
}

async function cleanupOldDatedBackups(days: number): Promise<void> {
  const backupsDir = getBackupsDir();
  try {
    await fs.access(backupsDir);
  } catch {
    return;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const projectEntries = await fs.readdir(backupsDir, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectBackupDir = path.join(backupsDir, projectEntry.name);
    const dateEntries = await fs.readdir(projectBackupDir, { withFileTypes: true });
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) continue;
      const dateMatch = dateEntry.name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) continue;
      // 时区统一：备份目录名用 new Date().toISOString().slice(0,10) 生成（UTC 日期），
      // 解析时也必须用 Date.UTC 按 UTC 解释，否则在 UTC+x 时区用户处
      // new Date(year, month-1, day) 会比 UTC 早 x 小时，导致备份被提前误删。
      // 例如 UTC+8 用户在 2026-07-20 18:00（=07-20 10:00 UTC）创建备份 '2026-07-20'，
      // 7 天后 cleanup 时按 local 解释为 07-20 00:00 local（=07-19 16:00 UTC），
      // 比 cutoff（07-20 10:00 UTC）早 18 小时，会被错误删除。
      const backupDate = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
      if (backupDate < cutoff) {
        await fs.rm(path.join(projectBackupDir, dateEntry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

// 崩溃恢复：检查上次是否异常退出，返回可恢复的项目列表
async function checkCrashRecovery(): Promise<{ recovered: boolean; projects: string[] }> {
  const projectsDir = getProjectsDir();
  const recovered: string[] = [];

  // 保留原有 projects/<id>/main.json.tmp 恢复逻辑（向后兼容旧版本残留 tmp）。
  // projectsDir 不存在时不再 early-return：仍需扫描白名单根目录下的崩溃残留 tmp。
  if (await pathExists(projectsDir)) {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(projectsDir, entry.name);
      const mainFile = path.join(projectDir, 'main.json');
      const tmpFile = path.join(projectDir, 'main.json.tmp');
      // 如果 tmp 文件存在且比主文件新，说明上次写入时崩溃，从 tmp 恢复
      try {
        const [mainStat, tmpStat] = await Promise.all([
          fs.stat(mainFile).catch(() => null),
          fs.stat(tmpFile).catch(() => null),
        ]);
        if (tmpStat && (!mainStat || tmpStat.mtimeMs > mainStat.mtimeMs)) {
          // 校验 tmp 文件是合法 JSON：崩溃时 fs.writeFile 可能仅写入部分字节，
          // 直接 copyFile 覆盖 main.json 会让原本完好的 main.json 被损坏数据替换，
          // 等于把"未丢失数据"变成"数据丢失"。校验失败则删除 tmp，保留 main.json
          try {
            const tmpContent = await fs.readFile(tmpFile, 'utf-8');
            JSON.parse(tmpContent);
            await fs.copyFile(tmpFile, mainFile);
            recovered.push(entry.name);
          } catch (parseErr) {
            logger.warn('Crash recovery: tmp file corrupted, deleting instead of recovering', { tmpFile, error: parseErr instanceof Error ? parseErr.message : String(parseErr) });
            await fs.unlink(tmpFile).catch(() => {});
          }
        }
      } catch (err) {
        logger.warn('Crash recovery check failed for project', { project: entry.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // 扩展扫描（P49-b）：白名单根目录下所有 *.tmp 文件（任务1后包含 UUID，glob *.tmp
  // 仍能匹配）。涵盖 projectFile:write 的 xxx.cwp.{UUID}.tmp（位于白名单根目录，
  // 不在 projects/ 下）与 storage:write 的 xxx.json.{UUID}.tmp（位于 userData/）。
  // 超过 1 小时的认为是崩溃残留：rename 未发生意味着主文件仍是上次成功写入的完整
  // 版本，删除 tmp 即可（不恢复，因为主文件未被覆盖）。
  await cleanupStaleTmpFiles().catch(err => {
    logger.warn('Crash recovery: cleanup stale tmp files failed', { error: err instanceof Error ? err.message : String(err) });
  });

  return { recovered: recovered.length > 0, projects: recovered };
}

// 递归扫描应用自身写入目录下的 *.tmp 文件，清理超过 staleAgeMs 的崩溃残留。
// 1 小时阈值避免误删正在写入的临时文件（写入通常在秒级完成）。
// 仅扫描 userData 和 userData/projects（应用自身写入 tmp 的目录），
// 不扫描 getAllowedProjectFileRoots() 的 home/Documents/Desktop/Downloads：
//   1. 这些目录文件量大，递归扫描产生大量 I/O 耗时数十秒
//   2. 会扫描并可能删除其他程序的 .tmp 文件
//   3. .cwp 工程文件的 tmp 在 withWriteMutex finally 中已清理，异常残留极少
async function cleanupStaleTmpFiles(): Promise<void> {
  const TMP_STALE_AGE_MS = 60 * 60 * 1000; // 1 小时
  const roots = [getDataDir(), getProjectsDir()];
  for (const root of roots) {
    await scanTmpFilesRecursive(root, TMP_STALE_AGE_MS).catch(err => {
      logger.warn('Crash recovery: scan root failed', { root, error: err instanceof Error ? err.message : String(err) });
    });
  }
}

async function scanTmpFilesRecursive(dir: string, staleAgeMs: number): Promise<void> {
  // readdir 失败（目录不存在/无权限）直接跳过，不阻断其他目录的扫描
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  const now = Date.now();
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 递归扫描子目录（如 projects/{id}、userData 下的子目录）
      await scanTmpFilesRecursive(fullPath, staleAgeMs);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
    try {
      const stat = await fs.stat(fullPath);
      // mtime 在 staleAgeMs 内：可能是正在写入的临时文件，跳过
      if (now - stat.mtimeMs < staleAgeMs) continue;
      // 超过 staleAgeMs 视为崩溃残留：主文件未被 rename 覆盖，删除 tmp 即可。
      // 尝试 JSON.parse 校验仅用于日志区分（storage:write 的 tmp 是 JSON；
      // projectFile:write 的 tmp 是 ZIP，JSON.parse 必然失败，按损坏处理）。
      // 无论校验成功或失败都删除：主文件仍是上次成功写入的完整版本，不恢复。
      let looksValid = false;
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        JSON.parse(content);
        looksValid = true;
      } catch {
        looksValid = false;
      }
      if (looksValid) {
        logger.warn('Crash recovery: removing stale tmp (valid JSON, main file intact)', { fullPath });
      } else {
        logger.warn('Crash recovery: removing stale tmp (corrupted)', { fullPath });
      }
      await fs.unlink(fullPath).catch(() => {});
    } catch (err) {
      logger.warn('Crash recovery: stat/unlink tmp failed', { fullPath, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// 同步清理所有白名单根目录下的 *.tmp 文件。
// withWriteMutex 的 finally 已 unlink 成功路径的 tmp，此处兜底异常路径残留
// （写入中途抛错未进入 finally / rename 失败 tmp 未删）。
// 不校验 mtime：退出时所有 pending writes 应已完成，残留 tmp 均为异常产物安全删除。
// 用同步 fsSync：异步 fs.unlink 在退出流程中可能未完成进程就已退出
function cleanupAllTmpSync(): void {
  // 仅清理应用自身写入的 tmp 目录：userData 根目录（storage:write 非 project_ 前缀 key）
  // 与 userData/projects（storage:write project_ 前缀 key 的 tmp）。
  // 不扫描 getAllowedProjectFileRoots() 返回的 home/Documents/Desktop/Downloads：
  //   1. 这些目录文件量大，同步 readdirSync 递归会阻塞事件循环数十秒甚至更久，
  //      5 秒 force-quit 定时器回调在此期间无法执行，应用冻结无响应
  //   2. 会删除其他程序（Word/浏览器/IDE）正在使用的 .tmp 文件，可能损坏其他程序
  //   3. .cwp 工程文件写入的 tmp 在 withWriteMutex 的 finally 中已清理（fs.unlink(tmp)），
  //      正常路径不残留；异常崩溃残留的极少数 tmp 不值得全盘扫描的代价
  const roots = [getDataDir(), getProjectsDir()];
  for (const root of roots) {
    try {
      cleanupTmpSync(root);
    } catch (e) {
      logger.warn('Quit cleanup: tmp failed', { root, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

// 同步递归删除 dir 下的 *.tmp 文件。
// 限定在 getAllowedProjectFileRoots() 返回的白名单根目录下递归，不会越界到系统目录
function cleanupTmpSync(dir: string, depth = 0): void {
  // 限制递归深度为 3 层：防止 userData/projects 下深层目录或恶意构造的
  // 嵌套结构导致同步递归长时间阻塞主进程事件循环
  if (depth > 3) return;
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在或无权限：跳过
  }
  // 单目录条目数上限：超出视为异常（可能被构造攻击或误入大目录），
  // 跳过该目录并记录告警，避免同步遍历大量条目阻塞退出流程
  if (entries.length > 10000) {
    logger.warn?.(`cleanupTmpSync: dir ${dir} has ${entries.length} entries, skipping`);
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanupTmpSync(fullPath, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.tmp')) {
      try { fsSync.unlinkSync(fullPath); }
      catch { /* 单个 tmp 删除失败不阻断其他 tmp 清理 */ }
    }
  }
}

// 注册崩溃恢复检查 IPC：供渲染层在启动时调用，检测上次写入是否崩溃并尝试恢复
function registerBackupHandlers(): void {
  safeIpcHandle('system:checkCrashRecovery', async () => {
    try {
      return await checkCrashRecovery();
    } catch (e) {
      logger.error('checkCrashRecovery error', e instanceof Error ? e : { error: String(e) });
      return { recovered: false, projects: [] };
    }
  });
}

export {
  startAutoBackup,
  stopAutoBackup,
  runAutoBackup,
  cleanupOldDatedBackups,
  checkCrashRecovery,
  cleanupStaleTmpFiles,
  scanTmpFilesRecursive,
  cleanupAllTmpSync,
  cleanupTmpSync,
  registerBackupHandlers,
};
