import { MATERIAL_TYPE_LABELS, MATERIAL_TYPES } from '@/types';
import type { Material } from '@/types';
import { TYPE_COLORS } from './constants';

interface MaterialFormProps {
  title: string;
  type: Material['type'];
  onTitleChange: (v: string) => void;
  onTypeChange: (t: Material['type']) => void;
  onAdd: () => void;
  onCancel: () => void;
}

export function MaterialForm({ title, type, onTitleChange, onTypeChange, onAdd, onCancel }: MaterialFormProps) {
  return (
    <div className="p-3 border-b border-ink-800/50 bg-ink-800/30 space-y-2">
      <input
        aria-label="素材标题"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onAdd()}
        placeholder="素材标题..."
        className="input text-sm"
        autoFocus
      />
      <div className="grid grid-cols-3 gap-1">
        {MATERIAL_TYPES.slice(0, 6).map(t => (
          <button
            key={t}
            onClick={() => onTypeChange(t)}
            className={`py-1 text-[10px] rounded transition-colors ${
              type === t
                ? `${TYPE_COLORS[t]} border border-current/30`
                : 'bg-ink-700/50 text-ink-400 hover:text-ink-200'
            }`}
          >
            {MATERIAL_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 btn btn-secondary text-xs">
          取消
        </button>
        <button onClick={onAdd} className="flex-1 btn btn-primary text-xs">
          添加
        </button>
      </div>
    </div>
  );
}
