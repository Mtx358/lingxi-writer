// storage handler 子模块共享的内部工具：
// 路径解析、最近选择文件白名单、外部后缀白/黑名单、MIME 映射。
// 仅被 ./ 目录下的兄弟模块（globalStorage / fileExternal / ...）引用，
// 不直接对外暴露——外部消费者应从 ../storage barrel 导入。
import path from 'node:path';
import {
  getDataDir,
  getProjectsDir,
} from '../shared';

// 允许的项目数据子键（project_{id}_{subkey} 格式中的 subkey 部分）
export const ALLOWED_PROJECT_SUBKEYS = new Set([
  'chapters',
  'characters',
  'settingCategories',
  'settingItems',
  'foreshadows',
  'materials',
  'versions',
]);

export function resolveFilePath(key: string): string {
  // 安全校验：禁止路径穿越字符
  if (!key || typeof key !== 'string' || key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  if (key.startsWith('project_')) {
    const rest = key.slice('project_'.length);
    const underscoreIdx = rest.indexOf('_');
    if (underscoreIdx === -1) {
      // project_{id} 格式：指向项目主文件
      const resolved = path.join(getProjectsDir(), rest, 'main.json');
      if (!resolved.startsWith(getProjectsDir())) throw new Error('Path traversal detected');
      return resolved;
    }
    const projectId = rest.slice(0, underscoreIdx);
    const subkey = rest.slice(underscoreIdx + 1);
    // subkey 必须在白名单中
    if (!ALLOWED_PROJECT_SUBKEYS.has(subkey)) {
      throw new Error(`Invalid project subkey: ${subkey}`);
    }
    if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
      throw new Error('Invalid projectId');
    }
    const resolved = path.join(getProjectsDir(), projectId, `${subkey}.json`);
    if (!resolved.startsWith(getProjectsDir())) throw new Error('Path traversal detected');
    return resolved;
  }
  const resolved = path.join(getDataDir(), `${key}.json`);
  if (!resolved.startsWith(getDataDir())) throw new Error('Path traversal detected');
  return resolved;
}

export function resolveDirPath(key: string): string {
  if (!key || typeof key !== 'string' || key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  if (key.startsWith('project_')) {
    const rest = key.slice('project_'.length);
    const underscoreIdx = rest.indexOf('_');
    const projectId = underscoreIdx === -1 ? rest : rest.slice(0, underscoreIdx);
    // 必须有非空 projectId，否则 path.join(projectsDir, '') === projectsDir，
    // rm -rf 会递归删除整个 projects 目录造成灾难性数据丢失
    if (!projectId) throw new Error('Invalid projectId: empty');
    if (projectId.includes('..')) throw new Error('Invalid projectId');
    const resolved = path.join(getProjectsDir(), projectId);
    if (!resolved.startsWith(getProjectsDir())) throw new Error('Path traversal detected');
    return resolved;
  }
  return getDataDir();
}

// file:openExternal 后缀白名单（仅允许常见安全文档/媒体类型）
export const ALLOWED_OPEN_EXTERNAL_EXTS = new Set([
  'txt', 'md', 'markdown', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
]);
// 危险可执行后缀黑名单（双重防御）
export const FORBIDDEN_OPEN_EXTERNAL_EXTS = new Set([
  'exe', 'bat', 'sh', 'app', 'cmd', 'ps1', 'com', 'scr', 'vbs', 'js', 'mjs', 'jar',
]);

// material:saveAttachment 的源路径白名单：
// 渲染层被 XSS 后可调用此接口把系统敏感文件复制到 materials 目录再外传，
// 这里要求 sourcePath 必须是用户最近 N 秒内通过 dialog:selectFile 主动选择的文件。
export const RECENT_SELECTED_FILES_TTL_MS = 5 * 60 * 1000;
const recentSelectedFiles = new Map<string, number>();

export function rememberSelectedFile(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') return;
  const abs = path.resolve(filePath);
  recentSelectedFiles.set(abs, Date.now());
  // 顺手清理过期项
  const now = Date.now();
  for (const [p, ts] of recentSelectedFiles) {
    if (now - ts > RECENT_SELECTED_FILES_TTL_MS) recentSelectedFiles.delete(p);
  }
}

export function isRecentlySelectedFile(filePath: unknown): boolean {
  if (typeof filePath !== 'string' || !filePath) return false;
  const abs = path.resolve(filePath);
  const ts = recentSelectedFiles.get(abs);
  if (!ts) return false;
  if (Date.now() - ts > RECENT_SELECTED_FILES_TTL_MS) {
    recentSelectedFiles.delete(abs);
    return false;
  }
  return true;
}

// 返回当前 recentSelectedFiles 中未过期项的绝对路径数组。
// 供 file:openExternal 的 realpath 校验使用：lexical isRecentlySelectedFile 通过后，
// 还需 realpath 校验 filePath 不被 symlink 引到 allowedRoots 之外
export function getRecentlySelectedFilesRealPaths(): string[] {
  const now = Date.now();
  const result: string[] = [];
  for (const [p, ts] of recentSelectedFiles) {
    if (now - ts <= RECENT_SELECTED_FILES_TTL_MS) result.push(p);
  }
  return result;
}

// file:readDataURL 用到的后缀→MIME 映射
export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};
