/**
 * 大纲智能导入弹窗
 *
 * 粘贴结构化大纲文本（markdown 格式），自动解析为：
 * - 项目（标题/描述）
 * - 卷→部层级章节（含字数目标/时间跨度/核心命题等元数据）
 * - 人物（主角/配角，含寿数背景）
 * - 设定分类与条目
 * - 伏笔（混沌双生反噬等）
 *
 * 解析后预览识别结果，确认导入则填充到软件对应位置。
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { X, ClipboardPaste, Sparkles, BookOpen, Users, Settings as SettingsIcon, GitBranch, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { parseOutline } from '@/utils/outlineParser';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { ParsedOutline } from '@/utils/outlineParser';
import type { Chapter, ChapterLevelType, Character } from '@/types';
import { CHARACTER_ROLE_LABELS } from '@/types';

interface OutlineImportModalProps {
  onClose: () => void;
}

const SAMPLE_HINT = `粘贴格式示例：
# 《作品名》
## 全书总纲
### 核心立意
（立意内容...）
## 卷一：卷名
**卷字数**：80万字
**时间跨度**：xxx — xxx
**核心命题**：...
### 上部·xxx
（正文...）
**混沌双生·本卷反噬**
- 正向收益：...
- 结构性反噬：...`;

export default function OutlineImportModal({ onClose }: OutlineImportModalProps) {
  const navigate = useNavigate();
  const createProject = useAppStore(s => s.createProject);
  const addChapter = useAppStore(s => s.addChapter);
  const updateChapter = useAppStore(s => s.updateChapter);
  const updateChapterContent = useAppStore(s => s.updateChapterContent);
  const addCharacter = useAppStore(s => s.addCharacter);
  const addSettingCategory = useAppStore(s => s.addSettingCategory);
  const addSettingItem = useAppStore(s => s.addSettingItem);
  const addForeshadow = useAppStore(s => s.addForeshadow);
  const deleteProject = useAppStore(s => s.deleteProject);

  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedOutline | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'volumes' | 'characters' | 'settings' | 'foreshadows'>('volumes');
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  // 同步守卫：防止双击"确认导入"在 setImporting(true) 异步生效前并发触发两次导入
  const importingRef = useRef(false);
  // 组件挂载即视为打开（由父级条件渲染控制），焦点陷阱常驻激活
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Esc 关闭模态（IME 组合输入时忽略，避免在文本框输入中文时误关）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // 防抖解析
  useEffect(() => {
    if (!rawText.trim()) {
      setParsed(null);
      setError('');
      return;
    }
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      try {
        const result = parseOutline(rawText);
        if (result.volumes.length === 0 && result.settings.length === 0) {
          if (!isMountedRef.current) return;
          setParsed(null);
          setError('未识别到大纲结构，请确保包含 ## 卷X 或 ## 设定分类 标题');
          return;
        }
        if (!isMountedRef.current) return;
        setParsed(result);
        setError('');
      } catch (e) {
        console.error('大纲解析失败:', e);
        if (!isMountedRef.current) return;
        setError('大纲解析失败，请检查格式');
        setParsed(null);
      }
    }, 400);
    return () => {
      if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    };
  }, [rawText]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRawText(text);
    } catch {
      setError('无法读取剪贴板，请手动粘贴');
    }
  };

  const handleConfirmImport = async () => {
    if (!parsed || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    let projectId: string | null = null;
    try {
      // 1. 创建项目
      const project = await createProject(parsed.title, 'blank');
      projectId = project.id;
      // 更新项目描述
      if (parsed.description) {
        useAppStore.getState().updateProject(projectId, { description: parsed.description });
      }

      // 2. 创建设定分类与条目
      for (const setting of parsed.settings) {
        const category = addSettingCategory(setting.categoryName, '📖');
        for (const item of setting.items) {
          const newItem = addSettingItem(category.id, item.name);
          if (newItem) {
            useAppStore.getState().updateSettingItem(newItem.id, {
              content: item.content,
              description: item.content.slice(0, 100),
            });
          }
        }
      }

      // 3. 创建卷→部层级章节
      for (const volume of parsed.volumes) {
        // 创建卷（volume 级）
        const volumeChapter = addChapter(null, volume.title, volume.order, 'volume' as ChapterLevelType);
        if (volumeChapter) {
          // 填充卷元数据
          const updates: Partial<Chapter> = {};
          if (volume.wordTarget) updates.wordTarget = volume.wordTarget;
          if (volume.timeSpan) updates.timeSpan = volume.timeSpan;
          if (volume.epicPositioning) updates.epigraph = volume.epicPositioning;
          if (volume.coreProposition) updates.coreProposition = volume.coreProposition;
          if (volume.notes) updates.notes = volume.notes;
          // 卷摘要
          const summaryParts: string[] = [];
          if (volume.timeSpan) summaryParts.push(volume.timeSpan);
          if (volume.epicPositioning) summaryParts.push(volume.epicPositioning);
          if (volume.coreProposition) summaryParts.push(`核心命题：${volume.coreProposition}`);
          updates.summary = summaryParts.join(' | ');
          if (Object.keys(updates).length > 0) {
            updateChapter(volumeChapter.id, updates);
          }
        }

        // 创建部（part 级，父级为卷）
        for (const part of volume.parts) {
          const partChapter = addChapter(volumeChapter?.id ?? null, part.title, part.order, 'part' as ChapterLevelType);
          if (partChapter) {
            updateChapterContent(partChapter.id, part.content);
          }
        }
      }

      // 4. 创建人物
      for (const char of parsed.characters) {
        const characterData: Partial<Character> = {
          name: char.name,
          role: char.role,
          profile: char.profile,
          tags: char.role === 'protagonist' ? ['主角'] : [],
        };
        addCharacter(characterData);
      }

      // 5. 创建伏笔
      for (const fs of parsed.foreshadows) {
        addForeshadow({
          title: fs.title,
          description: fs.description,
          priority: fs.priority,
          status: 'planted',
        });
      }

      // 显式持久化后再跳转
      await useAppStore.getState().saveProject();
      onClose();
      navigate(`/project/${projectId}/editor`);
    } catch (e) {
      console.error('大纲导入失败:', e);
      // 回滚：删除已创建的半成品项目，避免首页留下空壳项目
      if (projectId) {
        try {
          await deleteProject(projectId);
          // 清理内存状态（不触发 saveProject，避免把半成品再写回 storage）
          useAppStore.setState({
            currentProjectId: null,
            chapters: [],
            characters: [],
            settingCategories: [],
            settingItems: [],
            foreshadows: [],
            materials: [],
            versions: {},
          });
        } catch (rollbackErr) {
          console.error('回滚半成品项目失败:', rollbackErr);
        }
      }
      if (!isMountedRef.current) return;
      // 清空 parsed 让视图回退到输入区，使 error 文案可见
      // （error 仅在 !parsed 分支渲染，否则用户在预览态看不到失败提示）
      setParsed(null);
      setError('导入失败，请重试');
    } finally {
      importingRef.current = false;
      if (isMountedRef.current) setImporting(false);
    }
  };

  // useMemo 收敛卷册 parts 累加，避免每次 render 重算 reduce
  const totalParts = useMemo(() => parsed?.volumes.reduce((s, v) => s + v.parts.length, 0) ?? 0, [parsed?.volumes]);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="导入大纲"
    >
      <div
        className="card p-6 w-full max-w-3xl mx-4 animate-slide-up max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/20 to-amber-600/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink-100">导入大纲</h2>
              <p className="text-xs text-ink-500">智能识别卷·部·人物·设定·伏笔，自动填充</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {!parsed ? (
          /* 输入区 */
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={handlePaste}
                className="btn btn-secondary text-xs py-1.5 px-3"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                从剪贴板粘贴
              </button>
              <span className="text-xs text-ink-500">或直接在下方文本框粘贴大纲</span>
            </div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={SAMPLE_HINT}
              className="input flex-1 min-h-[300px] resize-none font-mono text-xs leading-relaxed"
              autoFocus
            />
            {error && (
              <div
                role="alert"
                className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
              >
                {error}
              </div>
            )}
            <div className="mt-3 p-3 rounded-lg bg-ink-800/50 text-xs text-ink-400 space-y-1">
              <p className="text-ink-300 font-medium mb-1">💡 识别规则</p>
              <p>• <code className="text-amber-400"># 标题</code> → 作品名</p>
              <p>• <code className="text-amber-400">## 卷X：名</code> → 分卷章节（含字数/时间/命题等元数据）</p>
              <p>• <code className="text-amber-400">### 上部·名</code> → 分卷下的部（上部/中部/下部）</p>
              <p>• <code className="text-amber-400">**混沌双生**</code> → 伏笔；<code className="text-amber-400">**寿数礼制**</code> → 人物识别</p>
            </div>
          </div>
        ) : (
          /* 预览区 */
          <>
            {/* 统计概览 */}
            <div className="grid grid-cols-4 gap-3 mb-4 flex-shrink-0">
              <div className="card p-3 text-center">
                <BookOpen className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                <div className="text-lg font-semibold text-ink-100">{parsed.volumes.length}</div>
                <div className="text-xs text-ink-500">卷 / {totalParts} 部</div>
              </div>
              <div className="card p-3 text-center">
                <Users className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                <div className="text-lg font-semibold text-ink-100">{parsed.characters.length}</div>
                <div className="text-xs text-ink-500">人物</div>
              </div>
              <div className="card p-3 text-center">
                <SettingsIcon className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                <div className="text-lg font-semibold text-ink-100">
                  {parsed.settings.reduce((s, c) => s + c.items.length, 0)}
                </div>
                <div className="text-xs text-ink-500">设定项</div>
              </div>
              <div className="card p-3 text-center">
                <GitBranch className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                <div className="text-lg font-semibold text-ink-100">{parsed.foreshadows.length}</div>
                <div className="text-xs text-ink-500">伏笔</div>
              </div>
            </div>

            {/* 标题预览 */}
            <div className="mb-3 p-3 rounded-lg bg-amber-400/5 border border-amber-400/20 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">{parsed.title}</p>
                  {parsed.description && (
                    <p className="text-xs text-ink-500 truncate mt-0.5">{parsed.description}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Tab 切换 */}
            <div
              role="tablist"
              aria-label="大纲导入预览分类"
              className="flex gap-1 mb-3 flex-shrink-0 border-b border-ink-700/50"
              onKeyDown={(e) => {
                const tabs = ['volumes', 'characters', 'settings', 'foreshadows'] as const;
                const currentIdx = tabs.indexOf(activeTab);
                let nextIdx = currentIdx;
                if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length;
                else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
                else if (e.key === 'Home') nextIdx = 0;
                else if (e.key === 'End') nextIdx = tabs.length - 1;
                else return;
                e.preventDefault();
                setActiveTab(tabs[nextIdx]);
              }}
            >
              {([
                { key: 'volumes', label: `卷·部 (${parsed.volumes.length})`, icon: BookOpen },
                { key: 'characters', label: `人物 (${parsed.characters.length})`, icon: Users },
                { key: 'settings', label: `设定 (${parsed.settings.reduce((s, c) => s + c.items.length, 0)})`, icon: SettingsIcon },
                { key: 'foreshadows', label: `伏笔 (${parsed.foreshadows.length})`, icon: GitBranch },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  role="tab"
                  id={`tab-${tab.key}`}
                  aria-selected={activeTab === tab.key}
                  aria-controls={`panel-${tab.key}`}
                  tabIndex={activeTab === tab.key ? 0 : -1}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-amber-400 text-amber-300'
                      : 'border-transparent text-ink-500 hover:text-ink-300'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 内容列表 */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
              {activeTab === 'volumes' && (
                <div role="tabpanel" id="panel-volumes" aria-labelledby="tab-volumes" className="space-y-2">
                  {parsed.volumes.map(vol => (
                    <div key={vol.order} className="card p-3">
                      <div className="flex items-start gap-2">
                        <ChevronRight className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink-100">{vol.title}</p>
                          <div className="flex flex-wrap gap-2 mt-1 text-xs text-ink-500">
                            {vol.wordTarget && <span>目标 {vol.wordTarget.toLocaleString()} 字</span>}
                            {vol.timeSpan && <span className="truncate max-w-[200px]">{vol.timeSpan}</span>}
                            {vol.parts.length > 0 && <span>{vol.parts.length} 部</span>}
                          </div>
                          {vol.coreProposition && (
                            <p className="text-xs text-ink-400 mt-1">{vol.coreProposition}</p>
                          )}
                          {vol.parts.length > 0 && (
                            <div className="mt-2 pl-3 border-l-2 border-ink-700/50 space-y-1">
                              {vol.parts.map(part => (
                                <div key={part.order} className="flex items-center gap-1.5 text-xs text-ink-400">
                                  <span className="w-1 h-1 rounded-full bg-ink-600" />
                                  <span className="flex-1 truncate">{part.title}</span>
                                  <span className="text-ink-600">{part.wordCount} 字</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'characters' && (
                <div role="tabpanel" id="panel-characters" aria-labelledby="tab-characters" className="space-y-1.5">
                  {parsed.characters.map(char => (
                    <div key={char.name} className="flex items-center gap-3 p-2.5 rounded-lg bg-ink-800/30 border border-ink-700/30">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                        char.role === 'protagonist'
                          ? 'bg-amber-400/20 text-amber-300'
                          : 'bg-ink-700/50 text-ink-400'
                      }`}>
                        {char.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink-100">{char.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            char.role === 'protagonist'
                              ? 'bg-amber-400/10 text-amber-400/80'
                              : 'bg-ink-700/50 text-ink-500'
                          }`}>
                            {CHARACTER_ROLE_LABELS[char.role]}
                          </span>
                        </div>
                        {char.profile.background && (
                          <p className="text-xs text-ink-500 truncate mt-0.5">{char.profile.background}</p>
                        )}
                      </div>
                      <span className="text-xs text-ink-600">提及 {char.mentionCount} 次</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'settings' && (
                <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" className="space-y-2">
                  {parsed.settings.map((setting, idx) => (
                    <div key={idx} className="card p-3">
                      <p className="text-sm font-medium text-ink-200 mb-2">{setting.categoryName}</p>
                      <div className="space-y-1.5">
                        {setting.items.map((item, i) => (
                          <div key={i} className="pl-3 border-l-2 border-ink-700/50">
                            <p className="text-xs font-medium text-ink-300">{item.name}</p>
                            <p className="text-xs text-ink-500 line-clamp-2 mt-0.5">{item.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'foreshadows' && (
                <div role="tabpanel" id="panel-foreshadows" aria-labelledby="tab-foreshadows" className="space-y-1.5">
                  {parsed.foreshadows.map((fs, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <p className="text-sm font-medium text-emerald-300 mb-1">{fs.title}</p>
                      <p className="text-xs text-ink-400 line-clamp-3">{fs.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* 底部按钮 */}
        <div className="flex gap-2 mt-4 flex-shrink-0">
          <button
            onClick={() => {
              setParsed(null);
              setRawText('');
              setError('');
            }}
            className="btn btn-secondary"
            disabled={importing}
          >
            重新输入
          </button>
          <button
            onClick={handleConfirmImport}
            disabled={!parsed || importing}
            className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                确认导入并填充
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
