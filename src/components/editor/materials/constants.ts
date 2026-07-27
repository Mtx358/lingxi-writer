import { Lightbulb, BookOpen, FileText, Image, Music } from 'lucide-react';
import type { Material } from '@/types';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

// 列表虚拟化阈值：超过该数量时分批渲染，避免一次性挂载大量 DOM
export const VIRTUALIZATION_THRESHOLD = 50;
export const INITIAL_BATCH = 20;
export const BATCH_SIZE = 20;

export const TYPE_ICONS: Record<Material['type'], typeof Lightbulb> = {
  inspiration: Lightbulb,
  reference: BookOpen,
  research: FileText,
  quote: FileText,
  image: Image,
  audio: Music,
};

export const TYPE_COLORS: Record<Material['type'], string> = {
  inspiration: 'text-amber-400 bg-amber-400/10',
  reference: 'text-blue-400 bg-blue-400/10',
  research: 'text-purple-400 bg-purple-400/10',
  quote: 'text-emerald-400 bg-emerald-400/10',
  image: 'text-pink-400 bg-pink-400/10',
  audio: 'text-cyan-400 bg-cyan-400/10',
};
