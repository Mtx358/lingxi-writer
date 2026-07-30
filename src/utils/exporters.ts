// 大型库（docx / pdf-lib / @pdf-lib/fontkit / jszip）改为按需动态 import：
// 仅在对应导出函数被调用时加载，避免进入主 bundle（Vite 自动 code-split）。
// 此处仅保留类型引用（编译期擦除，不产生运行时导入）。
import type { Paragraph } from 'docx';
import type { PDFFont } from 'pdf-lib';
import type { Project, Chapter, ExportPlatform } from '@/types';

const CHINESE_FONT_BASE64 = '';

export interface ExportData {
  project: Project;
  chapters: Chapter[]; // 已排序的 level===2 主章节
  includeToc: boolean;
  style: 'novel' | 'article' | 'script';
  platform?: ExportPlatform;
  /**
   * 导出进度回调（可选）。导出器在章节循环与打包阶段调用，供调用方推进真实进度条。
   * - current/total：章节级粒度（generating 阶段）
   * - stage：preparing（初始化）/ generating（章节循环）/ packing（PDF/DOCX 打包序列化）/ saving（写入磁盘）
   * 调用方据此计算百分比：generating 阶段 current/total 映射到 20%-80%，
   * packing 阶段映射到 80%-95%，saving 由调用方自行设置。
   */
  onProgress?: (info: { current: number; total: number; stage: ExportProgressStage }) => void;
}

export type ExportProgressStage = 'preparing' | 'generating' | 'packing' | 'saving';

/**
 * 安全调用 onProgress 回调：导出器调用方在 setState 时若组件已卸载或 React 内部抛错，
 * 会让异常冒泡中断整次导出（PDF/DOCX 中途半成品）。这里 catch 后仅 warn，保证导出流程继续。
 */
function callProgressSafely(
  fn: ExportData['onProgress'],
  info: { current: number; total: number; stage: ExportProgressStage },
): void {
  if (!fn) return;
  try {
    fn(info);
  } catch (e) {
    console.warn('onProgress callback error:', e);
  }
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

const PLATFORM_CONFIGS: Record<ExportPlatform, PlatformConfig> = {
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
  // 晋江文学城：行距偏紧、12 号字、章节标题居中、含"第 N 章"
  jjwxc: {
    indentSize: 2,
    lineHeight: 1.6,
    fontSize: 12,
    chapterTitleStyle: 'center',
    chapterTitleSize: 16,
    paragraphSpacing: 6,
    includeChapterNumber: true,
    frontMatter: false,
  },
  // 七猫小说：行距偏松、14 号字、章节标题居中、含"第 N 章"
  qimao: {
    indentSize: 2,
    lineHeight: 1.7,
    fontSize: 14,
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

function getPlatformConfig(platform?: ExportPlatform): PlatformConfig {
  return PLATFORM_CONFIGS[platform || 'general'] || PLATFORM_CONFIGS.general;
}

/** 罕见的私有区字符，用作段落分隔标记 */
const PARA_SPLIT_MARKER = '\uE000';

/**
 * 导出分块让步间隔：每处理 N 个章节后 `await Promise.resolve()` 让出事件循环。
 * 修复导出为同步阻塞计算导致进度条卡死的问题——JS 单线程下 setInterval 回调
 * 无法穿插执行。分块让步后主线程可刷新 UI、推进进度条。
 */
const EXPORT_YIELD_EVERY_N_CHAPTERS = 3;

/**
 * 把 HTML 内容转成纯文本段落数组。
 * 优先用 DOMParser 解析（浏览器/Electron 渲染进程可用），失败时降级为正则。
 *
 * 安全说明：先移除 script/style/noscript/template/title/meta/link 等非可见内容元素，
 * 否则 textContent 会把 <script>alert(1)</script> 的 alert(1) 当作文本输出到导出文件。
 * 虽然 alert(1) 作为纯文本不会被执行（不是真 XSS），但属于内容污染：
 * 用户在章节里粘贴了带 script 的 HTML 源码时，导出文件不应混入脚本源代码文本。
 */
export function htmlToParagraphs(html: string): string[] {
  if (!html) return [];

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const root = doc.body.firstElementChild as HTMLElement | null;
      if (root) {
        // 先移除非可见内容元素：script/style/noscript/template/title/meta/link
        // 否则 textContent 会包含 <script> 内的 JS 源码文本，污染导出内容
        root.querySelectorAll('script, style, noscript, template, title, meta, link').forEach(el => el.remove());
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

  // 正则降级方案：先剥离 script/style/noscript/template 整块（含内容），再剥离所有标签
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<template[\s\S]*?<\/template>/gi, '')
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
    // 直接将 Uint8Array 传给 fromCharCode.apply，免去 Array.from 的额外复制
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * 生成 DOCX，返回 base64 字符串。
 * 使用 Packer.toBase64String 直接得到 base64，兼容浏览器与 Electron 渲染进程（无需 Node Buffer）。
 */
export async function generateDocx(data: ExportData): Promise<string> {
  const { project, chapters, includeToc, platform, onProgress } = data;
  // 动态加载 docx：仅在实际导出 DOCX 时拉取，避免进入主 bundle
  const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } = await import('docx');
  const config = getPlatformConfig(platform);

  const children: Paragraph[] = [];
  callProgressSafely(onProgress, { current: 0, total: chapters.length, stage: 'preparing' });

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

  for (let idx = 0; idx < chapters.length; idx++) {
    // S3: 每处理 N 个章节让出事件循环，避免进度条卡死
    if (idx > 0 && idx % EXPORT_YIELD_EVERY_N_CHAPTERS === 0) {
      await Promise.resolve();
    }
    const ch = chapters[idx];
    // 上报真实进度：每章生成后通知调用方
    callProgressSafely(onProgress, { current: idx + 1, total: chapters.length, stage: 'generating' });
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
  }

  const doc = new Document({
    creator: '灵犀写作助手',
    title: project.title || '未命名作品',
    description: project.description,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  // 打包序列化是重计算（可能秒级），上报 packing 阶段
  callProgressSafely(onProgress, { current: chapters.length, total: chapters.length, stage: 'packing' });
  return Packer.toBase64String(doc);
}

// 模块级内存缓存：单次会话内复用，避免重复解析 base64 或重复 fetch
let cachedFontBytes: Uint8Array | null = null;

// pdf-lib 的 embedFont 仅支持 TTF/OTF 格式，woff/woff2 无法直接嵌入。
// 此处列出多个可用 TTF 源，按顺序尝试，提升离线/弱网环境可用性。
// 注：当前 CSP 不允许外联这些源（见 fetchFontFromNetwork），常量保留以备
// 后续放宽 CSP 或切换字体源时复用，故导出避免被 noUnusedLocals 误判为死代码。
export const FONT_URLS_TTF = [
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
  // CSP connect-src 不允许外联 jsdelivr/fastly 等字体源，fetch 会被静默拦截
  // （catch 分支吞掉错误后返回 null），实际为不可达死代码。
  // 字体回退仅依赖本地打包字体（CHINESE_FONT_BASE64）与 IndexedDB 缓存。
  // 保留函数签名不变以兼容调用方 loadChineseFont 的优先级链。
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
 * Helvetica 仅支持 WinAnsi 编码（Latin-1 + 部分 Windows 字符），中文/emoji/其他
 * 非 WinAnsi 字符会让 pdf-lib 的 widthOfTextAtSize / drawText 抛
 * "WinAnsi cannot encode 'X'"。中文字体加载失败降级到 Helvetica 时，
 * 用本函数逐字符探测编码能力，将无法编码的字符替换为 '?'，保证导出不中断。
 *
 * 逐字符探测而非整体 try/catch 的理由：单段中文里常夹杂英文/数字/标点，
 * 整体替换会丢失可读的 ASCII 部分；逐字符处理能保留所有可编码字符。
 */
function sanitizeForWinAnsi(text: string, font: PDFFont): string {
  let result = '';
  for (const char of text) {
    try {
      // encodeText 是 pdf-lib 内部 drawText 用的编码入口，抛错即代表该字符无法编码
      font.encodeText(char);
      result += char;
    } catch {
      result += '?';
    }
  }
  return result;
}

/**
 * 生成 PDF，返回 base64 字符串及字体加载状态。
 * 使用 pdf-lib 库，支持中文（尝试加载 Noto Sans SC 字体）。
 */
export async function generatePdf(data: ExportData): Promise<PdfExportResult> {
  const { project, chapters, includeToc, onProgress } = data;
  // 动态加载 pdf-lib：仅在实际导出 PDF 时拉取，避免进入主 bundle
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  callProgressSafely(onProgress, { current: 0, total: chapters.length, stage: 'preparing' });
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
      // fontkit（919KB）仅在中文字体确实可用时才动态加载：
      // vite.config 的 manualChunks 已把 @pdf-lib/fontkit 拆为独立 chunk，
      // 此前在函数顶部无条件 import 会导致 Helvetica 降级路径也白白拉取 451KB gzip。
      // 移到 if 块内后，字体加载失败/离线首启时不再请求该 chunk。
      const fontkit = (await import('@pdf-lib/fontkit')).default;
      // pdf-lib 的 embedFont 对自定义 TTF/OTF 字体需要 fontkit 实例来解析字形表，
      // 否则 embedFont 会抛 "Cannot embed a non-standard font without fontkit" 错误，
      // 导致中文字体永远加载失败、PDF 中文显示为方块。注册 fontkit 后即可正常嵌入。
      pdfDoc.registerFontkit(fontkit);
      chineseFont = await pdfDoc.embedFont(fontBytes, { subset: true });
      chineseFontLoaded = true;
    } catch {
      chineseFont = null;
      chineseFontLoaded = false;
    }
  }
  const font = chineseFont || await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = chineseFont ? font : await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  // 中文字体未加载时进入 WinAnsi 降级模式，drawText 前需对文本做编码安全清洗
  const winAnsiFallback = !chineseFont;

  let y = pageHeight - margin;
  let currentPage = pdfDoc.addPage();

  const drawTextOnPage = (text: string, fontSize: number, opts?: { bold?: boolean; align?: 'left' | 'center'; gapAfter?: number }) => {
    const isBold = opts?.bold ?? false;
    const align = opts?.align ?? 'left';
    const gapAfter = opts?.gapAfter ?? 0;
    const lineHeight = fontSize * 1.8;
    const useFont = isBold ? boldFont : font;

    // 降级模式下清洗非 WinAnsi 字符（如中文/emoji），避免 widthOfTextAtSize / drawText 抛错中断导出
    const safeText = winAnsiFallback ? sanitizeForWinAnsi(text, useFont) : text;
    const chars = safeText.split('');
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

  for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
    // S3: 每处理 N 个章节让出事件循环，避免进度条卡死
    if (chapterIdx > 0 && chapterIdx % EXPORT_YIELD_EVERY_N_CHAPTERS === 0) {
      await Promise.resolve();
    }
    const ch = chapters[chapterIdx];
    callProgressSafely(onProgress, { current: chapterIdx + 1, total: chapters.length, stage: 'generating' });
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
  }

  // PDF 序列化是重计算，上报 packing 阶段
  callProgressSafely(onProgress, { current: chapters.length, total: chapters.length, stage: 'packing' });
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

  // 用数组收集片段后一次性 join，避免循环中 html += 反复拼接大字符串导致的 O(n²) 开销。
  // 注：generateHtml 保持同步签名（调用方 ExportPage 未 await），无法像 DOCX/PDF/EPUB 路径
  // 那样通过 await Promise.resolve() 让出事件循环；数组拼接已显著降低单次导出的主线程开销。
  const parts: string[] = [];
  parts.push(`<!DOCTYPE html>
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
<body>`);

  if (config.frontMatter) {
    parts.push(`
  <div class="title-page">
    <h1>${escapeXml(project.title || '未命名作品')}</h1>
    ${project.description ? `<p class="subtitle">${escapeXml(project.description)}</p>` : ''}
  </div>`);
  }

  if (includeToc) {
    parts.push(`
  <h2>目录</h2>
  <ul class="toc">`);
    chapters.forEach((ch, idx) => {
      const title = config.includeChapterNumber ? `${idx + 1}. ${ch.title}` : ch.title;
      parts.push(`
    <li><a href="#ch-${escapeXml(ch.id)}">${escapeXml(title)}</a></li>`);
    });
    parts.push(`
  </ul>`);
  }

  chapters.forEach((ch, idx) => {
    const title = config.includeChapterNumber ? `${idx + 1}. ${ch.title}` : ch.title;
    parts.push(`
  <h1 id="ch-${escapeXml(ch.id)}">${escapeXml(title)}</h1>`);

    if (ch.summary) {
      parts.push(`
  <p class="summary">${escapeXml(ch.summary)}</p>`);
    }

    const paragraphs = htmlToParagraphs(ch.content);
    paragraphs.forEach(p => {
      parts.push(`
  <p>${escapeXml(p)}</p>`);
    });
  });

  parts.push(`
</body>
</html>`);

  return parts.join('');
}

export async function generateEpub(data: ExportData): Promise<string> {
  const { project, chapters, onProgress } = data;
  // 动态加载 jszip：仅在实际导出 EPUB 时拉取，避免进入主 bundle
  const JSZip = (await import('jszip')).default;

  callProgressSafely(onProgress, { current: 0, total: chapters.length, stage: 'preparing' });
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
    <dc:creator>灵犀写作助手</dc:creator>
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
  for (let idx = 0; idx < chapters.length; idx++) {
    // S3: 每处理 N 个章节让出事件循环，避免进度条卡死
    if (idx > 0 && idx % EXPORT_YIELD_EVERY_N_CHAPTERS === 0) {
      await Promise.resolve();
    }
    const ch = chapters[idx];
    callProgressSafely(onProgress, { current: idx + 1, total: chapters.length, stage: 'generating' });
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
  }

  // 6. 样式表（可选，提升阅读体验）
  const styleCss = `body { font-family: "PingFang SC", "Microsoft YaHei", serif; line-height: 1.8; margin: 5%; }
h1 { text-align: center; font-size: 1.4em; margin: 1em 0; }
p { text-indent: 2em; margin: 0.4em 0; }
p.summary { text-indent: 0; color: #888; font-style: italic; text-align: center; }
`;
  zip.file('OEBPS/style.css', styleCss);

  // zip 打包序列化是重计算，上报 packing 阶段
  callProgressSafely(onProgress, { current: chapters.length, total: chapters.length, stage: 'packing' });
  return zip.generateAsync({ type: 'base64', mimeType: 'application/epub+zip' });
}

// 注：大纲打磨报告 Markdown 导出已拆分到 ./outlinePolishExport.ts，
// 避免静态导入本文件时强制拉取 docx/pdf-lib/jszip 三大库（共 ~960KB）。

