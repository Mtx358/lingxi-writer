import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { isRecoveryDraftExpired, type StorageAPI } from './helpers';

/**
 * Electron 主进程 IPC 桥接的存储后端。
 *
 * 通过 window.electronAPI 调用主进程的 storage / projectFile / ai 通道，
 * 主进程负责磁盘读写、备份、safeStorage 加密、原子 patch 等。
 * 渲染层只持有明文数据与成功/失败语义，错误统一 toast 提示用户。
 */
export class ElectronStorage implements StorageAPI {
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
      // storage:write IPC 在所有失败路径（无效 key、超大小限制、磁盘满、权限错误、
      // isQuitting 拒绝）均返回 false 而非抛异常。若仅 try/catch，catch 永远不触发，
      // 调用方无法感知失败，内存状态已更新但磁盘未写入 → 下次启动数据丢失且无提示。
      // 此处检查返回值，false 时显式报错让用户感知。
      const ok = await window.electronAPI!.storage.write(key, value);
      if (ok === false) {
        toast.error('数据写入失败', `键 "${key}" 持久化失败，请检查磁盘空间或文件权限。`);
      }
    } catch (e) {
      console.error('Failed to set storage:', key, e);
      toast.error('数据写入失败', `键 "${key}" 持久化失败：${getErrorMessage(e)}。请检查磁盘空间或文件权限。`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await window.electronAPI!.storage.remove(key);
    } catch (e) {
      console.error('Failed to remove storage:', key, e);
      // rethrow 让调用方（如 deleteProject 的 Promise.allSettled）感知失败，
      // 否则 hasFailure 永远为 false，磁盘残留数据用户无感知
      throw e;
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
      toast.error('项目文件保存失败', `写入 "${filePath}" 时发生异常：${getErrorMessage(e)}`);
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
      toast.warning('自动备份失败', `备份 "${filePath}" 时发生异常：${getErrorMessage(e)}`);
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

  async checkForRecovery(): Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null> {
    // 与 loadRecoveryDraft 语义一致：返回对象或 null，不再因 typeof === 'string' 恒为 false 而漏掉恢复草稿
    return this.loadRecoveryDraft();
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
        const draft = result as { projectId: string; chapterId: string; content: string; timestamp: string };
        // 过期清理（M5）：超过 7 天的草稿自动清除并返回 null，避免陈旧草稿无限残留。
        // 用户可能已切换项目或不再需要此草稿；保留只会让启动时反复弹出无意义提示
        if (isRecoveryDraftExpired(draft.timestamp)) {
          await this.clearRecoveryDraft().catch(() => {});
          return null;
        }
        return draft;
      }
      return null;
    } catch {
      return null;
    }
  }

  async clearRecoveryDraft(): Promise<void> {
    await this.remove('recovery_draft');
  }

  async saveAISettings(settings: {
    apiKey: string;
    provider: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    [key: string]: unknown;
  }): Promise<boolean> {
    // 走专用 ai:saveSettings IPC：主进程内部校验 provider + 加密 apiKey 后落盘，
    // 不再走 storage.set('aiSettings', ...) 全量覆写，防止 XSS 后任意替换 apiKey
    try {
      return await window.electronAPI!.ai.saveSettings(settings);
    } catch (e) {
      console.error('Failed to save AI settings:', e);
      return false;
    }
  }

  async loadAISettings(): Promise<{
    apiKey: string;
    provider: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    [key: string]: unknown;
  } | null> {
    // 走专用 ai:loadSettings IPC：主进程内部解密 apiKey 后返回明文，
    // 不再走 storage.get('aiSettings') + storage.decrypt，
    // 收敛 decrypt 能力到主进程，防止渲染层被 XSS 后解密其他加密字段
    try {
      const result = await window.electronAPI!.ai.loadSettings();
      if (!result || typeof result !== 'object') return null;
      return result as {
        apiKey: string;
        provider: string;
        baseUrl: string;
        model: string;
        temperature: number;
        maxTokens: number;
        [key: string]: unknown;
      };
    } catch (e) {
      console.error('Failed to load AI settings:', e);
      return null;
    }
  }

  async patchProjects(op:
    | { type: 'add'; project: Project }
    | { type: 'remove'; id: string }
    | { type: 'update'; project: Project }
    | { type: 'clear' }
  ): Promise<Project[] | null> {
    // 原子 patch：主进程在 withWriteMutex 内 read-modify-write，避免全量覆盖竞态
    // 注：as unknown as 后的多行 union 必须用括号包裹，否则 TS 解析器在函数调用参数内
    //     无法正确识别 union 边界，导致 TS1131/TS1005/TS1472/TS1128 系列错误
    try {
      const result = await window.electronAPI!.storage.patchProjects(op as unknown as (
        | { type: 'add'; project: unknown }
        | { type: 'remove'; id: string }
        | { type: 'update'; project: unknown }
        | { type: 'clear' }
      ));
      return result as Project[] | null;
    } catch (e) {
      console.error('Failed to patch projects:', e);
      return null;
    }
  }
}
