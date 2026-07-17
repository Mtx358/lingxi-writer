import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import type { Project, Chapter } from '@/types';

const CHINESE_FONT_BASE64 = '';

export interface ExportData {
  project: Project;
  chapters: Chapter[]; // 已排序的 level===2 主章节
  includeToc: boolean;
  style: 'novel' | 'article' | 'script';
  platform?: 'general' | 'qidian' | 'fanqie' | 'wechat';
}

export interface PlatformConfig {
  indentSize: number;
  lineHeight: number;
  fontSize: number;
  chapterTitleStyle: 'center' | 'left';
  chapterTitleSize: number;
  paragraphSpacing: number;
  includeChapterNumber: boolean;
  frontMatter: boolean;
}

const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  general: {
    indentSize: 2,
    lineHeight: 1.8,
    fontSize: 12,
    chapterTitleStyle: 'center',
    chapterTitleSize: 18,
    paragraphSpacing: 8,
    includeChapterNumber: false,
    frontMatter: true,
  },
  qidian: {
    indentSize: 2,
    lineHeight: 1.8,
    fontSize: 14,
    chapterTitleStyle: 'center',
    chapterTitleSize: 20,
    paragraphSpacing: 12,
    includeChapterNumber: true,
    frontMatter: false,
  },
  fanqie: {
    indentSize: 2,
    lineHeight: 1.6,
    fontSize: 15,
    chapterTitleStyle: 'center',
    chapterTitleSize: 18,
    paragraphSpacing: 10,
    includeChapterNumber: true,
    frontMatter: false,
  },
  wechat: {
    indentSize: 2,
    lineHeight: 1.7,
    fontSize: 16,
    chapterTitleStyle: 'center',
    chapterTitleSize: 22,
    paragraphSpacing: 16,
    includeChapterNumber: false,
    frontMatter: false,
  },
};

function getPlatformConfig(platform?: string): PlatformConfig {
  return PLATFORM_CONFIGS[platform || 'general'] || PLATFORM_CONFIGS.general;
}

/** 罕见的私有区字符，用作段落分隔标记 */
const PARA_SPLIT_MARKER = '\uE000';

/**
 * 把 HTML 内容转成纯文本段落数组。
 * 优先用 DOMParser 解析（浏览器/Electron 渲染进程可用），失败时降级为正则。
 */
export function htmlToParagraphs(html: string): string[] {
  if (!html) return [];

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const root = doc.body.firstElementChild as HTMLElement | null;
      if (root) {
        // 将 <br> 替换为标记文本节点
        root.querySelectorAll('br').forEach(br => {
          br.replaceWith(doc.createTextNode(PARA_SPLIT_MARKER));
        });
        // 在块级元素末尾追加标记，作为段落分隔
        root
          .querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr')
          .forEach(el => {
            el.appendChild(doc.createTextNode(PARA_SPLIT_MARKER));
          });
        const text = root.textContent || '';
        return text
          .split(PARA_SPLIT_MARKER)
          .map(s => s.replace(/\s+/g, ' ').trim())
          .filter(s => s.length > 0);
      }
    } catch {
      // 降级到正则方案
    }
  }

  // 正则降级方案
  const text = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, PARA_SPLIT_MARKER)
    .replace(/<br\s*\/?>/gi, PARA_SPLIT_MARKER)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split(PARA_SPLIT_MARKER)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 0);
}

/** 简单转义 XML 文本内容 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ArrayBuffer / Uint8Array 转 base64 字符串 */
function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * 生成 DOCX，返回 base64 字符串。
 * 使用 Packer.toBase64String 直接得到 base64，兼容浏览器与 Electron 渲染进程（无需 Node Buffer）。
 */
export async function generateDocx(data: ExportData): Promise<string> {
  const { project, chapters, includeToc, platform } = data;
  const config = getPlatformConfig(platform);

  const children: Paragraph[] = [];

  if (config.frontMatter) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 480, after: 240 },
        children: [
          new TextRun({
            text: project.title || '未命名作品',
            bold: true,
            size: 56,
          }),
        ],
      })
    );

    if (project.description) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 480 },
          children: [
            new TextRun({
              text: project.description,
              italics: true,
              size: 24,
              color: '666666',
            }),
          ],
        })
      );
    }

    children.push(new Paragraph({ children: [new TextRun({ text: '' })], pageBreakBefore: false }));
  }

  if (includeToc) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
        children: [new TextRun({ text: '目录', bold: true, size: 36 })],
      })
    );
    chapters.forEach((ch, idx) => {
      const title = config.includeChapterNumber ? `${idx + 1}. ${ch.title}` : ch.title;
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: title })],
        })
      );
    });
    children.push(
      new Paragraph({ children: [new TextRun({ text: '' })], pageBreakBefore: true })
    );
  }

  chapters.forEach((ch, idx) => {
    const title = config.includeChapterNumber ? `${idx + 1}. ${ch.title}` : ch.title;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: config.chapterTitleStyle === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 360, after: config.paragraphSpacing * 20 },
        children: [new TextRun({ text: title, bold: true, size: config.chapterTitleSize * 2 })],
      })
    );

    if (ch.summary) {
      children.push(
        new Paragraph({
          spacing: { after: config.paragraphSpacing * 20 },
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: ch.summary, italics: true, color: '888888', size: config.fontSize * 2 }),
          ],
        })
      );
    }

    const paragraphs = htmlToParagraphs(ch.content);
    if (paragraphs.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    } else {
      paragraphs.forEach(p => {
        children.push(
          new Paragraph({
            spacing: { after: config.paragraphSpacing * 20, line: config.lineHeight * 120 },
            alignment: AlignmentType.BOTH,
            indent: { firstLine: config.indentSize * 200 },
            children: [new TextRun({ text: p, size: config.fontSize * 2 })],
          })
        );
      });
    }
  });

  const doc = new Document({
    creator: '创作工坊',
    title: project.title || '未命名作品',
    description: project.description,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBase64String(doc);
}

// 模块级内存缓存：单次会话内复用，避免重复解析 base64 或重复 fetch
let cachedFontBytes: Uint8Array | null = null;

// pdf-lib 的 embedFont 仅支持 TTF/OTF 格式，woff/woff2 无法直接嵌入。
// 此处列出多个可用 TTF 源，按顺序尝试，提升离线/弱网环境可用性。
const FONT_URLS_TTF = [
  // StellarCN/scp_zh 提供的 SimHei TTF，体积适中、字形覆盖全
  'https://cdn.jsdelivr.net/gh/StellarCN/scp_zh/fonts/SimHei.ttf',
  // jsDelivr 备用源
  'https://cdn.jsdelivr.net/gh/StellarCN/scp_zh@master/fonts/SimHei.ttf',
  // fastly 备用源
  'https://fastly.jsdelivr.net/gh/StellarCN/scp_zh/fonts/SimHei.ttf',
];

const FONT_DB_NAME = 'cw_pdf_fonts';
const FONT_STORE = 'fonts';
const FONT_KEY = 'noto_sans_sc';

// 打开 IndexedDB 用于持久化字体字节，跨会话复用
function openFontDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(FONT_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(FONT_STORE)) {
          req.result.createObjectStore(FONT_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadFontFromIDB(): Promise<Uint8Array | null> {
  const db = await openFontDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(FONT_STORE, 'readonly');
      const store = tx.objectStore(FONT_STORE);
      const req = store.get(FONT_KEY);
      req.onsuccess = () => {
        const result = req.result;
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
        } else if (result instanceof Uint8Array) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveFontToIDB(bytes: Uint8Array): Promise<void> {
  const db = await openFontDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(FONT_STORE, 'readwrite');
      const store = tx.objectStore(FONT_STORE);
      // 拷贝到新的 ArrayBuffer，避免 detached buffer 问题
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      store.put(buf, FONT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function fetchFontFromNetwork(): Promise<Uint8Array | null> {
  for (const url of FONT_URLS_TTF) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) continue;
      return new Uint8Array(arrayBuffer);
    } catch {
      // 尝试下一个 URL
    }
  }
  return null;
}

/**
 * 加载中文字体字节，按优先级依次尝试：
 *   1. 内存缓存（单次会话内复用）
 *   2. 内置 base64 字体（用户可自行替换 CHINESE_FONT_BASE64）
 *   3. IndexedDB 持久化缓存（跨会话复用，离线可用）
 *   4. 联网获取 TTF（多 CDN 容错，成功后回写 IDB）
 *   5. 全部失败返回 null，调用方降级到 Helvetica
 */
async function loadChineseFont(): Promise<Uint8Array | null> {
  // 1. 内存缓存
  if (cachedFontBytes) return cachedFontBytes;

  // 2. 内置 base64 字体
  if (CHINESE_FONT_BASE64) {
    try {
      const binary = atob(CHINESE_FONT_BASE64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      cachedFontBytes = bytes;
      return bytes;
    } catch {
      // base64 解析失败，继续尝试其他源
    }
  }

  // 3. IndexedDB 持久化缓存
  const idbBytes = await loadFontFromIDB();
  if (idbBytes && idbBytes.byteLength > 0) {
    cachedFontBytes = idbBytes;
    return idbBytes;
  }

  // 4. 联网获取 TTF（多 CDN 容错）
  const netBytes = await fetchFontFromNetwork();
  if (netBytes && netBytes.byteLength > 0) {
    cachedFontBytes = netBytes;
    // 异步回写到 IDB，不阻塞当前导出
    void saveFontToIDB(netBytes);
    return netBytes;
  }

  // 5. 全部失败
  console.warn('[PDF导出] 中文字体加载失败，将降级使用 Helvetica（中文可能无法正常显示）。可在网络可用时首次导出后自动缓存。');
  return null;
}

export interface PdfExportResult {
  base64: string;
  chineseFontLoaded: boolean;
}

/**
 * 生成 PDF，返回 base64 字符串及字体加载状态。
 * 使用 pdf-lib 库，支持中文（尝试加载 Noto Sans SC 字体）。
 */
export async function generatePdf(data: ExportData): Promise<PdfExportResult> {
  const { project, chapters, includeToc } = data;

  const pdfDoc = await PDFDocument.create();
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 60;
  const maxWidth = pageWidth - margin * 2;

  let chineseFont = null;
  let chineseFontLoaded = false;
  const fontBytes = await loadChineseFont();
  if (fontBytes) {
    try {
      chineseFont = await pdfDoc.embedFont(fontBytes);
      chineseFontLoaded = true;
    } catch {
      chineseFont = null;
      chineseFontLoaded = false;
    }
  }
  const font = chineseFont || await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = chineseFont ? font : await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = pageHeight - margin;
  let currentPage = pdfDoc.addPage();

  const drawTextOnPage = (text: string, fontSize: number, opts?: { bold?: boolean; align?: 'left' | 'center'; gapAfter?: number }) => {
    const isBold = opts?.bold ?? false;
    const align = opts?.align ?? 'left';
    const gapAfter = opts?.gapAfter ?? 0;
    const lineHeight = fontSize * 1.8;
    const useFont = isBold ? boldFont : font;

    const chars = text.split('');
    const lines: string[] = [];
    let currentLine = '';

    for (const char of chars) {
      const lineWidth = useFont.widthOfTextAtSize(currentLine + char, fontSize);
      if (lineWidth > maxWidth) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine += char;
      }
    }
    if (currentLine) lines.push(currentLine);

    lines.forEach(line => {
      if (y - lineHeight < margin) {
        currentPage = pdfDoc.addPage();
        y = pageHeight - margin;
      }
      let x = margin;
      if (align === 'center') {
        const lineWidth = useFont.widthOfTextAtSize(line, fontSize);
        x = (pageWidth - lineWidth) / 2;
      }
      currentPage.drawText(line, {
        x,
        y,
        size: fontSize,
        font: useFont,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
    });

    if (gapAfter) {
      y -= gapAfter;
    }
  };

  drawTextOnPage(project.title || '未命名作品', 24, { bold: true, align: 'center', gapAfter: 12 });
  if (project.description) {
    drawTextOnPage(project.description, 10, { align: 'center', gapAfter: 30 });
  } else {
    y -= 15;
  }

  if (includeToc) {
    currentPage = pdfDoc.addPage();
    y = pageHeight - margin;
    drawTextOnPage('目录', 16, { bold: true, align: 'center', gapAfter: 15 });
    chapters.forEach((ch, idx) => {
      drawTextOnPage(`${idx + 1}. ${ch.title}`, 10, { gapAfter: 6 });
    });
  }

  chapters.forEach(ch => {
    currentPage = pdfDoc.addPage();
    y = pageHeight - margin;
    drawTextOnPage(ch.title, 16, { bold: true, align: 'center', gapAfter: 10 });
    if (ch.summary) {
      drawTextOnPage(ch.summary, 9, { align: 'center', gapAfter: 18 });
    }
    const paragraphs = htmlToParagraphs(ch.content);
    paragraphs.forEach(p => {
      drawTextOnPage(p, 10, { gapAfter: 6 });
    });
  });

  const pdfBytes = await pdfDoc.save();
  return { base64: toBase64(pdfBytes), chineseFontLoaded };
}

/**
 * 生成 EPUB，返回 base64 字符串。
 * EPUB 本质是 zip：mimetype（不压缩）+ META-INF/container.xml + OEBPS/(content.opf, toc.ncx, chapterN.xhtml)
 */
export function generateHtml(data: ExportData): string {
  const { project, chapters, includeToc, platform } = data;
  const config = getPlatformConfig(platform);

  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(project.title || '未命名作品')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Noto Serif SC", "SimSun", serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: ${config.lineHeight};
      font-size: ${config.fontSize}px;
      color: #333;
      background: #fff;
    }
    h1 {
      text-align: ${config.chapterTitleStyle};
      font-size: ${config.chapterTitleSize}px;
      margin: 30px 0 20px;
      font-weight: bold;
    }
    h2 {
      text-align: center;
      font-size: ${config.chapterTitleSize * 0.8}px;
      margin: 20px 0;
    }
    p {
      text-indent: ${config.indentSize}em;
      margin-bottom: ${config.paragraphSpacing}px;
      text-align: justify;
    }
    .summary {
      text-indent: 0;
      text-align: center;
      color: #888;
      font-style: italic;
      margin-bottom: ${config.paragraphSpacing * 1.5}px;
    }
    .toc {
      list-style: none;
      margin: 20px 0;
      padding-left: 20px;
    }
    .toc li {
      margin: 8px 0;
    }
    .toc a {
      color: #333;
      text-decoration: none;
    }
    .toc a:hover {
      text-decoration: underline;
    }
    .title-page {
      text-align: center;
      margin-bottom: 60px;
      padding-bottom: 40px;
      border-bottom: 1px solid #eee;
    }
    .title-page h1 {
      font-size: 36px;
      margin-bottom: 10px;
    }
    .title-page .subtitle {
      color: #888;
      font-style: italic;
    }
  </style>
</head>
<body>`;

  if (config.frontMatter) {
    html += `
  <div class="title-page">
    <h1>${escapeXml(project.title || '未命名作品')}</h1>
    ${project.description ? `<p class="subtitle">${escapeXml(project.description)}</p>` : ''}
  </div>`;
  }

  if (includeToc) {
    html += `
  <h2>目录</h2>
  <ul class="toc">`;
    chapters.forEach((ch, idx) => {
      const title = config.includeChapterNumber ? `${idx + 1}. ${ch.title}` : ch.title;
      html += `
    <li><a href="#ch-${ch.id}">${escapeXml(title)}</a></li>`;
    });
    html += `
  </ul>`;
  }

  chapters.forEach((ch, idx) => {
    const title = config.includeChapterNumber ? `${idx + 1}. ${ch.title}` : ch.title;
    html += `
  <h1 id="ch-${ch.id}">${escapeXml(title)}</h1>`;

    if (ch.summary) {
      html += `
  <p class="summary">${escapeXml(ch.summary)}</p>`;
    }

    const paragraphs = htmlToParagraphs(ch.content);
    paragraphs.forEach(p => {
      html += `
  <p>${escapeXml(p)}</p>`;
    });
  });

  html += `
</body>
</html>`;

  return html;
}

export async function generateEpub(data: ExportData): Promise<string> {
  const { project, chapters } = data;

  const zip = new JSZip();
  const bookId = `urn:uuid:${project.id || Date.now().toString(36)}`;
  const title = escapeXml(project.title || '未命名作品');
  const description = project.description ? escapeXml(project.description) : '';

  // 1. mimetype（必须不压缩存储）
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  );

  // 3. OEBPS/content.opf
  const manifestItems: string[] = [];
  const spineItems: string[] = [];

  chapters.forEach((_, idx) => {
    const fileId = `chapter${idx + 1}`;
    const href = `chapter${idx + 1}.xhtml`;
    manifestItems.push(
      `    <item id="${fileId}" href="${href}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`    <itemref idref="${fileId}"/>`);
  });

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>创作工坊</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>${description ? `\n    <dc:description>${description}</dc:description>` : ''}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>
`;
  zip.file('OEBPS/content.opf', contentOpf);

  // 4. OEBPS/toc.ncx
  const navPoints = chapters
    .map(
      (ch, idx) => `    <navPoint id="nav${idx + 1}" playOrder="${idx + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter${idx + 1}.xhtml"/>
    </navPoint>`
    )
    .join('\n');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookId)}"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
  zip.file('OEBPS/toc.ncx', tocNcx);

  // 5. 各章节 XHTML
  chapters.forEach((ch, idx) => {
    const paragraphs = htmlToParagraphs(ch.content);
    const bodyParts: string[] = [];
    bodyParts.push(`    <h1>${escapeXml(ch.title)}</h1>`);
    if (ch.summary) {
      bodyParts.push(`    <p class="summary">${escapeXml(ch.summary)}</p>`);
    }
    if (paragraphs.length === 0) {
      bodyParts.push('    <p></p>');
    } else {
      paragraphs.forEach(p => {
        bodyParts.push(`    <p>${escapeXml(p)}</p>`);
      });
    }

    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${bodyParts.join('\n')}
</body>
</html>
`;
    zip.file(`OEBPS/chapter${idx + 1}.xhtml`, xhtml);
  });

  // 6. 样式表（可选，提升阅读体验）
  const styleCss = `body { font-family: "PingFang SC", "Microsoft YaHei", serif; line-height: 1.8; margin: 5%; }
h1 { text-align: center; font-size: 1.4em; margin: 1em 0; }
p { text-indent: 2em; margin: 0.4em 0; }
p.summary { text-indent: 0; color: #888; font-style: italic; text-align: center; }
`;
  zip.file('OEBPS/style.css', styleCss);

  return zip.generateAsync({ type: 'base64', mimeType: 'application/epub+zip' });
}
