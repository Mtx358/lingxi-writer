import { describe, it, expect } from 'vitest';
import { ConflictDetector, conflictDetector } from './conflictDetector';
import type { Chapter, Character, SettingItem } from '@/types';

// ============ 测试数据工厂 ============

function makeChapter(content: string, id = 'ch1', title = '测试章节'): Chapter {
  return {
    id,
    projectId: 'p1',
    parentId: null,
    title,
    summary: '',
    order: 1,
    level: 1,
    levelType: 'chapter',
    status: 'draft',
    wordCount: 0,
    content,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeCharacter(name: string, id = 'c1', role: Character['role'] = 'protagonist'): Character {
  return {
    id,
    projectId: 'p1',
    name,
    role,
    color: '#fff',
    profile: {},
    relationships: [],
    appearanceCount: 0,
    dialogueCount: 0,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeSetting(name: string, description: string, id = 's1'): SettingItem {
  return {
    id,
    projectId: 'p1',
    categoryId: 'cat1',
    name,
    description,
    content: '',
    references: [],
    tags: [],
    order: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// 构造一段第一/第三人称混用的长文本（> 500 字，非对话，ratio 0.3-0.7）
function makePerspectiveMixText(): string {
  const segment =
    '我走在回家的路上，他远远地跟在后面。我知道他在看我，但我没有回头。他加快了脚步，我也加快了脚步。我们之间隔着一段距离，但他似乎并不着急。';
  // segment 约 68 字，含 6 个"我"、4 个"他"；重复 8 次 → > 500 字、二者均 > 10 次
  return segment.repeat(8);
}

describe('ConflictDetector', () => {
  describe('空数据与无冲突场景', () => {
    it('空章节列表 detectGlobalConflicts 应返回空数组', () => {
      const detector = new ConflictDetector();
      expect(detector.detectGlobalConflicts([])).toEqual([]);
    });

    it('无角色无设定时，正常章节应返回空冲突数组', () => {
      const detector = new ConflictDetector();
      const chapter = makeChapter('<p>这是一段普通的叙述文字，没有任何冲突因素。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      expect(issues).toEqual([]);
    });

    it('单章节无冲突：正常文学表达不应误报', () => {
      const detector = new ConflictDetector();
      const chapter = makeChapter('<p>他心想：这件事真奇怪。她叹了口气，望向窗外。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      // 短文本不会触发视角冲突（< 500 字），无角色/设定不会触发其他规则
      expect(issues).toEqual([]);
    });
  });

  describe('视角冲突检测', () => {
    it('第一/第三人称混用（非对话）应检测出 style 类型冲突', () => {
      const detector = new ConflictDetector();
      const chapter = makeChapter(`<p>${makePerspectiveMixText()}</p>`);
      const issues = detector.detectChapterConflicts(chapter);
      const perspectiveIssue = issues.find(
        i => i.type === 'style' && i.description.includes('人称'),
      );
      expect(perspectiveIssue).toBeDefined();
      expect(perspectiveIssue!.severity).toBe('warning');
    });

    it('对话中的第一/第三人称不应被误判为视角冲突', () => {
      const detector = new ConflictDetector();
      // 对话内大量"我/他"，但 stripDialogue 后非对话文本极短，不会触发
      const dialogueText =
        '"我叫李明，"他说，"他是我的兄弟。"' .repeat(20) + '叙述者站在一旁，静静看着这一切。';
      const chapter = makeChapter(`<p>${dialogueText}</p>`);
      const issues = detector.detectChapterConflicts(chapter);
      const perspectiveIssue = issues.find(
        i => i.type === 'style' && i.description.includes('人称'),
      );
      expect(perspectiveIssue).toBeUndefined();
    });

    it('"他心想" 不应触发视角冲突', () => {
      const detector = new ConflictDetector();
      const chapter = makeChapter(
        '<p>他心想这事不对劲。他转身离开。他知道她不会跟来。</p>',
      );
      const issues = detector.detectChapterConflicts(chapter);
      const perspectiveIssue = issues.find(i => i.type === 'style');
      expect(perspectiveIssue).toBeUndefined();
    });
  });

  describe('角色名一致性检测', () => {
    it('角色名变体（三字名后两字）出现 >= 2 次应报警告', () => {
      const detector = new ConflictDetector();
      detector.setCharacters([makeCharacter('赵小明', 'c1')]);
      // "小明" 是 "赵小明" 的变体（三字名取后两字），出现 3 次 >= 2
      const chapter = makeChapter(
        '<p>赵小明来到学校。小明今天迟到了。小明坐下后开始听课。老师叫小明回答问题。</p>',
      );
      const issues = detector.detectChapterConflicts(chapter);
      const nameIssue = issues.find(
        i => i.type === 'character' && i.description.includes('小明'),
      );
      expect(nameIssue).toBeDefined();
      expect(nameIssue!.severity).toBe('warning');
    });

    it('角色名变体仅出现 1 次不应报警（避免噪音）', () => {
      const detector = new ConflictDetector();
      detector.setCharacters([makeCharacter('赵小明', 'c1')]);
      // "小明" 仅出现在 "赵小明" 内部（regex 全局匹配算 1 次），< 2 不报警
      const chapter = makeChapter('<p>赵小明来到学校。他今天迟到了。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      const nameIssue = issues.find(
        i => i.type === 'character' && i.description.includes('小明'),
      );
      expect(nameIssue).toBeUndefined();
    });

    it('变体与另一角色全名冲突时不应误报', () => {
      const detector = new ConflictDetector();
      // "小明" 既是 "赵小明" 的变体，也是另一角色 "小明" 的全名 → 不应报警
      detector.setCharacters([makeCharacter('赵小明', 'c1'), makeCharacter('小明', 'c2')]);
      const chapter = makeChapter(
        '<p>赵小明和小明一起玩。小明很开心。小明笑了。</p>',
      );
      const issues = detector.detectChapterConflicts(chapter);
      const nameIssue = issues.find(
        i => i.type === 'character' && i.description.includes('小明'),
      );
      expect(nameIssue).toBeUndefined();
    });
  });

  describe('设定引用一致性检测', () => {
    it('设定被引用但描述关键词缺失应给出 info 级提示', () => {
      const detector = new ConflictDetector();
      // 设定 "龙脉" 描述含 "天地灵气"，但章节只提到 "龙脉" 未提到 "天地灵气"
      detector.setSettings([makeSetting('龙脉', '天地灵气汇聚之地，蕴含无尽灵力')]);
      const chapter = makeChapter('<p>主角来到龙脉附近，感受着周围的变化。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      const settingIssue = issues.find(i => i.type === 'setting');
      expect(settingIssue).toBeDefined();
      expect(settingIssue!.severity).toBe('info');
      expect(settingIssue!.description).toContain('龙脉');
    });

    it('设定未被章节引用时不应报警', () => {
      const detector = new ConflictDetector();
      detector.setSettings([makeSetting('龙脉', '天地灵气汇聚之地')]);
      const chapter = makeChapter('<p>主角走在路上，什么都没看到。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      const settingIssue = issues.find(i => i.type === 'setting');
      expect(settingIssue).toBeUndefined();
    });
  });

  describe('严重度分级', () => {
    it('warning 级别：视角混用产生 warning', () => {
      const detector = new ConflictDetector();
      const chapter = makeChapter(`<p>${makePerspectiveMixText()}</p>`);
      const issues = detector.detectChapterConflicts(chapter);
      const warnings = issues.filter(i => i.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('info 级别：设定关键词缺失产生 info', () => {
      const detector = new ConflictDetector();
      detector.setSettings([makeSetting('灵石', '蕴含纯净灵力的矿石')]);
      const chapter = makeChapter('<p>他拿出一块灵石，仔细端详。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      const infos = issues.filter(i => i.severity === 'info');
      expect(infos.length).toBeGreaterThan(0);
    });

    it('ConflictIssue 结构应包含必要字段', () => {
      const detector = new ConflictDetector();
      detector.setSettings([makeSetting('灵石', '蕴含纯净灵力的矿石')]);
      const chapter = makeChapter('<p>他拿出一块灵石，仔细端详。</p>');
      const issues = detector.detectChapterConflicts(chapter);
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue).toHaveProperty('id');
        expect(issue).toHaveProperty('type');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('chapterId', chapter.id);
        expect(issue).toHaveProperty('description');
        expect(issue).toHaveProperty('suggestion');
        expect(issue).toHaveProperty('resolved', false);
      }
    });
  });

  describe('detectGlobalConflicts 跨章节检测', () => {
    it('主角连续多章未出场应给出 info 提示', () => {
      const detector = new ConflictDetector();
      const protagonist = makeCharacter('李明', 'c1', 'protagonist');
      detector.setCharacters([protagonist]);

      // 5 章，主角只在第 1 章出现，后续 4 章未出场
      const chapters: Chapter[] = [];
      for (let i = 0; i < 5; i++) {
        const content = i === 0 ? '<p>李明出场了。</p>' : '<p>本章没有主角。</p>';
        chapters.push({
          ...makeChapter(content, `ch${i + 1}`, `第${i + 1}章`),
          order: i + 1,
        });
      }
      const issues = detector.detectGlobalConflicts(chapters);
      const absenceIssue = issues.find(i =>
        i.description.includes('没有出场'),
      );
      expect(absenceIssue).toBeDefined();
      expect(absenceIssue!.severity).toBe('info');
    });

    it('主角每章都出场时不应报警', () => {
      const detector = new ConflictDetector();
      const protagonist = makeCharacter('李明', 'c1', 'protagonist');
      detector.setCharacters([protagonist]);

      const chapters: Chapter[] = [];
      for (let i = 0; i < 5; i++) {
        chapters.push({
          ...makeChapter('<p>李明做了某事。</p>', `ch${i + 1}`),
          order: i + 1,
        });
      }
      const issues = detector.detectGlobalConflicts(chapters);
      expect(issues).toEqual([]);
    });
  });

  describe('单例 conflictDetector', () => {
    it('应导出可用的单例实例', () => {
      expect(conflictDetector).toBeInstanceOf(ConflictDetector);
      // 单例可正常调用 setCharacters / detectChapterConflicts
      conflictDetector.setCharacters([]);
      conflictDetector.setSettings([]);
      const issues = conflictDetector.detectChapterConflicts(
        makeChapter('<p>普通文本。</p>'),
      );
      expect(Array.isArray(issues)).toBe(true);
    });
  });
});
