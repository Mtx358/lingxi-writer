/**
 * 智能导入弹窗（统一入口）
 *
 * 合并原 ImportModal（作品导入）和 OutlineImportModal（大纲导入）两个入口，
 * 支持三种输入方式：文件上传 / 拖拽 / 粘贴文本。
 *
 * 核心能力：
 *   1. 内容形式自动嗅探（markdown / html / docx / 纯文本）
 *   2. 章节标题智能识别（中文卷/部/章/序章/番外、英文 Chapter/Volume、数字编号、自定义前缀）
 *   3. 项目指纹比对（标题 + 章节数 + 前 3 章 hash）
 *   4. 情境决策（无项目/无匹配/同书追更/重新导入/同名不同书等场景的自动反应）
 *   5. 三种执行模式：新建 / 合并追加 / 覆盖
 *
 * 设计文档见 src/utils/importDetector.ts 顶部注释。
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  X, Upload, ClipboardPaste, FileText, AlertCircle, Check, File,
  Sparkles, ChevronRight, Loader2, Merge, RefreshCw, Plus, BookOpen,
  Users, Settings as SettingsIcon, GitBranch, AlertTriangle, Info,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { parseMarkdown, parsePlainText, parseDocx } from '@/utils/importUtils';
import type { ImportResult, ImportedChapter, HeadingMapping } from '@/utils/importUtils';
import { parseOutline } from '@/utils/outlineParser';
import type { ParsedOutline } from '@/utils/outlineParser';
import {
  detectContentForm,
  computeImportFingerprint,
  computeProjectFingerprint,
  findMatchingProjects,
  decideImportAction,
  computeNewChapters,
  computeModifiedChapters,
  type ContentForm,
  type ImportFingerprint,
  type ProjectMatch,
  type ImportAction,
} from '@/utils/importDetector';
import type { Chapter, ChapterLevelType, Character } from '@/types';
import { CHARACTER_ROLE_LABELS } from '@/types';

// 文件大小上限 20 MB（与原 ImportModal 一致）
const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

// 支持的文件扩展名
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.docx', '.html', '.htm'];

interface SmartImportModalProps {
  onClose: () => void;
}

// ==================== 统一解析结果类型 ====================

interface UnifiedImportResult {
  title: string;
  chapters: ImportedChapter[];
  totalWords: number;
  /** 内容形式（用于预览展示） */
  form: ContentForm;
  /** 是否识别为结构化大纲（含卷·部·人物·设定·伏笔） */
  isOutline: boolean;
  /** 大纲解析结果（仅 isOutline=true 时有值） */
  outline?: ParsedOutline;
}

// ==================== 步骤状态 ====================

type Step = 'input' | 'decision' | 'preview' | 'importing';

// ==================== 执行模式 ====================

type ExecMode =
  | { kind: 'create-new' }
  | { kind: 'merge'; targetProjectId: string }
  | { kind: 'overwrite'; targetProjectId: string };

export default function SmartImportModal({ onClose }: SmartImportModalProps) {
  const navigate = useNavigate();
  const createProject = useAppStore(s => s.createProject);
  const openProject = useAppStore(s => s.openProject);
  const saveProject = useAppStore(s => s.saveProject);
  const deleteProject = useAppStore(s => s.deleteProject);
  const addChapter = useAppStore(s => s.addChapter);
  const updateChapter = useAppStore(s => s.updateChapter);
  const updateChapterContent = useAppStore(s => s.updateChapterContent);
  const deleteChapter = useAppStore(s => s.deleteChapter);
  const addCharacter = useAppStore(s => s.addCharacter);
  const addSettingCategory = useAppStore(s => s.addSettingCategory);
  const addSettingItem = useAppStore(s => s.addSettingItem);
  const addForeshadow = useAppStore(s => s.addForeshadow);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const isMountedRef = useRef(true);
  const importingRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 输入相关状态
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');          // 文本类输入的原始内容
  const [docxUrl, setDocxUrl] = useState('');           // docx 的 object URL
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');

  // 解析与决策相关状态
  const [step, setStep] = useState<Step>('input');
  const [unified, setUnified] = useState<UnifiedImportResult | null>(null);
  const [importFp, setImportFp] = useState<ImportFingerprint | null>(null);
  const [decision, setDecision] = useState<ImportAction | null>(null);
  const [execMode, setExecMode] = useState<ExecMode | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'volumes' | 'characters' | 'settings' | 'foreshadows' | 'chapters'>('chapters');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    };
  }, []);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape' && step !== 'importing') onClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, step]);

  // ==================== 解析逻辑 ====================

  /**
   * 解析文本内容。
   * 策略：
   *   - 嗅探内容形式
   *   - markdown 形式优先尝试 parseOutline（结构化大纲），失败回退 parseMarkdown
   *   - html 形式当作 markdown 处理（DOMPurify 会清洗）
   *   - 纯文本走 parsePlainText
   */
  const parseText = (text: string): UnifiedImportResult => {
    const form = detectContentForm(text);

    // markdown / html 都先尝试大纲解析（parseOutline 内部要求 ## 卷X 等结构，
    // 不匹配会返回空 volumes，此时回退到 parseMarkdown）
    if (form === 'markdown' || form === 'html') {
      try {
        const outline = parseOutline(text);
        if (outline.volumes.length > 0 || outline.settings.length > 0) {
          // 大纲模式：把卷·部结构展平为 ImportedChapter[]
          const chapters: ImportedChapter[] = [];
          let order = 0;
          for (const vol of outline.volumes) {
            chapters.push({
              title: vol.title, content: '', level: 1, order: order++,
            });
            for (const part of vol.parts) {
              chapters.push({
                title: part.title, content: part.content, level: 2, order: order++,
              });
            }
          }
          return {
            title: outline.title,
            chapters,
            totalWords: outline.totalWords,
            form,
            isOutline: true,
            outline,
          };
        }
      } catch {
        // 大纲解析失败，回退到普通 markdown
      }
      const mdResult = parseMarkdown(text);
      return { ...mdResult, form, isOutline: false };
    }

    // 纯文本
    const txtResult = parsePlainText(text);
    return { ...txtResult, form: 'plain-text', isOutline: false };
  };

  /**
   * 解析 docx 二进制。
   */
  const parseDocxFile = async (arrayBuffer: ArrayBuffer): Promise<UnifiedImportResult> => {
    const result = await parseDocx(arrayBuffer);
    // docx 也尝试大纲解析（ mammoth 转 HTML 后可能含 ## 卷X 结构）
    try {
      const html = result.chapters.map(c => `<h2>${c.title}</h2><p>${c.content}</p>`).join('\n');
      const outline = parseOutline(html);
      if (outline.volumes.length > 0 || outline.settings.length > 0) {
        const chapters: ImportedChapter[] = [];
        let order = 0;
        for (const vol of outline.volumes) {
          chapters.push({ title: vol.title, content: '', level: 1, order: order++ });
          for (const part of vol.parts) {
            chapters.push({ title: part.title, content: part.content, level: 2, order: order++ });
          }
        }
        return {
          title: outline.title, chapters, totalWords: outline.totalWords,
          form: 'docx', isOutline: true, outline,
        };
      }
    } catch {
      // ignore
    }
    return { ...result, form: 'docx', isOutline: false };
  };

  /**
   * 触发解析 + 指纹比对 + 情境决策。
   */
  const triggerParse = (text: string, docxArrayBuffer?: ArrayBuffer) => {
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(async () => {
      try {
        let result: UnifiedImportResult;
        if (docxArrayBuffer) {
          result = await parseDocxFile(docxArrayBuffer);
        } else {
          result = parseText(text);
        }

        if (result.chapters.length === 0 && !result.isOutline) {
          if (!isMountedRef.current) return;
          setError('未识别到有效内容，请检查文件格式或章节标题');
          setUnified(null);
          return;
        }

        // 计算导入指纹
        const importResultForFp: ImportResult = {
          title: result.title,
          chapters: result.chapters,
          totalWords: result.totalWords,
        };
        const fp = computeImportFingerprint(importResultForFp);

        // 与现有项目比对
        const state = useAppStore.getState();
        const projects = state.projects;
        const allChapters = state.chapters;
        const projectFps = projects.map(p => computeProjectFingerprint(p, allChapters));
        const matches = findMatchingProjects(fp, projectFps);
        const action = decideImportAction(fp, matches, projects.length > 0);

        if (!isMountedRef.current) return;
        setUnified(result);
        setImportFp(fp);
        setDecision(action);

        // 根据决策结果选择默认执行模式
        if (action.kind === 'create-new') {
          setExecMode({ kind: 'create-new' });
          setStep('preview');
        } else if (action.kind === 'suggest-merge') {
          setExecMode({ kind: 'merge', targetProjectId: action.target.project.projectId });
          setStep('decision');
        } else if (action.kind === 'suggest-overwrite') {
          setExecMode({ kind: 'overwrite', targetProjectId: action.target.project.projectId });
          setStep('decision');
        } else {
          // ask-user
          setExecMode({ kind: 'create-new' });
          setStep('decision');
        }
        setError('');
      } catch (e) {
        console.error('智能解析失败:', e);
        if (!isMountedRef.current) return;
        setError('解析失败，请检查内容格式');
        setUnified(null);
      }
    }, 300);
  };

  // ==================== 输入处理 ====================

  const handleFile = async (file: File) => {
    setError('');
    if (file.size > MAX_IMPORT_SIZE) {
      setError('文件过大，请控制在 20 MB 以内');
      return;
    }
    const lowerName = file.name.toLowerCase();
    const ext = ACCEPTED_EXTENSIONS.find(e => lowerName.endsWith(e));
    if (!ext) {
      setError(`仅支持 ${ACCEPTED_EXTENSIONS.join(' ')} 格式`);
      return;
    }
    setFileName(file.name);
    setInputMode('file');

    const isDocx = lowerName.endsWith('.docx');
    if (isDocx) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setDocxUrl(url);
      setRawText('');
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        triggerParse('', arrayBuffer);
      } catch {
        setError('DOCX 读取失败');
      }
    } else {
      try {
        const text = await file.text();
        setRawText(text);
        setDocxUrl('');
        triggerParse(text);
      } catch {
        setError('文件读取失败');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRawText(text);
      setFileName('');
      setDocxUrl('');
      setInputMode('paste');
      triggerParse(text);
    } catch {
      setError('无法读取剪贴板，请手动粘贴');
    }
  };

  const handlePasteInput = (text: string) => {
    setRawText(text);
    setFileName('');
    setDocxUrl('');
    setInputMode('paste');
    if (text.trim()) triggerParse(text);
  };

  const resetInput = () => {
    setFileName('');
    setRawText('');
    setDocxUrl('');
    setUnified(null);
    setImportFp(null);
    setDecision(null);
    setExecMode(null);
    setError('');
    setStep('input');
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  // ==================== 导入执行 ====================

  const handleConfirmImport = async () => {
    if (!unified || !execMode || importingRef.current) return;
    importingRef.current = true;
    setStep('importing');

    let createdProjectId: string | null = null;
    let originalProjectId: string | null = null;
    try {
      // ===== 模式 1：覆盖 =====
      // 策略：先打开目标项目清空章节，再填充新内容（保留项目本身和 settingCard/blueprint）
      if (execMode.kind === 'overwrite') {
        originalProjectId = useAppStore.getState().currentProjectId;
        await openProject(execMode.targetProjectId);
        const existingChapters = useAppStore.getState().chapters;
        // 删除所有现有章节（按逆序删除避免 order 错位）
        for (const ch of [...existingChapters].sort((a, b) => b.order - a.order)) {
          deleteChapter(ch.id);
        }
        createdProjectId = execMode.targetProjectId;
        await fillChaptersAndMetadata(unified);
        await saveProject();
        onClose();
        navigate(`/project/${createdProjectId}/editor`);
        return;
      }

      // ===== 模式 2：合并追加 =====
      // 策略：打开目标项目，仅追加新章节（按标题去重）
      if (execMode.kind === 'merge') {
        originalProjectId = useAppStore.getState().currentProjectId;
        await openProject(execMode.targetProjectId);
        const existingChapters = useAppStore.getState().chapters;
        const newChapters = computeNewChapters(
          { title: unified.title, chapters: unified.chapters, totalWords: unified.totalWords },
          existingChapters,
        );
        // 追加新章节到末尾
        let order = existingChapters.length;
        for (const ch of newChapters) {
          const levelType: ChapterLevelType = ch.level === 1 ? 'volume' : 'chapter';
          const newCh = addChapter(null, ch.title, order, levelType);
          if (newCh) updateChapterContent(newCh.id, ch.content);
          order++;
        }
        // 大纲模式：追加新人物/设定/伏笔（不去重，由用户后续清理）
        if (unified.isOutline && unified.outline) {
          await fillOutlineExtras(unified.outline);
        }
        createdProjectId = execMode.targetProjectId;
        await saveProject();
        onClose();
        navigate(`/project/${createdProjectId}/editor`);
        return;
      }

      // ===== 模式 3：新建 =====
      const project = await createProject(unified.title || '导入作品', 'blank');
      createdProjectId = project.id;
      await fillChaptersAndMetadata(unified);
      await saveProject();
      onClose();
      navigate(`/project/${createdProjectId}/editor`);
    } catch (e) {
      console.error('导入失败:', e);
      // 仅"新建"模式失败时回滚半成品项目；覆盖/合并失败由用户手动处理（避免误删原项目）
      if (execMode.kind === 'create-new' && createdProjectId) {
        try { await deleteProject(createdProjectId); } catch (rollbackErr) {
          console.error('回滚失败项目时出错:', rollbackErr);
        }
      }
      if (!isMountedRef.current) return;
      setError('导入失败，请重试');
      setStep('preview');
    } finally {
      importingRef.current = false;
    }
  };

  /** 填充章节（含卷·部层级）与大纲模式的元数据 */
  async function fillChaptersAndMetadata(result: UnifiedImportResult): Promise<void> {
    if (result.isOutline && result.outline) {
      const outline = result.outline;
      // 卷 → 部 层级
      for (const vol of outline.volumes) {
        const volCh = addChapter(null, vol.title, vol.order, 'volume' as ChapterLevelType);
        if (volCh) {
          const updates: Partial<Chapter> = {};
          if (vol.wordTarget) updates.wordTarget = vol.wordTarget;
          if (vol.timeSpan) updates.timeSpan = vol.timeSpan;
          if (vol.epicPositioning) updates.epigraph = vol.epicPositioning;
          if (vol.coreProposition) updates.coreProposition = vol.coreProposition;
          if (vol.notes) updates.notes = vol.notes;
          const summaryParts: string[] = [];
          if (vol.timeSpan) summaryParts.push(vol.timeSpan);
          if (vol.epicPositioning) summaryParts.push(vol.epicPositioning);
          if (vol.coreProposition) summaryParts.push(`核心命题：${vol.coreProposition}`);
          updates.summary = summaryParts.join(' | ');
          if (Object.keys(updates).length > 0) updateChapter(volCh.id, updates);
        }
        for (const part of vol.parts) {
          const partCh = addChapter(volCh?.id ?? null, part.title, part.order, 'part' as ChapterLevelType);
          if (partCh) updateChapterContent(partCh.id, part.content);
        }
      }
      // 章节列表里可能还有非卷结构的章节（混排场景）
      const volumeTitles = new Set(outline.volumes.map(v => v.title));
      const partTitles = new Set(outline.volumes.flatMap(v => v.parts.map(p => p.title)));
      const standalone = result.chapters.filter(
        c => !volumeTitles.has(c.title) && !partTitles.has(c.title),
      );
      let standaloneOrder = outline.volumes.length;
      for (const ch of standalone) {
        const newCh = addChapter(null, ch.title, standaloneOrder++, 'chapter' as ChapterLevelType);
        if (newCh) updateChapterContent(newCh.id, ch.content);
      }
      // 人物 / 设定 / 伏笔
      await fillOutlineExtras(outline);
    } else {
      // 普通模式：全部章节平铺
      let order = 0;
      for (const ch of result.chapters) {
        const levelType: ChapterLevelType = ch.level === 1 ? 'volume' : 'chapter';
        const newCh = addChapter(null, ch.title, order, levelType);
        if (newCh) updateChapterContent(newCh.id, ch.content);
        order++;
      }
    }
  }

  /** 填充大纲模式的额外元数据：人物、设定、伏笔 */
  async function fillOutlineExtras(outline: ParsedOutline): Promise<void> {
    for (const setting of outline.settings) {
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
    for (const char of outline.characters) {
      const characterData: Partial<Character> = {
        name: char.name,
        role: char.role,
        profile: char.profile,
        tags: char.role === 'protagonist' ? ['主角'] : [],
      };
      addCharacter(characterData);
    }
    for (const fs of outline.foreshadows) {
      addForeshadow({
        title: fs.title,
        description: fs.description,
        priority: fs.priority,
        status: 'planted',
      });
    }
  }

  // ==================== 派生展示数据 ====================

  const newChaptersPreview = useMemo(() => {
    if (!unified || !execMode) return [];
    if (execMode.kind !== 'merge') return [];
    const existing = useAppStore.getState().chapters;
    return computeNewChapters(
      { title: unified.title, chapters: unified.chapters, totalWords: unified.totalWords },
      existing,
    );
  }, [unified, execMode]);

  const modifiedChaptersPreview = useMemo(() => {
    if (!unified || !execMode) return [];
    if (execMode.kind !== 'overwrite') return [];
    const existing = useAppStore.getState().chapters;
    return computeModifiedChapters(
      { title: unified.title, chapters: unified.chapters, totalWords: unified.totalWords },
      existing,
    );
  }, [unified, execMode]);

  // ==================== 渲染 ====================

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => step !== 'importing' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="智能导入"
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
              <h2 className="text-lg font-semibold text-ink-100">智能导入</h2>
              <p className="text-xs text-ink-500">
                {step === 'input' && '支持文件 / 粘贴 / 拖拽，自动识别格式与相同项目'}
                {step === 'decision' && '检测到与现有项目的关联，请选择处理方式'}
                {step === 'preview' && '解析完成，确认后开始导入'}
                {step === 'importing' && '正在导入，请稍候...'}
              </p>
            </div>
          </div>
          <button
            onClick={() => step !== 'importing' && onClose()}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors disabled:opacity-40"
            aria-label="关闭"
            disabled={step === 'importing'}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* 步骤进度条 */}
        <div className="flex items-center gap-1 mb-4 text-xs flex-shrink-0">
          {(['input', 'decision', 'preview', 'importing'] as const).map((s, idx) => {
            const isActive = step === s;
            const isDone = ['input', 'decision', 'preview', 'importing'].indexOf(step) > idx;
            // decision 步骤无匹配时跳过
            const skipped = s === 'decision' && decision?.kind === 'create-new';
            if (skipped) return null;
            return (
              <div key={s} className="flex items-center gap-1">
                {idx > 0 && <ChevronRight className="w-3 h-3 text-ink-700" />}
                <span className={`px-2 py-0.5 rounded ${
                  isActive ? 'bg-amber-400/20 text-amber-300' :
                  isDone ? 'text-emerald-400' : 'text-ink-600'
                }`}>
                  {s === 'input' ? '1.输入' : s === 'decision' ? '2.决策' : s === 'preview' ? '3.预览' : '4.导入'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* ===== 步骤 1：输入 ===== */}
          {step === 'input' && (
            <div className="flex flex-col gap-3">
              {/* 输入方式切换 */}
              <div className="flex gap-2">
                <button
                  onClick={() => setInputMode('file')}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    inputMode === 'file'
                      ? 'bg-amber-400/10 text-amber-300 border-amber-400/40'
                      : 'bg-ink-800/40 text-ink-400 border-ink-700/50 hover:text-ink-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 inline mr-1" />
                  文件 / 拖拽
                </button>
                <button
                  onClick={() => setInputMode('paste')}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    inputMode === 'paste'
                      ? 'bg-amber-400/10 text-amber-300 border-amber-400/40'
                      : 'bg-ink-800/40 text-ink-400 border-ink-700/50 hover:text-ink-200'
                  }`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5 inline mr-1" />
                  粘贴文本
                </button>
              </div>

              {inputMode === 'file' ? (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="点击或拖拽文件到此处导入"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                      dragOver
                        ? 'border-amber-400/50 bg-amber-400/5'
                        : 'border-ink-700 hover:border-ink-600 bg-ink-800/30'
                    }`}
                  >
                    <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? 'text-amber-400' : 'text-ink-500'}`} />
                    <p className="text-sm text-ink-200 mb-1">拖拽文件到此处，或点击选择</p>
                    <p className="text-xs text-ink-500">
                      支持 {ACCEPTED_EXTENSIONS.join(' ')} 格式
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <button onClick={handlePaste} className="btn btn-secondary text-xs py-1.5 px-3">
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      从剪贴板粘贴
                    </button>
                    <span className="text-xs text-ink-500">或直接在下方文本框粘贴内容</span>
                  </div>
                  <textarea
                    value={rawText}
                    onChange={(e) => handlePasteInput(e.target.value)}
                    placeholder={`粘贴格式示例：\n# 《作品名》\n## 卷一：卷名\n### 第一章 章节标题\n（正文...）\n\n也支持纯文本：\n第一章 风雪新野\n正文内容...`}
                    className="input min-h-[280px] resize-none font-mono text-xs leading-relaxed"
                    autoFocus
                  />
                </>
              )}

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="text-sm text-red-300">{error}</span>
                </div>
              )}

              <div className="p-3 rounded-lg bg-ink-800/50 text-xs text-ink-400 space-y-1">
                <p className="text-ink-300 font-medium mb-1 flex items-center gap-1">
                  <Info className="w-3 h-3" /> 智能识别能力
                </p>
                <p>• 自动识别 Markdown / HTML / 纯文本 / DOCX 四种内容形式</p>
                <p>• 章节标题支持：第X章/卷/部/节/回、序章/楔子/番外、Chapter/Volume、1./【1】 等</p>
                <p>• 自动检测重复出现的自定义前缀（如「✦第一话」）</p>
                <p>• 与现有项目比对指纹，自动识别「同一项目」「追更」「同名不同书」</p>
              </div>
            </div>
          )}

          {/* ===== 步骤 2：决策 ===== */}
          {step === 'decision' && decision && unified && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-amber-400/5 border border-amber-400/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-100 font-medium mb-1">
                      {decision.kind === 'suggest-overwrite' && '检测到内容完全一致'}
                      {decision.kind === 'suggest-merge' && '检测到疑似追更内容'}
                      {decision.kind === 'ask-user' && '检测到与现有项目的关联'}
                    </p>
                    <p className="text-xs text-ink-400">
                      {decision.kind === 'suggest-overwrite' && decision.reason}
                      {decision.kind === 'suggest-merge' && decision.reason}
                      {decision.kind === 'ask-user' && '请选择处理方式：'}
                    </p>
                  </div>
                </div>
              </div>

              {/* 解析摘要 */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-ink-800/40">
                  <div className="text-ink-500">作品名</div>
                  <div className="text-ink-200 truncate">{unified.title}</div>
                </div>
                <div className="p-2 rounded bg-ink-800/40">
                  <div className="text-ink-500">章节数</div>
                  <div className="text-ink-200">{unified.chapters.length}</div>
                </div>
                <div className="p-2 rounded bg-ink-800/40">
                  <div className="text-ink-500">总字数</div>
                  <div className="text-ink-200">{unified.totalWords.toLocaleString()}</div>
                </div>
              </div>

              {/* 执行模式选择 */}
              <div className="space-y-2">
                <p className="text-xs text-ink-400 font-medium">选择处理方式：</p>

                {/* 选项：另建新项目 */}
                <button
                  onClick={() => setExecMode({ kind: 'create-new' })}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    execMode?.kind === 'create-new'
                      ? 'bg-amber-400/10 border-amber-400/40'
                      : 'bg-ink-800/30 border-ink-700/50 hover:border-ink-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-ink-100">另建新项目</span>
                    {execMode?.kind === 'create-new' && <Check className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-ink-500">不影响现有项目，创建为新项目</p>
                </button>

                {/* 选项：合并追加（仅 high/suggest-merge 时推荐） */}
                {(decision.kind === 'suggest-merge' || decision.kind === 'ask-user') && (
                  <button
                    onClick={() => decision.kind === 'suggest-merge'
                      ? setExecMode({ kind: 'merge', targetProjectId: decision.target.project.projectId })
                      : decision.kind === 'ask-user' && decision.matches[0]
                        ? setExecMode({ kind: 'merge', targetProjectId: decision.matches[0].project.projectId })
                        : null
                    }
                    className={`w-full p-3 rounded-lg border text-left transition-colors ${
                      execMode?.kind === 'merge'
                        ? 'bg-amber-400/10 border-amber-400/40'
                        : 'bg-ink-800/30 border-ink-700/50 hover:border-ink-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <Merge className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-medium text-ink-100">合并追加到现有项目</span>
                      {execMode?.kind === 'merge' && <Check className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
                    </div>
                    <p className="text-xs text-ink-500">
                      保留现有章节，仅追加新章节（按标题去重）
                      {decision.kind === 'suggest-merge' && newChaptersPreview.length > 0
                        ? ` · 将追加 ${newChaptersPreview.length} 章`
                        : ''}
                    </p>
                  </button>
                )}

                {/* 选项：覆盖（仅 exact/suggest-overwrite 时显示） */}
                {decision.kind === 'suggest-overwrite' && (
                  <button
                    onClick={() => setExecMode({ kind: 'overwrite', targetProjectId: decision.target.project.projectId })}
                    className={`w-full p-3 rounded-lg border text-left transition-colors ${
                      execMode?.kind === 'overwrite'
                        ? 'bg-amber-400/10 border-amber-400/40'
                        : 'bg-ink-800/30 border-ink-700/50 hover:border-ink-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <RefreshCw className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-medium text-ink-100">覆盖现有项目内容</span>
                      {execMode?.kind === 'overwrite' && <Check className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
                    </div>
                    <p className="text-xs text-ink-500">
                      清空现有章节后用导入内容替换
                      {modifiedChaptersPreview.length > 0
                        ? ` · 将改动 ${modifiedChaptersPreview.length} 章`
                        : ''}
                    </p>
                  </button>
                )}

                {/* ask-user 多匹配：列出所有匹配项目 */}
                {decision.kind === 'ask-user' && decision.matches.length > 1 && (
                  <div className="p-3 rounded-lg bg-ink-800/30 border border-ink-700/50">
                    <p className="text-xs text-ink-400 mb-2">检测到多个相似项目：</p>
                    <div className="space-y-1">
                      {decision.matches.map((m, idx) => (
                        <button
                          key={m.project.projectId}
                          onClick={() => setExecMode({ kind: 'merge', targetProjectId: m.project.projectId })}
                          className={`w-full p-2 rounded text-xs text-left flex items-center gap-2 ${
                            execMode?.kind === 'merge' && execMode.targetProjectId === m.project.projectId
                              ? 'bg-amber-400/10 text-amber-300'
                              : 'hover:bg-ink-700/40 text-ink-300'
                          }`}
                        >
                          <span className="font-mono text-ink-600">#{idx + 1}</span>
                          <span className="flex-1 truncate">{m.project.projectTitle}</span>
                          <span className="text-ink-600">{m.project.chapterCount} 章</span>
                          <span className="text-ink-700">·</span>
                          <span className="text-amber-400/80">{m.score}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={resetInput} className="btn btn-secondary" disabled={step === 'importing'}>
                  重新输入
                </button>
                <button
                  onClick={() => setStep('preview')}
                  className="btn btn-primary flex-1"
                  disabled={!execMode}
                >
                  <ChevronRight className="w-4 h-4" />
                  下一步：预览
                </button>
              </div>
            </div>
          )}

          {/* ===== 步骤 3：预览 ===== */}
          {step === 'preview' && unified && execMode && (
            <div className="space-y-3">
              {/* 执行模式提示 */}
              <div className={`p-3 rounded-lg border flex items-start gap-2 ${
                execMode.kind === 'create-new' ? 'bg-emerald-500/10 border-emerald-500/30' :
                execMode.kind === 'merge' ? 'bg-blue-500/10 border-blue-500/30' :
                'bg-amber-500/10 border-amber-500/30'
              }`}>
                {execMode.kind === 'create-new' && <Plus className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />}
                {execMode.kind === 'merge' && <Merge className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />}
                {execMode.kind === 'overwrite' && <RefreshCw className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-100">
                    {execMode.kind === 'create-new' && '将创建为新项目'}
                    {execMode.kind === 'merge' && '将合并追加到现有项目'}
                    {execMode.kind === 'overwrite' && '将覆盖现有项目内容'}
                  </p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {execMode.kind === 'create-new' && `新建项目「${unified.title}」并填充 ${unified.chapters.length} 章`}
                    {execMode.kind === 'merge' && `追加 ${newChaptersPreview.length} 个新章节，保留现有章节`}
                    {execMode.kind === 'overwrite' && `清空后用 ${unified.chapters.length} 章替换，${modifiedChaptersPreview.length} 章内容有改动`}
                  </p>
                </div>
              </div>

              {/* 统计概览 */}
              <div className="grid grid-cols-4 gap-2">
                <div className="card p-2.5 text-center">
                  <FileText className="w-3.5 h-3.5 text-amber-400 mx-auto mb-0.5" />
                  <div className="text-sm font-semibold text-ink-100">{unified.chapters.length}</div>
                  <div className="text-[10px] text-ink-500">章节</div>
                </div>
                <div className="card p-2.5 text-center">
                  <BookOpen className="w-3.5 h-3.5 text-ink-400 mx-auto mb-0.5" />
                  <div className="text-sm font-semibold text-ink-100">{unified.totalWords.toLocaleString()}</div>
                  <div className="text-[10px] text-ink-500">字数</div>
                </div>
                {unified.isOutline && unified.outline && (
                  <>
                    <div className="card p-2.5 text-center">
                      <Users className="w-3.5 h-3.5 text-blue-400 mx-auto mb-0.5" />
                      <div className="text-sm font-semibold text-ink-100">{unified.outline.characters.length}</div>
                      <div className="text-[10px] text-ink-500">人物</div>
                    </div>
                    <div className="card p-2.5 text-center">
                      <GitBranch className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-0.5" />
                      <div className="text-sm font-semibold text-ink-100">{unified.outline.foreshadows.length}</div>
                      <div className="text-[10px] text-ink-500">伏笔</div>
                    </div>
                  </>
                )}
                {!unified.isOutline && (
                  <div className="card p-2.5 text-center col-span-2">
                    <div className="text-[10px] text-ink-500 mb-0.5">内容形式</div>
                    <div className="text-sm font-semibold text-ink-200">
                      {unified.form === 'markdown' ? 'Markdown' :
                       unified.form === 'html' ? 'HTML' :
                       unified.form === 'docx' ? 'DOCX' : '纯文本'}
                    </div>
                  </div>
                )}
              </div>

              {/* 章节列表预览 */}
              <div className="max-h-60 overflow-y-auto border border-ink-700/50 rounded-lg">
                {unified.chapters.map((ch, idx) => {
                  const isNew = execMode.kind === 'merge' && newChaptersPreview.some(nc => nc.title === ch.title);
                  const isModified = execMode.kind === 'overwrite' && modifiedChaptersPreview.some(mc => mc.imported.title === ch.title);
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-3 py-1.5 border-b border-ink-700/30 last:border-0 text-xs"
                    >
                      <File className="w-3 h-3 text-ink-500 flex-shrink-0" />
                      <span className="text-ink-300 flex-1 truncate">{ch.title || '（无标题）'}</span>
                      {ch.level === 1 && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-400/10 text-amber-400/80">卷</span>
                      )}
                      {isNew && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">新增</span>
                      )}
                      {isModified && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400">改动</span>
                      )}
                      <span className="text-ink-600">
                        {ch.content.replace(/<[^>]*>/g, '').length} 字
                      </span>
                    </div>
                  );
                })}
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-red-300">{error}</span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={resetInput} className="btn btn-secondary" disabled={step === 'importing'}>
                  重新输入
                </button>
                {decision && decision.kind !== 'create-new' && (
                  <button onClick={() => setStep('decision')} className="btn btn-secondary" disabled={step === 'importing'}>
                    返回决策
                  </button>
                )}
                <button
                  onClick={handleConfirmImport}
                  className="btn btn-primary flex-1"
                  disabled={step === 'importing'}
                >
                  {step === 'importing' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 导入中...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> 确认导入</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ===== 步骤 4：导入中 ===== */}
          {step === 'importing' && (
            <div className="py-12 text-center">
              <Loader2 className="w-10 h-10 text-amber-400 animate-spin mx-auto mb-3" />
              <p className="text-sm text-ink-200">正在导入，请稍候...</p>
              <p className="text-xs text-ink-500 mt-1">大文件可能需要几秒钟</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
