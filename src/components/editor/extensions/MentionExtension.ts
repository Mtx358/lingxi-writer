import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode, DOMOutputSpec } from '@tiptap/pm/model';
import type { RawCommands } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    insertMention: {
      insertMention: (options: { id: string; label: string; type: string }) => ReturnType;
    };
  }
}

export const MentionExtension = Node.create({
  name: 'mention',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
        renderHTML: (attributes: { id: string | null }) => ({ 'data-id': attributes.id }),
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
        renderHTML: (attributes: { label: string | null }) => ({ 'data-label': attributes.label }),
      },
      type: {
        default: 'character',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-type') || 'character',
        renderHTML: (attributes: { type: string }) => ({ 'data-type': attributes.type }),
      },
    };
  },

  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  parseHTML() {
    return [
      {
        tag: 'span[data-mention]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }: { node: PMNode; HTMLAttributes: Record<string, any> }): DOMOutputSpec {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-mention': '',
        'data-id': node.attrs.id,
        'data-type': node.attrs.type,
        class: 'mention-node bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded cursor-pointer',
      }),
      node.attrs.label ?? ''];
  },

  addCommands() {
    return {
      insertMention: (options: { id: string; label: string; type: string }) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options,
        });
      },
    } as Partial<RawCommands>;
  },
});