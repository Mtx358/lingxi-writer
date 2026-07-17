import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Focus from '@tiptap/extension-focus';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Minus, Link2, Undo2, Redo2, Wand2, Clock, AtSign, X, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_FORESHADOW_STATUS, DEFAULT_FORESHADOW_PRIORITY } from '@/types';
import { EDITOR_SWITCH_DELAY, EDITOR_CONTENT_UPDATE_DEBOUNCE, EDITOR_EXTERNAL_SYNC_DELAY } from '@/constants/config';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from '@/hooks/useToast';
import { isOverlayOpen } from '@/utils/overlayState';
import { useEditorAI, sanitizeAiHtml } from '@/hooks/useEditorAI';
import { MentionExtension } from './extensions/MentionExtension';
import MentionPanel from './MentionPanel';
import EditorContextMenu from './EditorContextMenu';

export default function TiptapEditor() {
  const currentChapterId = useAppStore(s => s.currentChapterId);
  const currentChapter = useAppStore(s => s.chapters.find(c => c.id === s.currentChapterId));
  const saveVersion = useAppStore(s => s.saveVersion);
  const addForeshadow = useAppStore(s => s.addForeshadow);
  const pendingEditorInsert = useAppStore(s => s.pendingEditorInsert);
  const setPendingEditorInsert = useAppStore(s => s.setPendingEditorInsert);
  const contentEpoch = useAppStore(s => s.contentEpoch);
  const setAIGenerating = useAppStore(s => s.setAIGenerating);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [showMentionPanel, setShowMentionPanel] = useState(false);
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 });
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // 防抖、章节切换同步等辅助 ref（AI 流式相关 ref 已收敛到 useEditorAI hook，O1 拆分）
  const lastChapterIdRef = useRef<string | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSwitchingRef = useRef(false);
  const currentChapterIdRef = useRef(currentChapterId);
  // 内容纪元上一次值，用于检测外部内容替换
  const lastEpochRef = useRef(0);
  // 生成态 ref：在 useEditor 之前声明，供 onUpdate 闭包同步读取，避免 AI 流式期间写入 store（O1：由 useEditorAI 同步其值）
  const isGeneratingRef = useRef(false);

  useEffect(() => { currentChapterIdRef.current = currentChapterId; }, [currentChapterId]);

  // 组件卸载时清理防抖定时器（AI 流式资源的清理由 useEditorAI hook 自身负责）
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    };
  }, []);

  // 编辑器滚动时关闭右键菜单，避免菜单悬浮在原位与文本错位
  useEffect(() => {
    if (!showContextMenu) return;
    const container = editorContainerRef.current;
    if (!container) return;
    const handleScroll = () => setShowContextMenu(false);
    container.addEventListener('scroll', handleScroll, true);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      container.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [showContextMenu]);

  // O3: 浮层（提及面板/右键菜单等）打开时，拦截导航键与 Enter/Tab/Esc，
  // 阻止其透传到 ProseMirror 的 keymap（bubble 阶段监听器）导致光标移动或换行。
  // 使用捕获阶段确保先于 ProseMirror 处理；仅 stopPropagation（非 stopImmediatePropagation），
  // 让浮层自身的 window 级捕获监听器仍可正常响应（window 在 editorContainer 之外）。
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const blockedKeys = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Enter', 'Tab', 'Escape',
      'Home', 'End', 'PageUp', 'PageDown',
    ]);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOverlayOpen()) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (blockedKeys.has(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    container.addEventListener('keydown', handleKeyDown, true);
    return () => container.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 使用 Tiptap 内建历史栈，统一接管原生撤销/重做，避免双栈冲突
      }),
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: '开始你的创作...',
      }),
      Focus,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      MentionExtension,
    ],
    content: currentChapter?.content || '<p></p>',
    onUpdate: ({ editor }) => {
      // 章节切换期间或 AI 流式生成期间不写入 store，避免状态竞争和串章
      if (isSwitchingRef.current || isGeneratingRef.current) return;

      const cid = currentChapterIdRef.current;
      if (!cid) return;

      const html = editor.getHTML();

      // 防抖写入 store（EDITOR_CONTENT_UPDATE_DEBOUNCE ms），避免每敲一个字都触发全量状态更新和磁盘 IO
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => {
        useAppStore.getState().updateChapterContent(cid, html);
      }, EDITOR_CONTENT_UPDATE_DEBOUNCE);

      // 检测 @ 触发提及面板：使用光标真实视口坐标定位
      const { state } = editor;
      const { selection } = state;
      const pos = selection.from;
      const textBefore = state.doc.textBetween(Math.max(0, pos - 20), pos);
      const atIndex = textBefore.lastIndexOf('@');

      if (atIndex !== -1 && atIndex === textBefore.length - 1) {
        const coords = editor.view.coordsAtPos(pos);
        setMentionPosition({
          x: coords.left,
          y: coords.bottom + 4,
        });
        setShowMentionPanel(true);
      }
    },
  });

  // O1: AI 续写/润色逻辑由 useEditorAI hook 接管，返回生成态、ref 与中止入口
  const {
    isGenerating,
    handleContinue,
    handlePolish,
    abortGeneration,
  } = useEditorAI({
    editor,
    currentChapterId,
    currentChapter,
    currentChapterIdRef,
    isGeneratingRef,
    saveVersion,
    setAIGenerating,
  });

  // 章节切换时强制同步内容（以 chapterId 为唯一依赖，避免 content 引用不变导致不触发）
  useEffect(() => {
    if (!editor) return;
    if (currentChapterId !== lastChapterIdRef.current) {
      // S2: 切换前优先中止进行中的 AI 请求，确保流式回调不会在新章节内容写入后
      // 仍调用 insertContentAt 把旧章节的 AI 内容串到新章节。
      // 中止逻辑统一收敛到 abortGeneration，清理 controller/timer/buffer 并复位生成态。
      abortGeneration();

      // 切换前 flush 旧章节的防抖写入，避免上一章未保存的内容丢失
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
        const oldCid = lastChapterIdRef.current;
        if (oldCid) {
          useAppStore.getState().updateChapterContent(oldCid, editor.getHTML());
        }
      }
      isSwitchingRef.current = true;
      lastChapterIdRef.current = currentChapterId;
      const targetContent = currentChapter?.content || '<p></p>';
      editor.commands.setContent(targetContent, { emitUpdate: false });
      // 短暂延迟后恢复 onUpdate 写入，确保 setContent 不会触发 store 更新
      const timer = setTimeout(() => { isSwitchingRef.current = false; }, EDITOR_SWITCH_DELAY);
      return () => clearTimeout(timer);
    }
  }, [currentChapterId, editor, currentChapter, abortGeneration]);

  // 监听 contentEpoch：外部（恢复版本/恢复草稿）替换章节内容时，强制编辑器刷新
  useEffect(() => {
    if (!editor) return;
    if (contentEpoch === lastEpochRef.current) return;
    lastEpochRef.current = contentEpoch;
    // 取消未触发的防抖写入，避免陈旧的编辑器内容覆盖刚恢复的内容
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    isSwitchingRef.current = true;
    const targetContent = currentChapter?.content || '<p></p>';
    editor.commands.setContent(targetContent, { emitUpdate: false });
    const timer = setTimeout(() => { isSwitchingRef.current = false; }, EDITOR_EXTERNAL_SYNC_DELAY);
    return () => clearTimeout(timer);
  }, [contentEpoch, editor, currentChapter]);

  // 监听 AI 面板的插入请求，在光标位置或末尾插入内容（替代不可靠的 CustomEvent）
  useEffect(() => {
    if (!editor || !pendingEditorInsert) return;
    // 仅作用于目标章节，避免切换章节后陈旧请求串章
    if (pendingEditorInsert.chapterId !== currentChapterId) {
      setPendingEditorInsert(null);
      return;
    }
    const safeContent = sanitizeAiHtml(pendingEditorInsert.content);
    if (pendingEditorInsert.mode === 'end') {
      const endPos = Math.max(0, editor.state.doc.content.size - 1);
      editor.chain().focus().insertContentAt(endPos, safeContent).run();
    } else {
      editor.chain().focus().insertContent(safeContent).run();
    }
    setPendingEditorInsert(null);
  }, [editor, pendingEditorInsert, setPendingEditorInsert, currentChapterId]);

  // 点击外部关闭提及面板
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showMentionPanel && editorContainerRef.current) {
        if (!editorContainerRef.current.contains(e.target as Node)) {
          setShowMentionPanel(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMentionPanel]);

  const closeContextMenu = useCallback(() => {
    setShowContextMenu(false);
  }, []);

  const handleMarkAsForeshadow = useCallback(() => {
    if (!editor || !currentChapterId) return;

    const { state } = editor;
    const { selection } = state;
    const isTextSelected = !selection.empty;

    if (isTextSelected) {
      const { from, to } = selection;
      const selectedText = state.doc.textBetween(from, to);

      addForeshadow({
        title: selectedText.slice(0, 50),
        description: selectedText,
        status: DEFAULT_FORESHADOW_STATUS,
        plantedChapterId: currentChapterId,
        priority: DEFAULT_FORESHADOW_PRIORITY,
      });

      editor.chain().focus().toggleHighlight().run();
      toast.success('已标记为伏笔', `《${selectedText.slice(0, 30)}...》已加入伏笔库`);
    }

    closeContextMenu();
  }, [editor, currentChapterId, addForeshadow, closeContextMenu]);

  // 右键菜单使用视口坐标（fixed 定位），避免嵌套偏移
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  // 插入提及：使用光标真实视口坐标
  const handleInsertMention = useCallback(() => {
    if (!editor) return;

    const { selection } = editor.state;
    const coords = editor.view.coordsAtPos(selection.from);
    setMentionPosition({
      x: coords.left,
      y: coords.bottom + 4,
    });
    setShowMentionPanel(true);
    closeContextMenu();
  }, [editor, closeContextMenu]);

  if (!editor) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">加载编辑器...</div>;
  }

  return (
    <div className="flex flex-col h-full" ref={editorContainerRef}>
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('bold') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="加粗"
        >
          <Bold size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('italic') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="斜体"
        >
          <Italic size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('underline') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="下划线"
        >
          <UnderlineIcon size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('strike') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="删除线"
        >
          <Strikethrough size={18} />
        </button>

        <div className="w-px h-6 bg-gray-600 mx-2" />

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('heading', { level: 1 }) ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="标题1"
        >
          <Heading1 size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="标题2"
        >
          <Heading2 size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="标题3"
        >
          <Heading3 size={18} />
        </button>

        <div className="w-px h-6 bg-gray-600 mx-2" />

        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('bulletList') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="无序列表"
        >
          <List size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('orderedList') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="有序列表"
        >
          <ListOrdered size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('blockquote') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="引用"
        >
          <Quote size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="p-2 rounded hover:bg-gray-700/50 transition-colors text-gray-400"
          title="分割线"
        >
          <Minus size={18} />
        </button>

        <div className="w-px h-6 bg-gray-600 mx-2" />

        <button
          onClick={() => editor.chain().focus().toggleLink({ href: '#' }).run()}
          className={`p-2 rounded hover:bg-gray-700/50 transition-colors ${editor.isActive('link') ? 'bg-gray-700 text-amber-400' : 'text-gray-400'}`}
          title="链接"
        >
          <Link2 size={18} />
        </button>

        <button
          onClick={handleInsertMention}
          className="p-2 rounded hover:bg-gray-700/50 transition-colors text-gray-400"
          title="插入@提及"
        >
          <AtSign size={18} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => editor.chain().focus().undo().run()}
          className="p-2 rounded hover:bg-gray-700/50 transition-colors text-gray-400"
          title="撤销 (Ctrl+Z)"
          disabled={!editor.can().undo()}
        >
          <Undo2 size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          className="p-2 rounded hover:bg-gray-700/50 transition-colors text-gray-400"
          title="重做 (Ctrl+Y)"
          disabled={!editor.can().redo()}
        >
          <Redo2 size={18} />
        </button>

        <div className="w-px h-6 bg-gray-600 mx-2" />

        {isGenerating ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-600/20 text-amber-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">AI 生成中...</span>
            </div>
            <button
              onClick={abortGeneration}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              title="取消生成"
            >
              <X size={16} />
              <span className="text-sm">取消</span>
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={handleContinue}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition-colors"
              title="智能续写"
            >
              <Wand2 size={16} />
              <span className="text-sm">续写</span>
            </button>
            <button
              onClick={handlePolish}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
              title="AI 润色"
            >
              <Clock size={16} />
              <span className="text-sm">润色</span>
            </button>
          </>
        )}
      </div>

      <div
        className="flex-1 overflow-auto p-6"
        onContextMenu={handleContextMenu}
      >
        <EditorContent
          editor={editor}
          className="max-w-3xl mx-auto min-h-full outline-none prose prose-invert prose-lg"
        />
      </div>

      {showMentionPanel && (
        <MentionPanel
          editor={editor}
          position={mentionPosition}
          onClose={() => setShowMentionPanel(false)}
        />
      )}

      {/* O1: 右键上下文菜单拆分为独立组件，使用 fixed 定位 + 视口坐标 */}
      {showContextMenu && (
        <EditorContextMenu
          editor={editor}
          position={menuPosition}
          onClose={closeContextMenu}
          onMarkAsForeshadow={handleMarkAsForeshadow}
          onInsertMention={handleInsertMention}
        />
      )}
    </div>
  );
}
