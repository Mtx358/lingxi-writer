import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { Flag, AtSign } from 'lucide-react';
import { pushOverlay, popOverlay } from '@/utils/overlayState';

/**
 * 编辑器右键上下文菜单（O1 从 TiptapEditor 拆分）
 *
 * 使用 fixed 定位 + 视口坐标，避免滚动和嵌套偏移。透明遮罩用于点击外部关闭。
 * 菜单项分为三组：撤销/重做、格式（加粗/斜体/高亮）、操作（标记伏笔/插入提及）。
 */
interface EditorContextMenuProps {
  editor: Editor;
  position: { x: number; y: number };
  onClose: () => void;
  onMarkAsForeshadow: () => void;
  onInsertMention: () => void;
}

export default function EditorContextMenu({
  editor,
  position,
  onClose,
  onMarkAsForeshadow,
  onInsertMention,
}: EditorContextMenuProps) {
  // O3: 注册浮层状态，屏蔽编辑器与全局快捷键，避免方向键/Enter 同时移动
  // 右键菜单选中项与编辑器光标。卸载时配对 pop。
  useEffect(() => {
    pushOverlay();
    return () => popOverlay();
  }, []);

  // O3: Esc 关闭菜单。使用捕获阶段 + stopImmediatePropagation 防止编辑器同时处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <>
      {/* 透明遮罩，用于点击外部关闭 */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <div
        className="fixed z-50 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1"
        style={{
          left: Math.min(position.x, window.innerWidth - 200),
          top: Math.min(position.y, window.innerHeight - 320),
        }}
      >
        <button
          onClick={() => {
            editor.chain().focus().undo().run();
            onClose();
          }}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors disabled:opacity-30"
          disabled={!editor.can().undo()}
        >
          撤销
        </button>
        <button
          onClick={() => {
            editor.chain().focus().redo().run();
            onClose();
          }}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors disabled:opacity-30"
          disabled={!editor.can().redo()}
        >
          重做
        </button>
        <div className="border-t border-gray-700 my-1" />
        <button
          onClick={() => {
            editor.chain().focus().toggleBold().run();
            onClose();
          }}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors"
        >
          加粗
        </button>
        <button
          onClick={() => {
            editor.chain().focus().toggleItalic().run();
            onClose();
          }}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors"
        >
          斜体
        </button>
        <button
          onClick={() => {
            editor.chain().focus().toggleHighlight().run();
            onClose();
          }}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors"
        >
          高亮
        </button>
        <div className="border-t border-gray-700 my-1" />
        <button
          onClick={onMarkAsForeshadow}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors flex items-center gap-2"
        >
          <Flag className="w-3 h-3" />
          标记为伏笔
        </button>
        <button
          onClick={onInsertMention}
          className="w-full text-left px-4 py-2 text-gray-300 hover:bg-gray-700/50 transition-colors flex items-center gap-2"
        >
          <AtSign className="w-3 h-3" />
          插入@提及
        </button>
      </div>
    </>
  );
}
