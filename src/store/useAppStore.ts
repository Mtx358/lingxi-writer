/**
 * 全局状态 Store（组合入口）
 *
 * 此前为 1155 行的单体 store，承载项目/章节/角色/设定/伏笔/素材/版本/
 * 历史/搜索/AI 等全部状态与逻辑。现按领域拆分为 5 个 slice：
 *
 *   - projectSlice          项目生命周期（加载/创建/打开/保存/关闭/删除）
 *   - chapterSlice          章节增删改查、层级移动、正文更新、编辑器协调
 *   - entitySlice           角色 / 设定 / 伏笔 / 素材（级联清理耦合）
 *   - versionHistorySlice   版本快照 + 撤销/重做
 *   - uiSlice               面板/搜索/冲突/AI设置/崩溃恢复
 *
 * 各 slice 通过 Zustand StateCreator<AppState> 共享同一 store，跨域访问
 * 经 get() 完成，与拆分前行为完全一致。组件侧无需任何改动——仍从
 * `@/store/useAppStore` 导入 useAppStore，且均已使用精确 selector
 * （useAppStore(s => s.xxx)）按字段订阅，避免无关重渲染。
 */
import { create } from 'zustand';
import type { AppState } from './appState';
import { setAutoSaveCallback } from '@/utils/storage';
import { getDirtyState, triggerSave, clearAutoSaveTimer } from '@/utils/storage';

import { createProjectSlice } from './slices/projectSlice';
import { createChapterSlice } from './slices/chapterSlice';
import { createEntitySlice } from './slices/entitySlice';
import { createVersionHistorySlice } from './slices/versionHistorySlice';
import { createUISlice } from './slices/uiSlice';
import { createOutlinePolishSlice } from './slices/outlinePolishSlice';
import { createLingxiSlice } from './slices/lingxiSlice';
import { createInspirationSlice } from './slices/inspirationSlice';
import { createMultiLineSlice } from './slices/multiLineSlice';
import { createBranchSlice } from './slices/branchSlice';
import { createPolishExtrasSlice } from './slices/polishExtrasSlice';

export const useAppStore = create<AppState>()((...a) => {
  const store = {
    ...createProjectSlice(...a),
    ...createChapterSlice(...a),
    ...createEntitySlice(...a),
    ...createVersionHistorySlice(...a),
    ...createUISlice(...a),
    ...createOutlinePolishSlice(...a),
    ...createLingxiSlice(...a),
    ...createInspirationSlice(...a),
    ...createMultiLineSlice(...a),
    ...createBranchSlice(...a),
    ...createPolishExtrasSlice(...a),
  };

  // 初始化自动保存回调：定时触发时保存当前项目（localStorage 项目无 filePath，按 currentProjectId 触发）
  const get = a[1];
  setAutoSaveCallback(async () => {
    if (get().currentProjectId && !get().isSaving) {
      await get().saveProject();
    }
  });

  return store;
});

export { getDirtyState, triggerSave, clearAutoSaveTimer };
