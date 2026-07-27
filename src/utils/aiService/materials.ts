import type { Chapter, Character, Foreshadow, Material, MaterialQuestion, CausalImpactReport, CausalImpactItem } from '@/types';
import { parseJsonFromLLM, getLLMClient } from './core';

/**
 * 卡片促活：对素材卡片深度提问，返回 3-5 个追问。
 * 创作者的回答会生成子卡片，主卡/子卡在素材库形成树状关联。
 */
export async function askMaterialQuestion(
  material: Material,
): Promise<MaterialQuestion[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const plainContent = material.content.replace(/<[^>]*>/g, '').slice(0, 300);

  if (settings.provider !== 'mock') {
    try {
      const prompt = `请对这张灵感卡片提出 4 个深度追问，帮创作者把单薄的点子磨出细节。

卡片标题：${material.title}
卡片类型：${material.type}
卡片内容：${plainContent || '（无）'}

每个问题包含：
{
  "dimension": "维度标签（如：秘密/创伤/伪装/动机/关系/能力边界）",
  "question": "具体问题（20-50字，要具体、可回答）"
}

只返回 JSON 数组（4 项）。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说创作教练，擅长用追问激发创作者。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const questions = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            dimension: String(r.dimension || '深化').slice(0, 20),
            question: String(r.question || '').slice(0, 200),
          }))
          .filter(q => q.question);
        if (questions.length > 0) return questions.slice(0, 5);
      }
    } catch (e) {
      console.warn('AI askMaterialQuestion failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(400);
  // Mock：基于卡片类型生成可读追问
  const typeQuestions: Record<Material['type'], MaterialQuestion[]> = {
    inspiration: [
      { dimension: '核心冲突', question: '这个灵感里，主角最想得到什么？最怕失去什么？' },
      { dimension: '对立面', question: '谁/什么力量会阻碍主角得到它？阻力来自内部还是外部？' },
      { dimension: '转折点', question: '故事的中点会发生什么意外，让主角无法回头？' },
      { dimension: '主题落点', question: '这个故事最终想传达什么？主角的成长落点在哪里？' },
    ],
    reference: [
      { dimension: '引用场景', question: '这条参考资料最可能出现在哪个场景？谁会引用它？' },
      { dimension: '隐含信息', question: '它背后藏着什么未明说的信息？主角如何获得？' },
    ],
    research: [
      { dimension: '应用边界', question: '这条研究笔记如何转化为情节？哪些细节可用？' },
      { dimension: '风险点', question: '若读者查证，会不会发现硬伤？需要补充哪些资料？' },
    ],
    quote: [
      { dimension: '场景归属', question: '这句话最适合作谁的台词？在什么情境下说出？' },
      { dimension: '潜台词', question: '说这句话时，角色真正想隐藏什么？' },
    ],
    image: [
      { dimension: '视觉锚点', question: '这张图最打动你的是哪个细节？如何写进文字？' },
      { dimension: '场景化', question: '它对应故事里的哪个场景？谁在场？' },
    ],
    audio: [
      { dimension: '情绪基调', question: '这段声音传达的情绪是什么？放在哪一章最合适？' },
    ],
  };
  return typeQuestions[material.type] || typeQuestions.inspiration;
}

/**
 * 因果推演预览：假设性地改动某个节点，推演对全大纲的连锁影响。
 * 不真正修改大纲，只返回《变动影响报告》，让作者评估代价后再决定是否执行。
 */
export async function previewCausalImpact(
  changeDescription: string,
  targetId: string,
  chapters: Chapter[],
  characters: Character[] = [],
  foreshadows: Foreshadow[] = [],
): Promise<CausalImpactReport> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const topChapters = chapters.filter(c => c.levelType === 'chapter');

  if (settings.provider !== 'mock') {
    try {
      const chapterDigest = topChapters.slice(0, 20).map((c, i) => `第${i + 1}章「${c.title}」: ${(c.summary || '').slice(0, 80)}`).join('\n');
      const charDigest = characters.slice(0, 5).map(c => `- ${c.name}（${c.role}）`).join('\n');
      const foreshadowDigest = foreshadows.slice(0, 10).map(f => `- 《${f.title}》：${f.status}`).join('\n');

      const prompt = `请推演以下假设性改动对全大纲的连锁影响，生成《变动影响报告》。

假设改动：${changeDescription}

【大纲章节】
${chapterDigest || '（无）'}

【角色】
${charDigest || '（无）'}

【伏笔】
${foreshadowDigest || '（无）'}

返回 JSON：
{
  "overallRisk": "high|medium|low",
  "impacts": [
    {
      "type": "broken|weakened|missing",
      "chapterId": "受影响章节ID（若有）",
      "description": "影响描述（30-80字）",
      "alternative": "替代方案建议（30-80字）"
    }
  ]
}

type 含义：
- broken：直接断裂的情节
- weakened：弱化的人物动机/伏笔
- missing：缺失的关键铺垫

只返回 JSON。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长推演大纲改动的连锁影响。只返回 JSON。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (parsed && typeof parsed === 'object') {
        const r = parsed as Record<string, unknown>;
        const validRisk = ['high', 'medium', 'low'];
        const validTypes: CausalImpactItem['type'][] = ['broken', 'weakened', 'missing'];
        const impacts: CausalImpactItem[] = Array.isArray(r.impacts)
          ? (r.impacts as unknown[])
              .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
              .map(x => {
                const cid = x.chapterId ? String(x.chapterId) : undefined;
                const ch = cid ? topChapters.find(c => c.id === cid) : undefined;
                return {
                  type: String(x.type) as CausalImpactItem['type'],
                  chapterId: ch?.id,
                  chapterTitle: ch?.title,
                  description: String(x.description || '').slice(0, 300),
                  alternative: String(x.alternative || '').slice(0, 300),
                };
              })
              .filter(i => validTypes.includes(i.type) && i.description)
          : [];
        return {
          changeDescription,
          targetId,
          impacts,
          overallRisk: validRisk.includes(String(r.overallRisk)) ? String(r.overallRisk) as 'high' | 'medium' | 'low' : 'medium',
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (e) {
      console.warn('AI previewCausalImpact failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于改动描述关键词生成可读影响项
  const lower = changeDescription.toLowerCase();
  const impacts: CausalImpactItem[] = [];
  if (lower.includes('死') || lower.includes('删除') || lower.includes('移除')) {
    impacts.push({
      type: 'broken',
      description: '该角色/节点后续的关键作用将失去来源，相关情节断裂',
      alternative: '可补充一个替代载体（笔记/遗物/接班人）承接其功能',
    });
    impacts.push({
      type: 'weakened',
      description: '与该节点相关的人物动机/伏笔失去支撑，合理性下降',
      alternative: '将这部分功能转移到另一角色或新设定上',
    });
  } else if (lower.includes('提前') || lower.includes('延后')) {
    impacts.push({
      type: 'broken',
      description: '原定时间线被打乱，前后章节的因果衔接出现错位',
      alternative: '重新调整相关章节顺序，并补足过渡桥段',
    });
  } else {
    impacts.push({
      type: 'weakened',
      description: '该改动可能影响相关伏笔的回收节奏与角色动机的连贯性',
      alternative: '同步检查关联伏笔与角色弧光，必要时补充铺垫',
    });
  }
  return {
    changeDescription,
    targetId,
    impacts,
    overallRisk: impacts.some(i => i.type === 'broken') ? 'high' : 'medium',
    generatedAt: new Date().toISOString(),
  };
}
