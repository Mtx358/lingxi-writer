// storage:listProjectDirs / backupProject —— 项目级目录操作。
// 拆分自原 storage.ts（按 IPC 域聚合），逻辑保持不变。
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../logger';
import {
  safeIpcHandle,
  getProjectsDir,
  getBackupsDir,
  ensureDir,
  pathExists,
  copyDir,
} from '../shared';
import { isSafeIdentifier } from '../security';

export function registerProjectStorageHandlers(): void {
  safeIpcHandle('storage:listProjectDirs', async () => {
    try {
      const dir = getProjectsDir();
      if (!(await pathExists(dir))) return [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
      logger.warn('storage:listProjectDirs failed', { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  });

  safeIpcHandle('storage:backupProject', async (_event, projectId: string, keepCount = 5) => {
    try {
      // 校验 projectId：防止渲染层被 XSS 后传入 '../../../etc' 等恶意路径，
      // 让 path.join 把 srcDir/backupRoot 拼接到 projects/backups 目录之外，
      // 导致 copyDir 把系统目录复制到任意位置或读取敏感目录
      if (!isSafeIdentifier(projectId)) {
        logger.audit('security.path', 'backupProject rejected: invalid projectId', { projectId });
        return false;
      }
      const srcDir = path.join(getProjectsDir(), projectId);
      if (!(await pathExists(srcDir))) return false;
      const backupRoot = path.join(getBackupsDir(), projectId);
      await ensureDir(backupRoot);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const destDir = path.join(backupRoot, ts);
      // 二次防御：srcDir/destDir 必须解析到各自根目录之内（防止极端边缘情况绕过）
      const projectsRoot = path.resolve(getProjectsDir());
      const backupsRoot = path.resolve(getBackupsDir());
      const resolvedSrc = path.resolve(srcDir);
      const resolvedDest = path.resolve(destDir);
      if (resolvedSrc !== projectsRoot && !resolvedSrc.startsWith(projectsRoot + path.sep)) {
        logger.audit('security.path', 'backupProject rejected: srcDir escapes projects dir', { srcDir });
        return false;
      }
      if (resolvedDest !== backupsRoot && !resolvedDest.startsWith(backupsRoot + path.sep)) {
        logger.audit('security.path', 'backupProject rejected: destDir escapes backups dir', { destDir });
        return false;
      }
      await copyDir(srcDir, destDir);
      const backups = (await fs.readdir(backupRoot)).sort().reverse();
      for (const old of backups.slice(keepCount)) {
        await fs.rm(path.join(backupRoot, old), { recursive: true, force: true });
      }
      return true;
    } catch (e) {
      logger.error('backup error', e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}
