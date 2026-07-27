import type { Chapter, Character, Foreshadow, OutlineIssue, OutlinePolishDimension, OutlineExpansionOption, ChapterBeat, Material, StructureVariant, ConflictLayer } from '@/types';
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
): Promise<OutlineExpansionOption[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const plainSummary = (chapter.summary || chapter.content.replace(/<[^>]*>/g, '')).slice(0, 500);

  if (settings.provider !== 'mock') {
    try {
      const charContext = characters.slice(0, 5).map(c => `${c.name}（${c.role}）：${c.profile?.personality || ''}｜目标：${c.profile?.goal || '未指定'}`).join('\n');
      const prompt = `请为下面这个过于单薄的大纲节点生成 3 个富有张力的发展方案。

要求：
- 每个方案包含 title（4-10字标题）、content（50-100字描述）、dramaticTension（该方案引入的冲突/张力点，20-40字）
- 方案之间风格差异明显（如：意外介入/情感冲突/外部环境）
- 必须基于上下文与角色设定，不得引入未设定的角色或世界观元素
- 用 JSON 数组返回，格式：[{"title":"","content":"","dramaticTension":""}]

只返回 JSON 数组，不要其他内容。

【大纲节点】
标题：${chapter.title}
摘要：${plainSummary || '（无摘要）'}

【相关角色】
${charContext || '（未指定角色）'}
`;
      const result = await llmClient.callLLM(prompt, '你是一位资深小说结构编辑，擅长扩展单薄大纲节点为富有张力的情节。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const options: OutlineExpansionOption[] = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            title: String(r.title || '').slice(0, 30),
            content: String(r.content || '').slice(0, 200),
            dramaticTension: String(r.dramaticTension || '').slice(0, 100),
          }))
          .filter(o => o.title && o.content);
        if (options.length > 0) return options.slice(0, 3);
      }
    } catch (e) {
      console.warn('AI expandOutlineNode failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于章节标题关键词生成可读方案
  return generateMockExpansionOptions(chapter, plainSummary);
}

function generateMockExpansionOptions(chapter: Chapter, plainSummary: string): OutlineExpansionOption[] {
  const title = chapter.title;
  const has = (kw: string) => title.includes(kw) || plainSummary.includes(kw);

  if (has('遇险') || has('危险') || has('被困')) {
    return [
      { title: '意外卷入阴谋', content: '主角在脱困过程中意外发现更大的阴谋，被迫卷入漩涡，必须依靠智慧与盟友破局。', dramaticTension: '从被动脱困到主动揭开真相，主角立场反转' },
      { title: '隐藏技能暴露', content: '绝境中主角被迫使用一直隐藏的特殊能力，引起多方势力注意，平静生活被打破。', dramaticTension: '秘密外泄引发新的追捕与拉拢' },
      { title: '陌生援手', content: '一位身份不明的陌生人出手相助，但提出的代价让主角陷入两难抉择。', dramaticTension: '信任与代价的博弈，引出新角色' },
    ];
  }
  if (has('决裂') || has('冲突') || has('争吵')) {
    return [
      { title: '隐瞒信件曝光', content: '一方发现对方长期隐瞒的关键信件，信任彻底崩塌，决裂背后藏着更深的隐情。', dramaticTension: '从情绪冲突升级为信任危机' },
      { title: '第三方介入', content: '局外人有意无意地点破双方各自隐瞒的事实，决裂演变成三方对峙。', dramaticTension: '引入新视角，重构冲突格局' },
      { title: '共同敌人逼和', content: '决裂之际共同威胁出现，两人被迫暂时联手，但裂痕已深，合作中暗藏试探。', dramaticTension: '敌我关系模糊，张力持续' },
    ];
  }
  // 通用扩展
  return [
    { title: '意外转折', content: '在原有情节走向中加入一个意外事件，打破主角预期，迫使其重新评估局势。', dramaticTension: '预期落空，主角陷入被动' },
    { title: '角色秘密浮现', content: '某个看似次要的角色在此节点暴露出关键秘密，重塑前期情节的意义。', dramaticTension: '信息倒错，前文铺垫激活' },
    { title: '环境压力升级', content: '外部环境（天气/地理/社会）骤变，给原本就紧张的局面叠加不可控因素。', dramaticTension: '人与环境的双重博弈' },
  ];
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
  "suggestedHierarchy": ["卷", "章"]
}

三种结构应分别对应：经典线性、双线/多线交织、多视角罗生门。
只返回 JSON 数组。`;

      const result = await llmClient.callLLM(prompt, '你是资深小说结构编辑，擅长为作品搭骨架。只返回 JSON 数组。');
      // 使用括号平衡算法提取 JSON，正确处理嵌套结构（贪婪/非贪婪正则都会出错）
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const variants = parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r, idx) => ({
            id: `variant-${Date.now()}-${idx}`,
            name: String(r.name || '').slice(0, 30),
            description: String(r.description || '').slice(0, 200),
            pros: String(r.pros || '').slice(0, 120),
            cons: String(r.cons || '').slice(0, 120),
            fitScenarios: String(r.fitScenarios || '').slice(0, 120),
            suggestedHierarchy: Array.isArray(r.suggestedHierarchy)
              ? (r.suggestedHierarchy as unknown[]).map(s => String(s)).slice(0, 4)
              : ['卷', '章'],
          }))
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
    },
    {
      id: `variant-${Date.now()}-2`,
      name: '双线交织',
      description: '当下与过往两条时间线并行推进，在中点汇合揭示关键真相，制造悬念与对照。',
      pros: '悬念感强，过去与现在互文，结构有层次',
      cons: '双线节奏把控要求高，易出现主线模糊',
      fitScenarios: '悬疑、复仇、家族史诗类作品',
      suggestedHierarchy: ['卷', '章'],
    },
    {
      id: `variant-${Date.now()}-3`,
      name: '多视角罗生门',
      description: '每卷换一个核心视角，同一事件被不同人物叙述，逐步拼凑出真相全貌。',
      pros: '信息层次丰富，人物立体，揭示真相极具张力',
      cons: '视角切换需要明确动机，读者代入门槛较高',
      fitScenarios: '群像、悬疑、争议事件题材',
      suggestedHierarchy: ['卷', '章'],
    },
  ];
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
