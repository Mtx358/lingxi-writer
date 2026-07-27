/**
 * outlinePolish 目录 barrel
 *
 * 仅 re-export 默认 OutlinePolishPanel 主组件，供外层
 * `src/components/editor/OutlinePolishPanel.tsx` barrel shim 转发，
 * 保持 `import OutlinePolishPanel from './OutlinePolishPanel'` 路径向后兼容。
 */
export { default } from './OutlinePolishPanel';
