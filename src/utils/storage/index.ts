/**
 * storage 模块 barrel 入口。
 *
 * 保持 `@/utils/storage` 导入路径向后兼容：原 storage.ts 的所有导出
 * （storage 单例 + 工具函数 + 自动保存 API + 项目迁移函数）均从此处 re-export。
 *
 * 拆分结构：
 *   - helpers.ts           纯工具函数 + StorageAPI 接口
 *   - localStorageAdapter.ts  web 环境后端
 *   - electronBridge.ts    Electron IPC 桥接后端
 *   - autoSave.ts          自动保存调度
 *   - projectsStore.ts     项目级迁移/检查（依赖 storage 单例，循环引用通过 live binding 解析）
 *   - index.ts             创建 storage 单例 + barrel re-export
 */
import { isElectron, type StorageAPI } from './helpers';
import { LocalStorage } from './localStorageAdapter';
import { ElectronStorage } from './electronBridge';

// 根据运行环境选择后端：Electron 优先，web 回退到 localStorage
export const storage: StorageAPI = isElectron() ? new ElectronStorage() : new LocalStorage();

// 工具函数
export { generateId, formatDate, countWords, isElectron } from './helpers';
// 类型
export type { StorageAPI } from './helpers';
// 自动保存 API
export {
  setAutoSaveCallback,
  markDirty,
  triggerSave,
  clearAutoSaveTimer,
  getDirtyState,
} from './autoSave';
// 项目级存储操作
export {
  runMigration,
  checkLocalStorageData,
  migrateLocalStorageToProjectFile,
} from './projectsStore';
