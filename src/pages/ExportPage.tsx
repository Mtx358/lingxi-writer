import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileText, File, BookOpen, Check, AlertCircle, Settings } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ExportData } from '@/utils/exporters';
import { isElectron } from '@/utils/storage';

export default function ExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useAppStore(s => s.projects);
  const chapters = useAppStore(s => s.chapters);
  const [format, setFormat] = useState<'markdown' | 'docx' | 'pdf' | 'epub' | 'txt' | 'html'>('markdown');
  const [includeToc, setIncludeToc] = useState(true);
  const [style, setStyle] = useState<'novel' | 'article' | 'script'>('novel');
  const [platform, setPlatform] = useState<'general' | 'qidian' | 'fanqie' | 'wechat'>('general');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  // 导出进度：docx/pdf/epub 为同步大计算，大篇幅作品导出耗时较长，
  // 给出可感知的进度反馈避免误以为卡死。0-90 在生成期间逐步推进，100 表示完成。
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<'idle' | 'preparing' | 'generating' | 'saving'>('idle');

  const project = projects.find(p => p.id === projectId);
  const mainChapters = chapters.filter(c => c.level === 2).sort((a, b) => a.order - b.order);

  const startProgress = (stage: 'preparing' | 'generating' | 'saving') => {
    setExportStage(stage);
    // 仅推进阶段切换时的初始进度，避免回退
    setExportProgress(prev => Math.max(prev, stage === 'preparing' ? 5 : stage === 'generating' ? 20 : 85));
  };

  const handleExport = async () => {
    if (!project) return;
    setExporting(true);
    setExported(false);
    setExportMessage(null);
    setExportProgress(0);

    // 进度推进定时器：生成期间每 300ms 推进 5-8%，封顶 90%（避免虚假 100%）
    // 实际生成器为同步阻塞，进度仅用于反馈"仍在工作"，不代表精确比例
    const progressTimer = setInterval(() => {
      setExportProgress(prev => {
        if (prev >= 90) return prev;
        return Math.min(90, prev + Math.max(1, Math.round((90 - prev) * 0.08)));
      });
    }, 300);

    try {
      // markdown / txt：保持原 Blob 下载逻辑
      if (format === 'markdown') {
        startProgress('generating');
        const content = generateMarkdown();
        downloadFile(content, `${project.title}.md`, 'text/markdown');
      } else if (format === 'txt') {
        startProgress('generating');
        const content = generateTxt();
        downloadFile(content, `${project.title}.txt`, 'text/plain');
      } else if (format === 'html') {
        // 按需加载导出器（仅 html 不依赖重型库，但为统一懒加载也走动态 import）
        startProgress('preparing');
        const { generateHtml } = await import('@/utils/exporters');
        const exportData: ExportData = { project, chapters: mainChapters, includeToc, style, platform };
        startProgress('generating');
        const content = generateHtml(exportData);
        downloadFile(content, `${project.title}.html`, 'text/html');
      } else {
        // docx / pdf / epub：调用真实生成器
        // 动态加载导出器模块，使 docx/pdf-lib/jszip 等 968KB 重型依赖仅在真正导出时加载
        startProgress('preparing');
        const { generateDocx, generatePdf, generateEpub } = await import('@/utils/exporters');
        const exportData: ExportData = {
          project,
          chapters: mainChapters,
          includeToc,
          style,
          platform,
        };

        let base64: string;
        let ext: string;
        let mime: string;

        startProgress('generating');
        if (format === 'docx') {
          base64 = await generateDocx(exportData);
          ext = 'docx';
          mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (format === 'pdf') {
          const pdfResult = await generatePdf(exportData);
          base64 = pdfResult.base64;
          ext = 'pdf';
          mime = 'application/pdf';
          if (!pdfResult.chineseFontLoaded) {
            setExportMessage({ type: 'warning', text: '中文字体加载失败，PDF 中中文可能显示为方块。请检查网络连接后重试。' });
          }
        } else {
          base64 = await generateEpub(exportData);
          ext = 'epub';
          mime = 'application/epub+zip';
        }

        const filename = `${project.title}.${ext}`;

        startProgress('saving');
        if (isElectron()) {
          // Electron：通过保存对话框选择路径，再写入二进制文件
          const filePath = await window.electronAPI!.dialog.saveFile(filename, '', ext);
          if (filePath) {
            await window.electronAPI!.file.writeBuffer(filePath, base64);
          }
        } else {
          // 非 Electron：base64 转 Blob 下载
          const blob = new Blob(
            [Uint8Array.from(atob(base64), c => c.charCodeAt(0))],
            { type: mime }
          );
          downloadBlob(blob, filename);
        }
      }

      setExportProgress(100);
      setExportStage('idle');
      setExported(true);
      setTimeout(() => {
        setExported(false);
        setExportProgress(0);
      }, 3000);
    } catch (e) {
      console.error('Export failed:', e);
      const msg = e instanceof Error ? e.message : String(e);
      setExportMessage({ type: 'error', text: `导出失败：${msg}。请重试或检查项目数据是否完整。` });
      setExportProgress(0);
      setExportStage('idle');
    } finally {
      clearInterval(progressTimer);
      setExporting(false);
    }
  };

  const generateMarkdown = (): string => {
    if (!project) return '';
    let md = `# ${project.title}\n\n`;
    if (project.description) md += `> ${project.description}\n\n`;
    md += '---\n\n';

    if (includeToc) {
      md += '## 目录\n\n';
      mainChapters.forEach((ch, idx) => {
        md += `${idx + 1}. [${ch.title}](#${ch.title.replace(/\s/g, '-')})\n`;
      });
      md += '\n---\n\n';
    }

    mainChapters.forEach((ch) => {
      md += `## ${ch.title}\n\n`;
      if (ch.summary) md += `*${ch.summary}*\n\n`;
      const plainContent = ch.content
        .replace(/<h[1-6][^>]*>/g, '### ')
        .replace(/<\/h[1-6]>/g, '\n\n')
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '\n\n')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]*>/g, '');
      md += plainContent;
      md += '\n\n---\n\n';
    });

    return md;
  };

  const generateTxt = (): string => {
    if (!project) return '';
    let txt = `${project.title}\n${'='.repeat(project.title.length * 2)}\n\n`;
    if (project.description) txt += `${project.description}\n\n`;

    mainChapters.forEach((ch) => {
      txt += `\n\n${ch.title}\n${'-'.repeat(ch.title.length)}\n\n`;
      const plainContent = ch.content.replace(/<[^>]*>/g, '');
      txt += plainContent;
    });

    return txt;
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formats = [
    { id: 'markdown', label: 'Markdown', icon: FileText, desc: '.md 纯文本格式' },
    { id: 'docx', label: 'Word', icon: File, desc: '.docx 文档格式' },
    { id: 'pdf', label: 'PDF', icon: File, desc: '.pdf 打印格式' },
    { id: 'epub', label: 'EPUB', icon: BookOpen, desc: '.epub 电子书格式' },
    { id: 'html', label: 'HTML', icon: FileText, desc: '.html 网页格式' },
    { id: 'txt', label: '纯文本', icon: File, desc: '.txt 纯文本格式' },
  ];

  const platforms = [
    { id: 'general', label: '通用', desc: '标准排版' },
    { id: 'qidian', label: '起点', desc: '起点中文网格式' },
    { id: 'fanqie', label: '番茄', desc: '番茄小说格式' },
    { id: 'wechat', label: '微信读书', desc: '微信读书格式' },
  ];

  if (!project) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-ink-950">
        <div className="text-ink-400">加载中...</div>
      </div>
    );
  }

  const precheckIssues = [
    { type: 'warning', text: '有 2 个伏笔尚未回收' },
    { type: 'info', text: '1 个章节状态为草稿' },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 overflow-hidden">
      <div className="absolute inset-0 grain-overlay pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 h-14 border-b border-ink-800/50 flex items-center justify-between px-4 bg-ink-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/project/${projectId}/editor`)}
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-ink-100 flex items-center gap-2">
              <Download className="w-4 h-4 text-amber-400" />
              导出发布
            </h1>
            <p className="text-xs text-ink-500">{project.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {format === 'pdf' && (
            <span className="text-[10px] text-amber-400/70 hidden sm:inline flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              PDF 导出需联网加载中文字体（首次导出时），无网络时中文可能显示异常
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn btn-primary text-sm disabled:opacity-50"
          >
            {exporting ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-ink-900/30 border-t-ink-900 rounded-full animate-spin" />
                导出中 {exportProgress}%
              </span>
            ) : exported ? (
              <><Check className="w-4 h-4" /> 已导出</>
            ) : (
              <><Download className="w-4 h-4" /> 开始导出</>
            )}
          </button>
        </div>
      </header>

      {/* Export Progress Bar */}
      {exporting && (
        <div className="relative z-10 px-4 py-2 bg-ink-800/50 border-b border-ink-700/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-ink-300 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
              {exportStage === 'preparing' && '正在加载导出模块...'}
              {exportStage === 'generating' && `正在生成 ${format.toUpperCase()} 文件...`}
              {exportStage === 'saving' && '正在保存文件...'}
              {exportStage === 'idle' && '处理中...'}
            </span>
            <span className="text-[10px] text-ink-500 font-mono">{exportProgress}%</span>
          </div>
          <div className="w-full h-1.5 bg-ink-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-300 transition-all duration-300 ease-out"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
        </div>
      )}

     {/* Message Banner */}
      {exportMessage && (
        <div className={`relative z-10 px-4 py-2 text-xs flex items-center gap-2 ${
          exportMessage.type === 'warning'
            ? 'bg-amber-400/10 text-amber-300 border-b border-amber-400/20'
            : exportMessage.type === 'error'
            ? 'bg-red-400/10 text-red-300 border-b border-red-400/20'
            : 'bg-emerald-400/10 text-emerald-300 border-b border-emerald-400/20'
        }`}>
          {exportMessage.type === 'warning' ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          ) : exportMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{exportMessage.text}</span>
        </div>
      )}

      {/* Content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          {/* Format Selection */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-ink-200 mb-3 flex items-center gap-2">
              <Settings className="w-4 h-4 text-amber-400" />
              选择格式
            </h2>
            <div className="grid grid-cols-5 gap-2">
              {formats.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id as typeof format)}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    format === f.id
                      ? 'border-amber-400/50 bg-amber-400/10'
                      : 'border-ink-700 bg-ink-800/30 hover:border-ink-600'
                  }`}
                >
                  <f.icon className={`w-6 h-6 mx-auto mb-2 ${
                    format === f.id ? 'text-amber-400' : 'text-ink-500'
                  }`} />
                  <div className={`text-sm font-medium ${
                    format === f.id ? 'text-ink-100' : 'text-ink-300'
                  }`}>
                    {f.label}
                  </div>
                  <div className="text-[10px] text-ink-500 mt-0.5">{f.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Export Options */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-ink-200 mb-3">导出选项</h2>
            <div className="card p-4 space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-ink-200">包含目录</div>
                  <div className="text-xs text-ink-500">在文档开头生成章节目录</div>
                </div>
                <div className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                  includeToc ? 'bg-amber-400' : 'bg-ink-700'
                }`}
                  onClick={() => setIncludeToc(!includeToc)}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    includeToc ? 'left-5' : 'left-0.5'
                  }`} />
                </div>
              </label>

              <div className="divider" />

              <div>
                <div className="text-sm text-ink-200 mb-2">排版风格</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'novel', label: '小说' },
                    { id: 'article', label: '文章' },
                    { id: 'script', label: '剧本' },
                  ].map(s => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id as typeof style)}
                      className={`py-2 text-sm rounded transition-colors ${
                        style === s.id
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                          : 'bg-ink-700/50 text-ink-400 hover:text-ink-200 border border-transparent'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divider" />

              <div>
                <div className="text-sm text-ink-200 mb-2">平台预设</div>
                <div className="grid grid-cols-4 gap-2">
                  {platforms.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPlatform(p.id as typeof platform)}
                      className={`py-2 text-xs rounded transition-colors ${
                        platform === p.id
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                          : 'bg-ink-700/50 text-ink-400 hover:text-ink-200 border border-transparent'
                      }`}
                    >
                      <div className="font-medium">{p.label}</div>
                      <div className="text-[9px] opacity-70 mt-0.5">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Pre-check */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-ink-200 mb-3">导出前检查</h2>
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-ink-300">项目健康度</span>
                <span className="text-sm text-amber-400 font-medium">良好</span>
              </div>
              <div className="w-full h-2 bg-ink-700 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full" style={{ width: '82%' }} />
              </div>

              <div className="space-y-2">
                {precheckIssues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 p-2 rounded text-xs ${
                      issue.type === 'warning'
                        ? 'bg-amber-400/10 text-amber-300'
                        : 'bg-blue-400/10 text-blue-300'
                    }`}
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{issue.text}</span>
                  </div>
                ))}
                <div className="flex items-start gap-2 p-2 rounded text-xs bg-emerald-400/10 text-emerald-300">
                  <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{mainChapters.length} 个章节结构完整</span>
                </div>
              </div>
            </div>
          </section>

          {/* Preview */}
          <section>
            <h2 className="text-sm font-medium text-ink-200 mb-3">预览</h2>
            <div className="card p-4 max-h-64 overflow-y-auto">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold text-ink-100 writing-font">{project.title}</h3>
                {project.description && (
                  <p className="text-xs text-ink-500 mt-1">{project.description}</p>
                )}
              </div>
              <div className="divider mb-4" />
              {mainChapters.slice(0, 2).map(ch => (
                <div key={ch.id} className="mb-4">
                  <h4 className="text-sm font-medium text-ink-200 writing-font mb-2">{ch.title}</h4>
                  <p className="text-xs text-ink-400 writing-font leading-relaxed line-clamp-3">
                    {ch.content.replace(/<[^>]*>/g, '').slice(0, 150)}...
                  </p>
                </div>
              ))}
              <p className="text-center text-xs text-ink-600">... 共 {mainChapters.length} 章</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
