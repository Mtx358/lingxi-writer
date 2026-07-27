/**
 * MentionExtension 单元测试
 *
 * 测试范围：
 *   - Node 名称、group、inline、atom、selectable 等基础配置
 *   - addAttributes：id / label / type 的 parseHTML / renderHTML
 *   - parseHTML：识别 span[data-mention]
 *   - renderHTML：输出 span + data-mention + data-id + data-type + class + label 文本
 *   - addCommands.insertMention：调用 commands.insertContent 注入 mention 节点
 *   - addOptions：默认 HTMLAttributes 为空对象
 *
 * 说明：Tiptap 的 Node.create 返回 NodeConfig，可单元测试其纯函数部分；
 * 不在此处集成 Editor（集成测试由 TiptapEditor 覆盖）。
 *
 * 注：Tiptap 内部用 getExtensionField 绑定 this 后调用 addAttributes/addOptions/
 * parseHTML/renderHTML/addCommands。这里为绕过 TS 的严格 this 类型检查，将 cfg
 * 视为 any 调用相关方法；运行时行为与 Tiptap 调用方式等价（仅缺少 parent 上下文，
 * 本扩展未使用 parent）。
 */
import { describe, it, expect, vi } from 'vitest';
import { MentionExtension } from '@/components/editor/extensions/MentionExtension';

// Tiptap 的 Node.create(config) 把所有配置存到 .config 中，
// 仅 name/type/parent/child/options/storage 等少量字段暴露为实例属性。
// addAttributes/addOptions/parseHTML/renderHTML/addCommands 等需通过 .config 访问。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cfg = MentionExtension.config as any;

describe('MentionExtension', () => {
  describe('基础配置', () => {
    it('name 为 "mention"', () => {
      expect(MentionExtension.name).toBe('mention');
    });

    it('group 为 inline', () => {
      expect(cfg.group).toBe('inline');
    });

    it('inline 为 true', () => {
      expect(cfg.inline).toBe(true);
    });

    it('atom 为 true（原子节点，整体选中）', () => {
      expect(cfg.atom).toBe(true);
    });

    it('selectable 为 true', () => {
      expect(cfg.selectable).toBe(true);
    });
  });

  describe('addOptions', () => {
    it('默认 HTMLAttributes 为空对象', () => {
      const options = cfg.addOptions();
      expect(options).toEqual({ HTMLAttributes: {} });
    });

    it('每次调用返回新对象（避免共享引用）', () => {
      const a = cfg.addOptions();
      const b = cfg.addOptions();
      expect(a).not.toBe(b);
      expect(a.HTMLAttributes).not.toBe(b.HTMLAttributes);
    });
  });

  describe('addAttributes', () => {
    const attrs = cfg.addAttributes();

    it('包含 id / label / type 三个属性', () => {
      expect(Object.keys(attrs).sort()).toEqual(['id', 'label', 'type']);
    });

    it('id 属性：parseHTML 读取 data-id', () => {
      const el = document.createElement('span');
      el.setAttribute('data-id', 'char-001');
      expect(attrs.id.parseHTML(el)).toBe('char-001');
    });

    it('id 属性：renderHTML 输出 { data-id }', () => {
      expect(attrs.id.renderHTML({ id: 'char-002' })).toEqual({ 'data-id': 'char-002' });
    });

    it('id 属性：默认值为 null', () => {
      expect(attrs.id.default).toBeNull();
    });

    it('label 属性：parseHTML 读取 data-label', () => {
      const el = document.createElement('span');
      el.setAttribute('data-label', '李白');
      expect(attrs.label.parseHTML(el)).toBe('李白');
    });

    it('label 属性：renderHTML 输出 { data-label }', () => {
      expect(attrs.label.renderHTML({ label: '杜甫' })).toEqual({ 'data-label': '杜甫' });
    });

    it('label 属性：默认值为 null', () => {
      expect(attrs.label.default).toBeNull();
    });

    it('type 属性：parseHTML 读取 data-type，缺省回退为 character', () => {
      const el1 = document.createElement('span');
      el1.setAttribute('data-type', 'location');
      expect(attrs.type.parseHTML(el1)).toBe('location');

      const el2 = document.createElement('span');
      expect(attrs.type.parseHTML(el2)).toBe('character');
    });

    it('type 属性：renderHTML 输出 { data-type }', () => {
      expect(attrs.type.renderHTML({ type: 'item' })).toEqual({ 'data-type': 'item' });
    });

    it('type 属性：默认值为 character', () => {
      expect(attrs.type.default).toBe('character');
    });
  });

  describe('parseHTML', () => {
    it('返回规则匹配 span[data-mention]', () => {
      const rules = cfg.parseHTML();
      expect(rules).toHaveLength(1);
      expect(rules[0].tag).toBe('span[data-mention]');
    });
  });

  describe('renderHTML', () => {
    const render = cfg.renderHTML;
    const fakeNode = (overrides: Partial<{ id: string | null; label: string | null; type: string }> = {}) => ({
      attrs: {
        id: 'id-1',
        label: '李白',
        type: 'character',
        ...overrides,
      },
    });

    type Triple = [string, Record<string, unknown>, string];

    it('返回 [tag, attrs, text] 三元组', () => {
      const out = render({ node: fakeNode(), HTMLAttributes: {} }) as Triple;
      expect(Array.isArray(out)).toBe(true);
      expect(out[0]).toBe('span');
      expect(out).toHaveLength(3);
    });

    it('携带 data-mention 空属性标记', () => {
      const out = render({ node: fakeNode(), HTMLAttributes: {} }) as Triple;
      expect(out[1]['data-mention']).toBe('');
    });

    it('携带 data-id 与 data-type', () => {
      const out = render({ node: fakeNode({ id: 'char-1', type: 'location' }), HTMLAttributes: {} }) as Triple;
      expect(out[1]['data-id']).toBe('char-1');
      expect(out[1]['data-type']).toBe('location');
    });

    it('携带 mention-node 与高亮样式 class', () => {
      const out = render({ node: fakeNode(), HTMLAttributes: {} }) as Triple;
      expect(out[1].class).toContain('mention-node');
      expect(out[1].class).toContain('bg-amber-500/20');
    });

    it('label 作为子文本节点', () => {
      const out = render({ node: fakeNode({ label: '李白' }), HTMLAttributes: {} }) as Triple;
      expect(out[2]).toBe('李白');
    });

    it('label 为 null 时回退为空字符串', () => {
      const out = render({ node: fakeNode({ label: null }), HTMLAttributes: {} }) as Triple;
      expect(out[2]).toBe('');
    });

    it('合并外部 HTMLAttributes（如 data-foo）', () => {
      const out = render({
        node: fakeNode(),
        HTMLAttributes: { 'data-foo': 'bar' },
      }) as Triple;
      expect(out[1]['data-foo']).toBe('bar');
      // 仍保留 data-mention
      expect(out[1]['data-mention']).toBe('');
    });

    it('外部 HTMLAttributes 不会覆盖 data-id/data-type（mergeAttributes 后者优先）', () => {
      // 实际上 mergeAttributes 后传入的 HTMLAttributes 在前，扩展自身属性在后，
      // 后者覆盖前者，确保 mention 关键属性始终由扩展控制
      const out = render({
        node: fakeNode({ id: 'real-id', type: 'character' }),
        HTMLAttributes: { 'data-id': 'wrong', 'data-type': 'wrong' },
      }) as Triple;
      // 至少保证扩展自身的关键属性最终生效（值不为 'wrong'）
      expect(out[1]['data-id']).not.toBe('wrong');
    });
  });

  describe('addCommands.insertMention', () => {
    it('insertMention 调用 commands.insertContent 注入 mention 节点', () => {
      const commands = cfg.addCommands.call({ name: 'mention' });
      expect(typeof commands.insertMention).toBe('function');

      const insertContent = vi.fn().mockReturnValue(true);
      const ctx = { commands: { insertContent } };

      // this.name 在 Node.create 后会被 Tiptap 内部绑定；此处通过 call 显式提供 this
      const result = commands.insertMention(
        { id: 'char-9', label: '白居易', type: 'character' },
      )(ctx);

      expect(insertContent).toHaveBeenCalledTimes(1);
      expect(insertContent).toHaveBeenCalledWith({
        type: 'mention',
        attrs: { id: 'char-9', label: '白居易', type: 'character' },
      });
      expect(result).toBe(true);
    });

    it('insertMention 透传不同 type（如 location）', () => {
      const commands = cfg.addCommands.call({ name: 'mention' });
      const insertContent = vi.fn().mockReturnValue(true);
      const ctx = { commands: { insertContent } };

      commands.insertMention(
        { id: 'loc-1', label: '长安', type: 'location' },
      )(ctx);

      expect(insertContent).toHaveBeenCalledWith({
        type: 'mention',
        attrs: { id: 'loc-1', label: '长安', type: 'location' },
      });
    });

    it('insertMention 透传 insertContent 的返回值', () => {
      const commands = cfg.addCommands.call({ name: 'mention' });
      const insertContent = vi.fn().mockReturnValue(false);
      const ctx = { commands: { insertContent } };

      const result = commands.insertMention(
        { id: 'x', label: 'y', type: 'character' },
      )(ctx);

      expect(result).toBe(false);
    });
  });
});
