import type { Chapter, Character, Foreshadow, OutlineIssue, OutlinePolishDimension, OutlineExpansionOption, ChapterBeat, Material, StructureVariant, ConflictLayer, ReaderEmpathyReport, ReaderEmpathyPoint, ReaderEmpathyIssue } from '@/types';
import { parseJsonFromLLM, getLLMClient } from './core';

// ==================== 大纲打磨能力域 ====================

/**
 * 大纲多维度打磨：调用 LLM 输出结构化 JSON 诊断，覆盖六大维度。
 * Mock 模式下基于本地启发式规则生成可读诊断，避免空报告误导用户。
 *
 * 输出维度（OutlinePolishDimension）：
 *   theme / structure / character / logic / pacing / foreshadow
 *
 * 每条 issue 包含 dimension / severity / chapterId / description / suggestion，
 * 调用方据此渲染分类报告并支持跳转到对应章节。
 */
export async function polishOutline(
  chapters: Chapter[],
  characters: Character[] = [],
  foreshadows: Foreshadow[] = [],
): Promise<OutlineIssue[]> {
  const topChapters = chapters.filter(c => c.levelType === 'chapter');
  if (topChapters.length === 0) return [];

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const chapterDigest = topChapters.map((c, i) => {
        const plain = (c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 200);
        return `第${i + 1}章「${c.title}」: ${plain}`;
      }).join('\n');
      const charDigest = characters.slice(0, 8).map(c => `- ${c.name}（${c.role}）：${c.profile?.personality || ''}｜目标：${c.profile?.goal || '未指定'}`).join('\n');
      const foreshadowDigest = foreshadows.slice(0, 15).map(f => `- 《${f.title}》：${f.status}｜埋设：${f.plantedChapterId ? '已指定' : '未指定'}｜回收：${f.payoffChapterId ? '已指定' : '未指定'}`).join('\n');

      const prompt = `请对下面这份小说大纲执行多维度打磨诊断，返回 JSON 数组。

诊断维度（dimension 字段取值）：
- theme：主题锚定——是否偏离核心主题、是否有无效旁支
- structure：结构递进——层级因果是否衔接、是否有断层/重复/跳步
- character：人物一致性——行为是否符合设定、弧光是否有突兀转变
- logic：叙事逻辑——前置条件是否充足、连锁影响是否完整、对手是否降智
- pacing：节奏——高潮分布是否失衡、信息密度是否过载、是否有冗余
- foreshadow：伏笔闭环——是否有遗留未回收、埋设是否过于直白/隐晦

每条问题包含：
{
  "dimension": "theme|structure|character|logic|pacing|foreshadow",
  "severity": "error|warning|info",
  "chapterId": "对应章节ID，全局问题留空字符串",
  "description": "问题简述（不超过60字）",
  "suggestion": "可落地建议（不超过80字）"
}

只返回 JSON 数组，不要任何额外说明。若无问题返回 []。

【大纲章节】
${chapterDigest}

【角色库】
${charDigest || '（未提供角色设定）'}

【伏笔库】
${foreshadowDigest || '（未提供伏笔）'}
`;

      const result = await llmClient.callLLM(prompt, '你是一位资深小说结构编辑，擅长多维度诊断大纲硬伤。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const issues: OutlineIssue[] = [];
        parsed.forEach((raw, idx) => {
          if (!raw || typeof raw !== 'object') return;
          const r = raw as Record<string, unknown>;
          const dimension = String(r.dimension || 'structure') as OutlinePolishDimension;
          const validDims: OutlinePolishDimension[] = ['theme', 'structure', 'character', 'logic', 'pacing', 'foreshadow', 'style'];
          const severity = String(r.severity || 'info') as OutlineIssue['severity'];
          const validSev: OutlineIssue['severity'][] = ['error', 'warning', 'info'];
          const chapterId = r.chapterId ? String(r.chapterId) : undefined;
          const chapter = chapterId ? topChapters.find(c => c.id === chapterId) : undefined;
          issues.push({
            id: `ai-issue-${Date.now()}-${idx}`,
            dimension: validDims.includes(dimension) ? dimension : 'structure',
            severity: validSev.includes(severity) ? severity : 'info',
            chapterId: chapter?.id,
            chapterTitle: chapter?.title,
            description: String(r.description || '').slice(0, 200),
            suggestion: String(r.suggestion || '').slice(0, 300),
          });
        });
        return issues;
      }
    } catch (e) {
      console.warn('AI polishOutline failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(600);
  // Mock：基于本地启发式规则生成可读诊断，避免空报告误导用户
  return generateHeuristicOutlineIssues(topChapters, characters, foreshadows);
}

/**
 * 启发式规则：Mock 模式下基于章节字数、标题、角色出场、伏笔状态生成诊断。
 * 不调用 LLM，纯本地计算，保证离线/未配置 API 时仍可用。
 */
function generateHeuristicOutlineIssues(
  chapters: Chapter[],
  characters: Character[],
  foreshadows: Foreshadow[],
): OutlineIssue[] {
  const issues: OutlineIssue[] = [];
  const now = Date.now();

  // 1. 节奏：连续多章字数过低 → 节奏偏缓
  for (let i = 0; i < chapters.length - 2; i++) {
    const window = chapters.slice(i, i + 3);
    if (window.every(c => c.wordCount < 500)) {
      issues.push({
        id: `heu-pacing-slow-${now}-${i}`,
        dimension: 'pacing',
        severity: 'warning',
        chapterId: window[0].id,
        chapterTitle: window[0].title,
        description: `${window[0].title} 起连续 3 章字数偏低（均<500），节奏可能偏缓`,
        suggestion: '考虑压缩过渡情节，或合并部分章节，前置一个冲突钩子提升张力',
      });
    }
  }

  // 2. 节奏：单章字数远超均值 → 信息密度可能过载
  const avgWords = chapters.reduce((s, c) => s + c.wordCount, 0) / Math.max(1, chapters.length);
  for (const c of chapters) {
    if (c.wordCount > avgWords * 2.5 && c.wordCount > 3000) {
      issues.push({
        id: `heu-pacing-dense-${now}-${c.id}`,
        dimension: 'pacing',
        severity: 'info',
        chapterId: c.id,
        chapterTitle: c.title,
        description: `${c.title} 字数（${c.wordCount}）显著高于均值（${Math.round(avgWords)}），信息密度可能过载`,
        suggestion: '考虑拆分为两章，或将背景设定信息分散到对话与动作中自然带出',
      });
    }
  }

  // 3. 结构：连续多章无 summary → 大纲骨架不完整
  const noSummaryChapters = chapters.filter(c => !c.summary || c.summary.trim().length < 10);
  if (noSummaryChapters.length >= 3) {
    issues.push({
      id: `heu-structure-nosummary-${now}`,
      dimension: 'structure',
      severity: 'warning',
      description: `${noSummaryChapters.length} 个章节缺少摘要或摘要过短，大纲骨架不完整`,
      suggestion: '为每个章节补充 50-100 字摘要，明确核心目标与功能定位，便于全局审视',
    });
  }

  // 4. 伏笔：未规划回收路径的遗留伏笔
  const orphanForeshadows = foreshadows.filter(f =>
    f.status !== 'abandoned' && f.status !== 'paid-off' && !f.payoffChapterId
  );
  if (orphanForeshadows.length > 0) {
    issues.push({
      id: `heu-foreshadow-orphan-${now}`,
      dimension: 'foreshadow',
      severity: 'warning',
      description: `${orphanForeshadows.length} 条伏笔未规划回收章节，存在烂尾风险`,
      suggestion: `为《${orphanForeshadows[0].title}》等伏笔指定回收章节，或在后续大纲中明确推进路径`,
    });
  }

  // 5. 伏笔：长期未提及
  const staleForeshadows = foreshadows.filter(f => f.chaptersSinceMention >= 8 && f.status !== 'paid-off' && f.status !== 'abandoned');
  if (staleForeshadows.length > 0) {
    issues.push({
      id: `heu-foreshadow-stale-${now}`,
      dimension: 'foreshadow',
      severity: 'info',
      description: `${staleForeshadows.length} 条伏笔已 ${staleForeshadows[0].chaptersSinceMention}+ 章未提及，读者可能遗忘`,
      suggestion: '在近期章节中安排一次隐性提及，或在角色对话中自然带出，维持读者记忆',
    });
  }

  // 6. 角色：主角连续未出场
  const protagonists = characters.filter(c => c.role === 'protagonist');
  for (const p of protagonists) {
    const appearanceChapters = chapters.filter(c =>
      c.characterFocus?.includes(p.id) || c.content.includes(p.name)
    );
    if (appearanceChapters.length === 0) {
      issues.push({
        id: `heu-character-absent-${now}-${p.id}`,
        dimension: 'character',
        severity: 'warning',
        description: `主角「${p.name}」在所有章节中均未标注出场，可能存在视角缺失`,
        suggestion: `在关键章节的「人物聚焦」中标注 ${p.name}，确保主角弧光完整`,
      });
      break; // 只提示第一个未出场主角，避免噪声
    }
  }

  // 7. 结构：标题雷同（如多个"第X章"无副标题）
  const placeholderTitles = chapters.filter(c => /^第[一二三四五六七八九十百零\d]+章$/.test(c.title.trim()));
  if (placeholderTitles.length >= 3) {
    issues.push({
      id: `heu-structure-title-${now}`,
      dimension: 'structure',
      severity: 'info',
      description: `${placeholderTitles.length} 个章节标题仅为「第X章」无副标题，辨识度低`,
      suggestion: '为每章添加 4-8 字副标题，体现核心冲突或意象，便于读者与作者快速定位',
    });
  }

  // 8. 逻辑：相邻章节字数骤变（可能存在衔接断层）
  for (let i = 1; i < chapters.length; i++) {
    const prev = chapters[i - 1];
    const curr = chapters[i];
    if (prev.wordCount > 2000 && curr.wordCount < 200 && curr.wordCount > 0) {
      issues.push({
        id: `heu-logic-gap-${now}-${curr.id}`,
        dimension: 'logic',
        severity: 'warning',
        chapterId: curr.id,
        chapterTitle: curr.title,
        description: `${curr.title} 字数骤降至 ${curr.wordCount}，与前一章衔接可能存在断层`,
        suggestion: '检查前后章节的场景转换与时间衔接，必要时增加过渡段落或合并章节',
      });
      break; // 只提示第一个，避免噪声
    }
  }

  return issues;
}

/**
 * 情节扩展器：为单薄的大纲节点生成多个富有张力的发展方案。
 * 选中"主角遇险""二人决裂"等过于简略的条目，AI 基于上下文与角色设定提供 3 个扩展方案。
 */
export async function expandOutlineNode(
  chapter: Chapter,
  characters: Character[] = [],
  subsequentChapters: Chapter[] = [],
): Promise<OutlineExpansionOption[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const plainSummary = (chapter.summary || chapter.content.replace(/<[^>]*>/g, '')).slice(0, 500);

  if (settings.provider !== 'mock') {
    try {
      const charContext = characters.slice(0, 5).map(c => `${c.name}（${c.role}）：${c.profile?.personality || ''}｜目标：${c.profile?.goal || '未指定'}`).join('\n');
      const subseqContext = subsequentChapters.slice(0, 5).map(c => `第${c.order}章《${c.title}》：${(c.summary || '').slice(0, 40)}`).join('\n');
      const prompt = `请为下面这个过于单薄的大纲节点生成 3 个富有张力的发展方案。

要求：
- 每个方案包含 title（4-10字标题）、content（50-100字描述）、dramaticTension（该方案引入的冲突/张力点，20-40字）
- 每个方案必须包含 chainImpacts（字符串数组，2-3 条）：明确标注该方案对后续章节/人物/伏笔的连锁影响
- 若该方案需要后续某些章节增加铺垫，在 affectedChapterIds 中给出后续章节的 order（数字）
- 方案之间风格差异明显（如：意外介入/情感冲突/外部环境）
- 必须基于上下文与角色设定，不得引入未设定的角色或世界观元素
- 用 JSON 数组返回，格式：[{"title":"","content":"","dramaticTension":"","chainImpacts":["",""],"affectedChapterIds":[1,2]}]

只返回 JSON 数组，不要其他内容。

【大纲节点】
标题：${chapter.title}
摘要：${plainSummary || '（无摘要）'}

【相关角色】
${charContext || '（未指定角色）'}

【后续章节】
${subseqContext || '（暂无后续章节）'}
`;
      const result = await llmClient.callLLM(prompt, '你是一位资深小说结构编辑，擅长扩展单薄大纲节点为富有张力的情节，并标注连锁影响。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const orderToId = new Map(subsequentChapters.map(c => [c.order, c.id]));
        const options: OutlineExpansionOption[] = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => {
            const rawOrderIds = Array.isArray(r.affectedChapterIds) ? r.affectedChapterIds : [];
            const affectedChapterIds = rawOrderIds
              .map(n => typeof n === 'number' ? orderToId.get(n) : (typeof n === 'string' ? n : undefined))
              .filter((id): id is string => !!id);
            const chainImpacts = Array.isArray(r.chainImpacts)
              ? r.chainImpacts.map(s => String(s).slice(0, 100)).filter(Boolean)
              : [];
            return {
              title: String(r.title || '').slice(0, 30),
              content: String(r.content || '').slice(0, 200),
              dramaticTension: String(r.dramaticTension || '').slice(0, 100),
              chainImpacts: chainImpacts.length > 0 ? chainImpacts : undefined,
              affectedChapterIds: affectedChapterIds.length > 0 ? affectedChapterIds : undefined,
            };
          })
          .filter(o => o.title && o.content);
        if (options.length > 0) return options.slice(0, 3);
      }
    } catch (e) {
      console.warn('AI expandOutlineNode failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于章节标题关键词生成可读方案
  return generateMockExpansionOptions(chapter, plainSummary, subsequentChapters);
}

function generateMockExpansionOptions(chapter: Chapter, plainSummary: string, subsequentChapters: Chapter[] = []): OutlineExpansionOption[] {
  const title = chapter.title;
  const has = (kw: string) => title.includes(kw) || plainSummary.includes(kw);
  // 后续章节连锁影响（启发式：取后续 2 章 ID 作为受影响章节）
  const nextTwo = subsequentChapters.slice(0, 2);
  const affectedChapterIds = nextTwo.length > 0 ? nextTwo.map(c => c.id) : undefined;
  const chainImpacts = nextTwo.length > 0
    ? [`后续《${nextTwo.map(c => c.title).join('》《')}》需相应铺垫`, '主角动机可能需同步调整']
    : undefined;
  // 注入连锁影响到每个选项
  const withChain = (opts: OutlineExpansionOption[]): OutlineExpansionOption[] =>
    opts.map(o => ({ ...o, chainImpacts, affectedChapterIds }));

  if (has('遇险') || has('危险') || has('被困')) {
    return withChain([
      { title: '意外卷入阴谋', content: '主角在脱困过程中意外发现更大的阴谋，被迫卷入漩涡，必须依靠智慧与盟友破局。', dramaticTension: '从被动脱困到主动揭开真相，主角立场反转' },
      { title: '隐藏技能暴露', content: '绝境中主角被迫使用一直隐藏的特殊能力，引起多方势力注意，平静生活被打破。', dramaticTension: '秘密外泄引发新的追捕与拉拢' },
      { title: '陌生援手', content: '一位身份不明的陌生人出手相助，但提出的代价让主角陷入两难抉择。', dramaticTension: '信任与代价的博弈，引出新角色' },
    ]);
  }
  if (has('决裂') || has('冲突') || has('争吵')) {
    return withChain([
      { title: '隐瞒信件曝光', content: '一方发现对方长期隐瞒的关键信件，信任彻底崩塌，决裂背后藏着更深的隐情。', dramaticTension: '从情绪冲突升级为信任危机' },
      { title: '第三方介入', content: '局外人有意无意地点破双方各自隐瞒的事实，决裂演变成三方对峙。', dramaticTension: '引入新视角，重构冲突格局' },
      { title: '共同敌人逼和', content: '决裂之际共同威胁出现，两人被迫暂时联手，但裂痕已深，合作中暗藏试探。', dramaticTension: '敌我关系模糊，张力持续' },
    ]);
  }
  // 通用扩展
  return withChain([
    { title: '意外转折', content: '在原有情节走向中加入一个意外事件，打破主角预期，迫使其重新评估局势。', dramaticTension: '预期落空，主角陷入被动' },
    { title: '角色秘密浮现', content: '某个看似次要的角色在此节点暴露出关键秘密，重塑前期情节的意义。', dramaticTension: '信息倒错，前文铺垫激活' },
    { title: '环境压力升级', content: '外部环境（天气/地理/社会）骤变，给原本就紧张的局面叠加不可控因素。', dramaticTension: '人与环境的双重博弈' },
  ]);
}

// ============================================================================
// 灵感孵化 / 骨架生成 / 章节节拍 / 因果推演 能力域
// ============================================================================

/**
 * 生成章节节拍：基于章节标题、摘要、角色设定，输出 5 大节拍内容。
 * 用于"章节节拍编辑器"——把一句话梗概磨成完整章法。
 */
export async function generateChapterBeats(
  chapter: Chapter,
  characters: Character[] = [],
): Promise<ChapterBeat[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const plainSummary = (chapter.summary || chapter.content.replace(/<[^>]*>/g, '')).slice(0, 400);

  if (settings.provider !== 'mock') {
    try {
      const charDigest = characters.slice(0, 5).map(c => `${c.name}（${c.role}）`).join('、');
      const prompt = `请为本章生成5个核心节拍，每个节拍是一段具体描写。

章节标题：${chapter.title}
章节摘要：${plainSummary || '（无）'}
出场角色：${charDigest || '（未指定）'}

5 个节拍类型固定为：
1. hook（开章钩子）：第一秒抓住读者的事件
2. progress（推进节拍）：本章核心信息/动作如何铺陈
3. midpoint（中间转折）：halfway point 出现什么意外
4. escalation（加码节拍）：矛盾如何升级，把主角逼到角落
5. cliffhanger（章末悬念）：结尾留什么钩子

返回 JSON 数组，每项形如：
{"type":"hook","content":"具体内容，30-80字"}

只返回 JSON 数组，不要任何额外说明。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长拆解章节节拍。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const validTypes: ChapterBeat['type'][] = ['hook', 'progress', 'midpoint', 'escalation', 'cliffhanger'];
        const beats: ChapterBeat[] = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            type: String(r.type) as ChapterBeat['type'],
            content: String(r.content || '').slice(0, 300),
          }))
          .filter(b => validTypes.includes(b.type) && b.content);
        if (beats.length > 0) return beats.slice(0, 5);
      }
    } catch (e) {
      console.warn('AI generateChapterBeats failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于章节内容关键词生成可读节拍
  return [
    { type: 'hook', content: `开篇以一个反常细节引入：${chapter.title}的某个不寻常景象，立刻勾起读者疑问。` },
    { type: 'progress', content: `通过主角的视角与对话，逐步铺陈本章核心信息，让读者跟随主角进入情境。` },
    { type: 'midpoint', content: `中段抛出一个意外：原本看似平静的局面被一通电话/一个访客/一封信打破，主角被迫重新评估。` },
    { type: 'escalation', content: `矛盾迅速升级，主角陷入两难——继续隐瞒还是坦白？每个选择都伴随代价。` },
    { type: 'cliffhanger', content: `章末留下一个关键悬念：一个未被解答的问题或一个未完成的动作，让读者迫不及待翻向下一章。` },
  ];
}

/**
 * 生成 3 种叙事结构变体：经典线性 / 双线交织 / 多视角罗生门。
 * 用于骨架生成阶段的"结构变体预览"。
 */
export async function generateStructureVariants(
  projectName: string,
  projectDesc: string,
  materials: Material[] = [],
): Promise<StructureVariant[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const matDigest = materials.slice(0, 10).map(m => `- 《${m.title}》(${m.type}): ${m.content.slice(0, 80)}`).join('\n');
      const prompt = `请为这部作品生成3种不同的叙事结构变体，让作者选择最合适的骨架。

作品名：${projectName}
作品描述：${projectDesc || '（无）'}
相关素材：
${matDigest || '（无）'}

返回 JSON 数组，每项形如：
{
  "name": "结构名称",
  "description": "结构描述（50-100字）",
  "pros": "核心优势（30-60字）",
  "cons": "潜在风险（30-60字）",
  "fitScenarios": "适配场景（30-60字）",
  "suggestedHierarchy": ["卷", "章"],
  "tensionCurve": [20, 35, 40, 55, 70, 85, 95]
}

tensionCurve 字段：8 个采样点（0-100），表示该结构在 8 等分进度上的张力分布。
- 经典线性：单调上升，结尾最高
- 双线交织：中段（第4-5点）有一个明显高峰（双线汇合）
- 多视角罗生门：阶梯式上升，每两个点之间有一个跃升

三种结构应分别对应：经典线性、双线/多线交织、多视角罗生门。
只返回 JSON 数组。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长为作品搭骨架。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const variants = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r, idx) => {
            const name = String(r.name || '').slice(0, 30);
            // AI 未返回 tensionCurve 时，按结构名启发式补一条默认曲线
            const fallbackCurve = inferTensionCurveByName(name, idx);
            const rawCurve = Array.isArray(r.tensionCurve) ? r.tensionCurve : [];
            const tensionCurve = rawCurve
              .map(n => typeof n === 'number' ? Math.min(100, Math.max(0, Math.round(n))) : undefined)
              .filter((n): n is number => typeof n === 'number')
              .slice(0, 8);
            return {
              id: `variant-${Date.now()}-${idx}`,
              name,
              description: String(r.description || '').slice(0, 200),
              pros: String(r.pros || '').slice(0, 120),
              cons: String(r.cons || '').slice(0, 120),
              fitScenarios: String(r.fitScenarios || '').slice(0, 120),
              suggestedHierarchy: Array.isArray(r.suggestedHierarchy)
                ? (r.suggestedHierarchy as unknown[]).map(s => String(s)).slice(0, 4)
                : ['卷', '章'],
              tensionCurve: tensionCurve.length >= 4 ? tensionCurve : fallbackCurve,
            };
          })
          .filter(v => v.name && v.description);
        if (variants.length > 0) return variants.slice(0, 3);
      }
    } catch (e) {
      console.warn('AI generateStructureVariants failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  return [
    {
      id: `variant-${Date.now()}-1`,
      name: '经典线性',
      description: '从故事起点按时间顺序推进，主角弧光清晰可见，读者跟随主角视角一路成长。',
      pros: '结构稳定，读者代入感强，适合新人作者上手',
      cons: '若前期铺陈过长易显平淡，缺乏视角变换的张力',
      fitScenarios: '成长向、传记向、单线叙事的长篇',
      suggestedHierarchy: ['卷', '章'],
      tensionCurve: inferTensionCurveByName('经典线性', 0),
    },
    {
      id: `variant-${Date.now()}-2`,
      name: '双线交织',
      description: '当下与过往两条时间线并行推进，在中点汇合揭示关键真相，制造悬念与对照。',
      pros: '悬念感强，过去与现在互文，结构有层次',
      cons: '双线节奏把控要求高，易出现主线模糊',
      fitScenarios: '悬疑、复仇、家族史诗类作品',
      suggestedHierarchy: ['卷', '章'],
      tensionCurve: inferTensionCurveByName('双线交织', 1),
    },
    {
      id: `variant-${Date.now()}-3`,
      name: '多视角罗生门',
      description: '每卷换一个核心视角，同一事件被不同人物叙述，逐步拼凑出真相全貌。',
      pros: '信息层次丰富，人物立体，揭示真相极具张力',
      cons: '视角切换需要明确动机，读者代入门槛较高',
      fitScenarios: '群像、悬疑、争议事件题材',
      suggestedHierarchy: ['卷', '章'],
      tensionCurve: inferTensionCurveByName('多视角罗生门', 2),
    },
  ];
}

/**
 * 按结构名/索引推断张力曲线（8 采样点，0-100）。
 * 规格书阶段2-1：三套变体要在时间轴上对比节奏差异。
 *   - 线性：单调上升，结尾最高
 *   - 双线：中段第4-5点高峰（双线汇合揭示真相）
 *   - 罗生门：阶梯式攀升，每两段一跃升
 */
function inferTensionCurveByName(name: string, idx: number): number[] {
  const n = name.toLowerCase();
  if (n.includes('双线') || n.includes('交织') || idx === 1) {
    // 双线交织：低开 → 中段高峰（双线汇合） → 略回落 → 终章高潮
    return [25, 40, 55, 80, 90, 70, 75, 95];
  }
  if (n.includes('罗生门') || n.includes('多视角') || idx === 2) {
    // 多视角：阶梯式上升，每两段一跃升
    return [20, 25, 45, 50, 70, 75, 90, 95];
  }
  // 默认/经典线性：单调上升，结尾最高
  return [15, 25, 35, 45, 55, 70, 82, 95];
}

/**
 * 生成冲突罗盘：基于核心驱动派生 4 层冲突（内层/人际/阵营/社会）。
 */
export async function generateConflictCompass(
  coreDriver: string,
  characters: Character[] = [],
): Promise<ConflictLayer[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const charDigest = characters.slice(0, 5).map(c => `- ${c.name}（${c.role}）：${c.profile?.personality || ''}`).join('\n');
      const prompt = `基于以下核心驱动，生成 4 层冲突罗盘。

核心驱动：${coreDriver}

角色库：
${charDigest || '（未指定）'}

4 层冲突固定为：
- inner（内层）：主角的内心冲突
- interpersonal（人际层）：与亲密者的冲突
- faction（阵营层）：与对手的立场冲突
- social（社会层）：与时代规则的冲突

每层冲突包含：
{
  "layer": "inner|interpersonal|faction|social",
  "description": "冲突描述（30-80字，含对立双方）",
  "seeds": ["情节种子1", "情节种子2", "情节种子3"]
}

只返回 JSON 数组（4 项）。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长构建立体冲突体系。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const validLayers: ConflictLayer['layer'][] = ['inner', 'interpersonal', 'faction', 'social'];
        const layers = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            layer: String(r.layer) as ConflictLayer['layer'],
            description: String(r.description || '').slice(0, 200),
            seeds: Array.isArray(r.seeds)
              ? (r.seeds as unknown[]).map(s => String(s).slice(0, 100)).slice(0, 3)
              : [],
          }))
          .filter(l => validLayers.includes(l.layer) && l.description);
        if (layers.length > 0) return layers.slice(0, 4);
      }
    } catch (e) {
      console.warn('AI generateConflictCompass failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  return [
    {
      layer: 'inner',
      description: '旧日创伤与当下责任的拉扯：主角想逃离过去，但眼前的人与事逼他直面',
      seeds: [
        '某个旧物触发了主角的创伤回忆',
        '主角在关键时刻选择逃避，事后陷入自责',
        '一次意外让主角被迫重新审视过去',
      ],
    },
    {
      layer: 'interpersonal',
      description: '与亲密者的信任危机：隐瞒的过去被身边人察觉，关系面临崩塌',
      seeds: [
        '亲密者无意中发现主角的谎言',
        '一次坦白换来对方的疏远',
        '共同危机让双方暂时放下嫌隙',
      ],
    },
    {
      layer: 'faction',
      description: '与对手的立场冲突：双方各有道理，非黑非白，博弈持续升级',
      seeds: [
        '主角与对手第一次正面交锋',
        '对手亮出底牌，主角陷入被动',
        '双方被迫短暂联手对抗共同威胁',
      ],
    },
    {
      layer: 'social',
      description: '与时代规则的对抗：主角信奉的旧规则在当下寸步难行',
      seeds: [
        '主角因坚守原则付出代价',
        '一次规则冲突让主角重新思考立场',
        '主角找到在新规则下保留底线的方式',
      ],
    },
  ];
}

// ============================================================================
// 灵感卡深度激活 / 智能连线 / 人物弧光校验 / 关系温度 / 节奏压力测试 能力域
// ============================================================================

import type { InspirationCard, MaterialQuestion, CharacterArcIssue, RelationshipTemperatureCurve, PacingPressureReport, PacingPressurePoint, PacingIssue, CharacterArcCurve, CharacterArcCurvePoint, CharacterEmotionConsistencyReport, PacingAdjustmentAdvice } from '@/types';

/**
 * 灵感卡深度提问：针对不同卡片类型（character/concept/scene/dialogue/setting/plot）
 * 生成 3-5 个刨根问底的问题，每个问题带 dimension 字段，引导作者补全卡片隐含细节。
 *
 * Mock 模式下根据卡片类型返回预设问题，不调用 LLM。
 */
export async function deepAskInspirationCard(
  card: InspirationCard,
  existingChildren: InspirationCard[] = [],
): Promise<MaterialQuestion[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const childDigest = existingChildren.slice(0, 8).map((c, i) => `已问 ${i + 1}：[${c.dimension || '未分类'}] ${c.title}`).join('\n');
      const prompt = `请对下面这张灵感卡进行深度提问，生成 3-5 个刨根问底的问题。

卡片类型：${card.type}
卡片标题：${card.title}
卡片内容：${card.content.slice(0, 500) || '（无）'}
${childDigest ? `\n已问过的问题（避免重复维度与措辞）：\n${childDigest}` : ''}

要求：
- 每个问题针对一个 dimension（维度），dimension 取值参考：
  - character 类型：秘密 / 创伤 / 伪装 / 动机 / 底线
  - concept 类型：核心矛盾 / 边界 / 代价 / 反转
  - scene 类型：时间 / 地点 / 视角 / 冲突 / 钩子
  - dialogue 类型：说话人 / 语境 / 潜台词 / 后果
  - setting 类型：规则 / 限制 / 历史 / 例外
  - plot 类型：起因 / 转折 / 代价 / 关联
- 问题要具体、可回答，避免空泛（如"你觉得这个角色怎么样"）
- 问题应能引导作者补全卡片未写的隐含信息

返回 JSON 数组，每项形如：
{"dimension":"维度","question":"具体问题"}

只返回 JSON 数组，不要任何说明。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说创意编辑，擅长用追问激发作者的隐性设定。只返回 JSON 数组。');
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const questions: MaterialQuestion[] = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            dimension: String(r.dimension || '其他').slice(0, 20),
            question: String(r.question || '').slice(0, 200),
          }))
          .filter(q => q.question);
        if (questions.length > 0) return questions.slice(0, 5);
      }
    } catch (e) {
      console.warn('AI deepAskInspirationCard failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(400);
  // Mock：根据卡片类型返回预设问题
  return mockInspirationCardQuestions(card);
}

/** Mock：根据卡片类型返回预设的深度提问 */
function mockInspirationCardQuestions(card: InspirationCard): MaterialQuestion[] {
  const presets: Record<InspirationCard['type'], MaterialQuestion[]> = {
    character: [
      { dimension: '秘密', question: `${card.title} 最不愿让任何人知道的一件事是什么？为什么？` },
      { dimension: '创伤', question: `${card.title} 内心最深的创伤来自哪段经历？它如何塑造了现在的他/她？` },
      { dimension: '伪装', question: `${card.title} 在人前戴着的"面具"是什么？摘下面具后会是什么样子？` },
      { dimension: '动机', question: `${card.title} 做出关键选择的真正动机是什么？表层理由和深层理由有何不同？` },
      { dimension: '底线', question: `${card.title} 绝对不会妥协的底线是什么？什么情境会逼他/她触碰这条底线？` },
    ],
    concept: [
      { dimension: '核心矛盾', question: `「${card.title}」这个高概念背后，最核心的矛盾对立是什么？` },
      { dimension: '边界', question: `这个概念生效的边界条件是什么？什么情况下会失效？` },
      { dimension: '代价', question: `使用或卷入这个概念需要付出什么代价？由谁承担？` },
      { dimension: '反转', question: `这个概念能在哪里制造一个意料之外的反转？` },
    ],
    scene: [
      { dimension: '时间', question: `这个场景发生在什么时间？为什么是这个时间点而非其他？` },
      { dimension: '地点', question: `场景发生地点对情节与情绪有什么暗示作用？` },
      { dimension: '视角', question: `这个场景应该用谁的视角来呈现？换视角会如何改变意义？` },
      { dimension: '冲突', question: `场景中潜藏的冲突是什么？谁与谁、或与什么对立？` },
      { dimension: '钩子', question: `这个场景能为后续留下什么钩子？读者读完会记住什么？` },
    ],
    dialogue: [
      { dimension: '说话人', question: `这句话是谁说的？为什么是他/她而非别人？` },
      { dimension: '语境', question: `这句话是在什么情境下说出来的？前因后果是什么？` },
      { dimension: '潜台词', question: `这句话的潜台词是什么？说话人真正想表达却没说出口的是什么？` },
      { dimension: '后果', question: `这句话说出口后，会引发什么连锁反应？` },
    ],
    setting: [
      { dimension: '规则', question: `「${card.title}」这个设定的核心运作规则是什么？` },
      { dimension: '限制', question: `这个设定对角色与情节施加了什么限制？谁最受影响？` },
      { dimension: '历史', question: `这个设定是如何形成的？背后有什么历史或起源？` },
      { dimension: '例外', question: `这个设定的例外情况是什么？例外会带来什么后果？` },
    ],
    plot: [
      { dimension: '起因', question: `「${card.title}」这个情节脑洞的起因是什么？由谁或什么触发？` },
      { dimension: '转折', question: `这个情节会在哪里发生转折？转折点是什么？` },
      { dimension: '代价', question: `这个情节推进后，主角要付出什么代价？` },
      { dimension: '关联', question: `这个情节如何与主线或其他支线关联？是独立事件还是连锁一环？` },
    ],
  };
  return presets[card.type] || presets.plot;
}

/**
 * 智能连线：找到两张卡片之间的叙事纽带，返回一段叙事脉络描述。
 * 用于"连线沙盘"功能——把两张看似无关的灵感卡串成一条故事线。
 *
 * Mock 模式下简单拼接两张卡片的标题和内容生成脉络，不调用 LLM。
 */
export async function generateStoryLink(
  source: InspirationCard,
  target: InspirationCard,
): Promise<{ narrative: string; note?: string }> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const prompt = `请找出下面两张灵感卡之间的叙事纽带，生成一段叙事脉络描述。

【卡片 A】
类型：${source.type}
标题：${source.title}
内容：${source.content.slice(0, 300) || '（无）'}

【卡片 B】
类型：${target.type}
标题：${target.title}
内容：${target.content.slice(0, 300) || '（无）'}

要求：
- 找到两张卡片之间隐含的因果/对照/传承/对立关系
- 用 60-150 字的叙事脉络描述这条纽带，像一个故事梗概的片段
- 不要简单罗列两张卡片的内容，要写出它们如何串联成一个故事
- 可引入一个"中间转折"让纽带更有张力

返回 JSON 对象：{"narrative":"叙事脉络描述","note":"可选的创作提示（30字内）"}
只返回 JSON，不要其他说明。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长在看似无关的素材间发现叙事纽带。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<{ narrative?: unknown; note?: unknown }>(result);
      if (parsed && typeof parsed === 'object' && typeof parsed.narrative === 'string' && parsed.narrative.trim()) {
        const narrative = parsed.narrative.slice(0, 500);
        const note = typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.slice(0, 100) : undefined;
        return note ? { narrative, note } : { narrative };
      }
    } catch (e) {
      console.warn('AI generateStoryLink failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(400);
  // Mock：简单拼接两张卡片的标题和内容生成脉络
  const aDigest = source.content.slice(0, 60) || source.title;
  const bDigest = target.content.slice(0, 60) || target.title;
  return {
    narrative: `从「${source.title}」（${source.type}）出发——${aDigest}——经由一个未被点破的转折，自然过渡到「${target.title}」（${target.type}）：${bDigest}。两块碎片在此交汇，构成一条隐性的因果链。`,
  };
}

/**
 * 人物弧光校验：检测性格突变（personality-break）、能力越界（ability-exceed）、
 * 关系跳转（relationship-jump）三类问题。
 *
 * Mock 模式下基于章节内容和角色设定做简单启发式检测，不调用 LLM。
 */
export async function analyzeCharacterArcIssues(
  chapters: Chapter[],
  characters: Character[] = [],
): Promise<CharacterArcIssue[]> {
  const topChapters = chapters.filter(c => c.levelType === 'chapter');
  if (topChapters.length === 0 || characters.length === 0) return [];

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const charDigest = characters.slice(0, 8).map(c => `- ${c.name}（${c.role}）：性格=${c.profile?.personality || '未指定'}｜技能=${c.profile?.skills || '未指定'}｜目标=${c.profile?.goal || '未指定'}`).join('\n');
      const chapDigest = topChapters.slice(0, 20).map((c, i) => `第${i + 1}章「${c.title}」: ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 150)}`).join('\n');

      const prompt = `请对下面这份大纲做人物弧光校验，检测三类问题。

检测类型（type 字段取值）：
- personality-break：性格突变——角色行为与设定性格明显冲突（如冷静设定却暴怒失控）
- ability-exceed：能力越界——角色做出超出设定技能范围的事（如非战斗设定却单挑击败强敌）
- relationship-jump：关系跳转——两个角色关系在没有铺垫的情况下骤变（如敌对突然信任）

每条问题包含：
{
  "characterId": "角色ID",
  "characterName": "角色名",
  "type": "personality-break|ability-exceed|relationship-jump",
  "chapterId": "触发章节ID",
  "chapterTitle": "触发章节标题",
  "description": "问题简述（不超过60字）",
  "suggestion": "可落地建议（不超过80字）",
  "severity": "error|warning"
}

只返回 JSON 数组，无问题返回 []。

【角色库】
${charDigest}

【大纲章节】
${chapDigest}
`;

      const result = await llmClient.callLLM(prompt, '你是资深小说人物编辑，擅长发现人物弧光中的硬伤。只返回 JSON 数组。');
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const issues: CharacterArcIssue[] = [];
        parsed.forEach((raw, idx) => {
          if (!raw || typeof raw !== 'object') return;
          const r = raw as Record<string, unknown>;
          const type = String(r.type || 'personality-break') as CharacterArcIssue['type'];
          const validTypes: CharacterArcIssue['type'][] = ['personality-break', 'ability-exceed', 'relationship-jump'];
          const severity = String(r.severity || 'warning') as CharacterArcIssue['severity'];
          const validSev: CharacterArcIssue['severity'][] = ['error', 'warning'];
          const chapterId = r.chapterId ? String(r.chapterId) : undefined;
          const chapter = chapterId ? topChapters.find(c => c.id === chapterId) : undefined;
          issues.push({
            id: `arc-issue-${Date.now()}-${idx}`,
            characterId: String(r.characterId || ''),
            characterName: String(r.characterName || '').slice(0, 30),
            type: validTypes.includes(type) ? type : 'personality-break',
            chapterId: chapter?.id,
            chapterTitle: chapter?.title,
            description: String(r.description || '').slice(0, 200),
            suggestion: String(r.suggestion || '').slice(0, 300),
            severity: validSev.includes(severity) ? severity : 'warning',
          });
        });
        return issues;
      }
    } catch (e) {
      console.warn('AI analyzeCharacterArcIssues failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于章节内容和角色设定做简单启发式检测
  return generateHeuristicArcIssues(topChapters, characters);
}

/** Mock 启发式：基于关键词检测人物弧光三类问题 */
function generateHeuristicArcIssues(chapters: Chapter[], characters: Character[]): CharacterArcIssue[] {
  const issues: CharacterArcIssue[] = [];
  const now = Date.now();

  // 反向性格词典：性格关键词 → 与之冲突的行为关键词
  const personalityConflict: Array<{ trait: string; opposites: string[] }> = [
    { trait: '冷静', opposites: ['暴怒', '失控', '歇斯底里', '崩溃大哭'] },
    { trait: '沉默', opposites: ['滔滔不绝', '高谈阔论', '大声喧哗'] },
    { trait: '善良', opposites: ['残忍', '冷酷无情', '见死不救'] },
    { trait: '勇敢', opposites: ['退缩', '畏缩', '临阵脱逃'] },
    { trait: '谨慎', opposites: ['莽撞', '贸然', '冲动行事'] },
  ];

  // 能力越界关键词
  const combatKeywords = ['击败', '单挑', '战胜', '一招制敌', '力压群雄', '所向披靡'];
  const strategyKeywords = ['运筹帷幄', '识破诡计', '精准预判', '神机妙算'];

  for (const char of characters) {
    const personality = char.profile?.personality || '';
    const skills = char.profile?.skills || '';
    const hasCombat = skills.includes('战斗') || skills.includes('武力') || skills.includes('格斗') || skills.includes('剑术');
    const hasStrategy = skills.includes('谋略') || skills.includes('策略') || skills.includes('智谋') || skills.includes('战术');

    for (const ch of chapters) {
      const text = ch.content || '';
      const focusHere = ch.characterFocus?.includes(char.id) || text.includes(char.name);
      if (!focusHere) continue;

      // 1. 性格突变
      for (const pc of personalityConflict) {
        if (personality.includes(pc.trait)) {
          for (const opp of pc.opposites) {
            if (text.includes(opp)) {
              issues.push({
                id: `arc-pb-${now}-${char.id}-${ch.id}`,
                characterId: char.id,
                characterName: char.name,
                type: 'personality-break',
                chapterId: ch.id,
                chapterTitle: ch.title,
                description: `${char.name}设定为「${pc.trait}」，但在《${ch.title}》中出现「${opp}」行为，性格突变`,
                suggestion: `增加过渡铺垫：先用一个外部刺激（如至亲受威胁）逐步逼出${char.name}的非常态反应，或调整该处行为以符合「${pc.trait}」设定`,
                severity: 'warning',
              });
              break;
            }
          }
        }
      }

      // 2. 能力越界：未设战斗技能却单挑强敌
      if (!hasCombat) {
        for (const kw of combatKeywords) {
          if (text.includes(char.name) && text.includes(kw)) {
            issues.push({
              id: `arc-ae-${now}-${char.id}-${ch.id}`,
              characterId: char.id,
              characterName: char.name,
              type: 'ability-exceed',
              chapterId: ch.id,
              chapterTitle: ch.title,
              description: `${char.name}技能设定未包含战斗，但在《${ch.title}》中出现「${kw}」行为，能力越界`,
              suggestion: `在角色卡补充战斗技能来源（师承/秘宝/觉醒），或将该情节改为借助盟友或计谋达成，避免主角光环`,
              severity: 'warning',
            });
            break;
          }
        }
      }
      // 未设谋略技能却运筹帷幄
      if (!hasStrategy) {
        for (const kw of strategyKeywords) {
          if (text.includes(char.name) && text.includes(kw)) {
            issues.push({
              id: `arc-ae2-${now}-${char.id}-${ch.id}`,
              characterId: char.id,
              characterName: char.name,
              type: 'ability-exceed',
              chapterId: ch.id,
              chapterTitle: ch.title,
              description: `${char.name}技能设定未包含谋略，但在《${ch.title}》中出现「${kw}」行为，能力越界`,
              suggestion: `补充谋略来源（谋士辅佐/旧日经验/偶然情报），或改为直觉式判断而非系统性布局`,
              severity: 'warning',
            });
            break;
          }
        }
      }
    }
  }

  // 3. 关系跳转：检测两人关系类型与章节中互动不符
  for (const char of characters) {
    for (const rel of char.relationships) {
      const target = characters.find(c => c.id === rel.targetId);
      if (!target) continue;
      const relType = rel.type || '';
      const isHostile = /敌|对手|仇|对立/.test(relType);
      const isAlly = /友|盟|师|兄|姐|弟|妹|父|母|子|女|爱|伴/.test(relType);

      for (const ch of chapters) {
        const text = ch.content || '';
        const bothPresent = text.includes(char.name) && text.includes(target.name);
        if (!bothPresent) continue;

        if (isHostile && (text.includes('信任') || text.includes('托付') || text.includes('坦诚相待'))) {
          issues.push({
            id: `arc-rj-${now}-${char.id}-${target.id}-${ch.id}`,
            characterId: char.id,
            characterName: char.name,
            type: 'relationship-jump',
            chapterId: ch.id,
            chapterTitle: ch.title,
            description: `${char.name}与${target.name}设定为「${relType}」关系，但在《${ch.title}》中直接出现信任/托付行为，关系跳转`,
            suggestion: `在前 1-2 章铺垫共同威胁或利益交换，逐步从敌对走向有限合作；或在此章保留戒备，仅做表面协作`,
            severity: 'warning',
          });
          break;
        }
        if (isAlly && (text.includes('背叛') || text.includes('反戈') || text.includes('暗算'))) {
          issues.push({
            id: `arc-rj2-${now}-${char.id}-${target.id}-${ch.id}`,
            characterId: char.id,
            characterName: char.name,
            type: 'relationship-jump',
            chapterId: ch.id,
            chapterTitle: ch.title,
            description: `${char.name}与${target.name}设定为「${relType}」关系，但在《${ch.title}》中突然出现背叛/反戈行为，关系跳转`,
            suggestion: `补充背叛动机铺垫（长期积怨/被胁迫/利益诱惑），并在前文埋下伏笔（异常举动/欲言又止）`,
            severity: 'error',
          });
          break;
        }
      }
    }
  }

  return issues;
}

/**
 * 两人关系温度曲线：逐章分析两人关系温度（0-100），检测跳转问题。
 * 0=彻底敌对，50=中立/陌生，100=完全信任/亲密。
 *
 * Mock 模式下基于章节中两人同时出现的关键词（合作/对抗/争吵/和解等）估算温度。
 */
export async function analyzeRelationshipTemperature(
  chapters: Chapter[],
  characterA: Character,
  characterB: Character,
): Promise<RelationshipTemperatureCurve> {
  const topChapters = chapters.filter(c => c.levelType === 'chapter');

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const chapDigest = topChapters.slice(0, 20).map((c, i) => `第${i + 1}章「${c.title}」: ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 150)}`).join('\n');
      const existingRel = characterA.relationships.find(r => r.targetId === characterB.id);
      const prompt = `请逐章分析下面两位角色之间的关系温度（0-100），并检测跳转问题。

角色 A：${characterA.name}（${characterA.role}）：${characterA.profile?.personality || '未指定'}
角色 B：${characterB.name}（${characterB.role}）：${characterB.profile?.personality || '未指定'}
两人既有关系：${existingRel?.type || '未指定'}${existingRel?.description ? `（${existingRel.description}）` : ''}

温度定义：0=彻底敌对，50=中立/陌生，100=完全信任/亲密

每章输出：
{
  "chapterId": "章节ID",
  "chapterTitle": "章节标题",
  "temperature": 0-100 数字,
  "note": "本章关系变化简述（20-40字，无变化写'无明显互动'）"
}

同时检测跳转问题（相邻章节温度骤变>40），放在 jumps 字段：
{
  "chapterId": "跳变发生的章节ID",
  "chapterTitle": "章节标题",
  "fromTemp": 前一章温度,
  "toTemp": 本章温度,
  "description": "跳变说明"
}

返回 JSON 对象：
{"points":[...],"jumps":[...]}
只返回 JSON，不要其他说明。

【大纲章节】
${chapDigest || '（无章节）'}
`;

      const result = await llmClient.callLLM(prompt, '你是资深小说人物关系分析师，擅长追踪角色关系的微妙变化。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<{ points?: unknown; jumps?: unknown }>(result);
      if (parsed && typeof parsed === 'object') {
        const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
        const rawJumps = Array.isArray(parsed.jumps) ? parsed.jumps : [];
        const points = rawPoints
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => {
            const ch = topChapters.find(c => c.id === String(r.chapterId || ''));
            return {
              chapterId: ch?.id || String(r.chapterId || ''),
              chapterTitle: ch?.title || String(r.chapterTitle || ''),
              temperature: Math.max(0, Math.min(100, Number(r.temperature) || 50)),
              note: r.note ? String(r.note).slice(0, 100) : undefined,
            };
          });
        const jumps = rawJumps
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => {
            const ch = topChapters.find(c => c.id === String(r.chapterId || ''));
            return {
              chapterId: ch?.id || String(r.chapterId || ''),
              chapterTitle: ch?.title || String(r.chapterTitle || ''),
              fromTemp: Math.max(0, Math.min(100, Number(r.fromTemp) || 0)),
              toTemp: Math.max(0, Math.min(100, Number(r.toTemp) || 0)),
              description: String(r.description || '').slice(0, 200),
            };
          });
        if (points.length > 0) {
          return {
            characterAId: characterA.id,
            characterBId: characterB.id,
            points,
            jumps,
          };
        }
      }
    } catch (e) {
      console.warn('AI analyzeRelationshipTemperature failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于章节中两人同时出现的关键词估算温度
  return generateHeuristicTemperatureCurve(topChapters, characterA, characterB);
}

/** Mock 启发式：基于关键词估算两人关系温度 */
function generateHeuristicTemperatureCurve(
  chapters: Chapter[],
  characterA: Character,
  characterB: Character,
): RelationshipTemperatureCurve {
  // 温度关键词：高温（亲密/合作）vs 低温（敌对/冲突）
  const hotKeywords = ['信任', '托付', '拥抱', '和解', '并肩', '合作', '坦白', '守护', '相视而笑', '默契'];
  const coldKeywords = ['争吵', '对抗', '决裂', '背叛', '冷战', '怒斥', '指责', '暗算', '反目', '敌视'];
  const neutralBonus = 50;

  const points = chapters.map(ch => {
    const text = ch.content || '';
    const bothPresent = text.includes(characterA.name) && text.includes(characterB.name);
    if (!bothPresent) {
      return {
        chapterId: ch.id,
        chapterTitle: ch.title,
        temperature: 50,
        note: '两人未同时出场',
      };
    }
    let hot = 0;
    let cold = 0;
    for (const kw of hotKeywords) if (text.includes(kw)) hot++;
    for (const kw of coldKeywords) if (text.includes(kw)) cold++;
    let temp = neutralBonus + hot * 12 - cold * 12;
    temp = Math.max(0, Math.min(100, Math.round(temp)));
    let note = '中性互动';
    if (hot > cold && hot > 0) note = `出现 ${hot} 个亲密信号（合作/信任等）`;
    else if (cold > hot && cold > 0) note = `出现 ${cold} 个冲突信号（争吵/对抗等）`;
    return {
      chapterId: ch.id,
      chapterTitle: ch.title,
      temperature: temp,
      note,
    };
  });

  // 检测跳变：相邻温度差 > 40
  const jumps: RelationshipTemperatureCurve['jumps'] = [];
  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(points[i].temperature - points[i - 1].temperature);
    if (diff > 40) {
      const direction = points[i].temperature > points[i - 1].temperature ? '骤升' : '骤降';
      jumps.push({
        chapterId: points[i].chapterId,
        chapterTitle: points[i].chapterTitle,
        fromTemp: points[i - 1].temperature,
        toTemp: points[i].temperature,
        description: `${characterA.name}与${characterB.name}关系温度${direction} ${diff}（${points[i - 1].temperature}→${points[i].temperature}），缺乏过渡铺垫`,
      });
    }
  }

  return {
    characterAId: characterA.id,
    characterBId: characterB.id,
    points,
    jumps,
  };
}

/**
 * 节奏压力测试：对每章计算 external/emotional/buffer 三维能量值，
 * 检测连续低能量（4章+）、连续高能量（3章+）、平铺（连续5章波动<10）、
 * 尖峰（单章突增40+）四类问题。
 *
 * 每个问题带具体建议（落地情节方向，如"建议插入一个支线小爆发点"，
 * 而非空喊"节奏不对"）。Mock 模式下复用 chapter.content 关键词检测。
 */
export async function runPacingPressureTest(
  chapters: Chapter[],
): Promise<PacingPressureReport> {
  const topChapters = chapters.filter(c => c.levelType === 'chapter');
  if (topChapters.length === 0) {
    return { generatedAt: new Date().toISOString(), scope: 'all', points: [], issues: [] };
  }

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const chapDigest = topChapters.slice(0, 30).map((c, i) => `第${i + 1}章「${c.title}」(${c.wordCount}字): ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 120)}`).join('\n');
      const prompt = `请对下面这份大纲做节奏压力测试，逐章评估三维能量。

每章输出：
{
  "chapterId": "章节ID",
  "chapterTitle": "章节标题",
  "external": 0-100 外部能量（动作戏/冲突爆发/反转强度）,
  "emotional": 0-100 情感能量（内心抉择/关系转折/情绪爆发）,
  "isBuffer": true/false 是否低谷缓冲段（日常过渡/信息铺垫/文戏）
}

external + emotional 为综合强度 total。

同时检测四类节奏问题：
- low-streak：连续 4 章及以上 total 偏低（<30）
- high-streak：连续 3 章及以上 total 偏高（>70）
- flat：连续 5 章 total 波动 < 10（平铺直叙）
- spike：单章 total 较前章突增 40+

每个问题需带具体建议（落地情节方向，如"建议插入一个支线小爆发点"而非"节奏不对"）：
{
  "id": "唯一ID",
  "type": "low-streak|high-streak|flat|spike",
  "chapterIds": ["受影响章节ID"],
  "description": "问题描述",
  "suggestion": "具体情节建议",
  "severity": "warning|info"
}

返回 JSON 对象：
{"points":[...],"issues":[...]}
只返回 JSON，不要其他说明。

【大纲章节】
${chapDigest}
`;

      const result = await llmClient.callLLM(prompt, '你是资深小说节奏分析师，擅长发现节奏失衡并提供落地建议。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<{ points?: unknown; issues?: unknown }>(result);
      if (parsed && typeof parsed === 'object') {
        const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
        const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
        const points: PacingPressurePoint[] = rawPoints
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => {
            const ch = topChapters.find(c => c.id === String(r.chapterId || ''));
            const external = Math.max(0, Math.min(100, Number(r.external) || 0));
            const emotional = Math.max(0, Math.min(100, Number(r.emotional) || 0));
            return {
              chapterId: ch?.id || String(r.chapterId || ''),
              chapterTitle: ch?.title || String(r.chapterTitle || ''),
              external,
              emotional,
              isBuffer: !!r.isBuffer,
              total: external + emotional,
            };
          });
        const issues: PacingIssue[] = rawIssues
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r, idx) => {
            const type = String(r.type || 'flat') as PacingIssue['type'];
            const validTypes: PacingIssue['type'][] = ['low-streak', 'high-streak', 'flat', 'spike'];
            const severity = String(r.severity || 'warning') as PacingIssue['severity'];
            const validSev: PacingIssue['severity'][] = ['warning', 'info'];
            return {
              id: String(r.id || `pacing-${Date.now()}-${idx}`),
              type: validTypes.includes(type) ? type : 'flat',
              chapterIds: Array.isArray(r.chapterIds) ? (r.chapterIds as unknown[]).map(s => String(s)).slice(0, 20) : [],
              description: String(r.description || '').slice(0, 200),
              suggestion: String(r.suggestion || '').slice(0, 300),
              severity: validSev.includes(severity) ? severity : 'warning',
            };
          });
        if (points.length > 0) {
          return {
            generatedAt: new Date().toISOString(),
            scope: 'all',
            points,
            issues,
          };
        }
      }
    } catch (e) {
      console.warn('AI runPacingPressureTest failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：复用 chapter.content 关键词检测
  return generateHeuristicPacingReport(topChapters);
}

/** Mock 启发式：基于章节内容关键词计算三维能量并检测节奏问题 */
function generateHeuristicPacingReport(chapters: Chapter[]): PacingPressureReport {
  const externalKeywords = ['战斗', '追逐', '冲突', '爆发', '反转', '袭击', '对决', '厮杀', '逃亡', '围攻'];
  const emotionalKeywords = ['抉择', '痛苦', '崩溃', '觉醒', '释怀', '愤怒', '悲伤', '忏悔', '心碎', '顿悟'];

  // 计算单章能量：基础 15 + 关键词加成（每个 +11），上限 100
  const points: PacingPressurePoint[] = chapters.map(ch => {
    const text = ch.content || '';
    let extHits = 0;
    let emoHits = 0;
    for (const kw of externalKeywords) if (text.includes(kw)) extHits++;
    for (const kw of emotionalKeywords) if (text.includes(kw)) emoHits++;
    const external = Math.min(100, 15 + extHits * 11);
    const emotional = Math.min(100, 15 + emoHits * 11);
    const total = external + emotional;
    const isBuffer = external < 30 && emotional < 30;
    return {
      chapterId: ch.id,
      chapterTitle: ch.title,
      external,
      emotional,
      isBuffer,
      total,
    };
  });

  const issues: PacingIssue[] = [];
  const now = Date.now();

  // 1. low-streak：连续 4 章+ total < 30
  let lowStart = -1;
  const flushLow = (endIdx: number) => {
    if (lowStart !== -1 && endIdx - lowStart >= 4) {
      const seg = points.slice(lowStart, endIdx);
      issues.push({
        id: `pacing-low-${now}-${lowStart}`,
        type: 'low-streak',
        chapterIds: seg.map(p => p.chapterId),
        description: `${seg[0].chapterTitle} 起连续 ${seg.length} 章综合能量偏低（total<30），节奏拖沓`,
        suggestion: `建议在第 ${lowStart + 2} 章前后插入一个支线小爆发点（如旧识突然登场/隐藏线索浮出水面），打破平淡；或将其中 1-2 章合并压缩`,
        severity: 'warning',
      });
    }
    lowStart = -1;
  };
  for (let i = 0; i < points.length; i++) {
    if (points[i].total < 30) {
      if (lowStart === -1) lowStart = i;
    } else {
      flushLow(i);
    }
  }
  flushLow(points.length);

  // 2. high-streak：连续 3 章+ total > 70
  let highStart = -1;
  const flushHigh = (endIdx: number) => {
    if (highStart !== -1 && endIdx - highStart >= 3) {
      const seg = points.slice(highStart, endIdx);
      issues.push({
        id: `pacing-high-${now}-${highStart}`,
        type: 'high-streak',
        chapterIds: seg.map(p => p.chapterId),
        description: `${seg[0].chapterTitle} 起连续 ${seg.length} 章综合能量偏高（total>70），读者疲劳风险`,
        suggestion: `建议在其中一章插入一个缓冲文戏段（角色独白/日常对话/环境描写），让情绪有喘息空间，避免持续高能导致麻木`,
        severity: 'warning',
      });
    }
    highStart = -1;
  };
  for (let i = 0; i < points.length; i++) {
    if (points[i].total > 70) {
      if (highStart === -1) highStart = i;
    } else {
      flushHigh(i);
    }
  }
  flushHigh(points.length);

  // 3. flat：连续 5 章 total 波动 < 10
  for (let i = 0; i <= points.length - 5; i++) {
    const seg = points.slice(i, i + 5);
    const totals = seg.map(p => p.total);
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    if (max - min < 10) {
      issues.push({
        id: `pacing-flat-${now}-${i}`,
        type: 'flat',
        chapterIds: seg.map(p => p.chapterId),
        description: `${seg[0].chapterTitle} 起连续 5 章综合能量波动 < 10（${min}-${max}），节奏平铺直叙`,
        suggestion: `建议在第 ${i + 3} 章引入一个意外转折（如新角色登场/旧秘密曝光/外部事件冲击），打破稳态制造起伏`,
        severity: 'info',
      });
      break; // 只报第一个，避免重叠
    }
  }

  // 4. spike：单章 total 较前章突增 40+
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].total - points[i - 1].total;
    if (diff > 40) {
      issues.push({
        id: `pacing-spike-${now}-${i}`,
        type: 'spike',
        chapterIds: [points[i].chapterId],
        description: `${points[i].chapterTitle} 综合能量较前章突增 ${diff}（${points[i - 1].total}→${points[i].total}），缺乏铺垫`,
        suggestion: `建议在前一章末尾埋一个钩子（如不祥预兆/急报传来/角色异常举动），让能量爬升更自然，避免突兀的爆发`,
        severity: 'info',
      });
      break; // 只报第一个，避免噪声
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: 'all',
    points,
    issues,
  };
}

/**
 * 读者共情校验：逐章评估"读者能否代入并共情"，输出三维共情强度
 * （动机清晰度 / 情感冲击力 / 利益清晰度）+ 四类共情问题。
 *
 * Mock 模式下基于章节内容关键词做启发式检测，保证无 LLM 时也有可读数据。
 *
 * 问题类型（ReaderEmpathyIssueType）：
 *   - motivation-gap：动机断层——主角行为缺乏读者可理解的动机
 *   - emotion-flat：情感扁平——关键场景情感冲击不足，读者无代入
 *   - stakes-unclear：利益模糊——读者不清楚主角失败的代价
 *   - perspective-drift：视角漂移——叙事视角跳跃使读者出戏
 */
export async function analyzeReaderEmpathy(
  chapters: Chapter[],
  characters: Character[] = [],
  foreshadows: Foreshadow[] = [],
): Promise<ReaderEmpathyReport> {
  const topChapters = chapters.filter(c => c.levelType === 'chapter');
  if (topChapters.length === 0) {
    return { generatedAt: new Date().toISOString(), scope: 'all', points: [], issues: [], overallScore: 0 };
  }

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const charDigest = characters.slice(0, 8).map(c => `- ${c.name}（${c.role}）：目标=${c.profile?.goal || '未指定'}｜动机=${c.profile?.motivation || '未指定'}`).join('\n');
      const chapDigest = topChapters.slice(0, 30).map((c, i) => `第${i + 1}章「${c.title}」(${c.wordCount}字): ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 150)}`).join('\n');
      // 伏笔摘要：标题/状态/距上次提及章数/埋设与回收章节
      const foreshadowDigest = foreshadows.slice(0, 20).map(f => `- 《${f.title}》：状态=${f.status}｜距上次提及=${f.chaptersSinceMention}章｜埋设=${f.plantedChapterId ? '已指定' : '未指定'}｜回收=${f.payoffChapterId ? '已指定' : '未指定'}`).join('\n');

      const prompt = `请对下面这份大纲做读者共情校验，逐章评估三维共情强度。

每章输出：
{
  "chapterId": "章节ID",
  "chapterTitle": "章节标题",
  "motivation": 0-100 动机清晰度（读者能否理解主角为何这么做）,
  "emotion": 0-100 情感冲击力（场景是否唤起读者情绪）,
  "stakes": 0-100 利益清晰度（读者是否清楚主角失败的代价）
}
三维平均为综合 total。

同时检测八类共情问题（前四项为基础，后四项为读者留存视角）：
- motivation-gap：动机断层——主角行为缺乏读者可理解的动机（如突然冒险却无内驱力）
- emotion-flat：情感扁平——关键场景情感冲击不足，读者无代入（如亲人离世却一笔带过）
- stakes-unclear：利益模糊——读者不清楚主角失败的代价（如不知输了会失去什么）
- perspective-drift：视角漂移——叙事视角跳跃使读者出戏（如主角视角突切路人视角）
- suspense-forget：悬念遗忘——某伏笔埋设后太久未推进/回收（已超过5章未提及或埋设后超过8章未回收），读者已遗忘或等得不耐烦
- emotion-fatigue：情感疲劳——连续 3 章以上高压（emotion>70），读者需要情感喘息口
- favorability-low：角色好感度低——主角连续 3 章无成长迹象（认知/能力停滞），读者对主角好感走低
- drop-risk：弃书风险——某章综合 total<40 且字数>500（节奏拖沓/冲突乏力），或连续 3 章 motivation<30，标记为弃书高危节点

每个问题需带可落地建议（具体到补什么铺垫/强化什么描写）：
{
  "id": "唯一ID",
  "type": "motivation-gap|emotion-flat|stakes-unclear|perspective-drift|suspense-forget|emotion-fatigue|favorability-low|drop-risk",
  "chapterId": "触发章节ID（悬念遗忘可指向最近章节）",
  "chapterTitle": "触发章节标题",
  "description": "问题描述（不超过60字）",
  "suggestion": "可落地建议（不超过80字）",
  "severity": "error|warning"
}

另给出整体共情评分 overallScore（0-100，所有章节 total 的加权平均）。

返回 JSON 对象：
{"points":[...],"issues":[...],"overallScore":80}
只返回 JSON，不要其他说明。

【角色库】
${charDigest}

【大纲章节】
${chapDigest}

【伏笔库】
${foreshadowDigest || '（未提供伏笔）'}
`;

      const result = await llmClient.callLLM(prompt, '你是资深小说读者体验顾问，擅长从读者代入感角度发现共鸣硬伤。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<{ points?: unknown; issues?: unknown; overallScore?: unknown }>(result);
      if (parsed && typeof parsed === 'object') {
        const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
        const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
        const points: ReaderEmpathyPoint[] = rawPoints
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => {
            const ch = topChapters.find(c => c.id === String(r.chapterId || ''));
            const motivation = Math.max(0, Math.min(100, Math.round(Number(r.motivation) || 0)));
            const emotion = Math.max(0, Math.min(100, Math.round(Number(r.emotion) || 0)));
            const stakes = Math.max(0, Math.min(100, Math.round(Number(r.stakes) || 0)));
            return {
              chapterId: ch?.id || String(r.chapterId || ''),
              chapterTitle: ch?.title || String(r.chapterTitle || ''),
              motivation,
              emotion,
              stakes,
              total: Math.round((motivation + emotion + stakes) / 3),
            };
          });
        const issues: ReaderEmpathyIssue[] = rawIssues
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r, idx) => {
            const type = String(r.type || 'emotion-flat') as ReaderEmpathyIssue['type'];
            const validTypes: ReaderEmpathyIssue['type'][] = ['motivation-gap', 'emotion-flat', 'stakes-unclear', 'perspective-drift', 'suspense-forget', 'emotion-fatigue', 'favorability-low', 'drop-risk'];
            const severity = String(r.severity || 'warning') as ReaderEmpathyIssue['severity'];
            const validSev: ReaderEmpathyIssue['severity'][] = ['error', 'warning'];
            const chapterId = r.chapterId ? String(r.chapterId) : undefined;
            const chapter = chapterId ? topChapters.find(c => c.id === chapterId) : undefined;
            return {
              id: String(r.id || `empathy-${Date.now()}-${idx}`),
              type: validTypes.includes(type) ? type : 'emotion-flat',
              chapterId: chapter?.id,
              chapterTitle: chapter?.title,
              description: String(r.description || '').slice(0, 200),
              suggestion: String(r.suggestion || '').slice(0, 300),
              severity: validSev.includes(severity) ? severity : 'warning',
            };
          });
        if (points.length > 0) {
          const overallScore = Math.round(points.reduce((s, p) => s + p.total, 0) / points.length);
          return {
            generatedAt: new Date().toISOString(),
            scope: 'all',
            points,
            issues,
            overallScore,
          };
        }
      }
    } catch (e) {
      console.warn('AI analyzeReaderEmpathy failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于章节内容关键词做启发式共情检测
  return generateHeuristicReaderEmpathyReport(topChapters, characters, foreshadows);
}

/** Mock 启发式：基于关键词计算三维共情强度并检测共情问题（含四项读者留存视角检测） */
function generateHeuristicReaderEmpathyReport(
  chapters: Chapter[],
  characters: Character[],
  foreshadows: Foreshadow[] = [],
): ReaderEmpathyReport {
  const motivationKeywords = ['为了', '想要', '必须', '决心', '目标是', '执意', '不顾一切', '只为', '誓要', '哪怕'];
  const emotionKeywords = ['泪', '哭', '颤', '痛', '怒', '惊', '心碎', '崩溃', '释怀', '温暖', '绝望', '狂喜', '悔恨', '不舍'];
  const stakesKeywords = ['失去', '代价', '一旦', '否则', '失败', '万劫不复', '再无', '不能', '危及', '葬送', '搭上'];

  // 主角名集合：用于检测视角漂移（章节正文是否提及主角）
  const protagonistNames = characters.filter(c => c.role === 'protagonist').map(c => c.name);

  const points: ReaderEmpathyPoint[] = chapters.map(ch => {
    const text = ch.content || '';
    const summary = ch.summary || '';
    const focusText = `${text} ${summary}`;
    let motHits = 0;
    let emoHits = 0;
    let stkHits = 0;
    for (const kw of motivationKeywords) if (focusText.includes(kw)) motHits++;
    for (const kw of emotionKeywords) if (focusText.includes(kw)) emoHits++;
    for (const kw of stakesKeywords) if (focusText.includes(kw)) stkHits++;
    // 基础 20 + 关键词加成（每个 +12），上限 100；无内容时给较低基础分
    const base = text.length > 0 ? 20 : 10;
    const motivation = Math.min(100, base + motHits * 12);
    const emotion = Math.min(100, base + emoHits * 12);
    const stakes = Math.min(100, base + stkHits * 12);
    return {
      chapterId: ch.id,
      chapterTitle: ch.title,
      motivation,
      emotion,
      stakes,
      total: Math.round((motivation + emotion + stakes) / 3),
    };
  });

  const issues: ReaderEmpathyIssue[] = [];
  const now = Date.now();

  chapters.forEach((ch, idx) => {
    const p = points[idx];
    const text = ch.content || '';

    // 1. motivation-gap：动机分 < 30 且章节有内容
    if (p.motivation < 30 && text.length > 0) {
      issues.push({
        id: `empathy-mg-${now}-${ch.id}`,
        type: 'motivation-gap',
        chapterId: ch.id,
        chapterTitle: ch.title,
        description: `${ch.title} 中主角行为缺乏可理解的动机（动机清晰度仅 ${p.motivation}），读者难以代入`,
        suggestion: `在章节前段补一句主角的内心独白或回想，点明他为何非这么做不可（如"想起妹妹的遗言，他握紧了拳头"）`,
        severity: 'warning',
      });
    }

    // 2. emotion-flat：情感分 < 30 且章节字数较多（应是关键场景却情感扁平）
    if (p.emotion < 30 && ch.wordCount > 500) {
      issues.push({
        id: `empathy-ef-${now}-${ch.id}`,
        type: 'emotion-flat',
        chapterId: ch.id,
        chapterTitle: ch.title,
        description: `${ch.title} 情感冲击力不足（情感分仅 ${p.emotion}），关键场景未能唤起读者情绪`,
        suggestion: `强化场景的感官描写与角色生理反应（如心跳/呼吸/手抖），用具体细节代替概述，让读者"身临其境"`,
        severity: 'warning',
      });
    }

    // 3. stakes-unclear：利益分 < 30 且章节有内容
    if (p.stakes < 30 && text.length > 0) {
      issues.push({
        id: `empathy-su-${now}-${ch.id}`,
        type: 'stakes-unclear',
        chapterId: ch.id,
        chapterTitle: ch.title,
        description: `${ch.title} 中读者不清楚主角失败的代价（利益清晰度仅 ${p.stakes}），紧张感不足`,
        suggestion: `明确点出"如果失败会怎样"——可以借配角之口点破代价，或插入一个反例（他人因同样失误而惨败）`,
        severity: 'warning',
      });
    }

    // 4. perspective-drift：有主角设定但章节正文完全未提及主角名
    if (protagonistNames.length > 0 && text.length > 200) {
      const mentionsProtagonist = protagonistNames.some(name => text.includes(name));
      if (!mentionsProtagonist) {
        issues.push({
          id: `empathy-pd-${now}-${ch.id}`,
          type: 'perspective-drift',
          chapterId: ch.id,
          chapterTitle: ch.title,
          description: `${ch.title} 正文未出现主角身影，叙事视角可能漂移到配角或旁白，读者易出戏`,
          suggestion: `若是有意切换视角，建议在章节开头用明确标识（如"与此同时，在城西的客栈里——"）；若是无意，请把镜头拉回主角`,
          severity: 'warning',
        });
      }
    }
  });

  // 5. suspense-forget：伏笔埋设后太久未推进/回收（规格书阶段4-6）
  //    条件：status 为 planted/progressing 且 chaptersSinceMention>5；
  //    或埋设后超过 8 章未回收（用 plantedChapter 与最新章节 order 差估算）
  const chapterById = new Map(chapters.map(c => [c.id, c]));
  const maxOrder = chapters.length > 0 ? Math.max(...chapters.map(c => c.order)) : 0;
  for (const f of foreshadows) {
    if (f.status === 'paid-off' || f.status === 'abandoned') continue;
    let stale = f.chaptersSinceMention > 5;
    let staleChapters = f.chaptersSinceMention;
    if (!stale && f.plantedChapterId) {
      const plantedCh = chapterById.get(f.plantedChapterId);
      if (plantedCh) {
        const distance = maxOrder - plantedCh.order;
        if (distance > 8) {
          stale = true;
          staleChapters = distance;
        }
      }
    }
    if (stale) {
      issues.push({
        id: `empathy-sf-${now}-${f.id}`,
        type: 'suspense-forget',
        description: `伏笔《${f.title}》已 ${staleChapters} 章未推进，读者可能已遗忘`,
        suggestion: `就近推进或回收该伏笔：在近期章节中安排一次隐性提及，或在角色对话中自然带出，维持读者记忆`,
        severity: 'warning',
      });
    }
  }

  // 6. emotion-fatigue：连续 3+ 章 emotion>70（高压），读者需要情感喘息口
  let fatigueStart = -1;
  const flushFatigue = (endIdx: number) => {
    if (fatigueStart !== -1 && endIdx - fatigueStart >= 3) {
      const seg = points.slice(fatigueStart, endIdx);
      issues.push({
        id: `empathy-efat-${now}-${fatigueStart}`,
        type: 'emotion-fatigue',
        chapterId: seg[0].chapterId,
        chapterTitle: seg[0].chapterTitle,
        description: `${seg[0].chapterTitle} 起连续 ${seg.length} 章高压（emotion>70），读者需要情感喘息口`,
        suggestion: `在其中一章插入一个缓冲文戏段（角色独白/日常对话/环境描写），让情绪有起伏落差，避免持续高能导致读者麻木`,
        severity: 'warning',
      });
    }
    fatigueStart = -1;
  };
  for (let i = 0; i < points.length; i++) {
    if (points[i].emotion > 70) {
      if (fatigueStart === -1) fatigueStart = i;
    } else {
      flushFatigue(i);
    }
  }
  flushFatigue(points.length);

  // 7. favorability-low：主角连续 3 章 cognition<30（无成长迹象）
  //    cognition 用认知关键词计数估算（明白/意识到/终于懂/看清/领悟）
  const cognitionKeywords = ['明白', '意识到', '终于懂', '看清', '领悟', '懂得', '看透', '醒悟'];
  const cognitionScores = chapters.map(ch => {
    const text = `${ch.content || ''} ${ch.summary || ''}`;
    let hits = 0;
    for (const kw of cognitionKeywords) if (text.includes(kw)) hits++;
    return Math.min(100, 15 + hits * 18);
  });
  let favStart = -1;
  const flushFav = (endIdx: number) => {
    if (favStart !== -1 && endIdx - favStart >= 3) {
      const seg = chapters.slice(favStart, endIdx);
      issues.push({
        id: `empathy-fav-${now}-${favStart}`,
        type: 'favorability-low',
        chapterId: seg[0].id,
        chapterTitle: seg[0].title,
        description: `${seg[0].title} 起连续 ${seg.length} 章主角无成长迹象（认知停滞），读者对主角好感走低`,
        suggestion: `在其中一章安排一个认知转折（顿悟/听到关键信息/旧事重提），让主角对世界或自我有新的理解，重燃读者期待`,
        severity: 'warning',
      });
    }
    favStart = -1;
  };
  for (let i = 0; i < cognitionScores.length; i++) {
    if (cognitionScores[i] < 30) {
      if (favStart === -1) favStart = i;
    } else {
      flushFav(i);
    }
  }
  flushFav(cognitionScores.length);

  // 8. drop-risk：某章 total<40 且 wordCount>500；或连续 3 章 motivation<30
  for (let i = 0; i < chapters.length; i++) {
    const p = points[i];
    if (p.total < 40 && chapters[i].wordCount > 500) {
      issues.push({
        id: `empathy-dr-${now}-${chapters[i].id}`,
        type: 'drop-risk',
        chapterId: chapters[i].id,
        chapterTitle: chapters[i].title,
        description: `${chapters[i].title} 综合共情分仅 ${p.total} 且字数较多（${chapters[i].wordCount}），节奏拖沓/冲突乏力，弃书风险高`,
        suggestion: `压缩本章冗余描写或合并到前后章，前置一个冲突钩子；明确主角动机与失败代价，提升读者紧张感`,
        severity: 'warning',
      });
    }
  }
  let dropStart = -1;
  const flushDrop = (endIdx: number) => {
    if (dropStart !== -1 && endIdx - dropStart >= 3) {
      const seg = chapters.slice(dropStart, endIdx);
      issues.push({
        id: `empathy-dr-streak-${now}-${dropStart}`,
        type: 'drop-risk',
        chapterId: seg[0].id,
        chapterTitle: seg[0].title,
        description: `${seg[0].title} 起连续 ${seg.length} 章动机清晰度<30，读者难以理解主角为何坚持，弃书风险高`,
        suggestion: `在第一章节前段补一句主角的内心独白点明动机，并在后续章节强化动机的外化（行动/抉择），让读者重新代入`,
        severity: 'warning',
      });
    }
    dropStart = -1;
  };
  for (let i = 0; i < points.length; i++) {
    if (points[i].motivation < 30) {
      if (dropStart === -1) dropStart = i;
    } else {
      flushDrop(i);
    }
  }
  flushDrop(points.length);

  const overallScore = points.length > 0
    ? Math.round(points.reduce((s, p) => s + p.total, 0) / points.length)
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    scope: 'all',
    points,
    issues,
    overallScore,
  };
}

// ============================================================================
// 人物弧光三维追踪 / 角色维度情感一致性 / 节奏调校 AI 建议（规格书阶段4-2/4-3/4-5）
// ============================================================================

/**
 * 三维情绪/能力/认知关键词集合（Mock 启发式共享，规格书阶段4-3/4-5）。
 * 任务规格给定的关键词：
 *   情绪（泪/怒/笑/颤/痛/惊）、能力（击败/突破/领悟/掌控/单挑）、认知（明白/意识到/终于懂/看清/领悟）
 * 注：「领悟」同时出现在能力与认知集合中，符合规格描述，保留。
 */
const ARC_EMOTION_KEYWORDS = ['泪', '怒', '笑', '颤', '痛', '惊'];
const ARC_ABILITY_KEYWORDS = ['击败', '突破', '领悟', '掌控', '单挑'];
const ARC_COGNITION_KEYWORDS = ['明白', '意识到', '终于懂', '看清', '领悟'];

/**
 * 人物弧光三维追踪（规格书阶段4-3）。
 * 逐角色逐章评估 emotion/ability/cognition 三维 0-100，并标记 anomalies
 * （某维度相邻章跳变>40 为异常，给 reason + remedy）。
 *
 * - LLM 模式：调用 LLM 返回结构化 JSON 数组
 * - Mock 模式：基于角色名在各章正文出现次数 + 三维关键词计数估算
 *
 * 只对有出场（正文含角色名）的角色生成曲线；无出场角色跳过。
 */
export async function analyzeCharacterArcCurves(params: {
  chapters: Chapter[];
  characters: Character[];
}): Promise<CharacterArcCurve[]> {
  const { chapters, characters } = params;
  const topChapters = chapters.filter(c => c.levelType === 'chapter');
  if (topChapters.length === 0 || characters.length === 0) return [];

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const charDigest = characters.slice(0, 10).map(c => `- ${c.name}（ID:${c.id}，${c.role}）`).join('\n');
      const chapDigest = topChapters.slice(0, 25).map((c, i) => `第${i + 1}章「${c.title}」(ID:${c.id}): ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 120)}`).join('\n');

      const prompt = `请对下面这份大纲做人物弧光三维追踪，逐角色逐章评估三条演进曲线。

三维定义（0-100）：
- emotion：情绪强度（该角色在本章的情绪起伏幅度）
- ability：能力表现（该角色在本章展现的能力水平）
- cognition：认知转变（该角色在本章的认知/领悟程度）

异常检测：某维度相邻章跳变 > 40 视为异常，需给出 reason（原因）与 remedy（补救方案）。
- emotion 突兀：建议插入过渡段
- ability 越界：建议补铺垫
- cognition 跳跃：建议加内心独白

只对有出场的角色生成曲线（正文含角色名），无出场角色跳过。

返回 JSON 数组，每项形如：
{
  "characterId": "角色ID",
  "characterName": "角色名",
  "points": [
    {
      "chapterId": "章节ID",
      "chapterTitle": "章节标题",
      "emotion": 0-100,
      "ability": 0-100,
      "cognition": 0-100,
      "anomalies": [
        {"dimension":"emotion|ability|cognition","reason":"异常原因","remedy":"补救方案"}
      ]
    }
  ]
}

只返回 JSON 数组，无曲线返回 []。

【角色库】
${charDigest}

【大纲章节】
${chapDigest}
`;

      const result = await llmClient.callLLM(prompt, '你是资深小说人物弧光分析师，擅长追踪角色的情绪/能力/认知三维演进。只返回 JSON 数组。');
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const curves: CharacterArcCurve[] = [];
        parsed.forEach(raw => {
          if (!raw || typeof raw !== 'object') return;
          const r = raw as Record<string, unknown>;
          const characterId = String(r.characterId || '');
          const characterName = String(r.characterName || '').slice(0, 30);
          if (!characterId) return;
          const rawPoints = Array.isArray(r.points) ? r.points : [];
          const points: CharacterArcCurvePoint[] = [];
          for (const pp of rawPoints) {
            if (!pp || typeof pp !== 'object') continue;
            const p = pp as Record<string, unknown>;
            const ch = topChapters.find(c => c.id === String(p.chapterId || ''));
            const emotion = Math.max(0, Math.min(100, Math.round(Number(p.emotion) || 0)));
            const ability = Math.max(0, Math.min(100, Math.round(Number(p.ability) || 0)));
            const cognition = Math.max(0, Math.min(100, Math.round(Number(p.cognition) || 0)));
            const rawAnomalies = Array.isArray(p.anomalies) ? p.anomalies : [];
            const anomalies = rawAnomalies
              .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
              .map(a => {
                const dimension = String(a.dimension || 'emotion') as 'emotion' | 'ability' | 'cognition';
                const validDims: Array<'emotion' | 'ability' | 'cognition'> = ['emotion', 'ability', 'cognition'];
                return {
                  dimension: validDims.includes(dimension) ? dimension : 'emotion',
                  reason: String(a.reason || '').slice(0, 200),
                  remedy: String(a.remedy || '').slice(0, 300),
                };
              })
              .filter(a => a.reason || a.remedy);
            points.push({
              chapterId: ch?.id || String(p.chapterId || ''),
              chapterTitle: ch?.title || String(p.chapterTitle || ''),
              emotion,
              ability,
              cognition,
              anomalies,
            });
          }
          if (points.length > 0) {
            curves.push({ characterId, characterName, points });
          }
        });
        if (curves.length > 0) return curves;
      }
    } catch (e) {
      console.warn('AI analyzeCharacterArcCurves failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于角色名在各章正文出现次数 + 三维关键词计数估算
  return generateHeuristicArcCurves(topChapters, characters);
}

/**
 * Mock 启发式：基于角色名出现 + 三维关键词计数估算逐章三维值，
 * 相邻章某维度差>40 标异常，remedy 给通用建议。
 */
function generateHeuristicArcCurves(chapters: Chapter[], characters: Character[]): CharacterArcCurve[] {
  const curves: CharacterArcCurve[] = [];

  for (const char of characters) {
    const points: CharacterArcCurvePoint[] = [];
    for (const ch of chapters) {
      const text = ch.content || '';
      // 只对有出场的角色生成曲线：正文含角色名（或 characterFocus 标注）
      const appeared = text.includes(char.name) || ch.characterFocus?.includes(char.id);
      if (!appeared) continue;

      // 计算三维关键词命中数
      let emoHits = 0;
      let ablHits = 0;
      let cogHits = 0;
      for (const kw of ARC_EMOTION_KEYWORDS) if (text.includes(kw)) emoHits++;
      for (const kw of ARC_ABILITY_KEYWORDS) if (text.includes(kw)) ablHits++;
      for (const kw of ARC_COGNITION_KEYWORDS) if (text.includes(kw)) cogHits++;

      // 基础 20 + 关键词加成，上限 100
      const emotion = Math.min(100, 20 + emoHits * 14);
      const ability = Math.min(100, 20 + ablHits * 16);
      const cognition = Math.min(100, 20 + cogHits * 16);

      points.push({
        chapterId: ch.id,
        chapterTitle: ch.title,
        emotion,
        ability,
        cognition,
        anomalies: [], // 异常在下面统一检测
      });
    }

    if (points.length === 0) continue; // 无出场角色跳过

    // 异常检测：相邻章某维度差 > 40
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const anomalies: CharacterArcCurvePoint['anomalies'] = [];

      const checkDim = (
        dim: 'emotion' | 'ability' | 'cognition',
        prevVal: number,
        currVal: number,
      ) => {
        const diff = Math.abs(currVal - prevVal);
        if (diff > 40) {
          const direction = currVal > prevVal ? '骤升' : '骤降';
          let reason: string;
          let remedy: string;
          if (dim === 'emotion') {
            reason = `${char.name} 情绪强度${direction} ${diff}（${prevVal}→${currVal}），相邻章节情绪跳变突兀`;
            remedy = `在两章之间插入过渡段，用环境描写/旁白/小动作承接情绪落差，让情绪起伏更自然`;
          } else if (dim === 'ability') {
            reason = `${char.name} 能力表现${direction} ${diff}（${prevVal}→${currVal}），相邻章节能力越界`;
            remedy = `补铺垫：在前一章埋一个能力来源（师承/秘宝/觉醒/旧日经验），避免主角光环式突袭`;
          } else {
            reason = `${char.name} 认知转变${direction} ${diff}（${prevVal}→${currVal}），相邻章节认知跳跃`;
            remedy = `加内心独白：让角色在两章之间有一段自我对话或回想，铺垫认知转变的契机`;
          }
          anomalies.push({ dimension: dim, reason, remedy });
        }
      };
      checkDim('emotion', prev.emotion, curr.emotion);
      checkDim('ability', prev.ability, curr.ability);
      checkDim('cognition', prev.cognition, curr.cognition);

      if (anomalies.length > 0) {
        curr.anomalies = anomalies;
      }
    }

    curves.push({
      characterId: char.id,
      characterName: char.name,
      points,
    });
  }

  return curves;
}

/**
 * 角色维度情感一致性（规格书阶段4-5）。
 * 检测相邻章节同一角色的情绪跳转幅度（>50 为突兀），生成 CharacterArcIssue
 * （type='emotion-jump'，severity='warning'，suggestion 建议插入过渡段落）。
 * 同时输出 curves：每个角色的逐章 emotion 数值（0-100，基于情绪关键词计数）。
 *
 * - LLM 模式：prompt 要求逐角色逐章评估情绪强度并标记跳变
 * - Mock 模式：用情绪关键词计数 + 相邻差值检测
 * 复用任务1的情绪关键词集合（ARC_EMOTION_KEYWORDS）。
 */
export async function analyzeCharacterEmotionConsistency(params: {
  chapters: Chapter[];
  characters: Character[];
}): Promise<CharacterEmotionConsistencyReport> {
  const { chapters, characters } = params;
  const topChapters = chapters.filter(c => c.levelType === 'chapter');
  if (topChapters.length === 0 || characters.length === 0) {
    return { generatedAt: new Date().toISOString(), issues: [], curves: [] };
  }

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const charDigest = characters.slice(0, 10).map(c => `- ${c.name}（ID:${c.id}，${c.role}）`).join('\n');
      const chapDigest = topChapters.slice(0, 25).map((c, i) => `第${i + 1}章「${c.title}」(ID:${c.id}): ${(c.summary || c.content.replace(/<[^>]*>/g, '')).slice(0, 120)}`).join('\n');

      const prompt = `请对下面这份大纲做角色维度情感一致性校验，逐角色逐章评估情绪强度（0-100），并标记相邻章节的跳变。

只对有出场的角色生成曲线（正文含角色名），无出场角色跳过。

每个角色输出：
{
  "characterId": "角色ID",
  "characterName": "角色名",
  "points": [
    {"chapterId":"章节ID","chapterTitle":"章节标题","emotion":0-100}
  ],
  "jumps": [
    {
      "chapterId":"跳变发生章节ID",
      "chapterTitle":"章节标题",
      "fromEmotion": 前一章情绪,
      "toEmotion": 本章情绪,
      "description":"跳变说明"
    }
  ]
}

跳变判定：相邻章节情绪差 > 50 视为突兀。

返回 JSON 对象：
{"curves":[...],"issues":[...]}
其中 issues 每项形如：
{
  "id":"唯一ID",
  "characterId":"角色ID",
  "characterName":"角色名",
  "type":"emotion-jump",
  "chapterId":"触发章节ID",
  "chapterTitle":"触发章节标题",
  "description":"问题描述（不超过60字）",
  "suggestion":"可落地建议（不超过80字，建议插入过渡段落）",
  "severity":"warning"
}

只返回 JSON，不要其他说明。

【角色库】
${charDigest}

【大纲章节】
${chapDigest}
`;

      const result = await llmClient.callLLM(prompt, '你是资深小说人物情感分析师，擅长追踪角色情绪的连贯性。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<{ curves?: unknown; issues?: unknown }>(result);
      if (parsed && typeof parsed === 'object') {
        const rawCurves = Array.isArray(parsed.curves) ? parsed.curves : [];
        const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
        const curves: CharacterEmotionConsistencyReport['curves'] = rawCurves
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => {
            const characterId = String(r.characterId || '');
            const characterName = String(r.characterName || '').slice(0, 30);
            const rawPoints = Array.isArray(r.points) ? r.points : [];
            const points = rawPoints
              .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
              .map(p => {
                const ch = topChapters.find(c => c.id === String(p.chapterId || ''));
                return {
                  chapterId: ch?.id || String(p.chapterId || ''),
                  chapterTitle: ch?.title || String(p.chapterTitle || ''),
                  emotion: Math.max(0, Math.min(100, Math.round(Number(p.emotion) || 0))),
                };
              });
            return { characterId, characterName, points };
          })
          .filter(c => c.characterId && c.points.length > 0);
        const issues: CharacterArcIssue[] = rawIssues
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r, idx) => {
            const chapterId = r.chapterId ? String(r.chapterId) : undefined;
            const chapter = chapterId ? topChapters.find(c => c.id === chapterId) : undefined;
            return {
              id: String(r.id || `emo-jump-${Date.now()}-${idx}`),
              characterId: String(r.characterId || ''),
              characterName: String(r.characterName || '').slice(0, 30),
              type: 'emotion-jump' as const,
              chapterId: chapter?.id,
              chapterTitle: chapter?.title,
              description: String(r.description || '').slice(0, 200),
              suggestion: String(r.suggestion || '').slice(0, 300),
              severity: 'warning' as const,
            };
          });
        if (curves.length > 0) {
          return { generatedAt: new Date().toISOString(), issues, curves };
        }
      }
    } catch (e) {
      console.warn('AI analyzeCharacterEmotionConsistency failed, falling back to heuristic:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：用情绪关键词计数 + 相邻差值检测
  return generateHeuristicEmotionConsistencyReport(topChapters, characters);
}

/**
 * Mock 启发式：基于情绪关键词计数估算每角色逐章 emotion（0-100），
 * 相邻章差 > 50 标为 emotion-jump 问题（severity=warning，建议插入过渡段落）。
 */
function generateHeuristicEmotionConsistencyReport(
  chapters: Chapter[],
  characters: Character[],
): CharacterEmotionConsistencyReport {
  const curves: CharacterEmotionConsistencyReport['curves'] = [];
  const issues: CharacterArcIssue[] = [];
  const now = Date.now();

  for (const char of characters) {
    const points: Array<{ chapterId: string; chapterTitle: string; emotion: number }> = [];
    for (const ch of chapters) {
      const text = ch.content || '';
      // 只对有出场的角色生成曲线
      const appeared = text.includes(char.name) || ch.characterFocus?.includes(char.id);
      if (!appeared) continue;

      let emoHits = 0;
      for (const kw of ARC_EMOTION_KEYWORDS) if (text.includes(kw)) emoHits++;
      // 复用任务1的情绪关键词集合：基础 20 + 每个关键词 +14，上限 100
      const emotion = Math.min(100, 20 + emoHits * 14);
      points.push({ chapterId: ch.id, chapterTitle: ch.title, emotion });
    }

    if (points.length === 0) continue; // 无出场角色跳过

    // 相邻章差 > 50 标为 emotion-jump
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const diff = Math.abs(curr.emotion - prev.emotion);
      if (diff > 50) {
        const direction = curr.emotion > prev.emotion ? '骤升' : '骤降';
        issues.push({
          id: `emo-jump-${now}-${char.id}-${curr.chapterId}`,
          characterId: char.id,
          characterName: char.name,
          type: 'emotion-jump',
          chapterId: curr.chapterId,
          chapterTitle: curr.chapterTitle,
          description: `${char.name} 情绪强度${direction} ${diff}（${prev.emotion}→${curr.emotion}），相邻章节情绪跳转突兀`,
          suggestion: `在两章之间插入过渡段落，用环境描写/旁白/小动作承接情绪落差，或在前一章末尾埋一个情绪铺垫钩子`,
          severity: 'warning',
        });
      }
    }

    curves.push({
      characterId: char.id,
      characterName: char.name,
      points,
    });
  }

  return { generatedAt: new Date().toISOString(), issues, curves };
}

/**
 * 节奏调校 AI 建议（规格书阶段4-2）。
 * 创作者在节奏曲线上拖拽调整某章能量值后，AI 基于调整方向（拉高/压低）与章节上下文，
 * 产出落地操作建议 + 2-3 个变体方向。
 *
 * - LLM 模式：基于章节摘要 + 调整方向产出落地 advice + 2-3 个 variants
 * - Mock 模式：根据 direction 给模板化建议，variants 给 2-3 个变体方向
 * generatedAt 用 new Date().toISOString()。
 */
export async function generatePacingAdjustmentAdvice(params: {
  chapter: Chapter;
  dimension: 'external' | 'emotional';
  direction: 'raise' | 'lower';
  delta: number;
}): Promise<PacingAdjustmentAdvice> {
  const { chapter, dimension, direction, delta } = params;
  const safeDelta = Math.max(0, Math.round(delta));
  const plainSummary = (chapter.summary || chapter.content.replace(/<[^>]*>/g, '')).slice(0, 400);

  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();

  if (settings.provider !== 'mock') {
    try {
      const dimLabel = dimension === 'external' ? '外部能量（动作戏/冲突爆发/反转）' : '情感能量（内心抉择/关系转折/情绪爆发）';
      const dirLabel = direction === 'raise' ? '拉高' : '压低';
      const prompt = `请基于下面这个章节的摘要与调整方向，给出落地操作建议。

章节标题：${chapter.title}
章节摘要：${plainSummary || '（无）'}
调整维度：${dimLabel}
调整方向：${dirLabel}（幅度 ${safeDelta}）

要求：
- advice：一段 50-120 字的具体操作建议，落到情节方向（如"加入一场突发冲突或反转"），不要空喊"加强节奏"
- variants：2-3 个变体方向，每个 20-50 字，风格差异明显

返回 JSON 对象：
{"advice":"具体建议","variants":["变体1","变体2","变体3"]}
只返回 JSON，不要其他说明。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说节奏调校顾问，擅长把抽象的"加强/减弱节奏"落到具体情节操作。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<{ advice?: unknown; variants?: unknown }>(result);
      if (parsed && typeof parsed === 'object' && typeof parsed.advice === 'string' && parsed.advice.trim()) {
        const advice = parsed.advice.slice(0, 500);
        const variants = Array.isArray(parsed.variants)
          ? (parsed.variants as unknown[]).map(v => String(v).slice(0, 200)).filter(Boolean).slice(0, 3)
          : [];
        return {
          chapterId: chapter.id,
          dimension,
          direction,
          delta: safeDelta,
          advice,
          variants: variants.length > 0 ? variants : [advice],
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (e) {
      console.warn('AI generatePacingAdjustmentAdvice failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(400);
  // Mock：根据 direction + dimension 给模板化建议
  return generateMockPacingAdvice(chapter, dimension, direction, safeDelta, plainSummary);
}

/** Mock：模板化节奏调校建议，variants 给 2-3 个变体方向 */
function generateMockPacingAdvice(
  chapter: Chapter,
  dimension: 'external' | 'emotional',
  direction: 'raise' | 'lower',
  delta: number,
  plainSummary: string,
): PacingAdjustmentAdvice {
  const dimLabel = dimension === 'external' ? '外部能量' : '情感能量';
  // 4 种组合的模板化建议与变体
  const templates: Record<'raise' | 'lower', Record<'external' | 'emotional', { advice: string; variants: string[] }>> = {
    raise: {
      external: {
        advice: `为《${chapter.title}》拉高${dimLabel}（+${delta}）：加入一场突发冲突或反转——如敌对势力突袭、关键真相曝光、原本平静的局面被外部事件打破，把主角逼到必须立即行动的处境。`,
        variants: [
          '突袭型：敌人/对手主动出击，主角被迫应战，节奏骤紧',
          '反转型：盟友反水或关键信息被推翻，原本稳态被打破',
          '环境型：自然灾害/事故/时间限制叠加，外部压力骤升',
        ],
      },
      emotional: {
        advice: `为《${chapter.title}》拉高${dimLabel}（+${delta}）：强化角色内心抉择或关系转折——如道德两难、至亲受威胁、信任崩塌或和解，让情绪爆发有具体的触发点与代价。`,
        variants: [
          '抉择型：道德两难逼迫主角做出痛苦选择，内心撕裂',
          '关系型：亲密者背叛/和解/告白，关系温度骤变',
          '创伤型：旧日创伤被触发，情绪决堤，行为失控',
        ],
      },
    },
    lower: {
      external: {
        advice: `为《${chapter.title}》压低${dimLabel}（-${delta}）：插入冷静的复盘或日常过渡——让主角暂离前线，整理线索、与盟友商议、或处理一段日常琐事，给读者喘息与信息消化空间。`,
        variants: [
          '复盘型：主角与盟友围坐复盘战况，整理线索与下一步',
          '日常型：插入一段日常互动（吃饭/休整/闲聊），舒缓节奏',
          '铺垫型：用文戏铺垫后续冲突（情报/拜访/观察），蓄势待发',
        ],
      },
      emotional: {
        advice: `为《${chapter.title}》压低${dimLabel}（-${delta}）：插入冷静的复盘或日常过渡——让角色从情绪高点回落，通过独白、环境描写或日常对话承接情绪，给读者情感喘息口。`,
        variants: [
          '独白型：角色自我对话/日记/回想，消化前段情绪',
          '环境型：用环境描写（天气/景色/夜色）映射情绪回落',
          '日常型：日常对话/小互动冲淡高压，恢复人际温度',
        ],
      },
    },
  };

  const tpl = templates[direction][dimension];
  // 若章节摘要非空，advice 末尾补一句上下文提示，避免完全脱离章节
  const ctxHint = plainSummary ? ` 结合本章内容「${plainSummary.slice(0, 40)}…」自然衔接。` : '';
  return {
    chapterId: chapter.id,
    dimension,
    direction,
    delta,
    advice: tpl.advice + ctxHint,
    variants: tpl.variants,
    generatedAt: new Date().toISOString(),
  };
}
