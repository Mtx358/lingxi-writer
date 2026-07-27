import type { ComponentType } from 'react';
import { BookOpen, BookMarked, Layers, FolderOpen, FileText } from 'lucide-react';
import type { Chapter, ChapterLevelType } from '@/types';

/**
 * 章节大纲相关常量。
 *
 * 从 ChapterNode.tsx 拆出，避免在导出组件的文件中同时导出非组件常量，
 * 触发 react-refresh/only-export-components 警告（HMR 边界识别要求文件
 * 仅导出组件）。
 */

/** 各 levelType 对应的图标（book/volume/part/section/chapter） */
export const LEVEL_ICONS: Record<ChapterLevelType, ComponentType<{ className?: string }>> = {
  book: BookOpen,
  volume: BookMarked,
  part: Layers,
  section: FolderOpen,
  chapter: FileText,
};

// 永不变化的空数组常量，作为无子节点时的稳定回退引用，
// 避免每次渲染 `?? []` 创建新数组使 memo 失效。
export const EMPTY_CHILDREN: Chapter[] = [];
