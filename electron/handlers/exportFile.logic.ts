// exportFile handler 的纯函数实现：扩展名提取/校验、编码归一化、base64 解码。
// 本模块不依赖 electron（dialog/fs/ipcMain），仅依赖 node 内置 path，
// 可被单元测试直接 import 而无需 vi.mock('electron')。
//
// 抽离目的：export:writeFile / export:writeFileBuffer handler 的扩展名校验 + 路径组装 +
// 编码归一化逻辑此前因 app.whenReady 永不 resolve 而无测试覆盖。
// 路径白名单（isSafeExportFilePath）与 realpath 校验（assertRealPathInside）保留在 handler 内，
// 因其依赖 ./security（顶层 import electron app）。
import path from 'node:path';

// 从文件路径提取小写扩展名（不含点号），与 exportFile.ts handler 内的使用方式一致。
// 例：'/path/file.txt' → 'txt'；'/path/file.PDF' → 'pdf'；'/path/file' → ''
export function getExportFileExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

// 校验扩展名是否在白名单内。
// 抽离自 exportFile.ts handler 间接调用的 isSafeExportFilePath 中的扩展名校验部分。
// allowedExtensions 为带点号的扩展名集合（如 '.txt'），
// 与 security.ts 的 EXPORT_ALLOWED_EXTENSIONS 形状一致。
// 返回 true 表示扩展名在白名单内。
export function isAllowedExportExtension(ext: string, allowedExtensions: Set<string>): boolean {
  if (!ext) return false;
  return allowedExtensions.has(`.${ext}`);
}

// 归一化 fs.writeFile 的 encoding 参数。
// 抽离自 export:writeFile handler 的 `{ encoding: (encoding as BufferEncoding) || 'utf-8' }`。
//
// 与原 handler 行为对齐：
// - undefined / 空字符串 / 非字符串 → 'utf-8'（falsy 值回退）
// - 合法字符串 → 原值透传（fs.writeFile 自行校验，非法值会抛错被 handler catch）
export function normalizeExportEncoding(encoding?: string): BufferEncoding {
  if (typeof encoding !== 'string' || !encoding) return 'utf-8';
  return encoding as BufferEncoding;
}

// 构造 fs.writeFile 的 options 对象，便于 handler 直接 spread。
// 与 export:writeFile handler 的 `{ encoding: normalizeExportEncoding(encoding) }` 一致。
export function buildExportWriteOptions(encoding?: string): { encoding: BufferEncoding } {
  return { encoding: normalizeExportEncoding(encoding) };
}

// 解码 base64 字符串为 Buffer。
// 抽离自 export:writeFileBuffer handler 的 `Buffer.from(base64Data, 'base64')`。
// 单独抽离便于单元测试验证解码正确性（合法 base64 → 正确字节；非法 base64 → 不抛错，
// Node Buffer.from 对非 base64 字符静默忽略，与 handler 行为一致）
export function decodeBase64ToBuffer(base64Data: string): Buffer {
  return Buffer.from(base64Data, 'base64');
}
