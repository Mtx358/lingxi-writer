// 存储 IPC handler barrel：
// 业务实现按 IPC 域拆分到 ./storage/ 子目录，本文件仅做 re-export，
// 保持外部导入路径 './storage'（main.ts / aiProxy.ts / storage.handler.test.ts）不变。
// 拆分动机：原 648 行单文件过大，按域聚合后各子文件 < 200 行，便于阅读与测试定位。
export {
  registerStorageHandlers,
  resolveFilePath,
  resolveDirPath,
  ALLOWED_PROJECT_SUBKEYS,
  ALLOWED_OPEN_EXTERNAL_EXTS,
  FORBIDDEN_OPEN_EXTERNAL_EXTS,
  RECENT_SELECTED_FILES_TTL_MS,
  rememberSelectedFile,
  isRecentlySelectedFile,
  getRecentlySelectedFilesRealPaths,
} from './storage/index';
