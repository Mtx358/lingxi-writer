/**
 * 大纲打磨面板：主组件
 *
 * 对应规格书"大纲打磨"功能，覆盖：
 *   - 智能诊断（多维度问题清单，支持单条/批量采纳）
 *   - 节奏脉搏 / 情感曲线 / 三幕比例 / 伏笔密度热力图
 *   - 角色弧光分析
 *   - 情节扩展器（按章节拉取多个发展方案）
 *   - 版本花园（保存/恢复/删除结构快照）
 *   - 报告导出为 Markdown
 *
 * 数据来源：outlinePolishSlice（lastOutlineReport / outlineSnapshots / outlineExpansionCache）。
 * 所有诊断/曲线/弧光计算由 slice + aiService 完成，组件仅负责渲染与交互。
 *
 * 本文件仅负责数据获取、状态编排、子面板组合；各 Tab 渲染逻辑拆分至同目录
 * 各功能域子模块，AI 调用 / 导出逻辑由 useOutlinePolishActions hook 统一封装。
 */
import { useState, useMemo } from 'react';
import {
  Wand2,
  TrendingUp,
  Target,
  Sparkles,
  RefreshCw,
  Download,
  Camera,
  Users,
  GitBranch,
  Play,
  ShieldAlert,
  Compass,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { TabId } from './types';
import { useOutlinePolishActions } from './useOutlinePolishActions';
import { SkeletonTab } from './SkeletonTab';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { RhythmPulsePanel } from './RhythmPulsePanel';
import { CharacterArcPanel } from './CharacterArcPanel';
import { ExpansionPanel } from './ExpansionPanel';
import { BeatsTab } from './BeatsTab';
import { CausalTab } from './CausalTab';
import { VersionGardenPanel } from './VersionGardenPanel';

export default function OutlinePolishPanel() {
  const chapters = useAppStore(s => s.chapters);
  const foreshadows = useAppStore(s => s.foreshadows);
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const report = useAppStore(s => s.lastOutlineReport);
  const isPolishing = useAppStore(s => s.isPolishingOutline);
  const snapshotCount = useAppStore(s => s.outlineSnapshots.length);

  const [activeTab, setActiveTab] = useState<TabId>('diagnosis');
  const [scope, setScope] = useState<'all' | string>('all');

  // 备忘 mainChapters：chapters 引用每次 set 都会变，但 levelType==='chapter' 的子集
  // 大多数时候未变；不 memo 会让下游 SkeletonTab/BeatsTab/CausalTab 等子组件无谓重渲染
  const mainChapters = useMemo(() => chapters.filter(c => c.levelType === 'chapter'), [chapters]);

  const { handleAnalyze, handleExportMarkdown } = useOutlinePolishActions(report, scope);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-ink-800/50 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-200 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-amber-400" />
          大纲打磨
        </span>
        <div className="flex items-center gap-1">
          {report && (
            <button
              onClick={handleExportMarkdown}
              title="导出 Markdown 报告"
              className="px-2 py-1 text-xs bg-ink-700/50 text-ink-200 hover:bg-ink-700 rounded transition-colors flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              导出
            </button>
          )}
          <button
            onClick={handleAnalyze}
            disabled={isPolishing || mainChapters.length === 0}
            className="px-2 py-1 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {isPolishing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {isPolishing ? '诊断中' : '全面分析'}
          </button>
        </div>
      </div>

      {/* 范围选择 */}
      <div className="px-3 py-2 border-b border-ink-800/50 flex items-center gap-2 text-[11px]">
        <span className="text-ink-500">诊断范围：</span>
        <select
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="flex-1 bg-ink-800/60 text-ink-200 text-[11px] px-2 py-1 rounded border border-ink-700/50"
        >
          <option value="all">全量大纲</option>
          {mainChapters.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.title}</option>
          ))}
        </select>
      </div>

      <div className="flex border-b border-ink-800/50 overflow-x-auto">
        {([
          { id: 'skeleton', label: '骨架', icon: Compass },
          { id: 'diagnosis', label: '诊断', icon: Target, badge: report?.issues.filter(i => !i.ignored && !i.resolved).length || 0 },
          { id: 'pacing', label: '节奏', icon: TrendingUp },
          { id: 'characters', label: '角色', icon: Users },
          { id: 'beats', label: '节拍', icon: Play },
          { id: 'expansion', label: '扩展', icon: GitBranch },
          { id: 'causal', label: '推演', icon: ShieldAlert },
          { id: 'snapshots', label: '版本', icon: Camera, badge: snapshotCount },
        ] as { id: TabId; label: string; icon: typeof Target; badge?: number }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-[56px] py-2 text-xs flex items-center justify-center gap-1 transition-colors relative whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-amber-300 border-b-2 border-amber-400 bg-amber-400/5'
                : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-0.5 px-1 py-px text-[9px] bg-amber-400/20 text-amber-300 rounded-full">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'skeleton' && <SkeletonTab />}
        {activeTab === 'diagnosis' && (
          <DiagnosticsPanel report={report} onJumpTo={setCurrentChapter} />
        )}
        {activeTab === 'pacing' && (
          <RhythmPulsePanel report={report} onJumpTo={setCurrentChapter} />
        )}
        {activeTab === 'characters' && (
          <CharacterArcPanel report={report} onJumpTo={setCurrentChapter} />
        )}
        {activeTab === 'expansion' && (
          <ExpansionPanel
            chapters={mainChapters}
            currentChapterId={currentChapterId}
            onSelectChapter={setCurrentChapter}
          />
        )}
        {activeTab === 'beats' && (
          <BeatsTab
            chapters={mainChapters}
            currentChapterId={currentChapterId}
            onSelectChapter={setCurrentChapter}
          />
        )}
        {activeTab === 'causal' && <CausalTab chapters={mainChapters} />}
        {activeTab === 'snapshots' && <VersionGardenPanel foreshadows={foreshadows} chapters={chapters} />}
      </div>
    </div>
  );
}
