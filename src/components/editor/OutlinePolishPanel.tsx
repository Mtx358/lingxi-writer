/**
 * OutlinePolishPanel barrel shim
 *
 * 历史上此文件承载整个大纲打磨面板（1500+ 行），已按功能域拆分到
 * ./outlinePolish/ 目录下的多个子模块。为保持
 * `import OutlinePolishPanel from './OutlinePolishPanel'` / 
 * `import OutlinePolishPanel from '@/components/editor/OutlinePolishPanel'`
 * 路径向后兼容，此处仅做转发。
 *
 * 实际实现见 ./outlinePolish/OutlinePolishPanel.tsx。
 */
export { default } from './outlinePolish';
