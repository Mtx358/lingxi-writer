import { useState, useEffect } from 'react';
import { Plus, Lightbulb, BookOpen, FileText, Image, Music, Pin, ChevronRight, Paperclip, ExternalLink, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { MATERIAL_TYPE_LABELS, MATERIAL_TYPES, DEFAULT_MATERIAL_TYPE } from '@/types';
import type { Material, MaterialAttachment } from '@/types';
import { generateId } from '@/utils/storage';
import { IMAGE_CACHE_MAX_ENTRIES, IMAGE_ERROR_CACHE_TTL_MS } from '@/constants/config';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

// 模块级 LRU 缓存：file:// 路径 -> dataURL Promise。
// ImageFallback 每次渲染都会重新触发 electron bridge 读取，滚动列表时产生大量重复 IO 与内存峰值。
// 通过缓存层使相同路径只读取一次；命中时 bump 到队尾以维持 LRU 顺序。
const imageDataUrlCache = new Map<string, Promise<string>>();
// 错误缓存：path -> 失败时间戳。带 TTL，避免用户修复/移动图片后仍命中旧错误而永久占位。
const imageDataUrlErrors = new Map<string, number>();

const readImageDataUrl = (filePath: string): Promise<string> => {
  // 命中：删除后重新插入，将其挪到 LRU 队尾
  if (imageDataUrlCache.has(filePath)) {
    const promise = imageDataUrlCache.get(filePath)!;
    imageDataUrlCache.delete(filePath);
    imageDataUrlCache.set(filePath, promise);
    return promise;
  }
  // 已知失败：避免对同一损坏文件反复触发读取；但带 TTL，过期后允许重试
  const failedAt = imageDataUrlErrors.get(filePath);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < IMAGE_ERROR_CACHE_TTL_MS) {
      return Promise.reject(new Error('cached read failure'));
    }
    // 过期：清除错误缓存，重新尝试读取（用户可能已修复文件）
    imageDataUrlErrors.delete(filePath);
  }

  const electronAPI = window.electronAPI as unknown as { file?: { readDataURL?: (p: string) => Promise<string> } } | undefined;
  const reader = electronAPI?.file?.readDataURL ?? (() => Promise.reject(new Error('electron bridge unavailable')));
  const promise = (reader as (p: string) => Promise<string>)(filePath).catch(err => {
    imageDataUrlCache.delete(filePath);
    imageDataUrlErrors.set(filePath, Date.now());
    throw err;
  });
  imageDataUrlCache.set(filePath, promise);

  // LRU 淘汰：超过上限时丢弃最久未访问（队首）的条目
  while (imageDataUrlCache.size > IMAGE_CACHE_MAX_ENTRIES) {
    const oldest = imageDataUrlCache.keys().next().value;
    if (oldest === undefined) break;
    imageDataUrlCache.delete(oldest);
  }
  return promise;
};

/**
 * 清空图片错误缓存（可选传入 path 仅清单个）。
 * 用于附件列表刷新、用户手动"重新加载"等场景，确保已修复的图片能立即重试读取。
 */
export function clearImageErrorCache(path?: string): void {
  if (path) {
    imageDataUrlErrors.delete(path);
  } else {
    imageDataUrlErrors.clear();
  }
}

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

function ImageFallback({ src, name }: { src: string; name: string }) {
  const [error, setError] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string>(src);

  // 开发环境下 http(s) 页面无法加载 file:// 资源
  // 通过 electron bridge 读取为 data URL；无 bridge 时降级显示占位图标
  // 命中模块级 LRU 缓存时不会重复读取磁盘
  useEffect(() => {
    let active = true;
    if (src.startsWith('file://')) {
      const electronAPI = window.electronAPI as unknown as { file?: { readDataURL?: (p: string) => Promise<string> } } | undefined;
      if (electronAPI?.file?.readDataURL) {
        readImageDataUrl(src.replace('file://', ''))
          .then(dataUrl => { if (active) setResolvedSrc(dataUrl); })
          .catch(() => { if (active) setError(true); });
      } else if (typeof window !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')) {
        // 开发环境无 electron bridge，直接标记错误，显示占位图标
        setError(true);
      }
    }
    return () => { active = false; };
  }, [src]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-ink-500 bg-ink-800/50">
        <Image className="w-6 h-6" />
      </div>
    );
  }
  return (
    <img
      src={resolvedSrc}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  );
}

const TYPE_ICONS: Record<Material['type'], typeof Lightbulb> = {
  inspiration: Lightbulb,
  reference: BookOpen,
  research: FileText,
  quote: FileText,
  image: Image,
  audio: Music,
};

const TYPE_COLORS: Record<Material['type'], string> = {
  inspiration: 'text-amber-400 bg-amber-400/10',
  reference: 'text-blue-400 bg-blue-400/10',
  research: 'text-purple-400 bg-purple-400/10',
  quote: 'text-emerald-400 bg-emerald-400/10',
  image: 'text-pink-400 bg-pink-400/10',
  audio: 'text-cyan-400 bg-cyan-400/10',
};

export default function MaterialsPanel() {
  const materials = useAppStore(s => s.materials);
  const addMaterial = useAppStore(s => s.addMaterial);
  const updateMaterial = useAppStore(s => s.updateMaterial);
  const currentProjectId = useAppStore(s => s.currentProjectId);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<'all' | Material['type']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<Material['type']>(DEFAULT_MATERIAL_TYPE);

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    addMaterial({ title: newTitle.trim(), type: newType });
    setNewTitle('');
    setShowAdd(false);
  };

  const handleAddAttachment = async (mat: Material) => {
    const api = window.electronAPI;
    if (!api) {
      alert('需要桌面版才能添加附件');
      return;
    }
    if (!currentProjectId) {
      alert('未打开项目，无法添加附件');
      return;
    }
    const fileInfo = await api.dialog.selectFile();
    if (!fileInfo) return;
    const attachmentId = generateId();
    // 将源文件复制到项目数据目录，避免原文件移动/删除后失效；杜绝 base64 内嵌
    const persistedPath = await api.material.saveAttachment(fileInfo.path, currentProjectId, attachmentId);
    // S4: 新增附件时清除该路径的错误缓存，覆盖"用户修复/替换文件后重新添加"场景
    clearImageErrorCache(persistedPath || fileInfo.path);
    const newAttachment: MaterialAttachment = {
      id: attachmentId,
      name: fileInfo.name,
      path: persistedPath || fileInfo.path, // 复制失败时回退到原路径
      size: fileInfo.size,
      ext: fileInfo.ext,
      addedAt: new Date().toISOString(),
    };
    updateMaterial(mat.id, { attachments: [...(mat.attachments || []), newAttachment] });
  };

  const handleOpenAttachment = async (att: MaterialAttachment) => {
    const api = window.electronAPI;
    if (!api) {
      alert('需要桌面版才能打开附件');
      return;
    }
    await api.file.openExternal(att.path);
  };

  const handleRemoveAttachment = (mat: Material, attId: string) => {
    const next = (mat.attachments || []).filter(a => a.id !== attId);
    updateMaterial(mat.id, { attachments: next });
  };

  const filtered = filter === 'all'
    ? materials.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
    : materials.filter(m => m.type === filter).sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200">素材库</span>
        <button
          onClick={() => setShowAdd(true)}
          className="p-1 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {showAdd && (
        <div className="p-3 border-b border-ink-800/50 bg-ink-800/30 space-y-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="素材标题..."
            className="input text-sm"
            autoFocus
          />
          <div className="grid grid-cols-3 gap-1">
            {MATERIAL_TYPES.slice(0, 6).map(type => (
              <button
                key={type}
                onClick={() => setNewType(type)}
                className={`py-1 text-[10px] rounded transition-colors ${
                  newType === type
                    ? `${TYPE_COLORS[type]} border border-current/30`
                    : 'bg-ink-700/50 text-ink-400 hover:text-ink-200'
                }`}
              >
                {MATERIAL_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setNewTitle(''); }} className="flex-1 btn btn-secondary text-xs">
              取消
            </button>
            <button onClick={handleAdd} className="flex-1 btn btn-primary text-xs">
              添加
            </button>
          </div>
        </div>
      )}

      {/* Type Filter */}
      <div className="flex gap-1 p-2 border-b border-ink-800/50 overflow-x-auto">
        <button
          onClick={() => setFilter('all')}
          className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
            filter === 'all'
              ? 'bg-ink-700 text-ink-200'
              : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800'
          }`}
        >
          全部 ({materials.length})
        </button>
        {MATERIAL_TYPES.map(type => {
          const count = materials.filter(m => m.type === type).length;
          if (count === 0) return null;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                filter === type
                  ? `${TYPE_COLORS[type]}`
                  : 'text-ink-500 hover:text-ink-300 hover:bg-ink-800'
              }`}
            >
              {MATERIAL_TYPE_LABELS[type]} ({count})
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filtered.length === 0 ? (
          <div className="p-6 text-center">
            <Lightbulb className="w-8 h-8 text-ink-600 mx-auto mb-2" />
            <p className="text-sm text-ink-500">暂无素材</p>
            <p className="text-xs text-ink-600">收集灵感、参考、研究笔记</p>
          </div>
        ) : (
          filtered.map(mat => {
            const Icon = TYPE_ICONS[mat.type];
            const isExpanded = expandedId === mat.id;

            return (
              <div
                key={mat.id}
                onClick={() => setExpandedId(isExpanded ? null : mat.id)}
                className="card p-2.5 cursor-pointer hover:border-ink-600/50 transition-colors group"
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
                          onClick={(e) => { e.stopPropagation(); handleAddAttachment(mat); }}
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
                                      onClick={(e) => { e.stopPropagation(); handleOpenAttachment(att); }}
                                      className="w-20 h-20 rounded bg-ink-700/50 overflow-hidden cursor-pointer flex-shrink-0 group relative"
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
                                      onClick={(e) => { e.stopPropagation(); handleRemoveAttachment(mat, att.id); }}
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
                                      onClick={(e) => { e.stopPropagation(); handleOpenAttachment(att); }}
                                      className="p-1 rounded text-ink-400 hover:text-blue-400 hover:bg-ink-700/70 transition-colors flex-shrink-0"
                                      title="打开"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleRemoveAttachment(mat, att.id); }}
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
                        onClick={(e) => { e.stopPropagation(); updateMaterial(mat.id, { pinned: !mat.pinned }); }}
                        className={`flex-1 py-1 text-[10px] rounded flex items-center justify-center gap-1 ${
                          mat.pinned
                            ? 'text-amber-400 bg-amber-400/10'
                            : 'text-ink-400 hover:text-ink-200 bg-ink-700/50'
                        }`}
                      >
                        <Pin className="w-3 h-3" />
                        {mat.pinned ? '已置顶' : '置顶'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
