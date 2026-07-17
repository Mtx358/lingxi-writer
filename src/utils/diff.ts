import DOMPurify from 'dompurify';
import { DIFF_CHAR_LIMIT } from '@/constants/config';

export interface DiffChunk {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
}

export interface LineDiff {
  leftLine?: string;
  rightLine?: string;
  type: 'added' | 'removed' | 'unchanged' | 'modified';
  leftNumber?: number;
  rightNumber?: number;
  charDiffs?: {
    left: DiffChunk[];
    right: DiffChunk[];
  };
}

export function computeLineDiff(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const result: LineDiff[] = [];
  let leftLineNum = 1;
  let rightLineNum = 1;

  const lcs = computeLCS(oldLines, newLines);

  let i = 0;
  let j = 0;
  let k = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (k < lcs.length && oldLines[i] === lcs[k] && newLines[j] === lcs[k]) {
      result.push({
        type: 'unchanged',
        leftLine: oldLines[i],
        rightLine: newLines[j],
        leftNumber: leftLineNum,
        rightNumber: rightLineNum,
      });
      i++;
      j++;
      k++;
      leftLineNum++;
      rightLineNum++;
    } else if (i < oldLines.length && (k >= lcs.length || oldLines[i] !== lcs[k])) {
      result.push({
        type: 'removed',
        leftLine: oldLines[i],
        leftNumber: leftLineNum,
      });
      i++;
      leftLineNum++;
    } else if (j < newLines.length && (k >= lcs.length || newLines[j] !== lcs[k])) {
      result.push({
        type: 'added',
        rightLine: newLines[j],
        rightNumber: rightLineNum,
      });
      j++;
      rightLineNum++;
    }
  }

  return mergeAdjacentChanges(result);
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

function mergeAdjacentChanges(diffs: LineDiff[]): LineDiff[] {
  const result: LineDiff[] = [];
  let i = 0;

  while (i < diffs.length) {
    if (diffs[i].type === 'removed' && i + 1 < diffs.length && diffs[i + 1].type === 'added') {
      const removed = diffs[i].leftLine || '';
      const added = diffs[i + 1].rightLine || '';
      const charDiffs = computeCharDiff(removed, added);

      result.push({
        type: 'modified',
        leftLine: removed,
        rightLine: added,
        leftNumber: diffs[i].leftNumber,
        rightNumber: diffs[i + 1].rightNumber,
        charDiffs,
      });
      i += 2;
    } else if (diffs[i].type === 'added' && i + 1 < diffs.length && diffs[i + 1].type === 'removed') {
      const added = diffs[i].rightLine || '';
      const removed = diffs[i + 1].leftLine || '';
      const charDiffs = computeCharDiff(removed, added);

      result.push({
        type: 'modified',
        leftLine: removed,
        rightLine: added,
        leftNumber: diffs[i + 1].leftNumber,
        rightNumber: diffs[i].rightNumber,
        charDiffs,
      });
      i += 2;
    } else {
      result.push(diffs[i]);
      i++;
    }
  }

  return result;
}

export function computeCharDiff(oldStr: string, newStr: string): {
  left: DiffChunk[];
  right: DiffChunk[];
} {
  if (!oldStr && !newStr) return { left: [], right: [] };
  if (!oldStr) return { left: [], right: [{ type: 'added', content: newStr }] };
  if (!newStr) return { left: [{ type: 'removed', content: oldStr }], right: [] };

  const oldChars = Array.from(oldStr);
  const newChars = Array.from(newStr);
  const lcs = computeCharLCS(oldChars, newChars);

  const leftChunks: DiffChunk[] = [];
  const rightChunks: DiffChunk[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  let leftBuffer = '';
  let rightBuffer = '';
  let leftType: 'removed' | 'unchanged' = 'unchanged';
  let rightType: 'added' | 'unchanged' = 'unchanged';

  const flushLeft = () => {
    if (leftBuffer) {
      leftChunks.push({ type: leftType, content: leftBuffer });
      leftBuffer = '';
    }
  };

  const flushRight = () => {
    if (rightBuffer) {
      rightChunks.push({ type: rightType, content: rightBuffer });
      rightBuffer = '';
    }
  };

  while (i < oldChars.length || j < newChars.length) {
    if (k < lcs.length && oldChars[i] === lcs[k] && newChars[j] === lcs[k]) {
      if (leftType !== 'unchanged') { flushLeft(); leftType = 'unchanged'; }
      if (rightType !== 'unchanged') { flushRight(); rightType = 'unchanged'; }
      leftBuffer += oldChars[i];
      rightBuffer += newChars[j];
      i++;
      j++;
      k++;
    } else if (i < oldChars.length && (k >= lcs.length || oldChars[i] !== lcs[k])) {
      if (leftType !== 'removed') { flushLeft(); leftType = 'removed'; }
      leftBuffer += oldChars[i];
      i++;
    } else if (j < newChars.length && (k >= lcs.length || newChars[j] !== lcs[k])) {
      if (rightType !== 'added') { flushRight(); rightType = 'added'; }
      rightBuffer += newChars[j];
      j++;
    }
  }

  flushLeft();
  flushRight();

  return { left: leftChunks, right: rightChunks };
}

function computeCharLCS(a: string[], b: string[]): string[] {
  const m = Math.min(a.length, DIFF_CHAR_LIMIT);
  const n = Math.min(b.length, DIFF_CHAR_LIMIT);
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

export function htmlToPlainText(html: string): string {
  const tmp = document.createElement('div');
  // 消毒后再赋值 innerHTML，防止存储型 XSS 通过版本内容注入脚本
  tmp.innerHTML = DOMPurify.sanitize(html, { ALLOWED_TAGS: [] });
  return tmp.textContent || tmp.innerText || '';
}

// ==================== HTML 块级 diff ====================
export interface HtmlBlock {
  tag: string;       // 块级标签名 p/h1/h2/h3/li/blockquote/hr/ul/ol/div
  outerHTML: string; // 完整 HTML（含标签）
  textContent: string; // 纯文本内容
  attrs?: Record<string, string>;
}

/**
 * 将 HTML 按块级元素切分成块。每个块保留完整的 outerHTML 和文本内容。
 * 与纯文本 split('\n') 不同，此方法保留标签信息，应用时可保留格式。
 */
export function htmlToBlocks(html: string): HtmlBlock[] {
  if (!html) return [];
  const blocks: HtmlBlock[] = [];
  const container = document.createElement('div');
  // 消毒后再解析，防止版本内容中的恶意脚本执行
  container.innerHTML = DOMPurify.sanitize(html);

  // 只取顶级子节点，块级元素及文本节点分别处理
  const children = Array.from(container.childNodes);
  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').trim();
      if (text) {
        blocks.push({ tag: 'p', outerHTML: `<p>${escapeHtml(text)}</p>`, textContent: text });
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const outerHTML = el.outerHTML;
    const textContent = el.textContent || '';
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      attrs[attr.name] = attr.value;
    }

    // 如果是 ul/ol，展开内部 li
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.querySelectorAll('li'));
      if (items.length === 0) {
        blocks.push({ tag, outerHTML, textContent, attrs });
      } else {
        for (const li of items) {
          blocks.push({
            tag: 'li',
            outerHTML: li.outerHTML,
            textContent: li.textContent || '',
            attrs: { parent: tag },
          });
        }
      }
      continue;
    }
    blocks.push({ tag, outerHTML, textContent, attrs });
  }
  return blocks;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface HtmlBlockDiff {
  type: 'added' | 'removed' | 'unchanged' | 'modified';
  leftBlock?: HtmlBlock;
  rightBlock?: HtmlBlock;
  leftNumber?: number;
  rightNumber?: number;
  charDiffs?: { left: DiffChunk[]; right: DiffChunk[] };
}

/**
 * 按块级元素做 HTML diff。用于 UI 展示和应用时保留格式。
 */
export function computeHtmlBlockDiff(oldHtml: string, newHtml: string): HtmlBlockDiff[] {
  const oldBlocks = htmlToBlocks(oldHtml);
  const newBlocks = htmlToBlocks(newHtml);

  const result: HtmlBlockDiff[] = [];
  let leftNum = 1;
  let rightNum = 1;

  // 使用 LCS 算法，比较 textContent + tag 是否一致
  const oldTexts = oldBlocks.map(b => `${b.tag}::${b.textContent}`);
  const newTexts = newBlocks.map(b => `${b.tag}::${b.textContent}`);
  const lcs = computeTextLCS(oldTexts, newTexts);

  let i = 0; let j = 0; let k = 0;
  while (i < oldBlocks.length || j < newBlocks.length) {
    if (k < lcs.length && oldTexts[i] === lcs[k] && newTexts[j] === lcs[k]) {
      result.push({ type: 'unchanged', leftBlock: oldBlocks[i], rightBlock: newBlocks[j], leftNumber: leftNum, rightNumber: rightNum });
      i++; j++; k++; leftNum++; rightNum++;
    } else if (i < oldBlocks.length && (k >= lcs.length || oldTexts[i] !== lcs[k])) {
      result.push({ type: 'removed', leftBlock: oldBlocks[i], leftNumber: leftNum });
      i++; leftNum++;
    } else if (j < newBlocks.length && (k >= lcs.length || newTexts[j] !== lcs[k])) {
      result.push({ type: 'added', rightBlock: newBlocks[j], rightNumber: rightNum });
      j++; rightNum++;
    }
  }

  // 合并相邻 removed+added 为 modified
  return mergeHtmlAdjacent(result);
}

function mergeHtmlAdjacent(diffs: HtmlBlockDiff[]): HtmlBlockDiff[] {
  const result: HtmlBlockDiff[] = [];
  let i = 0;
  while (i < diffs.length) {
    if (diffs[i].type === 'removed' && i + 1 < diffs.length && diffs[i + 1].type === 'added') {
      const leftText = diffs[i].leftBlock?.textContent || '';
      const rightText = diffs[i + 1].rightBlock?.textContent || '';
      result.push({
        type: 'modified',
        leftBlock: diffs[i].leftBlock,
        rightBlock: diffs[i + 1].rightBlock,
        leftNumber: diffs[i].leftNumber,
        rightNumber: diffs[i + 1].rightNumber,
        charDiffs: computeCharDiff(leftText, rightText),
      });
      i += 2;
    } else if (diffs[i].type === 'added' && i + 1 < diffs.length && diffs[i + 1].type === 'removed') {
      result.push({
        type: 'modified',
        leftBlock: diffs[i + 1].leftBlock,
        rightBlock: diffs[i].rightBlock,
        leftNumber: diffs[i + 1].leftNumber,
        rightNumber: diffs[i].rightNumber,
        charDiffs: computeCharDiff(diffs[i + 1].leftBlock?.textContent || '', diffs[i].rightBlock?.textContent || ''),
      });
      i += 2;
    } else {
      result.push(diffs[i]);
      i++;
    }
  }
  return result;
}

// 通用字符串数组 LCS（复用行级 LCS 算法，但不限制为行）
function computeTextLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return [];
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcs: string[] = [];
  let i = m; let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { lcs.unshift(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return lcs;
}

/**
 * 应用 HTML 块级 diff 的修改：保留未变段落的原始 HTML，仅替换被"拒绝"的块
 * @param currentHtml 当前 HTML
 * @param diffResult HTML 块级 diff 结果
 * @param rejectedIndices 被用户拒绝（即要回退到旧版本）的索引集合
 * @returns 新的 HTML 字符串
 */
export function applyHtmlDiffRejections(
  _currentHtml: string,
  diffResult: HtmlBlockDiff[],
  rejectedIndices: Set<number>,
): string {
  // 收集最终要输出的块：
  // - unchanged/不被拒绝：使用 rightBlock（新版本）
  // - added 且被拒绝：跳过（删除新增块）
  // - removed 且被拒绝：使用 leftBlock（恢复被删块）
  // - modified 且被拒绝：使用 leftBlock（恢复旧版本）
  const outputBlocks: string[] = [];
  diffResult.forEach((d, idx) => {
    const isRejected = rejectedIndices.has(idx);
    if (d.type === 'unchanged') {
      if (d.rightBlock) outputBlocks.push(d.rightBlock.outerHTML);
    } else if (d.type === 'added') {
      if (!isRejected && d.rightBlock) outputBlocks.push(d.rightBlock.outerHTML);
      // 拒绝新增块 => 不加入
    } else if (d.type === 'removed') {
      if (isRejected && d.leftBlock) {
        outputBlocks.push(d.leftBlock.outerHTML);
      }
      // 不拒绝则保持删除状态（不加入）
    } else if (d.type === 'modified') {
      if (isRejected && d.leftBlock) {
        outputBlocks.push(d.leftBlock.outerHTML);
      } else if (d.rightBlock) {
        outputBlocks.push(d.rightBlock.outerHTML);
      }
    }
  });

  return outputBlocks.join('');
}
