/**
 * AIPanel 入口（向后兼容）。
 *
 * 实际实现已拆分至 ./ai/ 目录：
 *   - ai/AIPanel.tsx          主组件（编排 settings/cruise/instruction/output）
 *   - ai/GenerateModeSelector.tsx  设置面板（provider/style/参数/测试连接）
 *   - ai/StreamOutputView.tsx 输出区（流式卡片/版本列表/建议列表/空状态）
 *   - ai/useAIPanelActions.ts 6 生成 + 4 应用 handler 集中 hook
 *   - ai/useStreamThrottle.ts 流式 chunk 节流 hook
 *   - ai/constants.ts         AI 常量 re-export
 *
 * 此文件仅做 re-export，保持 `@/components/editor/AIPanel` 路径可用。
 */
export { default } from './ai';
