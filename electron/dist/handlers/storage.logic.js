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
var storage_logic_exports = {};
__export(storage_logic_exports, {
  applyProjectsOps: () => applyProjectsOps
});
module.exports = __toCommonJS(storage_logic_exports);
function getProjectId(p) {
  if (p && typeof p === "object" && "id" in p && typeof p.id === "string") {
    return p.id;
  }
  return null;
}
function applyProjectsOps(current, ops) {
  let arr = [...current];
  for (const op of ops) {
    switch (op.type) {
      case "add": {
        const newId = getProjectId(op.project);
        if (newId) {
          arr = arr.map((p) => getProjectId(p) === newId ? op.project : p);
          if (!arr.some((p) => getProjectId(p) === newId)) arr.push(op.project);
        } else {
          arr.push(op.project);
        }
        break;
      }
      case "remove": {
        arr = arr.filter((p) => getProjectId(p) !== op.id);
        break;
      }
      case "update": {
        const newId = getProjectId(op.project);
        if (!newId) return null;
        let found = false;
        arr = arr.map((p) => {
          if (getProjectId(p) === newId) {
            found = true;
            return { ...p, ...op.project };
          }
          return p;
        });
        if (!found) arr.push(op.project);
        break;
      }
      case "clear": {
        arr = [];
        break;
      }
      default:
        return null;
    }
  }
  return arr;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  applyProjectsOps
});
