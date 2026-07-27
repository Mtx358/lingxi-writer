import { FileText, File, BookOpen } from 'lucide-react';
import type { ExportPlatform } from '@/types';

// 格式/平台预设为静态数据，提到模块顶层避免每次渲染重建
export const FORMATS = [
  { id: 'markdown', label: 'Markdown', icon: FileText, desc: '.md 纯文本格式' },
  { id: 'docx', label: 'Word', icon: File, desc: '.docx 文档格式' },
  { id: 'pdf', label: 'PDF', icon: File, desc: '.pdf 打印格式' },
  { id: 'epub', label: 'EPUB', icon: BookOpen, desc: '.epub 电子书格式' },
  { id: 'html', label: 'HTML', icon: FileText, desc: '.html 网页格式' },
  { id: 'txt', label: '纯文本', icon: File, desc: '.txt 纯文本格式' },
];

// 平台预设：与 types/index.ts 中 EXPORT_PLATFORM_LABELS 保持一致
export const PLATFORMS: { id: ExportPlatform; label: string; desc: string }[] = [
  { id: 'general', label: '通用', desc: '标准排版' },
  { id: 'qidian', label: '起点', desc: '起点中文网' },
  { id: 'fanqie', label: '番茄', desc: '番茄小说' },
  { id: 'jjwxc', label: '晋江', desc: '晋江文学城' },
  { id: 'qimao', label: '七猫', desc: '七猫小说' },
  { id: 'wechat', label: '微信读书', desc: '微信读书' },
];

// 排版风格选项
export const STYLES = [
  { id: 'novel', label: '小说' },
  { id: 'article', label: '文章' },
  { id: 'script', label: '剧本' },
];

// 敏感词严重度样式映射
export const SENSITIVITY_STYLE: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-red-500/10 text-red-300 border-red-500/30',
  medium: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
  low: 'bg-blue-400/10 text-blue-300 border-blue-400/30',
};
