/**
 * src/store/slices/inspirationSlice.ts 单元测试
 *
 * 测试目标：
 *   - 碎片捕获：addInspirationCard / updateInspirationCard / deleteInspirationCard
 *     （含子卡级联删除与 storyLinks 清理）
 *   - 卡片促活：askInspirationCard（并发守卫 / busy 状态 / 错误兜底）、
 *     addInspirationChildCard（父卡 childCount 维护）
 *   - 连线沙盘：createStoryLink（并发守卫 / 错误兜底）、deleteStoryLink
 *   - 查询：getRelatedInspirationCards
 *
 * 测试策略：
 *   - useAppStore.getState() 触发 actions
 *   - vi.mock('@/utils/storage') 内存实现 + markDirty no-op，generateId 保留真实
 *   - vi.mock('@/hooks/useToast') vi.fn 占位
 *   - vi.mock('@/utils/aiService') vi.fn 占位 deepAskInspirationCard / generateStoryLink
 *   - beforeEach 中 createProject 确保 currentProjectId 存在
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';
import { _resetInspirationRequestState } from './inspirationSlice';
import type { Project, MaterialQuestion, StoryLink } from '@/types';

// ============ 内存存储 mock ============
const { memoryStore, mockStorage, toastMock, aiServiceMock } = vi.hoisted(() => {
  const memoryStore = new Map<string, unknown>();
  const mockStorage = {
    get: vi.fn(async <T>(key: string, defaultValue: T): Promise<T> =>
      memoryStore.has(key) ? (memoryStore.get(key) as T) : defaultValue),
    set: vi.fn(async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value);
    }),
    setMany: vi.fn(async (entries: Record<string, unknown>): Promise<void> => {
      for (const [k, v] of Object.entries(entries)) memoryStore.set(k, v);
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      memoryStore.delete(key);
    }),
    patchProjects: vi.fn(async (op: {
      type: 'add' | 'remove' | 'update' | 'clear';
      project?: Project;
      id?: string;
    }): Promise<Project[]> => {
      const cur = (memoryStore.get('projects') as Project[]) || [];
      let next = cur;
      if (op.type === 'add' && op.project) {
        next = cur.some(p => p.id === op.project!.id)
          ? cur.map(p => (p.id === op.project!.id ? op.project! : p))
          : [...cur, op.project];
      } else if (op.type === 'remove' && op.id) {
        next = cur.filter(p => p.id !== op.id);
      } else if (op.type === 'update' && op.project) {
        next = cur.some(p => p.id === op.project!.id)
          ? cur.map(p => (p.id === op.project!.id ? { ...p, ...op.project! } : p))
          : [...cur, op.project];
      } else if (op.type === 'clear') {
        next = [];
      }
      memoryStore.set('projects', next);
      return next;
    }),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
  };
  const toastMock = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const aiServiceMock = {
    deepAskInspirationCard: vi.fn(),
    generateStoryLink: vi.fn(),
  };
  return { memoryStore, mockStorage, toastMock, aiServiceMock };
});

vi.mock('@/utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    storage: mockStorage,
    markDirty: vi.fn(),
    triggerSave: vi.fn(async () => {}),
    clearAutoSaveTimer: vi.fn(),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: toastMock,
}));

vi.mock('@/utils/aiService', () => aiServiceMock);

// ============ 测试前重置 store ============
beforeEach(async () => {
  vi.clearAllMocks();
  // aiService mock 重置实现（clearAllMocks 只清调用记录，不清 mockResolvedValue）
  aiServiceMock.deepAskInspirationCard.mockReset();
  aiServiceMock.generateStoryLink.mockReset();
  // 重置灵感切片的模块级并发守卫
  _resetInspirationRequestState();
  memoryStore.clear();

  useAppStore.setState({
    projects: [],
    currentProjectId: null,
    currentProjectFilePath: null,
    lastSavedAt: null,
    isSaving: false,
    chapters: [],
    currentChapterId: null,
    inspirationCards: [],
    storyLinks: [],
    isInspirationBusy: false,
  });

  // 创建项目，确保 currentProjectId 存在
  await useAppStore.getState().createProject('测试项目', 'blank');
});

// ============ 测试用例 ============
describe('inspirationSlice', () => {
  // -------------------- addInspirationCard --------------------
  describe('addInspirationCard', () => {
    it('无项目时调用 → toast.error 被调用，返回对象 id 为 falsy', () => {
      useAppStore.setState({ currentProjectId: null });
      const card = useAppStore.getState().addInspirationCard({
        type: 'character',
        title: '主角',
        content: '一个侦探',
      });
      expect(toastMock.error).toHaveBeenCalledWith('添加失败', '当前没有打开的项目');
      expect(card.id).toBeFalsy();
    });

    it('有项目时调用 → 返回 InspirationCard，type/title/content 正确，projectId 匹配', () => {
      const projectId = useAppStore.getState().currentProjectId;
      const card = useAppStore.getState().addInspirationCard({
        type: 'concept',
        title: '高概念',
        content: '一个关于时间循环的故事',
      });
      expect(card.id).toBeTruthy();
      expect(card.projectId).toBe(projectId);
      expect(card.type).toBe('concept');
      expect(card.title).toBe('高概念');
      expect(card.content).toBe('一个关于时间循环的故事');
      expect(card.childCount).toBe(0);
      expect(useAppStore.getState().inspirationCards).toHaveLength(1);
    });

    it('有项目时调用带 relatedChapterId → 卡片 relatedChapterId 正确', () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'scene',
        title: '场景',
        content: '雨夜追击',
        relatedChapterId: 'ch-1',
      });
      expect(card.relatedChapterId).toBe('ch-1');
    });

    it('新卡片默认状态为 pending（转化率追踪初始态）', () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'concept',
        title: '高概念',
        content: '时间循环',
      });
      expect(card.status).toBe('pending');
    });
  });

  // -------------------- updateInspirationCard --------------------
  describe('updateInspirationCard', () => {
    it('更新已有卡片的 title/content → 卡片字段更新', () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '原标题', content: '原内容',
      });
      // 添加第二张卡，确保 map 的 else 分支（非匹配 card）被覆盖
      useAppStore.getState().addInspirationCard({
        type: 'character', title: '其他卡', content: '其他内容',
      });
      useAppStore.getState().updateInspirationCard(card.id, {
        title: '新标题',
        content: '新内容',
      });
      const updated = useAppStore.getState().inspirationCards.find(c => c.id === card.id)!;
      expect(updated.title).toBe('新标题');
      expect(updated.content).toBe('新内容');
    });

    it('更新卡片状态 outlined → written（转化率全链路追踪）', () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'plot', title: '情节脑洞', content: '主角背叛',
      });
      expect(card.status).toBe('pending');
      useAppStore.getState().updateInspirationCard(card.id, { status: 'outlined' });
      expect(useAppStore.getState().inspirationCards.find(c => c.id === card.id)!.status).toBe('outlined');
      useAppStore.getState().updateInspirationCard(card.id, { status: 'written' });
      expect(useAppStore.getState().inspirationCards.find(c => c.id === card.id)!.status).toBe('written');
      useAppStore.getState().updateInspirationCard(card.id, { status: 'archived' });
      expect(useAppStore.getState().inspirationCards.find(c => c.id === card.id)!.status).toBe('archived');
    });
  });

  // -------------------- deleteInspirationCard --------------------
  describe('deleteInspirationCard', () => {
    it('删除主卡 → 主卡和其子卡都被删除', () => {
      const parent = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主卡', content: '内容',
      });
      useAppStore.getState().addInspirationChildCard(parent.id, '秘密', '问题', '答案');
      useAppStore.getState().addInspirationChildCard(parent.id, '创伤', '问题2', '答案2');
      expect(useAppStore.getState().inspirationCards).toHaveLength(3);

      useAppStore.getState().deleteInspirationCard(parent.id);

      // 主卡 + 2 子卡全部删除
      expect(useAppStore.getState().inspirationCards).toHaveLength(0);
    });

    it('删除主卡同时清理关联的 storyLinks（sourceCardId 或 targetCardId 匹配）', () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      const cardC = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'C', content: 'c',
      });
      // 手动塞入 storyLinks（绕过 AI）
      useAppStore.setState({
        storyLinks: [
          { id: 'l1', projectId: cardA.projectId, sourceCardId: cardA.id, targetCardId: cardB.id, narrative: 'A→B', createdAt: '' },
          { id: 'l2', projectId: cardC.projectId, sourceCardId: cardB.id, targetCardId: cardC.id, narrative: 'B→C', createdAt: '' },
        ],
      });

      useAppStore.getState().deleteInspirationCard(cardA.id);

      // l1 含 cardA（sourceCardId）→ 删除；l2 不含 cardA → 保留
      const links = useAppStore.getState().storyLinks;
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe('l2');
    });

    it('删除子卡 → 只删子卡，主卡 childCount 不变（slice 不自动减 childCount）', () => {
      const parent = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主卡', content: '内容',
      });
      const child = useAppStore.getState().addInspirationChildCard(parent.id, '秘密', '问题', '答案');
      expect(child).not.toBeNull();
      expect(useAppStore.getState().inspirationCards.find(c => c.id === parent.id)!.childCount).toBe(1);

      useAppStore.getState().deleteInspirationCard(child!.id);

      // 子卡被删，主卡仍在
      expect(useAppStore.getState().inspirationCards.find(c => c.id === child!.id)).toBeUndefined();
      const stillParent = useAppStore.getState().inspirationCards.find(c => c.id === parent.id)!;
      expect(stillParent).toBeTruthy();
      // childCount 不自动减（设计选择）
      expect(stillParent.childCount).toBe(1);
    });
  });

  // -------------------- askInspirationCard --------------------
  describe('askInspirationCard', () => {
    it('mock deepAskInspirationCard 返回问题列表 → 返回 MaterialQuestion[]', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      const questions: MaterialQuestion[] = [
        { question: '他隐藏了什么秘密？', dimension: '秘密' },
        { question: '童年的创伤是什么？', dimension: '创伤' },
      ];
      aiServiceMock.deepAskInspirationCard.mockResolvedValue(questions);

      const result = await useAppStore.getState().askInspirationCard(card.id);

      expect(result).toEqual(questions);
      expect(useAppStore.getState().isInspirationBusy).toBe(false);
    });

    it('mock deepAskInspirationCard 抛错 → 不抛异常，返回空数组', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      aiServiceMock.deepAskInspirationCard.mockRejectedValue(new Error('AI 异常'));

      const result = await useAppStore.getState().askInspirationCard(card.id);

      expect(result).toEqual([]);
      expect(toastMock.error).toHaveBeenCalledWith('深度提问失败', 'AI 异常');
      expect(useAppStore.getState().isInspirationBusy).toBe(false);
    });

    it('并发守卫：同一 cardId 重复调用，旧请求结果被丢弃返回 []', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      const oldQuestions: MaterialQuestion[] = [{ question: '旧', dimension: '秘密' }];
      const newQuestions: MaterialQuestion[] = [{ question: '新', dimension: '创伤' }];
      let firstCall = true;
      let innerResult: MaterialQuestion[] | undefined;
      aiServiceMock.deepAskInspirationCard.mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          // 旧请求返回前触发新请求
          innerResult = await useAppStore.getState().askInspirationCard(card.id);
          return oldQuestions;
        }
        return newQuestions;
      });

      const outerResult = await useAppStore.getState().askInspirationCard(card.id);

      // 旧请求（外层）被新请求抢占 → 返回 []
      expect(outerResult).toEqual([]);
      // 新请求（内层）正常返回
      expect(innerResult).toEqual(newQuestions);
      expect(useAppStore.getState().isInspirationBusy).toBe(false);
    });

    it('isInspirationBusy 在请求中为 true', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      let busyDuringRequest = false;
      aiServiceMock.deepAskInspirationCard.mockImplementation(async () => {
        busyDuringRequest = useAppStore.getState().isInspirationBusy;
        return [{ question: 'q', dimension: 'd' }];
      });

      await useAppStore.getState().askInspirationCard(card.id);

      expect(busyDuringRequest).toBe(true);
      expect(useAppStore.getState().isInspirationBusy).toBe(false);
    });

    it('卡片不存在时返回空数组，不调用 AI', async () => {
      aiServiceMock.deepAskInspirationCard.mockResolvedValue([]);

      const result = await useAppStore.getState().askInspirationCard('nonexistent');

      expect(result).toEqual([]);
      expect(aiServiceMock.deepAskInspirationCard).not.toHaveBeenCalled();
    });

    it('await 期间项目切换 → 丢弃结果返回空数组', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      const originalProjectId = useAppStore.getState().currentProjectId;
      aiServiceMock.deepAskInspirationCard.mockImplementation(async () => {
        // 模拟 await 期间项目被切换
        useAppStore.setState({ currentProjectId: 'other-project' });
        return [{ question: 'q', dimension: 'd' }];
      });

      const result = await useAppStore.getState().askInspirationCard(card.id);

      expect(result).toEqual([]);
      // 项目切换后不应触发 toast（因 currentProjectId !== 原项目）
      expect(toastMock.error).not.toHaveBeenCalled();
      // 恢复项目 ID 以免影响后续测试
      useAppStore.setState({ currentProjectId: originalProjectId });
    });

    it('await 期间卡片被删除 → 丢弃结果返回空数组', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      aiServiceMock.deepAskInspirationCard.mockImplementation(async () => {
        // 模拟 await 期间卡片被删除
        useAppStore.getState().deleteInspirationCard(card.id);
        return [{ question: 'q', dimension: 'd' }];
      });

      const result = await useAppStore.getState().askInspirationCard(card.id);

      expect(result).toEqual([]);
    });

    it('await 期间项目切换且 AI 抛错 → 不触发 toast（项目已切换）', async () => {
      const card = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主角', content: '内容',
      });
      const originalProjectId = useAppStore.getState().currentProjectId;
      aiServiceMock.deepAskInspirationCard.mockImplementation(async () => {
        // 模拟 await 期间项目被切换
        useAppStore.setState({ currentProjectId: 'other-project' });
        throw new Error('AI 异常');
      });

      const result = await useAppStore.getState().askInspirationCard(card.id);

      expect(result).toEqual([]);
      // 项目已切换，不应触发 toast
      expect(toastMock.error).not.toHaveBeenCalled();
      // 恢复项目 ID 以免影响后续测试
      useAppStore.setState({ currentProjectId: originalProjectId });
    });
  });

  // -------------------- addInspirationChildCard --------------------
  describe('addInspirationChildCard', () => {
    it('父卡存在 → 生成子卡，parentId 正确，父卡 childCount +1', () => {
      const parent = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主卡', content: '内容',
      });

      const child = useAppStore.getState().addInspirationChildCard(parent.id, '秘密', '问题', '答案');

      expect(child).not.toBeNull();
      expect(child!.parentId).toBe(parent.id);
      expect(child!.dimension).toBe('秘密');
      expect(child!.title).toBe('问题');
      expect(child!.content).toBe('答案');
      expect(child!.type).toBe(parent.type);
      const updatedParent = useAppStore.getState().inspirationCards.find(c => c.id === parent.id)!;
      expect(updatedParent.childCount).toBe(1);
    });

    it('父卡不存在 → 返回 null', () => {
      const child = useAppStore.getState().addInspirationChildCard('nonexistent', '秘密', '问题', '答案');
      expect(child).toBeNull();
    });

    it('无项目时（父卡存在）→ 返回 null', () => {
      const parent = useAppStore.getState().addInspirationCard({
        type: 'character', title: '主卡', content: '内容',
      });
      const originalProjectId = useAppStore.getState().currentProjectId;
      useAppStore.setState({ currentProjectId: null });

      const child = useAppStore.getState().addInspirationChildCard(parent.id, '秘密', '问题', '答案');

      expect(child).toBeNull();
      // 恢复项目 ID 以免影响后续测试
      useAppStore.setState({ currentProjectId: originalProjectId });
    });
  });

  // -------------------- createStoryLink --------------------
  describe('createStoryLink', () => {
    it('mock generateStoryLink 返回 narrative → 返回 StoryLink，字段正确', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      aiServiceMock.generateStoryLink.mockResolvedValue({ narrative: '六代传承的技艺', note: '备注' });

      const link = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);

      expect(link).not.toBeNull();
      expect(link!.sourceCardId).toBe(cardA.id);
      expect(link!.targetCardId).toBe(cardB.id);
      expect(link!.narrative).toBe('六代传承的技艺');
      expect(link!.note).toBe('备注');
      expect(useAppStore.getState().storyLinks).toHaveLength(1);
    });

    it('并发守卫：同一对卡片重复调用，旧请求返回 null', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      let firstCall = true;
      let innerResult: StoryLink | null | undefined;
      aiServiceMock.generateStoryLink.mockImplementation(async () => {
        if (firstCall) {
          firstCall = false;
          innerResult = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);
          return { narrative: '旧脉络', note: undefined };
        }
        return { narrative: '新脉络', note: undefined };
      });

      const outerResult = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);

      // 旧请求（外层）被抢占 → null
      expect(outerResult).toBeNull();
      // 新请求（内层）正常返回
      expect(innerResult).not.toBeNull();
      expect(innerResult!.narrative).toBe('新脉络');
    });

    it('mock generateStoryLink 抛错 → 返回 null', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      aiServiceMock.generateStoryLink.mockRejectedValue(new Error('AI 异常'));

      const link = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);

      expect(link).toBeNull();
      expect(toastMock.error).toHaveBeenCalledWith('生成脉络失败', 'AI 异常');
    });

    it('无项目时调用 → 返回 null，不调用 AI', async () => {
      useAppStore.setState({ currentProjectId: null });
      const link = await useAppStore.getState().createStoryLink('a', 'b');
      expect(link).toBeNull();
      expect(aiServiceMock.generateStoryLink).not.toHaveBeenCalled();
    });

    it('source 卡片不存在 → 返回 null，不调用 AI', async () => {
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      const link = await useAppStore.getState().createStoryLink('nonexistent', cardB.id);
      expect(link).toBeNull();
      expect(aiServiceMock.generateStoryLink).not.toHaveBeenCalled();
    });

    it('target 卡片不存在 → 返回 null，不调用 AI', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const link = await useAppStore.getState().createStoryLink(cardA.id, 'nonexistent');
      expect(link).toBeNull();
      expect(aiServiceMock.generateStoryLink).not.toHaveBeenCalled();
    });

    it('await 期间项目切换 → 返回 null，不写入 storyLinks', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      const originalProjectId = useAppStore.getState().currentProjectId;
      aiServiceMock.generateStoryLink.mockImplementation(async () => {
        // 模拟 await 期间项目被切换
        useAppStore.setState({ currentProjectId: 'other-project' });
        return { narrative: '脉络', note: undefined };
      });

      const link = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);

      expect(link).toBeNull();
      expect(useAppStore.getState().storyLinks).toHaveLength(0);
      // 恢复项目 ID 以免影响后续测试
      useAppStore.setState({ currentProjectId: originalProjectId });
    });

    it('await 期间源卡被删除 → 返回 null（covers 卡片存在性复查分支）', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      aiServiceMock.generateStoryLink.mockImplementation(async () => {
        // 模拟 await 期间源卡被删除
        useAppStore.getState().deleteInspirationCard(cardA.id);
        return { narrative: '脉络', note: undefined };
      });

      const link = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);

      expect(link).toBeNull();
      expect(useAppStore.getState().storyLinks).toHaveLength(0);
    });

    it('await 期间目标卡被删除 → 返回 null（covers 卡片存在性复查分支）', async () => {
      const cardA = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'A', content: 'a',
      });
      const cardB = useAppStore.getState().addInspirationCard({
        type: 'character', title: 'B', content: 'b',
      });
      aiServiceMock.generateStoryLink.mockImplementation(async () => {
        // 模拟 await 期间目标卡被删除
        useAppStore.getState().deleteInspirationCard(cardB.id);
        return { narrative: '脉络', note: undefined };
      });

      const link = await useAppStore.getState().createStoryLink(cardA.id, cardB.id);

      expect(link).toBeNull();
      expect(useAppStore.getState().storyLinks).toHaveLength(0);
    });
  });

  // -------------------- deleteStoryLink --------------------
  describe('deleteStoryLink', () => {
    it('删除已有 link → storyLinks 减少', () => {
      useAppStore.setState({
        storyLinks: [
          { id: 'l1', projectId: 'p', sourceCardId: 'a', targetCardId: 'b', narrative: 'n1', createdAt: '' },
          { id: 'l2', projectId: 'p', sourceCardId: 'c', targetCardId: 'd', narrative: 'n2', createdAt: '' },
        ],
      });

      useAppStore.getState().deleteStoryLink('l1');

      expect(useAppStore.getState().storyLinks).toHaveLength(1);
      expect(useAppStore.getState().storyLinks[0].id).toBe('l2');
    });
  });

  // -------------------- getRelatedInspirationCards --------------------
  describe('getRelatedInspirationCards', () => {
    it('有 relatedChapterId 匹配的卡片 → 返回这些卡片', () => {
      useAppStore.getState().addInspirationCard({ type: 'scene', title: 'a', content: 'a', relatedChapterId: 'ch1' });
      useAppStore.getState().addInspirationCard({ type: 'scene', title: 'b', content: 'b', relatedChapterId: 'ch2' });
      useAppStore.getState().addInspirationCard({ type: 'scene', title: 'c', content: 'c', relatedChapterId: 'ch1' });

      const related = useAppStore.getState().getRelatedInspirationCards('ch1');

      expect(related).toHaveLength(2);
      expect(related.every(c => c.relatedChapterId === 'ch1')).toBe(true);
    });

    it('无匹配 → 返回空数组', () => {
      useAppStore.getState().addInspirationCard({ type: 'scene', title: 'a', content: 'a', relatedChapterId: 'ch1' });

      const related = useAppStore.getState().getRelatedInspirationCards('nonexistent');

      expect(related).toEqual([]);
    });
  });
});
