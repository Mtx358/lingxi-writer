import { useState, useMemo } from 'react';
import { Plus, User, ChevronRight, Edit3, Trash2, Check, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { CHARACTER_ROLE_LABELS, DEFAULT_CHARACTER_ROLE, type Character, type CharacterRelationship } from '@/types';

const RELATIONSHIP_TYPES = ['父子', '母女', '兄妹', '姐弟', '夫妻', '恋人', '朋友', '仇敌', '师徒', '同事', '上下级', '对手', '知己', '亲属'];

const REVERSE_RELATIONSHIP_MAP: Record<string, string> = {
  '父子': '子父',
  '母女': '女母',
  '兄妹': '妹兄',
  '姐弟': '弟姐',
  '夫妻': '夫妻',
  '恋人': '恋人',
  '朋友': '朋友',
  '仇敌': '仇敌',
  '师徒': '徒师',
  '徒师': '师徒',
  '同事': '同事',
  '上下级': '下级上级',
  '下级上级': '上下级',
  '对手': '对手',
  '知己': '知己',
  '亲属': '亲属',
};

const BUILTIN_PROFILE_FIELDS: { key: string; label: string; multiline?: boolean }[] = [
  { key: 'age', label: '年龄' },
  { key: 'gender', label: '性别' },
  { key: 'appearance', label: '外貌', multiline: true },
  { key: 'personality', label: '性格', multiline: true },
  { key: 'background', label: '背景', multiline: true },
  { key: 'motivation', label: '动机', multiline: true },
  { key: 'goal', label: '目标', multiline: true },
  { key: 'weakness', label: '弱点', multiline: true },
  { key: 'fear', label: '恐惧', multiline: true },
  { key: 'arc', label: '成长弧光', multiline: true },
  { key: 'occupation', label: '职业' },
  { key: 'skills', label: '技能', multiline: true },
];

const BUILTIN_PROFILE_KEYS = BUILTIN_PROFILE_FIELDS.map(f => f.key);

function CharacterEditor({ char, onDone }: { char: Character; onDone: () => void }) {
  const updateCharacter = useAppStore(s => s.updateCharacter);
  const characters = useAppStore(s => s.characters);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    Object.entries(char.profile || {}).forEach(([k, v]) => { d[k] = v ?? ''; });
    return d;
  });
  const [showAddField, setShowAddField] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [addError, setAddError] = useState('');

  const [showAddRelation, setShowAddRelation] = useState(false);
  const [newRelationTarget, setNewRelationTarget] = useState('');
  const [newRelationType, setNewRelationType] = useState('');
  const [newRelationDesc, setNewRelationDesc] = useState('');
  const [newRelationIntensity, setNewRelationIntensity] = useState(50);

  const customKeys = Object.keys(draft).filter(k => !BUILTIN_PROFILE_KEYS.includes(k));
  const otherCharacters = characters.filter(c => c.id !== char.id);

  // 关系类型可扩展：合并内置类型 + 全项目已使用过的自定义类型，供 datalist 下拉建议
  // 用户仍可输入任意自定义文本（如"青梅竹马"、"宿敌变盟友"等），覆盖内置枚举的不足
  const allRelationTypes = useMemo(() => {
    const used = new Set<string>(RELATIONSHIP_TYPES);
    characters.forEach(c => {
      (c.relationships || []).forEach(r => {
        if (r.type) used.add(r.type);
      });
    });
    return Array.from(used);
  }, [characters]);

  const commitField = (key: string, value: string) => {
    updateCharacter(char.id, { profile: { ...char.profile, [key]: value } });
  };

  const handleAddField = () => {
    const key = newKey.trim();
    if (!key) {
      setAddError('字段名不能为空');
      return;
    }
    if (BUILTIN_PROFILE_KEYS.includes(key) || key in draft) {
      setAddError('该字段已存在');
      return;
    }
    updateCharacter(char.id, { profile: { ...char.profile, [key]: '' } });
    setDraft(d => ({ ...d, [key]: '' }));
    setNewKey('');
    setAddError('');
    setShowAddField(false);
  };

  const handleDeleteField = (key: string) => {
    const newProfile = Object.fromEntries(
      Object.entries(char.profile || {}).filter(([k]) => k !== key)
    );
    updateCharacter(char.id, { profile: newProfile });
    setDraft(d => {
      const nd = { ...d };
      delete nd[key];
      return nd;
    });
  };

  const cancelAddField = () => {
    setShowAddField(false);
    setNewKey('');
    setAddError('');
  };

  const handleAddRelation = () => {
    if (!newRelationTarget || !newRelationType) return;
    const newRel: CharacterRelationship = {
      targetId: newRelationTarget,
      type: newRelationType,
      description: newRelationDesc,
      intensity: newRelationIntensity,
    };
    const updatedRels = [...(char.relationships || []), newRel];
    updateCharacter(char.id, { relationships: updatedRels });

    // 双向同步：给目标角色添加反向关系
    const targetChar = characters.find(c => c.id === newRelationTarget);
    if (targetChar) {
      const reverseType = REVERSE_RELATIONSHIP_MAP[newRelationType] || newRelationType;
      const reverseRel: CharacterRelationship = {
        targetId: char.id,
        type: reverseType,
        description: newRelationDesc,
        intensity: newRelationIntensity,
      };
      const existingTargetRels = targetChar.relationships || [];
      // 按 targetId + type 判断是否已存在，允许同一角色间有多种不同关系
      const alreadyExists = existingTargetRels.some(r => r.targetId === char.id && r.type === reverseType);
      if (!alreadyExists) {
        updateCharacter(targetChar.id, { relationships: [...existingTargetRels, reverseRel] });
      }
    }

    setShowAddRelation(false);
    setNewRelationTarget('');
    setNewRelationType('');
    setNewRelationDesc('');
    setNewRelationIntensity(50);
  };

  const handleDeleteRelation = (targetId: string, relType?: CharacterRelationship['type']) => {
    // 未指定 type 时按 targetId 删除所有关系（向后兼容）；指定 type 时只删对应类型
    const updatedRels = relType
      ? (char.relationships || []).filter(r => !(r.targetId === targetId && r.type === relType))
      : (char.relationships || []).filter(r => r.targetId !== targetId);
    updateCharacter(char.id, { relationships: updatedRels });

    // 双向同步：删除目标角色的反向关系
    const targetChar = characters.find(c => c.id === targetId);
    if (targetChar) {
      const reverseType = relType ? (REVERSE_RELATIONSHIP_MAP[relType] || relType) : undefined;
      const targetUpdatedRels = reverseType
        ? (targetChar.relationships || []).filter(r => !(r.targetId === char.id && r.type === reverseType))
        : (targetChar.relationships || []).filter(r => r.targetId !== char.id);
      updateCharacter(targetChar.id, { relationships: targetUpdatedRels });
    }
  };

  return (
    <div className="p-2 space-y-3 animate-slide-down">
      {/* 内置字段 */}
      <div className="space-y-2">
        {BUILTIN_PROFILE_FIELDS.map(field => (
          <div key={field.key}>
            <label className="block text-[10px] text-ink-500 mb-1">{field.label}</label>
            {field.multiline ? (
              <textarea
                value={draft[field.key] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}
                onBlur={() => commitField(field.key, draft[field.key] ?? '')}
                rows={2}
                className="input text-xs py-1.5 resize-none"
                placeholder={`输入${field.label}...`}
              />
            ) : (
              <input
                value={draft[field.key] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}
                onBlur={() => commitField(field.key, draft[field.key] ?? '')}
                className="input text-xs py-1.5"
                placeholder={`输入${field.label}...`}
              />
            )}
          </div>
        ))}
      </div>

      {/* 自定义字段 */}
      <div className="pt-2 border-t border-ink-800/50 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-400">自定义字段</span>
          <button
            onClick={() => setShowAddField(s => !s)}
            className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
            title="添加字段"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showAddField && (
          <div className="space-y-1 p-1.5 bg-ink-800/40 rounded">
            <input
              value={newKey}
              onChange={e => { setNewKey(e.target.value); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAddField()}
              placeholder="字段名（如：口头禅）"
              className="input text-xs py-1.5"
              autoFocus
            />
            {addError && <p className="text-[10px] text-red-400 px-1">{addError}</p>}
            <div className="flex gap-1">
              <button onClick={cancelAddField} className="flex-1 btn btn-secondary text-[10px] py-1">取消</button>
              <button onClick={handleAddField} className="flex-1 btn btn-primary text-[10px] py-1">添加</button>
            </div>
          </div>
        )}

        {customKeys.length === 0 && !showAddField && (
          <p className="text-[10px] text-ink-600 text-center py-1">点击 + 添加自定义字段</p>
        )}

        {customKeys.map(key => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-ink-500 truncate">{key}</label>
              <button
                onClick={() => handleDeleteField(key)}
                className="p-0.5 rounded text-ink-500 hover:text-red-400 hover:bg-ink-800 transition-colors flex-shrink-0"
                title="删除字段"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <textarea
              value={draft[key] ?? ''}
              onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
              onBlur={() => commitField(key, draft[key] ?? '')}
              rows={2}
              className="input text-xs py-1.5 resize-none"
            />
          </div>
        ))}
      </div>

      {/* 角色关系 */}
      <div className="pt-2 border-t border-ink-800/50 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-400">角色关系</span>
          <button
            onClick={() => setShowAddRelation(s => !s)}
            className="p-0.5 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
            title="添加关系"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showAddRelation && (
          <div className="space-y-1.5 p-1.5 bg-ink-800/40 rounded">
            <div>
              <label className="block text-[10px] text-ink-500 mb-0.5">关联角色</label>
              <select
                value={newRelationTarget}
                onChange={e => setNewRelationTarget(e.target.value)}
                className="input text-xs py-1 w-full"
              >
                <option value="">选择角色...</option>
                {otherCharacters.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-ink-500 mb-0.5">关系类型</label>
              <input
                type="text"
                list="character-relation-types"
                value={newRelationType}
                onChange={e => setNewRelationType(e.target.value)}
                className="input text-xs py-1 w-full"
                placeholder="选择或输入关系类型..."
                autoComplete="off"
              />
              <datalist id="character-relation-types">
                {allRelationTypes.map(t => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] text-ink-500 mb-0.5">关系描述</label>
              <input
                value={newRelationDesc}
                onChange={e => setNewRelationDesc(e.target.value)}
                className="input text-xs py-1 w-full"
                placeholder="详细描述..."
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-ink-500">关系强度</label>
                <span className="text-[10px] text-amber-400">{newRelationIntensity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={newRelationIntensity}
                onChange={e => setNewRelationIntensity(Number(e.target.value))}
                className="w-full h-1 bg-ink-700 rounded-full appearance-none cursor-pointer accent-amber-400"
              />
            </div>
            <div className="flex gap-1">
              <button onClick={() => setShowAddRelation(false)} className="flex-1 btn btn-secondary text-[10px] py-1">取消</button>
              <button onClick={handleAddRelation} className="flex-1 btn btn-primary text-[10px] py-1">添加</button>
            </div>
          </div>
        )}

        {(char.relationships?.length || 0) === 0 && !showAddRelation && (
          <p className="text-[10px] text-ink-600 text-center py-1">点击 + 添加角色关系</p>
        )}

        {(char.relationships || []).map(rel => {
          const targetChar = otherCharacters.find(c => c.id === rel.targetId);
          if (!targetChar) return null;
          return (
            <div key={`${rel.targetId}-${rel.type}`} className="flex items-center gap-2 p-1.5 bg-ink-800/30 rounded">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-medium flex-shrink-0"
                style={{ backgroundColor: targetChar.color + '30', color: targetChar.color }}
              >
                {targetChar.name.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-ink-200 truncate">{targetChar.name}</span>
                  <span className="text-[10px] bg-amber-400/10 text-amber-400 px-1 rounded">{rel.type}</span>
                </div>
                {rel.description && (
                  <div className="text-[10px] text-ink-500 truncate">{rel.description}</div>
                )}
              </div>
              <button
                onClick={() => handleDeleteRelation(rel.targetId, rel.type)}
                className="p-0.5 rounded text-ink-500 hover:text-red-400 hover:bg-ink-700/50 transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <button onClick={onDone} className="w-full btn btn-secondary text-xs py-1.5">
        <Check className="w-3.5 h-3.5" />
        完成
      </button>
    </div>
  );
}

export default function CharactersPanel() {
  const characters = useAppStore(s => s.characters);
  const addCharacter = useAppStore(s => s.addCharacter);
  const deleteCharacter = useAppStore(s => s.deleteCharacter);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = () => {
    if (!newName.trim()) return;
    addCharacter({ name: newName.trim(), role: DEFAULT_CHARACTER_ROLE });
    setNewName('');
    setShowAdd(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200">角色列表</span>
        <button
          onClick={() => setShowAdd(true)}
          className="p-1 rounded text-ink-500 hover:text-amber-400 hover:bg-ink-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {showAdd && (
        <div className="p-3 border-b border-ink-800/50 bg-ink-800/30">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="角色姓名..."
            className="input text-sm mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setNewName(''); }} className="flex-1 btn btn-secondary text-xs">
              取消
            </button>
            <button onClick={handleAdd} className="flex-1 btn btn-primary text-xs">
              添加
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {characters.length === 0 ? (
          <div className="p-6 text-center">
            <User className="w-8 h-8 text-ink-600 mx-auto mb-2" />
            <p className="text-sm text-ink-500">还没有角色</p>
            <p className="text-xs text-ink-600">点击 + 添加第一个角色</p>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {characters.map(char => {
              const isSelected = selectedId === char.id;
              const isEditing = editingId === char.id;
              return (
                <div key={char.id}>
                  <div
                    onClick={() => {
                      setSelectedId(isSelected ? null : char.id);
                      if (!isSelected) setEditingId(null);
                    }}
                    className={`group flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-amber-400/10' : 'hover:bg-ink-800/50'
                    }`}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                      style={{ backgroundColor: char.color + '30', color: char.color }}
                    >
                      {char.name.slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink-200 truncate">{char.name}</div>
                      <div className="text-[10px] text-ink-500">
                        {CHARACTER_ROLE_LABELS[char.role]}
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-ink-500 transition-transform flex-shrink-0 ${
                      isSelected ? 'rotate-90' : ''
                    }`} />
                  </div>

                  {isSelected && !isEditing && (
                    <div className="ml-4 mt-1 mb-2 p-2 bg-ink-800/30 rounded text-xs space-y-2 animate-slide-down">
                      {char.profile.personality && (
                        <div>
                          <span className="text-ink-500">性格：</span>
                          <span className="text-ink-300">{char.profile.personality}</span>
                        </div>
                      )}
                      {char.profile.motivation && (
                        <div>
                          <span className="text-ink-500">动机：</span>
                          <span className="text-ink-300">{char.profile.motivation}</span>
                        </div>
                      )}
                      {char.profile.weakness && (
                        <div>
                          <span className="text-ink-500">弱点：</span>
                          <span className="text-ink-300">{char.profile.weakness}</span>
                        </div>
                      )}
                      <div className="flex gap-1 pt-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(char.id); }}
                          className="flex-1 py-1 text-[10px] text-ink-400 hover:text-ink-200 bg-ink-700/50 rounded flex items-center justify-center gap-1"
                        >
                          <Edit3 className="w-3 h-3" />
                          编辑
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`删除角色"${char.name}"？`)) {
                              deleteCharacter(char.id);
                              setSelectedId(null);
                              setEditingId(null);
                            }
                          }}
                          className="flex-1 py-1 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded flex items-center justify-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      </div>
                    </div>
                  )}

                  {isSelected && isEditing && (
                    <div className="ml-4 mt-1 mb-2 bg-ink-800/30 rounded">
                      <CharacterEditor key={char.id} char={char} onDone={() => setEditingId(null)} />
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
