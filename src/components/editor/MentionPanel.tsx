import { useState, useEffect, useRef, useMemo } from 'react';
import { useEditor } from '@tiptap/react';
import { User, Globe, Search } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Character, SettingItem } from '@/types';

interface MentionPanelProps {
  editor: ReturnType<typeof useEditor>;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function MentionPanel({ editor, position, onClose }: MentionPanelProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'all' | 'characters' | 'settings'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const characters = useAppStore(s => s.characters);
  const settingItems = useAppStore(s => s.settingItems);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredItems = useMemo(() => {
    let items: Array<{ id: string; label: string; type: string; data: Character | SettingItem }> = [];
    
    if (activeTab === 'all' || activeTab === 'characters') {
      items = items.concat(
        characters.map(c => ({
          id: c.id,
          label: c.name,
          type: 'character',
          data: c,
        }))
      );
    }
    
    if (activeTab === 'all' || activeTab === 'settings') {
      items = items.concat(
        settingItems.map(s => ({
          id: s.id,
          label: s.name,
          type: 'setting',
          data: s,
        }))
      );
    }

    if (query) {
      const lowerQuery = query.toLowerCase();
      items = items.filter(item => 
        item.label.toLowerCase().includes(lowerQuery)
      );
    }

    return items;
  }, [characters, settingItems, activeTab, query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editor) return;
      // 输入法组合状态下不处理，避免中文输入误触发
      if (e.isComposing || e.keyCode === 229) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
        e.preventDefault();
        selectItem(filteredItems[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // selectItem 依赖 editor/onClose，不会变化，故省略
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onClose, filteredItems, selectedIndex]);

  const selectItem = (item: { id: string; label: string; type: string }) => {
    if (!editor) return;

    const cursorPos = editor.state.selection.from;

    // 直接在文档中查找光标前最后一个 '@' 的 ProseMirror 位置。
    // 不再用 textBetween(0, pos) + lastIndexOf + 偏移换算——多段落场景下
    // 字符串索引到 PM 位置的换算会因 blockSeparator 不一致而错位，
    // 导致 '@' 残留或多删前一个字符。
    let atPos: number | null = null;
    editor.state.doc.nodesBetween(0, cursorPos, (node, pos) => {
      if (node.isText && node.text) {
        const available = Math.min(node.text.length, cursorPos - pos);
        if (available <= 0) return;
        const idx = node.text.slice(0, available).lastIndexOf('@');
        if (idx !== -1) {
          atPos = pos + idx; // '@' 字符的 PM 位置（即其左侧边界）
        }
      }
    });

    if (atPos === null) {
      onClose();
      return;
    }

    // 删除从 '@' 起到光标位置的所有内容（含 '@' 与搜索词），再插入提及
    editor.chain().focus().deleteRange({ from: atPos, to: cursorPos }).insertMention(item).run();
    onClose();
  };

  const tabs = [
    { id: 'all', label: '全部', icon: Search },
    { id: 'characters', label: '角色', icon: User },
    { id: 'settings', label: '设定', icon: Globe },
  ] as const;

  return (
    <div
      className="fixed z-50 bg-ink-800 border border-ink-700 rounded-lg shadow-xl w-80 overflow-hidden"
      style={{
        left: Math.min(position.x, window.innerWidth - 320),
        top: Math.min(position.y, window.innerHeight - 320),
      }}
    >
      <div className="flex border-b border-ink-700">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedIndex(0); }}
            className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors ${
              activeTab === tab.id 
                ? 'text-amber-400 bg-amber-400/10' 
                : 'text-ink-500 hover:text-ink-300 hover:bg-ink-700/50'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
        placeholder="搜索..."
        className="w-full px-3 py-2 bg-ink-800 border-b border-ink-700 text-sm text-ink-100 outline-none focus:ring-1 focus:ring-amber-400/30"
      />

      <div className="max-h-64 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="p-4 text-center text-ink-500 text-xs">
            {query ? '未找到匹配项' : '暂无数据'}
          </div>
        ) : (
          filteredItems.map((item, index) => (
            <button
              key={item.id}
              onClick={() => selectItem(item)}
              className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
                index === selectedIndex 
                  ? 'bg-amber-400/20' 
                  : 'hover:bg-ink-700/50'
              }`}
            >
              {item.type === 'character' ? (
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white flex-shrink-0"
                  style={{ backgroundColor: (item.data as Character).color }}
                >
                  {item.label.charAt(0)}
                </span>
              ) : (
                <Globe className="w-5 h-5 text-purple-400 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-100 truncate">{item.label}</div>
                <div className="text-[10px] text-ink-500">
                  {item.type === 'character' ? '角色' : '设定'}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-ink-700 flex items-center justify-between text-[10px] text-ink-500">
        <span>Enter 确认</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
}