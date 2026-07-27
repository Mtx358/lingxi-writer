import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';
import { toast } from '@/hooks/useToast';
import { decodeDeltasToVersions } from '@/utils/versionDelta';
import type { VersionDeltaPayload } from '@/utils/versionDelta';
import { storage } from './index';

/**
 * 项目级存储操作：迁移、检查、localStorage → .cwp 文件迁移。
 *
 * 这些函数依赖 storage 单例（运行时由 index.ts 根据环境选择 Electron/Local 后端）。
 * 通过 `import { storage } from './index'` 引入，ES 模块 live binding 保证函数
 * 被调用时 storage 已完成初始化（index.ts 顶层 const 先于函数调用执行）。
 */

const MIGRATION_VERSION = '2.0.0';

export const runMigration = async (): Promise<boolean> => {
  const currentVersion = await storage.get<string>('app_migration_version', '');
  if (!currentVersion || currentVersion !== MIGRATION_VERSION) {
    // 迁移日志用 console.info 而非 console.log，与"运行时事件"语义一致，
    // 也避免被生产构建的日志过滤器误删
    console.info('Running migration from version', currentVersion, 'to', MIGRATION_VERSION);
    await storage.set('app_migration_version', MIGRATION_VERSION);
    return true;
  }
  return false;
};

export const checkLocalStorageData = async (): Promise<boolean> => {
  const projects = await storage.get<Project[]>('projects', []);
  return projects.length > 0;
};

export const migrateLocalStorageToProjectFile = async (): Promise<string | null> => {
  const projects = await storage.get<Project[]>('projects', []);
  if (projects.length === 0) return null;

  const project = projects[0];
  const chapters = await storage.get<Chapter[]>(`project_${project.id}_chapters`, []);
  const characters = await storage.get<Character[]>(`project_${project.id}_characters`, []);
  const settingCategories = await storage.get<SettingCategory[]>(`project_${project.id}_settingCategories`, []);
  const settingItems = await storage.get<SettingItem[]>(`project_${project.id}_settingItems`, []);
  const foreshadows = await storage.get<Foreshadow[]>(`project_${project.id}_foreshadows`, []);
  const materials = await storage.get<Material[]>(`project_${project.id}_materials`, []);
  const versions = await storage.get<Record<string, ChapterVersion[]>>(`project_${project.id}_versions`, {});
  // localStorage 中的版本以增量 Diff 形式持久化，写入 .cwp 前需解码为完整 ChapterVersion[]
  const decodedVersions: Record<string, ChapterVersion[]> = {};
  // 收集 delta 解码失败的 cid，循环外统一 toast 避免风暴
  const failedDeltaChapterIds: string[] = [];
  for (const [cid, vlist] of Object.entries(versions)) {
    try {
      decodedVersions[cid] = decodeDeltasToVersions(vlist as VersionDeltaPayload[]);
    } catch (e) {
      // 单个 chapter 的 delta 损坏不应让整个迁移失败：回退为空数组，保留其他 chapter 的版本
      console.warn(`migrateLocalStorageToProjectFile: decode deltas failed for chapter ${cid}, falling back to empty list:`, e);
      failedDeltaChapterIds.push(cid);
      decodedVersions[cid] = Array.isArray(vlist) ? vlist : [];
    }
  }
  // 循环外统一提示：多个章节 delta 损坏时只弹一次 toast，避免风暴
  if (failedDeltaChapterIds.length > 0) {
    toast.warning('章节历史版本加载失败', `部分章节历史版本已损坏并回退为空，受影响章节：${failedDeltaChapterIds.join('、')}`);
  }

  const defaultName = `${project.title.replace(/[\\/:*?"<>|]/g, '_')}.cwp`;
  const filePath = await storage.saveFileDialog(defaultName);

  if (filePath) {
    const success = await storage.writeProjectFile(
      filePath,
      project,
      chapters,
      characters,
      settingCategories,
      settingItems,
      foreshadows,
      materials,
      decodedVersions
    );
    if (success) {
      // 迁移成功后清理 localStorage 旧键；单个键清理失败不应让整个迁移报错
      // （文件已写入，残留的 localStorage 键只是冗余数据，下次启动会再次尝试清理）
      await Promise.allSettled([
        storage.remove(`project_${project.id}_chapters`),
        storage.remove(`project_${project.id}_characters`),
        storage.remove(`project_${project.id}_settingCategories`),
        storage.remove(`project_${project.id}_settingItems`),
        storage.remove(`project_${project.id}_foreshadows`),
        storage.remove(`project_${project.id}_materials`),
        storage.remove(`project_${project.id}_versions`),
      ]);
      return filePath;
    }
  }
  return null;
};
