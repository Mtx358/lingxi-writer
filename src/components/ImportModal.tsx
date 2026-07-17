import { useState, useRef, useEffect } from 'react';
import { X, Upload, FileText, AlertCircle, Check, File } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { parseMarkdown, parsePlainText, parseDocx } from '@/utils/importUtils';
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

  useEffect(() => {
    if (!fileContent && !isDocx) return;
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
    }
    parseTimerRef.current = setTimeout(() => {
      const processResult = async () => {
        let result: ImportResult;
        if (isDocx) {
          try {
            const response = await fetch(fileContent);
            const arrayBuffer = await response.arrayBuffer();
            result = await parseDocx(arrayBuffer, headingMapping);
          } catch {
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
          setImportResult(null);
          setError('未识别到有效内容，请检查文件格式或标题映射配置');
          return;
        }
        setImportResult(result);
        setError('');
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
    setFileName(file.name);
    try {
      const isMd = file.name.endsWith('.md') || file.name.endsWith('.markdown');
      const docxExt = file.name.endsWith('.docx');
      setIsMarkdown(isMd);
      setIsDocx(docxExt);
      
      if (docxExt) {
        const url = URL.createObjectURL(file);
        setFileContent(url);
      } else {
        const text = await file.text();
        setFileContent(text);
      }
    } catch {
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

  const handleConfirmImport = () => {
    if (!importResult) return;
    setImporting(true);

    try {
      const project = createProject(importResult.title || '导入作品', 'blank');
      const projectId = project.id;

      let order = 0;
      importResult.chapters.forEach(ch => {
        const newChapter = addChapter(null, ch.title, order);
        if (newChapter) {
          updateChapterContent(newChapter.id, ch.content);
        }
        order++;
      });

      setTimeout(() => {
        onClose();
        navigate(`/project/${projectId}/editor`);
      }, 500);
    } catch {
      setError('导入失败，请重试');
      setImporting(false);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
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
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!importResult ? (
          <>
            <div
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
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
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
                onClick={() => { setImportResult(null); setFileName(''); setFileContent(''); setIsMarkdown(false); }}
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
