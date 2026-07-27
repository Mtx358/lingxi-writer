/**
 * AI 能力门面（facade）—— barrel 文件
 *
 * 原 aiService.ts（2797 行）已按功能域拆分为 10 个子模块，本文件作为 barrel
 * 聚合所有命名导出并重建 `aiService` 单例对象，保持 `@/utils/aiService` 路径
 * 的对外 API 完全兼容（named exports + 默认 aiService 对象 + 类型导出）。
 *
 * 子模块划分：
 *   - core.ts       设置包装、共享 helper（仅公共部分在此 re-export）
 *   - continue.ts   续写
 *   - expand.ts     扩写
 *   - polish.ts     润色 / 视角切换
 *   - analysis.ts   章节 / 结构分析
 *   - brainstorm.ts 创意 / 起名
 *   - outline.ts    大纲打磨 / 结构变体
 *   - materials.ts  素材卡片提问 / 因果影响
 *   - blueprint.ts  设定卡 / 蓝图
 *   - writing.ts    指令写作 / 多版本 / 全书通读 / 简介 / 标签 / 敏感词
 */

// ==================== 命名导出 re-export ====================

// core.ts：仅 re-export 原文件对外暴露的设置/类型/系统提示，
// 内部共享 helper（humanizeIntensityForExpand / parseJsonFromLLM 等）保持模块私有
export {
  updateSettings,
  getSettings,
  getTotalTokensUsed,
  testConnection,
  NOVEL_SYSTEM_PROMPT,
  setLLMClient,
  getLLMClient,
} from './core';
export type { StreamHandler } from './core';

// 其余域模块的所有 export 均为原 aiService.ts 的公共 API，直接全量 re-export
export * from './continue';
export * from './expand';
export * from './polish';
export * from './analysis';
export * from './brainstorm';
export * from './outline';
export * from './materials';
export * from './blueprint';
export * from './writing';

// ==================== 兼容旧调用的单例 facade ====================
//
// 调用方仍可通过 aiService.xxx(...) 形式访问所有能力，迁移到模块函数
// 后无需改动现有 import。对象成员与原 aiService.ts 完全一致。
import {
  updateSettings,
  getSettings,
  getTotalTokensUsed,
  testConnection,
} from './core';
import { generateContinuation, generateContinuationStream } from './continue';
import { expandText, expandTextStream } from './expand';
import { polishText, polishTextStream, switchPerspective } from './polish';
import {
  analyzeChapter,
  analyzeStructure,
  checkStyleConsistency,
  analyzeCharacterArcs,
  analyzeChapterForReading,
} from './analysis';
import {
  generateBrainstorm,
  generateStoryIdea,
  generateCharacterNames,
  generateChapterTitleSuggestions,
} from './brainstorm';
import {
  polishOutline,
  expandOutlineNode,
  generateChapterBeats,
  generateStructureVariants,
  generateConflictCompass,
} from './outline';
import { askMaterialQuestion, previewCausalImpact } from './materials';
import {
  generateCoreSettingCardQuestions,
  checkSettingCardContradictions,
  generateBlueprintOverview,
  generateBlueprintChangeImpact,
} from './blueprint';
import {
  generateWritingByInstruction,
  generateMultipleVersions,
  generateFullBookReview,
  optimizeSynopsis,
  recommendPlatformTags,
  filterSensitiveWords,
} from './writing';

export const aiService = {
  updateSettings,
  getSettings,
  getTotalTokensUsed,
  testConnection,
  generateContinuation,
  generateContinuationStream,
  expandText,
  expandTextStream,
  polishText,
  polishTextStream,
  switchPerspective,
  analyzeChapter,
  analyzeStructure,
  checkStyleConsistency,
  generateBrainstorm,
  generateStoryIdea,
  generateCharacterNames,
  generateChapterTitleSuggestions,
  polishOutline,
  analyzeCharacterArcs,
  expandOutlineNode,
  generateChapterBeats,
  generateStructureVariants,
  generateConflictCompass,
  askMaterialQuestion,
  previewCausalImpact,
  // 灵犀助手域：设定卡 / 蓝图 / 指令写作 / 多版本 / 全书润色 / 简介 / 标签 / 敏感词 / 章节分析
  generateCoreSettingCardQuestions,
  checkSettingCardContradictions,
  generateBlueprintOverview,
  generateBlueprintChangeImpact,
  generateWritingByInstruction,
  generateMultipleVersions,
  generateFullBookReview,
  optimizeSynopsis,
  recommendPlatformTags,
  filterSensitiveWords,
  analyzeChapterForReading,
};
