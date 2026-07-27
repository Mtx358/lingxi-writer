/**
 * 大纲打磨面板：常量与配置项
 *
 * 维度标签 / 维度配色 / 严重度配色 / 节拍类型 / 冲突层级 / 驱动类型 等映射表。
 * 由原 OutlinePolishPanel.tsx 顶部常量区原样搬迁而来。
 */
import type {
  OutlinePolishDimension,
  OutlineIssueSeverity,
  ChapterBeatType,
  ConflictLayer,
  CoreDriver,
} from '@/types';

// 维度中文标签
export const DIMENSION_LABELS: Record<OutlinePolishDimension, string> = {
  theme: '主题锚定',
  structure: '结构递进',
  character: '人物一致',
  logic: '叙事逻辑',
  pacing: '节奏信息',
  foreshadow: '伏笔闭环',
  style: '文风一致',
};

export const DIMENSION_COLORS: Record<OutlinePolishDimension, string> = {
  theme: 'text-purple-300 bg-purple-400/10 border-purple-500/30',
  structure: 'text-blue-300 bg-blue-400/10 border-blue-500/30',
  character: 'text-emerald-300 bg-emerald-400/10 border-emerald-500/30',
  logic: 'text-amber-300 bg-amber-400/10 border-amber-500/30',
  pacing: 'text-cyan-300 bg-cyan-400/10 border-cyan-500/30',
  foreshadow: 'text-pink-300 bg-pink-400/10 border-pink-500/30',
  style: 'text-indigo-300 bg-indigo-400/10 border-indigo-500/30',
};

export const SEVERITY_COLOR: Record<OutlineIssueSeverity, string> = {
  error: 'text-red-400 border-red-500/30 bg-red-500/10',
  warning: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  info: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
};

export const BEAT_TYPE_LABELS: Record<ChapterBeatType, string> = {
  hook: '开章钩子',
  progress: '推进节拍',
  midpoint: '中间转折',
  escalation: '加码节拍',
  cliffhanger: '章末悬念',
};

export const CONFLICT_LAYER_LABELS: Record<ConflictLayer['layer'], string> = {
  inner: '内层冲突',
  interpersonal: '人际冲突',
  faction: '阵营冲突',
  social: '社会冲突',
};

export const DRIVER_TYPE_LABELS: Record<CoreDriver['type'], string> = {
  character: '人物驱动',
  plot: '情节驱动',
  theme: '主题驱动',
};
