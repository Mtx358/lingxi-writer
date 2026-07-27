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
var exportFile_logic_exports = {};
__export(exportFile_logic_exports, {
  buildExportWriteOptions: () => buildExportWriteOptions,
  decodeBase64ToBuffer: () => decodeBase64ToBuffer,
  getExportFileExtension: () => getExportFileExtension,
  isAllowedExportExtension: () => isAllowedExportExtension,
  normalizeExportEncoding: () => normalizeExportEncoding
});
module.exports = __toCommonJS(exportFile_logic_exports);
var import_node_path = __toESM(require("node:path"), 1);
function getExportFileExtension(filePath) {
  return import_node_path.default.extname(filePath).slice(1).toLowerCase();
}
function isAllowedExportExtension(ext, allowedExtensions) {
  if (!ext) return false;
  return allowedExtensions.has(`.${ext}`);
}
function normalizeExportEncoding(encoding) {
  if (typeof encoding !== "string" || !encoding) return "utf-8";
  return encoding;
}
function buildExportWriteOptions(encoding) {
  return { encoding: normalizeExportEncoding(encoding) };
}
function decodeBase64ToBuffer(base64Data) {
  return Buffer.from(base64Data, "base64");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildExportWriteOptions,
  decodeBase64ToBuffer,
  getExportFileExtension,
  isAllowedExportExtension,
  normalizeExportEncoding
});
