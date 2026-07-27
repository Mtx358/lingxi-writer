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
var backup_exports = {};
__export(backup_exports, {
  checkCrashRecovery: () => checkCrashRecovery,
  cleanupAllTmpSync: () => cleanupAllTmpSync,
  cleanupOldDatedBackups: () => cleanupOldDatedBackups,
  cleanupStaleTmpFiles: () => cleanupStaleTmpFiles,
  cleanupTmpSync: () => cleanupTmpSync,
  registerBackupHandlers: () => registerBackupHandlers,
  runAutoBackup: () => runAutoBackup,
  scanTmpFilesRecursive: () => scanTmpFilesRecursive,
  startAutoBackup: () => startAutoBackup,
  stopAutoBackup: () => stopAutoBackup
});
module.exports = __toCommonJS(backup_exports);
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_logger = require("../logger");
var import_shared = require("./shared");
let autoBackupTimer = null;
function startAutoBackup() {
  if (autoBackupTimer) return;
  autoBackupTimer = setInterval(() => {
    void runAutoBackup().catch((err) => import_logger.logger.error("Auto backup failed", err instanceof Error ? err : { error: String(err) }));
  }, 5 * 60 * 1e3);
  autoBackupTimer.unref?.();
}
function stopAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}
async function runAutoBackup() {
  const projectsDir = (0, import_shared.getProjectsDir)();
  const backupsDir = (0, import_shared.getBackupsDir)();
  try {
    await import_promises.default.access(projectsDir);
  } catch {
    return;
  }
  const entries = await import_promises.default.readdir(projectsDir, { withFileTypes: true });
  const projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (projectDirs.length === 0) return;
  await (0, import_shared.ensureDir)(backupsDir);
  const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const projectId of projectDirs) {
    const projectDir = import_node_path.default.join(projectsDir, projectId);
    const backupDir = import_node_path.default.join(backupsDir, projectId, dateStr);
    try {
      const exists = await import_promises.default.access(backupDir).then(() => true).catch(() => false);
      if (!exists) {
        await import_promises.default.cp(projectDir, backupDir, { recursive: true });
      }
    } catch (err) {
      import_logger.logger.warn("Backup failed for project", { projectId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await cleanupOldDatedBackups(7);
}
async function cleanupOldDatedBackups(days) {
  const backupsDir = (0, import_shared.getBackupsDir)();
  try {
    await import_promises.default.access(backupsDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
  const projectEntries = await import_promises.default.readdir(backupsDir, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectBackupDir = import_node_path.default.join(backupsDir, projectEntry.name);
    const dateEntries = await import_promises.default.readdir(projectBackupDir, { withFileTypes: true });
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) continue;
      const dateMatch = dateEntry.name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) continue;
      const backupDate = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
      if (backupDate < cutoff) {
        await import_promises.default.rm(import_node_path.default.join(projectBackupDir, dateEntry.name), { recursive: true, force: true }).catch(() => {
        });
      }
    }
  }
}
async function checkCrashRecovery() {
  const projectsDir = (0, import_shared.getProjectsDir)();
  const recovered = [];
  if (await (0, import_shared.pathExists)(projectsDir)) {
    const entries = await import_promises.default.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = import_node_path.default.join(projectsDir, entry.name);
      const mainFile = import_node_path.default.join(projectDir, "main.json");
      const tmpFile = import_node_path.default.join(projectDir, "main.json.tmp");
      try {
        const [mainStat, tmpStat] = await Promise.all([
          import_promises.default.stat(mainFile).catch(() => null),
          import_promises.default.stat(tmpFile).catch(() => null)
        ]);
        if (tmpStat && (!mainStat || tmpStat.mtimeMs > mainStat.mtimeMs)) {
          try {
            const tmpContent = await import_promises.default.readFile(tmpFile, "utf-8");
            JSON.parse(tmpContent);
            await import_promises.default.copyFile(tmpFile, mainFile);
            recovered.push(entry.name);
          } catch (parseErr) {
            import_logger.logger.warn("Crash recovery: tmp file corrupted, deleting instead of recovering", { tmpFile, error: parseErr instanceof Error ? parseErr.message : String(parseErr) });
            await import_promises.default.unlink(tmpFile).catch(() => {
            });
          }
        }
      } catch (err) {
        import_logger.logger.warn("Crash recovery check failed for project", { project: entry.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  await cleanupStaleTmpFiles().catch((err) => {
    import_logger.logger.warn("Crash recovery: cleanup stale tmp files failed", { error: err instanceof Error ? err.message : String(err) });
  });
  return { recovered: recovered.length > 0, projects: recovered };
}
async function cleanupStaleTmpFiles() {
  const TMP_STALE_AGE_MS = 60 * 60 * 1e3;
  const roots = [(0, import_shared.getDataDir)(), (0, import_shared.getProjectsDir)()];
  for (const root of roots) {
    await scanTmpFilesRecursive(root, TMP_STALE_AGE_MS).catch((err) => {
      import_logger.logger.warn("Crash recovery: scan root failed", { root, error: err instanceof Error ? err.message : String(err) });
    });
  }
}
async function scanTmpFilesRecursive(dir, staleAgeMs) {
  const entries = await import_promises.default.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  const now = Date.now();
  for (const entry of entries) {
    const fullPath = import_node_path.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanTmpFilesRecursive(fullPath, staleAgeMs);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".tmp")) continue;
    try {
      const stat = await import_promises.default.stat(fullPath);
      if (now - stat.mtimeMs < staleAgeMs) continue;
      let looksValid = false;
      try {
        const content = await import_promises.default.readFile(fullPath, "utf-8");
        JSON.parse(content);
        looksValid = true;
      } catch {
        looksValid = false;
      }
      if (looksValid) {
        import_logger.logger.warn("Crash recovery: removing stale tmp (valid JSON, main file intact)", { fullPath });
      } else {
        import_logger.logger.warn("Crash recovery: removing stale tmp (corrupted)", { fullPath });
      }
      await import_promises.default.unlink(fullPath).catch(() => {
      });
    } catch (err) {
      import_logger.logger.warn("Crash recovery: stat/unlink tmp failed", { fullPath, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
function cleanupAllTmpSync() {
  const roots = [(0, import_shared.getDataDir)(), (0, import_shared.getProjectsDir)()];
  for (const root of roots) {
    try {
      cleanupTmpSync(root);
    } catch (e) {
      import_logger.logger.warn("Quit cleanup: tmp failed", { root, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
function cleanupTmpSync(dir, depth = 0) {
  if (depth > 3) return;
  let entries;
  try {
    entries = import_node_fs.default.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.length > 1e4) {
    import_logger.logger.warn?.(`cleanupTmpSync: dir ${dir} has ${entries.length} entries, skipping`);
    return;
  }
  for (const entry of entries) {
    const fullPath = import_node_path.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanupTmpSync(fullPath, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".tmp")) {
      try {
        import_node_fs.default.unlinkSync(fullPath);
      } catch {
      }
    }
  }
}
function registerBackupHandlers() {
  (0, import_shared.safeIpcHandle)("system:checkCrashRecovery", async () => {
    try {
      return await checkCrashRecovery();
    } catch (e) {
      import_logger.logger.error("checkCrashRecovery error", e instanceof Error ? e : { error: String(e) });
      return { recovered: false, projects: [] };
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkCrashRecovery,
  cleanupAllTmpSync,
  cleanupOldDatedBackups,
  cleanupStaleTmpFiles,
  cleanupTmpSync,
  registerBackupHandlers,
  runAutoBackup,
  scanTmpFilesRecursive,
  startAutoBackup,
  stopAutoBackup
});
