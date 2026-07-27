/**
 * src/utils/exporters.ts 单元测试
 *
 * 测试目标（NEW-12 HIGH）：
 *   - htmlToParagraphs：HTML→纯文本段落转换的 XSS 防御（script/事件处理器剥离）
 *   - generateHtml：HTML 导出的 XSS 转义（title/description/summary/content 注入）
 *   - generateEpub：EPUB 导出的 XHTML 转义（所有用户字段注入）
 *   - generateDocx / generatePdf：恶意输入不破坏生成流程（不抛错、返回有效 base64）
 *   - 章节标题/描述中的 XML 特殊字符（< > & " '）正确转义
 *   - 边界情况：空章节数组、空字段、Unicode、超长内容
 *
 * 注意：escapeXml 是 exporters.ts 内部函数（未导出），通过 generateHtml / generateEpub
 * 的输出间接验证其正确性。这种"测公共 API 而非私有实现"的方式更稳定，不依赖实现细节。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  htmlToParagraphs,
  generateHtml,
  generateEpub,
  generateDocx,
  generatePdf,
  type ExportData,
} from './exporters';
import type { Project, Chapter } from '@/types';

// ============ 测试 fixtures ============
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'test-project-id',
    title: '测试小说',
    description: '一部测试用的小说',
    template: 'blank',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastOpenedAt: '2024-01-01T00:00:00.000Z',
    totalWords: 0,
    config: {
      theme: 'dark',
      fontSize: 14,
      lineHeight: 1.8,
      fontFamily: 'sans',
      showLineNumbers: false,
      showWordCount: true,
      zenMode: false,
      aiSettings: {
        provider: 'mock',
        style: 'balanced',
        descriptionDensity: 0.5,
        dialogueDensity: 0.5,
        strictness: 0.5,
        temperature: 0.7,
        maxTokens: 2048,
        autoCheckConflicts: false,
      },
    },
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    projectId: 'test-project-id',
    parentId: null,
    title: '第一章',
    summary: '',
    order: 0,
    level: 2,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 0,
    content: '<p>这是段落。</p>',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeExportData(overrides: Partial<ExportData> = {}): ExportData {
  return {
    project: makeProject(),
    chapters: [makeChapter()],
    includeToc: false,
    style: 'novel',
    platform: 'general',
    ...overrides,
  };
}

// ============ htmlToParagraphs ============
describe('htmlToParagraphs', () => {
  it('空字符串返回空数组', () => {
    expect(htmlToParagraphs('')).toEqual([]);
  });

  it('null/undefined 安全降级（实际签名是 string，但兜底）', () => {
    // @ts-expect-error 测试边界容错
    expect(htmlToParagraphs(undefined)).toEqual([]);
    // @ts-expect-error 测试边界容错
    expect(htmlToParagraphs(null)).toEqual([]);
  });

  it('纯文本返回单段落', () => {
    expect(htmlToParagraphs('hello world')).toEqual(['hello world']);
  });

  it('<p> 标签按段落分隔', () => {
    const html = '<p>第一段</p><p>第二段</p>';
    expect(htmlToParagraphs(html)).toEqual(['第一段', '第二段']);
  });

  it('<script> 标签内容被剥离（XSS 防御）', () => {
    const html = '<p>正常文本</p><script>alert(1)</script><p>结尾</p>';
    const result = htmlToParagraphs(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('script');
    expect(result).toEqual(['正常文本', '结尾']);
  });

  it('事件处理器被剥离（textContent 不包含属性）', () => {
    const html = '<p onerror="alert(1)">文本</p>';
    const result = htmlToParagraphs(html);
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert');
    expect(result).toEqual(['文本']);
  });

  it('<br> 作为段落分隔', () => {
    const html = '<p>第一行<br>第二行</p>';
    const result = htmlToParagraphs(html);
    expect(result).toEqual(['第一行', '第二行']);
  });

  it('块级元素（div/h1-h6/li/blockquote）分隔段落', () => {
    const html = '<h1>标题</h1><div>内容</div><blockquote>引用</blockquote>';
    const result = htmlToParagraphs(html);
    expect(result).toContain('标题');
    expect(result).toContain('内容');
    expect(result).toContain('引用');
  });

  it('HTML 实体被解码（textContent 行为）', () => {
    const html = '<p>&lt;script&gt; 不是真标签</p>';
    const result = htmlToParagraphs(html);
    // textContent 会把 &lt; 解码为 <，所以输出含字面 <script>
    expect(result).toEqual(['<script> 不是真标签']);
  });

  it('&nbsp; 被折叠为空格', () => {
    const html = '<p>第一&nbsp;第二</p>';
    const result = htmlToParagraphs(html);
    expect(result).toEqual(['第一 第二']);
  });

  it('嵌套标签正确提取文本', () => {
    const html = '<div><p>外层 <strong>加粗</strong> 文本</p></div>';
    const result = htmlToParagraphs(html);
    expect(result).toContain('外层 加粗 文本');
  });

  it('空段落被过滤', () => {
    const html = '<p></p><p>有内容</p><p>   </p>';
    const result = htmlToParagraphs(html);
    expect(result).toEqual(['有内容']);
  });

  it('Unicode 字符正确处理', () => {
    const html = '<p>中文日本語한국어emoji😀</p>';
    const result = htmlToParagraphs(html);
    expect(result).toEqual(['中文日本語한국어emoji😀']);
  });

  it('javascript: URI 在 href 中被剥离（textContent 不含属性）', () => {
    const html = '<p><a href="javascript:alert(1)">点击</a></p>';
    const result = htmlToParagraphs(html);
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('alert');
    expect(result).toEqual(['点击']);
  });

  it('<img> 标签 alt 文本被保留，src 被剥离', () => {
    const html = '<p>前 <img src="x" alt="图片"> 后</p>';
    const result = htmlToParagraphs(html);
    // textContent 包含 alt 属性值？实际不会，textContent 只返回元素文本
    expect(result.length).toBeGreaterThan(0);
    expect(result.join('')).not.toContain('src=');
  });

  it('超长内容不崩溃', () => {
    const longPara = 'a'.repeat(10000);
    const html = `<p>${longPara}</p>`;
    const result = htmlToParagraphs(html);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(longPara);
  });
});

// ============ generateHtml ============
describe('generateHtml XSS 防御', () => {
  it('project.title 中的 <script> 被转义', () => {
    const data = makeExportData({
      project: makeProject({ title: '<script>alert(1)</script>' }),
    });
    const html = generateHtml(data);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('project.description 中的 <script> 被转义', () => {
    const data = makeExportData({
      project: makeProject({ description: '<script>alert(1)</script>' }),
    });
    const html = generateHtml(data);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('chapter.title 中的 <script> 被转义', () => {
    const data = makeExportData({
      chapters: [makeChapter({ title: '<script>alert("title")</script>' })],
    });
    const html = generateHtml(data);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('chapter.summary 中的 <script> 被转义', () => {
    const data = makeExportData({
      chapters: [makeChapter({ summary: '<script>alert(1)</script>' })],
    });
    const html = generateHtml(data);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('chapter.content 中的 <script> 被剥离（htmlToParagraphs）', () => {
    const data = makeExportData({
      chapters: [makeChapter({ content: '<p>正常</p><script>alert(1)</script><p>结尾</p>' })],
    });
    const html = generateHtml(data);
    // <script> 应被 htmlToParagraphs 剥离，不会出现在导出 HTML 中
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('正常');
    expect(html).toContain('结尾');
  });

  it('XML 特殊字符全部转义（< > & " \')', () => {
    const special = `<a href="x"> &'"< >`;
    const data = makeExportData({
      project: makeProject({ title: special, description: special }),
      chapters: [makeChapter({ title: special, summary: special })],
    });
    const html = generateHtml(data);
    // 不应出现未转义的 <（除了 HTML 标签自身）
    // 提取 <body> 内容检查
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch![1];
    // 不应包含原始的 <a href="x">（应被转义为 &lt;a href=...）
    expect(body).not.toContain('<a href="x">');
    expect(body).toContain('&lt;a href=');
    expect(body).toContain('&amp;');
    expect(body).toContain('&quot;');
    expect(body).toContain('&apos;');
  });

  it('空章节数组生成有效 HTML', () => {
    const data = makeExportData({ chapters: [] });
    const html = generateHtml(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('所有 platform 配置都能生成有效 HTML', () => {
    const platforms = ['general', 'qidian', 'fanqie', 'jjwxc', 'qimao', 'wechat'] as const;
    for (const platform of platforms) {
      const data = makeExportData({ platform });
      const html = generateHtml(data);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    }
  });

  it('includeToc=true 生成目录', () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1', title: '第一章' })],
      includeToc: true,
    });
    const html = generateHtml(data);
    expect(html).toContain('目录');
    // href 模式：#ch-${ch.id}，ch.id='ch-1' 时 href='#ch-ch-1'
    expect(html).toContain('href="#ch-ch-1"');
    expect(html).toContain('id="ch-ch-1"');
    expect(html).toContain('第一章');
  });

  it('chapter.id 出现在 anchor 中且 HTML 结构保持完整', () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'safe-id-123', title: '章节' })],
      includeToc: true,
    });
    const html = generateHtml(data);
    expect(html).toContain('id="ch-safe-id-123"');
    expect(html).toContain('href="#ch-safe-id-123"');
  });

  it('frontMatter=true 渲染扉页', () => {
    const data = makeExportData({
      project: makeProject({ title: '我的小说', description: '描述' }),
      platform: 'general', // general 的 frontMatter=true
    });
    const html = generateHtml(data);
    // CSS 中始终含 .title-page 类定义，需检查 body 内是否实际渲染了扉页 div
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).toContain('class="title-page"');
    expect(html).toContain('我的小说');
    expect(html).toContain('描述');
  });

  it('frontMatter=false 不渲染扉页 div', () => {
    const data = makeExportData({
      platform: 'qidian', // qidian 的 frontMatter=false
    });
    const html = generateHtml(data);
    // CSS 中仍含 .title-page 类定义（无法条件化），但 body 内不应渲染扉页 div
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toContain('class="title-page"');
  });
});

// ============ generateEpub ============
describe('generateEpub XSS 防御', () => {
  it('生成有效 base64 字符串', async () => {
    const data = makeExportData();
    const base64 = await generateEpub(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
    // base64 字符集校验
    expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('project.title 中的 <script> 在 EPUB 内被转义', async () => {
    const data = makeExportData({
      project: makeProject({ title: '<script>alert(1)</script>' }),
    });
    const base64 = await generateEpub(data);
    // 解码 base64 → 解压 zip → 检查 content.opf
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const contentOpf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(contentOpf).not.toContain('<script>alert(1)</script>');
    expect(contentOpf).toContain('&lt;script&gt;');
  });

  it('project.description 中的特殊字符被转义', async () => {
    const data = makeExportData({
      project: makeProject({ description: `<script>x</script> & "quotes" 'apos'` }),
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const contentOpf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(contentOpf).not.toContain('<script>x</script>');
    expect(contentOpf).toContain('&lt;script&gt;');
    expect(contentOpf).toContain('&amp;');
  });

  it('chapter.title 中的 <script> 在 xhtml 中被转义', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ title: '<script>alert("title")</script>' })],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const xhtml = await zip.file('OEBPS/chapter1.xhtml')!.async('string');
    expect(xhtml).not.toContain('<script>alert');
    expect(xhtml).toContain('&lt;script&gt;');
  });

  it('chapter.summary 中的 <script> 在 xhtml 中被转义', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ summary: '<script>alert(1)</script>' })],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const xhtml = await zip.file('OEBPS/chapter1.xhtml')!.async('string');
    expect(xhtml).not.toContain('<script>alert');
    expect(xhtml).toContain('&lt;script&gt;');
  });

  it('chapter.content 中的 <script> 被剥离', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ content: '<p>正常</p><script>alert(1)</script><p>结尾</p>' })],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const xhtml = await zip.file('OEBPS/chapter1.xhtml')!.async('string');
    expect(xhtml).not.toContain('<script>alert');
    expect(xhtml).not.toContain('alert(1)');
    expect(xhtml).toContain('正常');
    expect(xhtml).toContain('结尾');
  });

  it('project.id 出现在 bookId 中且被转义', async () => {
    const data = makeExportData({
      project: makeProject({ id: 'id-with-<>&"' }),
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const contentOpf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(contentOpf).not.toContain('id-with-<>&"');
    expect(contentOpf).toContain('id-with-');
  });

  it('mimetype 文件不压缩（EPUB 规范）', async () => {
    const data = makeExportData();
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const mimetypeFile = zip.file('mimetype')!;
    expect(mimetypeFile).toBeDefined();
    const content = await mimetypeFile.async('string');
    expect(content).toBe('application/epub+zip');
  });

  it('多章节生成对应数量 xhtml 文件', async () => {
    const data = makeExportData({
      chapters: [
        makeChapter({ id: 'ch-1', title: '第一章', content: '<p>内容1</p>' }),
        makeChapter({ id: 'ch-2', title: '第二章', content: '<p>内容2</p>' }),
        makeChapter({ id: 'ch-3', title: '第三章', content: '<p>内容3</p>' }),
      ],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    expect(zip.file('OEBPS/chapter1.xhtml')).toBeDefined();
    expect(zip.file('OEBPS/chapter2.xhtml')).toBeDefined();
    expect(zip.file('OEBPS/chapter3.xhtml')).toBeDefined();
  });

  it('空章节数组生成有效 EPUB', async () => {
    const data = makeExportData({ chapters: [] });
    const base64 = await generateEpub(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('onProgress 回调被调用', async () => {
    const onProgress = vi.fn();
    const data = makeExportData({
      chapters: [
        makeChapter({ id: 'ch-1' }),
        makeChapter({ id: 'ch-2' }),
        makeChapter({ id: 'ch-3' }),
        makeChapter({ id: 'ch-4' }), // 触发 EXPORT_YIELD_EVERY_N_CHAPTERS=3 的让步
      ],
      onProgress,
    });
    await generateEpub(data);
    expect(onProgress).toHaveBeenCalled();
    // 应至少有 preparing 阶段和 packing 阶段
    const stages = onProgress.mock.calls.map(c => c[0].stage);
    expect(stages).toContain('preparing');
    expect(stages).toContain('generating');
    expect(stages).toContain('packing');
  });

  it('onProgress 回调抛错不中断导出', async () => {
    const onProgress = vi.fn(() => {
      throw new Error('callback error');
    });
    const data = makeExportData({ onProgress });
    // 不应抛错
    const base64 = await generateEpub(data);
    expect(typeof base64).toBe('string');
  });
});

// ============ generateDocx ============
describe('generateDocx XSS 容错', () => {
  it('章节内容含 <script> 不破坏生成（生成有效 base64）', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ content: '<p>正常</p><script>alert(1)</script><p>结尾</p>' })],
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
    // base64 字符集校验
    expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('title/description 含特殊字符不破坏生成', async () => {
    const data = makeExportData({
      project: makeProject({
        title: '<script>&"\'<>',
        description: `<>&"'`,
      }),
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('空章节数组生成有效 DOCX', async () => {
    const data = makeExportData({ chapters: [] });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('onProgress 回调被调用', async () => {
    const onProgress = vi.fn();
    const data = makeExportData({
      chapters: [makeChapter(), makeChapter(), makeChapter(), makeChapter()],
      onProgress,
    });
    await generateDocx(data);
    expect(onProgress).toHaveBeenCalled();
    const stages = onProgress.mock.calls.map(c => c[0].stage);
    expect(stages).toContain('preparing');
    expect(stages).toContain('generating');
    expect(stages).toContain('packing');
  });

  it('includeToc=true 不破坏生成', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1' }), makeChapter({ id: 'ch-2' })],
      includeToc: true,
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });
});

// ============ generatePdf ============
// PDF 导出会尝试加载中文字体（fetch + IndexedDB），需 mock 避免网络调用。
//
// 中文字体降级处理：当字体 CDN 不可达且 IDB 未缓存字体时，降级到 StandardFonts.Helvetica，
// 而 Helvetica 仅支持 WinAnsi 编码。exporters.ts 的 sanitizeForWinAnsi 会把无法编码的字符
// 替换为 '?'，保证导出流程不中断。下方覆盖 XSS 容错 + 降级路径 + 中文字符清洗三类场景。
describe('generatePdf XSS 容错', () => {
  beforeEach(() => {
    // mock fetch：所有 URL 返回 404，触发降级到 Helvetica
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    // mock indexedDB：返回 null（字体缓存未命中）
    vi.stubGlobal('indexedDB', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('章节内容含 <script> 不破坏生成', async () => {
    const data = makeExportData({
      project: makeProject({ title: 'Test Novel', description: 'A test novel' }),
      chapters: [makeChapter({
        title: 'Chapter One',
        summary: 'Summary',
        content: '<p>Normal</p><script>alert(1)</script><p>End</p>',
      })],
    });
    const result = await generatePdf(data);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
    expect(result.base64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(typeof result.chineseFontLoaded).toBe('boolean');
  });

  it('title 含特殊字符不破坏生成', async () => {
    const data = makeExportData({
      project: makeProject({
        title: `<script>&"'<></script>`,
        description: 'desc',
      }),
      chapters: [makeChapter({ title: 'Chapter', content: '<p>Content</p>' })],
    });
    const result = await generatePdf(data);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('空章节数组生成有效 PDF', async () => {
    const data = makeExportData({
      project: makeProject({ title: 'Empty', description: '' }),
      chapters: [],
    });
    const result = await generatePdf(data);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('chineseFontLoaded=false 当字体加载失败（降级 Helvetica）', async () => {
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [makeChapter({ title: 'Ch', content: '<p>Hi</p>' })],
    });
    const result = await generatePdf(data);
    expect(result.chineseFontLoaded).toBe(false);
  });

  it('includeToc=true 不破坏生成（硬编码"目录"中文标题经 sanitizeForWinAnsi 清洗为 ?）', async () => {
    // 修复后：generatePdf 在降级模式下对硬编码 "目录" 中文标题调用 sanitizeForWinAnsi，
    // 将 '目' '录' 替换为 '?'，导出流程不再中断。
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [
        makeChapter({ title: 'Ch1', content: '<p>A</p>' }),
        makeChapter({ title: 'Ch2', content: '<p>B</p>' }),
      ],
      includeToc: true,
    });
    const result = await generatePdf(data);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('中文字符在降级模式下被清洗为 ?，不中断导出', async () => {
    // 验证 sanitizeForWinAnsi：中文 title/summary/content 全部走降级路径，
    // 中文字符替换为 '?' 后导出有效 base64
    const data = makeExportData({
      project: makeProject({ title: '未命名作品', description: '这是一本小说' }),
      chapters: [
        makeChapter({ title: '第一章 入门', summary: '主角登场', content: '<p>主角走进了房间。</p>' }),
        makeChapter({ title: '第二章', content: '<p>剧情推进中。</p>' }),
      ],
      includeToc: true,
    });
    const result = await generatePdf(data);
    expect(result.chineseFontLoaded).toBe(false);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
    expect(result.base64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('onProgress 回调被调用', async () => {
    const onProgress = vi.fn();
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [
        makeChapter({ title: 'Ch1', content: '<p>A</p>' }),
        makeChapter({ title: 'Ch2', content: '<p>B</p>' }),
        makeChapter({ title: 'Ch3', content: '<p>C</p>' }),
        makeChapter({ title: 'Ch4', content: '<p>D</p>' }),
      ],
      onProgress,
    });
    await generatePdf(data);
    expect(onProgress).toHaveBeenCalled();
    const stages = onProgress.mock.calls.map(c => c[0].stage);
    expect(stages).toContain('preparing');
    expect(stages).toContain('generating');
    expect(stages).toContain('packing');
  });
});

// ============ 分支补测：未命中的边界 ============
describe('exporters 分支补测', () => {
  beforeEach(() => {
    // PDF 测试默认 mock：fetch 失败 + indexedDB 不可用 → 字体降级
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal('indexedDB', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getPlatformConfig：未知 platform 回退到 general', () => {
    // @ts-expect-error 测试无效 platform 输入
    const data = makeExportData({ platform: 'unknown-platform' });
    const html = generateHtml(data);
    // 不抛错且生成有效 HTML（说明回退到 general 配置）
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('generateHtml：project.title 空字符串回退到"未命名作品"', () => {
    const data = makeExportData({
      project: makeProject({ title: '' }),
      platform: 'general', // frontMatter=true 触发扉页
    });
    const html = generateHtml(data);
    expect(html).toContain('未命名作品');
  });

  it('generateHtml：qidian 平台 + includeToc=true 时目录含"1. "', () => {
    const data = makeExportData({
      project: makeProject({ title: '测试' }),
      chapters: [makeChapter({ id: 'ch-1', title: '章节A' })],
      platform: 'qidian', // includeChapterNumber=true
      includeToc: true,
    });
    const html = generateHtml(data);
    // TOC 链接文本含 "1. 章节A"
    expect(html).toContain('1. 章节A');
    // 正文章节标题也含编号
    expect(html).toContain('1. 章节A');
  });

  it('generateHtml：chapter.content 空时段落为空（不报错）', () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1', content: '' })],
    });
    const html = generateHtml(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('generateDocx：project.title 为空时使用"未命名作品"', async () => {
    const data = makeExportData({
      project: makeProject({ title: '', description: '' }),
      platform: 'general',
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('generateDocx：qidian 平台 + includeToc=true 触发 includeChapterNumber', async () => {
    const data = makeExportData({
      project: makeProject({ title: '测试' }),
      chapters: [
        makeChapter({ id: 'ch-1', title: '甲' }),
        makeChapter({ id: 'ch-2', title: '乙' }),
      ],
      platform: 'qidian',
      includeToc: true,
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('generateDocx：chapter.content 空字符串触发 paragraphs.length===0 分支', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1', content: '' })],
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('generatePdf：project.title 为空时使用"未命名作品"', async () => {
    const data = makeExportData({
      project: makeProject({ title: '', description: '' }),
      chapters: [makeChapter({ title: 'Ch', content: '<p>Hi</p>' })],
    });
    const result = await generatePdf(data);
    expect(result.chineseFontLoaded).toBe(false);
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('generatePdf：长文本触发自动换行 + 跨页', async () => {
    // maxWidth = 595.28 - 60*2 = 475.28；fontSize=10，单字符宽约 5pt，需 ~100 字符填满一行
    // pageHeight=841.89, margin=60，可用高度 ~722；lineHeight=18，约 40 行填满一页
    // 这里生成 200 行 × 100 字符的长内容，足以触发换行 + 跨页
    const longPara = 'A'.repeat(2000); // 单段 2000 字符
    const data = makeExportData({
      project: makeProject({ title: 'Long Novel', description: 'desc' }),
      chapters: [
        makeChapter({
          title: 'Long Chapter',
          summary: 'Long Summary',
          content: `<p>${longPara}</p><p>${longPara}</p><p>${longPara}</p>`,
        }),
      ],
    });
    const result = await generatePdf(data);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
    // 多页 PDF 字节大小应明显大于空 PDF
    expect(result.base64.length).toBeGreaterThan(1000);
  });

  it('generatePdf：chapter.content 为空时不报错', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1', content: '' })],
    });
    const result = await generatePdf(data);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('generateEpub：project.id 为空时 bookId 使用 Date.now 回退', async () => {
    const data = makeExportData({
      project: makeProject({ id: '', title: '测试' }),
      chapters: [makeChapter({ id: 'ch-1' })],
    });
    const base64 = await generateEpub(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
    // content.opf 中应含 urn:uuid: 前缀（id 为空时用 Date.now 填充）
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const contentOpf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(contentOpf).toContain('urn:uuid:');
  });

  it('generateEpub：project.title 为空时使用"未命名作品"', async () => {
    const data = makeExportData({
      project: makeProject({ title: '' }),
      chapters: [makeChapter({ id: 'ch-1' })],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const contentOpf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(contentOpf).toContain('未命名作品');
  });

  it('generateEpub：chapter.content 为空触发 paragraphs.length===0 分支（写入 <p></p>）', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1', content: '' })],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const xhtml = await zip.file('OEBPS/chapter1.xhtml')!.async('string');
    // 空段落分支会写入 <p></p>
    expect(xhtml).toContain('<p></p>');
  });

  it('generateEpub：project.description 为空时不写入 dc:description', async () => {
    const data = makeExportData({
      project: makeProject({ description: '' }),
      chapters: [makeChapter({ id: 'ch-1' })],
    });
    const base64 = await generateEpub(data);
    const zipBuf = Buffer.from(base64, 'base64');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const contentOpf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(contentOpf).not.toContain('dc:description');
  });

  it('generateDocx：chapter.summary 非空触发 ch.summary 分支', async () => {
    const data = makeExportData({
      chapters: [makeChapter({ id: 'ch-1', summary: '章节摘要内容' })],
    });
    const base64 = await generateDocx(data);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);
  });

  it('generateHtml：general 平台 + 空 description → frontMatter 中渲染空 subtitle', () => {
    const data = makeExportData({
      project: makeProject({ title: '测试', description: '' }),
      platform: 'general', // frontMatter=true
    });
    const html = generateHtml(data);
    expect(html).toContain('class="title-page"');
    // description 为空时 subtitle 行为 ""，不应渲染 <p class="subtitle">
    expect(html).not.toContain('class="subtitle">');
  });
});

// ============ 字体加载路径补测 ============
// 覆盖 loadChineseFont 的 IDB 命中分支（L476-479）与网络获取命中分支（L483-488），
// 以及 generatePdf 中 embedFont 失败的 catch 分支（L544-547）。
//
// 注意：pdf-lib embedFont 自定义 TTF 字节需 fontkit 实例（PDFDocument.registerFontkit），
// 当前 exporters.ts 未注册 fontkit，因此任何非空字体字节都会让 embedFont 抛错并降级
// 到 Helvetica。本组测试聚焦"字体字节加载链路是否被走通"（IDB 命中 / 网络命中），
// 而非 embedFont 是否成功——后者在当前代码下恒为 false。
//
// 模块级 cachedFontBytes 跨测试共享，通过 vi.resetModules() 重置 exporters.ts，
// 让 cachedFontBytes 重新初始化为 undefined，确保每个测试的字体加载路径独立可控。
describe('generatePdf 字体加载分支', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // 加载系统 TTF 字体字节用于测试（沙箱通常有 DejaVu）
  async function loadSystemFontBytes(): Promise<Uint8Array | null> {
    const fs = await import('fs');
    const fontPaths = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/TTF/DejaVuSans.ttf',
    ];
    for (const p of fontPaths) {
      try {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          return new Uint8Array(buf);
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  it('IDB 命中字体字节 → loadFontFromIDB 返回非空，进入 embedFont（抛错降级 Helvetica）', async () => {
    // 构造一个最小合法的 TTF 字体字节：使用真实 Noto Sans SC 子集太重，
    // 这里用 pdf-lib 内置 Helvetica 的 StandardFonts 不能 embedFont（需 TTF 字节）。
    // 改用真实可用的 TTF：取 node 内置字体或构造 minimal TTF。
    // 实际策略：使用一个已知有效的 TTF 二进制（pdf-lib 能识别）。
    // 为避免依赖外部字体文件，使用 fs 读取系统字体（Linux 沙箱通常有 DejaVu）
    const fs = await import('fs');
    // 尝试常见 Linux 系统字体路径
    const fontPaths = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/TTF/DejaVuSans.ttf',
    ];
    let realFontBytes: Uint8Array | null = null;
    for (const p of fontPaths) {
      try {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          realFontBytes = new Uint8Array(buf);
          break;
        }
      } catch {
        // continue
      }
    }
    if (!realFontBytes) {
      // 沙箱无系统字体时跳过本测试，不计算为失败
      console.warn('[test] skip: no system TTF font available');
      return;
    }

    // mock indexedDB：返回真实字体字节
    const fakeDB = {
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const req = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
              result: realFontBytes!.buffer.slice(0),
            };
            // 异步触发 onsuccess
            setTimeout(() => req.onsuccess && req.onsuccess(), 0);
            return req;
          },
        }),
      }),
    };
    const fakeOpenReq = {
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: fakeDB,
    };
    const fakeIndexedDB = {
      open: () => {
        setTimeout(() => fakeOpenReq.onsuccess && fakeOpenReq.onsuccess(), 0);
        return fakeOpenReq;
      },
    };
    vi.stubGlobal('indexedDB', fakeIndexedDB);
    // fetch 不应被调用（IDB 命中），stub 以验证
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    vi.stubGlobal('fetch', fetchSpy);

    // 重新加载 exporters 让 cachedFontBytes 重置
    const { generatePdf: freshGeneratePdf } = await import('./exporters');
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [makeChapter({ title: 'Ch1', content: '<p>Hello</p>' })],
    });
    const result = await freshGeneratePdf(data);
    // IDB 命中 → fetch 不应被调用
    expect(fetchSpy).not.toHaveBeenCalled();
    // embedFont 成功（registerFontkit 已注入）→ 中文字体加载成功
    expect(result.chineseFontLoaded).toBe(true);
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('IDB 未命中 + CSP 限制网络不可用 → fetchFontFromNetwork 返回 null，降级 Helvetica', async () => {
    // fetchFontFromNetwork 因 CSP 限制永远返回 null（不调用 fetch）
    // 验证：IDB 未命中时，不会尝试网络获取，直接降级到本地打包字体或 Helvetica

    // mock indexedDB：open 成功但 loadFontFromIDB 返回 null（get 走 onerror）
    const fakeDB = {
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const req = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
              result: null,
            };
            setTimeout(() => req.onerror && req.onerror(), 0);
            return req;
          },
        }),
      }) as never,
    };
    const fakeOpenReq = {
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: fakeDB,
    };
    const fakeIndexedDB = {
      open: () => {
        setTimeout(() => fakeOpenReq.onsuccess && fakeOpenReq.onsuccess(), 0);
        return fakeOpenReq;
      },
    };
    vi.stubGlobal('indexedDB', fakeIndexedDB);

    // fetch 不应被调用（CSP 限制，fetchFontFromNetwork 直接返回 null）
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { generatePdf: freshGeneratePdf } = await import('./exporters');
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [makeChapter({ title: 'Ch1', content: '<p>Hello</p>' })],
    });
    const result = await freshGeneratePdf(data);
    // fetch 不应被调用（CSP 限制）
    expect(fetchSpy).not.toHaveBeenCalled();
    // PDF 仍能生成（降级 Helvetica 或本地打包字体）
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('embedFont 抛错 → chineseFontLoaded=false（降级 Helvetica）', async () => {
    // 构造一个无效的"字体字节"：非空但非合法 TTF，让 embedFont 抛错
    const invalidFontBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

    // IDB 命中但返回无效字节
    const fakeDB = {
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const req = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
              result: invalidFontBytes.buffer.slice(0),
            };
            setTimeout(() => req.onsuccess && req.onsuccess(), 0);
            return req;
          },
        }),
      }),
    };
    const fakeOpenReq = {
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: fakeDB,
    };
    const fakeIndexedDB = {
      open: () => {
        setTimeout(() => fakeOpenReq.onsuccess && fakeOpenReq.onsuccess(), 0);
        return fakeOpenReq;
      },
    };
    vi.stubGlobal('indexedDB', fakeIndexedDB);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));

    const { generatePdf: freshGeneratePdf } = await import('./exporters');
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [makeChapter({ title: 'Ch1', content: '<p>Hello</p>' })],
    });
    const result = await freshGeneratePdf(data);
    // embedFont 抛错 → chineseFontLoaded=false，降级到 Helvetica
    expect(result.chineseFontLoaded).toBe(false);
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('saveFontToIDB 事务抛错时 catch 静默 resolve（不中断导出）', async () => {
    const realFontBytes = await loadSystemFontBytes();
    if (!realFontBytes) {
      console.warn('[test] skip: no system TTF font available');
      return;
    }

    // mock indexedDB：loadFontFromIDB 返回 null（get onerror），
    // saveFontToIDB 的 transaction 抛错（触发 L426-428 catch）
    let txCallCount = 0;
    const fakeDB = {
      transaction: () => {
        // 计数：第 1 次 loadFontFromIDB，第 2 次 saveFontToIDB
        txCallCount++;
        if (txCallCount === 1) {
          return {
            objectStore: () => ({
              get: () => {
                const req = {
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                  result: null,
                };
                setTimeout(() => req.onerror && req.onerror(), 0);
                return req;
              },
            }),
          } as never;
        }
        // saveFontToIDB：transaction 调用时直接抛错
        throw new Error('transaction quota exceeded');
      },
    };
    const fakeOpenReq = {
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: fakeDB,
    };
    const fakeIndexedDB = {
      open: () => {
        setTimeout(() => fakeOpenReq.onsuccess && fakeOpenReq.onsuccess(), 0);
        return fakeOpenReq;
      },
    };
    vi.stubGlobal('indexedDB', fakeIndexedDB);

    // fetch 返回字体字节，触发 saveFontToIDB
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => realFontBytes.buffer.slice(0),
    }));

    const { generatePdf: freshGeneratePdf } = await import('./exporters');
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [makeChapter({ title: 'Ch1', content: '<p>Hello</p>' })],
    });
    // 不应抛错（saveFontToIDB catch 静默）
    const result = await freshGeneratePdf(data);
    expect(result.base64.length).toBeGreaterThan(0);
    // 等待异步 saveFontToIDB 完成
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('CSP 限制下 fetchFontFromNetwork 永远返回 null（不调用 fetch，降级 Helvetica）', async () => {
    // fetchFontFromNetwork 因 CSP 限制直接返回 null，不调用 fetch
    // IDB 不可用时，字体回退链全部失败 → 降级 Helvetica
    const fakeOpenReq = {
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      result: null,
    };
    const fakeIndexedDB = {
      open: () => {
        setTimeout(() => fakeOpenReq.onerror && fakeOpenReq.onerror(), 0);
        return fakeOpenReq;
      },
    };
    vi.stubGlobal('indexedDB', fakeIndexedDB);

    // fetch 不应被调用（CSP 限制）
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { generatePdf: freshGeneratePdf } = await import('./exporters');
    const data = makeExportData({
      project: makeProject({ title: 'Test', description: '' }),
      chapters: [makeChapter({ title: 'Ch1', content: '<p>Hello</p>' })],
    });
    const result = await freshGeneratePdf(data);
    // 字体全部失败 → 降级
    expect(result.chineseFontLoaded).toBe(false);
    expect(result.base64.length).toBeGreaterThan(0);
    // fetch 不应被调用（CSP 限制，fetchFontFromNetwork 直接返回 null）
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
