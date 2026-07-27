import { describe, it, expect, vi } from 'vitest';
import {
  computeLineDiff,
  computeCharDiff,
  computeHtmlBlockDiff,
  applyHtmlDiffRejections,
  htmlToBlocks,
  htmlToPlainText,
} from './diff';
import { DIFF_CHAR_LIMIT } from '@/constants/config';

describe('computeLineDiff', () => {
  describe('相同文本', () => {
    it('相同文本 diff 应全部为 unchanged，无 added/removed', () => {
      const diffs = computeLineDiff('hello\nworld', 'hello\nworld');
      const changes = diffs.filter(d => d.type !== 'unchanged');
      expect(changes).toHaveLength(0);
      expect(diffs.every(d => d.type === 'unchanged')).toBe(true);
    });

    it('相同多行文本行号应正确', () => {
      const diffs = computeLineDiff('a\nb\nc', 'a\nb\nc');
      expect(diffs).toHaveLength(3);
      expect(diffs[0].leftNumber).toBe(1);
      expect(diffs[1].leftNumber).toBe(2);
      expect(diffs[2].leftNumber).toBe(3);
    });
  });

  describe('完全不同', () => {
    it('完全不同的文本应全部为 modified', () => {
      const diffs = computeLineDiff('aaa', 'bbb');
      const modified = diffs.filter(d => d.type === 'modified');
      expect(modified.length).toBeGreaterThan(0);
      expect(modified[0].leftLine).toBe('aaa');
      expect(modified[0].rightLine).toBe('bbb');
    });
  });

  describe('部分修改', () => {
    it('应正确识别修改区域', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nmodified\nline3';
      const diffs = computeLineDiff(oldText, newText);
      // line1 和 line3 应为 unchanged，line2 → modified 应为 modified
      const unchanged = diffs.filter(d => d.type === 'unchanged');
      const modified = diffs.filter(d => d.type === 'modified');
      expect(unchanged.length).toBe(2);
      expect(modified.length).toBe(1);
      expect(modified[0].leftLine).toBe('line2');
      expect(modified[0].rightLine).toBe('modified');
    });
  });

  describe('插入', () => {
    it('在中间插入文本应识别为 added', () => {
      const oldText = 'line1\nline3';
      const newText = 'line1\nline2\nline3';
      const diffs = computeLineDiff(oldText, newText);
      const added = diffs.filter(d => d.type === 'added');
      expect(added.length).toBe(1);
      expect(added[0].rightLine).toBe('line2');
    });
  });

  describe('删除', () => {
    it('删除中间一段应识别为 removed', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nline3';
      const diffs = computeLineDiff(oldText, newText);
      const removed = diffs.filter(d => d.type === 'removed');
      expect(removed.length).toBe(1);
      expect(removed[0].leftLine).toBe('line2');
    });
  });

  describe('空输入', () => {
    it('两个空字符串应返回空 diff', () => {
      const diffs = computeLineDiff('', '');
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('unchanged');
    });

    it('从空到有内容应识别为新增（added 或 modified）', () => {
      const diffs = computeLineDiff('', 'new content');
      // 空字符串按 [''] 处理，与 'new content' 不同 → removed('') + added → modified
      const hasNew = diffs.some(
        d => d.type === 'added' || d.type === 'modified',
      );
      expect(hasNew).toBe(true);
      expect(diffs.some(d => d.rightLine === 'new content')).toBe(true);
    });
  });
});

describe('computeCharDiff', () => {
  describe('中文 diff', () => {
    it('中文文本 diff 应正确识别公共前缀和替换部分', () => {
      const result = computeCharDiff('你好世界', '你好中国');
      // 公共前缀 "你好"，然后 "世界" → "中国"
      const leftRemoved = result.left.filter(c => c.type === 'removed');
      const rightAdded = result.right.filter(c => c.type === 'added');
      expect(leftRemoved.length).toBeGreaterThan(0);
      expect(leftRemoved.some(c => c.content.includes('世界'))).toBe(true);
      expect(rightAdded.some(c => c.content.includes('中国'))).toBe(true);
    });

    it('相同中文文本 diff 无 added/removed', () => {
      const result = computeCharDiff('你好世界', '你好世界');
      const changes = [
        ...result.left.filter(c => c.type !== 'unchanged'),
        ...result.right.filter(c => c.type !== 'unchanged'),
      ];
      expect(changes).toHaveLength(0);
    });
  });

  describe('英文 diff', () => {
    it('英文文本 diff 应正确识别修改', () => {
      const result = computeCharDiff('hello world', 'hello there');
      // 公共前缀 "hello "，然后 "world" → "there"
      const leftRemoved = result.left.filter(c => c.type === 'removed');
      const rightAdded = result.right.filter(c => c.type === 'added');
      expect(leftRemoved.length).toBeGreaterThan(0);
      expect(rightAdded.length).toBeGreaterThan(0);
    });
  });

  describe('边界情况', () => {
    it('两个空字符串返回空 chunks', () => {
      const result = computeCharDiff('', '');
      expect(result.left).toEqual([]);
      expect(result.right).toEqual([]);
    });

    it('旧字符串为空，全部为 added', () => {
      const result = computeCharDiff('', 'new');
      expect(result.left).toEqual([]);
      expect(result.right).toHaveLength(1);
      expect(result.right[0].type).toBe('added');
      expect(result.right[0].content).toBe('new');
    });

    it('新字符串为空，全部为 removed', () => {
      const result = computeCharDiff('old', '');
      expect(result.right).toEqual([]);
      expect(result.left).toHaveLength(1);
      expect(result.left[0].type).toBe('removed');
      expect(result.left[0].content).toBe('old');
    });
  });

  describe('长文本截断', () => {
    it('超过 DIFF_CHAR_LIMIT 时应设置 truncated 标志', () => {
      const longStr1 = 'a'.repeat(DIFF_CHAR_LIMIT + 100);
      const longStr2 = 'b'.repeat(DIFF_CHAR_LIMIT + 100);
      const result = computeCharDiff(longStr1, longStr2);
      expect(result.truncated).toBe(true);
    });

    it('未超过 LIMIT 时 truncated 应为 undefined', () => {
      const result = computeCharDiff('short1', 'short2');
      expect(result.truncated).toBeUndefined();
    });

    it('截断后仍应返回有效 diff 结果', () => {
      const longStr1 = 'a'.repeat(DIFF_CHAR_LIMIT + 50);
      const longStr2 = 'b'.repeat(DIFF_CHAR_LIMIT + 50);
      const result = computeCharDiff(longStr1, longStr2);
      expect(result.left.length).toBeGreaterThan(0);
      expect(result.right.length).toBeGreaterThan(0);
    });
  });
});

describe('computeHtmlBlockDiff', () => {
  describe('HTML 标签 diff', () => {
    it('相同 HTML 应全部 unchanged', () => {
      const diffs = computeHtmlBlockDiff('<p>你好</p>', '<p>你好</p>');
      expect(diffs.every(d => d.type === 'unchanged')).toBe(true);
    });

    it('修改 <p> 内容应识别为 modified', () => {
      const diffs = computeHtmlBlockDiff('<p>旧内容</p>', '<p>新内容</p>');
      const modified = diffs.filter(d => d.type === 'modified');
      expect(modified.length).toBe(1);
      expect(modified[0].leftBlock?.textContent).toBe('旧内容');
      expect(modified[0].rightBlock?.textContent).toBe('新内容');
    });

    it('新增 <p> 块应识别为 added', () => {
      const diffs = computeHtmlBlockDiff('<p>第一段</p>', '<p>第一段</p><p>第二段</p>');
      const added = diffs.filter(d => d.type === 'added');
      expect(added.length).toBe(1);
      expect(added[0].rightBlock?.textContent).toBe('第二段');
    });

    it('删除 <p> 块应识别为 removed', () => {
      const diffs = computeHtmlBlockDiff('<p>第一段</p><p>第二段</p>', '<p>第一段</p>');
      const removed = diffs.filter(d => d.type === 'removed');
      expect(removed.length).toBe(1);
      expect(removed[0].leftBlock?.textContent).toBe('第二段');
    });

    it('多段落部分修改应正确识别', () => {
      const oldHtml = '<p>段落一</p><p>段落二</p><p>段落三</p>';
      const newHtml = '<p>段落一</p><p>修改后</p><p>段落三</p>';
      const diffs = computeHtmlBlockDiff(oldHtml, newHtml);
      const modified = diffs.filter(d => d.type === 'modified');
      expect(modified.length).toBe(1);
      expect(modified[0].leftBlock?.textContent).toBe('段落二');
      expect(modified[0].rightBlock?.textContent).toBe('修改后');
    });
  });

  describe('含 HTML 标签的行级 diff', () => {
    it('HTML 标签差异可通过 computeLineDiff 检测', () => {
      const diffs = computeLineDiff('<p>旧内容</p>', '<p>新内容</p>');
      const modified = diffs.filter(d => d.type === 'modified');
      expect(modified.length).toBe(1);
    });
  });
});

describe('applyHtmlDiffRejections', () => {
  describe('应用 diff 恢复文本', () => {
    it('不拒绝任何修改应保持新 HTML', () => {
      const oldHtml = '<p>旧内容</p>';
      const newHtml = '<p>新内容</p>';
      const diffResult = computeHtmlBlockDiff(oldHtml, newHtml);
      const result = applyHtmlDiffRejections(newHtml, diffResult, new Set());
      expect(result).toContain('新内容');
    });

    it('拒绝全部修改应恢复旧 HTML', () => {
      const oldHtml = '<p>旧内容</p>';
      const newHtml = '<p>新内容</p>';
      const diffResult = computeHtmlBlockDiff(oldHtml, newHtml);
      // 拒绝所有 diff 项
      const allIndices = new Set(diffResult.map((_, idx) => idx));
      const result = applyHtmlDiffRejections(newHtml, diffResult, allIndices);
      expect(result).toContain('旧内容');
    });

    it('拒绝新增块应删除该块', () => {
      const oldHtml = '<p>第一段</p>';
      const newHtml = '<p>第一段</p><p>第二段</p>';
      const diffResult = computeHtmlBlockDiff(oldHtml, newHtml);
      // 找到 added 块的索引并拒绝
      const addedIdx = diffResult.findIndex(d => d.type === 'added');
      expect(addedIdx).toBeGreaterThanOrEqual(0);
      const result = applyHtmlDiffRejections(newHtml, diffResult, new Set([addedIdx]));
      expect(result).toContain('第一段');
      expect(result).not.toContain('第二段');
    });

    it('拒绝删除块应恢复被删内容', () => {
      const oldHtml = '<p>第一段</p><p>第二段</p>';
      const newHtml = '<p>第一段</p>';
      const diffResult = computeHtmlBlockDiff(oldHtml, newHtml);
      const removedIdx = diffResult.findIndex(d => d.type === 'removed');
      expect(removedIdx).toBeGreaterThanOrEqual(0);
      const result = applyHtmlDiffRejections(newHtml, diffResult, new Set([removedIdx]));
      expect(result).toContain('第一段');
      expect(result).toContain('第二段');
    });

    it('多段落混合修改部分拒绝应正确还原', () => {
      const oldHtml = '<p>段落一</p><p>旧段落二</p><p>段落三</p>';
      const newHtml = '<p>段落一</p><p>新段落二</p><p>段落三</p>';
      const diffResult = computeHtmlBlockDiff(oldHtml, newHtml);
      const modifiedIdx = diffResult.findIndex(d => d.type === 'modified');
      expect(modifiedIdx).toBeGreaterThanOrEqual(0);
      // 拒绝修改 → 恢复旧内容
      const result = applyHtmlDiffRejections(newHtml, diffResult, new Set([modifiedIdx]));
      expect(result).toContain('旧段落二');
      expect(result).not.toContain('新段落二');
    });
  });
});

describe('htmlToBlocks', () => {
  it('应正确拆分 <p> 块', () => {
    const blocks = htmlToBlocks('<p>第一段</p><p>第二段</p>');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tag).toBe('p');
    expect(blocks[0].textContent).toBe('第一段');
    expect(blocks[1].textContent).toBe('第二段');
  });

  it('空 HTML 返回空数组', () => {
    expect(htmlToBlocks('')).toEqual([]);
  });

  it('应保留 outerHTML', () => {
    const blocks = htmlToBlocks('<p>测试</p>');
    expect(blocks[0].outerHTML).toContain('<p>');
    expect(blocks[0].outerHTML).toContain('测试');
    expect(blocks[0].outerHTML).toContain('</p>');
  });
});

describe('htmlToPlainText', () => {
  it('应剥离 HTML 标签返回纯文本', () => {
    expect(htmlToPlainText('<p>你好<span>世界</span></p>')).toBe('你好世界');
  });

  it('空字符串返回空字符串', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('应解码 HTML 实体', () => {
    const result = htmlToPlainText('<p>&lt;test&gt;</p>');
    expect(result).toBe('<test>');
  });
});

// ============ 内部分支补测 ============
// 覆盖 htmlToBlocks 的顶层文本节点分支（调用 escapeHtml），
// 以及 computeTextLCS 的输入截断警告分支。
describe('htmlToBlocks 顶层文本节点（escapeHtml 路径）', () => {
  it('顶层裸文本被包装为 <p> 并转义特殊字符', () => {
    // 不包块级元素的裸文本会作为顶层 TEXT_NODE 进入 htmlToBlocks，
    // 触发 escapeHtml：& " ' 被转义为 HTML 实体
    // 注：不含 < > 避免 DOMParser 当作标签解析
    const html = 'a&b"c\'d';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tag).toBe('p');
    expect(blocks[0].textContent).toBe('a&b"c\'d');
    // outerHTML 应含转义后的实体
    expect(blocks[0].outerHTML).toContain('&amp;');
    expect(blocks[0].outerHTML).toContain('&quot;');
    expect(blocks[0].outerHTML).toContain('&#39;');
  });

  it('顶层纯空格文本被过滤（trim 后为空）', () => {
    const blocks = htmlToBlocks('   ');
    expect(blocks).toHaveLength(0);
  });

  it('顶层文本 + <p> 混合：文本节点先入 blocks，<p> 单独入 blocks', () => {
    const html = '裸文本<p>段落</p>';
    const blocks = htmlToBlocks(html);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0].tag).toBe('p');
    expect(blocks[0].textContent).toBe('裸文本');
  });

  it('顶层文本含 < 字符不被当作标签（escapeHtml 转义后安全）', () => {
    // DOMParser 会把 '<' 后非标签字符当文本，escapeHtml 保证 outerHTML 安全
    // 用 "5 < 10" 形式：'<' 后跟空格不会被解析为标签
    const html = '5 < 10 and 3 > 1';
    const blocks = htmlToBlocks(html);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    // 至少有一个 block 的 outerHTML 含转义的 &lt; 或 &gt;
    const hasEscaped = blocks.some(b => b.outerHTML.includes('&lt;') || b.outerHTML.includes('&gt;'));
    expect(hasEscaped).toBe(true);
  });
});

describe('htmlToBlocks ul/ol 列表展开', () => {
  it('<ul> 含 <li> 时展开为多个 li 块（tag=li, attrs.parent=ul）', () => {
    const html = '<ul><li>第一项</li><li>第二项</li></ul>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tag).toBe('li');
    expect(blocks[0].textContent).toBe('第一项');
    expect(blocks[0].attrs!.parent).toBe('ul');
    expect(blocks[1].tag).toBe('li');
    expect(blocks[1].textContent).toBe('第二项');
    expect(blocks[1].attrs!.parent).toBe('ul');
  });

  it('<ol> 含 <li> 时展开为多个 li 块（attrs.parent=ol）', () => {
    const html = '<ol><li>甲</li><li>乙</li><li>丙</li></ol>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks.every(b => b.tag === 'li' && b.attrs!.parent === 'ol')).toBe(true);
  });

  it('空 <ul></ul>（无 li）作为整体块入 blocks', () => {
    const html = '<ul></ul>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tag).toBe('ul');
    expect(blocks[0].textContent).toBe('');
  });

  it('<ul> 含 <li> 时 outerHTML 保留 li 标签', () => {
    const html = '<ul><li>项A</li></ul>';
    const blocks = htmlToBlocks(html);
    expect(blocks[0].outerHTML).toContain('<li>');
    expect(blocks[0].outerHTML).toContain('项A');
  });

  it('带属性的元素：attrs 捕获属性键值', () => {
    const html = '<p class="content" data-id="42">文本</p>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs!.class).toBe('content');
    expect(blocks[0].attrs!['data-id']).toBe('42');
  });
});

describe('computeHtmlBlockDiff 块级 LCS 截断', () => {
  it('输入块数超过 DIFF_LINE_LIMIT(2000) 时触发截断警告', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 构造 2001 个 <p> 块的 old 和 new，让 computeTextLCS 触发截断分支
    const oldBlocks = Array.from({ length: 2001 }, (_, i) => `<p>旧${i}</p>`).join('');
    const newBlocks = Array.from({ length: 2001 }, (_, i) => `<p>新${i}</p>`).join('');
    // 不应抛错
    const diffs = computeHtmlBlockDiff(oldBlocks, newBlocks);
    expect(Array.isArray(diffs)).toBe(true);
    // 截断警告应被调用（块级 LCS 输入超过 2000）
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warnMsg = consoleWarnSpy.mock.calls[0][0] as string;
    expect(warnMsg).toContain('块级 LCS');
    expect(warnMsg).toContain('已截断');
    consoleWarnSpy.mockRestore();
  });
});

describe('computeLineDiff 行级 LCS 截断', () => {
  it('输入行数超过 DIFF_LINE_LIMIT(2000) 时触发截断警告', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 构造 2001 行文本，触发 computeLCS 中的截断警告分支（L83-84）
    const oldLines = Array.from({ length: 2001 }, (_, i) => `old-${i}`).join('\n');
    const newLines = Array.from({ length: 2001 }, (_, i) => `new-${i}`).join('\n');
    // 不应抛错
    const diffs = computeLineDiff(oldLines, newLines);
    expect(Array.isArray(diffs)).toBe(true);
    // 行级截断警告应被调用
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warnMsg = consoleWarnSpy.mock.calls[0][0] as string;
    expect(warnMsg).toContain('行级 LCS');
    expect(warnMsg).toContain('已截断');
    consoleWarnSpy.mockRestore();
  });
});
