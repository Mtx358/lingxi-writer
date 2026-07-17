import { app, BrowserWindow, shell, ipcMain, dialog, safeStorage, Menu, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_ELECTRON = path.join(__dirname, '..');
const DIST_RENDERER = path.join(DIST_ELECTRON, '..', 'dist');

let mainWindow: BrowserWindow | null = null;
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

const FILE_VERSION = '1.0.0';

// 允许的存储 key 白名单（非 project_ 前缀的全局 key）
// project_ 前缀的 key 由 resolveFilePath 单独处理，按 projectId 分目录存储
const ALLOWED_GLOBAL_STORAGE_KEYS = new Set([
  'projects',
  'aiSettings',
  'recovery_draft',
  'app_migration_version',
  'lastOpenedProject',
]);

function isValidStorageKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) return false;
  // project_ 前缀的 key 由 resolveFilePath 处理（格式 project_{id}_{subkey}）
  if (key.startsWith('project_')) return true;
  // 全局 key 必须在白名单中
  return ALLOWED_GLOBAL_STORAGE_KEYS.has(key);
}

function getDataDir(): string {
  return app.getPath('userData');
}

function getProjectsDir(): string {
  return path.join(getDataDir(), 'projects');
}

function getBackupsDir(): string {
  return path.join(getDataDir(), 'backups');
}

function ensureDir(filePath: string): Promise<void> {
  return fs.mkdir(path.dirname(filePath), { recursive: true }).then(() => undefined);
}

function pathExists(p: string): Promise<boolean> {
  try {
    return fs.access(p).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function generateChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// 安全校验：工程文件路径必须是绝对路径、.cwp 后缀、且不含空字节/穿越符，
// 防止渲染层被 XSS 后通过 IPC 读写任意系统文件
function isSafeProjectFilePath(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (filePath.includes('\0')) return false;
  if (!path.isAbsolute(filePath)) return false;
  if (!filePath.toLowerCase().endsWith('.cwp')) return false;
  // 规范化后必须仍以原前缀目录为根，防止 ../ 穿越
  const normalized = path.normalize(filePath);
  return normalized === filePath || normalized.endsWith('.cwp');
}

// 备份路径必须位于 backups 目录内
function isSafeBackupPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false;
  const resolved = path.resolve(p);
  const backupsRoot = getBackupsDir();
  return resolved.startsWith(backupsRoot + path.sep) || resolved.startsWith(backupsRoot);
}

function registerProjectFileHandlers() {
  ipcMain.handle('projectFile:read', async (_event, filePath: string) => {
    try {
      if (!isSafeProjectFilePath(filePath)) return { success: false, error: '非法的工程文件路径' };
      const buffer = await fs.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);

      const metadataStr = await zip.file('metadata.json')?.async('string');
      if (!metadataStr) {
        return { success: false, error: '缺少元数据文件' };
      }
      const metadata = JSON.parse(metadataStr);
      if (metadata.version !== FILE_VERSION) {
        return { success: false, error: `不兼容的文件版本: ${metadata.version}` };
      }

      const readJson = async <T>(filename: string): Promise<T | null> => {
        const file = zip.file(filename);
        if (!file) return null;
        const content = await file.async('string');
        try {
          return JSON.parse(content);
        } catch {
          return null;
        }
      };

      const result: {
        success: boolean;
        data: {
          metadata: unknown;
          project: unknown;
          chapters: unknown[];
          characters: unknown[];
          settingCategories: unknown[];
          settingItems: unknown[];
          foreshadows: unknown[];
          materials: unknown[];
          versions: Record<string, unknown[]>;
        };
      } = {
        success: true,
        data: {
          metadata,
          project: await readJson('project.json'),
          chapters: await readJson('chapters.json') || [],
          characters: await readJson('characters.json') || [],
          settingCategories: await readJson('settingCategories.json') || [],
          settingItems: await readJson('settingItems.json') || [],
          foreshadows: await readJson('foreshadows.json') || [],
          materials: await readJson('materials.json') || [],
          versions: {},
        },
      };

      const versionsFolder = zip.folder('versions');
      if (versionsFolder) {
        const files = Object.keys(versionsFolder.files);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const chapterId = file.slice(0, -5);
            result.data.versions[chapterId] = await readJson(`versions/${file}`) || [];
          }
        }
      }

      return result;
    } catch (e) {
      console.error('projectFile:read error', e);
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('projectFile:write', async (_event, filePath: string, data: {
    project: unknown;
    chapters: unknown;
    characters: unknown;
    settingCategories: unknown;
    settingItems: unknown;
    foreshadows: unknown;
    materials: unknown;
    versions: unknown;
  }) => {
    try {
      if (!isSafeProjectFilePath(filePath)) return { success: false, error: '非法的工程文件路径' };
      await ensureDir(filePath);

      const tempPath = filePath + '.tmp';
      const backupPath = filePath + '.bak';

      const zip = new JSZip();

      const metadata = {
        version: FILE_VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checksum: generateChecksum(JSON.stringify(data.project)),
      };

      zip.file('metadata.json', JSON.stringify(metadata, null, 2));
      zip.file('project.json', JSON.stringify(data.project, null, 2));
      zip.file('chapters.json', JSON.stringify(data.chapters, null, 2));
      zip.file('characters.json', JSON.stringify(data.characters, null, 2));
      zip.file('settingCategories.json', JSON.stringify(data.settingCategories, null, 2));
      zip.file('settingItems.json', JSON.stringify(data.settingItems, null, 2));
      zip.file('foreshadows.json', JSON.stringify(data.foreshadows, null, 2));
      zip.file('materials.json', JSON.stringify(data.materials, null, 2));

      if (data.versions && typeof data.versions === 'object' && Object.keys(data.versions).length > 0) {
        const versionsDir = zip.folder('versions');
        Object.entries(data.versions as Record<string, unknown>).forEach(([chapterId, chapterVersions]) => {
          versionsDir?.file(`${chapterId}.json`, JSON.stringify(chapterVersions, null, 2));
        });
      }

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (await pathExists(filePath)) {
        await fs.copyFile(filePath, backupPath);
      }

      await fs.writeFile(tempPath, buffer);

      const tempStats = await fs.stat(tempPath);
      if (tempStats.size < 10) {
        await fs.unlink(tempPath);
        return { success: false, error: '生成的文件过小，可能已损坏' };
      }

      await fs.rename(tempPath, filePath);

      await fs.unlink(backupPath).catch(() => {});

      await cleanupOldBackups(filePath);

      return { success: true };
    } catch (e) {
      console.error('projectFile:write error', e);
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('projectFile:validate', async (_event, filePath: string) => {
    try {
      if (!isSafeProjectFilePath(filePath)) return { valid: false, error: '非法的工程文件路径' };
      const buffer = await fs.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);

      const requiredFiles = ['metadata.json', 'project.json', 'chapters.json'];
      for (const file of requiredFiles) {
        if (!zip.file(file)) {
          return { valid: false, error: `缺少必要文件: ${file}` };
        }
      }

      const metadataStr = await zip.file('metadata.json')?.async('string');
      if (!metadataStr) {
        return { valid: false, error: '无效的元数据' };
      }

      const metadata = JSON.parse(metadataStr);
      if (metadata.version !== FILE_VERSION) {
        return { valid: false, error: `版本不兼容` };
      }

      return { valid: true };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('projectFile:backup', async (_event, filePath: string, keepCount = 5) => {
    try {
      if (!isSafeProjectFilePath(filePath)) return { success: false, error: '非法的工程文件路径' };
      const backupsDir = path.join(getBackupsDir(), path.basename(filePath));
      await ensureDir(backupsDir);

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupsDir, `${ts}.cwp`);

      await fs.copyFile(filePath, backupPath);

      const backups = (await fs.readdir(backupsDir)).sort().reverse();
      for (const old of backups.slice(keepCount)) {
        await fs.rm(path.join(backupsDir, old), { force: true });
      }

      return { success: true };
    } catch (e) {
      console.error('projectFile:backup error', e);
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('projectFile:listBackups', async (_event, filePath: string) => {
    try {
      if (!isSafeProjectFilePath(filePath)) return { success: false, backups: [] };
      const backupsDir = path.join(getBackupsDir(), path.basename(filePath));
      if (!(await pathExists(backupsDir))) return { success: true, backups: [] };

      const backups = (await fs.readdir(backupsDir)).sort().reverse();
      return {
        success: true,
        backups: backups.map(name => ({
          name,
          path: path.join(backupsDir, name),
          timestamp: name.replace('.cwp', ''),
        })),
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('projectFile:restoreBackup', async (_event, backupPath: string, targetPath: string) => {
    try {
      if (!isSafeBackupPath(backupPath)) return { success: false, error: '非法的备份路径' };
      if (!isSafeProjectFilePath(targetPath)) return { success: false, error: '非法的目标路径' };
      await fs.copyFile(backupPath, targetPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('projectFile:openDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      title: '打开工程文件',
      filters: [{ name: '创作工坊工程', extensions: ['cwp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('projectFile:saveDialog', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '保存工程文件',
      defaultPath: defaultName,
      filters: [{ name: '创作工坊工程', extensions: ['cwp'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
}

async function cleanupOldBackups(filePath: string) {
  const backupsDir = path.join(getBackupsDir(), path.basename(filePath));
  if (!(await pathExists(backupsDir))) return;

  const backups = (await fs.readdir(backupsDir)).sort().reverse();
  for (const old of backups.slice(5)) {
    await fs.rm(path.join(backupsDir, old), { force: true }).catch(() => {});
  }
}

function registerStorageHandlers() {
  ipcMain.handle('storage:read', async (_event, key: string) => {
    try {
      if (!isValidStorageKey(key)) return null;
      const filePath = resolveFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  ipcMain.handle('storage:write', async (_event, key: string, value: unknown) => {
    try {
      if (!isValidStorageKey(key)) return false;
      const filePath = resolveFilePath(key);
      await ensureDir(filePath);
      const tmp = filePath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(value), 'utf-8');
      await fs.rename(tmp, filePath);
      return true;
    } catch (e) {
      console.error('storage:write error', key, e);
      return false;
    }
  });

  ipcMain.handle('storage:remove', async (_event, key: string) => {
    try {
      if (!isValidStorageKey(key)) return false;
      if (key.startsWith('project_') && !key.includes('_', 'project_'.length + 1)) {
        const dir = resolveDirPath(key);
        await fs.rm(dir, { recursive: true, force: true });
      } else {
        const filePath = resolveFilePath(key);
        await fs.unlink(filePath).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('storage:listProjectDirs', async () => {
    try {
      const dir = getProjectsDir();
      if (!(await pathExists(dir))) return [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  });

  ipcMain.handle('storage:backupProject', async (_event, projectId: string, keepCount = 5) => {
    try {
      const srcDir = path.join(getProjectsDir(), projectId);
      if (!(await pathExists(srcDir))) return false;
      const backupRoot = path.join(getBackupsDir(), projectId);
      await ensureDir(backupRoot);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const destDir = path.join(backupRoot, ts);
      await copyDir(srcDir, destDir);
      const backups = (await fs.readdir(backupRoot)).sort().reverse();
      for (const old of backups.slice(keepCount)) {
        await fs.rm(path.join(backupRoot, old), { recursive: true, force: true });
      }
      return true;
    } catch (e) {
      console.error('backup error', e);
      return false;
    }
  });

  ipcMain.handle('dialog:selectFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      title: '选择附件文件',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const buffer = await fs.readFile(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        size: buffer.length,
        ext: path.extname(filePath).slice(1).toLowerCase(),
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('storage:readFileBase64', async (_event, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath) return null;
      const resolved = path.resolve(filePath);
      const dataDir = getDataDir();
      // 严格限制只能读取 userData 目录内的文件，防止路径穿越读取系统任意文件
      if (!resolved.startsWith(dataDir)) {
        console.error('readFileBase64: path outside data dir', filePath);
        return null;
      }
      const buffer = await fs.readFile(resolved);
      return buffer.toString('base64');
    } catch {
      return null;
    }
  });

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string, _data: string, filterExt: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '保存导出文件',
      defaultPath: defaultName,
      filters: [{ name: filterExt.toUpperCase(), extensions: [filterExt] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  ipcMain.handle('storage:writeFile', async (_event, filePath: string, data: string, encoding?: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath) return false;
      const resolved = path.resolve(filePath);
      const dataDir = getDataDir();
      if (!resolved.startsWith(dataDir)) {
        console.error('writeFile: path outside data dir', filePath);
        return false;
      }
      await fs.writeFile(resolved, data, { encoding: (encoding as BufferEncoding) || 'utf-8' });
      return true;
    } catch (e) {
      console.error('writeFile error', e);
      return false;
    }
  });

  ipcMain.handle('storage:writeFileBuffer', async (_event, filePath: string, base64Data: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath) return false;
      const resolved = path.resolve(filePath);
      const dataDir = getDataDir();
      if (!resolved.startsWith(dataDir)) {
        console.error('writeFileBuffer: path outside data dir', filePath);
        return false;
      }
      await fs.writeFile(resolved, Buffer.from(base64Data, 'base64'));
      return true;
    } catch (e) {
      console.error('writeFileBuffer error', e);
      return false;
    }
  });

  ipcMain.handle('file:openExternal', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') return false;
    try {
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // 素材附件持久化：将用户选择的源文件复制到项目数据目录下的 materials/<projectId>/，
  // 避免用户移动/删除原文件导致附件失效；同时杜绝 base64 内嵌 JSON 的体积与注入风险。
  // 返回复制后的绝对路径，供 MaterialAttachment.path 存储。
  ipcMain.handle('material:saveAttachment', async (_event, sourcePath: string, projectId: string, attachmentId: string) => {
    if (!sourcePath || !projectId || !attachmentId) return null;
    try {
      const materialsDir = path.join(getDataDir(), 'materials', projectId);
      await fs.mkdir(materialsDir, { recursive: true });
      const ext = path.extname(sourcePath);
      const destPath = path.join(materialsDir, `${attachmentId}${ext}`);
      await fs.copyFile(sourcePath, destPath);
      return destPath;
    } catch (e) {
      console.error('保存素材附件失败:', e);
      return null;
    }
  });

  ipcMain.handle('storage:encrypt', async (_event, plainText: string) => {
    if (!plainText || typeof plainText !== 'string') return null;
    // safeStorage 不可用时拒绝加密，调用方据此不应落盘明文 apiKey
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('safeStorage 不可用，拒绝加密 apiKey');
      return null;
    }
    try {
      const encrypted = safeStorage.encryptString(plainText);
      return encrypted.toString('base64');
    } catch (e) {
      console.error('encrypt error', e);
      return null;
    }
  });

  ipcMain.handle('storage:decrypt', async (_event, encryptedBase64: string) => {
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') return null;
    try {
      const encrypted = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(encrypted);
    } catch (e) {
      console.error('decrypt error', e);
      return null;
    }
  });

  // 崩溃恢复检查
  ipcMain.handle('system:checkCrashRecovery', async () => {
    try {
      return await checkCrashRecovery();
    } catch (e) {
      console.error('checkCrashRecovery error', e);
      return { recovered: false, projects: [] };
    }
  });
}

// ============================================================================
// AI 请求代理：密钥只在主进程使用，渲染层通过 IPC 调用
// 即使渲染层被 XSS 注入，攻击者也无法拿到 API 密钥
// ============================================================================
const aiAbortControllers = new Map<string, AbortController>();

async function loadStoredAISettings(): Promise<{
  apiKey: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}> {
  try {
    const filePath = resolveFilePath('aiSettings');
    const data = await fs.readFile(filePath, 'utf-8');
    const settings = JSON.parse(data);
    let apiKey = '';
    if (settings.apiKey && safeStorage.isEncryptionAvailable()) {
      try {
        apiKey = safeStorage.decryptString(Buffer.from(settings.apiKey, 'base64'));
      } catch {
        apiKey = '';
      }
    }
    return {
      apiKey,
      provider: settings.provider || 'mock',
      baseUrl: settings.baseUrl || '',
      model: settings.model || '',
      temperature: settings.temperature ?? 0.7,
      maxTokens: settings.maxTokens ?? 2000,
    };
  } catch {
    return { apiKey: '', provider: 'mock', baseUrl: '', model: '', temperature: 0.7, maxTokens: 2000 };
  }
}

function registerAIProxyHandlers() {
  ipcMain.handle('ai:proxyStream', async (event, params: {
    provider: string;
    baseUrl?: string;
    model?: string;
    messages: { role: string; content: string }[];
    temperature: number;
    maxTokens: number;
    requestId: string;
  }) => {
    const { provider, model, messages, temperature, maxTokens, requestId } = params;

    // 密钥从主进程存储读取，渲染层不传密钥
    const stored = await loadStoredAISettings();
    const baseUrl = params.baseUrl || stored.baseUrl;
    const apiKey = stored.apiKey;

    const modelMap: Record<string, string> = {
      local: 'qwen2.5:7b',
      openai: 'gpt-4o-mini',
      deepseek: 'deepseek-chat',
    };
    const usedModel = model || stored.model || modelMap[provider] || 'gpt-4o-mini';

    let url: string;
    let headers: Record<string, string>;
    if (provider === 'local') {
      url = `${baseUrl || 'http://localhost:11434'}/api/chat`;
      headers = { 'Content-Type': 'application/json' };
    } else if (provider === 'openai') {
      url = `${baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    } else if (provider === 'deepseek') {
      url = `${baseUrl || 'https://api.deepseek.com'}/v1/chat/completions`;
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const abortController = new AbortController();
    aiAbortControllers.set(requestId, abortController);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: usedModel, messages, temperature, max_tokens: maxTokens, stream: true }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let fullContent = '';

      const extractChunk = (data: string): string => {
        if (data === '[DONE]') return '';
        try {
          const json = JSON.parse(data);
          // openai/deepseek 格式: choices[0].delta.content
          // ollama 格式: message.content
          return json.choices?.[0]?.delta?.content ?? json.message?.content ?? '';
        } catch {
          return '';
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const chunk = extractChunk(trimmed.slice(6));
          if (chunk) {
            fullContent += chunk;
            event.sender.send(`ai:stream:chunk:${requestId}`, chunk);
          }
        }
      }
      // flush 残留缓冲区
      const tail = sseBuffer.trim();
      if (tail.startsWith('data: ')) {
        const chunk = extractChunk(tail.slice(6));
        if (chunk) {
          fullContent += chunk;
          event.sender.send(`ai:stream:chunk:${requestId}`, chunk);
        }
      }

      event.sender.send(`ai:stream:done:${requestId}`, fullContent);
      return fullContent;
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === 'AbortError' || abortController.signal.aborted);
      if (isAbort) {
        // abort 视为正常完成，保留已生成内容
        event.sender.send(`ai:stream:done:${requestId}`, '');
        return '';
      }
      const msg = e instanceof Error ? e.message : String(e);
      event.sender.send(`ai:stream:error:${requestId}`, msg);
      throw e;
    } finally {
      aiAbortControllers.delete(requestId);
    }
  });

  ipcMain.handle('ai:abort', (_event, requestId: string) => {
    const controller = aiAbortControllers.get(requestId);
    if (controller) {
      controller.abort();
      aiAbortControllers.delete(requestId);
    }
    return true;
  });
}

// 允许的项目数据子键（project_{id}_{subkey} 格式中的 subkey 部分）
const ALLOWED_PROJECT_SUBKEYS = new Set([
  'chapters',
  'characters',
  'settingCategories',
  'settingItems',
  'foreshadows',
  'materials',
  'versions',
]);

function resolveFilePath(key: string): string {
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

function resolveDirPath(key: string): string {
  if (!key || typeof key !== 'string' || key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  if (key.startsWith('project_')) {
    const rest = key.slice('project_'.length);
    const underscoreIdx = rest.indexOf('_');
    const projectId = underscoreIdx === -1 ? rest : rest.slice(0, underscoreIdx);
    if (projectId.includes('..')) throw new Error('Invalid projectId');
    const resolved = path.join(getProjectsDir(), projectId);
    if (!resolved.startsWith(getProjectsDir())) throw new Error('Path traversal detected');
    return resolved;
  }
  return getDataDir();
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N' },
        { label: '打开项目', accelerator: 'CmdOrCtrl+O' },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S' },
        { label: '另存为', accelerator: 'CmdOrCtrl+Shift+S' },
        { type: 'separator' },
        { label: '导出', submenu: [
          { label: '导出为 Markdown' },
          { label: '导出为 Word' },
          { label: '导出为 PDF' },
          { label: '导出为 TXT' },
        ]},
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        { label: '搜索', accelerator: 'CmdOrCtrl+F' },
        { label: '全局搜索', accelerator: 'CmdOrCtrl+K' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: '主题', submenu: [
          { label: '深色模式' },
          { label: '浅色模式' },
        ]},
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用手册' },
        { label: '关于创作工坊', role: 'about' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  // 注入 Content-Security-Policy，阻断 XSS → 任意 IPC 调用的攻击链
  const isDev = !!VITE_DEV_SERVER_URL;
  const devOrigin = isDev ? new URL(VITE_DEV_SERVER_URL).origin : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? ` 'unsafe-inline' ${devOrigin}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https: http://localhost:* http://127.0.0.1:*${isDev ? ` ws://localhost:* ws://127.0.0.1:*` : ''}`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: '创作工坊',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(DIST_RENDERER, 'index.html'));
  }
}

app.whenReady().then(() => {
  registerProjectFileHandlers();
  registerStorageHandlers();
  registerAIProxyHandlers();
  createMenu();
  createWindow();

  // 启动自动备份（每 5 分钟备份一次所有项目）
  startAutoBackup();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 应用退出前清理
app.on('before-quit', () => {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
});

function startAutoBackup() {
  if (autoBackupTimer) return;
  // 每 5 分钟执行一次增量备份
  autoBackupTimer = setInterval(() => {
    void runAutoBackup().catch(err => console.error('Auto backup failed:', err));
  }, 5 * 60 * 1000);
}

async function runAutoBackup(): Promise<void> {
  const projectsDir = getProjectsDir();
  const backupsDir = getBackupsDir();
  try {
    await fs.access(projectsDir);
  } catch {
    return; // 没有项目目录则跳过
  }

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  if (projectDirs.length === 0) return;

  await ensureDir(backupsDir);
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (const projectId of projectDirs) {
    const projectDir = path.join(projectsDir, projectId);
    const backupDir = path.join(backupsDir, projectId, dateStr);
    try {
      const exists = await fs.access(backupDir).then(() => true).catch(() => false);
      if (!exists) {
        await copyDir(projectDir, backupDir);
      }
    } catch (err) {
      console.warn(`Backup failed for project ${projectId}:`, err);
    }
  }

  // 清理超过 7 天的备份
  await cleanupOldDatedBackups(7);
}

async function cleanupOldDatedBackups(days: number): Promise<void> {
  const backupsDir = getBackupsDir();
  try {
    await fs.access(backupsDir);
  } catch {
    return;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const projectEntries = await fs.readdir(backupsDir, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectBackupDir = path.join(backupsDir, projectEntry.name);
    const dateEntries = await fs.readdir(projectBackupDir, { withFileTypes: true });
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) continue;
      const dateMatch = dateEntry.name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) continue;
      const backupDate = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])).getTime();
      if (backupDate < cutoff) {
        await fs.rm(path.join(projectBackupDir, dateEntry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

// 崩溃恢复：检查上次是否异常退出，返回可恢复的项目列表
async function checkCrashRecovery(): Promise<{ recovered: boolean; projects: string[] }> {
  const projectsDir = getProjectsDir();
  const recovered: string[] = [];
  try {
    await fs.access(projectsDir);
  } catch {
    return { recovered: false, projects: [] };
  }

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsDir, entry.name);
    const mainFile = path.join(projectDir, 'main.json');
    const tmpFile = path.join(projectDir, 'main.json.tmp');
    // 如果 tmp 文件存在且比主文件新，说明上次写入时崩溃，从 tmp 恢复
    try {
      const [mainStat, tmpStat] = await Promise.all([
        fs.stat(mainFile).catch(() => null),
        fs.stat(tmpFile).catch(() => null),
      ]);
      if (tmpStat && (!mainStat || tmpStat.mtimeMs > mainStat.mtimeMs)) {
        await fs.copyFile(tmpFile, mainFile);
        recovered.push(entry.name);
      }
    } catch (err) {
      console.warn(`Crash recovery check failed for ${entry.name}:`, err);
    }
  }
  return { recovered: recovered.length > 0, projects: recovered };
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});