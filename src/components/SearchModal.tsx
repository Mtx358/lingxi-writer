import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, FileText, Users, Globe, Flag, Lightbulb, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { pushOverlay, popOverlay } from '@/utils/overlayState';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import Empty from '@/components/Empty';
import type { SearchEntry } from '@/store/appState';

interface SearchModalProps {
  onClose: () => void;
}

const TYPE_CONFIG = {
  chapter: { icon: FileText, label: '章节', color: 'text-amber-400' },
  character: { icon: Users, label: '角色', color: 'text-blue-400' },
  setting: { icon: Globe, label: '设定', color: 'text-purple-400' },
  foreshadow: { icon: Flag, label: '伏笔', color: 'text-emerald-400' },
  material: { icon: Lightbulb, label: '素材', color: 'text-pink-400' },
} as const;

// 每个分组最多展示的条目数，与原实现保持一致
const MAX_RESULTS_PER_TYPE = 5;

export default function SearchModal({ onClose }: SearchModalProps) {
  const search = useAppStore(s => s.search);
  const searchResults = useAppStore(s => s.searchResults);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const setRightPanelTab = useAppStore(s => s.setRightPanelTab);
  const setRightPanelCollapsed = useAppStore(s => s.setRightPanelCollapsed);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // 焦点陷阱：组件挂载即视为打开（由父级条件渲染控制），Tab 在搜索面板内循环
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // selectedIndex 的 ref 镜像：键盘 effect 只依赖 [flatResults, onClose]，
  // 通过 ref 读取最新选中索引，避免每次按键移动都重新订阅/解绑 window keydown 监听器。
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);
  // 选中项 DOM 引用，用于自动滚动到可视区
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // O3: 注册浮层状态，使全局快捷键（Ctrl+S/K 等）在搜索弹窗打开期间被屏蔽，
  // 避免按键同时触发后台动作与弹窗交互。卸载时配对 pop，防止计数器泄漏。
  useEffect(() => {
    pushOverlay();
    return () => popOverlay();
  }, []);

  // 按显示顺序展开：先按 type 分组（保持插入顺序），每组取前 N 项。
  // 渲染与键盘导航共用同一份结构，保证 flatIndex 与可见按钮一一对应。
  const renderedGroups = useMemo(() => {
    const grouped = searchResults.reduce((acc, result) => {
      if (!acc[result.type]) acc[result.type] = [];
      acc[result.type].push(result);
      return acc;
    }, {} as Record<string, SearchEntry[]>);
    let flatIdx = 0;
    return Object.entries(grouped).map(([type, results]) => {
      const sliced = results.slice(0, MAX_RESULTS_PER_TYPE);
      const startIdx = flatIdx;
      flatIdx += sliced.length;
      return { type, results: sliced, totalCount: results.length, startIdx };
    });
  }, [searchResults]);

  const flatLength = useMemo(
    () => renderedGroups.reduce((sum, g) => sum + g.results.length, 0),
    [renderedGroups],
  );

  // flatResults 变化时若当前 selectedIndex 越界则 clamp 回 0，
  // 避免列表缩短后选中索引指向不存在的项。
  useEffect(() => {
    if (selectedIndex > flatLength - 1) {
      setSelectedIndex(0);
    }
  }, [flatLength, selectedIndex]);

  // 选中项变化时滚动到可视区，避免键盘导航到列表底部时被遮挡
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入法组合状态下不处理，避免中文输入选字时误触发快捷键
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        // 阻止输入框光标移动到行尾的默认行为
        e.preventDefault();
        setSelectedIndex(prev => (flatLength > 0 ? Math.min(prev + 1, flatLength - 1) : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        const item = searchResults.length > 0 ? selectedIndexToEntry(selectedIndexRef.current) : null;
        // 仅当输入框聚焦时拦截 Enter：若焦点在 X 按钮等其他控件上，应让默认行为触发该控件点击
        if (item && document.activeElement === inputRef.current) {
          e.preventDefault();
          handleResultClick(item);
        }
      }
    };
    // O3: 使用捕获阶段确保先于编辑器/prosemirror 处理 Esc
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // 通过 selectedIndexRef 读取最新选中索引，effect 无需依赖 selectedIndex，
    // 避免每次按键移动都重新订阅/解绑 window keydown 监听器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, flatLength, searchResults, renderedGroups]);

  // flatIndex -> SearchEntry 的映射，供 Enter 处理时查询当前选中项
  const selectedIndexToEntry = (flatIndex: number): SearchEntry | null => {
    for (const g of renderedGroups) {
      if (flatIndex < g.startIdx + g.results.length) {
        return g.results[flatIndex - g.startIdx];
      }
    }
    return null;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    // 输入变化时重置选中项到第一项，避免选中索引指向新结果中不存在的项
    setSelectedIndex(0);
    search(value);
  };

  const handleResultClick = (result: { type: string; id: string }) => {
    // 根据结果类型切换面板并定位
    switch (result.type) {
      case 'chapter':
        setCurrentChapter(result.id);
        break;
      case 'character':
        setRightPanelTab('characters');
        setRightPanelCollapsed(false);
        break;
      case 'setting':
        setRightPanelTab('settings');
        setRightPanelCollapsed(false);
        break;
      case 'foreshadow':
        setRightPanelTab('foreshadows');
        setRightPanelCollapsed(false);
        break;
      case 'material':
        setRightPanelTab('materials');
        setRightPanelCollapsed(false);
        break;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-xl mx-4 card overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-700/50">
          <Search className="w-5 h-5 text-ink-500" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            placeholder="搜索章节、角色、设定、伏笔、素材..."
            className="flex-1 bg-transparent border-none outline-none text-ink-100 placeholder:text-ink-500"
            aria-label="搜索关键词"
            aria-controls="search-results-list"
            aria-autocomplete="list"
            aria-expanded={flatLength > 0}
            aria-activedescendant={
              flatLength > 0 ? `search-result-${selectedIndex}` : undefined
            }
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
            aria-label="关闭搜索"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Results */}
        <div
          className="max-h-[50vh] overflow-y-auto"
          id="search-results-list"
          role="listbox"
          aria-label="搜索结果"
        >
          {query.trim() === '' ? (
            <Empty
              icon={<Search className="w-10 h-10 text-ink-600" aria-hidden="true" />}
              title="输入关键词开始搜索"
              description="支持搜索章节内容、角色、设定、伏笔、素材"
              className="p-8"
            />
          ) : searchResults.length === 0 ? (
            <Empty
              title="没有找到相关结果"
              description="试试其他关键词"
              className="p-8"
            />
          ) : (
            <div className="p-2 space-y-3">
              {renderedGroups.map(({ type, results, totalCount, startIdx }) => {
                const config = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
                const Icon = config?.icon || FileText;
                return (
                  <div key={type}>
                    <div className="px-2 py-1 text-[10px] text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Icon className={`w-3 h-3 ${config?.color}`} aria-hidden="true" />
                      {config?.label || type}
                      <span className="text-ink-600">({totalCount})</span>
                    </div>
                    <div className="space-y-0.5" role="presentation">
                      {results.map((result, idx) => {
                        const flatIndex = startIdx + idx;
                        const isSelected = flatIndex === selectedIndex;
                        return (
                          <button
                            key={`${result.type}-${result.id}-${idx}`}
                            ref={isSelected ? selectedRef : undefined}
                            id={`search-result-${flatIndex}`}
                            onClick={() => handleResultClick(result)}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                            className={`w-full px-3 py-2 rounded text-left transition-colors group ${
                              isSelected ? 'bg-amber-400/15' : 'hover:bg-ink-800/50'
                            }`}
                            role="option"
                            aria-selected={isSelected}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-sm ${
                                  isSelected
                                    ? 'text-amber-300'
                                    : 'text-ink-200 group-hover:text-ink-100'
                                }`}
                              >
                                {result.title}
                              </span>
                              <ArrowRight
                                className={`w-3.5 h-3.5 transition-opacity ${
                                  isSelected
                                    ? 'text-amber-400 opacity-100'
                                    : 'text-ink-600 group-hover:text-amber-400 opacity-0 group-hover:opacity-100'
                                }`}
                                aria-hidden="true"
                              />
                            </div>
                            {result.preview && (
                              <p className="text-xs text-ink-500 mt-0.5 line-clamp-1">
                                {result.preview}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-ink-700/50 flex items-center justify-between text-[10px] text-ink-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 bg-ink-800 rounded text-ink-400">↑↓</kbd> 导航
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-ink-800 rounded text-ink-400">Enter</kbd> 打开
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-ink-800 rounded text-ink-400">Esc</kbd> 关闭
            </span>
          </div>
          {searchResults.length > 0 && (
            <span className="text-ink-500">找到 {searchResults.length} 个结果</span>
          )}
        </div>
      </div>
    </div>
  );
}
