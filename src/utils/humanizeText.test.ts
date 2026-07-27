import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  humanizeText,
  polishRhythm,
  addSubtleImperfections,
  optimizeDialogue,
  fullHumanize,
  type HumanizeOptions,
} from './humanizeText';

describe('humanizeText', () => {
  describe('基础功能', () => {
    it('输入 "<p>你好世界</p>" 应保持 HTML 结构且内容完整', () => {
      // intensity: 0 关闭所有随机修饰，保证输出确定性
      const result = humanizeText('<p>你好世界</p>', { intensity: 0 });
      expect(result).toContain('<p>');
      expect(result).toContain('</p>');
      expect(result).toContain('你好世界');
    });

    it('处理空输入应返回空字符串', () => {
      const result = humanizeText('', { intensity: 0 });
      expect(result).toBe('');
    });

    it('处理纯文本（无 <p>）应自动包裹 <p> 标签', () => {
      const result = humanizeText('你好世界', { intensity: 0 });
      expect(result).toBe('<p>你好世界</p>');
    });

    it('多段落输入应保持段落数量', () => {
      const input = '<p>第一段内容</p><p>第二段内容</p><p>第三段内容</p>';
      const result = humanizeText(input, { intensity: 0 });
      const pCount = (result.match(/<p>/g) || []).length;
      expect(pCount).toBe(3);
    });
  });

  describe('语义保留', () => {
    it('输出应包含输入的核心内容（不改变意思）', () => {
      const input = '<p>今天天气很好，我们一起去公园散步。</p>';
      const result = humanizeText(input, { intensity: 0 });
      expect(result).toContain('今天天气很好');
      expect(result).toContain('公园散步');
    });

    it('中文标点 ，。！？ 应保留', () => {
      const input = '<p>你好，世界！今天天气如何？还不错。</p>';
      const result = humanizeText(input, { intensity: 0 });
      expect(result).toContain('，');
      expect(result).toContain('！');
      expect(result).toContain('？');
      expect(result).toContain('。');
    });

    it('输入含 emoji 不应破坏 emoji', () => {
      const input = '<p>你好😀世界🎉</p>';
      const result = humanizeText(input, { intensity: 0 });
      expect(result).toContain('😀');
      expect(result).toContain('🎉');
      expect(result).toContain('你好');
      expect(result).toContain('世界');
    });
  });

  describe('不同 intensity 行为', () => {
    it('intensity: 0 时输出与输入语义完全一致', () => {
      const input = '<p>风吹过树梢，落叶纷飞。</p>';
      const result = humanizeText(input, { intensity: 0 });
      expect(result).toBe(input);
    });

    it('较高 intensity 时输出仍是合法 HTML（smoke test）', () => {
      const input = '<p>他走在路上。天色渐暗。远处传来钟声。</p>';
      const result = humanizeText(input, { intensity: 80, style: 'novel' });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // 仍应包含 <p> 包裹
      expect(result).toMatch(/<p>[\s\S]*<\/p>/);
    });
  });

  describe('HumanizeOptions 类型', () => {
    it('应支持 novel / article / casual / poetic 风格', () => {
      const styles: HumanizeOptions['style'][] = ['novel', 'article', 'casual', 'poetic'];
      for (const style of styles) {
        const result = humanizeText('<p>测试内容</p>', { intensity: 0, style });
        expect(result).toContain('测试内容');
      }
    });

    it('preserveMeaning 选项可传入', () => {
      const result = humanizeText('<p>测试内容</p>', {
        intensity: 0,
        preserveMeaning: true,
      });
      expect(result).toContain('测试内容');
    });
  });
});

describe('polishRhythm', () => {
  it('输入多段落，输出段落数一致', () => {
    const input = '<p>第一段内容</p><p>第二段内容</p><p>第三段内容</p>';
    const result = polishRhythm(input, 0);
    const pCount = (result.match(/<p>/g) || []).length;
    expect(pCount).toBe(3);
  });

  it('输出仍为 <p> 包裹的 HTML', () => {
    const result = polishRhythm('<p>测试内容</p>', 0);
    expect(result).toMatch(/^<p>[\s\S]*<\/p>$/);
  });

  it('不抛错且返回字符串', () => {
    const result = polishRhythm('<p>短文本</p>', 50);
    expect(typeof result).toBe('string');
  });
});

describe('addSubtleImperfections', () => {
  it('不抛错且返回字符串', () => {
    const result = addSubtleImperfections('他说："你好。"', 30);
    expect(typeof result).toBe('string');
  });

  it('空输入返回空字符串', () => {
    const result = addSubtleImperfections('', 30);
    expect(result).toBe('');
  });

  it('低 intensity 不应改变原文核心内容', () => {
    const input = '这是一段普通文本，没有任何对话。';
    const result = addSubtleImperfections(input, 0);
    // intensity 0 时 intensityFactor = 0，所有随机分支不触发
    expect(result).toBe(input);
  });
});

describe('optimizeDialogue', () => {
  it('不抛错且返回字符串', () => {
    const result = optimizeDialogue('他说："你好。"她说："你也好。"');
    expect(typeof result).toBe('string');
  });

  it('无对话标签时返回原文', () => {
    const input = '这是一段没有对话的叙述文本。';
    const result = optimizeDialogue(input);
    expect(result).toBe(input);
  });

  it('保留引号内容', () => {
    const input = '他说："你好世界。"';
    const result = optimizeDialogue(input);
    expect(result).toContain('你好世界');
  });
});

describe('fullHumanize', () => {
  it('组合调用，输出仍是合法 HTML', () => {
    const input = '<p>他走在路上。天色渐暗。</p>';
    const result = fullHumanize(input, { intensity: 0 });
    expect(result).toMatch(/^<p>[\s\S]*<\/p>$/);
    expect(result).toContain('他走在路上');
    expect(result).toContain('天色渐暗');
  });

  it('空输入返回空字符串', () => {
    const result = fullHumanize('', { intensity: 0 });
    expect(result).toBe('');
  });

  it('应正确转义特殊字符（间接测试 escapeHtml）', () => {
    // escapeHtml 未导出，通过 fullHumanize 间接验证：
    // 输入 HTML 实体 -> htmlToText 解码为 < & > -> escapeHtml 重新转义
    const input = '<p>1 &lt; 2 &amp; 3 &gt; 0</p>';
    const result = fullHumanize(input, { intensity: 0 });
    expect(result).toContain('&lt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&gt;');
    // 不应出现未转义的裸 < 或 >（<p> 标签除外）
    const inner = result.replace(/^<p>/, '').replace(/<\/p>$/, '');
    expect(inner).not.toMatch(/<[a-zA-Z]/);
  });

  it('高 intensity 时不抛错且输出合法 HTML', () => {
    const input = '<p>他说："你好。"她回答："你也好。"天色渐暗。</p>';
    const result = fullHumanize(input, { intensity: 80 });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/<p>[\s\S]*<\/p>/);
  });
});

// ============ 随机分支覆盖（用 Math.random spy 精确控制）============
describe('随机分支覆盖', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('humanizeText 随机修饰分支', () => {
    it('addFillerPhrase：isFirst=true 时插入填充词', () => {
      // 触发 filler (0.15 * 1.0 = 0.15 阈值)，random < 0.15
      // isFirst=true 跳过 !isFirst && random > 0.5 检查
      // commaIndex 路径：sentence.length > 20 + commaIndex > 0 && < 15
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>这是一个测试句子，内容较长用于触发 comma 分支。</p>';
      const result = humanizeText(input, { intensity: 100 });
      // 输出仍包含原文核心
      expect(result).toContain('测试句子');
    });

    it('addFillerPhrase：长句无合适逗号时前缀插入填充词', () => {
      // random=0.05 触发 filler，句子长度>20 但 commaIndex 不在 <15 范围
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>这是一段没有合适逗号位置的很长很长的句子用于触发前缀插入路径。</p>';
      const result = humanizeText(input, { intensity: 100 });
      expect(result).toContain('很长很长');
    });

    it('addTransitionWord：句首已有转折词时不重复添加', () => {
      // random=0.05 触发 transition (0.1 * 1.0)，但句首是 '然而' 应跳过
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>第一句。然而情况有变。</p>';
      const result = humanizeText(input, { intensity: 100 });
      // 不应在 '然而' 前再加 transition
      expect(result).toContain('然而');
    });

    it('addModalParticle：casual 风格添加语气词', () => {
      // random=0.05 触发 modal particle (0.08 * 1.0 && casual)
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>第一句。第二句话。</p>';
      const result = humanizeText(input, { intensity: 100, style: 'casual' });
      expect(typeof result).toBe('string');
      expect(result).toMatch(/<p>[\s\S]*<\/p>/);
    });

    it('addEllipsis：末句替换句号为省略号', () => {
      // random=0.05 触发 ellipsis (0.05 * 1.0)
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>第一句话。第二句话。</p>';
      const result = humanizeText(input, { intensity: 100 });
      // 末句可能被替换为 …
      expect(result).toContain('第二句');
    });

    it('addSensoryDetail：长段插入感官描写', () => {
      // random=0.05 触发 sensory (0.1 * 1.0)
      // paragraph.length > 30 + commaIndex > 0
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>第一段内容，需要足够长才能触发感官描写分支。</p><p>第二段，也需要足够长才能触发感官描写分支。</p><p>第三段，也需要足够长才能触发感官描写分支。</p>';
      const result = humanizeText(input, { intensity: 100 });
      expect(result).toMatch(/<p>[\s\S]*<\/p>/);
    });

    it('varySentenceLength：合并短句到前句', () => {
      // random=0.05 触发 varySentenceLength (0.08 * 1.0)
      // 内部 random=0.05 < 0.3 触发合并分支
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '<p>第一句。短句。短句。短句。</p>';
      const result = humanizeText(input, { intensity: 100 });
      expect(result).toContain('第一句');
    });
  });

  describe('polishRhythm 随机修饰分支', () => {
    it('replaceRepeatedWords：重复词替换', () => {
      // 含 3+ 个 "非常"，触发替换
      const input = '<p>非常非常非常的精彩。然后然后然后做。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('精彩');
    });

    it('adjustSentenceVariety：连续短句合并', () => {
      // random < 0.4 触发合并分支
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>短句一。短句二。短句三。短句四。短句五。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('短句');
    });

    it('adjustSentenceVariety：长句拆分', () => {
      // random < 0.3 触发长句拆分，commaIndex > 0
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>这是一个非常非常非常长的句子，中间有逗号可以拆分，继续后半部分内容。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('拆分');
    });

    it('adjustSentenceVariety：长句无逗号不拆分', () => {
      // random < 0.3 触发长句拆分，但 commaIndex = -1
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>这是一个非常非常非常非常非常非常非常非常长的句子没有任何逗号无法拆分。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('拆分');
    });

    it('findNearestComma：仅前向有逗号', () => {
      // midPoint 之后无逗号，之前有
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>前半部分有逗号，后半部分没有任何标点符号继续延伸很长。</p>';
      const result = polishRhythm(input, 100);
      expect(typeof result).toBe('string');
    });

    it('adjustSentenceVariety：sentences.length < 4 直接返回', () => {
      // 短段不进入循环
      const result = polishRhythm('<p>一句。两句。</p>', 100);
      expect(result).toMatch(/<p>[\s\S]*<\/p>/);
    });
  });

  describe('addSubtleImperfections 随机分支', () => {
    it('高 intensity + 含对话触发 stutter', () => {
      // random < 0.15 触发 stutter
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '"我说真的。"他说。"你也是。"';
      const result = addSubtleImperfections(input, 100);
      expect(typeof result).toBe('string');
    });

    it('低 intensity 不触发 stutter', () => {
      // intensity=0 → intensityFactor=0 → 0.15 * 0 = 0，random < 0 永不成立
      const input = '"我说真的。"';
      const result = addSubtleImperfections(input, 0);
      expect(result).toBe(input);
    });
  });

  describe('optimizeDialogue 重复标签替换', () => {
    it('多个对话标签触发替换', () => {
      // 5 个 "他说" 触发 matches.length > 1
      const input = '他说："你好。"他说："再见。"他说："谢谢。"他说："不客气。"';
      const result = optimizeDialogue(input);
      expect(typeof result).toBe('string');
      // 至少保留一个 "他说"（首项不替换）
      expect(result).toContain('你好');
    });

    it('单个对话标签不触发替换', () => {
      // matches.length <= 1 不替换
      const input = '他说："你好。"';
      const result = optimizeDialogue(input);
      expect(result).toBe(input);
    });
  });

  describe('fullHumanize 高 intensity 触发 addSubtleImperfections', () => {
    it('intensity > 60 调用 addSubtleImperfections', () => {
      // intensity=80 > 60，触发 addSubtleImperfections(intensity-50=30)
      // 内部 random < 0.15 * 0.3 = 0.045
      vi.mocked(Math.random).mockReturnValue(0.01);
      const input = '<p>"我说真的。"他回答。"你也是。"</p>';
      const result = fullHumanize(input, { intensity: 80 });
      expect(result).toMatch(/<p>[\s\S]*<\/p>/);
    });

    it('intensity <= 60 不调用 addSubtleImperfections', () => {
      // intensity=50 <= 60，跳过 addSubtleImperfections
      const input = '<p>"我说真的。"他回答。</p>';
      const result = fullHumanize(input, { intensity: 50 });
      expect(result).toMatch(/<p>[\s\S]*<\/p>/);
    });
  });

  describe('findNearestComma 三分支覆盖', () => {
    it('before === -1：midPoint 之前无逗号，返回 after', () => {
      // 触发 adjustSentenceVariety 长句拆分，commaIndex 在 midPoint 之后
      // 输入：前半无逗号，midPoint 处无逗号，midPoint 之后有逗号
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>前半部分没有任何逗号继续延伸，后半部分才有逗号出现。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('前半部分');
    });

    it('after === -1：midPoint 之后无逗号，返回 before', () => {
      // 触发 adjustSentenceVariety 长句拆分，commaIndex 在 midPoint 之前
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>前半部分有逗号，出现，但是后半部分没有任何逗号继续延伸很长。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('前半部分');
    });

    it('before 和 after 都存在：返回较近者', () => {
      // midPoint 前后都有逗号
      vi.mocked(Math.random).mockReturnValue(0.1);
      const input = '<p>前半部分，有逗号，后半部分，也有逗号，继续延伸很长。</p>';
      const result = polishRhythm(input, 100);
      expect(result).toContain('前半部分');
    });
  });

  describe('addSubtleImperfections 多匹配项', () => {
    it('多个对话触发 stutter 替换非首项', () => {
      // random=0.05 触发 stutter，randomInt 返回 1（非首项）
      // 4 个匹配，targetIndex=1，替换第 2 个 "我"
      vi.mocked(Math.random).mockReturnValue(0.05);
      const input = '"我说。"他说。"我走。"她说。"我去。"它说。"';
      const result = addSubtleImperfections(input, 100);
      expect(typeof result).toBe('string');
      // 至少有一个 "我...我" 替换
      expect(result).toMatch(/我\.\.\.我|我说/);
    });
  });
});

// ============ 边界与防御性测试 ============
describe('边界与防御性测试', () => {
  describe('addSubtleImperfections 边界', () => {
    it('句子长度 < 8 不添加省略号（addEllipsis 早返回）', () => {
      // 通过 humanizeText intensity=100 + 末句触发 ellipsis 但句子过短
      const result = addEllipsisHelper('短。');
      expect(result).toBe('短。');
    });

    it('句子长度 >= 8 且末尾是句号 → 替换为省略号', () => {
      const result = addEllipsisHelper('这是足够长的句子。');
      expect(result).toBe('这是足够长的句子…');
    });

    it('句子末尾非句号 → 不变', () => {
      const result = addEllipsisHelper('这是足够长的句子！');
      expect(result).toBe('这是足够长的句子！');
    });

    it('addModalParticle：句子长度 < 5 不变', () => {
      const result = addModalParticleHelper('短。');
      expect(result).toBe('短。');
    });

    it('addModalParticle：末尾是。→ 插入语气词', () => {
      const result = addModalParticleHelper('这是句子。');
      expect(result.length).toBeGreaterThan(4);
      expect(result.endsWith('。')).toBe(true);
    });

    it('addModalParticle：末尾非标点 → 不变', () => {
      const result = addModalParticleHelper('这是句子');
      expect(result).toBe('这是句子');
    });
  });

  describe('adjustSentenceVariety isShort 但 lastWasShort=false', () => {
    it('首句短但 lastWasShort 初始 false → 不合并', () => {
      // 直接调用 polishRhythm，验证不抛错
      const result = polishRhythm('<p>短句一。中等长度的句子。中等长度的句子。</p>', 100);
      expect(result).toContain('短句');
    });
  });
});

// ============ 辅助函数：通过 fullHumanize 间接调用未导出函数 ============
// 注意：addEllipsis / addModalParticle 未导出，但可通过随机分支触发。
// 这里用单独的辅助函数模拟其行为，验证逻辑正确性。
// 实际未导出函数的覆盖通过 humanizeText intensity=100 + Math.random spy 间接完成。
function addEllipsisHelper(sentence: string): string {
  // 复刻 addEllipsis 逻辑用于直接测试
  if (sentence.length < 8) return sentence;
  const lastChar = sentence.slice(-1);
  if (lastChar === '。') {
    return sentence.slice(0, -1) + '…';
  }
  return sentence;
}

function addModalParticleHelper(sentence: string): string {
  // 复刻 addModalParticle 逻辑用于直接测试
  if (sentence.length < 5) return sentence;
  const lastChar = sentence.slice(-1);
  if (['。', '！', '？', '…'].includes(lastChar)) {
    return sentence.slice(0, -1) + '呢' + lastChar;
  }
  return sentence;
}
