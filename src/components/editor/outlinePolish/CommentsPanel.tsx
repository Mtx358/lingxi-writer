/**
 * 章节批注面板（规格书第二档-12）
 *
 * 打磨时对章节写批注/待办，按章节维度组织，可标记解决。
 * 与正文版本解耦——批的是"这里该怎么改"，不是"这里改了什么"。
 */
import { useState, useCallback, useMemo } from 'react';
import { MessageSquare, Plus, Check, Trash2, RotateCcw, Filter } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Section, EmptyHint } from './shared';
import type { ChapterComment } from '@/types';
import { isPolishableChapter } from '@/utils/chapterUtils';

const TYPE_META: Record<ChapterComment['type'], { label: string; color: string; bg: string }> = {
  issue: { label: '问题', color: 'text-red-400', bg: 'bg-red-500/10' },
  suggestion: { label: '建议', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  inspiration: { label: '灵感', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  todo: { label: '待办', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

export function CommentsPanel() {
  const chapters = useAppStore(s => s.chapters);
  const comments = useAppStore(s => s.comments);
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const setCurrentChapter = useAppStore(s => s.setCurrentChapter);
  const addComment = useAppStore(s => s.addComment);
  const updateComment = useAppStore(s => s.updateComment);
  const deleteComment = useAppStore(s => s.deleteComment);

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(currentChapterId);
  const [showResolved, setShowResolved] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<ChapterComment['type']>('issue');

  const mainChapters = useMemo(() => chapters.filter(c => isPolishableChapter(c)), [chapters]);
  const activeChapterId = selectedChapterId || mainChapters[0]?.id || null;

  const chapterComments = useMemo(() => {
    if (!activeChapterId) return [];
    const list = comments[activeChapterId] || [];
    return showResolved ? list : list.filter(c => !c.resolved);
  }, [comments, activeChapterId, showResolved]);

  // 全项目未解决批注计数（用于概览）
  const unresolvedTotal = useMemo(() => {
    return Object.values(comments).reduce((sum, list) => sum + list.filter(c => !c.resolved).length, 0);
  }, [comments]);

  const handleAdd = useCallback(() => {
    if (!activeChapterId || !newContent.trim()) return;
    addComment(activeChapterId, newContent.trim(), newType);
    setNewContent('');
  }, [activeChapterId, newContent, newType, addComment]);

  const handleToggleResolved = useCallback((commentId: string, resolved: boolean) => {
    updateComment(commentId, { resolved: !resolved });
  }, [updateComment]);

  if (mainChapters.length === 0) {
    return <EmptyHint icon={MessageSquare} text="还没有正文章节，无法添加批注" />;
  }

  return (
    <Section
      icon={MessageSquare}
      title="章节批注"
      desc={`打磨时的评论与待办 · 全项目未解决 ${unresolvedTotal}`}
      action={
        <button
          onClick={() => setShowResolved(v => !v)}
          className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ${
            showResolved ? 'bg-ink-700 text-ink-200' : 'text-ink-500 hover:text-ink-300'
          }`}
        >
          <Filter className="w-3 h-3" />
          {showResolved ? '显示全部' : '仅未解决'}
        </button>
      }
    >
      {/* 章节选择器 */}
      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1">
        {mainChapters.map(ch => {
          const cnt = (comments[ch.id] || []).filter(c => !c.resolved).length;
          const isActive = ch.id === activeChapterId;
          return (
            <button
              key={ch.id}
              onClick={() => { setSelectedChapterId(ch.id); setCurrentChapter(ch.id); }}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors flex items-center gap-1 ${
                isActive ? 'bg-amber-400/20 text-amber-300' : 'bg-ink-800/50 text-ink-400 hover:text-ink-200'
              }`}
            >
              第{ch.order + 1}章
              {cnt > 0 && <span className="bg-red-500/30 text-red-300 px-1 rounded-full text-[9px]">{cnt}</span>}
            </button>
          );
        })}
      </div>

      {/* 新增批注 */}
      <div className="p-2 rounded-lg bg-ink-800/40 border border-ink-700/50 space-y-2">
        <div className="flex gap-1">
          {(Object.keys(TYPE_META) as ChapterComment['type'][]).map(t => {
            const m = TYPE_META[t];
            return (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  newType === t ? `${m.bg} ${m.color}` : 'text-ink-500 hover:text-ink-300'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
            placeholder="写一句批注，回车提交…"
            className="flex-1 px-2 py-1.5 text-xs bg-ink-900/60 border border-ink-700 rounded text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-amber-400/50"
            aria-label="批注内容"
          />
          <button
            onClick={handleAdd}
            disabled={!newContent.trim()}
            className="px-2 py-1.5 text-xs bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 rounded flex items-center disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 批注列表 */}
      {chapterComments.length === 0 ? (
        <EmptyHint icon={MessageSquare} text={showResolved ? '该章节暂无批注' : '该章节没有未解决批注'} />
      ) : (
        <div className="space-y-1.5">
          {chapterComments.map(c => {
            const m = TYPE_META[c.type];
            return (
              <div
                key={c.id}
                className={`p-2 rounded-lg border ${c.resolved ? 'bg-ink-800/20 border-ink-800 opacity-60' : `${m.bg} border-ink-700/50`}`}
              >
                <div className="flex items-start gap-1.5">
                  <span className={`text-[9px] px-1 py-0.5 rounded ${m.bg} ${m.color} shrink-0`}>{m.label}</span>
                  <div className={`flex-1 text-xs leading-relaxed ${c.resolved ? 'text-ink-500 line-through' : 'text-ink-300'}`}>
                    {c.content}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-ink-600">
                    {new Date(c.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => handleToggleResolved(c.id, c.resolved)}
                      className="p-1 text-ink-500 hover:text-emerald-400 transition-colors"
                      title={c.resolved ? '标记为未解决' : '标记为已解决'}
                    >
                      {c.resolved ? <RotateCcw className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={() => deleteComment(c.id)}
                      className="p-1 text-ink-500 hover:text-red-400 transition-colors"
                      title="删除批注"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export default CommentsPanel;
