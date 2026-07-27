// material:saveAttachment / material:deleteAttachment —— 素材附件持久化与删除。
// 拆分自原 storage.ts（按 IPC 域聚合），逻辑保持不变。
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../logger';
import {
  safeIpcHandle,
  getDataDir,
} from '../shared';
import { isSafeIdentifier } from '../security';
import { isRecentlySelectedFile } from './internal';

export function registerMaterialAttachmentHandlers(): void {
  // 素材附件持久化：将用户选择的源文件复制到项目数据目录下的 materials/<projectId>/，
  // 避免用户移动/删除原文件导致附件失效；同时杜绝 base64 内嵌 JSON 的体积与注入风险。
  // 返回复制后的绝对路径，供 MaterialAttachment.path 存储。
  safeIpcHandle('material:saveAttachment', async (_event, sourcePath: string, projectId: string, attachmentId: string) => {
    if (!sourcePath || !projectId || !attachmentId) return null;
    // 校验 projectId / attachmentId：防止渲染层被 XSS 后传入 '../../../etc' 等恶意路径，
    // 让 path.join 把 destPath 拼接到 materials 目录之外（如 userData/materials/../../etc/passwd）
    if (!isSafeIdentifier(projectId) || !isSafeIdentifier(attachmentId)) {
      logger.audit('security.path', 'saveAttachment rejected: invalid projectId or attachmentId', { projectId, attachmentId });
      return null;
    }
    // 安全：sourcePath 必须是用户最近通过 dialog:selectFile 主动选择的文件，
    // 防止渲染层被 XSS 后传入 ~/.ssh/id_rsa、/etc/passwd 等系统敏感文件被复制外泄
    if (!isRecentlySelectedFile(sourcePath)) {
      logger.audit('security.path', 'saveAttachment rejected: sourcePath not in recent selection whitelist', { sourcePath });
      return null;
    }
    try {
      const materialsDir = path.join(getDataDir(), 'materials', projectId);
      await fs.mkdir(materialsDir, { recursive: true });
      const ext = path.extname(sourcePath);
      const destPath = path.join(materialsDir, `${attachmentId}${ext}`);
      // 二次防御：destPath 必须解析到 materialsDir 之内（isSafeIdentifier 已防 .. / / \，
      // 此处额外用前缀匹配兜底，覆盖未来代码改动引入的回归）
      const resolvedDest = path.resolve(destPath);
      const resolvedMaterialsDir = path.resolve(materialsDir);
      if (resolvedDest !== resolvedMaterialsDir && !resolvedDest.startsWith(resolvedMaterialsDir + path.sep)) {
        logger.audit('security.path', 'saveAttachment rejected: destPath escapes materials dir', { destPath });
        return null;
      }
      // L-NEW-5 修复：realpath 校验 sourcePath，防止用户通过 dialog 选择了指向敏感文件
      // 的 symlink（如 evil.pdf -> ~/.ssh/id_rsa），copyFile 会跟随 symlink 复制敏感内容。
      const realSource = await fs.realpath(sourcePath).catch(() => null);
      if (!realSource) {
        logger.audit('security.path', 'saveAttachment rejected: sourcePath realpath failed', { sourcePath });
        return null;
      }
      if (!isRecentlySelectedFile(realSource)) {
        logger.audit('security.path', 'saveAttachment rejected: realpath of source not in recent selection', { sourcePath, realSource });
        return null;
      }
      await fs.copyFile(realSource, destPath);
      return destPath;
    } catch (e) {
      logger.error('保存素材附件失败', e instanceof Error ? e : { error: String(e) });
      return null;
    }
  });

  // 素材附件删除：用户移除附件记录时，同步删除磁盘副本释放空间。
  // 安全：targetPath 必须解析到 userData/materials/ 子目录内，防止渲染层被 XSS 后
  // 传入任意路径删除系统文件（如 ~/.ssh/、/etc/）。路径校验用 realpath 解析符号链接。
  safeIpcHandle('material:deleteAttachment', async (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return false;
    try {
      const materialsRoot = path.join(getDataDir(), 'materials');
      const resolved = await fs.realpath(targetPath).catch(() => null);
      if (!resolved) return false; // 文件已不存在视为删除成功无意义，返回 false 让调用方静默忽略
      const resolvedRoot = await fs.realpath(materialsRoot).catch(() => materialsRoot);
      const rel = path.relative(resolvedRoot, resolved);
      // relative 返回不以 '..' 开头且非绝对路径，才说明 resolved 在 materialsRoot 之内
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        logger.audit('security.path', 'deleteAttachment rejected: targetPath escapes materials dir', { targetPath });
        return false;
      }
      await fs.unlink(resolved);
      return true;
    } catch (e) {
      logger.error('删除素材附件失败', e instanceof Error ? e : { error: String(e) });
      return false;
    }
  });
}
