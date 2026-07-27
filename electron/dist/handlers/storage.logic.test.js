"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * electron/handlers/storage.logic.ts 单元测试
 *
 * 测试目标：applyProjectsOps 纯函数（projects 数组 patch op 应用逻辑）
 * - add：新增 / 同 id 替换去重 / 缺 id 追加
 * - remove：按 id 过滤
 * - update：upsert 语义（存在合并 / 不存在追加 / 缺 id 返回 null）
 * - clear：清空
 * - 未知 op：返回 null
 * - 多 op 顺序应用 + 早返回语义
 * - 不变性：不修改输入 current
 *
 * 本测试无需 mock electron：storage.logic.ts 仅依赖 node 内置模块。
 */
const vitest_1 = require("vitest");
const storage_logic_1 = require("./storage.logic");
(0, vitest_1.describe)('storage.logic / applyProjectsOps', () => {
    // -------------------- add op --------------------
    (0, vitest_1.describe)('add', () => {
        (0, vitest_1.it)('空数组追加新项目', () => {
            const result = (0, storage_logic_1.applyProjectsOps)([], [{ type: 'add', project: { id: 'p1', name: 'A' } }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'A' }]);
        });
        (0, vitest_1.it)('非空数组追加新项目（保留既有项）', () => {
            const cur = [{ id: 'p1', name: 'A' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'add', project: { id: 'p2', name: 'B' } }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]);
        });
        (0, vitest_1.it)('同 id 项目存在时替换（去重防御）', () => {
            const cur = [{ id: 'p1', name: 'old' }, { id: 'p2', name: 'B' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'add', project: { id: 'p1', name: 'new' } }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'new' }, { id: 'p2', name: 'B' }]);
        });
        (0, vitest_1.it)('同 id 项目存在时替换且不产生重复条目', () => {
            const cur = [{ id: 'p1', name: 'old' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'add', project: { id: 'p1', name: 'new' } }]);
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'new' }]);
        });
        (0, vitest_1.it)('project 缺 id 时仍追加（handler 已保证 project 含 string id，此处为防御性）', () => {
            // ProjectOp 类型要求 project 含 string id，此处 cast 模拟异常输入
            const op = { type: 'add', project: { name: 'no-id' } };
            const result = (0, storage_logic_1.applyProjectsOps)([], [op]);
            (0, vitest_1.expect)(result).toEqual([{ name: 'no-id' }]);
        });
    });
    // -------------------- remove op --------------------
    (0, vitest_1.describe)('remove', () => {
        (0, vitest_1.it)('按 id 过滤掉匹配项', () => {
            const cur = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'remove', id: 'p2' }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1' }, { id: 'p3' }]);
        });
        (0, vitest_1.it)('id 不存在时数组不变（返回新引用）', () => {
            const cur = [{ id: 'p1' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'remove', id: 'nope' }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1' }]);
            (0, vitest_1.expect)(result).not.toBe(cur);
        });
        (0, vitest_1.it)('空数组移除仍返回空数组', () => {
            const result = (0, storage_logic_1.applyProjectsOps)([], [{ type: 'remove', id: 'p1' }]);
            (0, vitest_1.expect)(result).toEqual([]);
        });
        (0, vitest_1.it)('数组中多条匹配 id 全部移除（去重场景）', () => {
            const cur = [{ id: 'p1' }, { id: 'p1' }, { id: 'p2' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'remove', id: 'p1' }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p2' }]);
        });
    });
    // -------------------- update op --------------------
    (0, vitest_1.describe)('update', () => {
        (0, vitest_1.it)('存在时合并更新（upsert 语义）', () => {
            const cur = [{ id: 'p1', name: 'old', desc: 'keep' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'update', project: { id: 'p1', name: 'new' } }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'new', desc: 'keep' }]);
        });
        (0, vitest_1.it)('不存在时追加（upsert 语义，兼容 openProjectFile 首次导入）', () => {
            const cur = [{ id: 'p1', name: 'A' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'update', project: { id: 'p2', name: 'B' } }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]);
        });
        (0, vitest_1.it)('project 缺 id 时返回 null（防御性失败）', () => {
            const op = { type: 'update', project: { name: 'no-id' } };
            const result = (0, storage_logic_1.applyProjectsOps)([{ id: 'p1' }], [op]);
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('多条同 id 时全部合并更新', () => {
            const cur = [{ id: 'p1', v: 1 }, { id: 'p1', v: 2 }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'update', project: { id: 'p1', v: 9 } }]);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', v: 9 }, { id: 'p1', v: 9 }]);
        });
    });
    // -------------------- clear op --------------------
    (0, vitest_1.describe)('clear', () => {
        (0, vitest_1.it)('清空非空数组', () => {
            const result = (0, storage_logic_1.applyProjectsOps)([{ id: 'p1' }, { id: 'p2' }], [{ type: 'clear' }]);
            (0, vitest_1.expect)(result).toEqual([]);
        });
        (0, vitest_1.it)('清空空数组仍返回空数组', () => {
            const result = (0, storage_logic_1.applyProjectsOps)([], [{ type: 'clear' }]);
            (0, vitest_1.expect)(result).toEqual([]);
        });
    });
    // -------------------- 未知 op --------------------
    (0, vitest_1.describe)('未知 op type', () => {
        (0, vitest_1.it)('未知 type 返回 null（防御性，handler 已校验 type 不会进入此分支）', () => {
            const op = { type: 'bogus' };
            const result = (0, storage_logic_1.applyProjectsOps)([], [op]);
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    // -------------------- 多 op 顺序应用 + 早返回 --------------------
    (0, vitest_1.describe)('多 op 顺序应用', () => {
        (0, vitest_1.it)('多个 op 顺序应用：add → update → remove', () => {
            const ops = [
                { type: 'add', project: { id: 'p1', name: 'A' } },
                { type: 'add', project: { id: 'p2', name: 'B' } },
                { type: 'update', project: { id: 'p1', name: 'A2' } },
                { type: 'remove', id: 'p2' },
            ];
            const result = (0, storage_logic_1.applyProjectsOps)([], ops);
            (0, vitest_1.expect)(result).toEqual([{ id: 'p1', name: 'A2' }]);
        });
        (0, vitest_1.it)('中间 op 失败立即返回 null，后续 op 不应用', () => {
            const ops = [
                { type: 'add', project: { id: 'p1', name: 'A' } },
                { type: 'update', project: { name: 'no-id' } },
                { type: 'add', project: { id: 'p3', name: 'C' } },
            ];
            const result = (0, storage_logic_1.applyProjectsOps)([], ops);
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    // -------------------- 不变性 --------------------
    (0, vitest_1.describe)('不变性', () => {
        (0, vitest_1.it)('不修改输入 current 数组', () => {
            const cur = [{ id: 'p1', name: 'A' }];
            const snapshot = JSON.stringify(cur);
            (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'add', project: { id: 'p2', name: 'B' } }]);
            (0, vitest_1.expect)(JSON.stringify(cur)).toBe(snapshot);
        });
        (0, vitest_1.it)('add 同 id 替换不修改原数组中的对象引用', () => {
            const p1 = { id: 'p1', name: 'A' };
            const cur = [p1];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, [{ type: 'add', project: { id: 'p1', name: 'new' } }]);
            // 原对象 p1 不应被修改
            (0, vitest_1.expect)(p1.name).toBe('A');
            // 返回的新数组对应位置应是新对象
            (0, vitest_1.expect)(result?.[0]).not.toBe(p1);
            (0, vitest_1.expect)(result?.[0]).toEqual({ id: 'p1', name: 'new' });
        });
        (0, vitest_1.it)('空 ops 数组返回 current 的副本（新引用）', () => {
            const cur = [{ id: 'p1' }];
            const result = (0, storage_logic_1.applyProjectsOps)(cur, []);
            (0, vitest_1.expect)(result).toEqual(cur);
            (0, vitest_1.expect)(result).not.toBe(cur);
        });
    });
});
