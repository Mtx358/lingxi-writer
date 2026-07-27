// 路径与数据校验函数：被单元测试 import，亦被各 handler 复用。
// 本模块仅依赖 electron app（路径白名单）/ node 内置模块 / ./shared。
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getDataDir, getBackupsDir } from './shared';

// 工程文件路径白名单根目录：限制 .cwp 读写范围，防止渲染层被 XSS 后
// 通过 IPC 任意写入系统目录（如 C:\Windows\System32\evil.cwp）。
// 允许的根目录：用户主目录、Documents、Desktop、Downloads、userData
function getAllowedProjectFileRoots(): string[] {
  const home = app.getPath('home');
  const roots = [
    home,
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    app.getPath('userData'),
  ];
  // 去重 + 规范化
  return Array.from(new Set(roots.map(p => path.resolve(p))));
}

// 安全校验：工程文件路径必须是绝对路径、.cwp 后缀、且位于白名单根目录之内，
// 防止渲染层被 XSS 后通过 IPC 读写任意系统文件（如系统目录、其他用户目录）
// 注意：本函数仅做 lexical 校验（path.normalize + 前缀匹配），不解析符号链接。
// IPC handler 应在通过本检查后再调用 assertRealPathInside 防止 symlink 绕过。
export function isSafeProjectFilePath(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (filePath.includes('\0') || filePath.includes('\n') || filePath.includes('\r')) return false;
  if (!path.isAbsolute(filePath)) return false;
  if (!filePath.toLowerCase().endsWith('.cwp')) return false;
  const normalized = path.normalize(filePath);
  // 规范化后必须仍以 .cwp 结尾（防止 ../evil.cwp/. 这类绕过）
  if (!normalized.toLowerCase().endsWith('.cwp')) return false;
  // 必须位于白名单根目录之一之内
  const allowedRoots = getAllowedProjectFileRoots();
  const isInsideAllowed = allowedRoots.some(root =>
    normalized === root || normalized.startsWith(root + path.sep)
  );
  if (!isInsideAllowed) return false;
  return true;
}

// 备份路径必须位于 backups 目录内
// 严格匹配：resolved === backupsRoot 或 resolved 以 backupsRoot + path.sep 开头，
// 防止 /userData/backups-malicious/evil.cwp 这类前缀绕过
export function isSafeBackupPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false;
  const resolved = path.resolve(p);
  const backupsRoot = getBackupsDir();
  return resolved === backupsRoot || resolved.startsWith(backupsRoot + path.sep);
}

// 导出文件允许的扩展名白名单：仅允许已知导出格式，防止渲染层被 XSS 后
// 通过 export:writeFile / export:writeFileBuffer 向用户目录写入 .exe/.bat/.sh
// 等可执行文件（用户可能被诱导双击运行）
const EXPORT_ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.html', '.htm', '.docx', '.pdf', '.epub',
]);

// 校验导出文件路径：必须是绝对路径、扩展名在白名单内、且位于用户可访问目录
// （home / Documents / Desktop / Downloads / userData）。
// 与 isSafeProjectFilePath 的区别：后者仅允许 .cwp，本函数允许导出格式但同样
// 限制在用户目录内，防止写入系统目录（如 C:\Windows\System32\evil.pdf）
// 注意：本函数仅做 lexical 校验，IPC handler 应再调用 assertRealPathInside 防止 symlink 绕过
export function isSafeExportFilePath(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (filePath.includes('\0') || filePath.includes('\n') || filePath.includes('\r')) return false;
  if (!path.isAbsolute(filePath)) return false;
  const lower = filePath.toLowerCase();
  const ext = path.extname(lower);
  if (!EXPORT_ALLOWED_EXTENSIONS.has(ext)) return false;
  const normalized = path.normalize(filePath);
  // 规范化后扩展名仍须在白名单中（防止 ../evil.exe/. 这类绕过）
  const normalizedExt = path.extname(normalized.toLowerCase());
  if (!EXPORT_ALLOWED_EXTENSIONS.has(normalizedExt)) return false;
  // 必须位于白名单根目录之一之内（复用工程文件根目录白名单）
  const allowedRoots = getAllowedProjectFileRoots();
  const isInsideAllowed = allowedRoots.some(root =>
    normalized === root || normalized.startsWith(root + path.sep)
  );
  if (!isInsideAllowed) return false;
  return true;
}

// 校验路径是否位于 userData 数据目录内（严格前缀匹配）
// 统一供 storage:readFileBase64 / writeFile / writeFileBuffer 复用，
// 防止 /userData-malicious 这类前缀绕过
// 注意：本函数仅做 lexical 校验，IPC handler 应再调用 assertRealPathInside 防止 symlink 绕过
export function isInsideDataDir(filePath: unknown): boolean {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return false;
  const resolved = path.resolve(filePath);
  const dataDir = getDataDir();
  return resolved === dataDir || resolved.startsWith(dataDir + path.sep);
}

// 解析 filePath 的真实路径（递归跟随所有符号链接）。
// 用途：path.normalize / path.resolve 仅做 lexical 规范化，不解析 symlink，
// 攻击者可在允许的根目录内创建指向 /etc/passwd 的 symlink 绕过 isSafeProjectFilePath 等
// lexical 校验。realpath 系统调用递归跟随 symlink，返回规范绝对路径。
//
// 不存在文件的处理：projectFile:write 等场景写入新文件，realpath 会 ENOENT，
// 此时解析父目录（应存在）后拼接 basename，覆盖"创建新文件"场景。
//
// 返回 null 表示路径不可解析（父目录不存在、权限不足、ELOOP 等），
// 调用方据此拒绝 IPC 请求
// 导出供单元测试：测试创建真实 symlink 验证 realpath 解析行为
export async function resolveRealPath(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // 文件不存在（写入新文件场景）：解析父目录后拼接 basename。
      // 父目录若也不存在则 realpath 失败，返回 null 拒绝请求
      const parent = path.dirname(filePath);
      const base = path.basename(filePath);
      try {
        const realParent = await fs.realpath(parent);
        return path.join(realParent, base);
      } catch {
        return null;
      }
    }
    return null; // EACCES / ELOOP / ENOTDIR 等
  }
}

// 校验 filePath 的 realpath 是否位于 allowedRoots 任一根目录之内（严格前缀匹配）。
// 与 isSafeProjectFilePath 等 lexical 校验配合使用：lexical 快速过滤大部分非法路径，
// realpath 校验兜底 symlink 绕过。
// allowedRoots 也通过 realpath 解析（root 自身可能是 symlink，如 /home -> /Users），
// 避免误判合法路径为越界
// 导出供单元测试：测试创建真实 symlink 验证防御行为
export async function assertRealPathInside(
  filePath: string,
  allowedRoots: string[],
): Promise<boolean> {
  const real = await resolveRealPath(filePath);
  if (real === null) return false;
  // 解析每个允许根目录的 realpath；解析失败时回退到原值（首次启动根目录可能尚未创建）
  const realRoots = await Promise.all(
    allowedRoots.map(async r => {
      const rr = await resolveRealPath(r);
      return rr ?? r;
    }),
  );
  return realRoots.some(root =>
    real === root || real.startsWith(root + path.sep)
  );
}

// 校验 projectId / attachmentId 等用户可控标识符：禁止路径穿越字符与空值。
// 用于 material:saveAttachment / storage:backupProject 等 IPC 入参校验，
// 防止渲染层被 XSS 后通过 projectId='../../etc' 让 path.join 把目标路径
// 拼接到 materials/backups 目录之外（如 userData/materials/../../etc/passwd）。
// 长度上限：防止超长标识符触发 path.join 拼接超长字符串造成 DoS 或日志膨胀
// （正常 projectId/attachmentId 均为 UUID 或短字符串，256 留充足余量）
export const MAX_IDENTIFIER_LENGTH = 256;
export function isSafeIdentifier(id: unknown): id is string {
  if (typeof id !== 'string' || !id) return false;
  if (id.length > MAX_IDENTIFIER_LENGTH) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) return false;
  return true;
}

// projectFile 数据形状校验：project 必须是非空对象、6 个集合必须是数组、
// versions 必须是对象或 null/undefined。读取被篡改/损坏的 .cwp 文件后若不校验，
// 直接把 string/null 等非预期类型写入 store，下游 .map/.find 会崩溃。
export function isValidProjectFileData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!d.project || typeof d.project !== 'object' || Array.isArray(d.project)) return false;
  const arrayFields = ['chapters', 'characters', 'settingCategories', 'settingItems', 'foreshadows', 'materials'];
  for (const f of arrayFields) {
    if (!Array.isArray(d[f])) return false;
  }
  if (d.versions != null && (typeof d.versions !== 'object' || Array.isArray(d.versions))) return false;
  return true;
}

// ============================================================================
// AI 代理入参校验：被单元测试 import，被 aiProxy.ts 的 registerAIProxyHandlers 复用。
// ============================================================================

// ai:proxyStream 入参白名单校验：防止渲染层被 XSS 后传入畸形 params 导致：
// - 任意 provider 字符串拼接 SSRF URL（虽然 isAllowedAiBaseUrl 兜底，但白名单更安全）
// - 巨型 messages 数组或 content 撑爆主进程内存（DoS）
// - 畸形 temperature/maxTokens 触发 OpenAI 5xx 错误
// - requestId 含特殊字符污染 channel 名（ai:stream:chunk:<requestId>），可能触发
//   ipcRenderer.on 的 channel 名解析异常或与其他 channel 撞名
// 返回 null 表示合法，否则返回错误描述（IPC handler 据此 throw 给渲染层）
// 导出供单元测试：验证各字段边界条件与白名单
const AI_PROXY_VALID_PROVIDERS = new Set(['mock', 'local', 'openai', 'deepseek']);
const AI_PROXY_VALID_ROLES = new Set(['system', 'user', 'assistant']);
const AI_PROXY_MAX_MESSAGES = 200;
const AI_PROXY_MAX_CONTENT_LEN = 200_000; // 单条 content 上限：单章小说约 50K，留 4x 余量
const AI_PROXY_MAX_BASEURL_LEN = 1024;
const AI_PROXY_MAX_MODEL_LEN = 128;
const AI_PROXY_MAX_TOKENS = 8192; // gpt-4o-mini 输出上限 16K，8K 安全
const AI_PROXY_REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function validateAIProxyParams(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return 'ai:proxyStream: params must be an object';
  }
  const p = params as Record<string, unknown>;

  if (typeof p.provider !== 'string' || !AI_PROXY_VALID_PROVIDERS.has(p.provider)) {
    return 'ai:proxyStream: invalid provider';
  }

  // baseUrl 可选；提供时必须是短字符串。主进程后续仍会调用 isAllowedAiBaseUrl 做协议/域名白名单兜底
  if (p.baseUrl !== undefined && p.baseUrl !== '') {
    if (typeof p.baseUrl !== 'string' || p.baseUrl.length > AI_PROXY_MAX_BASEURL_LEN) {
      return 'ai:proxyStream: invalid baseUrl';
    }
  }

  // model 可选；提供时必须是短字符串（model ID 通常 < 64 字符，128 留余量）
  if (p.model !== undefined && p.model !== '') {
    if (typeof p.model !== 'string' || p.model.length > AI_PROXY_MAX_MODEL_LEN) {
      return 'ai:proxyStream: invalid model';
    }
  }

  // messages 必须是非空数组，长度上限防止巨型对话历史撑爆内存
  if (!Array.isArray(p.messages) || p.messages.length === 0) {
    return 'ai:proxyStream: messages must be a non-empty array';
  }
  if (p.messages.length > AI_PROXY_MAX_MESSAGES) {
    return `ai:proxyStream: too many messages (max ${AI_PROXY_MAX_MESSAGES})`;
  }
  for (let i = 0; i < p.messages.length; i++) {
    const msg = p.messages[i];
    if (!msg || typeof msg !== 'object') {
      return `ai:proxyStream: message[${i}] must be an object`;
    }
    const m = msg as Record<string, unknown>;
    if (typeof m.role !== 'string' || !AI_PROXY_VALID_ROLES.has(m.role)) {
      return `ai:proxyStream: message[${i}] has invalid role`;
    }
    if (typeof m.content !== 'string') {
      return `ai:proxyStream: message[${i}] content must be string`;
    }
    if (m.content.length > AI_PROXY_MAX_CONTENT_LEN) {
      return `ai:proxyStream: message[${i}] content too long (max ${AI_PROXY_MAX_CONTENT_LEN} chars)`;
    }
  }

  // temperature 必须是有限数字，范围 [0, 2]（OpenAI 推荐范围 0-2）
  if (typeof p.temperature !== 'number' ||
      !Number.isFinite(p.temperature) ||
      p.temperature < 0 || p.temperature > 2) {
    return 'ai:proxyStream: invalid temperature (must be finite number in [0, 2])';
  }

  // maxTokens 必须是有限正整数，范围 [1, 8192]
  if (typeof p.maxTokens !== 'number' ||
      !Number.isFinite(p.maxTokens) ||
      !Number.isInteger(p.maxTokens) ||
      p.maxTokens < 1 || p.maxTokens > AI_PROXY_MAX_TOKENS) {
    return `ai:proxyStream: invalid maxTokens (must be integer in [1, ${AI_PROXY_MAX_TOKENS}])`;
  }

  // requestId 用于构造 IPC channel 名（ai:stream:chunk:<requestId>），
  // 必须是安全字符集，长度 1-128 防止 channel 名过长或为空
  if (typeof p.requestId !== 'string' || !AI_PROXY_REQUEST_ID_RE.test(p.requestId)) {
    return 'ai:proxyStream: invalid requestId (must match ^[a-zA-Z0-9_-]{1,128}$)';
  }

  return null;
}

// ai:proxyLLM 入参白名单校验：与 validateAIProxyParams 同源的安全约束，
// 区别在于非流式代理入参为 prompt + systemPrompt（单轮对话）而非 messages 数组。
// 防止渲染层被 XSS 后传入畸形 params 导致 SSRF / DoS / requestId 污染。
// 返回 null 表示合法，否则返回错误描述（IPC handler 据此 throw 给渲染层）
export function validateAIProxyLLMParams(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return 'ai:proxyLLM: params must be an object';
  }
  const p = params as Record<string, unknown>;

  if (typeof p.provider !== 'string' || !AI_PROXY_VALID_PROVIDERS.has(p.provider)) {
    return 'ai:proxyLLM: invalid provider';
  }

  // baseUrl 可选；提供时必须是短字符串。主进程后续仍会调用 isAllowedAiBaseUrl 做协议/域名白名单兜底
  if (p.baseUrl !== undefined && p.baseUrl !== '') {
    if (typeof p.baseUrl !== 'string' || p.baseUrl.length > AI_PROXY_MAX_BASEURL_LEN) {
      return 'ai:proxyLLM: invalid baseUrl';
    }
  }

  // model 可选；提供时必须是短字符串
  if (p.model !== undefined && p.model !== '') {
    if (typeof p.model !== 'string' || p.model.length > AI_PROXY_MAX_MODEL_LEN) {
      return 'ai:proxyLLM: invalid model';
    }
  }

  // prompt 必须是非空字符串，长度上限防止巨型输入撑爆主进程内存或后端计费
  if (typeof p.prompt !== 'string' || p.prompt.length === 0) {
    return 'ai:proxyLLM: prompt must be a non-empty string';
  }
  if (p.prompt.length > AI_PROXY_MAX_CONTENT_LEN) {
    return `ai:proxyLLM: prompt too long (max ${AI_PROXY_MAX_CONTENT_LEN} chars)`;
  }

  // systemPrompt 可选；提供时必须是字符串，同样有长度上限
  if (p.systemPrompt !== undefined && p.systemPrompt !== '') {
    if (typeof p.systemPrompt !== 'string' || p.systemPrompt.length > AI_PROXY_MAX_CONTENT_LEN) {
      return `ai:proxyLLM: systemPrompt too long (max ${AI_PROXY_MAX_CONTENT_LEN} chars)`;
    }
  }

  // temperature 必须是有限数字，范围 [0, 2]（OpenAI 推荐范围 0-2）
  if (typeof p.temperature !== 'number' ||
      !Number.isFinite(p.temperature) ||
      p.temperature < 0 || p.temperature > 2) {
    return 'ai:proxyLLM: invalid temperature (must be finite number in [0, 2])';
  }

  // maxTokens 必须是有限正整数，范围 [1, 8192]
  if (typeof p.maxTokens !== 'number' ||
      !Number.isFinite(p.maxTokens) ||
      !Number.isInteger(p.maxTokens) ||
      p.maxTokens < 1 || p.maxTokens > AI_PROXY_MAX_TOKENS) {
    return `ai:proxyLLM: invalid maxTokens (must be integer in [1, ${AI_PROXY_MAX_TOKENS}])`;
  }

  // requestId 用于 aiAbortControllers Map key 与 ai:abort 查找，
  // 必须是安全字符集，长度 1-128
  if (typeof p.requestId !== 'string' || !AI_PROXY_REQUEST_ID_RE.test(p.requestId)) {
    return 'ai:proxyLLM: invalid requestId (must match ^[a-zA-Z0-9_-]{1,128}$)';
  }

  return null;
}

export { getAllowedProjectFileRoots, EXPORT_ALLOWED_EXTENSIONS };
