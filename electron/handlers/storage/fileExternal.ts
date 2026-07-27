// file:openExternal / file:readDataURL —— 外部文件打开与 data URL 读取。
// 拆分自原 storage.ts（按 IPC 域聚合），逻辑保持不变。
import path from 'node:path';
import fs from 'node:fs/promises';
import { shell } from 'electron';
import { logger } from '../../logger';
import {
  safeIpcHandle,
  getDataDir,
} from '../shared';
import {
  isInsideDataDir,
  assertRealPathInside,
} from '../security';
import {
  ALLOWED_OPEN_EXTERNAL_EXTS,
  FORBIDDEN_OPEN_EXTERNAL_EXTS,
  isRecentlySelectedFile,
  getRecentlySelectedFilesRealPaths,
  MIME_BY_EXT,
} from './internal';

export function registerFileExternalHandlers(): void {
  safeIpcHandle('file:openExternal', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') return false;
    // 路径校验：必须是绝对路径，且位于 userData 目录内或为用户最近通过 dialog 选择的文件。
    // 原先仅校验后缀，攻击者（XSS 后）可传 'relative/evil.pdf'，shell.openPath 会相对 cwd 解析，
    // 虽受后缀白名单限制只能开 pdf/txt 等，但若用户系统 PDF 阅读器存在 RCE 漏洞仍可被利用
    if (!path.isAbsolute(filePath)) {
      logger.audit('security.path', 'openExternal rejected: path must be absolute', { filePath });
      return false;
    }
    if (!isInsideDataDir(filePath) && !isRecentlySelectedFile(filePath)) {
      logger.audit('security.path', 'openExternal rejected: outside data dir and not recently selected', { filePath });
      return false;
    }
    // realpath 校验：防止 symlink 绕过 lexical 检查打开 userData 目录外的文件
    // （shell.openPath 会调用系统默认程序，若被引到敏感文件可能造成数据泄露）
    if (!(await assertRealPathInside(filePath, [getDataDir(), ...getRecentlySelectedFilesRealPaths()]))) {
      logger.audit('security.path', 'openExternal rejected: realpath outside allowed dirs (symlink?)', { filePath });
      return false;
    }
    // 后缀双重防御：先禁止可执行后缀，再要求在白名单中
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (FORBIDDEN_OPEN_EXTERNAL_EXTS.has(ext)) {
      logger.audit('security.path', 'openExternal rejected: forbidden extension', { ext, filePath });
      return false;
    }
    if (!ext || !ALLOWED_OPEN_EXTERNAL_EXTS.has(ext)) {
      logger.audit('security.path', 'openExternal rejected: extension not in allowlist', { ext, filePath });
      return false;
    }
    try {
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // 读取素材附件为 data URL，供 <img src> 直接渲染。
  // 开发环境（http/https）无法加载 file:// 资源，需通过 bridge 读取为 data URL。
  // 安全：路径必须位于 userData 目录内（素材附件持久化在 materials/<projectId>/），
  // 防止渲染层被 XSS 后读取系统敏感文件（如 ~/.ssh/id_rsa）。
  safeIpcHandle('file:readDataURL', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.reject(new Error('invalid filePath'));
    }
    if (!isInsideDataDir(filePath)) {
      logger.audit('security.path', 'readDataURL rejected: path outside data dir', { filePath });
      return Promise.reject(new Error('path outside data dir'));
    }
    try {
      // realpath 校验：防止 symlink 绕过 lexical 检查读取 userData 目录外的文件
      if (!(await assertRealPathInside(filePath, [getDataDir()]))) {
        logger.audit('security.path', 'readDataURL rejected: realpath outside data dir (symlink?)', { filePath });
        return Promise.reject(new Error('realpath outside data dir'));
      }
      const resolved = path.resolve(filePath);
      // 体积校验：base64 编码后体积膨胀约 4/3，过大文件经 IPC 传输会撑爆消息通道
      // 10MB 上限足够任何合理的应用内图片资源；超出返回 null 让渲染层走降级路径
      const stat = await fs.stat(resolved);
      if (stat.size > 10 * 1024 * 1024) {
        logger.audit('security.size', 'readDataURL rejected: file too large', { size: stat.size });
        return null;
      }
      const buffer = await fs.readFile(resolved);
      const ext = path.extname(resolved).slice(1).toLowerCase();
      const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (e) {
      logger.error('readDataURL 失败', e instanceof Error ? e : { error: String(e) });
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
