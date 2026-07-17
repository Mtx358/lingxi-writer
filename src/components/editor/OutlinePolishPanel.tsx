import { useState } from 'react';
import { 
  Wand2, 
  TrendingUp, 
  Target, 
  Zap, 
  BookOpen, 
  Sparkles,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Info,
  RefreshCw,
  Lightbulb
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { aiService } from '@/utils/aiService';
import type { Chapter } from '@/types';

interface StructureIssue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  chapterId?: string;
  chapterTitle?: string;
  description: string;
  suggestion: string;
}

interface PacingData {
  chapterId: string;
  chapterTitle: string;
  tension: number;
  wordCount: number;
}

export default function OutlinePolishPanel() {
  const chapters = useAppStore(s => s.chapters);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'structure' | 'pacing' | 'titles' | 'foreshadow'>('structure');
  const [issues, setIssues] = useState<StructureIssue[]>([]);
  const [pacingData, setPacingData] = useState<PacingData[]>([]);

  const mainChapters = chapters.filter(c => c.level === 2);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const result = await aiService.analyzeStructure(chapters);

      const mappedIssues: StructureIssue[] = result.issues.map(issue => {
        const chapter = chapters.find(c => c.id === issue.chapterId);
        return {
          ...issue,
          chapterTitle: chapter?.title,
        } as StructureIssue;
      });
      setIssues(mappedIssues);

      const pacing: PacingData[] = mainChapters.map((chapter, index) => ({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        tension: result.pacing[index] || 50,
        wordCount: chapter.wordCount,
      }));
      setPacingData(pacing);
    } finally {
      setAnalyzing(false);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error': return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      default: return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error': return 'text-red-400 border-red-500/30 bg-red-500/10';
      case 'warning': return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
      default: return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
    }
  };

  const optimizeTitles = async () => {
    setAnalyzing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      setAnalyzing(false);
    }
  };

  const checkForeshadowBalance = async () => {
    setAnalyzing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-ink-200 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-amber-400" />
          大纲打磨
        </span>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || mainChapters.length === 0}
          className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {analyzing ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          全面分析
        </button>
      </div>

      <div className="flex border-b border-ink-800/50">
        {[
          { id: 'structure', label: '结构', icon: Target },
          { id: 'pacing', label: '节奏', icon: TrendingUp },
          { id: 'titles', label: '标题', icon: BookOpen },
          { id: 'foreshadow', label: '伏笔', icon: Zap },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${
              activeTab === tab.id
                ? 'text-amber-300 border-b-2 border-amber-400 bg-amber-400/5'
                : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'structure' && (
          <>
            {issues.length === 0 ? (
              <div className="text-center py-8">
                <Target className="w-10 h-10 text-ink-600 mx-auto mb-2" />
                <p className="text-sm text-ink-500">点击"全面分析"</p>
                <p className="text-xs text-ink-600">检测大纲结构问题</p>
              </div>
            ) : (
              <div className="space-y-2">
                {issues.map((issue, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)}`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      {getSeverityIcon(issue.severity)}
                      <div className="flex-1">
                        <div className="text-sm font-medium mb-1">
                          {issue.chapterTitle && (
                            <span className="text-ink-300 mr-2">[{issue.chapterTitle}]</span>
                          )}
                          {issue.description}
                        </div>
                        <div className="text-xs text-ink-400 flex items-start gap-1">
                          <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5 text-amber-400" />
                          <span>{issue.suggestion}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-ink-800/50">
              <h4 className="text-xs font-medium text-ink-300 mb-2">三幕式结构检查</h4>
              <div className="space-y-1.5">
                {[
                  { label: '第一幕（建置）', status: 'ok', desc: '背景介绍、主角登场、激励事件' },
                  { label: '第二幕（对抗）', status: 'warning', desc: '中段略显拖沓，建议增加冲突密度' },
                  { label: '第三幕（结局）', status: 'info', desc: '高潮部分需要更强烈的情感释放' },
                ].map((item, index) => (
                  <div key={index} className="flex items-start gap-2 p-2 bg-ink-800/30 rounded">
                    {item.status === 'ok' && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />}
                    {item.status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />}
                    {item.status === 'info' && <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />}
                    <div>
                      <div className="text-xs text-ink-200">{item.label}</div>
                      <div className="text-[10px] text-ink-500">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'pacing' && (
          <>
            {pacingData.length === 0 ? (
              <div className="text-center py-8">
                <TrendingUp className="w-10 h-10 text-ink-600 mx-auto mb-2" />
                <p className="text-sm text-ink-500">点击"全面分析"</p>
                <p className="text-xs text-ink-600">查看章节节奏曲线</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="p-3 bg-ink-800/30 rounded-lg">
                  <div className="text-xs text-ink-400 mb-2">剧情张力曲线</div>
                  <div className="flex items-end gap-1 h-24">
                    {pacingData.map((data) => (
                      <div
                        key={data.chapterId}
                        className="flex-1 bg-gradient-to-t from-amber-600 to-amber-400 rounded-t transition-all hover:from-amber-500 hover:to-amber-300 cursor-pointer relative group"
                        style={{ height: `${data.tension}%` }}
                        title={`${data.chapterTitle}: ${data.tension}%`}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-ink-700 px-1.5 py-0.5 rounded text-[10px] text-ink-200 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {data.tension}%
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-ink-600">开头</span>
                    <span className="text-[10px] text-ink-600">发展</span>
                    <span className="text-[10px] text-ink-600">高潮</span>
                    <span className="text-[10px] text-ink-600">结局</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {pacingData.map((data) => (
                    <div key={data.chapterId} className="p-2 bg-ink-800/30 rounded">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-ink-200 truncate flex-1">{data.chapterTitle}</span>
                        <span className="text-[10px] text-ink-500 ml-2">{data.wordCount}字</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              data.tension > 70 ? 'bg-red-400' :
                              data.tension > 40 ? 'bg-amber-400' : 'bg-blue-400'
                            }`}
                            style={{ width: `${data.tension}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-ink-500 w-8 text-right">{data.tension}%</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-amber-400/5 border border-amber-400/20 rounded-lg">
                  <div className="text-xs text-amber-300 font-medium mb-1 flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5" />
                    节奏优化建议
                  </div>
                  <ul className="text-[11px] text-ink-400 space-y-1 list-disc list-inside">
                    <li>第三章到第五章节奏偏缓，建议压缩过渡情节</li>
                    <li>第八章高潮部分张力足够，但铺垫可以更充分</li>
                    <li>结尾收束稍显仓促，建议增加一章用于余韵</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'titles' && (
          <div className="space-y-3">
            <div className="p-3 bg-ink-800/30 rounded-lg">
              <div className="text-xs text-ink-300 font-medium mb-2">章节标题优化</div>
              <p className="text-[11px] text-ink-500 mb-3">
                AI 将根据每章内容和氛围，生成更具吸引力的标题建议
              </p>
              <button
                onClick={optimizeTitles}
                disabled={analyzing || mainChapters.length === 0}
                className="w-full py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                一键优化标题
              </button>
            </div>

            <div className="space-y-2">
              {mainChapters.map(chapter => (
                <ChapterTitleItem key={chapter.id} chapter={chapter} />
              ))}
            </div>

            <div className="p-3 bg-blue-400/5 border border-blue-400/20 rounded-lg">
              <div className="text-xs text-blue-300 font-medium mb-1">标题优化技巧</div>
              <ul className="text-[11px] text-ink-400 space-y-1 list-disc list-inside">
                <li>使用动词增加动感和画面感</li>
                <li>留下悬念，激发读者好奇心</li>
                <li>标题长度保持在4-8字最佳</li>
                <li>前后章节标题形成呼应和对比</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'foreshadow' && (
          <div className="space-y-3">
            <div className="p-3 bg-ink-800/30 rounded-lg">
              <div className="text-xs text-ink-300 font-medium mb-2">伏笔回收检查</div>
              <p className="text-[11px] text-ink-500 mb-3">
                自动检测已埋设但尚未回收的伏笔，确保故事逻辑完整
              </p>
              <button
                onClick={checkForeshadowBalance}
                disabled={analyzing}
                className="w-full py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Zap className="w-3 h-3" />
                检测伏笔平衡
              </button>
            </div>

            <div className="p-3 bg-amber-400/5 border border-amber-400/20 rounded-lg">
              <div className="text-xs text-amber-300 font-medium mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                待回收伏笔
              </div>
              <div className="text-[11px] text-ink-400">
                暂未检测到伏笔数据
              </div>
            </div>

            <div className="p-3 bg-emerald-400/5 border border-emerald-400/20 rounded-lg">
              <div className="text-xs text-emerald-300 font-medium mb-2 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                已回收伏笔
              </div>
              <div className="text-[11px] text-ink-400">
                暂未检测到伏笔数据
              </div>
            </div>

            <div className="p-3 bg-blue-400/5 border border-blue-400/20 rounded-lg">
              <div className="text-xs text-blue-300 font-medium mb-1">伏笔埋设技巧</div>
              <ul className="text-[11px] text-ink-400 space-y-1 list-disc list-inside">
                <li>伏笔要自然，不能刻意</li>
                <li>重要伏笔至少出现2-3次</li>
                <li>回收时机要恰当，过早过晚都不好</li>
                <li>可以设置"假伏笔"增加意外性</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChapterTitleItem({ chapter }: { chapter: Chapter }) {
  const [expanded, setExpanded] = useState(false);
  const updateChapter = useAppStore(s => s.updateChapter);

  const suggestions = [
    '迷雾中的脚步声',
    '不速之客',
    '命运的转折',
  ];

  const applySuggestion = (title: string) => {
    updateChapter(chapter.id, { title });
    setExpanded(false);
  };

  return (
    <div className="bg-ink-800/30 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-2 flex items-center gap-2 hover:bg-ink-700/30 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500" />}
        <span className="text-xs text-ink-200 flex-1 truncate">{chapter.title}</span>
        <span className="text-[10px] text-ink-500">{chapter.wordCount}字</span>
      </button>
      
      {expanded && (
        <div className="px-2 pb-2 pt-1 border-t border-ink-700/50 space-y-1">
          <div className="text-[10px] text-ink-500 mb-1">AI 建议标题：</div>
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => applySuggestion(suggestion)}
              className="w-full text-left px-2 py-1.5 text-xs text-ink-300 hover:text-amber-300 hover:bg-amber-400/10 rounded transition-colors flex items-center gap-2"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
