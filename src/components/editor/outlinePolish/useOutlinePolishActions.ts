/**
 * 大纲打磨面板：action hook
 *
 * 封装主组件的两个 AI/IO handler：
 *   - handleAnalyze：触发 runOutlinePolish（按 scope 范围全面分析）
 *   - handleExportMarkdown：导出 Markdown 报告（electron saveFile + write，web 浏览器下载兜底）
 *
 * 逻辑由原 OutlinePolishPanel.tsx 主组件中的两个 useCallback 原样搬迁而来，
 * 保持依赖项与异常分支一致。
 */
import { useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { isElectron } from '@/utils/storage';
import { generateOutlinePolishMarkdown } from '@/utils/outlinePolishExport';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/errorUtils';
import type { OutlinePolishReport } from '@/types';

/**
 * @param report 当前大纲打磨报告（用于导出；为 null 时 handleExportMarkdown 直接 return）
 * @param scope  诊断范围：'all' 或具体章节 id
 */
export function useOutlinePolishActions(
  report: OutlinePolishReport | null,
  scope: 'all' | string,
) {
  const runOutlinePolish = useAppStore(s => s.runOutlinePolish);

  const handleAnalyze = useCallback(async () => {
    await runOutlinePolish(scope);
  }, [runOutlinePolish, scope]);

  // 导出 Markdown 报告
  const handleExportMarkdown = useCallback(async () => {
    if (!report) return;
    const md = generateOutlinePolishMarkdown(report);
    const defaultName = `大纲打磨报告_${new Date(report.generatedAt).toISOString().slice(0, 10)}.md`;
    if (isElectron()) {
      try {
        // dialog.saveFile 仅返回用户选择的路径，不写入内容（data 参数被主进程忽略）。
        // 需先获取路径，再通过 exportFile.write 写入文件内容（H2 修复）
        const filePath = await window.electronAPI!.dialog.saveFile(defaultName, '', 'md');
        if (!filePath) return; // 用户取消
        const writeFn = window.electronAPI?.exportFile?.write;
        if (!writeFn) {
          toast.error('导出失败', '导出通道不可用，请重启应用后重试');
          return;
        }
        const ok = await writeFn(filePath, md, 'utf-8');
        if (!ok) {
          toast.error('导出失败', '文件写入被拒绝或发生错误，请检查路径权限后重试');
          return;
        }
        toast.success('导出成功', `已保存到 ${filePath}`);
      } catch (e) {
        console.error('Export markdown failed:', e);
        const msg = getErrorMessage(e);
        toast.error('导出失败', msg);
      }
    } else {
      // Web 兜底：触发浏览器下载
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [report]);

  return { handleAnalyze, handleExportMarkdown };
}
