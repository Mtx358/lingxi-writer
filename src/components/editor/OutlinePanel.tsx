/**
 * OutlinePanel 入口（向后兼容）。
 *
 * 实际实现已拆分至 ./outline/ 目录：
 *   - outline/OutlinePanel.tsx        主组件（chapters 订阅/树渲染/详情面板编排）
 *   - outline/ChapterNode.tsx         树节点（拖拽手柄/折叠/双击编辑/添加+更多菜单/AI 推荐标题）
 *   - outline/OutlineDetailPanel.tsx  详情面板（字段编辑/版本快照/角色伏笔关联）
 *   - outline/OutlineToolbar.tsx      统计栏 + 筛选 + 批量操作菜单
 *   - outline/useOutlineDrag.ts       拖拽落点计算 + 深度校验
 *   - outline/useOutlineSelection.ts  单击/Ctrl+多选 + 批量删除/合并
 *
 * 此文件仅做 re-export，保持 `@/components/editor/OutlinePanel` 路径可用。
 */
export { default } from './outline';
