import { useState, useEffect, useRef } from 'react';
import type { ExportData } from '@/utils/exporters';
import { isElectron } from '@/utils/storage';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Project, Chapter, ExportPlatform } from '@/types';
import type { ExportFormat, ExportStyle, ExportStage, ExportMessage, ProgressInfo } from './types';

// 剥离 HTML 标签并解码 HTML 实体（如 &amp; &lt; &nbsp;），避免导出/预览出现实体残留
export function stripHtml(html: string): string {
  const stripped = html.replace(/<[^>]*>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = stripped;
  return ta.value;
}

// 统一的 Blob 下载：合并原 downloadFile/downloadBlob，避免每次渲染重建函数
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放：Firefox 等浏览器异步开始下载时 URL 仍需有效，立即 revoke 可能导致下载失败
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface UseExportActionsParams {
  project: Project | undefined;
  mainChapters: Chapter[];
  format: ExportFormat;
  includeToc: boolean;
  style: ExportStyle;
  platform: ExportPlatform;
  projectId: string | undefined;
}

export function useExportActions(params: UseExportActionsParams) {
  const { project, mainChapters, format, includeToc, style, platform, projectId } = params;
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportMessage, setExportMessage] = useState<ExportMessage | null>(null);
  // 导出进度：docx/pdf/epub 为同步大计算，大篇幅作品导出耗时较长，
  // 给出可感知的进度反馈避免误以为卡死。0-90 在生成期间逐步推进，100 表示完成。
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<ExportStage>('idle');

  // 进度/重置定时器与挂载标记：组件卸载时统一清理，避免 setState 指向已卸载组件
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  // 切项目时清空导出状态：避免上一项目的"导出中"进度条/导出消息残留
  useEffect(() => {
    setExporting(false);
    setExported(false);
    setExportProgress(0);
    setExportStage('idle');
    setExportMessage(null);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, [projectId]);

  const startProgress = (stage: 'preparing' | 'generating' | 'saving') => {
    setExportStage(stage);
    // 仅推进阶段切换时的初始进度，避免回退
    setExportProgress(prev => Math.max(prev, stage === 'preparing' ? 5 : stage === 'generating' ? 20 : 85));
  };

  // 真实进度回调：将导出器上报的章节级粒度映射到 20%-80% 区间
  // packing 阶段（PDF/DOCX 序列化）映射到 80%-95%
  // 主进度来自回调；下方心跳定时器仅作为「保活」，防止 packing 阶段无反馈时进度条停滞
  const makeProgressHandler = (total: number) => {
    return (info: ProgressInfo) => {
      if (info.stage === 'preparing') {
        setExportStage('preparing');
        setExportProgress(prev => Math.max(prev, 5));
      } else if (info.stage === 'generating') {
        setExportStage('generating');
        const ratio = info.total > 0 ? info.current / info.total : 0;
        // generating 阶段映射到 20%-80%
        setExportProgress(prev => Math.max(prev, Math.min(80, 20 + Math.round(ratio * 60))));
      } else if (info.stage === 'packing') {
        setExportStage('generating');
        setExportProgress(prev => Math.max(prev, 88));
      }
      void total; // total 参数保留以备未来按章节总数预估
    };
  };

  const generateMarkdown = (): string => {
    if (!project) return '';
    let md = `# ${project.title}\n\n`;
    if (project.description) md += `> ${project.description}\n\n`;
    md += '---\n\n';

    if (includeToc) {
      md += '## 目录\n\n';
      mainChapters.forEach((ch, idx) => {
        // 用章节索引作为锚点，避免中文标题因编码/空格问题无法跳转
        md += `${idx + 1}. [${ch.title}](#chapter-${idx + 1})\n`;
      });
      md += '\n---\n\n';
    }

    mainChapters.forEach((ch, idx) => {
      // 在标题前插入锚点，供目录跳转
      md += `<a id="chapter-${idx + 1}"></a>\n\n`;
      md += `## ${ch.title}\n\n`;
      if (ch.summary) md += `*${ch.summary}*\n\n`;
      const plainContent = stripHtml(
        ch.content
          .replace(/<h[1-6][^>]*>/g, '### ')
          .replace(/<\/h[1-6]>/g, '\n\n')
          .replace(/<p>/g, '')
          .replace(/<\/p>/g, '\n\n')
          .replace(/<br\s*\/?>/g, '\n')
      );
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
      txt += stripHtml(ch.content);
    });

    return txt;
  };

  const handleExport = async () => {
    if (!project) return;
    // 新导出启动时清除上一次导出的重置定时器，避免与新导出状态冲突
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setExporting(true);
    setExported(false);
    setExportMessage(null);
    setExportProgress(0);

    // 心跳定时器：仅作为「保活」——packing 阶段（PDF/DOCX 序列化）无章节级回调，
    // 主进度由 makeProgressHandler 推进；此定时器在主进度未达 88% 时缓慢向上推，
    // 防止打包阶段卡住不动让用户误以为崩溃。主进度已达 88% 后不再干预（让真实回调接管）。
    progressTimerRef.current = setInterval(() => {
      setExportProgress(prev => {
        if (prev >= 88) return prev;
        return Math.min(88, prev + 1);
      });
    }, 800);

    try {
      // markdown / txt：保持原 Blob 下载逻辑
      if (format === 'markdown') {
        startProgress('generating');
        const content = generateMarkdown();
        downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), `${project.title}.md`);
      } else if (format === 'txt') {
        startProgress('generating');
        const content = generateTxt();
        downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${project.title}.txt`);
      } else if (format === 'html') {
        // 按需加载导出器（仅 html 不依赖重型库，但为统一懒加载也走动态 import）
        startProgress('preparing');
        const { generateHtml } = await import('@/utils/exporters');
        if (!isMountedRef.current) return;
        const exportData: ExportData = { project, chapters: mainChapters, includeToc, style, platform };
        startProgress('generating');
        const content = generateHtml(exportData);
        downloadBlob(new Blob([content], { type: 'text/html;charset=utf-8' }), `${project.title}.html`);
      } else {
        // docx / pdf / epub：调用真实生成器
        // 动态加载导出器模块，使 docx/pdf-lib/jszip 等 968KB 重型依赖仅在真正导出时加载
        startProgress('preparing');
        const { generateDocx, generatePdf, generateEpub } = await import('@/utils/exporters');
        if (!isMountedRef.current) return;
        const onProgress = makeProgressHandler(mainChapters.length);
        const exportData: ExportData = {
          project,
          chapters: mainChapters,
          includeToc,
          style,
          platform,
          onProgress,
        };

        let base64: string;
        let ext: string;
        let mime: string;

        startProgress('generating');
        if (format === 'docx') {
          base64 = await generateDocx(exportData);
          if (!isMountedRef.current) return;
          ext = 'docx';
          mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (format === 'pdf') {
          const pdfResult = await generatePdf(exportData);
          if (!isMountedRef.current) return;
          base64 = pdfResult.base64;
          ext = 'pdf';
          mime = 'application/pdf';
          if (!pdfResult.chineseFontLoaded) {
            setExportMessage({ type: 'warning', text: '中文字体加载失败，PDF 中中文可能显示为方块。请检查网络连接后重试。' });
          }
        } else {
          base64 = await generateEpub(exportData);
          if (!isMountedRef.current) return;
          ext = 'epub';
          mime = 'application/epub+zip';
        }

        // 文件名非法字符转义：与 saveProjectAs 一致，避免 Blob 下载路径生成不可用文件名
        const filename = `${project.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;

        startProgress('saving');
        // 显式检查 electronAPI 是否存在，缺失时回退到 Blob 下载，避免非空断言导致的运行时错误
        const saveDialog = window.electronAPI?.dialog?.saveFile;
        if (isElectron() && saveDialog) {
          // Electron：通过保存对话框选择路径，再通过专用 export 通道写入文件
          // 使用 exportFile.writeBuffer 而非 file.writeBuffer：后者仅允许 userData 内路径，
          // 会拒绝用户通过对话框选择的 Documents/Desktop 等路径（H2 修复）
          const filePath = await saveDialog(filename, '', ext);
          if (!isMountedRef.current) return;
          if (!filePath) {
            // 用户在保存对话框点击"取消"，filePath 为空——不应误显"已导出"
            setExportMessage({ type: 'warning', text: '已取消保存' });
            setExportProgress(0);
            setExportStage('idle');
            return;
          }
          const writeBuffer = window.electronAPI?.exportFile?.writeBuffer;
          if (!writeBuffer) {
            setExportMessage({ type: 'error', text: '导出失败：导出通道不可用，请重启应用后重试。' });
            setExportProgress(0);
            setExportStage('idle');
            return;
          }
          // 检查返回值：主进程可能因路径校验失败/磁盘满/权限不足返回 false，
          // 不检查会误报"已导出"但文件实际未写入（H2 修复前的静默失败问题）
          const ok = await writeBuffer(filePath, base64);
          if (!isMountedRef.current) return;
          if (!ok) {
            setExportMessage({ type: 'error', text: '导出失败：文件写入被拒绝或发生错误。请检查路径权限后重试。' });
            setExportProgress(0);
            setExportStage('idle');
            return;
          }
        } else {
          // 非 Electron 或 bridge 缺失：base64 转 Blob 下载
          const blob = new Blob(
            [Uint8Array.from(atob(base64), c => c.charCodeAt(0))],
            { type: mime }
          );
          downloadBlob(blob, filename);
        }
      }

      if (!isMountedRef.current) return;
      setExportProgress(100);
      setExportStage('idle');
      setExported(true);
      // 3 秒后重置导出状态；保存 timer id 供新导出/卸载清理，并用 isMountedRef 守卫避免卸载后 setState
      resetTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setExported(false);
        setExportProgress(0);
      }, 3000);
    } catch (e) {
      console.error('Export failed:', e);
      if (!isMountedRef.current) return;
      const msg = getErrorMessage(e);
      setExportMessage({ type: 'error', text: `导出失败：${msg}。请重试或检查项目数据是否完整。` });
      setExportProgress(0);
      setExportStage('idle');
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (isMountedRef.current) setExporting(false);
    }
  };

  return {
    exporting,
    exported,
    exportMessage,
    exportProgress,
    exportStage,
    handleExport,
  };
}