// 导出页内部共享类型
export type ExportFormat = 'markdown' | 'docx' | 'pdf' | 'epub' | 'txt' | 'html';
export type ExportStyle = 'novel' | 'article' | 'script';
export type ExportStage = 'idle' | 'preparing' | 'generating' | 'saving';
export type ExportMessage = { type: 'success' | 'warning' | 'error'; text: string };
export type PrecheckIssue = { type: 'warning' | 'info'; text: string };
export type ProgressInfo = {
  current: number;
  total: number;
  stage: 'preparing' | 'generating' | 'packing' | 'saving';
};
