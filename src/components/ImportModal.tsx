import { useState, useRef, useEffect } from 'react';
import { X, Upload, FileText, AlertCircle, Check, File } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { parseMarkdown, parsePlainText, parseDocx } from '@/utils/importUtils';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { ImportResult, HeadingMapping, HeadingTarget } from '@/utils/importUtils';

const HEADING_OPTIONS: { value: HeadingTarget; label: string }[] = [
  { value: 'title', label: '作品' },
  { value: 'volume', label: '分卷' },
  { value: 'chapter', label: '章节' },
  { value: 'ignore', label: '忽略' },
];

const DEFAULT_HEADING_MAPPING: HeadingMapping = {
  h1: 'title',
  h2: 'chapter',
  h3: 'ignore',
};

// 导入文件大小上限 20 MB，避免一次性读入超大文件导致卡死
const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

interface ImportModalProps {
  onClose: () => void;
}

export default function ImportModal({ onClose }: ImportModalProps) {
  const navigate = useNavigate();
  const createProject = useAppStore(s => s.createProject);
  const addChapter = useAppStore(s => s.addChapter);
  const updateChapterContent = useAppStore(s => s.updateChapterContent);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isDocx, setIsDocx] = useState(false);
  const [headingMapping, setHeadingMapping] = useState<HeadingMapping>(DEFAULT_HEADING_MAPPING);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 跟踪 docx object URL 以便释放；标记挂载状态避免卸载后 setState
  const objectUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  // 同步守卫：防止双击"确认导入"在 setImporting(true) 异步生效前并发触发两次导入
  const importingRef = useRef(false);
  // 组件挂载即视为打开（由父级条件渲染控制），焦点陷阱常驻激活
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // 组件卸载时释放可能残留的 docx object URL，避免内存泄漏
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Esc 关闭模态（IME 组合输入时忽略，避免中断中文输入）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  useEffect(() => {
    if (!fileContent && !isDocx) return;
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
    }
    parseTimerRef.current = setTimeout(() => {
      const processResult = async () => {
        try {
          let result: ImportResult;
          if (isDocx) {
            try {
              const response = await fetch(fileContent);
              const arrayBuffer = await response.arrayBuffer();
              result = await parseDocx(arrayBuffer, headingMapping);
            } catch {
              if (!isMountedRef.current) return;
              setError('DOCX 解析失败，请确保文件格式正确');
              setImportResult(null);
              return;
            }
          } else if (isMarkdown) {
            result = parseMarkdown(fileContent, headingMapping);
          } else {
            result = parsePlainText(fileContent);
          }
          if (result.chapters.length === 0) {
            if (!isMountedRef.current) return;
            setImportResult(null);
            setError('未识别到有效内容，请检查文件格式或标题映射配置');
            return;
          }
          if (!isMountedRef.current) return;
          setImportResult(result);
          setError('');
        } catch (e) {
          // parseMarkdown/parsePlainText/parseDocx 抛错时统一兜底，避免未捕获异常
          console.error('解析文件失败:', e);
          if (!isMountedRef.current) return;
          setError('文件解析失败，请检查文件格式');
          setImportResult(null);
        }
      };
      processResult();
    }, 300);
    return () => {
      if (parseTimerRef.current) {
        clearTimeout(parseTimerRef.current);
      }
    };
  }, [fileContent, isMarkdown, isDocx, headingMapping]);

  const handleFile = async (file: File) => {
    setError('');
    // 文件大小限制，避免一次性读入超大文件导致卡死
    if (file.size > MAX_IMPORT_SIZE) {
      setError('文件过大，请控制在 20 MB 以内');
      return;
    }
    // 扩展名大小写不敏感校验（含拖拽入文件，拖拽不走 input accept）
    const lowerName = file.name.toLowerCase();
    const isMd = lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
    const docxExt = lowerName.endsWith('.docx');
    const isTxt = lowerName.endsWith('.txt');
    if (!isMd && !docxExt && !isTxt) {
      setError('仅支持 .md .markdown .txt .docx 格式');
      return;
    }
    setFileName(file.name);
    try {
      setIsMarkdown(isMd);
      setIsDocx(docxExt);

      if (docxExt) {
        // 重新生成 URL 前释放上一次的 object URL，避免内存泄漏
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        setFileContent(url);
      } else {
        const text = await file.text();
        setFileContent(text);
      }
    } catch {
      if (!isMountedRef.current) return;
      setError('文件读取失败，请重试');
      setFileContent('');
      setIsMarkdown(false);
      setIsDocx(false);
      setImportResult(null);
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

  const handleConfirmImport = async () => {
    if (!importResult) return;
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);

    // 记录已创建的项目 ID，导入失败时回滚半成品项目，避免首页残留空壳
    let createdProjectId: string | null = null;
    try {
      const project = await createProject(importResult.title || '导入作品', 'blank');
      createdProjectId = project.id;

      let order = 0;
      importResult.chapters.forEach(ch => {
        const newChapter = addChapter(null, ch.title, order);
        if (newChapter) {
          updateChapterContent(newChapter.id, ch.content);
        }
        order++;
      });

      // 显式持久化章节后再跳转，避免编辑器挂载时 openProject 覆盖内存中尚未落盘的导入数据；
      // 用 await 替代原 500ms setTimeout 盲等
      await useAppStore.getState().saveProject();
      onClose();
      navigate(`/project/${createdProjectId}/editor`);
    } catch (e) {
      console.error('导入失败:', e);
      // 回滚半成品项目：删除已创建的项目及其关联存储键
      if (createdProjectId) {
        try {
          await useAppStore.getState().deleteProject(createdProjectId);
        } catch (rollbackErr) {
          console.error('回滚失败项目时出错:', rollbackErr);
        }
      }
      if (!isMountedRef.current) return;
      // 清空 importResult 让视图回退到输入区，使 error 文案可见
      // （error 仅在 !importResult 分支渲染，否则用户在预览态看不到失败提示）
      setImportResult(null);
      setError('导入失败，请重试');
    } finally {
      importingRef.current = false;
      if (isMountedRef.current) setImporting(false);
    }
  };

  const showMappingConfig = !fileName || isMarkdown;

  const mappingConfig = showMappingConfig ? (
    <div className="my-4 p-3 rounded-lg bg-ink-800/50 border border-ink-700/50">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-ink-300 font-medium">标题层级映射</p>
        <span className="text-[10px] text-ink-500">Markdown / DOCX 生效</span>
      </div>
      <div className="space-y-1.5">
        {(['h1', 'h2', 'h3'] as const).map((key) => {
          const label = key === 'h1' ? '# 一级标题' : key === 'h2' ? '## 二级标题' : '### 三级标题';
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-ink-400 w-20 flex-shrink-0">{label}</span>
              <div className="flex gap-1 flex-1">
                {HEADING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setHeadingMapping((prev) => ({ ...prev, [key]: opt.value }))}
                    className={`flex-1 px-1.5 py-1 text-xs rounded transition-colors ${
                      headingMapping[key] === opt.value
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                        : 'bg-ink-800/60 text-ink-400 border border-ink-700/50 hover:text-ink-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="导入作品"
    >
      <div 
        className="card p-6 w-full max-w-lg mx-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink-100">导入作品</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {!importResult ? (
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
              <p className="text-sm text-ink-200 mb-1">
                拖拽文件到此处，或点击选择
              </p>
              <p className="text-xs text-ink-500">
                支持 .md .txt .docx 格式，自动识别章节标题
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />

            {mappingConfig}

            {error && (
              <div
                role="alert"
                className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span className="text-sm text-red-300">{error}</span>
              </div>
            )}

            <div className="mt-4 p-3 rounded-lg bg-ink-800/50 text-xs text-ink-400 space-y-1">
              <p className="text-ink-300 font-medium mb-1">💡 导入提示</p>
              <p>• Markdown 文件：## 开头的行会识别为章节标题</p>
              <p>• 纯文本文件："第X章"、"Chapter X" 等会识别为章节</p>
              <p>• 未识别到章节时，全文作为第一章导入</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 mb-4">
              <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-sm text-emerald-300 font-medium">文件解析成功</p>
                <p className="text-xs text-emerald-400/70">{fileName}</p>
              </div>
            </div>

            {mappingConfig}

            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-400">作品标题</span>
                <span className="text-ink-200 font-medium">{importResult.title}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-400">识别章节数</span>
                <span className="text-ink-200 font-medium">{importResult.chapters.length} 章</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-400">总字数</span>
                <span className="text-ink-200 font-medium">{importResult.totalWords.toLocaleString()} 字</span>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto border border-ink-700/50 rounded-lg mb-4">
              {importResult.chapters.map((ch, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-2 border-b border-ink-700/30 last:border-0 text-sm"
                >
                  <File className="w-4 h-4 text-ink-500 flex-shrink-0" />
                  <span className="text-ink-300 flex-1 truncate">{ch.title}</span>
                  {ch.level === 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400/80 border border-amber-400/20 flex-shrink-0">
                      分卷
                    </span>
                  )}
                  <span className="text-ink-500 text-xs">
                    {ch.content.replace(/<[^>]*>/g, '').length} 字
                  </span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setImportResult(null);
                  setFileName('');
                  setFileContent('');
                  setIsMarkdown(false);
                  setIsDocx(false);
                  // 释放残留的 docx object URL
                  if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current);
                    objectUrlRef.current = null;
                  }
                }}
                className="flex-1 btn btn-secondary"
                disabled={importing}
              >
                重新选择
              </button>
              <button
                onClick={handleConfirmImport}
                className="flex-1 btn btn-primary"
                disabled={importing}
              >
                {importing ? (
                  <>导入中...</>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    确认导入
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
