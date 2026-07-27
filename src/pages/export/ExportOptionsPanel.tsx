import { memo } from 'react';
import { PLATFORMS, STYLES } from './constants';
import type { ExportStyle } from './types';
import type { ExportPlatform } from '@/types';

interface ExportOptionsPanelProps {
  includeToc: boolean;
  onIncludeTocChange: (value: boolean) => void;
  style: ExportStyle;
  onStyleChange: (style: ExportStyle) => void;
  platform: ExportPlatform;
  onPlatformChange: (platform: ExportPlatform) => void;
}

function ExportOptionsPanelBase({
  includeToc,
  onIncludeTocChange,
  style,
  onStyleChange,
  platform,
  onPlatformChange,
}: ExportOptionsPanelProps) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-ink-200 mb-3">导出选项</h2>
      <div className="card p-4 space-y-4">
        {/* 用 div 替代 label 承载点击，避免 label 内嵌带 onClick 的 div 在部分浏览器双触发 */}
        <div
          className="flex items-center justify-between cursor-pointer"
          role="switch"
          aria-checked={includeToc}
          tabIndex={0}
          onClick={() => onIncludeTocChange(!includeToc)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onIncludeTocChange(!includeToc);
            }
          }}
        >
          <div>
            <div className="text-sm text-ink-200">包含目录</div>
            <div className="text-xs text-ink-500">在文档开头生成章节目录</div>
          </div>
          <div className={`w-10 h-5 rounded-full transition-colors relative ${
            includeToc ? 'bg-amber-400' : 'bg-ink-700'
          }`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              includeToc ? 'left-5' : 'left-0.5'
            }`} />
          </div>
        </div>

        <div className="divider" />

        <div>
          <div className="text-sm text-ink-200 mb-2">排版风格</div>
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => onStyleChange(s.id as ExportStyle)}
                className={`py-2 text-sm rounded transition-colors ${
                  style === s.id
                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                    : 'bg-ink-700/50 text-ink-400 hover:text-ink-200 border border-transparent'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div>
          <div className="text-sm text-ink-200 mb-2">平台预设</div>
          <div className="grid grid-cols-3 gap-2">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => onPlatformChange(p.id)}
                className={`py-2 text-xs rounded transition-colors ${
                  platform === p.id
                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                    : 'bg-ink-700/50 text-ink-400 hover:text-ink-200 border border-transparent'
                }`}
              >
                <div className="font-medium">{p.label}</div>
                <div className="text-[9px] opacity-70 mt-0.5">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// props 均为基础类型 + useState setter（稳定），memo 可跳过无关重渲染
export const ExportOptionsPanel = memo(ExportOptionsPanelBase);
