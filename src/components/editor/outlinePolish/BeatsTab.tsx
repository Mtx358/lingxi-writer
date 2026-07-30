/**
 * 节拍 Tab：章节节拍编辑器
 *
 * 由原 OutlinePolishPanel.tsx 中 BeatsTab 函数原样搬迁而来。
 * 渲染 5 大节拍槽位（hook/progress/midpoint/escalation/cliffhanger），
 * 支持 AI 一键生成、手动编辑、单槽位锁定。
 */
import { useState } from 'react';
import { Play, Loader2, Sparkles, Lock, Unlock, GitBranch, CheckCircle, Zap } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter, ChapterBeatType, OutlineExpansionOption } from '@/types';
import { EmptyHint } from './shared';
import { BEAT_TYPE_LABELS } from './constants';

export function BeatsTab({
  chapters,
  currentChapterId,
  onSelectChapter,
}: {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (id: string) => void;
}) {
  const generateBeatsForChapter = useAppStore(s => s.generateBeatsForChapter);
  const updateChapterBeat = useAppStore(s => s.updateChapterBeat);
  const toggleBeatLock = useAppStore(s => s.toggleBeatLock);
  const fetchOutlineExpansion = useAppStore(s => s.fetchOutlineExpansion);
  const clearOutlineExpansionCache = useAppStore(s => s.clearOutlineExpansionCache);
  // 用 Set 跟踪正在生成的章节 ID：单值状态在用户切换章节并发触发时会被
  // 先完成的请求提前清空，导致后触发的章节 spinner 提前消失
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  // 节拍级扩展器：记录当前展开的节拍类型 + 该节拍的扩展方案
  const [expandingBeat, setExpandingBeat] = useState<ChapterBeatType | null>(null);
  const [beatOptions, setBeatOptions] = useState<OutlineExpansionOption[]>([]);
  const [beatLoading, setBeatLoading] = useState(false);

  const current = chapters.find(c => c.id === currentChapterId) || chapters[0];

  const handleGenerate = async (chapterId: string) => {
    setGenerating(prev => new Set(prev).add(chapterId));
    try {
      await generateBeatsForChapter(chapterId);
    } finally {
      setGenerating(prev => {
        const next = new Set(prev);
        next.delete(chapterId);
        return next;
      });
    }
  };

  // 节拍内嵌扩展器：选中节拍槽位后生成 3 个情节方向，标注连锁影响
  const handleExpandBeat = async (chapterId: string, beatType: ChapterBeatType) => {
    if (expandingBeat === beatType) {
      // 再次点击折叠
      setExpandingBeat(null);
      setBeatOptions([]);
      return;
    }
    setExpandingBeat(beatType);
    setBeatLoading(true);
    setBeatOptions([]);
    try {
      clearOutlineExpansionCache(chapterId);
      const options = await fetchOutlineExpansion(chapterId);
      setBeatOptions(options);
    } finally {
      setBeatLoading(false);
    }
  };

  // 采纳节拍扩展方案：写入节拍内容 + 同步后续关联章节 notes
  const applyBeatOption = (opt: OutlineExpansionOption) => {
    if (!current || !expandingBeat) return;
    updateChapterBeat(current.id, expandingBeat, opt.content);
    // 同步后续关联章节
    if (opt.affectedChapterIds && opt.affectedChapterIds.length > 0) {
      const allChapters = useAppStore.getState().chapters;
      const noteTag = `【连锁·${opt.title}】需为本章增加铺垫以承接前文节拍扩展`;
      for (const affId of opt.affectedChapterIds) {
        const aff = allChapters.find(c => c.id === affId);
        if (!aff) continue;
        const prevNotes = aff.notes || '';
        if (prevNotes.includes(noteTag)) continue;
        useAppStore.getState().updateChapter(affId, { notes: prevNotes ? `${prevNotes}\n${noteTag}` : noteTag });
      }
    }
    setExpandingBeat(null);
    setBeatOptions([]);
  };

  if (chapters.length === 0) {
    return <EmptyHint icon={Play} text="尚无章节，先去大纲面板创建章节" />;
  }

  if (!current) return null;

  const beats = current.beats || [];

  return (
    <div className="space-y-3">
      {/* 章节选择器 */}
      <div className="flex items-center gap-1">
        <select
          aria-label="选择章节"
          value={current.id}
          onChange={e => onSelectChapter(e.target.value)}
          className="input text-xs py-1.5 flex-1"
        >
          {chapters.map(c => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <button
          onClick={() => handleGenerate(current.id)}
          disabled={generating.has(current.id)}
          className="px-2 py-1.5 text-xs bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 rounded flex items-center gap-1 disabled:opacity-50"
          title="AI 生成 5 大节拍"
        >
          {generating.has(current.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          生成节拍
        </button>
      </div>

      {/* 节拍列表 */}
      <div className="space-y-2">
        {(['hook', 'progress', 'midpoint', 'escalation', 'cliffhanger'] as ChapterBeatType[]).map(type => {
          const beat = beats.find(b => b.type === type);
          const isExpanding = expandingBeat === type;
          return (
            <div key={type} className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-amber-300 font-medium">
                  {BEAT_TYPE_LABELS[type]}
                </span>
                <div className="flex items-center gap-2">
                  {/* 节拍内嵌扩展器：点击滑出 3 个情节方向 */}
                  <button
                    onClick={() => handleExpandBeat(current.id, type)}
                    className={`text-[10px] flex items-center gap-0.5 ${
                      isExpanding ? 'text-cyan-300' : 'text-ink-500 hover:text-cyan-300'
                    }`}
                    title="选中此节拍，AI 生成 3 个情节方向（标注连锁影响）"
                  >
                    <GitBranch className="w-2.5 h-2.5" />
                    {isExpanding ? '收起' : '扩展'}
                  </button>
                  <button
                    onClick={() => toggleBeatLock(current.id, type)}
                    className={`text-[10px] flex items-center gap-0.5 ${
                      beat?.locked ? 'text-amber-300' : 'text-ink-500 hover:text-ink-300'
                    }`}
                    title={beat?.locked ? '已锁定，咬合校验不再要求修改' : '点击锁定'}
                  >
                    {beat?.locked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                    {beat?.locked ? '已锁定' : '未锁'}
                  </button>
                </div>
              </div>
              <textarea
                aria-label="节拍内容"
                value={beat?.content || ''}
                onChange={e => updateChapterBeat(current.id, type, e.target.value)}
                placeholder={`填写${BEAT_TYPE_LABELS[type]}内容...`}
                rows={2}
                className="input text-[11px] py-1.5 w-full resize-none"
              />
              {/* 节拍内嵌扩展器区域：选中节拍后展开，显示 3 个情节方向 + 连锁影响 */}
              {isExpanding && (
                <div className="mt-2 pt-2 border-t border-ink-700/50 space-y-1.5">
                  {beatLoading && (
                    <div className="flex items-center gap-1 text-[10px] text-ink-400">
                      <Loader2 className="w-3 h-3 animate-spin" /> 正在生成本节拍情节方向...
                    </div>
                  )}
                  {!beatLoading && beatOptions.length === 0 && (
                    <div className="text-[10px] text-ink-500">暂无扩展方案</div>
                  )}
                  {!beatLoading && beatOptions.map((opt, idx) => (
                    <div key={idx} className="p-1.5 bg-ink-900/40 rounded text-[10px]">
                      <div className="text-cyan-300 font-medium flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" /> {opt.title}
                      </div>
                      <div className="text-ink-300 mt-0.5 leading-relaxed">{opt.content}</div>
                      {opt.dramaticTension && (
                        <div className="text-pink-300 mt-0.5 flex items-start gap-0.5">
                          <Zap className="w-2.5 h-2.5 flex-shrink-0 mt-px" />
                          {opt.dramaticTension}
                        </div>
                      )}
                      {opt.chainImpacts && opt.chainImpacts.length > 0 && (
                        <div className="text-amber-300/80 mt-0.5">
                          <span className="font-medium">连锁影响：</span>{opt.chainImpacts.join('；')}
                        </div>
                      )}
                      <button
                        onClick={() => applyBeatOption(opt)}
                        className="mt-1 px-1.5 py-0.5 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-0.5"
                      >
                        <CheckCircle className="w-2.5 h-2.5" />
                        {opt.affectedChapterIds && opt.affectedChapterIds.length > 0 ? '采纳并同步后续' : '采纳'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {beats.length === 0 && (
        <div className="text-[10px] text-ink-500 text-center pt-2">
          点击「生成节拍」让 AI 帮你拆解本章 5 大节拍，或直接在上方手动填写
        </div>
      )}
    </div>
  );
}
