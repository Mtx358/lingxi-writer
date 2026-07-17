import { useState, useEffect, useRef } from 'react';
import { Search, X, FileText, Users, Globe, Flag, Lightbulb, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

interface SearchModalProps {
  onClose: () => void;
}

const TYPE_CONFIG = {
  chapter: { icon: FileText, label: '章节', color: 'text-amber-400' },
  character: { icon: Users, label: '角色', color: 'text-blue-400' },
  setting: { icon: Globe, label: '设定', color: 'text-purple-400' },
  foreshadow: { icon: Flag, label: '伏笔', color: 'text-emerald-400' },
  material: { icon: Lightbulb, label: '素材', color: 'text-pink-400' },
};

export default function SearchModal({ onClose }: SearchModalProps) {
  const search = useAppStore(s => s.search);
  const searchResults = useAppStore(s => s.searchResults);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const setRightPanelTab = useAppStore(s => s.setRightPanelTab);
  const setRightPanelCollapsed = useAppStore(s => s.setRightPanelCollapsed);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入法组合状态下不处理，避免中文输入选字时误触发快捷键
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
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

  const groupedResults = searchResults.reduce((acc, result) => {
    if (!acc[result.type]) acc[result.type] = [];
    acc[result.type].push(result);
    return acc;
  }, {} as Record<string, typeof searchResults>);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 card overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-700/50">
          <Search className="w-5 h-5 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            placeholder="搜索章节、角色、设定、伏笔、素材..."
            className="flex-1 bg-transparent border-none outline-none text-ink-100 placeholder:text-ink-500"
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {query.trim() === '' ? (
            <div className="p-8 text-center">
              <Search className="w-10 h-10 text-ink-600 mx-auto mb-2" />
              <p className="text-sm text-ink-500">输入关键词开始搜索</p>
              <p className="text-xs text-ink-600 mt-1">支持搜索章节内容、角色、设定、伏笔、素材</p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-ink-500">没有找到相关结果</p>
              <p className="text-xs text-ink-600 mt-1">试试其他关键词</p>
            </div>
          ) : (
            <div className="p-2 space-y-3">
              {Object.entries(groupedResults).map(([type, results]) => {
                const config = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
                const Icon = config?.icon || FileText;
                return (
                  <div key={type}>
                    <div className="px-2 py-1 text-[10px] text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Icon className={`w-3 h-3 ${config?.color}`} />
                      {config?.label || type}
                      <span className="text-ink-600">({results.length})</span>
                    </div>
                    <div className="space-y-0.5">
                      {results.slice(0, 5).map((result, idx) => (
                        <button
                          key={`${result.type}-${result.id}-${idx}`}
                          onClick={() => handleResultClick(result)}
                          className="w-full px-3 py-2 rounded text-left hover:bg-ink-800/50 transition-colors group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-ink-200 group-hover:text-ink-100">
                              {result.title}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-ink-600 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          {result.preview && (
                            <p className="text-xs text-ink-500 mt-0.5 line-clamp-1">
                              {result.preview}
                            </p>
                          )}
                        </button>
                      ))}
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
