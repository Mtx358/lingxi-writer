"use strict";
// storage handler 的纯函数实现：projects 数组 patch op 应用逻辑。
// 本模块不依赖 electron（dialog/shell/fs/ipcMain/safeStorage），可被单元测试直接 import。
//
// 抽离目的：storage:patchProjects 的 op 应用逻辑（add/remove/update/clear）此前
// 因 app.whenReady 永不 resolve 而无测试覆盖，此处抽离为纯函数便于测试。
// 注意：op 形状校验（isSafeIdentifier / 危险键过滤）仍由 handler 完成，本函数仅做应用。
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyProjectsOps = applyProjectsOps;
// 从未知项目对象中提取 id（与原 handler 的 getId 一致）。
// 返回 null 表示该项目无有效 id（用于 update op 的防御性检查）。
function getProjectId(p) {
    if (p && typeof p === 'object' && 'id' in p && typeof p.id === 'string') {
        return p.id;
    }
    return null;
}
// 将 patch op 数组顺序应用到 current 数组，返回新数组。
// 抽离自 storage:patchProjects handler 的 switch(opType) 主体逻辑。
//
// 输入：
//   - current: 当前 projects 数组（handler 已从磁盘读出；空/损坏文件视为 []）
//   - ops: patch op 数组（handler 已对每个 op 做形状校验）
// 输出：
//   - 新数组（不修改 current，返回新引用）
//   - null：表示 op 应用失败（仅 update op 的 project 缺 id 时），handler 据此不写盘
//
// 与原 handler 行为对齐：
//   - add：若同 id 项目已存在则替换（去重防御），否则追加
//   - remove：过滤掉匹配 id 的项目
//   - update：upsert 语义（存在则合并更新，不存在则追加）；project 缺 id → 返回 null
//   - clear：清空数组
//   - 未知 op type：返回 null（防御性，handler 已校验 type 不会进入此分支）
//   - 任一 op 失败立即返回 null，后续 op 不再应用（保持原 handler 的早返回语义）
function applyProjectsOps(current, ops) {
    let arr = [...current];
    for (const op of ops) {
        switch (op.type) {
            case 'add': {
                const newId = getProjectId(op.project);
                // 去重防御：若同 id 项目已存在则替换而非追加，避免重复条目
                if (newId) {
                    arr = arr.map(p => getProjectId(p) === newId ? op.project : p);
                    if (!arr.some(p => getProjectId(p) === newId))
                        arr.push(op.project);
                }
                else {
                    arr.push(op.project);
                }
                break;
            }
            case 'remove': {
                // op.id 已通过 handler 的 isSafeIdentifier 校验
                arr = arr.filter(p => getProjectId(p) !== op.id);
                break;
            }
            case 'update': {
                const newId = getProjectId(op.project);
                if (!newId)
                    return null;
                // upsert 语义：存在则合并更新，不存在则追加，兼容 openProjectFile 首次导入场景
                let found = false;
                arr = arr.map(p => {
                    if (getProjectId(p) === newId) {
                        found = true;
                        // p 与 op.project 均为 unknown，spread 前需断言为对象类型。
                        // 已通过 getProjectId 校验 p 含 string id；op.project 由渲染层 patchProjects 传入
                        return { ...p, ...op.project };
                    }
                    return p;
                });
                if (!found)
                    arr.push(op.project);
                break;
            }
            case 'clear': {
                arr = [];
                break;
            }
            default:
                return null;
        }
    }
    return arr;
}
