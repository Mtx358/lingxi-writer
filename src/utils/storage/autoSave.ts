import { AUTOSAVE_INTERVAL } from '@/constants/config';

/**
 * 自动保存调度逻辑。
 *
 * 维护模块级 isDirty / dirtyVersion / autoSaveTimer / inflightSave 状态，
 * 对外暴露 markDirty / triggerSave / clearAutoSaveTimer / getDirtyState 等
 * API。saveCallback 由上层（projectSlice）通过 setAutoSaveCallback 注入，
 * 本模块不直接依赖 storage 单例，避免与 projectsStore 形成循环依赖。
 *
 * 关键不变量：
 *   - 串行化保存（inflightSave 链）：triggerSave 在发起新保存前等待上一个保存，
 *     避免 saveCallback 内部 isSaving 互斥跳过丢失最终编辑
 *   - dirtyVersion 单调递增：triggerSave 用它判断 await 期间是否有新编辑，
 *     避免错误覆盖新 dirty 状态导致编辑丢失
 */

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let isDirty = false;
// 单调递增的 dirty 版本号：每次 markDirty 自增，triggerSave 用它判断 await 期间
// 是否有新编辑产生，避免错误地覆盖新 dirty 状态导致编辑丢失
let dirtyVersion = 0;
let saveCallback: (() => Promise<void>) | null = null;
// 进行中的保存 Promise：triggerSave 在发起新保存前先等待上一个保存完成，
// 避免与自动保存/手动保存并发引起 isSaving 互斥跳过导致丢失最终编辑
let inflightSave: Promise<void> | null = null;

export const setAutoSaveCallback = (callback: () => Promise<void>) => {
  saveCallback = callback;
};

export const markDirty = () => {
  isDirty = true;
  dirtyVersion++;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (isDirty && saveCallback) {
      try {
        // 等待保存成功后才清 dirty，避免保存失败时静默丢失编辑
        await runSaveChain();
        isDirty = false;
      } catch (e) {
        // 保存失败：保留 dirty 以便下个周期重试
        console.error('Auto-save failed, will retry next cycle:', e);
      }
    }
  }, AUTOSAVE_INTERVAL);
};

// 串行化保存：若上一个保存未完成，先 await 它再发起新保存，
// 这样即使 saveCallback 内部检查 isSaving 也能在它结束后立即补一次
async function runSaveChain(): Promise<void> {
  if (inflightSave) {
    try { await inflightSave; } catch { /* 上一个保存的失败已记录，忽略 */ }
  }
  if (!saveCallback) return;
  const p = saveCallback();
  inflightSave = p;
  try {
    await p;
  } finally {
    if (inflightSave === p) inflightSave = null;
  }
}

export const triggerSave = async (): Promise<void> => {
  if (!saveCallback) {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    return;
  }
  // 记录 await 前的 dirty 版本号：await 期间若 markDirty 被调用，dirtyVersion 会自增，
  // 此时不应清 isDirty 也不应清 timer，让 markDirty 设置的新 timer 触发下次保存
  const myVersion = dirtyVersion;
  try {
    await runSaveChain();
    if (dirtyVersion === myVersion) {
      isDirty = false;
    }
  } catch (e) {
    console.error('triggerSave failed, keeping dirty state:', e);
    // isDirty 保持 true
  }
  // 仅在没有新 markDirty 时清理 timer；否则保留 markDirty 设置的新 timer
  if (dirtyVersion === myVersion && autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
};

export const clearAutoSaveTimer = () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
};

export const getDirtyState = () => isDirty;
