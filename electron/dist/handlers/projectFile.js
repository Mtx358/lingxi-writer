"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProjectFileHandlers = registerProjectFileHandlers;
exports.cleanupOldBackups = cleanupOldBackups;
// 工程文件（.cwp）读写、校验、备份、恢复 IPC handler。
// 依赖 ./shared、./security、../logger、jszip，不依赖其他 handler。
// 业务主体逻辑（zip 解析/校验/生成）已抽离到 ./projectFile.logic，便于单元测试。
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_crypto_1 = require("node:crypto");
const jszip_1 = __importDefault(require("jszip"));
const logger_1 = require("../logger");
const shared_1 = require("./shared");
const security_1 = require("./security");
const projectFile_logic_1 = require("./projectFile.logic");
function registerProjectFileHandlers() {
    (0, shared_1.safeIpcHandle)('projectFile:read', async (_event, filePath) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('projectFile:read', filePath, security_1.isSafeProjectFilePath, (0, security_1.getAllowedProjectFileRoots)(), { invalidError: '非法的工程文件路径' });
            if (!pathCheck.ok)
                return { success: false, error: pathCheck.error };
            const buffer = await promises_1.default.readFile(filePath);
            // 解压 + JSON 解析 + schema 校验 + zip bomb 检测：抽离为 parseProjectFileFromBuffer 纯函数
            // 便于单元测试覆盖（handler 主体逻辑此前因 app.whenReady 永不 resolve 而无测试）
            try {
                const data = await (0, projectFile_logic_1.parseProjectFileFromBuffer)(buffer);
                return { success: true, data };
            }
            catch (e) {
                if (e instanceof projectFile_logic_1.ProjectFileValidationError) {
                    // 与原内联校验行为一致：size 类校验写 audit 日志，schema 类校验仅返回错误
                    if (e.kind === 'compressed-too-large') {
                        logger_1.logger.audit('security.size', 'projectFile:read rejected: file too large', { size: e.context.size });
                    }
                    else if (e.kind === 'uncompressed-too-large') {
                        logger_1.logger.audit('security.size', 'projectFile:read rejected: uncompressed size exceeds 500MB', { total: e.context.total });
                    }
                    else if (e.kind === 'too-many-versions') {
                        logger_1.logger.audit('security.size', 'projectFile:read rejected: too many version entries', { count: e.context.count });
                    }
                    return { success: false, error: e.message };
                }
                // 非 ProjectFileValidationError（JSZip / JSON.parse 失败等）：返回通用错误，不暴露 e.message
                // 不回传 e.message：Node fs 错误消息含完整绝对路径，泄漏给渲染层可被用于枚举文件系统
                logger_1.logger.error('projectFile:read error', e instanceof Error ? e : { error: String(e) });
                return { success: false, error: '读取工程文件失败，请检查文件是否损坏或权限' };
            }
        }
        catch (e) {
            logger_1.logger.error('projectFile:read error', e instanceof Error ? e : { error: String(e) });
            // 不回传 e.message：Node fs 错误消息含完整绝对路径，泄漏给渲染层可被用于枚举文件系统
            return { success: false, error: '读取工程文件失败，请检查文件是否损坏或权限' };
        }
    });
    (0, shared_1.safeIpcHandle)('projectFile:write', async (_event, filePath, data) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('projectFile:write', filePath, security_1.isSafeProjectFilePath, (0, security_1.getAllowedProjectFileRoots)(), { invalidError: '非法的工程文件路径' });
            if (!pathCheck.ok)
                return { success: false, error: pathCheck.error };
            // 串行化同一 filePath 的并发写入：避免 A/B 并发时 tmp/bak 互相覆盖，
            // 导致 A 收到成功但数据丢失、B 收到失败但数据实际落盘的不一致问题
            return await (0, shared_1.withWriteMutex)(filePath, async () => {
                // 形状校验：防止渲染层被 XSS 后传入畸形 data（如 chapters 为 string/null）写入
                // 工程文件，下次打开时 projectFile:read 的形状校验会拒绝，等于让用户损失数据。
                // 在写入前拦截可避免这种"写入成功但下次读不出来"的隐性数据丢失。
                if (!(0, security_1.isValidProjectFileData)(data)) {
                    logger_1.logger.audit('security.schema', 'projectFile:write rejected: invalid data shape', { filePath });
                    return { success: false, error: '工程文件数据形状无效（project 必须是对象，6 个集合必须是数组）' };
                }
                await (0, shared_1.ensureDir)(filePath);
                // 临时文件名包含 UUID：并发写入同一 filePath 时各自生成独立 tmp/bak，
                // 不会互相覆盖；mutex 串行化进一步保证 rename 顺序与返回值一致
                const tempPath = `${filePath}.${(0, node_crypto_1.randomUUID)()}.tmp`;
                const backupPath = `${filePath}.${(0, node_crypto_1.randomUUID)()}.bak`;
                // zip 生成：抽离为 generateProjectFileBuffer 纯函数便于单元测试
                const buffer = await (0, projectFile_logic_1.generateProjectFileBuffer)(data);
                if (await (0, shared_1.pathExists)(filePath)) {
                    await promises_1.default.copyFile(filePath, backupPath);
                }
                try {
                    await promises_1.default.writeFile(tempPath, buffer);
                    const tempStats = await promises_1.default.stat(tempPath);
                    if (tempStats.size < 10) {
                        return { success: false, error: '生成的文件过小，可能已损坏' };
                    }
                    await promises_1.default.rename(tempPath, filePath);
                    await promises_1.default.unlink(backupPath).catch(() => { });
                    await cleanupOldBackups(filePath);
                    return { success: true };
                }
                finally {
                    // 异常路径清理 tmp 与 bak（P49-a）：rename/writeFile 抛错时主文件仍是上次
                    // 成功写入的完整版本，删除残留 tmp/bak 避免长期累积；成功路径下 tmp/bak
                    // 已不存在（tmp 已 rename、bak 已 unlink），unlink 忽略 ENOENT
                    await promises_1.default.unlink(tempPath).catch(() => { });
                    await promises_1.default.unlink(backupPath).catch(() => { });
                }
            });
        }
        catch (e) {
            logger_1.logger.error('projectFile:write error', e instanceof Error ? e : { error: String(e) });
            // 不回传 e.message：含绝对路径，可被用于文件系统枚举
            return { success: false, error: '写入工程文件失败，请检查路径权限或磁盘空间' };
        }
    });
    (0, shared_1.safeIpcHandle)('projectFile:validate', async (_event, filePath) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('projectFile:validate', filePath, security_1.isSafeProjectFilePath, (0, security_1.getAllowedProjectFileRoots)(), { invalidError: '非法的工程文件路径' });
            if (!pathCheck.ok)
                return { valid: false, error: pathCheck.error };
            const buffer = await promises_1.default.readFile(filePath);
            const zip = await jszip_1.default.loadAsync(buffer);
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
            if (metadata.version !== shared_1.FILE_VERSION) {
                return { valid: false, error: `版本不兼容` };
            }
            return { valid: true };
        }
        catch (e) {
            // 不回传 e.message：与其他 projectFile handler 一致，Node fs 错误含绝对路径，
            // 渲染层被 XSS 后可利用此通道枚举文件系统结构。原始错误仅落盘日志。
            logger_1.logger.error('projectFile:validate error', e instanceof Error ? e : { error: String(e) });
            return { valid: false, error: '文件校验失败，请检查文件是否损坏或权限' };
        }
    });
    (0, shared_1.safeIpcHandle)('projectFile:backup', async (_event, filePath, keepCount = 5) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('projectFile:backup', filePath, security_1.isSafeProjectFilePath, (0, security_1.getAllowedProjectFileRoots)(), { invalidError: '非法的工程文件路径' });
            if (!pathCheck.ok)
                return { success: false, error: pathCheck.error };
            const backupsDir = node_path_1.default.join((0, shared_1.getBackupsDir)(), node_path_1.default.basename(filePath));
            await (0, shared_1.ensureDir)(backupsDir);
            // 备份文件名时间戳生成：抽离为 formatBackupTimestamp 纯函数便于单元测试
            const ts = (0, projectFile_logic_1.formatBackupTimestamp)();
            const backupPath = node_path_1.default.join(backupsDir, `${ts}.cwp`);
            await promises_1.default.copyFile(filePath, backupPath);
            const backups = (await promises_1.default.readdir(backupsDir)).sort().reverse();
            for (const old of backups.slice(keepCount)) {
                await promises_1.default.rm(node_path_1.default.join(backupsDir, old), { force: true });
            }
            return { success: true };
        }
        catch (e) {
            logger_1.logger.error('projectFile:backup error', e instanceof Error ? e : { error: String(e) });
            // 不回传 e.message：含绝对路径
            return { success: false, error: '备份工程文件失败，请检查路径权限或磁盘空间' };
        }
    });
    (0, shared_1.safeIpcHandle)('projectFile:listBackups', async (_event, filePath) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('projectFile:listBackups', filePath, security_1.isSafeProjectFilePath, (0, security_1.getAllowedProjectFileRoots)(), { invalidError: '非法的工程文件路径' });
            if (!pathCheck.ok)
                return { success: false, backups: [] };
            const backupsDir = node_path_1.default.join((0, shared_1.getBackupsDir)(), node_path_1.default.basename(filePath));
            if (!(await (0, shared_1.pathExists)(backupsDir)))
                return { success: true, backups: [] };
            const backups = (await promises_1.default.readdir(backupsDir)).sort().reverse();
            return {
                success: true,
                backups: backups.map(name => ({
                    name,
                    path: node_path_1.default.join(backupsDir, name),
                    timestamp: name.replace('.cwp', ''),
                })),
            };
        }
        catch (e) {
            // 不回传 e.message：含绝对路径；此处也补 logger.error 便于主进程日志定位
            logger_1.logger.error('projectFile:listBackups error', e instanceof Error ? e : { error: String(e) });
            return { success: false, error: '列出备份失败，请检查路径权限' };
        }
    });
    (0, shared_1.safeIpcHandle)('projectFile:restoreBackup', async (_event, backupPath, targetPath) => {
        try {
            // backupPath 与 targetPath 用不同 validator + roots 分别校验：
            // backupPath 必须在 backups 目录内，targetPath 必须在工程文件白名单根目录内
            const backupCheck = await (0, shared_1.validatePathAndAudit)('projectFile:restoreBackup', backupPath, security_1.isSafeBackupPath, [(0, shared_1.getBackupsDir)()], { invalidError: '非法的备份路径' });
            if (!backupCheck.ok)
                return { success: false, error: backupCheck.error };
            const targetCheck = await (0, shared_1.validatePathAndAudit)('projectFile:restoreBackup', targetPath, security_1.isSafeProjectFilePath, (0, security_1.getAllowedProjectFileRoots)(), { invalidError: '非法的目标路径' });
            if (!targetCheck.ok)
                return { success: false, error: targetCheck.error };
            await promises_1.default.copyFile(backupPath, targetPath);
            return { success: true };
        }
        catch (e) {
            // 不回传 e.message：含绝对路径；补 logger.error 便于主进程日志定位
            logger_1.logger.error('projectFile:restoreBackup error', e instanceof Error ? e : { error: String(e) });
            return { success: false, error: '恢复备份失败，请检查路径权限或磁盘空间' };
        }
    });
    (0, shared_1.safeIpcHandle)('projectFile:openDialog', async () => {
        const mainWindow = (0, shared_1.getMainWindow)();
        if (!mainWindow)
            return null;
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            title: '打开工程文件',
            filters: [{ name: '灵犀写作助手工程', extensions: ['cwp'] }],
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        return result.filePaths[0];
    });
    (0, shared_1.safeIpcHandle)('projectFile:saveDialog', async (_event, defaultName) => {
        const mainWindow = (0, shared_1.getMainWindow)();
        if (!mainWindow)
            return null;
        const result = await electron_1.dialog.showSaveDialog(mainWindow, {
            title: '保存工程文件',
            defaultPath: defaultName,
            filters: [{ name: '灵犀写作助手工程', extensions: ['cwp'] }],
        });
        if (result.canceled || !result.filePath)
            return null;
        return result.filePath;
    });
}
async function cleanupOldBackups(filePath, keepCount = 5) {
    const backupsDir = node_path_1.default.join((0, shared_1.getBackupsDir)(), node_path_1.default.basename(filePath));
    if (!(await (0, shared_1.pathExists)(backupsDir)))
        return;
    const backups = (await promises_1.default.readdir(backupsDir)).sort().reverse();
    // keepCount 参数化：原先硬编码 slice(5)，与 projectFile:backup IPC 的 keepCount 入参
    // 不一致。虽当前调用方都用 5，参数化后便于后续按用户配置调整保留份数
    for (const old of backups.slice(keepCount)) {
        await promises_1.default.rm(node_path_1.default.join(backupsDir, old), { force: true }).catch(() => { });
    }
}
