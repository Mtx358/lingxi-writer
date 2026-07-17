import DOMPurify from 'dompurify';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface ImportedChapter {
  title: string;
  content: string;
  level: number;
  order: number;
}

export interface ImportResult {
  title: string;
  chapters: ImportedChapter[];
  totalWords: number;
}

export type HeadingTarget = 'title' | 'volume' | 'chapter' | 'ignore';

export interface HeadingMapping {
  h1: HeadingTarget;
  h2: HeadingTarget;
  h3: HeadingTarget;
}

const DEFAULT_HEADING_MAPPING: HeadingMapping = {
  h1: 'title',
  h2: 'chapter',
  h3: 'ignore',
};

export async function parseDocx(arrayBuffer: ArrayBuffer, mapping?: HeadingMapping): Promise<ImportResult> {
  const m: HeadingMapping = { ...DEFAULT_HEADING_MAPPING, ...(mapping || {}) };
  const chapters: ImportedChapter[] = [];
  let title = '导入项目';
  let titleSet = false;
  let currentChapter: ImportedChapter | null = null;
  let currentContent: string[] = [];
  let order = 0;

  const flushChapter = () => {
    if (currentChapter) {
      currentChapter.content = currentContent.join('\n').trim();
      chapters.push(currentChapter);
      currentChapter = null;
      currentContent = [];
    }
  };

  const startChapter = (chapterTitle: string, level: number) => {
    flushChapter();
    currentChapter = { title: chapterTitle, content: '', level, order: order++ };
    currentContent = [];
  };

  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;



    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text && currentChapter) {
          if (currentContent.length === 0 || currentContent[currentContent.length - 1].endsWith('</p>')) {
            currentContent.push(`<p>${escapeHtml(text)}`);
          } else {
            currentContent[currentContent.length - 1] += escapeHtml(text);
          }
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as HTMLElement;

      switch (element.tagName.toLowerCase()) {
        case 'h1': {
          const headingText = element.textContent?.trim() || '';
          if (!headingText) break;
          if (m.h1 === 'title' && !titleSet) {
            title = headingText;
            titleSet = true;
          } else if (m.h1 === 'volume') {
            startChapter(headingText, 1);
          } else if (m.h1 === 'chapter') {
            startChapter(headingText, 2);
          } else if (currentChapter) {
            currentContent.push(`<h3>${escapeHtml(headingText)}</h3>`);
          }
          break;
        }
        case 'h2': {
          const headingText = element.textContent?.trim() || '';
          if (!headingText) break;
          if (m.h2 === 'volume') {
            startChapter(headingText, 1);
          } else if (m.h2 === 'chapter') {
            startChapter(headingText, 2);
          } else if (currentChapter) {
            currentContent.push(`<h3>${escapeHtml(headingText)}</h3>`);
          }
          break;
        }
        case 'h3': {
          const headingText = element.textContent?.trim() || '';
          if (!headingText) break;
          if (m.h3 === 'chapter') {
            startChapter(headingText, 2);
          } else if (currentChapter) {
            currentContent.push(`<h3>${escapeHtml(headingText)}</h3>`);
          }
          break;
        }
        case 'p': {
          const text = element.textContent?.trim();
          if (text && currentChapter) {
            currentContent.push(`<p>${escapeHtml(text)}</p>`);
          }
          break;
        }
        case 'br': {
          if (currentChapter && currentContent.length > 0) {
            const last = currentContent[currentContent.length - 1];
            if (!last.endsWith('</p>')) {
              currentContent[currentContent.length - 1] += '<br>';
            }
          }
          break;
        }
        case 'ul':
        case 'ol': {
          const tag = element.tagName.toLowerCase();
          let listHtml = `<${tag}>`;
          element.querySelectorAll('li').forEach(li => {
            const liText = li.textContent?.trim() || '';
            if (liText) {
              listHtml += `<li>${escapeHtml(liText)}</li>`;
            }
          });
          listHtml += `</${tag}>`;
          if (currentChapter) {
            currentContent.push(listHtml);
          }
          break;
        }
        default:
          element.childNodes.forEach(processNode);
          break;
      }
    };

    body.childNodes.forEach(processNode);
    flushChapter();

    if (chapters.length === 0) {
      const text = html.replace(/<[^>]*>/g, '').trim();
      if (text) {
        chapters.push({
          title: '第一章',
          content: DOMPurify.sanitize(`<p>${text.split('\n').filter(l => l.trim()).map(l => escapeHtml(l)).join('</p><p>')}</p>`),
          level: 2,
          order: 0,
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse DOCX:', e);
    chapters.push({
      title: '导入失败',
      content: '<p>无法解析文档，请尝试其他格式</p>',
      level: 2,
      order: 0,
    });
  }

  const totalWords = chapters.reduce((sum, ch) => {
    const text = ch.content.replace(/<[^>]*>/g, '');
    return sum + countWords(text);
  }, 0);

  return { title, chapters: chapters.map(c => ({ ...c, content: DOMPurify.sanitize(c.content) })), totalWords };
}

export function parseMarkdown(markdown: string, mapping?: HeadingMapping): ImportResult {
  const m: HeadingMapping = { ...DEFAULT_HEADING_MAPPING, ...(mapping || {}) };
  const lines = markdown.split('\n');
  const chapters: ImportedChapter[] = [];
  let title = '导入项目';
  let titleSet = false;
  let currentChapter: ImportedChapter | null = null;
  let currentContent: string[] = [];
  let order = 0;

  const flushChapter = () => {
    if (currentChapter) {
      currentChapter.content = currentContent.join('\n').trim();
      chapters.push(currentChapter);
      currentChapter = null;
      currentContent = [];
    }
  };

  const startChapter = (chapterTitle: string, level: number) => {
    flushChapter();
    currentChapter = {
      title: chapterTitle,
      content: '',
      level,
      order: order++,
    };
    currentContent = [];
  };

  const pushInlineHeading = (headingText: string) => {
    if (currentChapter) {
      currentContent.push(`<h3>${escapeHtml(headingText)}</h3>`);
    }
  };

  const lastIsBoundary = () => {
    if (currentContent.length === 0) return true;
    const last = currentContent[currentContent.length - 1];
    return last === '</p>' || last.startsWith('<h3>');
  };

  for (const line of lines) {
    const h3Match = line.match(/^### (.+)$/);
    const h2Match = line.match(/^## (.+)$/);
    const h1Match = line.match(/^# (.+)$/);

    let matchedKey: 'h1' | 'h2' | 'h3' | null = null;
    let matchedText = '';
    if (h3Match) {
      matchedKey = 'h3';
      matchedText = h3Match[1].trim();
    } else if (h2Match) {
      matchedKey = 'h2';
      matchedText = h2Match[1].trim();
    } else if (h1Match) {
      matchedKey = 'h1';
      matchedText = h1Match[1].trim();
    }

    if (matchedKey) {
      const target = m[matchedKey];
      if (target === 'title') {
        if (!titleSet) {
          title = matchedText;
          titleSet = true;
        } else {
          pushInlineHeading(matchedText);
        }
        continue;
      }
      if (target === 'volume') {
        startChapter(matchedText, 1);
        continue;
      }
      if (target === 'chapter') {
        startChapter(matchedText, 2);
        continue;
      }
      pushInlineHeading(matchedText);
      continue;
    }

    if (currentChapter) {
      if (line.trim() === '') {
        if (currentContent.length > 0 && !lastIsBoundary()) {
          currentContent.push('</p>');
        }
      } else {
        if (lastIsBoundary()) {
          currentContent.push(`<p>${escapeHtml(line.trim())}`);
        } else {
          currentContent[currentContent.length - 1] += `\n${escapeHtml(line.trim())}`;
        }
      }
    }
  }

  flushChapter();

  if (chapters.length === 0 && markdown.trim()) {
    chapters.push({
      title: '第一章',
      content: markdownToHtml(markdown),
      level: 2,
      order: 0,
    });
  }

  const totalWords = chapters.reduce((sum, ch) => {
    const text = ch.content.replace(/<[^>]*>/g, '');
    return sum + countWords(text);
  }, 0);

  return { title, chapters: chapters.map(c => ({ ...c, content: DOMPurify.sanitize(c.content) })), totalWords };
}

function markdownToHtml(markdown: string): string {
  let html = markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  const paragraphs = html.split(/\n\s*\n/);
  html = paragraphs
    .map(p => {
      p = p.trim();
      if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') || p.startsWith('<blockquote')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

function countWords(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}

export function parsePlainText(text: string): ImportResult {
  const lines = text.split('\n');
  const chapters: ImportedChapter[] = [];
  let currentTitle = '';
  let currentContent: string[] = [];
  let order = 0;

  const chapterPatterns = [
    /^第[一二三四五六七八九十百千零\d]+章/,
    /^Chapter\s+\d+/i,
    /^第\d+节/,
    /^\d+\s*[.、]/,
  ];

  const isChapterTitle = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.length > 50) return false;
    return chapterPatterns.some(pattern => pattern.test(trimmed));
  };

  const flushChapter = () => {
    if (currentTitle && currentContent.length > 0) {
      const contentHtml = currentContent
        .filter(l => l.trim())
        .map(l => `<p>${escapeHtml(l.trim())}</p>`)
        .join('\n');
      chapters.push({
        title: currentTitle,
        content: contentHtml,
        level: 2,
        order: order++,
      });
    }
  };

  for (const line of lines) {
    if (isChapterTitle(line)) {
      flushChapter();
      currentTitle = line.trim();
      currentContent = [];
    } else if (currentTitle) {
      currentContent.push(line);
    }
  }

  flushChapter();

  if (chapters.length === 0 && text.trim()) {
    chapters.push({
      title: '第一章',
      content: text.split('\n').filter(l => l.trim()).map(l => `<p>${escapeHtml(l.trim())}</p>`).join('\n'),
      level: 2,
      order: 0,
    });
  }

  const totalWords = chapters.reduce((sum, ch) => {
    const plain = ch.content.replace(/<[^>]*>/g, '');
    return sum + countWords(plain);
  }, 0);

  const title = chapters.length > 0 ? '导入作品' : '导入项目';

  return { title, chapters: chapters.map(c => ({ ...c, content: DOMPurify.sanitize(c.content) })), totalWords };
}
