/**
 * deAIRewriter 测试
 *
 * 测试策略：通过 deAIByReport 入口间接覆盖各 fix* 函数。
 * 每个 issue.type 触发对应的修正器；用具体样例验证替换效果。
 */
import { deAIByReport } from '@/utils/deAIRewriter';
import type { AITraceReport } from '@/utils/aiTraceDetector';

// 构造最小可用报告：默认无任何 issue，deAIByReport 应原样返回（仅做 HTML↔text 转换）
function makeReport(issueTypes: string[]): AITraceReport {
  return {
    aiRate: 50,
    humanScore: 50,
    perplexity: 30,
    burstiness: 30,
    sentenceLengthStats: { short: 1, medium: 1, long: 1, avg: 10, stdDev: 5 },
    dimensions: [
      {
        name: '测试维度',
        score: 50,
        weight: 1,
        issues: issueTypes.map((type, i) => ({
          type,
          severity: 'medium' as const,
          description: `desc-${i}`,
          snippet: `snippet-${i}`,
          suggestion: `suggestion-${i}`,
        })),
      },
    ],
    verdicts: [],
  };
}

// 将 HTML 转回纯文本用于断言（剥 <p> 标签、还原 &lt; 等）
function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

describe('deAIByReport', () => {
  describe('HTML ↔ text 往返', () => {
    it('无 issue → 输出仍为 <p> 包裹的段落', () => {
      const html = '<p>第一段。</p><p>第二段。</p>';
      const result = deAIByReport(html, makeReport([]));
      expect(result).toBe('<p>第一段。</p><p>第二段。</p>');
    });

    it('"&amp;" 在 HTML→text→HTML 往返中保留为 "&amp;"', () => {
      // textToHtml 会 escape：& → &amp;
      // htmlToText 会 unescape：&amp; → &
      // 单 & 在 HTML 中是非法的，但浏览器容错；这里仅验证 round-trip
      const html = '<p>a &amp; b</p>';
      const result = deAIByReport(html, makeReport([]));
      expect(result).toBe('<p>a &amp; b</p>');
    });

    it('空字符串 → 空字符串', () => {
      const result = deAIByReport('', makeReport([]));
      expect(result).toBe('');
    });

    it('<br> 与 </p><p> 都被还原为换行', () => {
      const html = '<p>第一行</p><p>第二行</p>';
      const result = deAIByReport(html, makeReport([]));
      // 走 htmlToText → textToHtml 往返；多段保留为两个 <p>
      expect(result).toBe('<p>第一行</p><p>第二行</p>');
    });
  });

  describe('transition-abuse（过渡词滥用）', () => {
    it('第 1 处"然而"保留，第 2+ 处替换', () => {
      // 句首触发：正则要求前面是 [。！？\n]
      const html = '<p>第一句。然而，他来了。然而，她又走了。然而，天黑了。</p>';
      const result = deAIByReport(html, makeReport(['transition-abuse']));
      const text = htmlToText(result);
      // 第 1 处保留"然而，"
      expect(text).toContain('然而，他来了');
      // 第 2、3 处不再保留"然而，"原样（被替换或删除）
      // 计数：count=1 保留，count=2 替换为 replacements[2%3]=replacements[2]='可'
      // replacements = ['', '只是', '可']，count=2 → 索引 2 → '可'
      expect(text).not.toMatch(/然而，她又走了/);
      expect(text).not.toMatch(/然而，天黑了/);
    });

    it('不在句首的"然而"不触发替换', () => {
      const html = '<p>他然而来了。</p>';
      const result = deAIByReport(html, makeReport(['transition-abuse']));
      const text = htmlToText(result);
      expect(text).toContain('然而');
    });
  });

  describe('idiom-pileup（成语堆砌）', () => {
    it('"波澜壮阔" → "浪头拍岸"', () => {
      const html = '<p>这景色波澜壮阔，气势磅礴。</p>';
      const result = deAIByReport(html, makeReport(['idiom-pileup']));
      const text = htmlToText(result);
      expect(text).toContain('浪头拍岸');
      expect(text).toContain('气压低得吓人');
      expect(text).not.toContain('波澜壮阔');
      expect(text).not.toContain('气势磅礴');
    });

    it('多个成语同时替换', () => {
      const html = '<p>令人窒息的美轮美奂，叹为观止。</p>';
      const result = deAIByReport(html, makeReport(['idiom-pileup']));
      const text = htmlToText(result);
      expect(text).toContain('喘不上气');
      expect(text).toContain('精致得不像话');
      expect(text).toContain('看得说不出话');
    });
  });

  describe('emotion-telling（情绪直陈）', () => {
    it('"他感到一阵愤怒" → "他的指节捏得发白"', () => {
      const html = '<p>他感到一阵愤怒，转身离去。</p>';
      const result = deAIByReport(html, makeReport(['emotion-telling']));
      const text = htmlToText(result);
      expect(text).toContain('他的指节捏得发白');
      expect(text).not.toContain('他感到一阵愤怒');
    });

    it('"她感到一阵恐惧" → "她的后背一阵发凉"', () => {
      const html = '<p>她感到一阵恐惧。</p>';
      const result = deAIByReport(html, makeReport(['emotion-telling']));
      const text = htmlToText(result);
      expect(text).toContain('她的后背一阵发凉');
    });

    it('"心中涌起愤怒" → "心口一紧"（正则匹配 1-6 字情绪词）', () => {
      const html = '<p>心中涌起怒火。</p>';
      const result = deAIByReport(html, makeReport(['emotion-telling']));
      const text = htmlToText(result);
      expect(text).toContain('心口一紧');
      expect(text).not.toContain('心中涌起');
    });

    it('"一股暖流涌上心头" → "心口一阵发闷"', () => {
      const html = '<p>一股暖流涌上心头。</p>';
      const result = deAIByReport(html, makeReport(['emotion-telling']));
      const text = htmlToText(result);
      expect(text).toContain('心口一阵发闷');
    });
  });

  describe('metaphor-overload（比喻过载）', () => {
    it('第 1 处比喻保留本体，去掉"一般/似的"尾巴', () => {
      // 正则 body 限制 {2,15}，本体需 2+ 字符
      const html = '<p>他如同大山一般高大。</p>';
      const result = deAIByReport(html, makeReport(['metaphor-overload']));
      const text = htmlToText(result);
      // 第 1 处：去掉"一般"，保留"如同大山"
      expect(text).toContain('如同大山');
      expect(text).not.toContain('如同大山一般');
    });

    it('第 2 处起改为直写（去掉"如同...一般"框架）', () => {
      const html = '<p>他如同大山一般高大。她宛如清风一样轻盈。</p>';
      const result = deAIByReport(html, makeReport(['metaphor-overload']));
      const text = htmlToText(result);
      // 第 2 处：去掉"宛如"和"一样"，只保留本体"清风"
      expect(text).toContain('清风');
      expect(text).not.toContain('宛如清风');
      expect(text).not.toContain('清风一样');
    });
  });

  describe('summary-ending（结尾总结）', () => {
    it('"这一刻，他终于明白了一切" 被删除', () => {
      const html = '<p>完了。这一刻，他终于明白了一切，转身离开。</p>';
      const result = deAIByReport(html, makeReport(['summary-ending']));
      const text = htmlToText(result);
      expect(text).not.toContain('这一刻');
      expect(text).not.toContain('终于明白');
      // 总结句删除后清理残留 "。，" → "。"
      expect(text).not.toMatch(/。，/);
    });

    it('"从此以后" 被删除', () => {
      const html = '<p>从此以后，他们过上了幸福的生活。</p>';
      const result = deAIByReport(html, makeReport(['summary-ending']));
      const text = htmlToText(result);
      expect(text).not.toContain('从此以后');
    });

    it('"或许这就是命运" 被删除', () => {
      const html = '<p>或许这就是命运的安排。</p>';
      const result = deAIByReport(html, makeReport(['summary-ending']));
      const text = htmlToText(result);
      expect(text).not.toContain('或许这就是');
    });

    it('删除后残留的孤立逗号被清理', () => {
      // 句首残留逗号场景："，眼泪落下来。"
      // 构造：总结句在段首被删，留下 "，眼泪落下来。"
      const html = '<p>这一刻，他终于明白了一切，眼泪落下来。</p>';
      const result = deAIByReport(html, makeReport(['summary-ending']));
      const text = htmlToText(result);
      // 不应以逗号开头
      expect(text).not.toMatch(/^，/);
      expect(text).not.toMatch(/^、/);
    });
  });

  describe('dialogue-tag-monotony（对话标签单调）', () => {
    it('第 1 处"他说"保留，第 2+ 处替换为动作', () => {
      const html = '<p>"好。"他说。"行。"她说。"算了。"他道。</p>';
      const result = deAIByReport(html, makeReport(['dialogue-tag-monotony']));
      const text = htmlToText(result);
      // 第 1 处保留
      expect(text).toContain('他说');
      // 第 2、3 处应包含动作（从 DIALOGUE_TAG_ACTIONS 取）
      const actions = ['把茶盏一放', '别开脸', '低头抿了口茶', '指尖敲了敲桌面', '抬眼看他', '转过身去', '拢了拢衣袖'];
      const replacedCount = actions.filter(a => text.includes(a)).length;
      expect(replacedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('repeated-structure（句首雷同）', () => {
    it('连续 3 句以"他走"开头 → 第 3 句加前缀打破雷同', () => {
      // 句首 4 字符相同，consecutive >= 2 时加前缀
      const html = '<p>他走在路上。他走在路上。他走在路上。</p>';
      const result = deAIByReport(html, makeReport(['repeated-structure']));
      const text = htmlToText(result);
      // 第 3 句应被加上前缀（'其时，' / '却说' / '那' / '偏生' / '恰在此时，'）
      const prefixes = ['其时，', '却说', '那', '偏生', '恰在此时，'];
      const hasPrefix = prefixes.some(p => text.includes(p));
      expect(hasPrefix).toBe(true);
    });

    it('不连续的句首不触发', () => {
      const html = '<p>他走过来。她跑过去。他停下来。</p>';
      const result = deAIByReport(html, makeReport(['repeated-structure']));
      const text = htmlToText(result);
      // 仅 2 句以"他走/他停"开头，但前 4 字符"他走"/"她跑"/"他停"各不同
      // 不应触发前缀
      const prefixes = ['其时，', '却说', '那', '偏生', '恰在此时，'];
      const hasPrefix = prefixes.some(p => text.includes(p));
      expect(hasPrefix).toBe(false);
    });
  });

  describe('list-structure（列举式结构）', () => {
    it('"第一、第二、第三、" 被删除', () => {
      const html = '<p>第一、准备工作。第二、开始行动。第三、收尾。</p>';
      const result = deAIByReport(html, makeReport(['list-structure']));
      const text = htmlToText(result);
      expect(text).not.toContain('第一、');
      expect(text).not.toContain('第二、');
      expect(text).not.toContain('第三、');
    });

    it('"首先/其次/最后" 被替换', () => {
      const html = '<p>首先，准备。其次，行动。最后，收尾。</p>';
      const result = deAIByReport(html, makeReport(['list-structure']));
      const text = htmlToText(result);
      expect(text).not.toContain('首先');
      expect(text).not.toContain('其次');
      // "最后" → "到头来，"
      expect(text).toContain('到头来，');
      expect(text).toContain('再说，');
    });
  });

  describe('多类型组合', () => {
    it('多个 issue 类型同时存在 → 全部修正器依次执行', () => {
      // 同时包含成语堆砌 + 情绪直陈 + 列举
      const html = '<p>第一、他感到一阵愤怒。第二、波澜壮阔。</p>';
      const result = deAIByReport(html, makeReport(['idiom-pileup', 'emotion-telling', 'list-structure']));
      const text = htmlToText(result);
      expect(text).not.toContain('第一、');
      expect(text).not.toContain('第二、');
      expect(text).toContain('他的指节捏得发白');
      expect(text).toContain('浪头拍岸');
    });
  });
});
