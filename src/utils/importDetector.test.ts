/**
 * importDetector 测试
 *
 * 覆盖智能导入检测器的三类核心能力：
 *   1. 内容形式识别（detectContentForm）
 *   2. 章节标题识别（CHAPTER_PATTERNS / matchChapterTitle / detectCustomChapterPattern）
 *   3. 项目指纹识别（computeImportFingerprint / matchProject / decideImportAction）
 *
 * 关键不变量：
 *   - 内容形式识别不依赖文件扩展名，只看内容特征
 *   - 章节标题识别必须行首锚定，正文中的"第X章"不算标题
 *   - 项目指纹比对：标题归一化后比对（去书名号/空白/大小写）
 *   - 情境决策矩阵：6 种典型场景的自动反应
 */
import { describe, it, expect } from 'vitest';
import {
  detectContentForm,
  CHAPTER_PATTERNS,
  matchChapterTitle,
  detectCustomChapterPattern,
  countDetectableChapters,
  computeImportFingerprint,
  computeProjectFingerprint,
  matchProject,
  findMatchingProjects,
  decideImportAction,
  computeNewChapters,
  computeModifiedChapters,
} from './importDetector';
import type { ImportResult } from './importUtils';
import type { Project, Chapter } from '@/types';

// ============ 测试夹具 ============

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', title: '测试小说', description: '', template: 'blank',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    lastOpenedAt: '2024-01-01T00:00:00.000Z', totalWords: 0,
    config: {
      theme: 'dark', fontSize: 16, lineHeight: 1.6, fontFamily: 'sans',
      showLineNumbers: false, showWordCount: true, zenMode: false,
      aiSettings: {
        provider: 'mock', style: 'balanced', descriptionDensity: 50,
        dialogueDensity: 50, strictness: 50, temperature: 0.7,
        maxTokens: 1000, autoCheckConflicts: false,
      },
    },
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'c1', projectId: 'p1', parentId: null, title: '第一章', summary: '',
    order: 0, level: 2, levelType: 'chapter', status: 'draft', wordCount: 0,
    content: '', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeImportResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    title: '测试小说',
    chapters: [
      { title: '第一章 风雪', content: '<p>正文</p>', level: 2, order: 0 },
      { title: '第二章 浴血', content: '<p>正文</p>', level: 2, order: 1 },
      { title: '第三章 东风', content: '<p>正文</p>', level: 2, order: 2 },
    ],
    totalWords: 100,
    ...overrides,
  };
}

// ============ detectContentForm ============

describe('detectContentForm', () => {
  it('空内容返回 empty', () => {
    expect(detectContentForm('')).toBe('empty');
    expect(detectContentForm('   \n  \t  ')).toBe('empty');
  });

  it('含行首 # 标题识别为 markdown', () => {
    expect(detectContentForm('# 标题\n正文')).toBe('markdown');
    expect(detectContentForm('## 二级\n正文')).toBe('markdown');
  });

  it('含多种 markdown 特征识别为 markdown（≥2 种）', () => {
    const md = '**加粗**\n\n- 列表项\n\n> 引用';
    expect(detectContentForm(md)).toBe('markdown');
  });

  it('单一 markdown 特征不识别为 markdown（避免误判）', () => {
    // 只有 ** 加粗，没有其他特征，且没有 # 标题 → plain-text
    expect(detectContentForm('这是一段**加粗**的文字。')).toBe('plain-text');
  });

  it('含多个 HTML 标签识别为 html（≥2 个）', () => {
    expect(detectContentForm('<html><body><p>内容</p></body></html>')).toBe('html');
    expect(detectContentForm('<div><p>内容</p></div>')).toBe('html');
  });

  it('单一 HTML 标签不识别为 html（避免偶然的 < > 误判）', () => {
    expect(detectContentForm('1 < 2 且 3 > 1，这是数学表达式。')).toBe('plain-text');
  });

  it('纯文本识别为 plain-text', () => {
    expect(detectContentForm('这是一段纯文本，没有任何标记。')).toBe('plain-text');
    expect(detectContentForm('第一章 风雪\n正文内容\n第二章 浴血')).toBe('plain-text');
  });
});

// ============ CHAPTER_PATTERNS / matchChapterTitle ============

describe('matchChapterTitle', () => {
  it('识别"第X章"标题', () => {
    const m = matchChapterTitle('第一章 风雪新野');
    expect(m).not.toBeNull();
    expect(m?.level).toBe(2);
  });

  it('识别"第X卷"为卷级（level=1）', () => {
    const m = matchChapterTitle('第一卷 风雪新野');
    expect(m).not.toBeNull();
    expect(m?.level).toBe(1);
  });

  it('识别"卷X：名"', () => {
    expect(matchChapterTitle('卷一：风雪新野')).not.toBeNull();
  });

  it('识别"上部/中部/下部"', () => {
    expect(matchChapterTitle('上部·觉醒')?.level).toBe(1);
    expect(matchChapterTitle('中部·浴血')?.level).toBe(1);
    expect(matchChapterTitle('下部·东风')?.level).toBe(1);
  });

  it('识别"序章/楔子/引子"', () => {
    expect(matchChapterTitle('序章 风起')?.level).toBe(2);
    expect(matchChapterTitle('楔子：乱世')?.level).toBe(2);
    expect(matchChapterTitle('引子')?.level).toBe(2);
  });

  it('识别"番外"', () => {
    expect(matchChapterTitle('番外一 十年后')).not.toBeNull();
    expect(matchChapterTitle('番外：回忆')).not.toBeNull();
  });

  it('识别英文 Chapter/Volume', () => {
    expect(matchChapterTitle('Chapter 1: The Beginning')?.level).toBe(2);
    expect(matchChapterTitle('Volume 1: Storm')?.level).toBe(1);
    expect(matchChapterTitle('Prologue: Before the Storm')?.level).toBe(2);
    expect(matchChapterTitle('Epilogue: After')?.level).toBe(2);
  });

  it('识别数字编号 1. / 1、', () => {
    expect(matchChapterTitle('1. 风雪新野')).not.toBeNull();
    expect(matchChapterTitle('1、风雪新野')).not.toBeNull();
  });

  it('识别【1】[1] 1)', () => {
    expect(matchChapterTitle('【1】风雪新野')).not.toBeNull();
    expect(matchChapterTitle('[1] 风雪新野')).not.toBeNull();
    expect(matchChapterTitle('1) 风雪新野')).not.toBeNull();
  });

  it('拒绝正文中的"第X章"（非行首或超长）', () => {
    // 超长（>50 字符）不识别
    const longLine = '第一章'.repeat(20);
    expect(matchChapterTitle(longLine)).toBeNull();
  });

  it('拒绝普通正文行', () => {
    expect(matchChapterTitle('这是正文内容，描述主角的行动。')).toBeNull();
    expect(matchChapterTitle('')).toBeNull();
  });

  it('支持自定义前缀模式', () => {
    const custom = detectCustomChapterPattern('✦第一话 风起\n✦第二话 浴血\n✦第三话 东风');
    expect(custom).not.toBeNull();
    expect(matchChapterTitle('✦第一话 风起', custom)).not.toBeNull();
  });
});

// ============ detectCustomChapterPattern ============

describe('detectCustomChapterPattern', () => {
  it('识别重复 ≥3 次的自定义前缀', () => {
    const text = '✦第一话 风起\n✦第二话 浴血\n✦第三话 东风\n正文内容';
    const p = detectCustomChapterPattern(text);
    expect(p).not.toBeNull();
    expect(p?.name).toContain('✦第');
  });

  it('重复 <3 次不识别', () => {
    const text = '✦第一话 风起\n✦第二话 浴血\n正文';
    expect(detectCustomChapterPattern(text)).toBeNull();
  });

  it('已匹配内置模式的前缀不识别为自定义', () => {
    // "第一章" 已被内置模式识别，不应被识别为自定义前缀"第一"
    const text = '第一章 风起\n第二章 浴血\n第三章 东风';
    expect(detectCustomChapterPattern(text)).toBeNull();
  });

  it('含正文标点的行不参与前缀检测', () => {
    // 含句号/逗号的行被跳过
    const text = 'XX标题一。\nXX标题二。\nXX标题三。';
    expect(detectCustomChapterPattern(text)).toBeNull();
  });
});

// ============ countDetectableChapters ============

describe('countDetectableChapters', () => {
  it('统计多种章节标题混合', () => {
    const text = `
第一卷 风雪
上部·觉醒
第一章 风起
第二章 浴血
序章 乱世
番外 回忆
    `;
    expect(countDetectableChapters(text)).toBe(6);
  });

  it('无章节标题返回 0', () => {
    expect(countDetectableChapters('一段普通正文，没有标题。')).toBe(0);
  });

  it('识别自定义前缀章节', () => {
    const text = '✦第一话 风起\n✦第二话 浴血\n✦第三话 东风\n正文';
    expect(countDetectableChapters(text)).toBe(3);
  });
});

// ============ computeImportFingerprint / computeProjectFingerprint ============

describe('computeImportFingerprint', () => {
  it('归一化标题（去书名号、去空白、小写）', () => {
    const fp1 = computeImportFingerprint(makeImportResult({ title: '《测试小说》' }));
    const fp2 = computeImportFingerprint(makeImportResult({ title: '测试小说' }));
    const fp3 = computeImportFingerprint(makeImportResult({ title: ' 测 试 小 说 ' }));
    expect(fp1.normalizedTitle).toBe(fp2.normalizedTitle);
    expect(fp2.normalizedTitle).toBe(fp3.normalizedTitle);
  });

  it('章节数与总字数正确', () => {
    const fp = computeImportFingerprint(makeImportResult());
    expect(fp.chapterCount).toBe(3);
    expect(fp.totalWords).toBe(100);
  });

  it('前 3 章 hash 与全章节 hash 不同（章节多时）', () => {
    const fp = computeImportFingerprint(makeImportResult({
      chapters: [
        { title: '第一章', content: '', level: 2, order: 0 },
        { title: '第二章', content: '', level: 2, order: 1 },
        { title: '第三章', content: '', level: 2, order: 2 },
        { title: '第四章', content: '', level: 2, order: 3 },
      ],
    }));
    expect(fp.firstChaptersHash).not.toBe(fp.allChaptersHash);
  });

  it('章节顺序敏感：相同章节不同顺序 hash 不同', () => {
    const fp1 = computeImportFingerprint(makeImportResult({
      chapters: [
        { title: 'A', content: '', level: 2, order: 0 },
        { title: 'B', content: '', level: 2, order: 1 },
        { title: 'C', content: '', level: 2, order: 2 },
      ],
    }));
    const fp2 = computeImportFingerprint(makeImportResult({
      chapters: [
        { title: 'C', content: '', level: 2, order: 0 },
        { title: 'B', content: '', level: 2, order: 1 },
        { title: 'A', content: '', level: 2, order: 2 },
      ],
    }));
    expect(fp1.firstChaptersHash).not.toBe(fp2.firstChaptersHash);
    expect(fp1.allChaptersHash).not.toBe(fp2.allChaptersHash);
  });
});

describe('computeProjectFingerprint', () => {
  it('排除 book 容器章节', () => {
    const project = makeProject({ id: 'p1', title: '测试小说' });
    const chapters = [
      makeChapter({ id: 'c0', projectId: 'p1', title: '全书', levelType: 'book', order: 0 }),
      makeChapter({ id: 'c1', projectId: 'p1', title: '第一章', order: 1 }),
      makeChapter({ id: 'c2', projectId: 'p1', title: '第二章', order: 2 }),
    ];
    const fp = computeProjectFingerprint(project, chapters);
    expect(fp.chapterCount).toBe(2);  // 排除 book
  });

  it('只参与本项目章节（跨项目过滤）', () => {
    const project = makeProject({ id: 'p1', title: '测试小说' });
    const chapters = [
      makeChapter({ id: 'c1', projectId: 'p1', title: '第一章', order: 0 }),
      makeChapter({ id: 'c2', projectId: 'p2', title: '其他项目章节', order: 0 }),
    ];
    const fp = computeProjectFingerprint(project, chapters);
    expect(fp.chapterCount).toBe(1);
  });
});

// ============ matchProject ============

describe('matchProject', () => {
  it('exact：标题相同 + 前3章相同 + 章节数相同', () => {
    const importFp = computeImportFingerprint(makeImportResult());
    const project = makeProject({ title: '测试小说' });
    const chapters = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
      makeChapter({ title: '第三章 东风', order: 2 }),
    ];
    const projectFp = computeProjectFingerprint(project, chapters);
    const m = matchProject(importFp, projectFp);
    expect(m.level).toBe('exact');
    expect(m.score).toBe(100);
  });

  it('high：标题相同 + 前3章相同，章节数不同（追更）', () => {
    const importFp = computeImportFingerprint(makeImportResult({
      chapters: [
        { title: '第一章 风雪', content: '', level: 2, order: 0 },
        { title: '第二章 浴血', content: '', level: 2, order: 1 },
        { title: '第三章 东风', content: '', level: 2, order: 2 },
        { title: '第四章 新章', content: '', level: 2, order: 3 },
      ],
    }));
    const project = makeProject({ title: '测试小说' });
    const chapters = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
      makeChapter({ title: '第三章 东风', order: 2 }),
    ];
    const projectFp = computeProjectFingerprint(project, chapters);
    const m = matchProject(importFp, projectFp);
    expect(m.level).toBe('high');
    expect(m.score).toBeGreaterThanOrEqual(85);
  });

  it('medium：标题相同但前3章不同（同名不同书）', () => {
    const importFp = computeImportFingerprint(makeImportResult({
      chapters: [
        { title: '不同的第一章', content: '', level: 2, order: 0 },
        { title: '不同的第二章', content: '', level: 2, order: 1 },
      ],
    }));
    const project = makeProject({ title: '测试小说' });
    const chapters = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
    ];
    const projectFp = computeProjectFingerprint(project, chapters);
    const m = matchProject(importFp, projectFp);
    expect(m.level).toBe('medium');
  });

  it('none：标题和内容都不匹配', () => {
    const importFp = computeImportFingerprint(makeImportResult({ title: '完全不同的书' }));
    const project = makeProject({ title: '另一本书' });
    const chapters = [makeChapter({ title: '其他章节', order: 0 })];
    const projectFp = computeProjectFingerprint(project, chapters);
    const m = matchProject(importFp, projectFp);
    expect(m.level).toBe('none');
  });

  it('reasons 字段填充命中的特征', () => {
    const importFp = computeImportFingerprint(makeImportResult());
    const project = makeProject({ title: '测试小说' });
    const chapters = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
      makeChapter({ title: '第三章 东风', order: 2 }),
    ];
    const projectFp = computeProjectFingerprint(project, chapters);
    const m = matchProject(importFp, projectFp);
    expect(m.reasons).toContain('项目名相同');
    expect(m.reasons).toContain('前 3 章标题序列相同');
  });
});

// ============ findMatchingProjects ============

describe('findMatchingProjects', () => {
  it('返回 medium 及以上匹配，按分数降序', () => {
    const importFp = computeImportFingerprint(makeImportResult({ title: '测试小说' }));
    const projectExact = makeProject({ id: 'p1', title: '测试小说' });
    const projectSameTitle = makeProject({ id: 'p2', title: '测试小说' });
    const projectUnrelated = makeProject({ id: 'p3', title: '无关项目' });

    const chaptersExact = [
      makeChapter({ projectId: 'p1', title: '第一章 风雪', order: 0 }),
      makeChapter({ projectId: 'p1', title: '第二章 浴血', order: 1 }),
      makeChapter({ projectId: 'p1', title: '第三章 东风', order: 2 }),
    ];
    const chaptersSameTitle = [
      makeChapter({ projectId: 'p2', title: '不同章节', order: 0 }),
    ];
    const chaptersUnrelated = [
      makeChapter({ projectId: 'p3', title: '其他章节', order: 0 }),
    ];

    const projectFps = [
      computeProjectFingerprint(projectExact, chaptersExact),
      computeProjectFingerprint(projectSameTitle, chaptersSameTitle),
      computeProjectFingerprint(projectUnrelated, chaptersUnrelated),
    ];

    const matches = findMatchingProjects(importFp, projectFps);
    expect(matches).toHaveLength(2);  // 排除 none
    expect(matches[0].level).toBe('exact');  // 最高分在前
    expect(matches[1].level).toBe('medium');
  });
});

// ============ decideImportAction ============

describe('decideImportAction', () => {
  it('情境 1：无项目 → create-new', () => {
    const fp = computeImportFingerprint(makeImportResult());
    const action = decideImportAction(fp, [], false);
    expect(action.kind).toBe('create-new');
  });

  it('情境 2：有项目但无匹配 → create-new', () => {
    const fp = computeImportFingerprint(makeImportResult({ title: '新书' }));
    const action = decideImportAction(fp, [], true);
    expect(action.kind).toBe('create-new');
  });

  it('情境 3：exact 匹配 → suggest-overwrite', () => {
    const fp = computeImportFingerprint(makeImportResult());
    const project = makeProject({ id: 'p1', title: '测试小说' });
    const chapters = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
      makeChapter({ title: '第三章 东风', order: 2 }),
    ];
    const projectFp = computeProjectFingerprint(project, chapters);
    const matches = [{ project: projectFp, level: 'exact' as const, score: 100, reasons: ['项目名相同'] }];
    const action = decideImportAction(fp, matches, true);
    expect(action.kind).toBe('suggest-overwrite');
  });

  it('情境 4：high 匹配 → suggest-merge', () => {
    const fp = computeImportFingerprint(makeImportResult({
      chapters: [
        { title: '第一章 风雪', content: '', level: 2, order: 0 },
        { title: '第二章 浴血', content: '', level: 2, order: 1 },
        { title: '第三章 东风', content: '', level: 2, order: 2 },
        { title: '第四章 新章', content: '', level: 2, order: 3 },
      ],
    }));
    const project = makeProject({ id: 'p1', title: '测试小说' });
    const chapters = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
      makeChapter({ title: '第三章 东风', order: 2 }),
    ];
    const projectFp = computeProjectFingerprint(project, chapters);
    const matches = [{ project: projectFp, level: 'high' as const, score: 85, reasons: ['项目名相同'] }];
    const action = decideImportAction(fp, matches, true);
    expect(action.kind).toBe('suggest-merge');
  });

  it('情境 5：medium 匹配 → ask-user', () => {
    const fp = computeImportFingerprint(makeImportResult({
      chapters: [{ title: '不同章节', content: '', level: 2, order: 0 }],
    }));
    const project = makeProject({ id: 'p1', title: '测试小说' });
    const chapters = [makeChapter({ title: '原有章节', order: 0 })];
    const projectFp = computeProjectFingerprint(project, chapters);
    const matches = [{ project: projectFp, level: 'medium' as const, score: 55, reasons: ['项目名相同'] }];
    const action = decideImportAction(fp, matches, true);
    expect(action.kind).toBe('ask-user');
  });
});

// ============ computeNewChapters / computeModifiedChapters ============

describe('computeNewChapters', () => {
  it('返回导入中存在但现有项目中不存在的章节（按标题归一化比对）', () => {
    const importResult = makeImportResult({
      chapters: [
        { title: '第一章 风雪', content: '<p>a</p>', level: 2, order: 0 },
        { title: '第二章 浴血', content: '<p>b</p>', level: 2, order: 1 },
        { title: '第三章 新章', content: '<p>c</p>', level: 2, order: 2 },
      ],
    });
    const existing = [
      makeChapter({ title: '第一章 风雪', order: 0 }),
      makeChapter({ title: '第二章 浴血', order: 1 }),
    ];
    const newChapters = computeNewChapters(importResult, existing);
    expect(newChapters).toHaveLength(1);
    expect(newChapters[0].title).toBe('第三章 新章');
  });

  it('标题归一化：去书名号/空白后比对', () => {
    const importResult = makeImportResult({
      chapters: [
        { title: '《风雪》', content: '', level: 2, order: 0 },
        { title: '新章', content: '', level: 2, order: 1 },
      ],
    });
    const existing = [makeChapter({ title: '风雪', order: 0 })];
    const newChapters = computeNewChapters(importResult, existing);
    expect(newChapters).toHaveLength(1);
    expect(newChapters[0].title).toBe('新章');
  });
});

describe('computeModifiedChapters', () => {
  it('返回标题相同但内容不同的章节', () => {
    const importResult = makeImportResult({
      chapters: [
        { title: '第一章', content: '<p>新内容</p>', level: 2, order: 0 },
        { title: '第二章', content: '<p>相同</p>', level: 2, order: 1 },
      ],
    });
    const existing = [
      makeChapter({ title: '第一章', content: '<p>旧内容</p>', order: 0 }),
      makeChapter({ title: '第二章', content: '<p>相同</p>', order: 1 }),
    ];
    const modified = computeModifiedChapters(importResult, existing);
    expect(modified).toHaveLength(1);
    expect(modified[0].existing.title).toBe('第一章');
  });

  it('内容相同的不返回', () => {
    const importResult = makeImportResult({
      chapters: [
        { title: '第一章', content: '<p>相同内容</p>', level: 2, order: 0 },
      ],
    });
    const existing = [makeChapter({ title: '第一章', content: '<p>相同内容</p>', order: 0 })];
    expect(computeModifiedChapters(importResult, existing)).toHaveLength(0);
  });
});
