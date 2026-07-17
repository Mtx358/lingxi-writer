import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, CheckCircle, X, ChevronRight, Info, AlertCircle, XCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { conflictDetector } from '@/utils/conflictDetector';
import type { ConflictIssue } from '@/types';

interface ConflictPanelProps {
  onClose?: () => void;
}

const SEVERITY_CONFIG: Record<ConflictIssue['severity'], { icon: typeof AlertTriangle; color: string; bgColor: string; label: string }> = {
  error: { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-400/10', label: '错误' },
  warning: { icon: AlertCircle, color: 'text-amber-400', bgColor: 'bg-amber-400/10', label: '警告' },
  info: { icon: Info, color: 'text-blue-400', bgColor: 'bg-blue-400/10', label: '提示' },
};

const TYPE_LABELS: Record<ConflictIssue['type'], string> = {
  character: '角色',
  timeline: '时间线',
  setting: '设定',
  style: '风格',
  logic: '逻辑',
};

export default function ConflictPanel({ onClose }: ConflictPanelProps) {
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const chapters = useAppStore(s => s.chapters);
  const conflicts = useAppStore(s => s.conflicts);
  const detectConflicts = useAppStore(s => s.detectConflicts);
  const resolveConflict = useAppStore(s => s.resolveConflict);
  const addAISuggestion = useAppStore(s => s.addAISuggestion);
  const [scanning, setScanning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const currentChapter = chapters.find(c => c.id === currentChapterId);

  // mountedRef 守卫：两个 scan 函数都有 setTimeout 假扫描延迟，
  // 组件卸载后回调不应再 setState，避免内存泄漏与 React 警告。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleScan = async () => {
    if (!currentChapter) return;
    setScanning(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (!mountedRef.current) return;
      // 扫描当前章节：merge 写入，仅替换当前章节的冲突，保留其他章节既有结果。
      // 此前 setState({ conflicts: issues }) 会覆盖全书扫描结果。
      const { characters, settingItems } = useAppStore.getState();
      conflictDetector.setCharacters(characters);
      conflictDetector.setSettings(settingItems);
      const issues = conflictDetector.detectChapterConflicts(currentChapter);
      useAppStore.setState(s => ({
        conflicts: [
          ...s.conflicts.filter(i => i.chapterId !== currentChapter.id),
          ...issues,
        ],
      }));
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  };

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (!mountedRef.current) return;
      detectConflicts();
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  };

  const handleResolve = (issueId: string) => {
    resolveConflict(issueId);
  };

  const handleFix = (issue: ConflictIssue) => {
    // 当前为模板建议，未接入真实 AI 修复。文案明确为"查看修复建议模板"避免误导。
    addAISuggestion({
      type: 'fix',
      title: `修复建议模板：${issue.description.slice(0, 20)}...`,
      content: `<p>修复建议模板（非真实 AI 修复）：</p>
<p>针对"${issue.description}"的问题，建议如下：</p>
<ul>
<li>${issue.suggestion}</li>
<li>检查上下文，确保叙事视角一致</li>
<li>统一相关术语和称谓</li>
</ul>`,
      reasoning: '基于全文风格一致性分析（模板）',
      contextUsed: ['当前章节', '角色设定', '文风基准'],
    });
  };

  const unresolvedCount = conflicts.filter(i => !i.resolved).length;
  const errorCount = conflicts.filter(i => i.severity === 'error' && !i.resolved).length;
  const warningCount = conflicts.filter(i => i.severity === 'warning' && !i.resolved).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          冲突检测
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-400/20 text-amber-300">
              {unresolvedCount}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleScanAll}
            disabled={scanning}
            className="p-1.5 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors disabled:opacity-50"
            title="扫描全书"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 border-b border-ink-800/50">
        <button
          onClick={handleScan}
          disabled={scanning || !currentChapter}
          className="w-full btn btn-secondary text-xs disabled:opacity-50"
        >
          {scanning ? (
            <>扫描中...</>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5" />
              扫描当前章节
            </>
          )}
        </button>

        {conflicts.length > 0 && (
          <div className="flex gap-2 mt-2 text-[10px]">
            {errorCount > 0 && (
              <span className="text-red-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                {errorCount} 错误
              </span>
            )}
            {warningCount > 0 && (
              <span className="text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {warningCount} 警告
              </span>
            )}
          </div>
        )}
      </div>

      {/* Issues List */}
      <div className="flex-1 overflow-y-auto">
        {conflicts.length === 0 && !scanning ? (
          <div className="p-6 text-center">
            <CheckCircle className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
            <p className="text-sm text-ink-500">暂无检测到的问题</p>
            <p className="text-xs text-ink-600 mt-1">点击上方按钮开始扫描</p>
          </div>
        ) : scanning ? (
          <div className="p-6 text-center">
            <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm text-ink-400">AI 分析中...</p>
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {conflicts.map((issue) => {
              const config = SEVERITY_CONFIG[issue.severity];
              const Icon = config.icon;
              const isExpanded = expandedId === issue.id;
              const chapter = chapters.find(c => c.id === issue.chapterId);

              return (
                <div
                  key={issue.id}
                  className={`rounded-lg border transition-colors ${
                    issue.resolved
                      ? 'bg-ink-800/30 border-ink-700/30 opacity-60'
                      : `${config.bgColor} border-current/20`
                  }`}
                >
                  <div
                    className="p-2.5 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${config.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] ${config.color} font-medium`}>
                            {TYPE_LABELS[issue.type] || issue.type}
                          </span>
                          <span className="text-ink-600">·</span>
                          <span className={`text-[10px] ${config.color}`}>
                            {config.label}
                          </span>
                          {chapter && (
                            <>
                              <span className="text-ink-600">·</span>
                              <span className="text-[10px] text-ink-500 truncate">
                                {chapter.title}
                              </span>
                            </>
                          )}
                        </div>
                        <p className={`text-xs ${issue.resolved ? 'text-ink-500 line-through' : 'text-ink-200'}`}>
                          {issue.description}
                        </p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-ink-500 flex-shrink-0 transition-transform ${
                        isExpanded ? 'rotate-90' : ''
                      }`} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-2.5 pb-2.5 pl-8 animate-slide-down">
                      <div className="p-2 bg-ink-800/50 rounded text-xs text-ink-400 mb-2">
                        <span className="text-ink-300">💡 建议：</span>
                        {issue.suggestion}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFix(issue); }}
                          className="flex-1 py-1 text-[10px] bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center justify-center gap-1"
                        >
                          查看修复建议模板
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResolve(issue.id); }}
                          className="flex-1 py-1 text-[10px] bg-ink-700/50 text-ink-300 hover:bg-ink-700 rounded flex items-center justify-center gap-1"
                        >
                          {issue.resolved ? '取消忽略' : '标记忽略'}
                        </button>
                      </div>
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
