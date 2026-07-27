import { memo } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import type { ExportStage, ExportMessage, ExportFormat } from './types';

interface ExportProgressProps {
  exporting: boolean;
  exportStage: ExportStage;
  format: ExportFormat;
  exportProgress: number;
  exportMessage: ExportMessage | null;
}

function ExportProgressBase({
  exporting,
  exportStage,
  format,
  exportProgress,
  exportMessage,
}: ExportProgressProps) {
  return (
    <>
      {/* Export Progress Bar */}
      {exporting && (
        <div className="relative z-10 px-4 py-2 bg-ink-800/50 border-b border-ink-700/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-ink-300 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
              {exportStage === 'preparing' && '正在加载导出模块...'}
              {exportStage === 'generating' && `正在生成 ${format.toUpperCase()} 文件...`}
              {exportStage === 'saving' && '正在保存文件...'}
              {exportStage === 'idle' && '处理中...'}
            </span>
            <span className="text-[10px] text-ink-500 font-mono">{exportProgress}%</span>
          </div>
          <div
            className="w-full h-1.5 bg-ink-700 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={exportProgress}
            aria-label="导出进度"
          >
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-300 transition-all duration-300 ease-out"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Message Banner */}
      {exportMessage && (
        <div className={`relative z-10 px-4 py-2 text-xs flex items-center gap-2 ${
          exportMessage.type === 'warning'
            ? 'bg-amber-400/10 text-amber-300 border-b border-amber-400/20'
            : exportMessage.type === 'error'
            ? 'bg-red-400/10 text-red-300 border-b border-red-400/20'
            : 'bg-emerald-400/10 text-emerald-300 border-b border-emerald-400/20'
        }`}>
          {exportMessage.type === 'warning' ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          ) : exportMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{exportMessage.text}</span>
        </div>
      )}
    </>
  );
}

// props 均为基础类型 / null，memo 可跳过无关重渲染
export const ExportProgress = memo(ExportProgressBase);
