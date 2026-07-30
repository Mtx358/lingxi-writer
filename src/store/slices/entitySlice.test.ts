/**
 * src/store/slices/entitySlice.ts 单元测试
 *
 * 测试目标：
 *   - 角色：addCharacter / updateCharacter / deleteCharacter（含级联清理关系/伏笔/章节/支线引用）
 *   - 设定分类：addSettingCategory / updateSettingCategory / deleteSettingCategory（含级联清理设定项 + 伏笔引用）
 *   - 设定项：addSettingItem / updateSettingItem / deleteSettingItem（含级联清理伏笔引用 + order 回填）
 *   - 伏笔：addForeshadow / updateForeshadow / deleteForeshadow（含级联清理支线引用 + recompute 触发）
 *   - recomputeForeshadowMentions：DFS 全局阅读顺序、title 提及距离、plantedChapterId 兜底、空场景 noop
 *   - 素材：addMaterial / updateMaterial / deleteMaterial
 *   - chapterPlainTextCache：缓存命中、章节变更后失效
 *
 * 测试策略：
 *   - useAppStore.getState() 触发 actions
 *   - vi.mock('@/utils/storage') 内存实现
 *   - 每个测试前 useAppStore.setState 重置关键字段
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_AI_SETTINGS } from '@/store/appState';
import { clearChapterPlainTextCache } from '@/store/slices/entitySlice';
import type { Chapter, Project, Foreshadow, Subplot } from '@/types';

// ============ 内存存储 mock ============
const { mockStorage } = vi.hoisted(() => {
  const mockStorage = {
    get: vi.fn(async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue),
    set: vi.fn(async () => undefined),
    setMany: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    patchProjects: vi.fn(async () => null),
    saveRecoveryDraft: vi.fn().mockResolvedValue(undefined),
  };
  return { mockStorage };
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

// ============ 测试 fixtures ============
const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: '测试项目',
  description: '',
  template: 'blank',
  lastOpenedAt: '',
  totalWords: 0,
  config: {
    theme: 'dark', fontSize: 16, lineHeight: 1.8, fontFamily: 'system-ui',
    showLineNumbers: false, showWordCount: true, zenMode: false,
    aiSettings: { ...DEFAULT_AI_SETTINGS } as never,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeChapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'ch-1', projectId: 'p1', parentId: null, title: '第一章',
  summary: '', order: 0, level: 1, levelType: 'chapter',
  status: 'draft', wordCount: 0, content: '',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeForeshadow = (overrides: Partial<Foreshadow> = {}): Foreshadow => ({
  id: 'f1', projectId: 'p1', title: '伏笔', description: '',
  status: 'planted', plantedChapterId: null, payoffChapterId: null,
  priority: 'medium', relatedCharacters: [], relatedSettings: [],
  chaptersSinceMention: 0, notes: '',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeSubplot = (overrides: Partial<Subplot> = {}): Subplot => ({
  id: 's1', projectId: 'p1', title: '支线', description: '',
  status: 'open', startChapterId: null, lastProgressChapterId: null,
  expectedCloseChapterId: null, relatedCharacters: [], relatedForeshadows: [],
  notes: '', lastProgressAt: null,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ============ 测试前重置 store ============
beforeEach(() => {
  clearChapterPlainTextCache(); // 清除伏笔重算用的章节文本缓存
  mockStorage.get.mockClear();
  mockStorage.set.mockClear();
  mockStorage.remove.mockClear();
  mockStorage.patchProjects.mockClear();
  mockStorage.saveRecoveryDraft.mockClear();

  useAppStore.setState({
    projects: [makeProject()],
    currentProjectId: 'p1',
    currentProjectFilePath: null,
    lastSavedAt: null,
    isSaving: false,
    chapters: [],
    currentChapterId: null,
    pendingEditorInsert: null,
    pendingScrollTo: null,
    contentEpoch: 0,
    isAIGenerating: false,
    characters: [],
    settingCategories: [],
    settingItems: [],
    foreshadows: [],
    materials: [],
    subplots: [],
    versions: {},
    histories: {},
    conflicts: [],
    aiSuggestions: [],
    searchQuery: '',
    searchResults: [],
    analysis: {},
    updateSchedule: null,
  });
});

// ============ 测试用例 ============

describe('entitySlice', () => {
  // -------------------- 角色 --------------------
  describe('角色域', () => {
    it('addCharacter：默认值填充并返回新角色', () => {
      const c = useAppStore.getState().addCharacter({ name: '赵云' });
      expect(c.id).toBeTruthy();
      expect(c.name).toBe('赵云');
      expect(c.role).toBe('supporting'); // DEFAULT_CHARACTER_ROLE
      expect(c.color).toBe('#d4a574'); // 默认色
      expect(useAppStore.getState().characters).toHaveLength(1);
    });

    it('addCharacter：无项目抛错', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().addCharacter({})).toThrow('No project open');
    });

    it('updateCharacter：合并字段', () => {
      const c = useAppStore.getState().addCharacter({ name: '张飞' });
      useAppStore.getState().updateCharacter(c.id, { color: '#ff0000', tags: ['勇'] });
      const updated = useAppStore.getState().characters.find(x => x.id === c.id)!;
      expect(updated.color).toBe('#ff0000');
      expect(updated.tags).toEqual(['勇']);
    });

    it('updateCharacter：无项目 noop', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateCharacter(c.id, { color: '#fff' });
      expect(useAppStore.getState().characters.find(x => x.id === c.id)!.color).toBe('#d4a574');
    });

    it('deleteCharacter：从列表移除', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      useAppStore.getState().deleteCharacter(c.id);
      expect(useAppStore.getState().characters).toHaveLength(0);
    });

    it('deleteCharacter：级联清理其他角色的 relationships', () => {
      const c1 = useAppStore.getState().addCharacter({ name: 'a' });
      const c2 = useAppStore.getState().addCharacter({
        name: 'b',
        relationships: [{ targetId: c1.id, type: '朋友', description: '', intensity: 5 }],
      });
      useAppStore.getState().deleteCharacter(c1.id);
      const b = useAppStore.getState().characters.find(x => x.id === c2.id)!;
      expect(b.relationships).toHaveLength(0);
    });

    it('deleteCharacter：级联清理伏笔 relatedCharacters', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      useAppStore.setState({
        foreshadows: [makeForeshadow({ id: 'f1', relatedCharacters: [c.id] })],
      });
      useAppStore.getState().deleteCharacter(c.id);
      expect(useAppStore.getState().foreshadows[0].relatedCharacters).toHaveLength(0);
    });

    it('deleteCharacter：级联清理章节 characterFocus', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', characterFocus: [c.id, 'other'] })],
      });
      useAppStore.getState().deleteCharacter(c.id);
      expect(useAppStore.getState().chapters[0].characterFocus).toEqual(['other']);
    });

    it('deleteCharacter：级联清理支线 relatedCharacters', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      const subplot = makeSubplot({ id: 's1', relatedCharacters: [c.id] });
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        subplots: [subplot],
        projects: [{ ...project, subplots: [subplot] }],
      });
      useAppStore.getState().deleteCharacter(c.id);
      expect(useAppStore.getState().subplots[0].relatedCharacters).toHaveLength(0);
    });

    it('deleteCharacter：M10 修复——顶层 subplots 与 projects[].subplots 单次 set 原子更新，订阅者不观察到中间态', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      const subplot = makeSubplot({ id: 's1', relatedCharacters: [c.id] });
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        subplots: [subplot],
        projects: [{ ...project, subplots: [subplot] }],
      });
      // 订阅 store，记录每次通知时的 subplots 与 projects[0].subplots 是否一致
      const snapshots: { topRelated: string[]; projRelated: string[] }[] = [];
      const unsub = useAppStore.subscribe((s) => {
        const top = s.subplots[0]?.relatedCharacters || [];
        const proj = s.projects[0]?.subplots?.[0]?.relatedCharacters || [];
        snapshots.push({ topRelated: [...top], projRelated: [...proj] });
      });
      try {
        useAppStore.getState().deleteCharacter(c.id);
      } finally {
        unsub();
      }
      // 最终态：两者都已清空
      const final = useAppStore.getState();
      expect(final.subplots[0].relatedCharacters).toHaveLength(0);
      expect(final.projects[0].subplots![0].relatedCharacters).toHaveLength(0);
      // 中间态断言：任何一次通知中，顶层与 projects 的 relatedCharacters 长度必须一致
      // 修复前会出现顶层已清空（0）但 projects 仍含 c.id（1）的中间态
      for (const snap of snapshots) {
        expect(snap.topRelated.length).toBe(snap.projRelated.length);
      }
      // 持久化走 patchProjects（原子 update），而非 updateProject（会触发第二次 set）
      expect(mockStorage.patchProjects).toHaveBeenCalledTimes(1);
      expect(mockStorage.patchProjects).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update' }),
      );
    });

    it('deleteCharacter：无项目 noop', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().deleteCharacter(c.id);
      expect(useAppStore.getState().characters).toHaveLength(1);
    });

    it('deleteCharacter：级联清理章节正文中 mention 节点（C3-02 正则替换，覆盖 content.replace 分支 + characterFocus 缺省分支）', () => {
      const c = useAppStore.getState().addCharacter({ name: '叶文洁' });
      // 章节含 mention 节点（命中 replace 分支）；另一章有正文但无 mention（命中 includes=false 早退分支）
      const mentionHtml = `<p>正文<span data-mention data-id="${c.id}">叶文洁</span>后续</p>`;
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch-with-mention', content: mentionHtml, characterFocus: [c.id] }),
          makeChapter({ id: 'ch-no-mention', content: '<p>普通正文无 mention</p>' }),
        ],
      });
      useAppStore.getState().deleteCharacter(c.id);
      const chapters = useAppStore.getState().chapters;
      const withMention = chapters.find(ch => ch.id === 'ch-with-mention')!;
      // mention 节点被移除，其余正文保留
      expect(withMention.content).not.toContain('data-mention');
      expect(withMention.content).not.toContain(c.id);
      expect(withMention.content).toContain('正文');
      expect(withMention.content).toContain('后续');
      // characterFocus 同步清理
      expect(withMention.characterFocus).toEqual([]);
      // 无 mention 章节正文保持不变（未触发 replace）
      const noMention = chapters.find(ch => ch.id === 'ch-no-mention')!;
      expect(noMention.content).toBe('<p>普通正文无 mention</p>');
    });
  });

  // -------------------- 设定分类 --------------------
  describe('设定分类域', () => {
    it('addSettingCategory：默认值填充', () => {
      const cat = useAppStore.getState().addSettingCategory('魔法体系', '✨');
      expect(cat.id).toBeTruthy();
      expect(cat.name).toBe('魔法体系');
      expect(cat.icon).toBe('✨');
      expect(cat.color).toBe('#6b7c93');
      expect(cat.order).toBe(0);
      expect(cat.parentId).toBeNull();
    });

    it('addSettingCategory：order 自增', () => {
      const c1 = useAppStore.getState().addSettingCategory('a', '📄');
      const c2 = useAppStore.getState().addSettingCategory('b', '📄');
      expect(c1.order).toBe(0);
      expect(c2.order).toBe(1);
    });

    it('addSettingCategory：无项目抛错', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().addSettingCategory('x', '📄')).toThrow('No project open');
    });

    it('updateSettingCategory：合并字段', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      useAppStore.getState().updateSettingCategory(cat.id, { color: '#ff0000', name: 'A' });
      const updated = useAppStore.getState().settingCategories.find(c => c.id === cat.id)!;
      expect(updated.color).toBe('#ff0000');
      expect(updated.name).toBe('A');
    });

    it('deleteSettingCategory：从列表移除', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      useAppStore.getState().deleteSettingCategory(cat.id);
      expect(useAppStore.getState().settingCategories).toHaveLength(0);
    });

    it('deleteSettingCategory：级联删除分类下所有设定项', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, '项1');
      const item2 = useAppStore.getState().addSettingItem(cat.id, '项2');
      useAppStore.getState().deleteSettingCategory(cat.id);
      const items = useAppStore.getState().settingItems;
      expect(items.find(i => i.id === item.id)).toBeUndefined();
      expect(items.find(i => i.id === item2.id)).toBeUndefined();
    });

    it('deleteSettingCategory：级联清理伏笔 relatedSettings', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, '项1');
      useAppStore.setState({
        foreshadows: [makeForeshadow({ id: 'f1', relatedSettings: [item.id] })],
      });
      useAppStore.getState().deleteSettingCategory(cat.id);
      expect(useAppStore.getState().foreshadows[0].relatedSettings).toHaveLength(0);
    });

    it('deleteSettingCategory：无项目 noop', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().deleteSettingCategory(cat.id);
      expect(useAppStore.getState().settingCategories).toHaveLength(1);
    });

    it('deleteSettingCategory：分类下无设定项时 deletedItemIds 为空，跳过伏笔级联清理', () => {
      // 覆盖 deletedItemIds.size > 0 三元的 false 分支
      const cat = useAppStore.getState().addSettingCategory('空分类', '📄');
      useAppStore.setState({
        foreshadows: [makeForeshadow({ id: 'f1', relatedSettings: ['other-id'] })],
      });
      useAppStore.getState().deleteSettingCategory(cat.id);
      // 伏笔 relatedSettings 不受影响（deletedItemIds 为空 → 直接复用原数组）
      expect(useAppStore.getState().foreshadows[0].relatedSettings).toEqual(['other-id']);
      expect(useAppStore.getState().settingCategories).toHaveLength(0);
    });
  });

  // -------------------- 设定项 --------------------
  describe('设定项域', () => {
    it('addSettingItem：默认值填充', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, '项1');
      expect(item.id).toBeTruthy();
      expect(item.categoryId).toBe(cat.id);
      expect(item.name).toBe('项1');
      expect(item.description).toBe('');
      expect(item.content).toBe('');
      expect(item.order).toBe(0);
    });

    it('addSettingItem：order 在分类内自增', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const cat2 = useAppStore.getState().addSettingCategory('b', '📄');
      const i1 = useAppStore.getState().addSettingItem(cat.id, 'a1');
      const i2 = useAppStore.getState().addSettingItem(cat.id, 'a2');
      const i3 = useAppStore.getState().addSettingItem(cat2.id, 'b1');
      expect(i1.order).toBe(0);
      expect(i2.order).toBe(1);
      expect(i3.order).toBe(0); // 不同分类从 0 开始
    });

    it('updateSettingItem：合并字段', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, 'x');
      useAppStore.getState().updateSettingItem(item.id, { content: '新内容', tags: ['t'] });
      const updated = useAppStore.getState().settingItems.find(i => i.id === item.id)!;
      expect(updated.content).toBe('新内容');
      expect(updated.tags).toEqual(['t']);
    });

    it('deleteSettingItem：从列表移除 + 同分类后续 order -1', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const i1 = useAppStore.getState().addSettingItem(cat.id, 'a1');
      useAppStore.getState().addSettingItem(cat.id, 'a2');
      const i3 = useAppStore.getState().addSettingItem(cat.id, 'a3');
      useAppStore.getState().deleteSettingItem(i1.id);
      const items = useAppStore.getState().settingItems;
      expect(items.find(i => i.id === i1.id)).toBeUndefined();
      expect(items.find(i => i.id === i3.id)!.order).toBe(1); // 0→1（i2 占用 0）
    });

    it('deleteSettingItem：级联清理伏笔 relatedSettings', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, 'x');
      useAppStore.setState({
        foreshadows: [makeForeshadow({ id: 'f1', relatedSettings: [item.id, 'other'] })],
      });
      useAppStore.getState().deleteSettingItem(item.id);
      expect(useAppStore.getState().foreshadows[0].relatedSettings).toEqual(['other']);
    });

    it('deleteSettingItem：不存在时 noop', () => {
      expect(() => useAppStore.getState().deleteSettingItem('nonexistent')).not.toThrow();
    });
  });

  // -------------------- 伏笔 --------------------
  describe('伏笔域', () => {
    it('addForeshadow：默认值填充', () => {
      const f = useAppStore.getState().addForeshadow({ title: '神秘信物' });
      expect(f.id).toBeTruthy();
      expect(f.title).toBe('神秘信物');
      expect(f.status).toBe('planted'); // DEFAULT_FORESHADOW_STATUS
      expect(f.priority).toBe('medium'); // DEFAULT_FORESHADOW_PRIORITY
      expect(f.chaptersSinceMention).toBe(0);
    });

    it('addForeshadow：无项目抛错', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().addForeshadow({})).toThrow('No project open');
    });

    it('updateForeshadow：合并字段', () => {
      const f = useAppStore.getState().addForeshadow({ title: 'x' });
      useAppStore.getState().updateForeshadow(f.id, { status: 'paid-off', notes: '已回收' });
      const updated = useAppStore.getState().foreshadows.find(x => x.id === f.id)!;
      expect(updated.status).toBe('paid-off');
      expect(updated.notes).toBe('已回收');
    });

    it('updateForeshadow：title 变更触发 recomputeForeshadowMentions', () => {
      const ch1 = makeChapter({ id: 'ch1', content: '<p>神秘信物</p>', order: 0 });
      const ch2 = makeChapter({ id: 'ch2', content: '<p>无关内容</p>', order: 1 });
      useAppStore.setState({ chapters: [ch1, ch2], currentChapterId: 'ch2' });
      const f = useAppStore.getState().addForeshadow({ title: '旧标题' });
      // 章节正文中无"旧标题"，chaptersSinceMention 应为 0（无提及 + 无 plantedChapterId）
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
      // 改名为已在 ch1 中提及的标题，重算后 chaptersSinceMention 应为 1（ch2 - ch1）
      useAppStore.getState().updateForeshadow(f.id, { title: '神秘信物' });
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(1);
    });

    it('updateForeshadow：仅更新 status/notes 不触发 recompute（覆盖 title/plantedChapterId 未变更分支）', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>信物</p>', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>无</p>', order: 1 }),
        ],
        currentChapterId: 'ch2',
        foreshadows: [makeForeshadow({ id: 'f1', title: '信物', chaptersSinceMention: 1 })],
      });
      // 更新非 title/plantedChapterId 字段 → 不触发 recompute
      useAppStore.getState().updateForeshadow('f1', { status: 'paid-off', notes: '备注' });
      const f = useAppStore.getState().foreshadows[0];
      expect(f.status).toBe('paid-off');
      expect(f.notes).toBe('备注');
      // chaptersSinceMention 保持原值（未被 recompute 重算覆盖）
      expect(f.chaptersSinceMention).toBe(1);
    });

    it('deleteForeshadow：从列表移除', () => {
      const f = useAppStore.getState().addForeshadow({ title: 'x' });
      useAppStore.getState().deleteForeshadow(f.id);
      expect(useAppStore.getState().foreshadows).toHaveLength(0);
    });

    it('deleteForeshadow：级联清理支线 relatedForeshadows', () => {
      const f = useAppStore.getState().addForeshadow({ title: 'x' });
      const subplot = makeSubplot({ id: 's1', relatedForeshadows: [f.id] });
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        subplots: [subplot],
        projects: [{ ...project, subplots: [subplot] }],
      });
      useAppStore.getState().deleteForeshadow(f.id);
      expect(useAppStore.getState().subplots[0].relatedForeshadows).toHaveLength(0);
    });

    it('deleteForeshadow：M10 修复——顶层 subplots 与 projects[].subplots 单次 set 原子更新，订阅者不观察到中间态', () => {
      const f = useAppStore.getState().addForeshadow({ title: 'x' });
      const subplot = makeSubplot({ id: 's1', relatedForeshadows: [f.id] });
      const project = useAppStore.getState().projects[0];
      useAppStore.setState({
        subplots: [subplot],
        projects: [{ ...project, subplots: [subplot] }],
      });
      // 订阅 store，记录每次通知时的 subplots 与 projects[0].subplots 是否一致
      const snapshots: { topRelated: string[]; projRelated: string[] }[] = [];
      const unsub = useAppStore.subscribe((s) => {
        const top = s.subplots[0]?.relatedForeshadows || [];
        const proj = s.projects[0]?.subplots?.[0]?.relatedForeshadows || [];
        snapshots.push({ topRelated: [...top], projRelated: [...proj] });
      });
      try {
        useAppStore.getState().deleteForeshadow(f.id);
      } finally {
        unsub();
      }
      // 最终态：两者都已清空
      const final = useAppStore.getState();
      expect(final.subplots[0].relatedForeshadows).toHaveLength(0);
      expect(final.projects[0].subplots![0].relatedForeshadows).toHaveLength(0);
      // 中间态断言：任何一次通知中，顶层与 projects 的 relatedForeshadows 长度必须一致
      for (const snap of snapshots) {
        expect(snap.topRelated.length).toBe(snap.projRelated.length);
      }
      // 持久化走 patchProjects（原子 update），而非 updateProject（会触发第二次 set）
      expect(mockStorage.patchProjects).toHaveBeenCalledTimes(1);
      expect(mockStorage.patchProjects).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update' }),
      );
    });
  });

  // -------------------- recomputeForeshadowMentions --------------------
  describe('recomputeForeshadowMentions', () => {
    it('无伏笔时 noop', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1' })],
        foreshadows: [],
      });
      expect(() => useAppStore.getState().recomputeForeshadowMentions()).not.toThrow();
    });

    it('无章节时 noop', () => {
      useAppStore.setState({
        chapters: [],
        foreshadows: [makeForeshadow({ id: 'f1', title: 'x' })],
      });
      expect(() => useAppStore.getState().recomputeForeshadowMentions()).not.toThrow();
    });

    it('当前章节正文提及伏笔标题：chaptersSinceMention=0', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>神秘信物登场</p>', order: 0 })],
        currentChapterId: 'ch1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '神秘信物' })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
    });

    it('当前章节未提及但前置章节提及：距离 = current - lastMention', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>神秘信物</p>', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>无</p>', order: 1 }),
          makeChapter({ id: 'ch3', content: '<p>无</p>', order: 2 }),
        ],
        currentChapterId: 'ch3',
        foreshadows: [makeForeshadow({ id: 'f1', title: '神秘信物' })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(2);
    });

    it('无正文提及但已设 plantedChapterId：回退到 planted 距离', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>无</p>', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>无</p>', order: 1 }),
          makeChapter({ id: 'ch3', content: '<p>无</p>', order: 2 }),
        ],
        currentChapterId: 'ch3',
        foreshadows: [makeForeshadow({ id: 'f1', title: '不存在', plantedChapterId: 'ch1' })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(2);
    });

    it('多卷结构：DFS 全局阅读顺序正确展开', () => {
      // Book1 (order=0) → A (order=0), B (order=1)
      // Book2 (order=1) → C (order=0), D (order=1)
      // 阅读顺序应为 A, B, C, D（不是 A, C, B, D）
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'book1', title: 'Book1', level: 1, levelType: 'book', order: 0, parentId: null }),
          makeChapter({ id: 'book2', title: 'Book2', level: 1, levelType: 'book', order: 1, parentId: null }),
          makeChapter({ id: 'a', title: 'A', level: 2, levelType: 'chapter', order: 0, parentId: 'book1', content: '<p>伏笔</p>' }),
          makeChapter({ id: 'b', title: 'B', level: 2, levelType: 'chapter', order: 1, parentId: 'book1', content: '<p>无</p>' }),
          makeChapter({ id: 'c', title: 'C', level: 2, levelType: 'chapter', order: 0, parentId: 'book2', content: '<p>无</p>' }),
          makeChapter({ id: 'd', title: 'D', level: 2, levelType: 'chapter', order: 1, parentId: 'book2', content: '<p>无</p>' }),
        ],
        currentChapterId: 'd',
        foreshadows: [makeForeshadow({ id: 'f1', title: '伏笔' })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // DFS 顺序: A(0), B(1), C(2), D(3)；当前 D(3)，A(0) 提及 → 距离 = 3 - 0 = 3
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(3);
    });

    it('HTML 标签被剥离后再做标题匹配', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>正文含<b>神秘</b>信物提及</p>', order: 0 })],
        currentChapterId: 'ch1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '神秘信物' })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // 剥离 HTML 后为 "正文含神秘信物提及"，包含 "神秘信物"
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
    });

    it('chapterPlainTextCache 命中：相同内容不重复计算', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>神秘信物</p>', order: 0 })],
        currentChapterId: 'ch1',
        foreshadows: [
          makeForeshadow({ id: 'f1', title: '神秘信物' }),
          makeForeshadow({ id: 'f2', title: '神秘信物' }),
        ],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // 两个伏笔都应识别到提及
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
      expect(useAppStore.getState().foreshadows[1].chaptersSinceMention).toBe(0);
    });

    it('currentChapterId 为 null 时：以最后一章为当前章（覆盖 currentChapterId 三元 false 分支）', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>信物</p>', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>无</p>', order: 1 }),
        ],
        currentChapterId: null,
        foreshadows: [makeForeshadow({ id: 'f1', title: '信物', chaptersSinceMention: 99 })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // currentChapterId null → currentIndex = flatChapters.length-1 = 1（ch2）
      // ch1 提及"信物"，距离 = 1 - 0 = 1
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(1);
    });

    it('currentChapterId 指向非正文章节节点：currentIndex 为 -1 时回退到最后一章', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'book1', level: 1, levelType: 'book', order: 0, parentId: null, content: '' }),
          makeChapter({ id: 'ch1', level: 2, levelType: 'chapter', order: 0, parentId: 'book1', content: '<p>信物</p>' }),
          makeChapter({ id: 'ch2', level: 2, levelType: 'chapter', order: 1, parentId: 'book1', content: '<p>无</p>' }),
        ],
        // currentChapterId 指向 book 节点，不在 flatChapters（只含 levelType==='chapter'）→ findIndex=-1
        currentChapterId: 'book1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '信物', chaptersSinceMention: 99 })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // flatChapters = [ch1, ch2]；currentIndex=-1 → effectiveCurrentIndex=1（ch2）
      // ch1 提及"信物" → 距离 = 1 - 0 = 1
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(1);
    });

    it('仅有非正文章节节点：flatChapters 为空时 noop（覆盖 length===0 早退分支）', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'book1', level: 1, levelType: 'book', order: 0, parentId: null, content: '<p>信物</p>' }),
        ],
        currentChapterId: 'book1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '信物', chaptersSinceMention: 5 })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // flatChapters 为空 → return，chaptersSinceMention 不变
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(5);
    });

    it('伏笔标题为空白：跳过该伏笔不重算（覆盖 !title 早退分支）', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>任意</p>', order: 0 })],
        currentChapterId: 'ch1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '   ', chaptersSinceMention: 5 })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // 空 title → return f（不变）
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(5);
    });

    it('无正文提及且 plantedChapterId 不在 flatChapters 中：距离回退为 0（覆盖 plantedIndex===-1 分支）', () => {
      useAppStore.setState({
        chapters: [
          makeChapter({ id: 'ch1', content: '<p>无</p>', order: 0 }),
          makeChapter({ id: 'ch2', content: '<p>无</p>', order: 1 }),
        ],
        currentChapterId: 'ch2',
        // plantedChapterId 指向不存在的章节 → findIndex 返回 -1
        foreshadows: [makeForeshadow({ id: 'f1', title: '不存在', plantedChapterId: 'ghost', chaptersSinceMention: 99 })],
      });
      useAppStore.getState().recomputeForeshadowMentions();
      // 无提及 + plantedChapterId 不在 flatChapters → plantedIndex=-1 → distance=0
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
    });
  });

  // -------------------- 素材 --------------------
  describe('素材域', () => {
    it('addMaterial：默认值填充', () => {
      const m = useAppStore.getState().addMaterial({ title: '灵感1' });
      expect(m.id).toBeTruthy();
      expect(m.title).toBe('灵感1');
      expect(m.type).toBe('inspiration'); // DEFAULT_MATERIAL_TYPE
      expect(m.category).toBe('未分类');
      expect(m.pinned).toBe(false);
    });

    it('addMaterial：无项目抛错', () => {
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().addMaterial({})).toThrow('No project open');
    });

    it('updateMaterial：合并字段', () => {
      const m = useAppStore.getState().addMaterial({ title: 'x' });
      useAppStore.getState().updateMaterial(m.id, { pinned: true, tags: ['t1'] });
      const updated = useAppStore.getState().materials.find(x => x.id === m.id)!;
      expect(updated.pinned).toBe(true);
      expect(updated.tags).toEqual(['t1']);
    });

    it('deleteMaterial：从列表移除', () => {
      const m = useAppStore.getState().addMaterial({ title: 'x' });
      useAppStore.getState().deleteMaterial(m.id);
      expect(useAppStore.getState().materials).toHaveLength(0);
    });

    it('deleteMaterial：无项目 noop', () => {
      const m = useAppStore.getState().addMaterial({ title: 'x' });
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().deleteMaterial(m.id);
      expect(useAppStore.getState().materials).toHaveLength(1);
    });
  });

  // -------------------- 分支覆盖补充（第二轮）--------------------
  describe('分支覆盖补充', () => {
    // ---------- || 默认值真分支（显式传入所有字段） ----------
    it('addCharacter：所有字段显式传入（覆盖 L60 各 || 真分支）', () => {
      const c = useAppStore.getState().addCharacter({
        name: '关羽', role: 'protagonist', color: '#ff0000',
        profile: { personality: '勇武' }, relationships: [], tags: ['勇'],
      });
      expect(c.name).toBe('关羽');
      expect(c.role).toBe('protagonist');
      expect(c.color).toBe('#ff0000');
      expect(c.profile).toEqual({ personality: '勇武' });
      expect(c.relationships).toEqual([]);
      expect(c.tags).toEqual(['勇']);
    });

    it('addCharacter：name 为空取默认"新角色"（覆盖 L60 name || 假分支）', () => {
      const c = useAppStore.getState().addCharacter({ name: '' });
      expect(c.name).toBe('新角色');
    });

    it('addForeshadow：所有字段显式传入（覆盖 L212-221 各 || 真分支）', () => {
      const f = useAppStore.getState().addForeshadow({
        title: '信物', description: '描述', status: 'paid-off',
        plantedChapterId: 'ch1', payoffChapterId: 'ch2', priority: 'high',
        relatedCharacters: ['c1'], relatedSettings: ['s1'], notes: '备注',
      });
      expect(f.title).toBe('信物');
      expect(f.description).toBe('描述');
      expect(f.status).toBe('paid-off');
      expect(f.plantedChapterId).toBe('ch1');
      expect(f.payoffChapterId).toBe('ch2');
      expect(f.priority).toBe('high');
      expect(f.relatedCharacters).toEqual(['c1']);
      expect(f.relatedSettings).toEqual(['s1']);
      expect(f.notes).toBe('备注');
    });

    it('addForeshadow：title 为空取默认"新伏笔"（覆盖 L212 title || 假分支）', () => {
      const f = useAppStore.getState().addForeshadow({ title: '' });
      expect(f.title).toBe('新伏笔');
    });

    it('addMaterial：所有字段显式传入（覆盖 L360 各 || 真分支）', () => {
      const m = useAppStore.getState().addMaterial({
        title: '素材', type: 'reference', content: '内容', source: '来源',
        url: 'http://x', tags: ['t'], category: '分类', references: [], pinned: true,
      });
      expect(m.title).toBe('素材');
      expect(m.type).toBe('reference');
      expect(m.content).toBe('内容');
      expect(m.source).toBe('来源');
      expect(m.url).toBe('http://x');
      expect(m.tags).toEqual(['t']);
      expect(m.category).toBe('分类');
      expect(m.references).toEqual([]);
      expect(m.pinned).toBe(true);
    });

    it('addMaterial：title 为空取默认"新素材"（覆盖 L360 title || 假分支）', () => {
      const m = useAppStore.getState().addMaterial({ title: '' });
      expect(m.title).toBe('新素材');
    });

    // ---------- 无项目 noop / 抛错守卫 ----------
    it('updateSettingCategory：无项目 noop（覆盖 L139 守卫）', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateSettingCategory(cat.id, { color: '#fff' });
      expect(useAppStore.getState().settingCategories.find(c => c.id === cat.id)!.color).toBe('#6b7c93');
    });

    it('addSettingItem：无项目抛错（覆盖 L167 守卫）', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      useAppStore.setState({ currentProjectId: null });
      expect(() => useAppStore.getState().addSettingItem(cat.id, 'x')).toThrow('No project open');
    });

    it('updateSettingItem：无项目 noop（覆盖 L179 守卫）', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, 'x');
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateSettingItem(item.id, { content: '新' });
      expect(useAppStore.getState().settingItems.find(i => i.id === item.id)!.content).toBe('');
    });

    it('deleteSettingItem：无项目 noop（覆盖 L187 守卫）', () => {
      const cat = useAppStore.getState().addSettingCategory('a', '📄');
      const item = useAppStore.getState().addSettingItem(cat.id, 'x');
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().deleteSettingItem(item.id);
      expect(useAppStore.getState().settingItems).toHaveLength(1);
    });

    it('updateForeshadow：无项目 noop（覆盖 L235 守卫）', () => {
      const f = useAppStore.getState().addForeshadow({ title: 'x' });
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateForeshadow(f.id, { status: 'paid-off' });
      expect(useAppStore.getState().foreshadows[0].status).toBe('planted');
    });

    it('deleteForeshadow：无项目 noop（覆盖 L247 守卫）', () => {
      const f = useAppStore.getState().addForeshadow({ title: 'x' });
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().deleteForeshadow(f.id);
      expect(useAppStore.getState().foreshadows).toHaveLength(1);
    });

    it('updateMaterial：无项目 noop（覆盖 L370 守卫）', () => {
      const m = useAppStore.getState().addMaterial({ title: 'x' });
      useAppStore.setState({ currentProjectId: null });
      useAppStore.getState().updateMaterial(m.id, { pinned: true });
      expect(useAppStore.getState().materials.find(x => x.id === m.id)!.pinned).toBe(false);
    });

    // ---------- deleteCharacter 边界分支 ----------
    it('deleteCharacter：章节无 characterFocus 字段时保留原值（覆盖 L100 三元 false）', () => {
      const c = useAppStore.getState().addCharacter({ name: 'x' });
      // makeChapter 默认不含 characterFocus（undefined）→ 走三元 false 分支
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>普通</p>' })],
      });
      expect(() => useAppStore.getState().deleteCharacter(c.id)).not.toThrow();
      expect(useAppStore.getState().chapters).toHaveLength(1);
    });

    it('deleteCharacter：章节内容为空时不走 mention 清理（覆盖 L101 !c.content truthy）', () => {
      const c = useAppStore.getState().addCharacter({ name: '叶文洁' });
      // makeChapter 默认 content='' → !c.content 为 true → 跳过 replace
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch-empty', characterFocus: [c.id] })],
      });
      useAppStore.getState().deleteCharacter(c.id);
      // content 为空 → 跳过 mention 清理，仅清理 characterFocus
      expect(useAppStore.getState().chapters[0].characterFocus).toEqual([]);
    });

    // ---------- recomputeForeshadowMentions 边界分支 ----------
    it('recomputeForeshadowMentions：章节内容为空时 getChapterPlainText 的 || 假分支（覆盖 L41）', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '', order: 0 })],
        currentChapterId: 'ch1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '任何' })],
      });
      expect(() => useAppStore.getState().recomputeForeshadowMentions()).not.toThrow();
      // 空内容不提及"任何" → distance=0
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
    });

    it('recomputeForeshadowMentions：二次调用命中缓存（覆盖 getChapterPlainText cache-hit）', () => {
      useAppStore.setState({
        chapters: [makeChapter({ id: 'ch1', content: '<p>信物</p>', order: 0 })],
        currentChapterId: 'ch1',
        foreshadows: [makeForeshadow({ id: 'f1', title: '信物' })],
      });
      // 首次调用：cache miss → 计算纯文本并写入缓存
      useAppStore.getState().recomputeForeshadowMentions();
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
      // 二次调用：cache hit → 直接返回缓存纯文本
      useAppStore.getState().recomputeForeshadowMentions();
      expect(useAppStore.getState().foreshadows[0].chaptersSinceMention).toBe(0);
    });
  });
});
