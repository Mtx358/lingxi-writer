import type { ProjectSettingCard, Chapter, Character, Foreshadow, BlueprintOverview, BlueprintChangeImpact, PlotTurnPoint, GrowthArcSegment, CharacterFateSegment, VolumeOverview } from '@/types';
import { parseJsonFromLLM, getLLMClient } from './core';

// ============================================================================
// 灵犀助手扩展能力域
// ============================================================================

/**
 * 生成核心设定卡的深化追问（灵犀设定 1.1）。
 * 基于当前已填字段，提出 3-5 个能深化故事的具体问题。
 */
export async function generateCoreSettingCardQuestions(
  card: ProjectSettingCard,
): Promise<string[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = `请基于以下核心设定卡，提出 4 个能深化故事的问题。
每个问题要具体、可回答，帮助创作者把模糊的想法磨出细节。
返回 JSON 字符串数组，如 ["问题1","问题2","问题3","问题4"]。

【书名】${card.title}
【类型标签】${card.genreTags.join(' / ') || '（未填）'}
【卖点】${card.sellingPoint || '（未填）'}
【主角】${card.protagonist.name || '（未命名）'}｜性格：${card.protagonist.personalityKeywords.join('、') || '（未填）'}
【核心欲望】${card.protagonist.coreDesire || '（未填）'}
【致命弱点】${card.protagonist.fatalFlaw || '（未填）'}
【金手指】${card.protagonist.goldenFinger || '（未填）'}
【世界观】${card.worldview.basicRules || '（未填）'}
【力量体系】${card.worldview.powerSystem || '（未填）'}
【核心冲突】${card.coreConflict.mainConflict || '（未填）'}
【终极目标】${card.coreConflict.ultimateGoal || '（未填）'}
【情感基调】${card.emotionalTone}
【感情线】${card.romanceType}

只返回 JSON 数组。`;
      const result = await llmClient.callLLM(prompt, '你是资深小说创作教练，擅长用追问帮创作者深化设定。只返回 JSON 数组。');
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        const questions = parsed
          .filter((q): q is string => typeof q === 'string')
          .map(q => q.slice(0, 200))
          .filter(Boolean);
        if (questions.length > 0) return questions.slice(0, 5);
      }
    } catch (e) {
      console.warn('AI generateCoreSettingCardQuestions failed:', e);
    }
  }

  await llmClient.delay(300);
  // Mock：基于空字段给出针对性问题
  const qs: string[] = [];
  if (!card.protagonist.coreDesire) qs.push('主角真正想要的是什么？这个欲望从何而来，又会把他推向哪里？');
  if (!card.protagonist.fatalFlaw) qs.push('主角最大的弱点是什么？这个弱点会在什么关键时刻反噬他？');
  if (!card.protagonist.goldenFinger) qs.push('主角的金手指/特殊能力是什么？它有没有代价或限制？');
  if (!card.coreConflict.mainConflict) qs.push('核心冲突是什么？谁/什么阻挡主角得到他想要的？');
  if (!card.worldview.powerSystem) qs.push('世界观中的力量体系是怎样的？主角处于什么位置？');
  if (qs.length === 0) {
    qs.push('主角的初始身份与最终归宿之间，最大的转变点是什么？');
    qs.push('反派的核心动机是什么？他与主角的对立为什么不可调和？');
    qs.push('故事的第一卷结尾要留下什么钩子让读者追下去？');
    qs.push('主角的金手指在什么时机、以什么方式首次登场？');
  }
  return qs.slice(0, 4);
}

/**
 * 检查核心设定卡的矛盾点（灵犀设定 1.1）。
 */
export async function checkSettingCardContradictions(
  card: ProjectSettingCard,
): Promise<{ description: string; severity: 'error' | 'warning'; resolved: boolean }[]> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const prompt = `请检查以下核心设定卡是否存在内在矛盾或漏洞，返回 JSON 数组。
每条包含：
{
  "description": "矛盾描述（30-80字）",
  "severity": "error|warning"
}

【书名】${card.title}
【主角】${card.protagonist.name}｜性格：${card.protagonist.personalityKeywords.join('、')}
【核心欲望】${card.protagonist.coreDesire || '（未填）'}
【致命弱点】${card.protagonist.fatalFlaw || '（未填）'}
【金手指】${card.protagonist.goldenFinger || '（未填）'}
【成长弧光】${card.protagonist.growthArc || '（未填）'}
【世界观】${JSON.stringify(card.worldview)}
【核心冲突】${JSON.stringify(card.coreConflict)}
【情感基调】${card.emotionalTone}
【感情线】${card.romanceType}

若无矛盾返回 []。只返回 JSON 数组。`;
      const result = await llmClient.callLLM(prompt, '你是严谨的故事顾问，擅长发现设定中的矛盾。只返回 JSON 数组。');
      const parsed = parseJsonFromLLM<unknown>(result);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            description: String(r.description || '').slice(0, 200),
            severity: r.severity === 'error' ? 'error' as const : 'warning' as const,
            resolved: false,
          }))
          .filter(c => c.description);
      }
    } catch (e) {
      console.warn('AI checkSettingCardContradictions failed:', e);
    }
  }
  await llmClient.delay(300);
  return [];
}

/**
 * 生成全局走向概览（灵犀蓝图 2.1）。
 */
export async function generateBlueprintOverview(
  card: ProjectSettingCard,
  chapters: Chapter[],
  characters: Character[],
): Promise<BlueprintOverview> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  const topChapters = chapters.filter(c => c.levelType === 'chapter');

  if (settings.provider !== 'mock') {
    try {
      const chapterDigest = topChapters.slice(0, 30).map((c, i) => `第${i + 1}章「${c.title}」: ${(c.summary || '').slice(0, 80)}`).join('\n');
      const charDigest = characters.slice(0, 8).map(c => `- ${c.name}（${c.role}）：${c.profile?.personality || ''}`).join('\n');

      const prompt = `请基于以下核心设定与已有章节，生成《全局走向概览》。
返回 JSON：
{
  "mainline": "主线一句话",
  "startPoint": "起点状态（30-60字）",
  "turnPoints": [
    {"progress": 30, "title": "转折标题", "description": "（30-80字）"}
  ],
  "endPoint": "终点（30-60字）",
  "growthArc": [
    {"volumeIndex": 1, "fromState": "初始状态", "experiences": "经历什么", "toState": "变成什么"}
  ],
  "characterFates": [
    {"characterName": "角色名", "keyNodes": "关键节点与结局", "ending": "最终归宿"}
  ],
  "volumes": [
    {"index": 1, "title": "卷名", "chapterRange": "第1-30章", "coreTask": "本卷核心任务", "endingHook": "结尾钩子"}
  ]
}

【核心设定卡】
书名：${card.title}
类型：${card.genreTags.join(' / ')}
主角：${card.protagonist.name}｜${card.protagonist.personalityKeywords.join('、')}
核心欲望：${card.protagonist.coreDesire || '（未填）'}
致命弱点：${card.protagonist.fatalFlaw || '（未填）'}
金手指：${card.protagonist.goldenFinger || '（未填）'}
成长弧光：${card.protagonist.growthArc || '（未填）'}
核心冲突：${card.coreConflict.mainConflict || '（未填）'}
终极目标：${card.coreConflict.ultimateGoal || '（未填）'}
情感基调：${card.emotionalTone}

【已有章节】
${chapterDigest || '（无，纯新项目）'}

【角色】
${charDigest || '（无）'}

只返回 JSON 对象。`;
      const result = await llmClient.callLLM(prompt, '你是资深小说策划，擅长规划长篇网文走向。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed && typeof parsed === 'object') {
        const turnPoints: PlotTurnPoint[] = Array.isArray(parsed.turnPoints)
          ? parsed.turnPoints
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map(r => ({
                progress: Math.max(0, Math.min(100, Number(r.progress) || 0)),
                title: String(r.title || '').slice(0, 60),
                description: String(r.description || '').slice(0, 200),
              }))
              .filter(t => t.title)
          : [];
        const growthArc: GrowthArcSegment[] = Array.isArray(parsed.growthArc)
          ? parsed.growthArc
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map(r => ({
                volumeIndex: Number(r.volumeIndex) || 1,
                fromState: String(r.fromState || '').slice(0, 100),
                experiences: String(r.experiences || '').slice(0, 200),
                toState: String(r.toState || '').slice(0, 100),
              }))
              .filter(g => g.fromState || g.toState)
          : [];
        const characterFates: CharacterFateSegment[] = Array.isArray(parsed.characterFates)
          ? parsed.characterFates
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map(r => ({
                characterName: String(r.characterName || '').slice(0, 30),
                keyNodes: String(r.keyNodes || '').slice(0, 300),
                ending: r.ending ? String(r.ending).slice(0, 100) : undefined,
              }))
              .filter(c => c.characterName)
          : [];
        const volumes: VolumeOverview[] = Array.isArray(parsed.volumes)
          ? parsed.volumes
              .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
              .map(r => ({
                index: Number(r.index) || 1,
                title: String(r.title || '').slice(0, 60),
                chapterRange: String(r.chapterRange || '').slice(0, 40),
                coreTask: String(r.coreTask || '').slice(0, 200),
                endingHook: r.endingHook ? String(r.endingHook).slice(0, 150) : undefined,
              }))
              .filter(v => v.title)
          : [];
        return {
          mainline: String(parsed.mainline || '').slice(0, 200),
          startPoint: String(parsed.startPoint || '').slice(0, 200),
          turnPoints,
          endPoint: String(parsed.endPoint || '').slice(0, 200),
          growthArc,
          characterFates,
          volumes,
          lockedAt: null,
          updatedAt: new Date().toISOString(),
        };
      }
    } catch (e) {
      console.warn('AI generateBlueprintOverview failed, falling back to mock:', e);
    }
  }

  await llmClient.delay(500);
  // Mock：基于设定卡字段拼装可读概览
  const protagonistName = card.protagonist.name || '主角';
  const desire = card.protagonist.coreDesire || '达成目标';
  return {
    mainline: `${protagonistName}为「${desire}」展开一段${card.emotionalTone === 'cool' ? '爽快逆袭' : '跌宕起伏'}的旅程`,
    startPoint: `${protagonistName}处于初始身份${card.protagonist.initialIdentity ? `（${card.protagonist.initialIdentity}）` : ''}，因${card.coreConflict.mainConflict || '某事件'}被推入故事`,
    turnPoints: [
      { progress: 30, title: '初露锋芒', description: `${protagonistName}获得金手指/机会，第一次主动出击` },
      { progress: 50, title: '真相浮现', description: '冲突升级，幕后真相开始浮现' },
      { progress: 70, title: '最大危机', description: '最大反转或最大危机出现，主角陷入绝境' },
    ],
    endPoint: `${protagonistName}达成${card.coreConflict.ultimateGoal || '终极目标'}，完成从初始到终局的转变`,
    growthArc: [{
      volumeIndex: 1,
      fromState: '平凡/被动',
      experiences: '获得能力、结识同伴、第一次直面冲突',
      toState: '主动出击，但仍有局限',
    }],
    characterFates: [{
      characterName: protagonistName,
      keyNodes: '初始 → 转变 → 觉醒 → 终局',
      ending: '完成成长弧光',
    }],
    volumes: [{
      index: 1,
      title: '第一卷',
      chapterRange: '第1-30章',
      coreTask: '建立主角、世界观与核心冲突',
      endingHook: '留下悬念引入第二卷',
    }],
    lockedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 蓝图改动影响报告（灵犀蓝图 2.5）——解锁后修改时生成。
 */
export async function generateBlueprintChangeImpact(
  changeDescription: string,
  blueprint: BlueprintOverview,
  chapters: Chapter[],
  foreshadows: Foreshadow[],
): Promise<BlueprintChangeImpact> {
  const llmClient = getLLMClient();
  const settings = llmClient.getSettings();
  if (settings.provider !== 'mock') {
    try {
      const volumeDigest = blueprint.volumes.map(v => `第${v.index}卷《${v.title}》: ${v.coreTask}`).join('\n');
      const foreshadowDigest = foreshadows.slice(0, 10).map(f => `- 《${f.title}》：${f.status}`).join('\n');
      const chapterDigest = chapters.filter(c => c.levelType === 'chapter').slice(0, 15).map((c, i) => `第${i + 1}章「${c.title}」`).join('\n');

      const prompt = `请评估对蓝图的以下改动会波及哪些范围，返回 JSON：
{
  "affectedVolumes": [1, 2],
  "affectedChapters": ["章节ID或标题片段"],
  "affectedForeshadows": ["伏笔标题片段"],
  "riskLevel": "high|medium|low",
  "suggestion": "落地建议（50-150字）"
}

【改动描述】
${changeDescription}

【蓝图分卷】
${volumeDigest || '（无）'}

【章节】
${chapterDigest || '（无）'}

【伏笔】
${foreshadowDigest || '（无）'}

只返回 JSON 对象。`;
      const result = await llmClient.callLLM(prompt, '你是严谨的故事架构师，擅长评估改动连锁影响。只返回 JSON 对象。');
      const parsed = parseJsonFromLLM<Record<string, unknown>>(result);
      if (parsed && typeof parsed === 'object') {
        const validRisk = ['high', 'medium', 'low'];
        return {
          changeDescription,
          affectedVolumes: Array.isArray(parsed.affectedVolumes)
            ? parsed.affectedVolumes.filter((n): n is number => typeof n === 'number')
            : [],
          affectedChapters: Array.isArray(parsed.affectedChapters)
            ? parsed.affectedChapters.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 60))
            : [],
          affectedForeshadows: Array.isArray(parsed.affectedForeshadows)
            ? parsed.affectedForeshadows.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 60))
            : [],
          riskLevel: validRisk.includes(String(parsed.riskLevel)) ? String(parsed.riskLevel) as 'high' | 'medium' | 'low' : 'medium',
          suggestion: String(parsed.suggestion || '').slice(0, 300),
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (e) {
      console.warn('AI generateBlueprintChangeImpact failed, falling back to mock:', e);
    }
  }
  await llmClient.delay(400);
  // Mock：基于改动描述关键词粗略判定
  const lower = changeDescription.toLowerCase();
  let risk: 'high' | 'medium' | 'low' = 'low';
  if (lower.includes('删除') || lower.includes('移除') || lower.includes('主角') || lower.includes('结局')) risk = 'high';
  else if (lower.includes('调整') || lower.includes('提前') || lower.includes('延后') || lower.includes('替换')) risk = 'medium';
  return {
    changeDescription,
    affectedVolumes: risk === 'high' ? [1, 2] : [1],
    affectedChapters: [],
    affectedForeshadows: [],
    riskLevel: risk,
    suggestion: risk === 'high'
      ? '高风险改动：建议先在副本/快照中验证，确认无误后再应用到定稿'
      : risk === 'medium'
      ? '中风险改动：检查相关伏笔回收节奏与角色动机连贯性'
      : '低风险改动：可直接应用，但仍需检查相邻章节衔接',
    generatedAt: new Date().toISOString(),
  };
}
