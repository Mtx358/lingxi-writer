import { memo } from 'react';
import { Pin, ChevronRight, Paperclip, ExternalLink, X, HelpCircle, Image, FileText, Music } from 'lucide-react';
import { MATERIAL_TYPE_LABELS } from '@/types';
import { ImageFallback } from './ImageFallback';
import { IMAGE_EXTS, AUDIO_EXTS, TYPE_ICONS, TYPE_COLORS } from './constants';
import type { MaterialItemProps } from './types';

function getAttachmentIcon(ext: string) {
  if (IMAGE_EXTS.includes(ext)) return Image;
  if (AUDIO_EXTS.includes(ext)) return Music;
  return FileText;
}

function formatFileSize(size: number): string {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(1) + ' MB';
}

function MaterialItem({
  mat,
  isExpanded,
  onToggleExpand,
  onTogglePinned,
  onAsk,
  onAddAttachment,
  onOpenAttachment,
  onRemoveAttachment,
}: MaterialItemProps) {
  const Icon = TYPE_ICONS[mat.type];
  return (
    <div
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' }}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`${isExpanded ? '折叠' : '展开'}素材：${mat.title}`}
      onClick={() => onToggleExpand(mat)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand(mat);
        }
      }}
      className="card p-2.5 cursor-pointer hover:border-ink-600/50 transition-colors group focus:outline-none focus:ring-1 focus:ring-amber-400/50"
    >
      <div className="flex items-start gap-2">
        <div className={`w-7 h-7 rounded flex-shrink-0 flex items-center justify-center ${TYPE_COLORS[mat.type]}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-sm text-ink-200 truncate">{mat.title}</span>
            {mat.pinned && <Pin className="w-3 h-3 text-amber-400 flex-shrink-0" />}
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            {MATERIAL_TYPE_LABELS[mat.type]}
            {mat.tags.length > 0 && ` · ${mat.tags.slice(0, 2).join('、')}`}
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-ink-500 flex-shrink-0 transition-transform ${
          isExpanded ? 'rotate-90' : ''
        }`} />
      </div>

      {isExpanded && (
        <div className="mt-2 pt-2 border-t border-ink-700/50 space-y-2 animate-slide-down">
          <div className="text-xs text-ink-400 leading-relaxed whitespace-pre-wrap line-clamp-4">
            {mat.content || '暂无内容'}
          </div>
          {mat.source && (
            <div className="text-[10px] text-ink-500">
              来源：{mat.source}
            </div>
          )}

          {/* 附件区域 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-500 flex items-center gap-1">
                <Paperclip className="w-3 h-3" />
                附件 {(mat.attachments?.length || 0) > 0 && `(${mat.attachments!.length})`}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onAddAttachment(mat); }}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-ink-400 hover:text-amber-400 hover:bg-ink-700/50 transition-colors"
                title="添加附件"
              >
                <Paperclip className="w-3 h-3" />
                添加附件
              </button>
            </div>
            {(mat.attachments?.length || 0) > 0 && (
              <div className="space-y-2">
                {mat.attachments!.map(att => {
                  const isImage = IMAGE_EXTS.includes(att.ext);
                  return (
                    <div
                      key={att.id}
                      className={`p-1.5 rounded transition-colors ${
                        isImage ? 'bg-ink-800/20' : 'bg-ink-800/40 hover:bg-ink-700/40'
                      }`}
                    >
                      {isImage ? (
                        <div className="flex items-start gap-2">
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={`查看附件大图：${att.name}`}
                            onClick={(e) => { e.stopPropagation(); onOpenAttachment(att); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onOpenAttachment(att);
                              }
                            }}
                            className="w-20 h-20 rounded bg-ink-700/50 overflow-hidden cursor-pointer flex-shrink-0 group relative focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                            title="点击查看大图"
                          >
                            <ImageFallback src={`file://${att.path}`} name={att.name} />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                              <ExternalLink className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 pt-1">
                            <div className="text-[11px] text-ink-200 truncate font-medium">{att.name}</div>
                            <div className="text-[9px] text-ink-500 mt-0.5">{formatFileSize(att.size)} · 图片</div>
                            <div className="text-[9px] text-ink-600 mt-0.5 flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" />
                              点击打开
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveAttachment(mat, att); }}
                            className="p-1 rounded text-ink-500 hover:text-red-400 hover:bg-ink-700/70 transition-colors flex-shrink-0"
                            title="删除"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {(() => { const Icon = getAttachmentIcon(att.ext); return <Icon className="w-3.5 h-3.5 text-ink-400 flex-shrink-0" />; })()}
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-ink-200 truncate">{att.name}</div>
                            <div className="text-[9px] text-ink-500">{formatFileSize(att.size)}{att.ext && ` · ${att.ext}`}</div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenAttachment(att); }}
                            className="p-1 rounded text-ink-400 hover:text-blue-400 hover:bg-ink-700/70 transition-colors flex-shrink-0"
                            title="打开"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveAttachment(mat, att); }}
                            className="p-1 rounded text-ink-500 hover:text-red-400 hover:bg-ink-700/70 transition-colors flex-shrink-0"
                            title="删除"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePinned(mat); }}
              className={`flex-1 py-1 text-[10px] rounded flex items-center justify-center gap-1 ${
                mat.pinned
                  ? 'text-amber-400 bg-amber-400/10'
                  : 'text-ink-400 hover:text-ink-200 bg-ink-700/50'
              }`}
            >
              <Pin className="w-3 h-3" />
              {mat.pinned ? '已置顶' : '置顶'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAsk(mat); }}
              className="flex-1 py-1 text-[10px] rounded flex items-center justify-center gap-1 text-cyan-400 hover:text-cyan-200 bg-cyan-500/10"
              title="AI 对这张卡片深度提问，帮你磨出细节"
            >
              <HelpCircle className="w-3 h-3" />
              深度提问
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// props 浅比较：mat 引用 + isExpanded + 稳定回调引用
function areMaterialItemPropsEqual(prev: MaterialItemProps, next: MaterialItemProps): boolean {
  return (
    prev.mat === next.mat &&
    prev.isExpanded === next.isExpanded &&
    prev.onToggleExpand === next.onToggleExpand &&
    prev.onTogglePinned === next.onTogglePinned &&
    prev.onAsk === next.onAsk &&
    prev.onAddAttachment === next.onAddAttachment &&
    prev.onOpenAttachment === next.onOpenAttachment &&
    prev.onRemoveAttachment === next.onRemoveAttachment
  );
}

export const MemoizedMaterialItem = memo(MaterialItem, areMaterialItemPropsEqual);
