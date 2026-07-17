import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';
import { AUTOSAVE_INTERVAL } from '@/constants/config';
import { toast } from '@/hooks/useToast';

// 判断是否为 localStorage 配额超限错误（不同浏览器抛出 DOMException 或 QuotaExceededError）
const isQuotaError = (e: unknown): boolean => {
  if (e instanceof DOMException) {
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22;
  }
  return e instanceof Error && /quota/i.test(e.name);
};

export const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export const formatDate = (date: string): string => {
  const d = new Date(date);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const countWords = (html: string): number => {
  // 去除 HTML 标签与空白；按中英文混合场景统一统计：
  // - 中日韩字符（含全角标点）每个字符计 1 字
  // - 英文/数字按单词计（连续字母数字序列视为一个单词）
  // 与常规写作字数统计习惯一致，避免英文被拆成单字母导致字数虚高。
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  let count = 0;
  // CJK 统一表意文字、扩展 A 区、日文假名、全角标点等
  const cjkRe = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFFEF]/g;
  const cjkMatches = text.match(cjkRe);
  if (cjkMatches) count += cjkMatches.length;
  // 去掉 CJK 后剩余部分按拉丁字母/数字单词计数
  const nonCjk = text.replace(cjkRe, '');
  const wordMatches = nonCjk.match(/[A-Za-z0-9]+/g);
  if (wordMatches) count += wordMatches.length;
  return count;
};

export const isElectron = (): boolean => {
  return window.electronAPI !== undefined;
};

interface StorageAPI {
  get: <T>(key: string, defaultValue: T) => Promise<T>;
  set: <T>(key: string, value: T) => Promise<void>;
  remove: (key: string) => Promise<void>;
  
  readProjectFile: (filePath: string) => Promise<{
    project: Project;
    chapters: Chapter[];
    characters: Character[];
    settingCategories: SettingCategory[];
    settingItems: SettingItem[];
    foreshadows: Foreshadow[];
    materials: Material[];
    versions: Record<string, ChapterVersion[]>;
  } | null>;
  
  writeProjectFile: (
    filePath: string,
    project: Project,
    chapters: Chapter[],
    characters: Character[],
    settingCategories: SettingCategory[],
    settingItems: SettingItem[],
    foreshadows: Foreshadow[],
    materials: Material[],
    versions: Record<string, ChapterVersion[]>
  ) => Promise<boolean>;
  
  backupProjectFile: (filePath: string, keepCount?: number) => Promise<boolean>;
  listBackups: (filePath: string) => Promise<{ name: string; path: string; timestamp: string }[]>;
  restoreBackup: (backupPath: string, targetPath: string) => Promise<boolean>;
  
  openFileDialog: () => Promise<string | null>;
  saveFileDialog: (defaultName: string) => Promise<string | null>;
  
  checkForRecovery: () => Promise<string | null>;
  saveRecoveryDraft: (projectId: string, chapterId: string, content: string) => Promise<void>;
  loadRecoveryDraft: () => Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null>;
  clearRecoveryDraft: () => Promise<void>;
  
  encrypt: (plainText: string) => Promise<string | null>;
  decrypt: (encryptedBase64: string) => Promise<string | null>;
}

class ElectronStorage implements StorageAPI {
  async get<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const result = await window.electronAPI!.storage.read(key);
      return result !== null && result !== undefined ? (result as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await window.electronAPI!.storage.write(key, value);
    } catch (e) {
      console.error('Failed to set storage:', key, e);
      toast.error('数据写入失败', `键 "${key}" 持久化失败：${e instanceof Error ? e.message : String(e)}。请检查磁盘空间或文件权限。`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await window.electronAPI!.storage.remove(key);
    } catch (e) {
      console.error('Failed to remove storage:', key, e);
    }
  }

  async readProjectFile(filePath: string): Promise<{
    project: Project;
    chapters: Chapter[];
    characters: Character[];
    settingCategories: SettingCategory[];
    settingItems: SettingItem[];
    foreshadows: Foreshadow[];
    materials: Material[];
    versions: Record<string, ChapterVersion[]>;
  } | null> {
    try {
      const result = await window.electronAPI!.projectFile.read(filePath);
      if (result && result.success && result.data) {
        return result.data as {
          project: Project;
          chapters: Chapter[];
          characters: Character[];
          settingCategories: SettingCategory[];
          settingItems: SettingItem[];
          foreshadows: Foreshadow[];
          materials: Material[];
          versions: Record<string, ChapterVersion[]>;
        };
      }
      return null;
    } catch (e) {
      console.error('Failed to read project file:', filePath, e);
      return null;
    }
  }

  async writeProjectFile(
    filePath: string,
    project: Project,
    chapters: Chapter[],
    characters: Character[],
    settingCategories: SettingCategory[],
    settingItems: SettingItem[],
    foreshadows: Foreshadow[],
    materials: Material[],
    versions: Record<string, ChapterVersion[]>
  ): Promise<boolean> {
    try {
      const result = await window.electronAPI!.projectFile.write(filePath, {
        project,
        chapters,
        characters,
        settingCategories,
        settingItems,
        foreshadows,
        materials,
        versions,
      });
      const ok = !!(result && result.success);
      if (!ok) {
        toast.error('项目文件保存失败', `写入 "${filePath}" 失败。请检查目标路径是否可写、磁盘空间是否充足。`);
      }
      return ok;
    } catch (e) {
      console.error('Failed to write project file:', filePath, e);
      toast.error('项目文件保存失败', `写入 "${filePath}" 时发生异常：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async backupProjectFile(filePath: string, keepCount = 5): Promise<boolean> {
    try {
      const result = await window.electronAPI!.projectFile.backup(filePath, keepCount);
      const ok = !!(result && result.success);
      if (!ok) {
        toast.warning('自动备份失败', '项目文件已保存，但备份未成功生成。下次保存时会再次尝试。');
      }
      return ok;
    } catch (e) {
      console.error('Failed to backup project file:', filePath, e);
      toast.warning('自动备份失败', `备份 "${filePath}" 时发生异常：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async listBackups(filePath: string): Promise<{ name: string; path: string; timestamp: string }[]> {
    try {
      const result = await window.electronAPI!.projectFile.listBackups(filePath);
      return result && result.success && result.backups ? result.backups : [];
    } catch (e) {
      console.error('Failed to list backups:', filePath, e);
      return [];
    }
  }

  async restoreBackup(backupPath: string, targetPath: string): Promise<boolean> {
    try {
      const result = await window.electronAPI!.projectFile.restoreBackup(backupPath, targetPath);
      return result && result.success;
    } catch (e) {
      console.error('Failed to restore backup:', backupPath, e);
      return false;
    }
  }

  async openFileDialog(): Promise<string | null> {
    try {
      const result = await window.electronAPI!.projectFile.openDialog();
      return result || null;
    } catch (e) {
      console.error('Failed to open file dialog:', e);
      return null;
    }
  }

  async saveFileDialog(defaultName: string): Promise<string | null> {
    try {
      const result = await window.electronAPI!.projectFile.saveDialog(defaultName);
      return result || null;
    } catch (e) {
      console.error('Failed to save file dialog:', e);
      return null;
    }
  }

  async checkForRecovery(): Promise<string | null> {
    try {
      const result = await window.electronAPI!.storage.read('recovery_draft');
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }

  async saveRecoveryDraft(projectId: string, chapterId: string, content: string): Promise<void> {
    await this.set('recovery_draft', {
      projectId,
      chapterId,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  async loadRecoveryDraft(): Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null> {
    try {
      const result = await window.electronAPI!.storage.read('recovery_draft');
      if (result && typeof result === 'object' && 'projectId' in result && 'chapterId' in result && 'content' in result && 'timestamp' in result) {
        return result as { projectId: string; chapterId: string; content: string; timestamp: string };
      }
      return null;
    } catch {
      return null;
    }
  }

  async clearRecoveryDraft(): Promise<void> {
    await this.remove('recovery_draft');
  }

  async encrypt(plainText: string): Promise<string | null> {
    try {
      return await window.electronAPI!.storage.encrypt(plainText);
    } catch (e) {
      console.error('Failed to encrypt:', e);
      return null;
    }
  }

  async decrypt(encryptedBase64: string): Promise<string | null> {
    try {
      return await window.electronAPI!.storage.decrypt(encryptedBase64);
    } catch (e) {
      console.error('Failed to decrypt:', e);
      return null;
    }
  }
}

class LocalStorage implements StorageAPI {
  async get<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Failed to set localStorage:', key, e);
      if (isQuotaError(e)) {
        // localStorage 配额超限：浏览器存储已满，必须告知用户，否则会导致静默丢数据
        toast.error(
          '浏览器存储已满',
          '无法继续保存：localStorage 配额超限。请导出项目后清理浏览器数据，或使用桌面版以文件形式保存。',
        );
      } else {
        toast.error('数据写入失败', `键 "${key}" 持久化失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readProjectFile(_filePath: string): Promise<{
    project: Project;
    chapters: Chapter[];
    characters: Character[];
    settingCategories: SettingCategory[];
    settingItems: SettingItem[];
    foreshadows: Foreshadow[];
    materials: Material[];
    versions: Record<string, ChapterVersion[]>;
  } | null> {
    return null;
  }

  async writeProjectFile(
    _filePath: string,
    project: Project,
    chapters: Chapter[],
    characters: Character[],
    settingCategories: SettingCategory[],
    settingItems: SettingItem[],
    foreshadows: Foreshadow[],
    materials: Material[],
    versions: Record<string, ChapterVersion[]>
  ): Promise<boolean> {
    await this.set(`project_${project.id}_chapters`, chapters);
    await this.set(`project_${project.id}_characters`, characters);
    await this.set(`project_${project.id}_settingCategories`, settingCategories);
    await this.set(`project_${project.id}_settingItems`, settingItems);
    await this.set(`project_${project.id}_foreshadows`, foreshadows);
    await this.set(`project_${project.id}_materials`, materials);
    await this.set(`project_${project.id}_versions`, versions);
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async backupProjectFile(_filePath: string, _keepCount?: number): Promise<boolean> {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listBackups(_filePath: string): Promise<{ name: string; path: string; timestamp: string }[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async restoreBackup(_backupPath: string, _targetPath: string): Promise<boolean> {
    return false;
  }

  async openFileDialog(): Promise<string | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async saveFileDialog(_defaultName: string): Promise<string | null> {
    return null;
  }

  async checkForRecovery(): Promise<string | null> {
    return localStorage.getItem('recovery_draft');
  }

  async saveRecoveryDraft(projectId: string, chapterId: string, content: string): Promise<void> {
    await this.set('recovery_draft', {
      projectId,
      chapterId,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  async loadRecoveryDraft(): Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null> {
    return this.get('recovery_draft', null);
  }

  async clearRecoveryDraft(): Promise<void> {
    localStorage.removeItem('recovery_draft');
  }

  async encrypt(plainText: string): Promise<string | null> {
    return plainText;
  }

  async decrypt(encryptedBase64: string): Promise<string | null> {
    return encryptedBase64;
  }
}

export const storage: StorageAPI = isElectron() ? new ElectronStorage() : new LocalStorage();

const MIGRATION_VERSION = '2.0.0';

export const runMigration = async (): Promise<boolean> => {
  const currentVersion = await storage.get<string>('app_migration_version', '');
  if (!currentVersion || currentVersion !== MIGRATION_VERSION) {
    console.log('Running migration from version', currentVersion, 'to', MIGRATION_VERSION);
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
      versions
    );
    if (success) {
      await storage.remove(`project_${project.id}_chapters`);
      await storage.remove(`project_${project.id}_characters`);
      await storage.remove(`project_${project.id}_settingCategories`);
      await storage.remove(`project_${project.id}_settingItems`);
      await storage.remove(`project_${project.id}_foreshadows`);
      await storage.remove(`project_${project.id}_materials`);
      await storage.remove(`project_${project.id}_versions`);
      return filePath;
    }
  }
  return null;
};

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let isDirty = false;
let saveCallback: (() => Promise<void>) | null = null;

export const setAutoSaveCallback = (callback: () => Promise<void>) => {
  saveCallback = callback;
};

export const markDirty = () => {
  isDirty = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (isDirty && saveCallback) {
      void saveCallback();
      isDirty = false;
    }
  }, AUTOSAVE_INTERVAL);
};

export const triggerSave = () => {
  if (saveCallback) {
    void saveCallback();
    isDirty = false;
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  }
};

export const clearAutoSaveTimer = () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
};

export const getDirtyState = () => isDirty;