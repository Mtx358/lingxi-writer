"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExportFileHandlers = registerExportFileHandlers;
// 导出文件专用 IPC：导出路径与内部数据路径分离。
// 依赖 ./shared（safeIpcHandle）、./security（路径校验）、../logger，不依赖其他 handler。
// 编码归一化与 base64 解码已抽离到 ./exportFile.logic，便于单元测试。
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const logger_1 = require("../logger");
const shared_1 = require("./shared");
const security_1 = require("./security");
const exportFile_logic_1 = require("./exportFile.logic");
// 问题背景：原导出流程复用 storage:writeFileBuffer（仅允许 userData 内路径），
// 但用户通过 dialog:saveFile 选择的路径通常在 Documents/Desktop/Downloads，
// 导致 isInsideDataDir 校验失败、文件静默未写入、渲染层未检查返回值误报"已导出"。
//
// 修复方案：新增 export:writeFile / export:writeFileBuffer 专用通道，
// 路径白名单为用户可访问目录（home/Documents/Desktop/Downloads/userData），
// 扩展名白名单为已知导出格式（.txt/.md/.html/.docx/.pdf/.epub），
// 防止 XSS 后通过此通道写入可执行文件或系统目录。
// 原 storage:writeFile / storage:writeFileBuffer 保持严格 userData 限制，供内部数据使用
function registerExportFileHandlers() {
    (0, shared_1.safeIpcHandle)('export:writeFile', async (_event, filePath, data, encoding) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('export:writeFile', filePath, security_1.isSafeExportFilePath, (0, security_1.getAllowedProjectFileRoots)());
            if (!pathCheck.ok)
                return false;
            const resolved = node_path_1.default.resolve(filePath);
            // 编码归一化：抽离为 buildExportWriteOptions 纯函数便于单元测试
            await promises_1.default.writeFile(resolved, data, (0, exportFile_logic_1.buildExportWriteOptions)(encoding));
            return true;
        }
        catch (e) {
            logger_1.logger.error('export:writeFile failed', { error: e.message });
            return false;
        }
    });
    (0, shared_1.safeIpcHandle)('export:writeFileBuffer', async (_event, filePath, base64Data) => {
        try {
            const pathCheck = await (0, shared_1.validatePathAndAudit)('export:writeFileBuffer', filePath, security_1.isSafeExportFilePath, (0, security_1.getAllowedProjectFileRoots)());
            if (!pathCheck.ok)
                return false;
            const resolved = node_path_1.default.resolve(filePath);
            // base64 解码：抽离为 decodeBase64ToBuffer 纯函数便于单元测试
            await promises_1.default.writeFile(resolved, (0, exportFile_logic_1.decodeBase64ToBuffer)(base64Data));
            return true;
        }
        catch (e) {
            logger_1.logger.error('export:writeFileBuffer failed', { error: e.message });
            return false;
        }
    });
}
