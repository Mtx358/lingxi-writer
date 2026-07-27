import type { Material, MaterialAttachment } from '@/types';

// ============ 列表项子组件（memo 化避免无关重渲染） ============
export interface MaterialItemProps {
  mat: Material;
  isExpanded: boolean;
  onToggleExpand: (mat: Material) => void;
  onTogglePinned: (mat: Material) => void;
  onAsk: (mat: Material) => void;
  onAddAttachment: (mat: Material) => void;
  onOpenAttachment: (att: MaterialAttachment) => void;
  onRemoveAttachment: (mat: Material, att: MaterialAttachment) => void;
}
