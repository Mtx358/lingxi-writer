import { useCallback } from 'react';
import { confirm } from '@/hooks/useConfirm';
import { CHAPTER_BATCH_MERGE_MIN } from '@/constants/config';
import type { Chapter } from '@/types';

/**
 * 大纲选择 + 批量操作 hook。
 *
 * 拆分自原 OutlinePanel.tsx 的 handleSelect / handleBatchDelete / handleBatchMerge：
 *   - handleSelect：普通点击单选；Ctrl+点击 toggle 多选
 *   - handleBatchDelete：删除前过滤"祖先已选中"的子节点（避免级联删除重复处理）
 *   - handleBatchMerge：合并元数据策略——characterFocus/keyEvents/foreshadows 取并集，
 *     summary/perspective/theme/notes 以首章节为准，status 取最靠后（draft<writing<reviewing<done）
 *
 * 合并前为首个章节创建版本快照，便于误操作后恢复。
 */
export interface UseOutlineSelectionDeps {
  chapters: Chapter[];
  selectedIds: Set<string>;
  setSelectedIds: (updater: (prev: Set<string>) => Set<string>) => void;
  setSelectedChapter: (chapter: Chapter | null) => void;
  updateChapter: (id: string, updates: Partial<Chapter>) => void;
  deleteChapter: (id: string) => void;
  saveVersion: (chapterId: string, description: string) => void;
  setShowBatchMenu: (v: boolean) => void;
}

export function useOutlineSelection({
  chapters,
  selectedIds,
  setSelectedIds,
  setSelectedChapter,
  updateChapter,
  deleteChapter,
  saveVersion,
  setShowBatchMenu,
}: UseOutlineSelectionDeps) {
  const handleSelect = useCallback((chapter: Chapter, e?: React.MouseEvent) => {
    if (e && e.ctrlKey) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(chapter.id)) next.delete(chapter.id);
        else next.add(chapter.id);
        return next;
      });
    } else {
      setSelectedIds(() => new Set([chapter.id]));
    }
    setSelectedChapter(chapter);
  }, [setSelectedIds, setSelectedChapter]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    // P-M4: 构建 id->chapter 映射，hasSelectedAncestor 的 while 循环内查找从 O(n) 降为 O(1)
    const chapterMap = new Map(chapters.map(c => [c.id, c]));
    // 父子关系防护：若某节点的祖先已在选中集合中，删除父节点时子节点会一并被级联删除，
    // 此处再次单独删除会造成 store 重复处理或找不到节点。先过滤掉"祖先已被选中"的节点。
    const hasSelectedAncestor = (id: string): boolean => {
      let currentId: string | null = id;
      const seen = new Set<string>();
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const node = chapterMap.get(currentId);
        currentId = node?.parentId ?? null;
        if (currentId && selectedIds.has(currentId)) return true;
      }
      return false;
    };
    const idsToDelete = Array.from(selectedIds).filter(id => !hasSelectedAncestor(id));
    if (idsToDelete.length === 0) return;
    if (await confirm(`确定删除选中的 ${selectedIds.size} 个章节吗？\n（含子级将一并级联删除）`)) {
      idsToDelete.forEach(id => deleteChapter(id));
      setSelectedIds(() => new Set());
      setSelectedChapter(null);
    }
    setShowBatchMenu(false);
  }, [selectedIds, chapters, deleteChapter, setSelectedIds, setSelectedChapter, setShowBatchMenu]);

  const handleBatchMerge = useCallback(async () => {
    if (selectedIds.size < CHAPTER_BATCH_MERGE_MIN) return;
    const selectedChapters = chapters.filter(c => selectedIds.has(c.id));
    if (selectedChapters.length < CHAPTER_BATCH_MERGE_MIN) return;
    const firstChapter = selectedChapters[0];
    if (!(await confirm(`确定合并选中的 ${selectedChapters.length} 个章节吗？\n\n内容将按顺序拼接到首个章节"${firstChapter.title}"中，其余章节将被删除。`))) {
      return;
    }
    // 合并前为首个章节创建版本快照，便于误操作后恢复
    saveVersion(firstChapter.id, '批量合并前快照');
    // HTML 直接拼接：用 '\n' 拼接多段 HTML 会产生破损 HTML（多余文本节点、未闭合标签交错）
    const mergedContent = selectedChapters.map(c => c.content || '').join('');
    // 元数据合并策略：
    //   - characterFocus / foreshadows：取并集并去重（ID 维度），保留所有被合并章节涉及的角色与伏笔
    //   - keyEvents：按章节顺序拼接，保留时间线脉络
    //   - summary / perspective / theme / notes：以首章节为准，避免主观描述相互覆盖
    //   - status：取"最靠后"的状态（draft < writing < reviewing < done），反映合并后整体进度
    const statusOrder: Record<Chapter['status'], number> = { draft: 0, writing: 1, reviewing: 2, done: 3 };
    const mergeStringArray = (key: 'characterFocus' | 'keyEvents' | 'foreshadows') => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const c of selectedChapters) {
        for (const v of c[key] || []) {
          if (!seen.has(v)) { seen.add(v); out.push(v); }
        }
      }
      return out.length > 0 ? out : undefined;
    };
    const mergedStatus = selectedChapters.reduce<Chapter['status']>(
      (acc, c) => statusOrder[c.status] > statusOrder[acc] ? c.status : acc,
      firstChapter.status,
    );
    updateChapter(firstChapter.id, {
      content: mergedContent,
      characterFocus: mergeStringArray('characterFocus'),
      keyEvents: mergeStringArray('keyEvents'),
      foreshadows: mergeStringArray('foreshadows'),
      status: mergedStatus,
    });
    selectedIds.forEach(id => {
      if (id !== firstChapter.id) deleteChapter(id);
    });
    setSelectedIds(() => new Set([firstChapter.id]));
    setSelectedChapter(firstChapter);
    setShowBatchMenu(false);
  }, [selectedIds, chapters, updateChapter, deleteChapter, saveVersion, setSelectedIds, setSelectedChapter, setShowBatchMenu]);

  return { handleSelect, handleBatchDelete, handleBatchMerge };
}
