/**
 * 大纲打磨面板：内部类型
 *
 * TabId 由原 OutlinePolishPanel.tsx 顶部 type 别名搬迁而来。
 */

// 8 个 Tab 标识：骨架 / 诊断 / 节奏 / 角色 / 节拍 / 扩展 / 推演 / 版本
export type TabId =
  | 'skeleton'
  | 'diagnosis'
  | 'pacing'
  | 'characters'
  | 'beats'
  | 'expansion'
  | 'causal'
  | 'snapshots';
