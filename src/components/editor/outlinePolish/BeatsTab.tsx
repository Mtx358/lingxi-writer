/**
 * 节拍 Tab：章节节拍编辑器
 *
 * 由原 OutlinePolishPanel.tsx 中 BeatsTab 函数原样搬迁而来。
 * 渲染 5 大节拍槽位（hook/progress/midpoint/escalation/cliffhanger），
 * 支持 AI 一键生成、手动编辑、单槽位锁定。
 */
import { useState } from 'react';
import { Play, Loader2, Sparkles, Lock, Unlock } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Chapter, ChapterBeatType } from '@/types';
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
  // 用 Set 跟踪正在生成的章节 ID：单值状态在用户切换章节并发触发时会被
  // 先完成的请求提前清空，导致后触发的章节 spinner 提前消失
  const [generating, setGenerating] = useState<Set<string>>(new Set());

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
          return (
            <div key={type} className="p-2.5 bg-ink-800/40 border border-ink-700/50 rounded">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-amber-300 font-medium">
                  {BEAT_TYPE_LABELS[type]}
                </span>
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
              <textarea
                value={beat?.content || ''}
                onChange={e => updateChapterBeat(current.id, type, e.target.value)}
                placeholder={`填写${BEAT_TYPE_LABELS[type]}内容...`}
                rows={2}
                className="input text-[11px] py-1.5 w-full resize-none"
              />
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
