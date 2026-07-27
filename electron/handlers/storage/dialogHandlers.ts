// dialog:selectFile / dialog:saveFile —— 系统 OpenFileDialog / SaveFileDialog。
// 拆分自原 storage.ts（按 IPC 域聚合），逻辑保持不变。
import path from 'node:path';
import fs from 'node:fs/promises';
import { dialog } from 'electron';
import { logger } from '../../logger';
import {
  safeIpcHandle,
  getMainWindow,
} from '../shared';
import { EXPORT_ALLOWED_EXTENSIONS } from '../security';
import { rememberSelectedFile } from './internal';

export function registerDialogHandlers(): void {
  safeIpcHandle('dialog:selectFile', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: '选择附件文件',
      // filters：与 ALLOWED_OPEN_EXTERNAL_EXTS 保持一致，限制用户可选文件类型。
      // 原先无 filters，用户可选 .exe/.sh 等任意文件，被 material:saveAttachment 原样
      // 复制到 userData/materials/<projectId>/ 落盘，构成钓鱼攻击面。
      filters: [
        { name: '常用文档与媒体', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    // 记入最近选择白名单，供 material:saveAttachment 校验源路径
    rememberSelectedFile(filePath);
    try {
      // 用 fs.stat 获取文件大小：原先 fs.readFile 把整个文件读入内存仅为取 .length，
      // 用户选择大附件（如 100MB 视频）时会无谓占用内存且增加响应延迟
      const stat = await fs.stat(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        ext: path.extname(filePath).slice(1).toLowerCase(),
      };
    } catch {
      return null;
    }
  });

  safeIpcHandle('dialog:saveFile', async (_event, defaultName: string, _data: string, filterExt: string) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    // M-NEW-3 修复：filterExt 必须在导出白名单内，防止渲染层被 XSS 后传入 'exe'/'sh'
    // 误导用户选择可执行文件路径。defaultName 用 basename 剥离目录部分防路径穿越。
    const safeExt = typeof filterExt === 'string' ? filterExt.toLowerCase().replace(/^\./, '') : '';
    if (!EXPORT_ALLOWED_EXTENSIONS.has(`.${safeExt}`)) {
      logger.audit('security.path', 'dialog:saveFile rejected: filterExt not in whitelist', { filterExt });
      return null;
    }
    const safeName = typeof defaultName === 'string' ? path.basename(defaultName) : 'export';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存导出文件',
      defaultPath: safeName,
      filters: [{ name: safeExt.toUpperCase(), extensions: [safeExt] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
}
