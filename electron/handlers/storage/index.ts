// storage handler 子模块聚合 barrel：
// 各子 handler 注册函数聚合为单一 registerStorageHandlers，保持 main.ts 调用不变。
// 同时 re-export ./internal 中的公共工具符号，让外部消费者从 '../storage' 导入路径不变。
import { registerGlobalStorageHandlers } from './globalStorage';
import { registerProjectStorageHandlers } from './projectStorage';
import { registerFileStorageHandlers } from './fileStorage';
import { registerDialogHandlers } from './dialogHandlers';
import { registerFileExternalHandlers } from './fileExternal';
import { registerMaterialAttachmentHandlers } from './materialAttachments';

// 聚合注册：调用方只需调用一次 registerStorageHandlers 即可注册全部 16 个 IPC channel。
// 顺序无依赖（各 channel 互不引用），按 IPC 域分组列出便于阅读。
export function registerStorageHandlers(): void {
  registerGlobalStorageHandlers();
  registerProjectStorageHandlers();
  registerFileStorageHandlers();
  registerDialogHandlers();
  registerFileExternalHandlers();
  registerMaterialAttachmentHandlers();
}

// re-export 公共符号：保持外部导入路径 '../storage' 不变
// （aiProxy.ts 导入 resolveFilePath；storage.handler.test.ts 导入 rememberSelectedFile）
export {
  resolveFilePath,
  resolveDirPath,
  ALLOWED_PROJECT_SUBKEYS,
  ALLOWED_OPEN_EXTERNAL_EXTS,
  FORBIDDEN_OPEN_EXTERNAL_EXTS,
  RECENT_SELECTED_FILES_TTL_MS,
  rememberSelectedFile,
  isRecentlySelectedFile,
  getRecentlySelectedFilesRealPaths,
} from './internal';
