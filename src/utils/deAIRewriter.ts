/**
 * 基于 AI 痕迹检测报告的规则式降 AI 改写
 *
 * 接收 aiTraceDetector 的报告，针对具体 issue 类型做确定性修正。
 * 与 humanizeText 的随机扰动不同，这里是定向修复：检测到什么就改什么。
 */
import type { AITraceReport } from './aiTraceDetector';
import { escapeHtml } from '@/lib/htmlUtils';

function textToHtml(text: string): string {
  return text
    .split(/\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${escapeHtml(p.trim())}</p>`)
    .join('');
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>\s*<p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// === 各类型修正器 ===

const TRANSITION_REPLACEMENTS: Record<string, string[]> = {
  '然而': ['', '只是', '可'],
  '于是': ['', '便', '这就'],
  '随后': ['', '接着', '不多时'],
  '接着': ['', '便', '随后'],
  '与此同时': ['这当口', '正说着', '话音未落'],
  '因此': ['', '故而', '这便'],
  '所以': ['', '故而', '便'],
  '不禁': ['', '忍不住', '不由'],
  '不由得': ['', '忍不住', '不由'],
  '转眼间': ['眨眼间', '一转眼', '转瞬'],
  '片刻之后': ['不多时', '片刻', '稍顷'],
  '过了一会儿': ['半晌', '片刻', '不多时'],
};

function fixTransitionAbuse(text: string): string {
  let result = text;
  for (const [word, replacements] of Object.entries(TRANSITION_REPLACEMENTS)) {
    // 句首的过渡词
    const re = new RegExp(`([。！？\\n])${word}，?`, 'g');
    let count = 0;
    result = result.replace(re, (_m, punc) => {
      count++;
      // 第 1 次保留，第 2 次起替换或删除
      if (count >= 2) {
        const repl = replacements[count % replacements.length];
        return repl ? `${punc}${repl}，` : punc;
      }
      return `${punc}${word}，`;
    });
  }
  return result;
}

const IDIOM_REPLACEMENTS: Record<string, string> = {
  '波澜壮阔': '浪头拍岸',
  '气势磅礴': '气压低得吓人',
  '令人窒息': '喘不上气',
  '不可思议': '说不出的怪',
  '美轮美奂': '精致得不像话',
  '叹为观止': '看得说不出话',
  '心潮澎湃': '心跳得发紧',
  '热血沸腾': '血往头上涌',
  '惊天动地': '天都要塌了',
  '震耳欲聋': '耳朵嗡嗡响',
  '恍如隔世': '像过了半辈子',
  '刻骨铭心': '记到骨头里',
  '魂牵梦萦': '梦里都是',
  '惊心动魄': '心都提到嗓子眼',
  '刻不容缓': '一刻都等不得',
  '势不可挡': '拦都拦不住',
  '蔚为壮观': '场面大得很',
};

function fixIdiomPileup(text: string): string {
  let result = text;
  for (const [idiom, repl] of Object.entries(IDIOM_REPLACEMENTS)) {
    result = result.split(idiom).join(repl);
  }
  return result;
}

const EMOTION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/他感到一阵愤怒/g, '他的指节捏得发白'],
  [/她感到一阵愤怒/g, '她的指节捏得发白'],
  [/他感到一阵悲伤/g, '他别开脸，睫毛颤了颤'],
  [/她感到一阵悲伤/g, '她别开脸，睫毛颤了颤'],
  [/他感到一阵恐惧/g, '他的后背一阵发凉'],
  [/她感到一阵恐惧/g, '她的后背一阵发凉'],
  [/他感到一阵喜悦/g, '他的嘴角不自觉上扬'],
  [/她感到一阵喜悦/g, '她的嘴角不自觉上扬'],
  [/心中涌起[^\s，。]{1,6}/g, '心口一紧'],
  [/心里涌起[^\s，。]{1,6}/g, '心口一紧'],
  [/不禁感到[^\s，。]{1,6}/g, '只觉得心里发堵'],
  [/一股[^\s，。]{1,6}涌上心头/g, '心口一阵发闷'],
];

function fixEmotionTelling(text: string): string {
  let result = text;
  for (const [re, repl] of EMOTION_REPLACEMENTS) {
    result = result.replace(re, repl);
  }
  return result;
}

const METAPHOR_TRIM_RE = /(如同|仿佛|好似|宛如|像是|犹如)([^，。！？]{2,15})(一般|似的|一样|般)/g;

function fixMetaphorOverload(text: string): string {
  let count = 0;
  return text.replace(METAPHOR_TRIM_RE, (_m, prep: string, body: string) => {
    count++;
    // 第 1 次保留比喻本体，去掉"一般/似的"尾巴；第 2 次起改为直写
    if (count === 1) return `${prep}${body}`;
    return body;
  });
};

const SUMMARY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/这一刻[，,]?他(终于)?明白[^\s，。]{0,20}/g, ''],
  [/这一刻[，,]?她(终于)?明白[^\s，。]{0,20}/g, ''],
  [/从此以后[，,]?/g, ''],
  [/或许[，,]?这(就是|便是)[^\s，。]{0,15}/g, ''],
];

function fixSummaryEnding(text: string): string {
  let result = text;
  for (const [re, repl] of SUMMARY_REPLACEMENTS) {
    result = result.replace(re, repl);
  }
  // 清理因删除产生的多余/孤立标点：
  //   1. "，。" "。" "！" 等 → 统一为 "。"
  //   2. "。，" → "。"（删除总结句后留下的 "。，正文" 残骸）
  //   3. 句首残留的 "，" 或 "、"（删总结句后下一句以逗号开头，如 "，眼泪落下来。"）
  result = result.replace(/[，。！？]\s*[。]/g, '。');
  result = result.replace(/。\s*[，、]/g, '。');
  result = result.replace(/(^|\n)\s*[，、]\s*/g, '$1');
  // 同段内（非换行开头）紧随前句"。"之后的孤立 "，正文" 也清理：
  //   场景：原文 "完了。这一刻，他终于明白了一切，转身离开。"
  //   删总结句后变成 "完了。，转身离开。" → 上面第二条已处理为 "完了。转身离开。"
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
  return result;
};

const DIALOGUE_TAG_ACTIONS = [
  '把茶盏一放',
  '别开脸',
  '低头抿了口茶',
  '指尖敲了敲桌面',
  '抬眼看他',
  '转过身去',
  '拢了拢衣袖',
];

function fixDialogueTagMonotony(text: string): string {
  let actionIdx = 0;
  // 替换连续的 "他说" / "她说"（紧跟引号后）
  // 注意：第 1 处必须 return m（完整匹配）才是真正"保留标签"，
  // 早期版本错写成 return quote，会把"，他说"整个删掉只剩引号，
  // 导致两个引号直接相连（如""好啊""那走吧。""）。
  return text.replace(/([""])[，。]?(他|她)(说|道)/g, (m, quote) => {
    actionIdx++;
    if (actionIdx === 1) return m; // 第一处原样保留
    const action = DIALOGUE_TAG_ACTIONS[actionIdx % DIALOGUE_TAG_ACTIONS.length];
    return `${quote}，${action}`;
  });
}

function fixRepeatedStructure(text: string): string {
  const sentences = text.split(/([。！？])/);
  const result: string[] = [];
  let lastStart = '';
  let consecutive = 0;
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i] || '';
    const punct = sentences[i + 1] || '';
    const start = sentence.slice(0, 4);
    if (start === lastStart && start) {
      consecutive++;
      if (consecutive >= 2) {
        // 在句首加状语/副词打破雷同
        const prefixes = ['其时，', '却说', '那', '偏生', '恰在此时，'];
        const prefix = prefixes[consecutive % prefixes.length];
        result.push(prefix + sentence + punct);
        continue;
      }
    } else {
      consecutive = 0;
    }
    lastStart = start;
    result.push(sentence + punct);
  }
  return result.join('');
}

function fixListStructure(text: string): string {
  // "第一...第二...第三..." → 用顿号或自然语序替代
  return text
    .replace(/第[一二三四五六七八九十]、/g, '')
    .replace(/首先[，,]?/g, '')
    .replace(/其次[，,]?/g, '再说，')
    .replace(/(最后|最终)[，,]?/g, '到头来，');
}

// === 主入口 ===

/**
 * 根据检测报告定向降 AI。
 * 对每个 issue.type 调用对应的修正器。
 */
export function deAIByReport(html: string, report: AITraceReport): string {
  const text = htmlToText(html);
  let result = text;

  // 收集所有 issue 类型
  const issueTypes = new Set<string>();
  for (const dim of report.dimensions) {
    for (const issue of dim.issues) {
      issueTypes.add(issue.type);
    }
  }

  if (issueTypes.has('transition-abuse')) result = fixTransitionAbuse(result);
  if (issueTypes.has('idiom-pileup')) result = fixIdiomPileup(result);
  if (issueTypes.has('emotion-telling')) result = fixEmotionTelling(result);
  if (issueTypes.has('metaphor-overload')) result = fixMetaphorOverload(result);
  if (issueTypes.has('summary-ending')) result = fixSummaryEnding(result);
  if (issueTypes.has('dialogue-tag-monotony')) result = fixDialogueTagMonotony(result);
  if (issueTypes.has('repeated-structure')) result = fixRepeatedStructure(result);
  if (issueTypes.has('list-structure')) result = fixListStructure(result);

  return textToHtml(result);
}
