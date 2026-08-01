/**
 * 情节扩展器 Tab
 *
 * 由原 OutlinePolishPanel.tsx 中 ExpansionTab 函数原样搬迁而来。
 * 选中过于单薄的章节，AI 基于上下文与角色设定生成多个富有张力的发展方案，
 * 可将方案追加到章节摘要。内含章节切换竞态守卫。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { GitBranch, Loader2, Sparkles, Zap, CheckCircle, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { isPolishableChapter } from '@/utils/chapterUtils';
import type { Chapter, OutlineExpansionOption } from '@/types';

export function ExpansionPanel({
  chapters,
  currentChapterId,
  onSelectChapter,
}: {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(currentChapterId);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<OutlineExpansionOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fetchExpansion = useAppStore(s => s.fetchOutlineExpansion);
  const clearCache = useAppStore(s => s.clearOutlineExpansionCache);
  const updateChapter = useAppStore(s => s.updateChapter);
  // 章节切换请求 ID：快速从 A 切到 B 时，两个 fetchExpansion 并发飞行，
  // store 层的 beginRequest('outlineExpansion:A') 与 :B 互不干扰，
  // A 的响应若晚于 B 到达会覆盖 B 的选项，UI 显示 A 的扩展方案而选择器显示 B。
  // 用 ref 跟踪最新请求，await 后比对丢弃旧响应。
  const reqIdRef = useRef(0);

  useEffect(() => {
    // 当前章节变化时跟随选中
    if (currentChapterId && !selectedId) {
      setSelectedId(currentChapterId);
    }
  }, [currentChapterId, selectedId]);

  const loadOptions = useCallback(async (chapterId: string, force = false) => {
    if (force) clearCache(chapterId);
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchExpansion(chapterId);
      // 期间用户已切到其他章节 → 丢弃本次响应，避免覆盖新章节的选项
      if (reqId !== reqIdRef.current) return;
      setOptions(result);
      if (result.length === 0) setError('暂无扩展方案');
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : '生成失败');
      setOptions([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [fetchExpansion, clearCache]);

  useEffect(() => {
    if (!selectedId) {
      setOptions([]);
      return;
    }
    loadOptions(selectedId);
  }, [selectedId, loadOptions]);

  const selectedChapter = chapters.find(c => c.id === selectedId);

  const applyOption = (opt: OutlineExpansionOption) => {
    if (!selectedChapter) return;
    // 从 store 读取最新 chapter：连续点击两个不同选项"追加到摘要"时，
    // selectedChapter.summary 是闭包捕获的陈旧值，第二次 updateChapter 会覆盖第一次的追加
    const latest = useAppStore.getState().chapters.find(c => c.id === selectedChapter.id);
    const base = latest?.summary || '';
    const newSummary = base
      ? `${base}\n\n【扩展方向·${opt.title}】${opt.content}`
      : `【扩展方向·${opt.title}】${opt.content}`;
    updateChapter(selectedChapter.id, { summary: newSummary });

    // 同步更新后续关联章节：在 notes 中追加铺垫提示（文档：选中方案自动补全本节拍内容，同步更新后续关联章节）
    if (opt.affectedChapterIds && opt.affectedChapterIds.length > 0) {
      const allChapters = useAppStore.getState().chapters;
      const noteTag = `【连锁·${opt.title}】需为本章增加铺垫以承接前文扩展`;
      for (const affId of opt.affectedChapterIds) {
        const aff = allChapters.find(c => c.id === affId);
        if (!aff) continue;
        const prevNotes = aff.notes || '';
        // 避免重复追加同一提示
        if (prevNotes.includes(noteTag)) continue;
        const newNotes = prevNotes ? `${prevNotes}\n${noteTag}` : noteTag;
        updateChapter(affId, { notes: newNotes });
      }
      const titles = opt.affectedChapterIds
        .map(id => allChapters.find(c => c.id === id)?.title)
        .filter(Boolean)
        .join('、');
      if (titles) {
        // 轻量提示：已同步后续章节（避免引入 toast 依赖）
        console.info(`[扩展器] 已为后续章节追加铺垫提示：${titles}`);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="p-3 bg-ink-800/30 rounded-lg">
        <div className="text-xs text-ink-300 font-medium mb-1 flex items-center gap-1">
          <GitBranch className="w-3.5 h-3.5 text-amber-400" />
          情节扩展器
        </div>
        <p className="text-[11px] text-ink-500">
          选中过于单薄的章节，AI 基于上下文与角色设定生成多个富有张力的发展方案
        </p>
      </div>

      <div>
        <div className="text-[10px] text-ink-500 mb-1">选择章节</div>
        <select
          aria-label="选择章节"
          value={selectedId || ''}
          onChange={e => {
            const id = e.target.value;
            setSelectedId(id || null);
            if (id) onSelectChapter(id);
          }}
          className="w-full bg-ink-800/60 text-ink-200 text-xs px-2 py-1.5 rounded border border-ink-700/50"
        >
          <option value="">未选择</option>
          {chapters.filter(isPolishableChapter).map(ch => (
            <option key={ch.id} value={ch.id}>{ch.title}</option>
          ))}
        </select>
      </div>

      {selectedChapter && (
        <div className="p-2 bg-ink-800/20 rounded text-[11px] text-ink-400">
          <div className="text-ink-300 mb-0.5">当前摘要：</div>
          <div className="line-clamp-3">{selectedChapter.summary || '（空）'}</div>
          <div className="text-ink-500 mt-1">{selectedChapter.wordCount} 字</div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-ink-400 p-3" role="status" aria-live="polite">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          正在生成扩展方案...
        </div>
      )}

      {!loading && error && (
        <div className="p-3 bg-red-400/5 border border-red-400/20 rounded text-[11px] text-red-300" role="alert">
          {error}
          <button
            onClick={() => selectedId && loadOptions(selectedId, true)}
            className="ml-2 underline hover:text-red-200"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && options.length > 0 && (
        <div className="space-y-2" role="status" aria-live="polite" aria-label="扩展方案列表">
          {options.map((opt, idx) => (
            <div key={idx} className="p-3 bg-ink-800/30 rounded-lg border border-ink-700/40">
              <div className="text-xs text-amber-300 font-medium mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {opt.title}
              </div>
              <div className="text-[11px] text-ink-300 leading-relaxed mb-2">{opt.content}</div>
              {opt.dramaticTension && (
                <div className="text-[10px] text-pink-300 mb-2 flex items-start gap-1">
                  <Zap className="w-3 h-3 flex-shrink-0 mt-px" />
                  <span>张力点：{opt.dramaticTension}</span>
                </div>
              )}
              {opt.chainImpacts && opt.chainImpacts.length > 0 && (
                <div className="text-[10px] text-amber-300/90 mb-2 space-y-0.5">
                  <div className="flex items-start gap-1">
                    <GitBranch className="w-3 h-3 flex-shrink-0 mt-px" />
                    <span className="font-medium">连锁影响：</span>
                  </div>
                  {opt.chainImpacts.map((impact, i) => (
                    <div key={i} className="pl-4 border-l border-amber-500/20 ml-1">{impact}</div>
                  ))}
                  {opt.affectedChapterIds && opt.affectedChapterIds.length > 0 && (
                    <div className="pl-4 ml-1 text-ink-400">
                      采纳后将自动为后续章节追加铺垫提示
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => applyOption(opt)}
                className="text-[10px] px-2 py-0.5 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded flex items-center gap-1"
              >
                <CheckCircle className="w-2.5 h-2.5" />
                {opt.affectedChapterIds && opt.affectedChapterIds.length > 0 ? '采纳并同步后续章节' : '追加到摘要'}
              </button>
            </div>
          ))}
          <button
            onClick={() => selectedId && loadOptions(selectedId, true)}
            className="w-full text-[10px] text-ink-500 hover:text-ink-300 py-1 flex items-center justify-center gap-1"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            重新生成
          </button>
        </div>
      )}
    </div>
  );
}
