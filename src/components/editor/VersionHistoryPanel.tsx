import { useState, useEffect, useMemo, useRef } from 'react';
import { History, Save, Clock, RotateCcw, X, Check, ChevronRight, FileText, Trash2, Loader2, MapPin } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ChapterVersion } from '@/types';
import { formatDate } from '@/utils/storage';
import { computeHtmlBlockDiff, applyHtmlDiffRejections } from '@/utils/diff';
import { confirm } from '@/hooks/useConfirm';
import type { HtmlBlockDiff } from '@/utils/diff';
import Empty from '@/components/Empty';

interface VersionHistoryPanelProps {
  onClose?: () => void;
}

export default function VersionHistoryPanel({ onClose }: VersionHistoryPanelProps) {
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const chapters = useAppStore(s => s.chapters);
  const versions = useAppStore(s => s.versions);
  const saveVersion = useAppStore(s => s.saveVersion);
  const restoreVersion = useAppStore(s => s.restoreVersion);
  const updateChapterContent = useAppStore(s => s.updateChapterContent);
  const bumpContentEpoch = useAppStore(s => s.bumpContentEpoch);
  const deleteVersion = useAppStore(s => s.deleteVersion);
  const setPendingScrollTo = useAppStore(s => s.setPendingScrollTo);
  const [selectedVersion, setSelectedVersion] = useState<ChapterVersion | null>(null);
  // 统一使用 HTML 块级 diff 作为单一数据源，消除行级/块级双轨索引映射
  const [htmlDiffResult, setHtmlDiffResult] = useState<HtmlBlockDiff[]>([]);
  // I3: diff 应用规则为“勾选要撤销的修改”——拒绝的段落回退到旧版本，其余全部保留新版本。
  // 此前存在的 acceptedBlocks 仅为 UI 高亮、无业务作用，已移除以避免“需逐个点接受才保留”的误解。
  const [rejectedBlocks, setRejectedBlocks] = useState<Set<number>>(new Set());
  // P-M8: modified 块的 charDiffs 按需展开，避免大文档字符级 diff spans 导致 DOM 膨胀
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
  const [versionName, setVersionName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isComputingDiff, setIsComputingDiff] = useState(false);
  // 记录计算 diff 时的 currentChapter.content 快照（用长度+前缀作为简易 hash），
  // 应用更改前比对，若章节内容已被外部修改则提示用户重新选择版本，避免基于过期 diff 写入。
  const [diffContentHash, setDiffContentHash] = useState<string>('');

  const currentChapter = chapters.find(c => c.id === currentChapterId);
  // 仅订阅 versions 对象 + currentChapterId，用 useMemo 派生当前章节的版本数组，
  // 避免每次渲染都生成新数组引用导致 sortedVersions/useEffect 重算
  const chapterVersions = useMemo(
    () => currentChapterId ? (versions[currentChapterId] || []) : [],
    [versions, currentChapterId]
  );
  const sortedVersions = useMemo(() => [...chapterVersions].sort((a, b) =>
    new Date(b.snapshotTime).getTime() - new Date(a.snapshotTime).getTime()
  ), [chapterVersions]);

  // mountedRef 守卫：组件卸载后 setTimeout 回调不再 setState，避免内存泄漏与 React 警告
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (selectedVersion && currentChapter) {
      setIsComputingDiff(true);
      // 用 setTimeout 让出一帧，避免长计算阻塞 UI
      const timer = setTimeout(() => {
        if (!mountedRef.current) return;
        // 单一数据源：仅计算 HTML 块级 diff，展示与应用共享同一套索引
        const htmlDiff = computeHtmlBlockDiff(selectedVersion.content, currentChapter.content);
        setHtmlDiffResult(htmlDiff);
        setRejectedBlocks(new Set());
        setExpandedBlocks(new Set());
        // 记录计算 diff 时的内容快照，供 handleApplyChanges 校验是否过期。
        // 取 head+tail+length 三元组：仅取前 64 字符时，64 字符之后的修改无法检测，
        // 会让基于过期 diff 的 applyHtmlDiffRejections 破坏内容。
        // 取首尾各 256 字符 + 总长度，可覆盖 99% 的真实编辑场景（段首/段尾/中段插入），
        // 同时避免对超大章节做完整 hash 的性能开销。
        const snapshot = currentChapter.content;
        setDiffContentHash(
          `${snapshot.length}:${snapshot.slice(0, 256)}:${snapshot.slice(-256)}`
        );
        setIsComputingDiff(false);
      }, 30);
      return () => {
        clearTimeout(timer);
        // 条件变化或卸载时复位加载态，避免边界场景下 isComputingDiff 卡在 true
        if (mountedRef.current) setIsComputingDiff(false);
      };
    }
    // 条件不满足（无选中版本或无章节）时无条件复位，确保不会卡在 loading 态
    if (mountedRef.current) {
      setIsComputingDiff(false);
      setHtmlDiffResult([]);
      setRejectedBlocks(new Set());
      setExpandedBlocks(new Set());
    }
  }, [selectedVersion, currentChapter]);

  // 镜像 showSaveDialog 状态，供 Esc 监听器读取最新值（避免闭包陈旧）
  const showSaveDialogRef = useRef(false);
  useEffect(() => {
    showSaveDialogRef.current = showSaveDialog;
  }, [showSaveDialog]);

  // Esc 关闭抽屉：内嵌保存对话框打开时优先关闭对话框，避免误关整个抽屉；
  // IME 组合输入时忽略，避免中断中文输入。
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Escape') return;
      if (showSaveDialogRef.current) {
        setShowSaveDialog(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const handleSaveVersion = () => {
    if (!currentChapterId) return;
    saveVersion(currentChapterId, versionName || undefined);
    setShowSaveDialog(false);
    setVersionName('');
  };

  const handleRestore = async (version: ChapterVersion) => {
    if (!currentChapterId) return;
    if (await confirm('确定要恢复到此版本吗？当前内容将被覆盖。')) {
      restoreVersion(currentChapterId, version.id);
      // 章节 ID 未变化，编辑器无法感知 store 内容被外部替换；通知编辑器强制刷新
      bumpContentEpoch();
      setSelectedVersion(null);
    }
  };

  // I3: 仅保留“拒绝”操作。拒绝 = 标记该段落回退到旧版本；未标记的段落一律保留新版本。
  const handleRejectBlock = (index: number) => {
    setRejectedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // P-M8: 切换 modified 块的字符级差异展开状态
  const toggleBlockExpand = (index: number) => {
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!currentChapterId) return;
    if (await confirm('确定删除此历史版本吗？')) {
      deleteVersion(currentChapterId, versionId);
    }
  };

  // 在编辑器中定位当前版本的某个 diff 块：通过 blockText 让 TiptapEditor
  // 查找首个文本包含该片段的段落并滚动高亮。仅对当前版本存在的块有效。
  const handleLocateInEditor = (block: HtmlBlockDiff) => {
    if (!currentChapterId || !block.rightBlock?.textContent) return;
    setPendingScrollTo({
      chapterId: currentChapterId,
      blockText: block.rightBlock.textContent,
      timestamp: Date.now(),
    });
  };

  const handleApplyChanges = () => {
    if (!currentChapterId || !currentChapter || !selectedVersion) return;
    if (rejectedBlocks.size === 0) {
      alert('请先选择要拒绝的修改');
      return;
    }

    // 校验 diff 是否过期：比对当前章节内容与计算 diff 时的快照 hash。
    // 若章节内容已被外部编辑（如编辑器内继续输入），基于旧 diff 应用会破坏内容。
    // 取 head+tail+length 三元组，与 computeDiff 时一致。
    const c = currentChapter.content;
    const currentHash = `${c.length}:${c.slice(0, 256)}:${c.slice(-256)}`;
    if (currentHash !== diffContentHash) {
      alert('章节内容在计算差异后已发生变化，差异结果已过期。\n请重新选择版本以重新计算差异后再应用。');
      setSelectedVersion(null);
      return;
    }

    // 操作前自动保存当前版本，确保可回滚
    saveVersion(currentChapterId, '应用更改前自动备份');

    // rejectedBlocks 索引与 htmlDiffResult 完全一致（单一数据源），无需映射
    const newHtml = applyHtmlDiffRejections(currentChapter.content, htmlDiffResult, rejectedBlocks);
    updateChapterContent(currentChapterId, newHtml);
    // 外部替换内容，通知编辑器强制刷新
    bumpContentEpoch();
    alert(`已成功应用更改，撤销了 ${rejectedBlocks.size} 处修改\n\n已保留未修改段落的富文本格式（加粗、斜体、标题等）`);
    setSelectedVersion(null);
  };

  // 分开统计四类，避免 modified 被同时计入 added 和 removed 导致数值失真。
  // 用 useMemo 包裹，仅随 htmlDiffResult 变化重算。
  const stats = useMemo(() => {
    let added = 0, removed = 0, modified = 0, unchanged = 0;
    for (const d of htmlDiffResult) {
      if (d.type === 'added') added++;
      else if (d.type === 'removed') removed++;
      else if (d.type === 'modified') modified++;
      else if (d.type === 'unchanged') unchanged++;
    }
    return { added, removed, modified, unchanged };
  }, [htmlDiffResult]);

  if (!currentChapter) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-ink-500 text-sm">请先选择一个章节</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" role="region" aria-label="版本历史">
      {/* Header */}
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200 flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          版本历史
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSaveDialog(true)}
            className="p-1.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
            title="保存当前版本"
            aria-label="保存当前版本"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
              aria-label="关闭版本历史"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="p-3 border-b border-ink-800/50 bg-ink-800/30">
          <input
            value={versionName}
            onChange={(e) => setVersionName(e.target.value)}
            placeholder="版本备注（可选）..."
            className="input text-sm mb-2"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSaveVersion()}
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setShowSaveDialog(false); setVersionName(''); }}
              className="flex-1 btn btn-secondary text-xs"
            >
              取消
            </button>
            <button
              onClick={handleSaveVersion}
              className="flex-1 btn btn-primary text-xs"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* Version List / Diff View */}
      {!selectedVersion ? (
        <div className="flex-1 overflow-y-auto">
          {sortedVersions.length === 0 ? (
            <Empty
              icon={<History className="w-8 h-8 text-ink-600" />}
              title="暂无历史版本"
              description="点击上方保存按钮创建快照"
              className="p-6"
            />
          ) : (
            <div className="p-2 space-y-1">
              {/* Current version indicator */}
              <div className="px-2 py-1.5 text-[10px] text-ink-500 uppercase tracking-wider">
                当前
              </div>
              <div className="px-2 py-2 rounded bg-amber-400/10 border border-amber-400/20 mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-amber-300 font-medium">当前版本</span>
                </div>
                <div className="text-xs text-ink-400 mt-1">
                  {currentChapter.wordCount.toLocaleString()} 字
                </div>
              </div>

              <div className="px-2 py-1.5 text-[10px] text-ink-500 uppercase tracking-wider">
                历史版本 ({sortedVersions.length})
              </div>
              {sortedVersions.map((version) => (
                <div
                  key={version.id}
                  onClick={() => setSelectedVersion(version)}
                  className="w-full p-2 rounded text-left hover:bg-ink-800/50 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" />
                    <span className="text-sm text-ink-200 flex-1 truncate">
                      {version.description || `版本 ${version.version}`}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteVersion(version.id);
                      }}
                      className="p-1 rounded text-ink-500 hover:text-red-400 hover:bg-ink-700 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      title="删除此版本"
                      aria-label="删除此版本"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-ink-600 group-hover:text-ink-400 flex-shrink-0" />
                  </div>
                  <div className="flex items-center justify-between mt-1 ml-5.5">
                    <span className="text-[10px] text-ink-500">
                      {formatDate(version.snapshotTime)}
                    </span>
                    <span className="text-[10px] text-ink-500">
                      {version.wordCount.toLocaleString()} 字
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Diff Header */}
          <div className="px-3 py-2 border-b border-ink-800/50 flex items-center gap-2">
            <button
              onClick={() => setSelectedVersion(null)}
              className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800"
              aria-label="返回版本列表"
            >
              <ChevronRight className="w-4 h-4 rotate-180" aria-hidden="true" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink-200 truncate">
                {selectedVersion.description || `版本 ${selectedVersion.version}`}
              </div>
              <div className="text-[10px] text-ink-500">
                {formatDate(selectedVersion.snapshotTime)}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="px-3 py-2 border-b border-ink-800/50 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              +{stats.added}
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              -{stats.removed}
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              ~{stats.modified}
            </span>
            <span className="text-ink-500 ml-auto">
              {stats.unchanged} 段未变
            </span>
          </div>

          {/* Action Buttons */}
          <div className="px-3 py-2 border-b border-ink-800/50 flex gap-2 items-center">
            <button
              onClick={() => handleRestore(selectedVersion)}
              className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复此版本
            </button>
            <button
              onClick={handleApplyChanges}
              className="flex-1 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1"
              title="将拒绝的段落回退到旧版本"
            >
              <Check className="w-3.5 h-3.5" />
              应用更改
            </button>
            <span className="text-[10px] text-amber-400/80 whitespace-nowrap">
              已拒 {rejectedBlocks.size}
            </span>
          </div>

          {/* I3: diff 应用规则说明，避免“接受/拒绝”按钮语义混淆 */}
          <div className="px-3 py-1.5 border-b border-ink-800/50 bg-ink-800/20 text-[10px] text-ink-500 leading-relaxed">
            规则：默认保留当前版本的全部修改。点击段落右侧的 <span className="text-red-400">✕</span> 标记要撤销的段落，再点“应用更改”将这些段落回退到旧版本；未标记的段落保持不变。
          </div>

          {/* Diff Content */}
          <div className="flex-1 overflow-y-auto">
            {isComputingDiff ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-500 gap-3 py-12">
                <Loader2 className="w-8 h-8 animate-spin text-ink-400" />
                <span className="text-xs">正在计算版本差异...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-px bg-ink-800/50">
                {/* Left - Old Version */}
                <div className="bg-ink-900/50">
                  <div className="sticky top-0 px-2 py-1.5 text-[10px] text-ink-500 bg-ink-900/90 backdrop-blur-sm border-b border-ink-800/50">
                    旧版本
                  </div>
                  {htmlDiffResult.map((block, idx) => (
                  <div
                    key={`left-${idx}`}
                    className={`flex text-xs ${
                      block.type === 'removed' ? 'bg-red-500/10' :
                      block.type === 'added' ? 'bg-ink-800/30' :
                      block.type === 'modified' ? 'bg-red-500/5' :
                      ''
                    }`}
                  >
                    <span className="w-8 flex-shrink-0 text-right pr-2 text-ink-600 select-none py-0.5">
                      {block.leftNumber || ''}
                    </span>
                    <span className="flex-1 min-w-0 py-0.5 pr-2 break-words">
                      {block.type === 'removed' && (
                        <span className="text-red-300">
                          {block.charDiffs ? (
                            block.charDiffs.left.map((chunk, i) => (
                              <span
                                key={i}
                                className={chunk.type === 'removed' ? 'bg-red-500/30 rounded px-0.5' : ''}
                              >
                                {chunk.content}
                              </span>
                            ))
                          ) : (
                            block.leftBlock?.textContent
                          )}
                        </span>
                      )}
                      {block.type === 'added' && (
                        <span className="text-ink-600">&nbsp;</span>
                      )}
                      {block.type === 'unchanged' && (
                        <span className="text-ink-400">{block.leftBlock?.textContent}</span>
                      )}
                      {block.type === 'modified' && block.charDiffs && (
                        <span className="text-red-300">
                          {expandedBlocks.has(idx)
                            ? block.charDiffs.left.map((chunk, i) => (
                                <span
                                  key={i}
                                  className={chunk.type === 'removed' ? 'bg-red-500/30 rounded px-0.5' : ''}
                                >
                                  {chunk.content}
                                </span>
                              ))
                            : block.leftBlock?.textContent}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Right - New Version */}
              <div className="bg-ink-900/50">
                <div className="sticky top-0 px-2 py-1.5 text-[10px] text-ink-500 bg-ink-900/90 backdrop-blur-sm border-b border-ink-800/50">
                  当前版本
                </div>
                {htmlDiffResult.map((block, idx) => (
                  <div
                    key={`right-${idx}`}
                    className={`flex text-xs group ${
                      block.type === 'added' ? 'bg-emerald-500/10' :
                      block.type === 'removed' ? 'bg-ink-800/30' :
                      block.type === 'modified' ? 'bg-emerald-500/5' :
                      ''
                    }`}
                  >
                    <span className="w-8 flex-shrink-0 text-right pr-2 text-ink-600 select-none py-0.5">
                      {block.rightNumber || ''}
                    </span>
                    <span className="flex-1 min-w-0 py-0.5 pr-2 break-words">
                      {block.type === 'added' && (
                        <span className="text-emerald-300">{block.rightBlock?.textContent}</span>
                      )}
                      {block.type === 'removed' && (
                        <span className="text-ink-600">&nbsp;</span>
                      )}
                      {block.type === 'unchanged' && (
                        <span className="text-ink-400">{block.rightBlock?.textContent}</span>
                      )}
                      {block.type === 'modified' && block.charDiffs && (
                        <span className="text-emerald-300">
                          {expandedBlocks.has(idx)
                            ? block.charDiffs.right.map((chunk, i) => (
                                <span
                                  key={i}
                                  className={chunk.type === 'added' ? 'bg-emerald-500/30 rounded px-0.5' : ''}
                                >
                                  {chunk.content}
                                </span>
                              ))
                            : block.rightBlock?.textContent}
                        </span>
                      )}
                    </span>
                    {block.type === 'modified' && block.charDiffs && (
                      <div className="flex items-center pr-1">
                        <button
                          onClick={() => toggleBlockExpand(idx)}
                          className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-700"
                          title={expandedBlocks.has(idx) ? '收起字符级差异' : '展开字符级差异'}
                          aria-label={expandedBlocks.has(idx) ? '收起字符级差异' : '展开字符级差异'}
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform ${expandedBlocks.has(idx) ? 'rotate-90' : ''}`} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    {block.type !== 'unchanged' && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pr-1">
                        <button
                          onClick={() => handleRejectBlock(idx)}
                          className={`p-0.5 rounded ${
                            rejectedBlocks.has(idx)
                              ? 'text-red-400 bg-red-400/20'
                              : 'text-ink-500 hover:text-red-400 hover:bg-ink-700'
                          }`}
                          title={rejectedBlocks.has(idx) ? '取消撤销' : '撤销此段落（回退到旧版本）'}
                          aria-label="撤销此段落"
                        >
                          <X className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    {block.rightBlock && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center pr-1">
                        <button
                          onClick={() => handleLocateInEditor(block)}
                          className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-700"
                          title="在编辑器中定位此段落"
                          aria-label="在编辑器中定位此段落"
                        >
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
