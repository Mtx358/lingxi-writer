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
var exportFile_exports = {};
__export(exportFile_exports, {
  registerExportFileHandlers: () => registerExportFileHandlers
});
module.exports = __toCommonJS(exportFile_exports);
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_logger = require("../logger");
var import_shared = require("./shared");
var import_security = require("./security");
var import_exportFile = require("./exportFile.logic");
function registerExportFileHandlers() {
  (0, import_shared.safeIpcHandle)("export:writeFile", async (_event, filePath, data, encoding) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "export:writeFile",
        filePath,
        import_security.isSafeExportFilePath,
        (0, import_security.getAllowedProjectFileRoots)()
      );
      if (!pathCheck.ok) return false;
      const resolved = import_node_path.default.resolve(filePath);
      await import_promises.default.writeFile(resolved, data, (0, import_exportFile.buildExportWriteOptions)(encoding));
      return true;
    } catch (e) {
      import_logger.logger.error("export:writeFile failed", { error: e.message });
      return false;
    }
  });
  (0, import_shared.safeIpcHandle)("export:writeFileBuffer", async (_event, filePath, base64Data) => {
    try {
      const pathCheck = await (0, import_shared.validatePathAndAudit)(
        "export:writeFileBuffer",
        filePath,
        import_security.isSafeExportFilePath,
        (0, import_security.getAllowedProjectFileRoots)()
      );
      if (!pathCheck.ok) return false;
      const resolved = import_node_path.default.resolve(filePath);
      await import_promises.default.writeFile(resolved, (0, import_exportFile.decodeBase64ToBuffer)(base64Data));
      return true;
    } catch (e) {
      import_logger.logger.error("export:writeFileBuffer failed", { error: e.message });
      return false;
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  registerExportFileHandlers
});
