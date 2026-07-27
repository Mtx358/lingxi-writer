"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var storage_exports = {};
__export(storage_exports, {
  ALLOWED_OPEN_EXTERNAL_EXTS: () => import_storage.ALLOWED_OPEN_EXTERNAL_EXTS,
  ALLOWED_PROJECT_SUBKEYS: () => import_storage.ALLOWED_PROJECT_SUBKEYS,
  FORBIDDEN_OPEN_EXTERNAL_EXTS: () => import_storage.FORBIDDEN_OPEN_EXTERNAL_EXTS,
  RECENT_SELECTED_FILES_TTL_MS: () => import_storage.RECENT_SELECTED_FILES_TTL_MS,
  getRecentlySelectedFilesRealPaths: () => import_storage.getRecentlySelectedFilesRealPaths,
  isRecentlySelectedFile: () => import_storage.isRecentlySelectedFile,
  registerStorageHandlers: () => import_storage.registerStorageHandlers,
  rememberSelectedFile: () => import_storage.rememberSelectedFile,
  resolveDirPath: () => import_storage.resolveDirPath,
  resolveFilePath: () => import_storage.resolveFilePath
});
module.exports = __toCommonJS(storage_exports);
var import_storage = require("./storage/index");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALLOWED_OPEN_EXTERNAL_EXTS,
  ALLOWED_PROJECT_SUBKEYS,
  FORBIDDEN_OPEN_EXTERNAL_EXTS,
  RECENT_SELECTED_FILES_TTL_MS,
  getRecentlySelectedFilesRealPaths,
  isRecentlySelectedFile,
  registerStorageHandlers,
  rememberSelectedFile,
  resolveDirPath,
  resolveFilePath
});
