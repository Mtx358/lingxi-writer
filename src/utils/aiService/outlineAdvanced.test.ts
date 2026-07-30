/**
 * src/utils/aiService/outline.ts 末尾 5 个 AI 函数的单元测试
 *
 * 覆盖：
 *   - deepAskInspirationCard：灵感卡深度提问（mock + 非 mock 路径）
 *   - generateStoryLink：智能连线（mock + 非 mock 路径）
 *   - analyzeCharacterArcIssues：人物弧光校验（mock + 非 mock 路径）
 *   - analyzeRelationshipTemperature：关系温度曲线（mock + 非 mock 路径）
 *   - runPacingPressureTest：节奏压力测试（mock + 非 mock 路径）
 *
 * 测试策略：
 *   - setLLMClient 注入 mock LLMClient（参考 expand.test.ts 的注入模式）
 *   - mock 模式：getSettings 返回 { provider: 'mock' }，不调用 callLLM
 *   - 非 mock 模式：getSettings 返回 { provider: 'openai' }，控制 callLLM 返回值
 *   - mockClient.delay 必须是 vi.fn(() => Promise.resolve())，否则 mock 模式会卡住
 *   - parseJsonFromLLM 能处理 markdown 代码块包裹的 JSON（```json ... ```）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLLMClient, getLLMClient } from './core';
import {
  deepAskInspirationCard,
  generateStoryLink,
  analyzeCharacterArcIssues,
  analyzeRelationshipTemperature,
  runPacingPressureTest,
} from './outline';
import { type LLMClient } from '../llmClient';
import type { InspirationCard, Chapter, Character } from '@/types';

// ============ 测试 fixtures ============

const mockCard = (overrides: Partial<InspirationCard> = {}): InspirationCard => ({
  id: 'card-1',
  projectId: 'proj-1',
  type: 'character',
  title: '退休杀手',
  content: '一个退休的杀手在老年大学重逢了旧敌',
  createdAt: '2026-07-27T00:00:00Z',
  ...overrides,
});

const mockChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'ch-1',
  projectId: 'proj-1',
  parentId: null,
  title: '第一章 相遇',
  summary: '主角与旧敌重逢',
  order: 1,
  level: 1,
  levelType: 'chapter',
  status: 'draft',
  wordCount: 1000,
  content: '主角在老年大学遇到了旧敌，两人对视片刻。',
  createdAt: '2026-07-27T00:00:00Z',
  updatedAt: '2026-07-27T00:00:00Z',
  ...overrides,
});

const mockCharacter = (overrides: Partial<Character> = {}): Character => ({
  id: 'char-1',
  projectId: 'proj-1',
  name: '李退',
  role: 'protagonist',
  color: '#3b82f6',
  profile: {
    personality: '谨慎、优柔寡断',
    skills: '枪法、伪装',
  },
  relationships: [],
  appearanceCount: 0,
  dialogueCount: 0,
  tags: [],
  createdAt: '2026-07-27T00:00:00Z',
  updatedAt: '2026-07-27T00:00:00Z',
  ...overrides,
});

// ============ 共享 setup ============

describe('outline.ts 高级 AI 函数', () => {
  let originalClient: LLMClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    originalClient = getLLMClient();
    // 默认 mock provider；非 mock 模式的子 describe 会覆写 getSettings
    mockClient = {
      getSettings: vi.fn(() => ({ provider: 'mock' })),
      callLLM: vi.fn(),
      ensureHtmlParagraphs: vi.fn((s: string) => `<p>${s}</p>`),
      clampScore: vi.fn(() => 50),
      delay: vi.fn(() => Promise.resolve()),
      updateSettings: vi.fn(),
      getTotalTokensUsed: vi.fn(() => 0),
      testConnection: vi.fn(),
    };
    setLLMClient(mockClient);
  });

  afterEach(() => {
    setLLMClient(originalClient);
    vi.restoreAllMocks();
  });

  // ==================== deepAskInspirationCard ====================
  describe('deepAskInspirationCard', () => {
    describe('mock 模式', () => {
      it('character 类型卡返回 5 个问题，dimension 包含秘密/创伤/伪装/动机/底线', async () => {
        const result = await deepAskInspirationCard(mockCard({ type: 'character' }));
        expect(result).toHaveLength(5);
        const dims = result.map(q => q.dimension);
        expect(dims).toEqual(expect.arrayContaining(['秘密', '创伤', '伪装', '动机', '底线']));
      });

      it('concept 类型卡返回 4 个问题', async () => {
        const result = await deepAskInspirationCard(mockCard({ type: 'concept' }));
        expect(result).toHaveLength(4);
      });

      it('scene 类型卡返回 5 个问题', async () => {
        const result = await deepAskInspirationCard(mockCard({ type: 'scene' }));
        expect(result).toHaveLength(5);
      });

      it('dialogue 类型卡返回 4 个问题', async () => {
        const result = await deepAskInspirationCard(mockCard({ type: 'dialogue' }));
        expect(result).toHaveLength(4);
      });

      it('setting 类型卡返回 4 个问题', async () => {
        const result = await deepAskInspirationCard(mockCard({ type: 'setting' }));
        expect(result).toHaveLength(4);
      });

      it('plot 类型卡返回 4 个问题', async () => {
        const result = await deepAskInspirationCard(mockCard({ type: 'plot' }));
        expect(result).toHaveLength(4);
      });

      it('每个问题的 question 都包含卡片标题', async () => {
        const title = '独孤求败';
        const card = mockCard({ type: 'character', title });
        const result = await deepAskInspirationCard(card);
        expect(result.length).toBeGreaterThan(0);
        for (const q of result) {
          expect(q.question).toContain(title);
        }
      });
    });

    describe('非 mock 模式', () => {
      beforeEach(() => {
        mockClient.getSettings = vi.fn(() => ({
          provider: 'openai',
          apiKey: 'sk-test',
          strictness: 50,
          temperature: 0.7,
        }));
      });

      it('callLLM 返回合法 JSON 数组 → 解析为 MaterialQuestion[]', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
          { dimension: '秘密', question: '他的秘密是什么？' },
          { dimension: '创伤', question: '他的创伤是什么？' },
        ]));
        const result = await deepAskInspirationCard(mockCard({ type: 'character' }));
        expect(result).toHaveLength(2);
        expect(result[0].dimension).toBe('秘密');
        expect(result[0].question).toBe('他的秘密是什么？');
        expect(result[1].dimension).toBe('创伤');
        expect(result[1].question).toBe('他的创伤是什么？');
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
      });

      it('callLLM 返回带 markdown 代码块的 JSON → parseJsonFromLLM 仍能解析', async () => {
        const json = JSON.stringify([
          { dimension: '秘密', question: '秘密问题？' },
        ]);
        const wrapped = '```json\n' + json + '\n```';
        mockClient.callLLM = vi.fn().mockResolvedValue(wrapped);
        const result = await deepAskInspirationCard(mockCard({ type: 'character' }));
        expect(result).toHaveLength(1);
        expect(result[0].dimension).toBe('秘密');
        expect(result[0].question).toBe('秘密问题？');
      });

      it('callLLM 返回空数组 → fallback 到 mock', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue('[]');
        const result = await deepAskInspirationCard(mockCard({ type: 'character' }));
        // fallback 到 mock：character 类型返回 5 个
        expect(result).toHaveLength(5);
        const dims = result.map(q => q.dimension);
        expect(dims).toEqual(expect.arrayContaining(['秘密', '创伤', '伪装', '动机', '底线']));
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
      });

      it('callLLM 抛错 → fallback 到 mock（不抛异常）', async () => {
        mockClient.callLLM = vi.fn().mockRejectedValue(new Error('API error'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await deepAskInspirationCard(mockCard({ type: 'character' }));
        expect(result).toHaveLength(5);
        expect(warnSpy).toHaveBeenCalledWith(
          'AI deepAskInspirationCard failed, falling back to mock:',
          expect.any(Error),
        );
        warnSpy.mockRestore();
      });

      it('existingChildren 参数被用于避免重复问题', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
          { dimension: '秘密', question: '问题1' },
        ]));
        const existingChildren: InspirationCard[] = [
          mockCard({
            id: 'child-1',
            title: '已问问题1',
            dimension: '秘密',
            parentId: 'card-1',
          }),
        ];
        await deepAskInspirationCard(mockCard(), existingChildren);
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
        const promptArg = mockClient.callLLM.mock.calls[0][0] as string;
        // childDigest 形如 "已问 1：[秘密] 已问问题1" 应被拼入 prompt
        expect(promptArg).toContain('已问 1');
        expect(promptArg).toContain('已问问题1');
        expect(promptArg).toContain('避免重复');
      });
    });
  });

  // ==================== generateStoryLink ====================
  describe('generateStoryLink', () => {
    describe('mock 模式', () => {
      it('返回 narrative 包含两张卡片标题', async () => {
        const source = mockCard({ id: 'card-a', title: '起点卡片' });
        const target = mockCard({ id: 'card-b', title: '终点卡片' });
        const result = await generateStoryLink(source, target);
        expect(result.narrative).toContain('起点卡片');
        expect(result.narrative).toContain('终点卡片');
      });

      it('narrative 包含"转折"关键词', async () => {
        const result = await generateStoryLink(mockCard(), mockCard({ id: 'card-2' }));
        expect(result.narrative).toContain('转折');
      });

      it('mock 模式不返回 note', async () => {
        const result = await generateStoryLink(mockCard(), mockCard({ id: 'card-2' }));
        expect(result.note).toBeUndefined();
      });
    });

    describe('非 mock 模式', () => {
      beforeEach(() => {
        mockClient.getSettings = vi.fn(() => ({
          provider: 'openai',
          apiKey: 'sk-test',
          strictness: 50,
          temperature: 0.7,
        }));
      });

      it('callLLM 返回 { narrative, note } → 都返回', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify({
          narrative: '一段叙事脉络',
          note: '创作提示',
        }));
        const result = await generateStoryLink(mockCard(), mockCard({ id: 'card-2' }));
        expect(result.narrative).toBe('一段叙事脉络');
        expect(result.note).toBe('创作提示');
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
      });

      it('callLLM 返回 { narrative } → 只返回 narrative，无 note', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify({
          narrative: '只有叙事',
        }));
        const result = await generateStoryLink(mockCard(), mockCard({ id: 'card-2' }));
        expect(result.narrative).toBe('只有叙事');
        expect(result.note).toBeUndefined();
      });

      it('callLLM 返回 { narrative: "" } → fallback 到 mock', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify({
          narrative: '',
          note: '不应被使用',
        }));
        const result = await generateStoryLink(
          mockCard({ title: '源卡片' }),
          mockCard({ id: 'card-2', title: '目标卡片' }),
        );
        // fallback 到 mock：narrative 包含两张卡片标题
        expect(result.narrative).toContain('源卡片');
        expect(result.narrative).toContain('目标卡片');
        expect(result.narrative).toContain('转折');
      });

      it('callLLM 返回非对象 → fallback 到 mock', async () => {
        // 返回 JSON 字符串（非对象），parseJsonFromLLM 解析为字符串
        mockClient.callLLM = vi.fn().mockResolvedValue('"just a string"');
        const result = await generateStoryLink(
          mockCard({ title: '源卡片' }),
          mockCard({ id: 'card-2', title: '目标卡片' }),
        );
        // fallback 到 mock
        expect(result.narrative).toContain('源卡片');
        expect(result.narrative).toContain('目标卡片');
      });

      it('callLLM 抛错 → fallback 到 mock', async () => {
        mockClient.callLLM = vi.fn().mockRejectedValue(new Error('API error'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await generateStoryLink(
          mockCard({ title: '源卡片' }),
          mockCard({ id: 'card-2', title: '目标卡片' }),
        );
        expect(result.narrative).toContain('源卡片');
        expect(result.narrative).toContain('目标卡片');
        expect(warnSpy).toHaveBeenCalledWith(
          'AI generateStoryLink failed, falling back to mock:',
          expect.any(Error),
        );
        warnSpy.mockRestore();
      });
    });
  });

  // ==================== analyzeCharacterArcIssues ====================
  describe('analyzeCharacterArcIssues', () => {
    describe('mock 模式', () => {
      it('空 chapters 返回空数组', async () => {
        const result = await analyzeCharacterArcIssues([], [mockCharacter()]);
        expect(result).toEqual([]);
      });

      it('空 characters 返回空数组', async () => {
        const result = await analyzeCharacterArcIssues([mockChapter()], []);
        expect(result).toEqual([]);
      });

      it('有 chapters 和 characters → 返回 CharacterArcIssue[]', async () => {
        // 构造性格突变场景：character 性格"冷静"，章节内容含"暴怒"
        const char = mockCharacter({
          id: 'char-1',
          name: '李退',
          profile: { personality: '冷静' },
        });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退突然暴怒失控，掀翻了桌子。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [char]);
        expect(result.length).toBeGreaterThan(0);
        const pbIssue = result.find(i => i.type === 'personality-break');
        expect(pbIssue).toBeDefined();
        expect(pbIssue?.characterId).toBe('char-1');
        expect(pbIssue?.characterName).toBe('李退');
      });

      it('每个 issue 有 characterId / type / description / suggestion', async () => {
        const char = mockCharacter({
          id: 'char-1',
          name: '李退',
          profile: { personality: '冷静' },
        });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退突然暴怒失控。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [char]);
        expect(result.length).toBeGreaterThan(0);
        for (const issue of result) {
          expect(issue.characterId).toBe('char-1');
          expect(['personality-break', 'ability-exceed', 'relationship-jump']).toContain(issue.type);
          expect(issue.description.length).toBeGreaterThan(0);
          expect(issue.suggestion.length).toBeGreaterThan(0);
        }
      });

      it('能力越界（战斗）：未设战斗技能却出现击败/单挑等行为 → ability-exceed', async () => {
        // skills 不含 战斗/武力/格斗/剑术 → hasCombat=false
        const char = mockCharacter({
          id: 'char-1',
          name: '李退',
          profile: { skills: '枪法、伪装' },
        });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退单挑击败了强敌。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [char]);
        const aeIssue = result.find(i => i.type === 'ability-exceed');
        expect(aeIssue).toBeDefined();
        expect(aeIssue?.characterId).toBe('char-1');
        expect(aeIssue?.description).toContain('战斗');
        expect(aeIssue?.suggestion.length).toBeGreaterThan(0);
      });

      it('能力越界（谋略）：未设谋略技能却出现运筹帷幄等行为 → ability-exceed', async () => {
        // skills 不含 谋略/策略/智谋/战术 → hasStrategy=false
        const char = mockCharacter({
          id: 'char-1',
          name: '李退',
          profile: { skills: '枪法、伪装' },
        });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退运筹帷幄，识破了敌人的诡计。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [char]);
        const aeIssue = result.find(i => i.type === 'ability-exceed');
        expect(aeIssue).toBeDefined();
        expect(aeIssue?.description).toContain('谋略');
      });

      it('关系跳转（敌对→信任）：敌对关系却出现信任行为 → relationship-jump (warning)', async () => {
        const charA = mockCharacter({
          id: 'char-a',
          name: '李退',
          relationships: [
            { targetId: 'char-b', type: '宿敌', description: '多年仇敌', intensity: 80 },
          ],
        });
        const charB = mockCharacter({ id: 'char-b', name: '王仇' });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退竟然信任了王仇，把秘密托付给他。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [charA, charB]);
        const rjIssue = result.find(i => i.type === 'relationship-jump');
        expect(rjIssue).toBeDefined();
        expect(rjIssue?.characterId).toBe('char-a');
        expect(rjIssue?.severity).toBe('warning');
        expect(rjIssue?.description).toContain('宿敌');
      });

      it('关系跳转（盟友→背叛）：盟友关系却出现背叛行为 → relationship-jump (error)', async () => {
        const charA = mockCharacter({
          id: 'char-a',
          name: '李退',
          relationships: [
            { targetId: 'char-b', type: '挚友', description: '生死之交', intensity: 90 },
          ],
        });
        const charB = mockCharacter({ id: 'char-b', name: '王盟' });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退没想到王盟竟然背叛了自己，暗算了他。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [charA, charB]);
        const rjIssue = result.find(i => i.type === 'relationship-jump');
        expect(rjIssue).toBeDefined();
        expect(rjIssue?.characterId).toBe('char-a');
        expect(rjIssue?.severity).toBe('error');
        expect(rjIssue?.description).toContain('挚友');
      });
    });

    describe('非 mock 模式', () => {
      beforeEach(() => {
        mockClient.getSettings = vi.fn(() => ({
          provider: 'openai',
          apiKey: 'sk-test',
          strictness: 50,
          temperature: 0.7,
        }));
      });

      it('callLLM 返回合法 JSON → 解析为 issue 列表', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify([
          {
            characterId: 'char-1',
            characterName: '李退',
            type: 'personality-break',
            chapterId: 'ch-1',
            chapterTitle: '第一章',
            description: '性格突变',
            suggestion: '增加铺垫',
            severity: 'warning',
          },
        ]));
        const result = await analyzeCharacterArcIssues(
          [mockChapter({ id: 'ch-1' })],
          [mockCharacter({ id: 'char-1' })],
        );
        expect(result).toHaveLength(1);
        expect(result[0].characterId).toBe('char-1');
        expect(result[0].characterName).toBe('李退');
        expect(result[0].type).toBe('personality-break');
        expect(result[0].description).toBe('性格突变');
        expect(result[0].suggestion).toBe('增加铺垫');
        expect(result[0].severity).toBe('warning');
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
      });

      it('callLLM 抛错 → fallback 到 mock 启发式', async () => {
        mockClient.callLLM = vi.fn().mockRejectedValue(new Error('API error'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const char = mockCharacter({
          id: 'char-1',
          name: '李退',
          profile: { personality: '冷静' },
        });
        const chapter = mockChapter({
          id: 'ch-1',
          content: '李退突然暴怒失控。',
        });
        const result = await analyzeCharacterArcIssues([chapter], [char]);
        // fallback 到启发式：仍能检测到性格突变
        expect(result.length).toBeGreaterThan(0);
        const pbIssue = result.find(i => i.type === 'personality-break');
        expect(pbIssue).toBeDefined();
        expect(warnSpy).toHaveBeenCalledWith(
          'AI analyzeCharacterArcIssues failed, falling back to heuristic:',
          expect.any(Error),
        );
        warnSpy.mockRestore();
      });
    });
  });

  // ==================== analyzeRelationshipTemperature ====================
  describe('analyzeRelationshipTemperature', () => {
    describe('mock 模式', () => {
      it('返回 RelationshipTemperatureCurve，points 数量 = chapter 数量', async () => {
        const chapters = [
          mockChapter({ id: 'ch-1' }),
          mockChapter({ id: 'ch-2' }),
          mockChapter({ id: 'ch-3' }),
        ];
        const charA = mockCharacter({ id: 'char-a', name: '李退' });
        const charB = mockCharacter({ id: 'char-b', name: '王仇' });
        const result = await analyzeRelationshipTemperature(chapters, charA, charB);
        expect(result.points).toHaveLength(3);
        expect(result.characterAId).toBe('char-a');
        expect(result.characterBId).toBe('char-b');
        expect(result.jumps).toBeDefined();
      });

      it('每个 point 的 temperature 在 0-100 范围内', async () => {
        const chapters = [
          mockChapter({ id: 'ch-1', content: '李退和王仇争吵对抗决裂背叛。' }),
          mockChapter({ id: 'ch-2', content: '李退和王仇信任托付拥抱和解。' }),
          mockChapter({ id: 'ch-3', content: '李退和王仇对视。' }),
        ];
        const charA = mockCharacter({ id: 'char-a', name: '李退' });
        const charB = mockCharacter({ id: 'char-b', name: '王仇' });
        const result = await analyzeRelationshipTemperature(chapters, charA, charB);
        expect(result.points).toHaveLength(3);
        for (const p of result.points) {
          expect(p.temperature).toBeGreaterThanOrEqual(0);
          expect(p.temperature).toBeLessThanOrEqual(100);
        }
      });

      it('jumps 数组可能为空（无跳转）或包含跳转项', async () => {
        const charA = mockCharacter({ id: 'char-a', name: '李退' });
        const charB = mockCharacter({ id: 'char-b', name: '王仇' });

        // 场景 1：所有章节温度相同 → jumps 为空
        const sameTempChapters = [
          mockChapter({ id: 'ch-1', content: '李退和王仇对视。' }),
          mockChapter({ id: 'ch-2', content: '李退和王仇对视。' }),
        ];
        const result1 = await analyzeRelationshipTemperature(sameTempChapters, charA, charB);
        expect(result1.jumps).toEqual([]);

        // 场景 2：温度骤变 → jumps 包含跳转项
        // ch1: 4 个 cold 关键词 → temp = 50 - 48 = 2
        // ch2: 4 个 hot 关键词 → temp = 50 + 48 = 98
        // 跳变 |98-2| = 96 > 40 → jump 触发
        const jumpChapters = [
          mockChapter({ id: 'ch-1', content: '李退和王仇争吵对抗决裂背叛。' }),
          mockChapter({ id: 'ch-2', content: '李退和王仇信任托付拥抱和解。' }),
        ];
        const result2 = await analyzeRelationshipTemperature(jumpChapters, charA, charB);
        expect(result2.jumps.length).toBeGreaterThan(0);
        const jump = result2.jumps[0];
        expect(jump.chapterId).toBe('ch-2');
        expect(jump.fromTemp).toBeGreaterThanOrEqual(0);
        expect(jump.toTemp).toBeLessThanOrEqual(100);
        expect(jump.description.length).toBeGreaterThan(0);
      });
    });

    describe('非 mock 模式', () => {
      beforeEach(() => {
        mockClient.getSettings = vi.fn(() => ({
          provider: 'openai',
          apiKey: 'sk-test',
          strictness: 50,
          temperature: 0.7,
        }));
      });

      it('callLLM 返回合法 JSON → 解析为曲线', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify({
          points: [
            { chapterId: 'ch-1', chapterTitle: '第一章', temperature: 50, note: '中性' },
            { chapterId: 'ch-2', chapterTitle: '第二章', temperature: 80, note: '升温' },
          ],
          jumps: [
            { chapterId: 'ch-2', chapterTitle: '第二章', fromTemp: 50, toTemp: 80, description: '骤升' },
          ],
        }));
        const charA = mockCharacter({ id: 'char-a', name: '李退' });
        const charB = mockCharacter({ id: 'char-b', name: '王仇' });
        const result = await analyzeRelationshipTemperature(
          [mockChapter({ id: 'ch-1' }), mockChapter({ id: 'ch-2' })],
          charA,
          charB,
        );
        expect(result.characterAId).toBe('char-a');
        expect(result.characterBId).toBe('char-b');
        expect(result.points).toHaveLength(2);
        expect(result.points[0].temperature).toBe(50);
        expect(result.points[0].note).toBe('中性');
        expect(result.points[1].temperature).toBe(80);
        expect(result.jumps).toHaveLength(1);
        expect(result.jumps[0].chapterId).toBe('ch-2');
        expect(result.jumps[0].fromTemp).toBe(50);
        expect(result.jumps[0].toTemp).toBe(80);
        expect(result.jumps[0].description).toBe('骤升');
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
      });

      it('callLLM 抛错 → fallback 到 mock 启发式', async () => {
        mockClient.callLLM = vi.fn().mockRejectedValue(new Error('API error'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const charA = mockCharacter({ id: 'char-a', name: '李退' });
        const charB = mockCharacter({ id: 'char-b', name: '王仇' });
        const result = await analyzeRelationshipTemperature(
          [mockChapter({ id: 'ch-1', content: '李退和王仇对视。' })],
          charA,
          charB,
        );
        // fallback 到启发式：仍返回有效曲线
        expect(result.points).toHaveLength(1);
        expect(result.characterAId).toBe('char-a');
        expect(result.characterBId).toBe('char-b');
        expect(warnSpy).toHaveBeenCalledWith(
          'AI analyzeRelationshipTemperature failed, falling back to heuristic:',
          expect.any(Error),
        );
        warnSpy.mockRestore();
      });
    });
  });

  // ==================== runPacingPressureTest ====================
  describe('runPacingPressureTest', () => {
    describe('mock 模式', () => {
      it('空 chapters 返回 report，points 为空', async () => {
        const result = await runPacingPressureTest([]);
        expect(result.points).toEqual([]);
        expect(result.issues).toEqual([]);
        expect(result.scope).toBe('all');
        expect(typeof result.generatedAt).toBe('string');
      });

      it('有 chapters → points 数量 = chapter 数量', async () => {
        const chapters = [
          mockChapter({ id: 'ch-1' }),
          mockChapter({ id: 'ch-2' }),
          mockChapter({ id: 'ch-3' }),
        ];
        const result = await runPacingPressureTest(chapters);
        expect(result.points).toHaveLength(3);
        // 每个 point 的 chapterId 对应章节
        expect(result.points.map(p => p.chapterId)).toEqual(['ch-1', 'ch-2', 'ch-3']);
      });

      it('每个 point 的 external/emotional 在 0-100', async () => {
        const chapters = [
          mockChapter({ id: 'ch-1' }),
          mockChapter({ id: 'ch-2', content: '战斗追逐冲突爆发反转袭击对决厮杀逃亡围攻' }),
        ];
        const result = await runPacingPressureTest(chapters);
        for (const p of result.points) {
          expect(p.external).toBeGreaterThanOrEqual(0);
          expect(p.external).toBeLessThanOrEqual(100);
          expect(p.emotional).toBeGreaterThanOrEqual(0);
          expect(p.emotional).toBeLessThanOrEqual(100);
        }
      });

      it('total = external + emotional', async () => {
        const chapters = [
          mockChapter({ id: 'ch-1' }),
          mockChapter({ id: 'ch-2', content: '战斗追逐冲突抉择痛苦崩溃' }),
        ];
        const result = await runPacingPressureTest(chapters);
        for (const p of result.points) {
          expect(p.total).toBe(p.external + p.emotional);
        }
      });

      it('issues 可能包含 low-streak / high-streak / flat / spike 四类，每个 issue 有 description 和 suggestion', async () => {
        // 构造 chapters 触发 flat（5 章平稳）+ spike（突增）+ high-streak（3 章高能）
        // 10 个 external 关键词 → external=15+110=125→min(100)=100
        const highContent = '战斗追逐冲突爆发反转袭击对决厮杀逃亡围攻';
        const chapters = [
          mockChapter({ id: 'ch-1' }), // total=30
          mockChapter({ id: 'ch-2' }),
          mockChapter({ id: 'ch-3' }),
          mockChapter({ id: 'ch-4' }),
          mockChapter({ id: 'ch-5' }), // 5 章 total=30 → flat
          mockChapter({ id: 'ch-6', content: highContent }), // total=115 → spike (30→115)
          mockChapter({ id: 'ch-7', content: highContent }),
          mockChapter({ id: 'ch-8', content: highContent }), // 3 章 > 70 → high-streak
        ];
        const result = await runPacingPressureTest(chapters);
        const validTypes = ['low-streak', 'high-streak', 'flat', 'spike'];
        for (const issue of result.issues) {
          expect(validTypes).toContain(issue.type);
          expect(issue.description.length).toBeGreaterThan(0);
          expect(issue.suggestion.length).toBeGreaterThan(0);
        }
        // 至少触发了 flat / spike / high-streak
        expect(result.issues.length).toBeGreaterThan(0);
        const types = result.issues.map(i => i.type);
        expect(types).toEqual(expect.arrayContaining(['flat', 'spike', 'high-streak']));
      });
    });

    describe('非 mock 模式', () => {
      beforeEach(() => {
        mockClient.getSettings = vi.fn(() => ({
          provider: 'openai',
          apiKey: 'sk-test',
          strictness: 50,
          temperature: 0.7,
        }));
      });

      it('callLLM 返回合法 JSON → 解析为 report', async () => {
        mockClient.callLLM = vi.fn().mockResolvedValue(JSON.stringify({
          points: [
            { chapterId: 'ch-1', chapterTitle: '第一章', external: 50, emotional: 30, isBuffer: false },
            { chapterId: 'ch-2', chapterTitle: '第二章', external: 80, emotional: 20, isBuffer: false },
          ],
          issues: [
            {
              id: 'pacing-1',
              type: 'spike',
              chapterIds: ['ch-2'],
              description: '尖峰',
              suggestion: '加铺垫',
              severity: 'info',
            },
          ],
        }));
        const result = await runPacingPressureTest([
          mockChapter({ id: 'ch-1' }),
          mockChapter({ id: 'ch-2' }),
        ]);
        expect(result.points).toHaveLength(2);
        expect(result.points[0].external).toBe(50);
        expect(result.points[0].emotional).toBe(30);
        expect(result.points[0].total).toBe(80);
        expect(result.points[0].isBuffer).toBe(false);
        expect(result.points[1].external).toBe(80);
        expect(result.points[1].total).toBe(100);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].id).toBe('pacing-1');
        expect(result.issues[0].type).toBe('spike');
        expect(result.issues[0].description).toBe('尖峰');
        expect(result.issues[0].suggestion).toBe('加铺垫');
        expect(mockClient.callLLM).toHaveBeenCalledTimes(1);
      });

      it('callLLM 抛错 → fallback 到 mock 启发式', async () => {
        mockClient.callLLM = vi.fn().mockRejectedValue(new Error('API error'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await runPacingPressureTest([mockChapter({ id: 'ch-1' })]);
        // fallback 到启发式：仍返回有效 report
        expect(result.points).toHaveLength(1);
        expect(result.scope).toBe('all');
        expect(result.points[0].external).toBeGreaterThanOrEqual(0);
        expect(result.points[0].emotional).toBeGreaterThanOrEqual(0);
        expect(warnSpy).toHaveBeenCalledWith(
          'AI runPacingPressureTest failed, falling back to heuristic:',
          expect.any(Error),
        );
        warnSpy.mockRestore();
      });
    });
  });
});
