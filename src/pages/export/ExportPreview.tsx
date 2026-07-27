import { memo } from 'react';
import type { Project, Chapter } from '@/types';
import { stripHtml } from './useExportActions';

interface ExportPreviewProps {
  project: Project;
  mainChapters: Chapter[];
}

function ExportPreviewBase({ project, mainChapters }: ExportPreviewProps) {
  return (
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
              {stripHtml(ch.content).slice(0, 150)}...
            </p>
          </div>
        ))}
        <p className="text-center text-xs text-ink-600">... 共 {mainChapters.length} 章</p>
      </div>
    </section>
  );
}

// project 来自 store（引用稳定），mainChapters 已在父级 useMemo，memo 可跳过无关重渲染
export const ExportPreview = memo(ExportPreviewBase);
