"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECENT_SELECTED_FILES_TTL_MS = exports.FORBIDDEN_OPEN_EXTERNAL_EXTS = exports.ALLOWED_OPEN_EXTERNAL_EXTS = exports.ALLOWED_PROJECT_SUBKEYS = void 0;
exports.registerStorageHandlers = registerStorageHandlers;
exports.resolveFilePath = resolveFilePath;
exports.resolveDirPath = resolveDirPath;
exports.rememberSelectedFile = rememberSelectedFile;
exports.isRecentlySelectedFile = isRecentlySelectedFile;
exports.getRecentlySelectedFilesRealPaths = getRecentlySelectedFilesRealPaths;
// 存储相关 IPC handler、路径解析、最近选择文件白名单。
// 依赖 ./shared、./security，无反向依赖。
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_crypto_1 = require("node:crypto");
const logger_1 = require("../logger");
const shared_1 = require("./shared");
const security_1 = require("./security");
const storage_logic_1 = require("./storage.logic");
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
exports.ALLOWED_PROJECT_SUBKEYS = ALLOWED_PROJECT_SUBKEYS;
function resolveFilePath(key) {
    // 安全校验：禁止路径穿越字符
    if (!key || typeof key !== 'string' || key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
        throw new Error('Invalid storage key');
    }
    if (key.startsWith('project_')) {
        const rest = key.slice('project_'.length);
        const underscoreIdx = rest.indexOf('_');
        if (underscoreIdx === -1) {
            // project_{id} 格式：指向项目主文件
            const resolved = node_path_1.default.join((0, shared_1.getProjectsDir)(), rest, 'main.json');
            if (!resolved.startsWith((0, shared_1.getProjectsDir)()))
                throw new Error('Path traversal detected');
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
        const resolved = node_path_1.default.join((0, shared_1.getProjectsDir)(), projectId, `${subkey}.json`);
        if (!resolved.startsWith((0, shared_1.getProjectsDir)()))
            throw new Error('Path traversal detected');
        return resolved;
    }
    const resolved = node_path_1.default.join((0, shared_1.getDataDir)(), `${key}.json`);
    if (!resolved.startsWith((0, shared_1.getDataDir)()))
        throw new Error('Path traversal detected');
    return resolved;
}
function resolveDirPath(key) {
    if (!key || typeof key !== 'string' || key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
        throw new Error('Invalid storage key');
    }
    if (key.startsWith('project_')) {
        const rest = key.slice('project_'.length);
        const underscoreIdx = rest.indexOf('_');
        const projectId = underscoreIdx === -1 ? rest : rest.slice(0, underscoreIdx);
        // 必须有非空 projectId，否则 path.join(projectsDir, '') === projectsDir，
        // rm -rf 会递归删除整个 projects 目录造成灾难性数据丢失
        if (!projectId)
            throw new Error('Invalid projectId: empty');
        if (projectId.includes('..'))
            throw new Error('Invalid projectId');
        const resolved = node_path_1.default.join((0, shared_1.getProjectsDir)(), projectId);
        if (!resolved.startsWith((0, shared_1.getProjectsDir)()))
            throw new Error('Path traversal detected');
        return resolved;
    }
    return (0, shared_1.getDataDir)();
}
// file:openExternal 后缀白名单（仅允许常见安全文档/媒体类型）
const ALLOWED_OPEN_EXTERNAL_EXTS = new Set([
    'txt', 'md', 'markdown', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
]);
exports.ALLOWED_OPEN_EXTERNAL_EXTS = ALLOWED_OPEN_EXTERNAL_EXTS;
// 危险可执行后缀黑名单（双重防御）
const FORBIDDEN_OPEN_EXTERNAL_EXTS = new Set([
    'exe', 'bat', 'sh', 'app', 'cmd', 'ps1', 'com', 'scr', 'vbs', 'js', 'mjs', 'jar',
]);
exports.FORBIDDEN_OPEN_EXTERNAL_EXTS = FORBIDDEN_OPEN_EXTERNAL_EXTS;
// material:saveAttachment 的源路径白名单：
// 渲染层被 XSS 后可调用此接口把系统敏感文件复制到 materials 目录再外传，
// 这里要求 sourcePath 必须是用户最近 N 秒内通过 dialog:selectFile 主动选择的文件。
const RECENT_SELECTED_FILES_TTL_MS = 5 * 60 * 1000;
exports.RECENT_SELECTED_FILES_TTL_MS = RECENT_SELECTED_FILES_TTL_MS;
const recentSelectedFiles = new Map();
function rememberSelectedFile(filePath) {
    if (!filePath || typeof filePath !== 'string')
        return;
    const abs = node_path_1.default.resolve(filePath);
    recentSelectedFiles.set(abs, Date.now());
    // 顺手清理过期项
    const now = Date.now();
    for (const [p, ts] of recentSelectedFiles) {
        if (now - ts > RECENT_SELECTED_FILES_TTL_MS)
            recentSelectedFiles.delete(p);
    }
}
function isRecentlySelectedFile(filePath) {
    if (typeof filePath !== 'string' || !filePath)
        return false;
    const abs = node_path_1.default.resolve(filePath);
    const ts = recentSelectedFiles.get(abs);
    if (!ts)
        return false;
    if (Date.now() - ts > RECENT_SELECTED_FILES_TTL_MS) {
        recentSelectedFiles.delete(abs);
        return false;
    }
    return true;
}
// 返回当前 recentSelectedFiles 中未过期项的绝对路径数组。
// 供 file:openExternal 的 realpath 校验使用：lexical isRecentlySelectedFile 通过后，
// 还需 realpath 校验 filePath 不被 symlink 引到 allowedRoots 之外
function getRecentlySelectedFilesRealPaths() {
    const now = Date.now();
    const result = [];
    for (const [p, ts] of recentSelectedFiles) {
        if (now - ts <= RECENT_SELECTED_FILES_TTL_MS)
            result.push(p);
    }
    return result;
}
function registerStorageHandlers() {
    (0, shared_1.safeIpcHandle)('storage:read', async (_event, key) => {
        try {
            // aiSettings 不再放行：loadAISettings 已改走 ai:loadSettings IPC，
            // storage:read('aiSettings') 直接返回 null，避免渲染层读到磁盘密文
            if (!(0, shared_1.isValidStorageKey)(key) && !shared_1.READ_ONLY_STORAGE_KEYS.has(key)) {
                logger_1.logger.audit('security.input', 'storage:read rejected: invalid storage key', { key });
                return null;
            }
            const filePath = resolveFilePath(key);
            const data = await promises_1.default.readFile(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (e) {
            logger_1.logger.warn('storage:read failed', { key, error: e instanceof Error ? e.message : String(e) });
            return null;
        }
    });
    (0, shared_1.safeIpcHandle)('storage:write', async (_event, key, value) => {
        try {
            if (!(0, shared_1.isValidStorageKey)(key)) {
                logger_1.logger.audit('security.input', 'storage:write rejected: invalid storage key', { key });
                return false;
            }
            // 大小限制：防止 XSS 后写入超大 value 撑爆磁盘（DoS）。
            // 50MB 足以容纳最长小说的章节内容 + recovery_draft；超出则拒绝并审计
            const serialized = JSON.stringify(value);
            if (serialized.length > shared_1.MAX_STORAGE_VALUE_SIZE) {
                logger_1.logger.audit('security.size', 'storage:write rejected: value too large', {
                    key,
                    size: serialized.length,
                });
                return false;
            }
            const filePath = resolveFilePath(key);
            // 串行化同一 filePath 的并发写入，避免 tmp 互相覆盖导致数据错乱
            return await (0, shared_1.withWriteMutex)(filePath, async () => {
                await (0, shared_1.ensureDir)(filePath);
                // 临时文件名包含 UUID，避免并发写入同一 filePath 时 tmp 互相覆盖
                const tmp = `${filePath}.${(0, node_crypto_1.randomUUID)()}.tmp`;
                try {
                    await promises_1.default.writeFile(tmp, serialized, 'utf-8');
                    await promises_1.default.rename(tmp, filePath);
                    return true;
                }
                finally {
                    // 异常路径清理 tmp，避免残留；成功路径下 tmp 已 rename 走，unlink 忽略 ENOENT
                    await promises_1.default.unlink(tmp).catch(() => { });
                }
            });
        }
        catch (e) {
            logger_1.logger.error('storage:write error', e instanceof Error ? e : { error: String(e), key });
            return false;
        }
    });
    // 原子 patch projects 数组：解决 storage:write 全量覆盖的 read-modify-write 竞态。
    // 渲染层 read → push → write 两次并发时（如快速连续创建两个项目），后写者覆盖前写者，
    // 导致先创建的项目目录已建但 projects.json 无记录，用户看不到该项目。
    // patchProjects 在 withWriteMutex 内原子读改写，IPC 不能传函数故用 patch op 描述。
    (0, shared_1.safeIpcHandle)('storage:patchProjects', async (_event, op) => {
        try {
            // ============ 入参 schema 校验（M1）============
            // 防止 XSS 后构造畸形 op 污染 projects 数组或触发未预期行为：
            // - op 必须是对象（非数组/null）
            // - type 必须是 'add'/'remove'/'update'/'clear' 之一
            // - add/update 的 project 必须是对象且含 isSafeIdentifier 校验通过的 string id
            // - remove 的 id 必须通过 isSafeIdentifier 校验（防路径穿越字符注入到 projects.json）
            if (!op || typeof op !== 'object' || Array.isArray(op))
                return null;
            const o = op;
            const opType = o.type;
            if (typeof opType !== 'string')
                return null;
            if (opType !== 'add' && opType !== 'remove' && opType !== 'update' && opType !== 'clear') {
                logger_1.logger.audit('security.schema', 'patchProjects rejected: unknown type', { type: opType });
                return null;
            }
            // 校验 project 字段（add/update 需要）：必须是对象 + 含 string id + id 通过 isSafeIdentifier
            // 危险键过滤：拒绝 __proto__/constructor/prototype 作为顶层键，防延迟型原型污染
            const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
            const validateProject = (p) => {
                if (!p || typeof p !== 'object' || Array.isArray(p))
                    return false;
                const proj = p;
                if (typeof proj.id !== 'string')
                    return false;
                if (!(0, security_1.isSafeIdentifier)(proj.id))
                    return false;
                for (const key of Object.keys(proj)) {
                    if (DANGEROUS_KEYS.has(key))
                        return false;
                }
                return true;
            };
            if (opType === 'add' || opType === 'update') {
                if (!validateProject(o.project)) {
                    logger_1.logger.audit('security.schema', 'patchProjects rejected: invalid project', { type: opType });
                    return null;
                }
            }
            else if (opType === 'remove') {
                if (typeof o.id !== 'string' || !(0, security_1.isSafeIdentifier)(o.id)) {
                    logger_1.logger.audit('security.schema', 'patchProjects rejected: invalid id');
                    return null;
                }
            }
            const filePath = resolveFilePath('projects');
            return await (0, shared_1.withWriteMutex)(filePath, async () => {
                // 原子 read-modify-write：mutex 内读当前数组、应用 patch、写回
                let arr = [];
                try {
                    const data = await promises_1.default.readFile(filePath, 'utf-8');
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed))
                        arr = parsed;
                }
                catch {
                    // 文件不存在或 JSON 损坏：视为空数组，避免阻塞首次创建
                }
                // op 应用：抽离为 applyProjectsOps 纯函数便于单元测试
                // 入参 op 已通过上面的 schema 校验，cast 为 ProjectOp 安全
                const next = (0, storage_logic_1.applyProjectsOps)(arr, [op]);
                if (next === null)
                    return null;
                arr = next;
                await (0, shared_1.ensureDir)(filePath);
                const tmp = `${filePath}.${(0, node_crypto_1.randomUUID)()}.tmp`;
                try {
                    await promises_1.default.writeFile(tmp, JSON.stringify(arr), 'utf-8');
                    await promises_1.default.rename(tmp, filePath);
                    return arr;
                }
                finally {
                    await promises_1.default.unlink(tmp).catch(() => { });
                }
            });
        }
        catch (e) {
            logger_1.logger.error('storage:patchProjects error', e instanceof Error ? e : { error: String(e) });
            return null;
        }
    });
    (0, shared_1.safeIpcHandle)('storage:remove', async (_event, key) => {
        try {
            // aiSettings 不再走 READ_ONLY 路径：重置改由专用 IPC 处理
            if (!(0, shared_1.isValidStorageKey)(key) && !shared_1.READ_ONLY_STORAGE_KEYS.has(key)) {
                logger_1.logger.audit('security.input', 'storage:remove rejected: invalid storage key', { key });
                return false;
            }
            // 仅 project_{id}（无第二个下划线）才递归删除项目目录；
            // project_{id}_{subkey} 只删除对应的 .json 文件
            if (key.startsWith('project_')) {
                const rest = key.slice('project_'.length);
                const isProjectRoot = !rest.includes('_');
                if (isProjectRoot) {
                    const dir = resolveDirPath(key);
                    // 二次防御：dir 必须严格位于 projects 目录之内（且不等于 projects 根目录本身）
                    const projectsRoot = (0, shared_1.getProjectsDir)();
                    if (dir === projectsRoot || !dir.startsWith(projectsRoot + node_path_1.default.sep)) {
                        logger_1.logger.audit('security.path', 'storage:remove refused: resolves to projects root or escapes', { dir });
                        return false;
                    }
                    await promises_1.default.rm(dir, { recursive: true, force: true });
                }
                else {
                    const filePath = resolveFilePath(key);
                    await promises_1.default.unlink(filePath).catch(() => { });
                }
            }
            else {
                const filePath = resolveFilePath(key);
                await promises_1.default.unlink(filePath).catch(() => { });
            }
            return true;
        }
        catch (e) {
            logger_1.logger.error('storage:remove error', e instanceof Error ? e : { error: String(e), key });
            return false;
        }
    });
    (0, shared_1.safeIpcHandle)('storage:listProjectDirs', async () => {
        try {
            const dir = (0, shared_1.getProjectsDir)();
            if (!(await (0, shared_1.pathExists)(dir)))
                return [];
            const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
            return entries.filter(e => e.isDirectory()).map(e => e.name);
        }
        catch (e) {
            logger_1.logger.warn('storage:listProjectDirs failed', { error: e instanceof Error ? e.message : String(e) });
            return [];
        }
    });
    (0, shared_1.safeIpcHandle)('storage:backupProject', async (_event, projectId, keepCount = 5) => {
        try {
            // 校验 projectId：防止渲染层被 XSS 后传入 '../../../etc' 等恶意路径，
            // 让 path.join 把 srcDir/backupRoot 拼接到 projects/backups 目录之外，
            // 导致 copyDir 把系统目录复制到任意位置或读取敏感目录
            if (!(0, security_1.isSafeIdentifier)(projectId)) {
                logger_1.logger.audit('security.path', 'backupProject rejected: invalid projectId', { projectId });
                return false;
            }
            const srcDir = node_path_1.default.join((0, shared_1.getProjectsDir)(), projectId);
            if (!(await (0, shared_1.pathExists)(srcDir)))
                return false;
            const backupRoot = node_path_1.default.join((0, shared_1.getBackupsDir)(), projectId);
            await (0, shared_1.ensureDir)(backupRoot);
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const destDir = node_path_1.default.join(backupRoot, ts);
            // 二次防御：srcDir/destDir 必须解析到各自根目录之内（防止极端边缘情况绕过）
            const projectsRoot = node_path_1.default.resolve((0, shared_1.getProjectsDir)());
            const backupsRoot = node_path_1.default.resolve((0, shared_1.getBackupsDir)());
            const resolvedSrc = node_path_1.default.resolve(srcDir);
            const resolvedDest = node_path_1.default.resolve(destDir);
            if (resolvedSrc !== projectsRoot && !resolvedSrc.startsWith(projectsRoot + node_path_1.default.sep)) {
                logger_1.logger.audit('security.path', 'backupProject rejected: srcDir escapes projects dir', { srcDir });
                return false;
            }
            if (resolvedDest !== backupsRoot && !resolvedDest.startsWith(backupsRoot + node_path_1.default.sep)) {
                logger_1.logger.audit('security.path', 'backupProject rejected: destDir escapes backups dir', { destDir });
                return false;
            }
            await (0, shared_1.copyDir)(srcDir, destDir);
            const backups = (await promises_1.default.readdir(backupRoot)).sort().reverse();
            for (const old of backups.slice(keepCount)) {
                await promises_1.default.rm(node_path_1.default.join(backupRoot, old), { recursive: true, force: true });
            }
            return true;
        }
        catch (e) {
            logger_1.logger.error('backup error', e instanceof Error ? e : { error: String(e) });
            return false;
        }
    });
    (0, shared_1.safeIpcHandle)('dialog:selectFile', async () => {
        const mainWindow = (0, shared_1.getMainWindow)();
        if (!mainWindow)
            return null;
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            title: '选择附件文件',
            // filters：与 ALLOWED_OPEN_EXTERNAL_EXTS 保持一致，限制用户可选文件类型。
            // 原先无 filters，用户可选 .exe/.sh 等任意文件，被 material:saveAttachment 原样
            // 复制到 userData/materials/<projectId>/ 落盘，构成钓鱼攻击面。
            filters: [
                { name: '常用文档与媒体', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'] },
                { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
                { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] },
                { name: '所有文件', extensions: ['*'] },
            ],
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        const filePath = result.filePaths[0];
        // 记入最近选择白名单，供 material:saveAttachment 校验源路径
        rememberSelectedFile(filePath);
        try {
            // 用 fs.stat 获取文件大小：原先 fs.readFile 把整个文件读入内存仅为取 .length，
            // 用户选择大附件（如 100MB 视频）时会无谓占用内存且增加响应延迟
            const stat = await promises_1.default.stat(filePath);
            return {
                path: filePath,
                name: node_path_1.default.basename(filePath),
                size: stat.size,
                ext: node_path_1.default.extname(filePath).slice(1).toLowerCase(),
            };
        }
        catch {
            return null;
        }
    });
    (0, shared_1.safeIpcHandle)('storage:readFileBase64', async (_event, filePath) => {
        try {
            // M-NEW-1 修复：限定到 materials 子目录，防止渲染层被 XSS 后读取
            // userData 下其他敏感文件（aiSettings.json/projects.json/recovery_draft.json/logs）。
            // 与 file:readDataURL 用途对齐：仅附件素材需要 base64 读取。
            const materialsRoot = node_path_1.default.join((0, shared_1.getDataDir)(), 'materials');
            const resolved = node_path_1.default.resolve(filePath);
            if (resolved !== materialsRoot && !resolved.startsWith(materialsRoot + node_path_1.default.sep)) {
                logger_1.logger.audit('security.path', 'readFileBase64 rejected: path outside materials dir', { filePath });
                return null;
            }
            // realpath 校验：防止 symlink 绕过 lexical 检查读取目录外的文件
            if (!(await (0, security_1.assertRealPathInside)(filePath, [materialsRoot]))) {
                logger_1.logger.audit('security.path', 'readFileBase64 rejected: realpath outside materials dir (symlink?)', { filePath });
                return null;
            }
            const buffer = await promises_1.default.readFile(resolved);
            return buffer.toString('base64');
        }
        catch {
            return null;
        }
    });
    (0, shared_1.safeIpcHandle)('dialog:saveFile', async (_event, defaultName, _data, filterExt) => {
        const mainWindow = (0, shared_1.getMainWindow)();
        if (!mainWindow)
            return null;
        // M-NEW-3 修复：filterExt 必须在导出白名单内，防止渲染层被 XSS 后传入 'exe'/'sh'
        // 误导用户选择可执行文件路径。defaultName 用 basename 剥离目录部分防路径穿越。
        const safeExt = typeof filterExt === 'string' ? filterExt.toLowerCase().replace(/^\./, '') : '';
        if (!security_1.EXPORT_ALLOWED_EXTENSIONS.has(`.${safeExt}`)) {
            logger_1.logger.audit('security.path', 'dialog:saveFile rejected: filterExt not in whitelist', { filterExt });
            return null;
        }
        const safeName = typeof defaultName === 'string' ? node_path_1.default.basename(defaultName) : 'export';
        const result = await electron_1.dialog.showSaveDialog(mainWindow, {
            title: '保存导出文件',
            defaultPath: safeName,
            filters: [{ name: safeExt.toUpperCase(), extensions: [safeExt] }],
        });
        if (result.canceled || !result.filePath)
            return null;
        return result.filePath;
    });
    (0, shared_1.safeIpcHandle)('storage:writeFile', async (_event, filePath, data, encoding) => {
        try {
            if (!(0, security_1.isInsideDataDir)(filePath)) {
                logger_1.logger.audit('security.path', 'writeFile rejected: path outside data dir', { filePath });
                return false;
            }
            // realpath 校验：防止 symlink 绕过 lexical 检查写入 userData 目录外的文件
            if (!(await (0, security_1.assertRealPathInside)(filePath, [(0, shared_1.getDataDir)()]))) {
                logger_1.logger.audit('security.path', 'writeFile rejected: realpath outside data dir (symlink?)', { filePath });
                return false;
            }
            const resolved = node_path_1.default.resolve(filePath);
            await promises_1.default.writeFile(resolved, data, { encoding: encoding || 'utf-8' });
            return true;
        }
        catch (e) {
            logger_1.logger.error('writeFile error', e instanceof Error ? e : { error: String(e) });
            return false;
        }
    });
    (0, shared_1.safeIpcHandle)('storage:writeFileBuffer', async (_event, filePath, base64Data) => {
        try {
            if (!(0, security_1.isInsideDataDir)(filePath)) {
                logger_1.logger.audit('security.path', 'writeFileBuffer rejected: path outside data dir', { filePath });
                return false;
            }
            // realpath 校验：防止 symlink 绕过 lexical 检查写入 userData 目录外的文件
            if (!(await (0, security_1.assertRealPathInside)(filePath, [(0, shared_1.getDataDir)()]))) {
                logger_1.logger.audit('security.path', 'writeFileBuffer rejected: realpath outside data dir (symlink?)', { filePath });
                return false;
            }
            const resolved = node_path_1.default.resolve(filePath);
            await promises_1.default.writeFile(resolved, Buffer.from(base64Data, 'base64'));
            return true;
        }
        catch (e) {
            logger_1.logger.error('writeFileBuffer error', e instanceof Error ? e : { error: String(e) });
            return false;
        }
    });
    (0, shared_1.safeIpcHandle)('file:openExternal', async (_event, filePath) => {
        if (!filePath || typeof filePath !== 'string')
            return false;
        // 路径校验：必须是绝对路径，且位于 userData 目录内或为用户最近通过 dialog 选择的文件。
        // 原先仅校验后缀，攻击者（XSS 后）可传 'relative/evil.pdf'，shell.openPath 会相对 cwd 解析，
        // 虽受后缀白名单限制只能开 pdf/txt 等，但若用户系统 PDF 阅读器存在 RCE 漏洞仍可被利用
        if (!node_path_1.default.isAbsolute(filePath)) {
            logger_1.logger.audit('security.path', 'openExternal rejected: path must be absolute', { filePath });
            return false;
        }
        if (!(0, security_1.isInsideDataDir)(filePath) && !isRecentlySelectedFile(filePath)) {
            logger_1.logger.audit('security.path', 'openExternal rejected: outside data dir and not recently selected', { filePath });
            return false;
        }
        // realpath 校验：防止 symlink 绕过 lexical 检查打开 userData 目录外的文件
        // （shell.openPath 会调用系统默认程序，若被引到敏感文件可能造成数据泄露）
        if (!(await (0, security_1.assertRealPathInside)(filePath, [(0, shared_1.getDataDir)(), ...getRecentlySelectedFilesRealPaths()]))) {
            logger_1.logger.audit('security.path', 'openExternal rejected: realpath outside allowed dirs (symlink?)', { filePath });
            return false;
        }
        // 后缀双重防御：先禁止可执行后缀，再要求在白名单中
        const ext = node_path_1.default.extname(filePath).slice(1).toLowerCase();
        if (FORBIDDEN_OPEN_EXTERNAL_EXTS.has(ext)) {
            logger_1.logger.audit('security.path', 'openExternal rejected: forbidden extension', { ext, filePath });
            return false;
        }
        if (!ext || !ALLOWED_OPEN_EXTERNAL_EXTS.has(ext)) {
            logger_1.logger.audit('security.path', 'openExternal rejected: extension not in allowlist', { ext, filePath });
            return false;
        }
        try {
            await electron_1.shell.openPath(filePath);
            return true;
        }
        catch {
            return false;
        }
    });
    // 素材附件持久化：将用户选择的源文件复制到项目数据目录下的 materials/<projectId>/，
    // 避免用户移动/删除原文件导致附件失效；同时杜绝 base64 内嵌 JSON 的体积与注入风险。
    // 返回复制后的绝对路径，供 MaterialAttachment.path 存储。
    (0, shared_1.safeIpcHandle)('material:saveAttachment', async (_event, sourcePath, projectId, attachmentId) => {
        if (!sourcePath || !projectId || !attachmentId)
            return null;
        // 校验 projectId / attachmentId：防止渲染层被 XSS 后传入 '../../../etc' 等恶意路径，
        // 让 path.join 把 destPath 拼接到 materials 目录之外（如 userData/materials/../../etc/passwd）
        if (!(0, security_1.isSafeIdentifier)(projectId) || !(0, security_1.isSafeIdentifier)(attachmentId)) {
            logger_1.logger.audit('security.path', 'saveAttachment rejected: invalid projectId or attachmentId', { projectId, attachmentId });
            return null;
        }
        // 安全：sourcePath 必须是用户最近通过 dialog:selectFile 主动选择的文件，
        // 防止渲染层被 XSS 后传入 ~/.ssh/id_rsa、/etc/passwd 等系统敏感文件被复制外泄
        if (!isRecentlySelectedFile(sourcePath)) {
            logger_1.logger.audit('security.path', 'saveAttachment rejected: sourcePath not in recent selection whitelist', { sourcePath });
            return null;
        }
        try {
            const materialsDir = node_path_1.default.join((0, shared_1.getDataDir)(), 'materials', projectId);
            await promises_1.default.mkdir(materialsDir, { recursive: true });
            const ext = node_path_1.default.extname(sourcePath);
            const destPath = node_path_1.default.join(materialsDir, `${attachmentId}${ext}`);
            // 二次防御：destPath 必须解析到 materialsDir 之内（isSafeIdentifier 已防 .. / / \，
            // 此处额外用前缀匹配兜底，覆盖未来代码改动引入的回归）
            const resolvedDest = node_path_1.default.resolve(destPath);
            const resolvedMaterialsDir = node_path_1.default.resolve(materialsDir);
            if (resolvedDest !== resolvedMaterialsDir && !resolvedDest.startsWith(resolvedMaterialsDir + node_path_1.default.sep)) {
                logger_1.logger.audit('security.path', 'saveAttachment rejected: destPath escapes materials dir', { destPath });
                return null;
            }
            // L-NEW-5 修复：realpath 校验 sourcePath，防止用户通过 dialog 选择了指向敏感文件
            // 的 symlink（如 evil.pdf -> ~/.ssh/id_rsa），copyFile 会跟随 symlink 复制敏感内容。
            const realSource = await promises_1.default.realpath(sourcePath).catch(() => null);
            if (!realSource) {
                logger_1.logger.audit('security.path', 'saveAttachment rejected: sourcePath realpath failed', { sourcePath });
                return null;
            }
            if (!isRecentlySelectedFile(realSource)) {
                logger_1.logger.audit('security.path', 'saveAttachment rejected: realpath of source not in recent selection', { sourcePath, realSource });
                return null;
            }
            await promises_1.default.copyFile(realSource, destPath);
            return destPath;
        }
        catch (e) {
            logger_1.logger.error('保存素材附件失败', e instanceof Error ? e : { error: String(e) });
            return null;
        }
    });
    // 素材附件删除：用户移除附件记录时，同步删除磁盘副本释放空间。
    // 安全：targetPath 必须解析到 userData/materials/ 子目录内，防止渲染层被 XSS 后
    // 传入任意路径删除系统文件（如 ~/.ssh/、/etc/）。路径校验用 realpath 解析符号链接。
    (0, shared_1.safeIpcHandle)('material:deleteAttachment', async (_event, targetPath) => {
        if (!targetPath || typeof targetPath !== 'string')
            return false;
        try {
            const materialsRoot = node_path_1.default.join((0, shared_1.getDataDir)(), 'materials');
            const resolved = await promises_1.default.realpath(targetPath).catch(() => null);
            if (!resolved)
                return false; // 文件已不存在视为删除成功无意义，返回 false 让调用方静默忽略
            const resolvedRoot = await promises_1.default.realpath(materialsRoot).catch(() => materialsRoot);
            const rel = node_path_1.default.relative(resolvedRoot, resolved);
            // relative 返回不以 '..' 开头且非绝对路径，才说明 resolved 在 materialsRoot 之内
            if (rel.startsWith('..') || node_path_1.default.isAbsolute(rel)) {
                logger_1.logger.audit('security.path', 'deleteAttachment rejected: targetPath escapes materials dir', { targetPath });
                return false;
            }
            await promises_1.default.unlink(resolved);
            return true;
        }
        catch (e) {
            logger_1.logger.error('删除素材附件失败', e instanceof Error ? e : { error: String(e) });
            return false;
        }
    });
    // 读取素材附件为 data URL，供 <img src> 直接渲染。
    // 开发环境（http/https）无法加载 file:// 资源，需通过 bridge 读取为 data URL。
    // 安全：路径必须位于 userData 目录内（素材附件持久化在 materials/<projectId>/），
    // 防止渲染层被 XSS 后读取系统敏感文件（如 ~/.ssh/id_rsa）。
    const MIME_BY_EXT = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    };
    (0, shared_1.safeIpcHandle)('file:readDataURL', async (_event, filePath) => {
        if (!filePath || typeof filePath !== 'string') {
            return Promise.reject(new Error('invalid filePath'));
        }
        if (!(0, security_1.isInsideDataDir)(filePath)) {
            logger_1.logger.audit('security.path', 'readDataURL rejected: path outside data dir', { filePath });
            return Promise.reject(new Error('path outside data dir'));
        }
        try {
            // realpath 校验：防止 symlink 绕过 lexical 检查读取 userData 目录外的文件
            if (!(await (0, security_1.assertRealPathInside)(filePath, [(0, shared_1.getDataDir)()]))) {
                logger_1.logger.audit('security.path', 'readDataURL rejected: realpath outside data dir (symlink?)', { filePath });
                return Promise.reject(new Error('realpath outside data dir'));
            }
            const resolved = node_path_1.default.resolve(filePath);
            // 体积校验：base64 编码后体积膨胀约 4/3，过大文件经 IPC 传输会撑爆消息通道
            // 10MB 上限足够任何合理的应用内图片资源；超出返回 null 让渲染层走降级路径
            const stat = await promises_1.default.stat(resolved);
            if (stat.size > 10 * 1024 * 1024) {
                logger_1.logger.audit('security.size', 'readDataURL rejected: file too large', { size: stat.size });
                return null;
            }
            const buffer = await promises_1.default.readFile(resolved);
            const ext = node_path_1.default.extname(resolved).slice(1).toLowerCase();
            const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
            return `data:${mime};base64,${buffer.toString('base64')}`;
        }
        catch (e) {
            logger_1.logger.error('readDataURL 失败', e instanceof Error ? e : { error: String(e) });
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}
