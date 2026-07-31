/**
 * 章节大纲工具函数。
 *
 * 集中「可打磨单元」判定逻辑，避免 16+ 文件重复书写
 * `c.levelType !== 'book' && c.levelType !== 'volume'` 导致规则不一致。
 */
import type { Chapter } from '@/types';

/**
 * 判断大纲节点是否为「可打磨单元」——含正文的节点（chapter/part/section）。
 *
 * 排除纯容器节点（book/volume）：容器无正文内容，不参与打磨分析。
 * 导入大纲通常是「卷→部」结构，部（part）有正文，应纳入打磨；
 * 编辑器手建多为「章」，三幕模板为「幕」。
 */
export function isPolishableChapter(c: Chapter): boolean {
  return c.levelType !== 'book' && c.levelType !== 'volume';
}

/** 批量过滤可打磨单元，保持原顺序。 */
export function getPolishableChapters(chapters: Chapter[]): Chapter[] {
  return chapters.filter(isPolishableChapter);
}
