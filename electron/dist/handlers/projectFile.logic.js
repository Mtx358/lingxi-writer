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
var projectFile_logic_exports = {};
__export(projectFile_logic_exports, {
  FILE_VERSION: () => FILE_VERSION,
  MAX_COMPRESSED_SIZE: () => MAX_COMPRESSED_SIZE,
  MAX_UNCOMPRESSED_SIZE: () => MAX_UNCOMPRESSED_SIZE,
  MAX_VERSION_ENTRIES: () => MAX_VERSION_ENTRIES,
  ProjectFileValidationError: () => ProjectFileValidationError,
  formatBackupTimestamp: () => formatBackupTimestamp,
  generateBackupFileName: () => generateBackupFileName,
  generateProjectFileBuffer: () => generateProjectFileBuffer,
  parseProjectFileFromBuffer: () => parseProjectFileFromBuffer
});
module.exports = __toCommonJS(projectFile_logic_exports);
var import_node_crypto = require("node:crypto");
var import_jszip = __toESM(require("jszip"), 1);
const FILE_VERSION = "1.0.0";
const MAX_COMPRESSED_SIZE = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024;
const MAX_VERSION_ENTRIES = 1e3;
class ProjectFileValidationError extends Error {
  kind;
  context;
  constructor(kind, message, context = {}) {
    super(message);
    this.name = "ProjectFileValidationError";
    this.kind = kind;
    this.context = context;
  }
}
function generateChecksum(data) {
  return (0, import_node_crypto.createHash)("sha256").update(data, "utf-8").digest("hex");
}
async function parseProjectFileFromBuffer(buffer) {
  if (buffer.length > MAX_COMPRESSED_SIZE) {
    throw new ProjectFileValidationError(
      "compressed-too-large",
      "\u5DE5\u7A0B\u6587\u4EF6\u8FC7\u5927\uFF08\u8D85\u8FC7 100MB\uFF09\uFF0C\u53EF\u80FD\u635F\u574F\u6216\u4E3A\u538B\u7F29\u70B8\u5F39",
      { size: buffer.length }
    );
  }
  const zip = await import_jszip.default.loadAsync(buffer);
  let totalUncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    const uncompressed = entry._data?.uncompressedSize;
    if (typeof uncompressed === "number") {
      totalUncompressed += uncompressed;
      if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
        throw new ProjectFileValidationError(
          "uncompressed-too-large",
          "\u5DE5\u7A0B\u6587\u4EF6\u89E3\u538B\u540E\u4F53\u79EF\u8FC7\u5927\uFF08\u8D85\u8FC7 500MB\uFF09\uFF0C\u53EF\u80FD\u4E3A\u538B\u7F29\u70B8\u5F39",
          { total: totalUncompressed }
        );
      }
    }
  }
  const metadataStr = await zip.file("metadata.json")?.async("string");
  if (!metadataStr) {
    throw new ProjectFileValidationError("missing-metadata", "\u7F3A\u5C11\u5143\u6570\u636E\u6587\u4EF6");
  }
  const metadata = JSON.parse(metadataStr);
  if (metadata.version !== FILE_VERSION) {
    throw new ProjectFileValidationError(
      "incompatible-version",
      `\u4E0D\u517C\u5BB9\u7684\u6587\u4EF6\u7248\u672C: ${metadata.version}`
    );
  }
  const readJson = async (filename) => {
    const file = zip.file(filename);
    if (!file) return null;
    const content = await file.async("string");
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  };
  const data = {
    metadata,
    project: await readJson("project.json"),
    chapters: await readJson("chapters.json") || [],
    characters: await readJson("characters.json") || [],
    settingCategories: await readJson("settingCategories.json") || [],
    settingItems: await readJson("settingItems.json") || [],
    foreshadows: await readJson("foreshadows.json") || [],
    materials: await readJson("materials.json") || [],
    versions: {}
  };
  const versionFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("versions/") && name.endsWith(".json")
  );
  if (versionFiles.length > MAX_VERSION_ENTRIES) {
    throw new ProjectFileValidationError(
      "too-many-versions",
      "\u5DE5\u7A0B\u6587\u4EF6\u5305\u542B\u8FC7\u591A\u7248\u672C\u5386\u53F2\u6761\u76EE\uFF08\u8D85\u8FC7 1000\uFF09\uFF0C\u53EF\u80FD\u635F\u574F",
      { count: versionFiles.length }
    );
  }
  for (const f of versionFiles) {
    const chapterId = f.slice("versions/".length, -5);
    data.versions[chapterId] = await readJson(f) || [];
  }
  if (!data.project || typeof data.project !== "object") {
    throw new ProjectFileValidationError("invalid-project", "\u5DE5\u7A0B\u6587\u4EF6\u7F3A\u5C11\u6709\u6548\u7684 project.json");
  }
  const arrayFieldNames = ["chapters", "characters", "settingCategories", "settingItems", "foreshadows", "materials"];
  for (const f of arrayFieldNames) {
    if (!Array.isArray(data[f])) {
      throw new ProjectFileValidationError(
        "invalid-array-field",
        `\u5DE5\u7A0B\u6587\u4EF6\u7684 ${f} \u6570\u636E\u4E0D\u662F\u6709\u6548\u6570\u7EC4`,
        { field: f }
      );
    }
  }
  return data;
}
async function generateProjectFileBuffer(data) {
  const zip = new import_jszip.default();
  const metadata = {
    version: FILE_VERSION,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    checksum: generateChecksum(JSON.stringify(data.project))
  };
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));
  zip.file("project.json", JSON.stringify(data.project, null, 2));
  zip.file("chapters.json", JSON.stringify(data.chapters, null, 2));
  zip.file("characters.json", JSON.stringify(data.characters, null, 2));
  zip.file("settingCategories.json", JSON.stringify(data.settingCategories, null, 2));
  zip.file("settingItems.json", JSON.stringify(data.settingItems, null, 2));
  zip.file("foreshadows.json", JSON.stringify(data.foreshadows, null, 2));
  zip.file("materials.json", JSON.stringify(data.materials, null, 2));
  if (data.versions && typeof data.versions === "object" && Object.keys(data.versions).length > 0) {
    const versionsDir = zip.folder("versions");
    Object.entries(data.versions).forEach(([chapterId, chapterVersions]) => {
      versionsDir?.file(`${chapterId}.json`, JSON.stringify(chapterVersions, null, 2));
    });
  }
  return await zip.generateAsync({ type: "nodebuffer" });
}
function formatBackupTimestamp(date = /* @__PURE__ */ new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}
function generateBackupFileName(date = /* @__PURE__ */ new Date()) {
  return `${formatBackupTimestamp(date)}.cwp`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FILE_VERSION,
  MAX_COMPRESSED_SIZE,
  MAX_UNCOMPRESSED_SIZE,
  MAX_VERSION_ENTRIES,
  ProjectFileValidationError,
  formatBackupTimestamp,
  generateBackupFileName,
  generateProjectFileBuffer,
  parseProjectFileFromBuffer
});
