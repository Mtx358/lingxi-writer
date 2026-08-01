import type { Project, Chapter, Character, SettingCategory, SettingItem, Foreshadow, Material, ChapterVersion } from '@/types';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import { isQuotaError, isRecoveryDraftExpired, type StorageAPI } from './helpers';

/**
 * LocalStorage 后端适配器（web 环境 / Electron 不可用时回退）。
 *
 * 与 ElectronStorage 实现同一 StorageAPI 接口。文件相关方法（read/write/backup
 * 等）在 web 环境不可用，返回 null/false/[] 等安全默认值，保证调用方不崩。
 * 项目数据按 `project_${id}_${domain}` 多键存入 localStorage，writeProjectFile
 * 并行写 7 个 key 收敛 microtask tick。
 *
 * 【安全】apiKey 加固：web 环境无 Electron safeStorage，原实现 apiKey 明文存
 * localStorage——任何 XSS / 浏览器扩展 / 用户手动查看 localStorage 都能直接读到
 * OpenAI 密钥。现用 Web Crypto API 的 SubtleCrypto（AES-GCM 256）加密 apiKey：
 *   - 密钥由"设备指纹"（首次访问生成的 UUID，存 localStorage）经 PBKDF2 派生
 *   - 加密后的 apiKey 与 IV 一起 base64 存入 aiSettings（标记 _apiKeyEncrypted=true）
 *   - loadAISettings 时识别标记并解密
 * 这不是强加密（设备指纹本身就在 localStorage，攻击者拿到 localStorage 即可解密），
 * 但能防御"localStorage 被无意打印 / 日志记录 / 截图"等被动泄露场景——直接读到
 * 的不再是明文密钥。若 SubtleCrypto 不可用（如某些 jsdom 测试环境），降级到明文。
 */

// ============ Web apiKey 加固：SubtleCrypto AES-GCM ============

const AI_SETTINGS_STORE_KEY = 'aiSettings';
// 设备指纹存储 key：首次访问生成 UUID 后存 localStorage，用于派生加密密钥
const DEVICE_FP_KEY = 'lingxi_device_fp';
// PBKDF2 迭代次数：NIST 推荐 ≥ 10000，这里取 50000 提升暴力破解成本（不影响首启感知）
const PBKDF2_ITERATIONS = 50_000;
// PBKDF2 salt：固定常量（与设备指纹配合使用，主要熵源来自设备指纹本身）
const PBKDF2_SALT = 'lingxi-writer-apikey-salt-v1';
// AES-GCM IV 长度：12 字节（NIST 推荐）
const AES_GCM_IV_LEN = 12;

/** 探测 SubtleCrypto 是否可用：jsdom 等环境可能未实现，降级路径需要探测 */
function isSubtleCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined'
    && crypto !== null
    && typeof crypto.subtle !== 'undefined'
    && typeof crypto.subtle.encrypt === 'function'
    && typeof crypto.subtle.deriveKey === 'function';
}

/**
 * 获取或生成设备指纹：用于派生 AES-GCM 密钥。
 * - 首次访问用 crypto.randomUUID 生成 UUID 并存 localStorage
 * - 后续从 localStorage 读取（保证加密/解密用同一指纹，否则解密失败）
 * - randomUUID 缺失时用 crypto.getRandomValues 生成加密强随机兜底（极端环境，仅测试场景），
 *   不用 Math.random：该指纹派生 AES 密钥，可预测指纹 = 可预测密钥
 */
function getDeviceFingerprint(): string {
  let fp = localStorage.getItem(DEVICE_FP_KEY);
  if (!fp) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      fp = crypto.randomUUID();
    } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      // crypto.randomUUID 不可用时（极旧环境），用 CSPRNG 生成 128 位随机数的十六进制
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      fp = `fp-${Date.now()}-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
    } else {
      // 真正无 crypto API 的环境（不应出现在 Electron/现代浏览器），退而求其次
      fp = `fp-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }
    try { localStorage.setItem(DEVICE_FP_KEY, fp); } catch { /* localStorage 不可用时仅内存持有，下次再生成 */ }
  }
  return fp;
}

/** 用设备指纹经 PBKDF2 派生 AES-GCM 256 位密钥 */
async function deriveAesKey(fingerprint: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(fingerprint),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(PBKDF2_SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Uint8Array → base64 字符串（不用 btoa 是因为 btoa 不处理 >255 的字节，但 Uint8Array 元素范围 0-255 安全） */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 字符串 → Uint8Array */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 加密 apiKey：AES-GCM + 随机 IV，返回 base64(iv || ciphertext)。
 * AES-GCM 自带认证标签（authentication tag），篡改密文会抛错而非错误解密。
 */
async function encryptApiKey(apiKey: string, key: CryptoKey): Promise<string> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LEN));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(apiKey),
  );
  // 拼接 iv(12) || ciphertext(含 auth tag)，整体 base64
  const cipherBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.byteLength + cipherBytes.byteLength);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.byteLength);
  return bytesToBase64(combined);
}

/** 解密 apiKey：base64 → iv || ciphertext → AES-GCM decrypt */
async function decryptApiKey(stored: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBytes(stored);
  const iv = combined.slice(0, AES_GCM_IV_LEN);
  const ciphertext = combined.slice(AES_GCM_IV_LEN);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plain);
}

export class LocalStorage implements StorageAPI {
  async get<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const data = localStorage.getItem(key);
      // 显式判 null：localStorage.getItem 在键不存在时返回 null，与空字符串 '' 不同
      // 原 `data ? ... : defaultValue` 把空字符串也当无数据处理，语义错误
      if (data === null) return defaultValue;
      return JSON.parse(data);
    } catch (e) {
      // JSON.parse 失败说明该键数据已损坏（如写入中途崩溃/版本不兼容）。
      // 原实现静默回退 defaultValue 会让用户以为是新项目继续写，覆盖丢失原数据。
      // 这里上报键名与数据片段，便于排错；并删除坏数据避免反复读到。
      console.error(
        `localStorage[${key}] JSON.parse failed:`,
        e,
        'raw(0..100):',
        (localStorage.getItem(key) || '').slice(0, 100)
      );
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      // 项目级关键键（chapters/characters/foreshadows/materials/versions）损坏时 toast 警告用户
      if (/^project_.+_(chapters|characters|foreshadows|materials|versions|settingItems)$/.test(key)) {
        toast.error(
          '数据损坏',
          `键 "${key}" 解析失败，已清除该键的损坏数据。如需恢复请从备份中导入。`,
        );
      }
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
        toast.error('数据写入失败', `键 "${key}" 持久化失败：${getErrorMessage(e)}`);
      }
    }
  }

  // 批量写入：localStorage 直接顺序 setItem，无 IPC 限流问题
  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value);
    }
  }

  // 批量读取：localStorage 直接顺序 getItem，无 IPC 限流问题。
  // 与 ElectronStorage.getMany 对称，返回 Record<key, unknown>，
  // key 不存在或 JSON 解析失败时值为 null
  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    for (const key of keys) {
      try {
        const data = localStorage.getItem(key);
        results[key] = data === null ? null : JSON.parse(data);
      } catch {
        results[key] = null;
      }
    }
    return results;
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }


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
    // P-H2 修复：用 Promise.all 并行写入 7 个 key，替代串行 await。
    // localStorage.setItem 本身同步，但每个 await 会引入一个 microtask tick，
    // 7 次串行 await 会推迟状态就绪 7 个 tick；并行化收敛为 1 个 tick
    await Promise.all([
      this.set(`project_${project.id}_chapters`, chapters),
      this.set(`project_${project.id}_characters`, characters),
      this.set(`project_${project.id}_settingCategories`, settingCategories),
      this.set(`project_${project.id}_settingItems`, settingItems),
      this.set(`project_${project.id}_foreshadows`, foreshadows),
      this.set(`project_${project.id}_materials`, materials),
      this.set(`project_${project.id}_versions`, versions),
    ]);
    return true;
  }


  async backupProjectFile(_filePath: string, _keepCount?: number): Promise<boolean> {
    return false;
  }


  async listBackups(_filePath: string): Promise<{ name: string; path: string; timestamp: string }[]> {
    return [];
  }


  async restoreBackup(_backupPath: string, _targetPath: string): Promise<boolean> {
    return false;
  }

  async openFileDialog(): Promise<string | null> {
    return null;
  }


  async saveFileDialog(_defaultName: string): Promise<string | null> {
    return null;
  }

  async checkForRecovery(): Promise<{ projectId: string; chapterId: string; content: string; timestamp: string } | null> {
    // 与 loadRecoveryDraft 语义一致：返回解析后的对象或 null
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
    // 修复：this.get 是 async，必须 await 才能拿到解析后的对象。
    // 原 `const draft = this.get(...)`（无 await）让 draft 是 Promise，
    // `'projectId' in draft` 恒为 false → 永远返回 null，导致 web 环境下
    // saveRecoveryDraft 写入的草稿永远无法被加载，崩溃恢复功能失效
    const draft = await this.get<{ projectId: string; chapterId: string; content: string; timestamp: string } | null>('recovery_draft', null);
    // 形状校验 + 过期清理（M5）：与 Electron 后端保持一致
    if (draft && typeof draft === 'object' && 'projectId' in draft && 'chapterId' in draft && 'content' in draft && 'timestamp' in draft) {
      if (isRecoveryDraftExpired(draft.timestamp)) {
        await this.clearRecoveryDraft().catch(() => {});
        return null;
      }
      return draft;
    }
    return null;
  }

  async clearRecoveryDraft(): Promise<void> {
    localStorage.removeItem('recovery_draft');
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
    // web 环境无 Electron safeStorage：用 SubtleCrypto AES-GCM 加密 apiKey 后再落 localStorage，
    // 防御 localStorage 被动泄露（日志/截图/控制台打印）场景下的明文密钥暴露。
    // SubtleCrypto 不可用时降级到明文（与原行为一致），保证功能可用。
    try {
      const toStore: Record<string, unknown> = { ...settings };
      if (settings.apiKey && isSubtleCryptoAvailable()) {
        try {
          const key = await deriveAesKey(getDeviceFingerprint());
          toStore.apiKey = await encryptApiKey(settings.apiKey, key);
          toStore._apiKeyEncrypted = true;
        } catch (e) {
          // 加密失败不阻塞保存：降级到明文，记录警告便于排错
          console.warn('[security] apiKey 加密失败，降级到明文存储：', e);
        }
      }
      localStorage.setItem(AI_SETTINGS_STORE_KEY, JSON.stringify(toStore));
      return true;
    } catch (e) {
      console.error('Failed to save AI settings to localStorage:', e);
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
    // 读取时识别 _apiKeyEncrypted 标记并解密 apiKey
    try {
      const raw = localStorage.getItem(AI_SETTINGS_STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const result = parsed as Record<string, unknown> & {
        apiKey: string;
        provider: string;
        baseUrl: string;
        model: string;
        temperature: number;
        maxTokens: number;
        [key: string]: unknown;
      };
      // 解密 apiKey：仅在标记为加密且 SubtleCrypto 可用时尝试
      if (result._apiKeyEncrypted && typeof result.apiKey === 'string') {
        if (isSubtleCryptoAvailable()) {
          try {
            const key = await deriveAesKey(getDeviceFingerprint());
            result.apiKey = await decryptApiKey(result.apiKey, key);
          } catch (e) {
            // 解密失败（设备指纹变更/密文被篡改/版本不兼容）：清空 apiKey，
            // 让用户重新输入，避免错误密钥被用于请求
            console.warn('[security] apiKey 解密失败，已清空 apiKey，请重新输入：', e);
            result.apiKey = '';
          }
        } else {
          // SubtleCrypto 不可用但密文已加密：无法解密，清空 apiKey 让用户重输
          console.warn('[security] aiSettings 标记为加密但 SubtleCrypto 不可用，已清空 apiKey');
          result.apiKey = '';
        }
        // 清除内部标记，不暴露给上层
        delete result._apiKeyEncrypted;
      }
      return result;
    } catch (e) {
      console.error('Failed to load AI settings from localStorage:', e);
      return null;
    }
  }

  async patchProjects(op:
    | { type: 'add'; project: Project }
    | { type: 'remove'; id: string }
    | { type: 'update'; project: Project }
    | { type: 'clear' }
  ): Promise<Project[] | null> {
    // localStorage 单线程无并发问题，但保持接口一致以便上层统一调用
    try {
      const data = localStorage.getItem('projects');
      let arr: Project[] = [];
      if (data !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          // JSON 解析失败：原数据已损坏，不覆盖写入，返回 null 让调用方感知失败
          console.error('patchProjects: localStorage projects 数据损坏，跳过写入以防数据丢失:', e);
          return null;
        }
        // 非数组合法 JSON（如 "string" / 42 / {}）：不覆盖写入，避免清空已有项目
        if (!Array.isArray(parsed)) {
          console.error('patchProjects: localStorage projects 数据非数组，跳过写入以防数据丢失');
          return null;
        }
        arr = parsed as Project[];
      }
      switch (op.type) {
        case 'add': {
          const idx = arr.findIndex(p => p.id === op.project.id);
          if (idx >= 0) arr[idx] = op.project;
          else arr.push(op.project);
          break;
        }
        case 'remove':
          arr = arr.filter(p => p.id !== op.id);
          break;
        case 'update': {
          const idx = arr.findIndex(p => p.id === op.project.id);
          if (idx >= 0) arr[idx] = { ...arr[idx], ...op.project };
          else arr.push(op.project);
          break;
        }
        case 'clear':
          arr = [];
          break;
      }
      localStorage.setItem('projects', JSON.stringify(arr));
      return arr;
    } catch (e) {
      console.error('Failed to patch projects in localStorage:', e);
      return null;
    }
  }
}
