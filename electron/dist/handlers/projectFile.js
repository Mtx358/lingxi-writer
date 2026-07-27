"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var projectFile_exports = {};
__export(projectFile_exports, {
  cleanupOldBackups: () => cleanupOldBackups,
  registerProjectFileHandlers: () => registerProjectFileHandlers
});
module.exports = __toCommonJS(projectFile_exports);
var import_electron = require("electron");
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_node_crypto = require("node:crypto");
var import_jszip = __toESM(require("jszip"), 1);
var import_logger = require("../logger");
var import_shared = require("./shared");
var import_security = require("./security");
var import_projectFile = require("./projectFile.logic");
function registerProjectFileHandlers() {
  (0, import_shared.safeIpcHandle)("projectFile:read", async (_event, filePath) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:read",
        filePath,
        import_security.isSafeProjectFilePath,
        (0, import_security.getAllowedProjectFileRoots)(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, error: pathCheck.error };
      const buffer = await import_promises.default.readFile(filePath);
      try {
        const data = await (0, import_projectFile.parseProjectFileFromBuffer)(buffer);
        return { success: true, data };
      } catch (e) {
        if (e instanceof import_projectFile.ProjectFileValidationError) {
          if (e.kind === "compressed-too-large") {
            import_logger.logger.audit("security.size", "projectFile:read rejected: file too large", { size: e.context.size });
          } else if (e.kind === "uncompressed-too-large") {
            import_logger.logger.audit("security.size", "projectFile:read rejected: uncompressed size exceeds 500MB", { total: e.context.total });
          } else if (e.kind === "too-many-versions") {
            import_logger.logger.audit("security.size", "projectFile:read rejected: too many version entries", { count: e.context.count });
          }
          return { success: false, error: e.message };
        }
        import_logger.logger.error("projectFile:read error", e instanceof Error ? e : { error: String(e) });
        return { success: false, error: "\u8BFB\u53D6\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F\u6216\u6743\u9650" };
      }
    } catch (e) {
      import_logger.logger.error("projectFile:read error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u8BFB\u53D6\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F\u6216\u6743\u9650" };
    }
  });
  (0, import_shared.safeIpcHandle)("projectFile:write", async (_event, filePath, data) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:write",
        filePath,
        import_security.isSafeProjectFilePath,
        (0, import_security.getAllowedProjectFileRoots)(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, error: pathCheck.error };
      return await (0, import_shared.withWriteMutex)(filePath, async () => {
        if (!(0, import_security.isValidProjectFileData)(data)) {
          import_logger.logger.audit("security.schema", "projectFile:write rejected: invalid data shape", { filePath });
          return { success: false, error: "\u5DE5\u7A0B\u6587\u4EF6\u6570\u636E\u5F62\u72B6\u65E0\u6548\uFF08project \u5FC5\u987B\u662F\u5BF9\u8C61\uFF0C6 \u4E2A\u96C6\u5408\u5FC5\u987B\u662F\u6570\u7EC4\uFF09" };
        }
        await (0, import_shared.ensureDir)(filePath);
        const tempPath = `${filePath}.${(0, import_node_crypto.randomUUID)()}.tmp`;
        const backupPath = `${filePath}.${(0, import_node_crypto.randomUUID)()}.bak`;
        const buffer = await (0, import_projectFile.generateProjectFileBuffer)(data);
        if (await (0, import_shared.pathExists)(filePath)) {
          await import_promises.default.copyFile(filePath, backupPath);
        }
        try {
          await import_promises.default.writeFile(tempPath, buffer);
          const tempStats = await import_promises.default.stat(tempPath);
          if (tempStats.size < 10) {
            return { success: false, error: "\u751F\u6210\u7684\u6587\u4EF6\u8FC7\u5C0F\uFF0C\u53EF\u80FD\u5DF2\u635F\u574F" };
          }
          await import_promises.default.rename(tempPath, filePath);
          await import_promises.default.unlink(backupPath).catch(() => {
          });
          await cleanupOldBackups(filePath);
          return { success: true };
        } finally {
          await import_promises.default.unlink(tempPath).catch(() => {
          });
          await import_promises.default.unlink(backupPath).catch(() => {
          });
        }
      });
    } catch (e) {
      import_logger.logger.error("projectFile:write error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u5199\u5165\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4" };
    }
  });
  (0, import_shared.safeIpcHandle)("projectFile:validate", async (_event, filePath) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:validate",
        filePath,
        import_security.isSafeProjectFilePath,
        (0, import_security.getAllowedProjectFileRoots)(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { valid: false, error: pathCheck.error };
      const buffer = await import_promises.default.readFile(filePath);
      const zip = await import_jszip.default.loadAsync(buffer);
      const requiredFiles = ["metadata.json", "project.json", "chapters.json"];
      for (const file of requiredFiles) {
        if (!zip.file(file)) {
          return { valid: false, error: `\u7F3A\u5C11\u5FC5\u8981\u6587\u4EF6: ${file}` };
        }
      }
      const metadataStr = await zip.file("metadata.json")?.async("string");
      if (!metadataStr) {
        return { valid: false, error: "\u65E0\u6548\u7684\u5143\u6570\u636E" };
      }
      const metadata = JSON.parse(metadataStr);
      if (metadata.version !== import_shared.FILE_VERSION) {
        return { valid: false, error: `\u7248\u672C\u4E0D\u517C\u5BB9` };
      }
      return { valid: true };
    } catch (e) {
      import_logger.logger.error("projectFile:validate error", e instanceof Error ? e : { error: String(e) });
      return { valid: false, error: "\u6587\u4EF6\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F\u6216\u6743\u9650" };
    }
  });
  (0, import_shared.safeIpcHandle)("projectFile:backup", async (_event, filePath, keepCount = 5) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:backup",
        filePath,
        import_security.isSafeProjectFilePath,
        (0, import_security.getAllowedProjectFileRoots)(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, error: pathCheck.error };
      const backupsDir = import_node_path.default.join((0, import_shared.getBackupsDir)(), import_node_path.default.basename(filePath));
      await (0, import_shared.ensureDir)(backupsDir);
      const ts = (0, import_projectFile.formatBackupTimestamp)();
      const backupPath = import_node_path.default.join(backupsDir, `${ts}.cwp`);
      await import_promises.default.copyFile(filePath, backupPath);
      const backups = (await import_promises.default.readdir(backupsDir)).sort().reverse();
      for (const old of backups.slice(keepCount)) {
        await import_promises.default.rm(import_node_path.default.join(backupsDir, old), { force: true });
      }
      return { success: true };
    } catch (e) {
      import_logger.logger.error("projectFile:backup error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u5907\u4EFD\u5DE5\u7A0B\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4" };
    }
  });
  (0, import_shared.safeIpcHandle)("projectFile:listBackups", async (_event, filePath) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:listBackups",
        filePath,
        import_security.isSafeProjectFilePath,
        (0, import_security.getAllowedProjectFileRoots)(),
        { invalidError: "\u975E\u6CD5\u7684\u5DE5\u7A0B\u6587\u4EF6\u8DEF\u5F84" }
      );
      if (!pathCheck.ok) return { success: false, backups: [] };
      const backupsDir = import_node_path.default.join((0, import_shared.getBackupsDir)(), import_node_path.default.basename(filePath));
      if (!await (0, import_shared.pathExists)(backupsDir)) return { success: true, backups: [] };
      const backups = (await import_promises.default.readdir(backupsDir)).sort().reverse();
      return {
        success: true,
        backups: backups.map((name) => ({
          name,
          path: import_node_path.default.join(backupsDir, name),
          timestamp: name.replace(".cwp", "")
        }))
      };
    } catch (e) {
      import_logger.logger.error("projectFile:listBackups error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u5217\u51FA\u5907\u4EFD\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650" };
    }
  });
  (0, import_shared.safeIpcHandle)("projectFile:restoreBackup", async (_event, backupPath, targetPath) => {
    try {
      const backupCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:restoreBackup",
        backupPath,
        import_security.isSafeBackupPath,
        [(0, import_shared.getBackupsDir)()],
        { invalidError: "\u975E\u6CD5\u7684\u5907\u4EFD\u8DEF\u5F84" }
      );
      if (!backupCheck.ok) return { success: false, error: backupCheck.error };
      const targetCheck = await (0, import_shared.validatePathAndAudit)(
        "projectFile:restoreBackup",
        targetPath,
        import_security.isSafeProjectFilePath,
        (0, import_security.getAllowedProjectFileRoots)(),
        { invalidError: "\u975E\u6CD5\u7684\u76EE\u6807\u8DEF\u5F84" }
      );
      if (!targetCheck.ok) return { success: false, error: targetCheck.error };
      await import_promises.default.copyFile(backupPath, targetPath);
      return { success: true };
    } catch (e) {
      import_logger.logger.error("projectFile:restoreBackup error", e instanceof Error ? e : { error: String(e) });
      return { success: false, error: "\u6062\u590D\u5907\u4EFD\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4" };
    }
  });
  (0, import_shared.safeIpcHandle)("projectFile:openDialog", async () => {
    const mainWindow = (0, import_shared.getMainWindow)();
    if (!mainWindow) return null;
    const result = await import_electron.dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "\u6253\u5F00\u5DE5\u7A0B\u6587\u4EF6",
      filters: [{ name: "\u7075\u7280\u5199\u4F5C\u52A9\u624B\u5DE5\u7A0B", extensions: ["cwp"] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  (0, import_shared.safeIpcHandle)("projectFile:saveDialog", async (_event, defaultName) => {
    const mainWindow = (0, import_shared.getMainWindow)();
    if (!mainWindow) return null;
    const result = await import_electron.dialog.showSaveDialog(mainWindow, {
      title: "\u4FDD\u5B58\u5DE5\u7A0B\u6587\u4EF6",
      defaultPath: defaultName,
      filters: [{ name: "\u7075\u7280\u5199\u4F5C\u52A9\u624B\u5DE5\u7A0B", extensions: ["cwp"] }]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
}
async function cleanupOldBackups(filePath, keepCount = 5) {
  const backupsDir = import_node_path.default.join((0, import_shared.getBackupsDir)(), import_node_path.default.basename(filePath));
  if (!await (0, import_shared.pathExists)(backupsDir)) return;
  const backups = (await import_promises.default.readdir(backupsDir)).sort().reverse();
  for (const old of backups.slice(keepCount)) {
    await import_promises.default.rm(import_node_path.default.join(backupsDir, old), { force: true }).catch(() => {
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cleanupOldBackups,
  registerProjectFileHandlers
});
