// storage:read / write / patchProjects / remove —— 全局 KV 存储与 projects 数组原子 patch。
// 拆分自原 storage.ts（按 IPC 域聚合），逻辑保持不变。
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { logger } from '../../logger';
import {
  safeIpcHandle,
  getProjectsDir,
  ensureDir,
  withWriteMutex,
  isValidStorageKey,
  READ_ONLY_STORAGE_KEYS,
  MAX_STORAGE_VALUE_SIZE,
} from '../shared';
import { isSafeIdentifier } from '../security';
import { applyProjectsOps, type ProjectOp } from '../storage.logic';
import { resolveFilePath, resolveDirPath } from './internal';

export function registerGlobalStorageHandlers(): void {
  safeIpcHandle('storage:read', async (_event, key: string) => {
    try {
      // aiSettings 不再放行：loadAISettings 已改走 ai:loadSettings IPC，
      // storage:read('aiSettings') 直接返回 null，避免渲染层读到磁盘密文
      if (!isValidStorageKey(key) && !READ_ONLY_STORAGE_KEYS.has(key)) {
        logger.audit('security.input', 'storage:read rejected: invalid storage key', { key });
        return null;
      }
      const filePath = resolveFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      logger.warn('storage:read failed', { key, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  });

  safeIpcHandle('storage:write', async (_event, key: string, value: unknown) => {
    try {
      if (!isValidStorageKey(key)) {
        logger.audit('security.input', 'storage:write rejected: invalid storage key', { key });
        return false;
      }
      // 大小限制：防止 XSS 后写入超大 value 撑爆磁盘（DoS）。
      // 50MB 足以容纳最长小说的章节内容 + recovery_draft；超出则拒绝并审计
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_STORAGE_VALUE_SIZE) {
        logger.audit('security.size', 'storage:write rejected: value too large', {
          key,
          size: serialized.length,
        });
        return false;
      }
      const filePath = resolveFilePath(key);
      // 串行化同一 filePath 的并发写入，避免 tmp 互相覆盖导致数据错乱
      return await withWriteMutex(filePath, async () => {
        await ensureDir(filePath);
        // 临时文件名包含 UUID，避免并发写入同一 filePath 时 tmp 互相覆盖
        const tmp = `${filePath}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(tmp, serialized, 'utf-8');
          await fs.rename(tmp, filePath);
          return true;
        } finally {
          // 异常路径清理 tmp，避免残留；成功路径下 tmp 已 rename 走，unlink 忽略 ENOENT
          await fs.unlink(tmp).catch(() => {});
        }
      });
    } catch (e) {
      logger.error('storage:write error', e instanceof Error ? e : { error: String(e), key });
      return false;
    }
  });

  // 原子 patch projects 数组：解决 storage:write 全量覆盖的 read-modify-write 竞态。
  // 渲染层 read → push → write 两次并发时（如快速连续创建两个项目），后写者覆盖前写者，
  // 导致先创建的项目目录已建但 projects.json 无记录，用户看不到该项目。
  // patchProjects 在 withWriteMutex 内原子读改写，IPC 不能传函数故用 patch op 描述。
  safeIpcHandle('storage:patchProjects', async (_event, op:
    | { type: 'add'; project: unknown }
    | { type: 'remove'; id: string }
    | { type: 'update'; project: unknown }
    | { type: 'clear' }
  ) => {
    try {
      // ============ 入参 schema 校验（M1）============
      // 防止 XSS 后构造畸形 op 污染 projects 数组或触发未预期行为：
      // - op 必须是对象（非数组/null）
      // - type 必须是 'add'/'remove'/'update'/'clear' 之一
      // - add/update 的 project 必须是对象且含 isSafeIdentifier 校验通过的 string id
      // - remove 的 id 必须通过 isSafeIdentifier 校验（防路径穿越字符注入到 projects.json）
      if (!op || typeof op !== 'object' || Array.isArray(op)) return null;
      const o = op as Record<string, unknown>;
      const opType = o.type;
      if (typeof opType !== 'string') return null;
      if (opType !== 'add' && opType !== 'remove' && opType !== 'update' && opType !== 'clear') {
        logger.audit('security.schema', 'patchProjects rejected: unknown type', { type: opType });
        return null;
      }
      // 校验 project 字段（add/update 需要）：必须是对象 + 含 string id + id 通过 isSafeIdentifier
      // 危险键过滤：拒绝 __proto__/constructor/prototype 作为顶层键，防延迟型原型污染
      const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      const validateProject = (p: unknown): p is Record<string, unknown> & { id: string } => {
        if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
        const proj = p as Record<string, unknown>;
        if (typeof proj.id !== 'string') return false;
        if (!isSafeIdentifier(proj.id)) return false;
        for (const key of Object.keys(proj)) {
          if (DANGEROUS_KEYS.has(key)) return false;
        }
        return true;
      };
      if (opType === 'add' || opType === 'update') {
        if (!validateProject(o.project)) {
          logger.audit('security.schema', 'patchProjects rejected: invalid project', { type: opType });
          return null;
        }
      } else if (opType === 'remove') {
        if (typeof o.id !== 'string' || !isSafeIdentifier(o.id)) {
          logger.audit('security.schema', 'patchProjects rejected: invalid id');
          return null;
        }
      }
      const filePath = resolveFilePath('projects');
      return await withWriteMutex(filePath, async () => {
        // 原子 read-modify-write：mutex 内读当前数组、应用 patch、写回
        let arr: unknown[] = [];
        try {
          const data = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) arr = parsed;
        } catch {
          // 文件不存在或 JSON 损坏：视为空数组，避免阻塞首次创建
        }
        // op 应用：抽离为 applyProjectsOps 纯函数便于单元测试
        // 入参 op 已通过上面的 schema 校验，cast 为 ProjectOp 安全
        const next = applyProjectsOps(arr, [op as unknown as ProjectOp]);
        if (next === null) return null;
        arr = next;
        await ensureDir(filePath);
        const tmp = `${filePath}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(tmp, JSON.stringify(arr), 'utf-8');
          await fs.rename(tmp, filePath);
          return arr;
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
      });
    } catch (e) {
      logger.error('storage:patchProjects error', e instanceof Error ? e : { error: String(e) });
      return null;
    }
  });

  safeIpcHandle('storage:remove', async (_event, key: string) => {
    try {
      // aiSettings 不再走 READ_ONLY 路径：重置改由专用 IPC 处理
      if (!isValidStorageKey(key) && !READ_ONLY_STORAGE_KEYS.has(key)) {
        logger.audit('security.input', 'storage:remove rejected: invalid storage key', { key });
        return false;
      }
      // 仅 project_{id}（无第二个下划线）才递归删除项目目录；
      // project_{id}_{subkey} 只删除对应的 .json 文件
      if (key.startsWith('project_')) {
        const rest = key.slice('project_'.length);
        const isProjectRoot = !rest.includes('_');
        if (isProjectRoot) {
          const dir = resolveDirPath(key);
          // 二次防御：dir 必须严格位于 projects 目录之内（且不等于 projects 根目录本身）
          const projectsRoot = getProjectsDir();
          if (dir === projectsRoot || !dir.startsWith(projectsRoot + path.sep)) {
            logger.audit('security.path', 'storage:remove refused: resolves to projects root or escapes', { dir });
            return false;
          }
          await fs.rm(dir, { recursive: true, force: true });
        } else {
          const filePath = resolveFilePath(key);
          await fs.unlink(filePath).catch(() => {});
        }
      } else {
        const filePath = resolveFilePath(key);
        await fs.unlink(filePath).catch(() => {});
      }
      return true;
    } catch (e) {
      logger.error('storage:remove error', e instanceof Error ? e : { error: String(e), key });
      return false;
    }
  });

}
