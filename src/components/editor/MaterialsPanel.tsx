/**
 * MaterialsPanel 入口（向后兼容）。
 *
 * 实际实现已拆分至 ./materials/ 目录：
 *   - materials/MaterialsPanel.tsx       主组件（编排 + 虚拟化 + 筛选 + 渲染）
 *   - materials/MaterialItem.tsx         素材卡片（memo 化 + 附件展示）
 *   - materials/MaterialForm.tsx         素材添加表单
 *   - materials/QuestionDrawer.tsx       深度提问 drawer（useFocusTrap + ESC + 浮层）
 *   - materials/ImageFallback.tsx        图片回退组件（file:// → dataURL 降级）
 *   - materials/useMaterialsActions.ts   素材 CRUD action hook（含并发守卫）
 *   - materials/constants.ts             常量（扩展名 / 虚拟化阈值 / TYPE_ICONS / TYPE_COLORS）
 *   - materials/types.ts                 内部类型（MaterialItemProps）
 *
 * 此文件仅做 re-export，保持 `@/components/editor/MaterialsPanel` 路径可用。
 */
export { default } from './materials';
