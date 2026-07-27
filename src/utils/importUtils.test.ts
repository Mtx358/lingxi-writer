/**
 * importUtils 测试
 *
 * 覆盖三个解析入口：
 *   - parseMarkdown：h1/h2/h3 标题映射、段落拼接、自定义 mapping、回退章节
 *   - parsePlainText：第X章 / Chapter N / 第N节 / N. 四种章节标题模式 + 回退
 *   - parseDocx：mock mammoth 后验证 HTML 解析路径与失败兜底
 *
 * 关键不变量：
 *   - 输出 HTML 经 DOMPurify 清洗，<script> 等危险标签被剥离
 *   - 字符 < > & 转义为 HTML 实体，避免内容破坏外层结构
 *   - totalWords = 中文字符数 + 英文单词数
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseMarkdown, parsePlainText, parseDocx } from './importUtils';

// ============ parseMarkdown ============
describe('parseMarkdown', () => {
  it('h1 作为标题，h2 作为章节，h3 作为 inline heading', () => {
    const md = `# 我的小说

## 第一章 开始

### 引子

主角登场。

正文内容。
`;
    const result = parseMarkdown(md);
    expect(result.title).toBe('我的小说');
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('第一章 开始');
    expect(result.chapters[0].level).toBe(2);
    expect(result.chapters[0].order).toBe(0);
    // h3 作为 inline heading 出现在 content 中
    expect(result.chapters[0].content).toContain('<h3>引子</h3>');
    // 段落被 <p> 包裹（push 时机决定 </p> 单独成元素，join('\n') 后存在 \n）
    expect(result.chapters[0].content).toContain('<p>主角登场。');
    expect(result.chapters[0].content).toContain('<p>正文内容。');
    expect(result.chapters[0].content).toContain('</p>');
  });

  it('自定义 mapping：h1 → volume，h2 → chapter，h3 → chapter', () => {
    const md = `# 第一卷

## 第一章

### 第一节

内容。
`;
    const result = parseMarkdown(md, {
      h1: 'volume',
      h2: 'chapter',
      h3: 'chapter',
    });
    // h1 → volume（level 1）
    expect(result.chapters[0].title).toBe('第一卷');
    expect(result.chapters[0].level).toBe(1);
    // h2 → chapter（level 2）
    expect(result.chapters[1].title).toBe('第一章');
    expect(result.chapters[1].level).toBe(2);
    // h3 → chapter（level 2）
    expect(result.chapters[2].title).toBe('第一节');
    expect(result.chapters[2].level).toBe(2);
  });

  it('h1 title 第二次出现时作为 inline heading', () => {
    const md = `# 第一卷

## 第一章

# 第二卷标题

内容。
`;
    const result = parseMarkdown(md);
    expect(result.title).toBe('第一卷');
    expect(result.chapters).toHaveLength(1);
    // 第二个 h1 不再作为 title，作为 inline heading 嵌入 content
    expect(result.chapters[0].content).toContain('<h3>第二卷标题</h3>');
  });

  it('h1 → ignore 时跳过标题提取，保留默认 title', () => {
    const md = `# 标题

## 第一章

内容。
`;
    const result = parseMarkdown(md, { h1: 'ignore', h2: 'chapter', h3: 'ignore' });
    expect(result.title).toBe('导入项目'); // 默认值
    expect(result.chapters[0].title).toBe('第一章');
  });

  it('多行段落：连续非空行合并为一个 <p>', () => {
    const md = `## 第一章

第一行
第二行
第三行
`;
    const result = parseMarkdown(md);
    // 三行合并到一个 <p> 内，用 \n 分隔；</p> 单独成元素，join('\n') 后存在尾部 \n
    expect(result.chapters[0].content).toBe('<p>第一行\n第二行\n第三行\n</p>');
  });

  it('空行分隔段落', () => {
    const md = `## 第一章

段落一。

段落二。
`;
    const result = parseMarkdown(md);
    expect(result.chapters[0].content).toContain('<p>段落一。');
    expect(result.chapters[0].content).toContain('<p>段落二。');
    expect(result.chapters[0].content).toContain('</p>');
  });

  it('无章节时整体作为单个章节', () => {
    const md = `# 标题

这是一段没有章节标题的内容。

第二段。
`;
    const result = parseMarkdown(md);
    expect(result.title).toBe('标题');
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('第一章');
    expect(result.chapters[0].content).toContain('这是一段没有章节标题的内容。');
  });

  it('空 markdown 返回空章节', () => {
    const result = parseMarkdown('');
    expect(result.title).toBe('导入项目');
    expect(result.chapters).toHaveLength(0);
    expect(result.totalWords).toBe(0);
  });

  it('totalWords：中文字符 + 英文单词', () => {
    const md = `## Chapter

hello world 你好世界
`;
    const result = parseMarkdown(md);
    // 中文 4 字 + 英文 2 词 = 6
    expect(result.totalWords).toBe(6);
  });

  it('HTML 转义：< > & 转义为实体，<script> 被 DOMPurify 剥离', () => {
    const md = `## 第一章

<script>alert(1)</script>

文本 <标签> & 符号
`;
    const result = parseMarkdown(md);
    expect(result.chapters[0].content).not.toContain('<script>');
    // <标签> 转义为 &lt;标签&gt;，& 转义为 &amp;
    expect(result.chapters[0].content).toContain('&lt;标签&gt;');
    expect(result.chapters[0].content).toContain('&amp; 符号');
  });
});

// ============ parsePlainText ============
describe('parsePlainText', () => {
  it('第X章 模式切分章节', () => {
    const text = `第一章 开始

主角登场。

第二章 发展

剧情推进。`;
    const result = parsePlainText(text);
    expect(result.title).toBe('导入作品');
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe('第一章 开始');
    expect(result.chapters[1].title).toBe('第二章 发展');
    expect(result.chapters[0].content).toContain('<p>主角登场。</p>');
  });

  it('Chapter N 模式切分章节', () => {
    const text = `Chapter 1 Begin

Hello world.

Chapter 2 End

The end.`;
    const result = parsePlainText(text);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe('Chapter 1 Begin');
    expect(result.chapters[1].title).toBe('Chapter 2 End');
  });

  it('第N节 模式切分章节', () => {
    const text = `第1节 开头

内容1。

第2节 后续

内容2。`;
    const result = parsePlainText(text);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe('第1节 开头');
  });

  it('N. / N、 数字编号模式切分章节', () => {
    const text = `1. 开始

内容一。

2、后续

内容二。`;
    const result = parsePlainText(text);
    expect(result.chapters).toHaveLength(2);
  });

  it('章节标题行超过 50 字符不识别为章节', () => {
    const longTitle = '第' + '一'.repeat(60) + '章';
    const text = `${longTitle}

内容。`;
    const result = parsePlainText(text);
    // 不识别为章节，整体作为"序言"回退章节（M6 修复：无章节标题的内容作为序言保留）
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('序言');
  });

  it('无章节标题时整体作为"序言"章节（M6 修复：无章节标题的内容作为序言保留）', () => {
    const text = `第一行内容。

第二行内容。`;
    const result = parsePlainText(text);
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('序言');
    expect(result.chapters[0].content).toContain('<p>第一行内容。</p>');
  });

  it('首个章节标题前的前言内容作为"序言"章节保留（M6 修复）', () => {
    const text = `这是前言内容。
版权声明。

第一章 正文开始

正文内容。`;
    const result = parsePlainText(text);
    // 前言不应被丢弃，作为"序言"章节保留
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe('序言');
    expect(result.chapters[0].content).toContain('前言内容');
    expect(result.chapters[1].title).toBe('第一章 正文开始');
  });

  it('空文本返回空章节', () => {
    const result = parsePlainText('');
    expect(result.chapters).toHaveLength(0);
    expect(result.title).toBe('导入项目');
    expect(result.totalWords).toBe(0);
  });

  it('HTML 转义：< > & 转义为实体', () => {
    const text = `第一章 测试

文本 <标签> & 符号`;
    const result = parsePlainText(text);
    expect(result.chapters[0].content).toContain('&lt;标签&gt;');
    expect(result.chapters[0].content).toContain('&amp; 符号');
  });

  it('totalWords：中文字符 + 英文单词', () => {
    const text = `第一章 测试

hello world 你好世界`;
    const result = parsePlainText(text);
    expect(result.totalWords).toBe(6);
  });
});

// ============ parseDocx ============
// mock mammoth 模块，避免真实 DOCX 解析
// 同时提供 named export (convertToHtml) 与 default export，兼容两种调用方式
const mammothMockFn = vi.hoisted(() => vi.fn());
vi.mock('mammoth', () => ({
  convertToHtml: mammothMockFn,
  default: { convertToHtml: mammothMockFn },
}));

describe('parseDocx', () => {
  beforeEach(() => {
    mammothMockFn.mockReset();
  });

  it('mammoth 成功转换：h1 → title，h2 → chapter，p → 段落', async () => {
    mammothMockFn.mockResolvedValue({
      value: '<h1>我的小说</h1><h2>第一章</h2><p>正文内容。</p>',
      messages: [],
    });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.title).toBe('我的小说');
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('第一章');
    expect(result.chapters[0].content).toContain('正文内容。');
    expect(result.totalWords).toBeGreaterThan(0);
  });

  it('mammoth 抛错时返回"导入失败"章节', async () => {
    mammothMockFn.mockRejectedValue(new Error('parse error'));

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('导入失败');
    expect(result.chapters[0].content).toContain('无法解析文档');
  });

  it('空 HTML 时无章节产出（chapters 为空数组）', async () => {
    mammothMockFn.mockResolvedValue({ value: '', messages: [] });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters).toHaveLength(0);
    expect(result.totalWords).toBe(0);
  });

  it('无 h1/h2 但有正文时整体作为"第一章"章节', async () => {
    mammothMockFn.mockResolvedValue({
      value: '<p>第一段。</p><p>第二段。</p>',
      messages: [],
    });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('第一章');
    expect(result.chapters[0].content).toContain('第一段。');
    expect(result.chapters[0].content).toContain('第二段。');
  });

  it('无 h1/h2 回退路径正确解码 HTML 实体（M5 修复：不再双重编码 &amp;）', async () => {
    // 原实现用 html.replace(/<[^>]*>/g, '') 剥离标签不解码实体，
    // `&amp;` 保留为 `&amp;`，随后 escapeHtml 将 & 编码为 &amp; → `&amp;amp;`
    // 修复后用 DOMParser textContent 正确解码实体，`&amp;` → `&`，再 escapeHtml → `&amp;`（正确单次编码）
    mammothMockFn.mockResolvedValue({
      value: '<p>汤姆 &amp; 杰瑞</p>',
      messages: [],
    });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters).toHaveLength(1);
    // 修复后：DOMParser 解码 &amp; → &，escapeHtml 再编码 & → &amp;（单次，正确）
    // 修复前：正则不解码 &amp;，escapeHtml 将 & 编码 → &amp;amp;（双重，错误）
    expect(result.chapters[0].content).toContain('&amp; 杰瑞');
    expect(result.chapters[0].content).not.toContain('&amp;amp;');
  });

  it('ul/ol 列表项被保留为 HTML 列表', async () => {
    mammothMockFn.mockResolvedValue({
      value: '<h2>第一章</h2><ul><li>项目一</li><li>项目二</li></ul>',
      messages: [],
    });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters[0].content).toContain('<ul>');
    expect(result.chapters[0].content).toContain('<li>项目一</li>');
    expect(result.chapters[0].content).toContain('<li>项目二</li>');
    expect(result.chapters[0].content).toContain('</ul>');
  });

  it('h3 在 ignore 模式下作为 inline heading', async () => {
    mammothMockFn.mockResolvedValue({
      value: '<h2>第一章</h2><h3>子标题</h3><p>内容。</p>',
      messages: [],
    });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters[0].content).toContain('<h3>子标题</h3>');
  });

  it('HTML 转义：< > & 转义为实体，<script> 被 DOMPurify 剥离', async () => {
    mammothMockFn.mockResolvedValue({
      value: '<h2>第一章</h2><p><script>alert(1)</script>文本 <标签> & 符号</p>',
      messages: [],
    });

    const result = await parseDocx(new ArrayBuffer(0));
    expect(result.chapters[0].content).not.toContain('<script>');
    expect(result.chapters[0].content).toContain('&lt;标签&gt;');
    expect(result.chapters[0].content).toContain('&amp; 符号');
  });
});
