export interface HumanizeOptions {
  intensity: number;
  style: 'novel' | 'article' | 'casual' | 'poetic';
  preserveMeaning: boolean;
}

const defaultOptions: HumanizeOptions = {
  intensity: 50,
  style: 'novel',
  preserveMeaning: true,
};

const fillerPhrases = [
  '不知怎的',
  '说起来',
  '你别说',
  '仔细想想',
  '说真的',
  '话虽如此',
  '坦白说',
  '老实讲',
  '不知为何',
  '说来也巧',
  '偏偏',
  '巧的是',
  '有意思的是',
  '更不用说',
  '话又说回来',
];

const modalParticles = [
  '呢',
  '吧',
  '啊',
  '嘛',
  '罢了',
  '而已',
  '就是了',
];

const transitionWords = [
  '然而',
  '不过',
  '只是',
  '可',
  '但是',
  '于是',
  '因此',
  '所以',
  '接着',
  '随后',
  '片刻之后',
  '过了一会儿',
  '不多时',
  '转眼间',
  '恍惚间',
];

const sensoryDetails = {
  sight: [
    '光线在眼前微微晃动',
    '影子被拉得很长',
    '空气中浮动着细小的尘埃',
    '一切都像是蒙上了一层薄纱',
    '视线有些模糊',
  ],
  sound: [
    '远处传来模糊的声响',
    '耳边是自己的呼吸声',
    '安静得能听见心跳',
    '风声从指缝间穿过',
    '什么声音都没有，反而更让人不安',
  ],
  touch: [
    '指尖有些发凉',
    '掌心渗出细密的汗珠',
    '皮肤上传来一阵麻痒',
    '寒意顺着脊背爬了上来',
    '空气里带着一丝潮气',
  ],
};

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';
  
  for (let i = 0; i < text.length; i++) {
    current += text[i];
    if (['。', '！', '？', '…', '.', '!', '?'].includes(text[i])) {
      if (current.trim()) {
        sentences.push(current.trim());
      }
      current = '';
    }
  }
  
  if (current.trim()) {
    sentences.push(current.trim());
  }
  
  return sentences;
}

function splitIntoParagraphs(html: string): string[] {
  const clean = html.replace(/<\/?p>/g, '\n').replace(/<br\s*\/?>/g, '\n');
  return clean.split('\n').filter(p => p.trim());
}

function wrapInParagraph(text: string): string {
  return `<p>${text}</p>`;
}

export function humanizeText(html: string, options: Partial<HumanizeOptions> = {}): string {
  const opts = { ...defaultOptions, ...options };
  const intensityFactor = opts.intensity / 100;
  
  const paragraphs = splitIntoParagraphs(html);
  const result: string[] = [];
  
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const sentences = splitIntoSentences(paragraph);
    const modifiedSentences: string[] = [];
    
    for (let j = 0; j < sentences.length; j++) {
      let sentence = sentences[j];
      
      if (Math.random() < 0.15 * intensityFactor) {
        sentence = addFillerPhrase(sentence, j === 0);
      }
      
      if (Math.random() < 0.1 * intensityFactor && j > 0) {
        sentence = addTransitionWord(sentence);
      }
      
      if (Math.random() < 0.08 * intensityFactor && opts.style === 'casual') {
        sentence = addModalParticle(sentence);
      }
      
      if (Math.random() < 0.05 * intensityFactor && j === sentences.length - 1) {
        sentence = addEllipsis(sentence);
      }
      
      modifiedSentences.push(sentence);
    }
    
    let modifiedParagraph = modifiedSentences.join('');
    
    if (Math.random() < 0.1 * intensityFactor && i > 0 && i < paragraphs.length - 1) {
      modifiedParagraph = addSensoryDetail(modifiedParagraph);
    }
    
    if (Math.random() < 0.08 * intensityFactor) {
      modifiedParagraph = varySentenceLength(modifiedParagraph);
    }
    
    result.push(wrapInParagraph(modifiedParagraph));
  }
  
  return result.join('');
}

function addFillerPhrase(sentence: string, isFirst: boolean): string {
  if (!isFirst && Math.random() > 0.5) {
    return sentence;
  }
  
  const filler = randomChoice(fillerPhrases);
  
  if (sentence.length > 20) {
    const commaIndex = sentence.indexOf('，');
    if (commaIndex > 0 && commaIndex < 15) {
      return sentence.slice(0, commaIndex + 1) + filler + '，' + sentence.slice(commaIndex + 1);
    }
    return filler + '，' + sentence;
  }
  
  return sentence;
}

function addTransitionWord(sentence: string): string {
  const transition = randomChoice(transitionWords);
  
  if (sentence.startsWith('但是') || sentence.startsWith('然而') || sentence.startsWith('不过')) {
    return sentence;
  }
  
  return transition + '，' + sentence;
}

function addModalParticle(sentence: string): string {
  if (sentence.length < 5) return sentence;
  
  const lastChar = sentence.slice(-1);
  if (['。', '！', '？', '…'].includes(lastChar)) {
    const particle = randomChoice(modalParticles);
    return sentence.slice(0, -1) + particle + lastChar;
  }
  
  return sentence;
}

function addEllipsis(sentence: string): string {
  if (sentence.length < 8) return sentence;
  
  const lastChar = sentence.slice(-1);
  if (lastChar === '。') {
    return sentence.slice(0, -1) + '...';
  }
  
  return sentence;
}

function addSensoryDetail(sentence: string): string {
  const category = randomChoice(Object.keys(sensoryDetails) as (keyof typeof sensoryDetails)[]);
  const detail = randomChoice(sensoryDetails[category]);
  
  if (sentence.length > 30) {
    const mid = Math.floor(sentence.length / 2);
    const commaIndex = sentence.indexOf('，', mid);
    if (commaIndex > 0) {
      return sentence.slice(0, commaIndex + 1) + detail + '，' + sentence.slice(commaIndex + 1);
    }
  }
  
  return sentence;
}

function varySentenceLength(paragraph: string): string {
  const sentences = splitIntoSentences(paragraph);
  
  if (sentences.length < 3) return paragraph;
  
  const result: string[] = [];
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    
    if (i > 0 && Math.random() < 0.3 && sentence.length < 15) {
      result[result.length - 1] = result[result.length - 1].slice(0, -1) + '，' + sentence;
    } else {
      result.push(sentence);
    }
  }
  
  return result.join('');
}

export function polishRhythm(html: string, intensity: number = 50): string {
  const paragraphs = splitIntoParagraphs(html);
  const intensityFactor = intensity / 100;
  const result: string[] = [];
  
  for (const paragraph of paragraphs) {
    let modified = paragraph;
    
    modified = replaceRepeatedWords(modified);
    modified = adjustSentenceVariety(modified, intensityFactor);
    
    result.push(wrapInParagraph(modified));
  }
  
  return result.join('');
}

function replaceRepeatedWords(text: string): string {
  let result = text;
  
  const repetitivePatterns = [
    { pattern: /非常/g, replacements: ['格外', '异常', '分外', '相当', '颇为'] },
    { pattern: /很/g, replacements: ['挺', '蛮', '颇', '甚', '相当'] },
    { pattern: /然后/g, replacements: ['接着', '随后', '紧接着', '不多时', '下一刻'] },
    { pattern: /突然/g, replacements: ['忽然', '猛然', '骤然', '忽地', '冷不丁'] },
    { pattern: /慢慢/g, replacements: ['缓缓', '徐徐', '渐渐', '逐步', '一点一点'] },
    { pattern: /看着/g, replacements: ['望着', '凝视着', '注视着', '盯着', '打量着'] },
    { pattern: /感觉/g, replacements: ['觉得', '感到', '只觉得', '隐约感到', '恍惚间觉得'] },
  ];
  
  for (const { pattern, replacements } of repetitivePatterns) {
    const matches = result.match(pattern);
    if (matches && matches.length > 2) {
      let count = 0;
      result = result.replace(pattern, () => {
        count++;
        if (count > 1 && Math.random() < 0.6) {
          return randomChoice(replacements);
        }
        return matches[0];
      });
    }
  }
  
  return result;
}

function adjustSentenceVariety(text: string, intensityFactor: number): string {
  const sentences = splitIntoSentences(text);
  if (sentences.length < 4) return text;
  
  const lengths = sentences.map(s => s.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  
  let result = '';
  let lastWasShort = false;
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    
    const isShort = sentence.length < avgLength * 0.6;
    const isLong = sentence.length > avgLength * 1.4;
    
    if (isShort && lastWasShort && Math.random() < 0.4 * intensityFactor) {
      result = result.slice(0, -1) + '，' + sentence;
      lastWasShort = false;
    } else if (isLong && Math.random() < 0.3 * intensityFactor) {
      const midPoint = Math.floor(sentence.length / 2);
      const commaIndex = findNearestComma(sentence, midPoint);
      if (commaIndex > 0) {
        const firstHalf = sentence.slice(0, commaIndex + 1);
        const secondHalf = sentence.slice(commaIndex + 1);
        result += firstHalf + '\n' + secondHalf;
        lastWasShort = false;
      } else {
        result += sentence;
        lastWasShort = isShort;
      }
    } else {
      result += sentence;
      lastWasShort = isShort;
    }
  }
  
  return result;
}

function findNearestComma(text: string, position: number): number {
  const before = text.lastIndexOf('，', position);
  const after = text.indexOf('，', position);
  
  if (before === -1) return after;
  if (after === -1) return before;
  
  return (position - before) < (after - position) ? before : after;
}

export function addSubtleImperfections(text: string, intensity: number = 30): string {
  const intensityFactor = intensity / 100;
  let result = text;
  
  const stutterPatterns = [
    { char: '我', stutter: '我...我' },
    { char: '你', stutter: '你...你' },
    { char: '他', stutter: '他...他' },
    { char: '她', stutter: '她...她' },
    { char: '这', stutter: '这...这' },
    { char: '那', stutter: '那...那' },
  ];
  
  if (Math.random() < 0.15 * intensityFactor) {
    const pattern = randomChoice(stutterPatterns);
    const regex = new RegExp(`"${pattern.char}`, 'g');
    const matches = result.match(regex);
    if (matches && matches.length > 0) {
      const targetIndex = randomInt(0, matches.length - 1);
      let count = 0;
      result = result.replace(regex, (match) => {
        if (count === targetIndex) {
          count++;
          return `"${pattern.stutter}`;
        }
        count++;
        return match;
      });
    }
  }
  
  return result;
}

export function optimizeDialogue(text: string): string {
  let result = text;
  
  const dialogueTags = [
    '他说',
    '她说',
    '说道',
    '回答',
    '问道',
  ];
  
  const replacements = [
    '他开口',
    '她轻声道',
    '缓缓开口',
    '低声应道',
    '挑眉反问',
    '淡淡说',
    '苦笑',
    '叹了口气',
    '摇头',
    '点头',
  ];
  
  for (const tag of dialogueTags) {
    const regex = new RegExp(tag, 'g');
    const matches = result.match(regex);
    if (matches && matches.length > 1) {
      let count = 0;
      result = result.replace(regex, () => {
        count++;
        if (count > 1 && Math.random() < 0.5) {
          return randomChoice(replacements);
        }
        return tag;
      });
    }
  }
  
  return result;
}

export function fullHumanize(html: string, options: Partial<HumanizeOptions> = {}): string {
  let result = html;
  
  result = humanizeText(result, options);
  result = polishRhythm(result, options.intensity || 50);
  result = optimizeDialogue(result);
  
  if ((options.intensity || 50) > 60) {
    result = addSubtleImperfections(result, (options.intensity || 50) - 50);
  }
  
  return result;
}
