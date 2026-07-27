// storage:readFileBase64 / writeFile / writeFileBuffer —— 文件读写操作。
// 拆分自原 storage.ts（按 IPC 域聚合），逻辑保持不变。
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../logger';
import {
  safeIpcHandle,
  getDataDir,
} from '../shared';
import {
  isInsideDataDir,
  assertRealPathInside,
} from '../security';

export function registerFileStorageHandlers(): void {
  safeIpcHandle('storage:readFileBase64', async (_event, filePath: string) => {
    try {
      // M-NEW-1 修复：限定到 materials 子目录，防止渲染层被 XSS 后读取
      // userData 下其他敏感文件（aiSettings.json/projects.json/recovery_draft.json/logs）。
      // 与 file:readDataURL 用途对齐：仅附件素材需要 base64 读取。
      const materialsRoot = path.join(getDataDir(), 'materials');
      const resolved = path.resolve(filePath);
      if (resolved !== materialsRoot && !resolved.startsWith(materialsRoot + path.sep)) {
        logger.audit('security.path', 'readFileBase64 rejected: path outside materials dir', { filePath });
        return null;
      }
      // realpath 校验：防止 symlink 绕过 lexical 检查读取目录外的文件
      if (!(await assertRealPathInside(filePath, [materialsRoot]))) {
        logger.audit('security.path', 'readFileBase64 rejected: realpath outside materials dir (symlink?)', { filePath });
        return null;
      }
      const buffer = await fs.readFile(resolved);
      return buffer.toString('base64');
    } catch {
      return null;
    }
  });

  safeIpcHandle('storage:writeFile', async (_event, filePath: string, data: string, encoding?: string) => {
    try {
      if (!isInsideDataDir(filePath)) {
        logger.audit('security.path', 'writeFile rejected: path outside data dir', { filePath });
        return false;
      }
      // realpath 校验：防止 symlink 绕过 lexical 检查写入 userData 目录外的文件
      if (!(await assertRealPathInside(filePath, [getDataDir()]))) {
        logger.audit('security.path', 'writeFile rejected: realpath outside data dir (symlink?)', { filePath });
        return false;
      }
      const resolved = path.resolve(filePath);
      await fs.writeFile(resolved, data, { encoding: (encoding as BufferEncoding) || 'utf-8' });
      return true;
    } catch (e) {
      logger.error('writeFile error', e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });

  safeIpcHandle('storage:writeFileBuffer', async (_event, filePath: string, base64Data: string) => {
    try {
      if (!isInsideDataDir(filePath)) {
        logger.audit('security.path', 'writeFileBuffer rejected: path outside data dir', { filePath });
        return false;
      }
      // realpath 校验：防止 symlink 绕过 lexical 检查写入 userData 目录外的文件
      if (!(await assertRealPathInside(filePath, [getDataDir()]))) {
        logger.audit('security.path', 'writeFileBuffer rejected: realpath outside data dir (symlink?)', { filePath });
        return false;
      }
      const resolved = path.resolve(filePath);
      await fs.writeFile(resolved, Buffer.from(base64Data, 'base64'));
      return true;
    } catch (e) {
      logger.error('writeFileBuffer error', e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}
