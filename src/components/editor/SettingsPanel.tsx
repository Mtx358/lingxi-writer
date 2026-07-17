import { useState, useMemo } from 'react';
import { Plus, Globe, ChevronRight, BookOpen, Edit3, Trash2, Check, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { SettingItem } from '@/types';

function SettingItemEditor({ item, onDone }: { item: SettingItem; onDone: () => void }) {
  const updateSettingItem = useAppStore(s => s.updateSettingItem);
  const deleteSettingItem = useAppStore(s => s.deleteSettingItem);
  const [draftName, setDraftName] = useState(item.name);
  const [draftDesc, setDraftDesc] = useState(item.description);
  const [draftContent, setDraftContent] = useState(item.content);

  const handleSave = () => {
    updateSettingItem(item.id, { name: draftName, description: draftDesc, content: draftContent });
    onDone();
  };

  const handleDelete = () => {
    if (confirm(`删除设定"${item.name}"？`)) {
      deleteSettingItem(item.id);
      onDone();
    }
  };

  return (
    <div className="p-2 space-y-3 animate-slide-down">
      <div>
        <label className="block text-[10px] text-ink-500 mb-1">名称</label>
        <input
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          className="input text-xs py-1.5"
          placeholder="设定名称..."
          autoFocus
        />
      </div>
      <div>
        <label className="block text-[10px] text-ink-500 mb-1">描述</label>
        <input
          value={draftDesc}
          onChange={e => setDraftDesc(e.target.value)}
          className="input text-xs py-1.5"
          placeholder="简短描述..."
        />
      </div>
      <div>
        <label className="block text-[10px] text-ink-500 mb-1">详细内容</label>
        <textarea
          value={draftContent}
          onChange={e => setDraftContent(e.target.value)}
          rows={6}
          className="input text-xs py-1.5 resize-none"
          placeholder="输入设定详情..."
        />
      </div>
      <div className="flex gap-1">
        <button onClick={handleDelete} className="flex-1 btn btn-secondary text-xs py-1.5 flex items-center justify-center gap-1">
          <Trash2 className="w-3 h-3" />
          删除
        </button>
        <button onClick={onDone} className="flex-1 btn btn-secondary text-xs py-1.5">
          <X className="w-3 h-3" />
          取消
        </button>
        <button onClick={handleSave} className="flex-1 btn btn-primary text-xs py-1.5 flex items-center justify-center gap-1">
          <Check className="w-3 h-3" />
          保存
        </button>
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const settingCategories = useAppStore(s => s.settingCategories);
  const settingItems = useAppStore(s => s.settingItems);
  const addSettingCategory = useAppStore(s => s.addSettingCategory);
  const addSettingItem = useAppStore(s => s.addSettingItem);
  const [expandedCat, setExpandedCat] = useState<string | null>(
    settingCategories[0]?.id || null
  );
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [editingItem, setEditingItem] = useState<SettingItem | null>(null);

  // 预先按 categoryId 分组，避免每个分类渲染时都 filter 全量 settingItems（O(n*m)）。
  // 引用稳定，分类行未变化时不会触发重渲染。
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, SettingItem[]>();
    for (const item of settingItems) {
      let arr = map.get(item.categoryId);
      if (!arr) {
        arr = [];
        map.set(item.categoryId, arr);
      }
      arr.push(item);
    }
    return map;
  }, [settingItems]);

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    addSettingCategory(newCatName.trim(), 'folder');
    setNewCatName('');
    setShowAddCat(false);
  };

  const handleAddItem = (catId: string) => {
    if (!newItemName.trim()) return;
    addSettingItem(catId, newItemName.trim());
    setNewItemName('');
    setAddingItemTo(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200">设定库</span>
        <button
          onClick={() => setShowAddCat(true)}
          className="p-1 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {showAddCat && (
        <div className="p-3 border-b border-ink-800/50 bg-ink-800/30">
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            placeholder="分类名称..."
            className="input text-sm mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={() => { setShowAddCat(false); setNewCatName(''); }} className="flex-1 btn btn-secondary text-xs">
              取消
            </button>
            <button onClick={handleAddCategory} className="flex-1 btn btn-primary text-xs">
              添加
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {settingCategories.length === 0 ? (
          <div className="p-6 text-center">
            <Globe className="w-8 h-8 text-ink-600 mx-auto mb-2" />
            <p className="text-sm text-ink-500">还没有设定</p>
            <p className="text-xs text-ink-600">点击 + 添加第一个设定分类</p>
          </div>
        ) : (
          <div className="p-1.5 space-y-1">
            {settingCategories.map(cat => {
              const items = itemsByCategory.get(cat.id) ?? [];
              const isExpanded = expandedCat === cat.id;

              return (
                <div key={cat.id}>
                  <div
                    onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
                    className="group flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-ink-800/50 transition-colors"
                  >
                    <ChevronRight className={`w-4 h-4 text-ink-500 transition-transform flex-shrink-0 ${
                      isExpanded ? 'rotate-90' : ''
                    }`} />
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: cat.color + '30' }}
                    >
                      <span className="text-[10px]" style={{ color: cat.color }}>
                        {cat.name.slice(0, 1)}
                      </span>
                    </div>
                    <span className="text-sm text-ink-200 flex-1 truncate">{cat.name}</span>
                    <span className="text-[10px] text-ink-500">{items.length}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setAddingItemTo(cat.id); setExpandedCat(cat.id); }}
                      className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-700/50 opacity-0 group-hover:opacity-100"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ml-6 mt-0.5 space-y-0.5 animate-slide-down">
                      {addingItemTo === cat.id && (
                        <div className="flex gap-1 p-1">
                          <input
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddItem(cat.id)}
                            onBlur={() => {
                              // 失焦时若已输入内容，则视为确认提交；否则取消。
                              // 此前无条件清空会吞掉用户输入但未按 Enter 的提交。
                              if (newItemName.trim()) {
                                handleAddItem(cat.id);
                              } else {
                                setAddingItemTo(null);
                                setNewItemName('');
                              }
                            }}
                            placeholder="名称..."
                            className="flex-1 px-2 py-1 bg-ink-800 border border-ink-700 rounded text-xs text-ink-200 outline-none focus:border-amber-400/50"
                            autoFocus
                          />
                          <button
                            onMouseDown={(e) => { e.preventDefault(); handleAddItem(cat.id); }}
                            className="px-2 py-1 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded text-xs"
                            title="添加"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); setAddingItemTo(null); setNewItemName(''); }}
                            className="px-2 py-1 bg-ink-700/50 text-ink-400 hover:bg-ink-700 rounded text-xs"
                            title="取消"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {items.map(item => {
                        const isEditing = editingItem?.id === item.id;
                        return (
                          <div key={item.id}>
                            {isEditing ? (
                              <div className="ml-2 mt-1 mb-1 bg-ink-800/30 rounded">
                                <SettingItemEditor item={item} onDone={() => setEditingItem(null)} />
                              </div>
                            ) : (
                              <div
                                onClick={() => setEditingItem(item)}
                                onDoubleClick={() => setEditingItem(item)}
                                className="flex items-center gap-2 p-1.5 pl-2 rounded text-xs text-ink-300 hover:bg-ink-800/30 cursor-pointer transition-colors group"
                              >
                                <BookOpen className="w-3 h-3 text-ink-500 flex-shrink-0" />
                                <span className="truncate flex-1">{item.name}</span>
                                {item.description && (
                                  <span className="text-[10px] text-ink-500 truncate max-w-[60px]">{item.description}</span>
                                )}
                                <Edit3 className="w-3 h-3 text-ink-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => { setAddingItemTo(cat.id); setExpandedCat(cat.id); }}
                        className="w-full flex items-center gap-1 p-1.5 pl-2 text-xs text-ink-500 hover:text-amber-400 hover:bg-ink-800/30 rounded transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        添加条目
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
