import { memo } from 'react';
import { Settings } from 'lucide-react';
import { FORMATS } from './constants';
import type { ExportFormat } from './types';

interface ExportFormatSelectorProps {
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
}

function ExportFormatSelectorBase({ format, onFormatChange }: ExportFormatSelectorProps) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
        <Settings className="w-4 h-4 text-amber-400" />
        选择格式
      </h2>
      <div className="grid grid-cols-5 gap-2">
        {FORMATS.map(f => (
          <button
            key={f.id}
            onClick={() => onFormatChange(f.id as ExportFormat)}
            className={`p-3 rounded-lg border text-center transition-all ${
              format === f.id
                ? 'border-amber-400/50 bg-amber-400/10'
                : 'border-ink-700 bg-ink-800/30 hover:border-ink-600'
            }`}
          >
            <f.icon className={`w-6 h-6 mx-auto mb-2 ${
              format === f.id ? 'text-amber-400' : 'text-ink-500'
            }`} />
            <div className={`text-sm font-medium ${
              format === f.id ? 'text-ink-100' : 'text-ink-300'
            }`}>
              {f.label}
            </div>
            <div className="text-[10px] text-ink-500 mt-0.5">{f.desc}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

// props 均为稳定值（format 为基础类型，onFormatChange 为 useState setter），memo 可跳过无关重渲染
export const ExportFormatSelector = memo(ExportFormatSelectorBase);
