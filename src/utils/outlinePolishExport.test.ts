/**
 * outlinePolishExport 测试
 *
 * 重点验证：
 * 1. 头部信息：标题/时间/范围/章节数/字数
 * 2. 三幕结构比例表
 * 3. 节奏/情感曲线（空数组跳过 vs 非空渲染）
 * 4. 角色弧光（risk 标签 + riskDescription/arcGaps 可选字段）
 * 5. 伏笔密度热力图
 * 6. 诊断问题（按维度分组、ignored 跳过、resolved 状态、severity 标签）
 * 7. 完整报告端到端渲染
 */
import { generateOutlinePolishMarkdown } from '@/utils/outlinePolishExport';
import type { OutlinePolishReport, OutlinePolishDimension, OutlineIssueSeverity, CharacterArcAnalysis } from '@/types';

// 构造最小可用报告：测试用例通过 spread + 覆盖部分字段生成变体
function makeBaseReport(overrides: Partial<OutlinePolishReport> = {}): OutlinePolishReport {
  return {
    generatedAt: '2024-06-15T10:30:00.000Z',
    scope: 'all',
    projectId: 'p1',
    issues: [],
    pacingCurve: [],
    emotionCurve: [],
    threeActRatio: [25, 50, 25],
    characterArcs: [],
    foreshadowDensity: [],
    totalChapters: 10,
    totalWords: 123456,
    ...overrides,
  };
}

describe('generateOutlinePolishMarkdown', () => {
  describe('头部信息', () => {
    it('包含标题与生成时间', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport());
      expect(md).toContain('# 大纲打磨报告');
      expect(md).toContain('**生成时间**');
    });

    it('scope=all → 显示"全量大纲"', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ scope: 'all' }));
      expect(md).toContain('**诊断范围**：全量大纲');
    });

    it('scope 为章节 ID → 显示"局部（章节 ID: xxx）"', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ scope: 'ch-42' }));
      expect(md).toContain('**诊断范围**：局部（章节 ID: ch-42）');
    });

    it('包含章节总数与总字数（带千分位）', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({ totalChapters: 88, totalWords: 9876543 }),
      );
      expect(md).toContain('**章节总数**：88');
      expect(md).toContain('**总字数**：9,876,543');
    });
  });

  describe('三幕结构比例', () => {
    it('渲染三行占比表', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({ threeActRatio: [30, 45, 25] }),
      );
      expect(md).toContain('## 一、三幕结构比例');
      expect(md).toContain('| 开端 | 30% |');
      expect(md).toContain('| 发展 | 45% |');
      expect(md).toContain('| 高潮与结局 | 25% |');
    });
  });

  describe('节奏曲线（pacingCurve）', () => {
    it('空数组 → 不输出该章节', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ pacingCurve: [] }));
      expect(md).not.toContain('节奏脉搏');
    });

    it('非空 → 渲染章节/字数/张力表', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          pacingCurve: [
            { chapterId: 'c1', chapterTitle: '第一章 启程', tension: 60, wordCount: 3000 },
            { chapterId: 'c2', chapterTitle: '第二章 危机', tension: 85, wordCount: 4200 },
          ],
        }),
      );
      expect(md).toContain('## 二、节奏脉搏');
      expect(md).toContain('| 第一章 启程 | 3000 | 60% |');
      expect(md).toContain('| 第二章 危机 | 4200 | 85% |');
    });
  });

  describe('情感曲线（emotionCurve）', () => {
    it('空数组 → 不输出', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ emotionCurve: [] }));
      expect(md).not.toContain('情感曲线');
    });

    it('非空 → 渲染章节/情感强度表', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          emotionCurve: [
            { chapterId: 'c1', chapterTitle: '第一章', emotion: 30 },
            { chapterId: 'c2', chapterTitle: '第二章', emotion: 90 },
          ],
        }),
      );
      expect(md).toContain('## 三、情感曲线');
      expect(md).toContain('| 第一章 | 30% |');
      expect(md).toContain('| 第二章 | 90% |');
    });
  });

  describe('角色弧光（characterArcs）', () => {
    it('空数组 → 不输出', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ characterArcs: [] }));
      expect(md).not.toContain('角色弧光分析');
    });

    it('包含 risk 标签 + 出场/缺席统计', () => {
      const arc: CharacterArcAnalysis = {
        characterId: 'char1',
        characterName: '李雷',
        role: 'protagonist',
        appearanceChapters: ['c1', 'c2', 'c5'],
        appearanceCount: 3,
        consecutiveAbsence: 2,
        arcGaps: [],
        risk: 'low',
        riskDescription: '建议在结尾追加一次出场',
      };
      const md = generateOutlinePolishMarkdown(makeBaseReport({ characterArcs: [arc] }));
      expect(md).toContain('## 四、角色弧光分析');
      expect(md).toContain('### 李雷（低风险）');
      expect(md).toContain('- 出场章节数：3');
      expect(md).toContain('- 末尾连续缺席：2 章');
      expect(md).toContain('- 风险：建议在结尾追加一次出场');
    });

    it('无 riskDescription → 不输出"风险"行', () => {
      const arc: CharacterArcAnalysis = {
        characterId: 'char1',
        characterName: '韩梅梅',
        role: 'supporting',
        appearanceChapters: ['c1'],
        appearanceCount: 1,
        consecutiveAbsence: 0,
        arcGaps: [],
        risk: 'ok',
      };
      const md = generateOutlinePolishMarkdown(makeBaseReport({ characterArcs: [arc] }));
      expect(md).toContain('### 韩梅梅（健康）');
      expect(md).not.toContain('- 风险：');
    });

    it('arcGaps 非空 → 列出弧光缺口', () => {
      const arc: CharacterArcAnalysis = {
        characterId: 'char1',
        characterName: '王博士',
        role: 'antagonist',
        appearanceChapters: ['c1'],
        appearanceCount: 1,
        consecutiveAbsence: 5,
        arcGaps:['动机未交代', '转折点缺失', '结局未交代'],
        risk: 'high',
        riskDescription: '主要反派长期缺席',
      };
      const md = generateOutlinePolishMarkdown(makeBaseReport({ characterArcs: [arc] }));
      expect(md).toContain('### 王博士（高风险）');
      expect(md).toContain('- 弧光缺口：');
      expect(md).toContain('  - 动机未交代');
      expect(md).toContain('  - 转折点缺失');
      expect(md).toContain('  - 结局未交代');
    });

    it('arcGaps 为空 → 不输出"弧光缺口"行', () => {
      const arc: CharacterArcAnalysis = {
        characterId: 'char1',
        characterName: '小明',
        role: 'minor',
        appearanceChapters: ['c1'],
        appearanceCount: 1,
        consecutiveAbsence: 0,
        arcGaps: [],
        risk: 'medium',
      };
      const md = generateOutlinePolishMarkdown(makeBaseReport({ characterArcs: [arc] }));
      expect(md).toContain('### 小明（中等风险）');
      expect(md).not.toContain('- 弧光缺口');
    });
  });

  describe('伏笔密度（foreshadowDensity）', () => {
    it('空数组 → 不输出', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ foreshadowDensity: [] }));
      expect(md).not.toContain('伏笔密度热力图');
    });

    it('非空 → 渲染埋设/推进/回收表', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          foreshadowDensity: [
            { chapterId: 'c1', chapterTitle: '第一章', planted: 3, progressing: 0, paidOff: 0 },
            { chapterId: 'c5', chapterTitle: '第五章', planted: 0, progressing: 2, paidOff: 1 },
          ],
        }),
      );
      expect(md).toContain('## 五、伏笔密度热力图');
      expect(md).toContain('| 第一章 | 3 | 0 | 0 |');
      expect(md).toContain('| 第五章 | 0 | 2 | 1 |');
    });
  });

  describe('诊断问题（issues）', () => {
    it('空数组 → 不输出诊断问题章节', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport({ issues: [] }));
      expect(md).not.toContain('诊断问题清单');
    });

    it('按维度分组渲染，包含描述与建议', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            {
              id: 'i1',
              dimension: 'theme',
              severity: 'error',
              chapterTitle: '第一章',
              description: '主题不明确',
              suggestion: '在开篇明确主角目标',
            },
            {
              id: 'i2',
              dimension: 'pacing',
              severity: 'warning',
              chapterTitle: '第三章',
              description: '节奏过慢',
              suggestion: '压缩描述段落',
            },
          ],
        }),
      );
      expect(md).toContain('## 六、诊断问题清单');
      expect(md).toContain('### 主题锚定（1 项）');
      expect(md).toContain('### 节奏与信息量（1 项）');
      expect(md).toContain('[第一章]** 主题不明确');
      expect(md).toContain('[第三章]** 节奏过慢');
      expect(md).toContain('建议：在开篇明确主角目标');
      expect(md).toContain('建议：压缩描述段落');
    });

    it('同维度多个问题 → 计数正确，编号递增', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'logic', severity: 'error', chapterTitle: 'A', description: 'd1', suggestion: 's1' },
            { id: 'i2', dimension: 'logic', severity: 'warning', chapterTitle: 'B', description: 'd2', suggestion: 's2' },
            { id: 'i3', dimension: 'logic', severity: 'info', chapterTitle: 'C', description: 'd3', suggestion: 's3' },
          ],
        }),
      );
      expect(md).toContain('### 叙事逻辑（3 项）');
      expect(md).toContain('**1. [A]** d1');
      expect(md).toContain('**2. [B]** d2');
      expect(md).toContain('**3. [C]** d3');
    });

    it('ignored 问题被跳过（不出现在导出报告中）', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'theme', severity: 'error', chapterTitle: '可见', description: '保留', suggestion: 's1' },
            { id: 'i2', dimension: 'theme', severity: 'warning', chapterTitle: '隐藏', description: '忽略', suggestion: 's2', ignored: true },
          ],
        }),
      );
      // 仅渲染未被忽略的问题；分组计数也是 1 而非 2
      expect(md).toContain('### 主题锚定（1 项）');
      expect(md).toContain('[可见]** 保留');
      expect(md).not.toContain('[隐藏]');
    });

    it('resolved 问题显示"✅ 已采纳"', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'theme', severity: 'error', chapterTitle: 'C1', description: '已修', suggestion: 's', resolved: true },
          ],
        }),
      );
      expect(md).toContain('✅ 已采纳');
      // resolved 时不输出 severity emoji/label
      expect(md).not.toContain('🔴 严重');
    });

    it('error 严重等级 → 🔴 严重 标签', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'theme', severity: 'error', chapterTitle: 'C1', description: 'd', suggestion: 's' },
          ],
        }),
      );
      expect(md).toContain('🔴 严重');
    });

    it('warning 严重等级 → 🟡 警告 标签', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'theme', severity: 'warning', chapterTitle: 'C1', description: 'd', suggestion: 's' },
          ],
        }),
      );
      expect(md).toContain('🟡 警告');
    });

    it('info 严重等级 → 🔵 提示 标签', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'theme', severity: 'info', chapterTitle: 'C1', description: 'd', suggestion: 's' },
          ],
        }),
      );
      expect(md).toContain('🔵 提示');
    });

    it('所有 7 个维度标签都被正确渲染', () => {
      const dimensions: OutlinePolishDimension[] = [
        'theme', 'structure', 'character', 'logic', 'pacing', 'foreshadow', 'style',
      ];
      const expectedLabels = [
        '主题锚定', '结构递进', '人物一致性', '叙事逻辑', '节奏与信息量', '伏笔闭环', '文风一致',
      ];
      const issues = dimensions.map((dim, i) => ({
        id: `i${i}`,
        dimension: dim,
        severity: 'info' as OutlineIssueSeverity,
        chapterTitle: `C${i}`,
        description: `d${i}`,
        suggestion: `s${i}`,
      }));
      const md = generateOutlinePolishMarkdown(makeBaseReport({ issues }));
      for (const label of expectedLabels) {
        expect(md).toContain(`### ${label}（1 项）`);
      }
    });

    it('无 chapterTitle → 显示"全局"', () => {
      const md = generateOutlinePolishMarkdown(
        makeBaseReport({
          issues: [
            { id: 'i1', dimension: 'theme', severity: 'error', description: '全局问题', suggestion: 's' },
          ],
        }),
      );
      expect(md).toContain('[全局]');
    });
  });

  describe('尾部', () => {
    it('包含分隔线与生成者署名', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport());
      expect(md).toContain('---');
      expect(md).toContain('由灵犀写作助手·大纲打磨自动生成');
    });
  });

  describe('完整端到端渲染', () => {
    it('所有字段都填充 → 各章节按预期顺序出现', () => {
      const report = makeBaseReport({
        generatedAt: '2024-01-01T00:00:00.000Z',
        scope: 'all',
        totalChapters: 5,
        totalWords: 50000,
        threeActRatio: [20, 60, 20],
        pacingCurve: [
          { chapterId: 'c1', chapterTitle: 'Ch1', tension: 40, wordCount: 1000 },
        ],
        emotionCurve: [
          { chapterId: 'c1', chapterTitle: 'Ch1', emotion: 50 },
        ],
        characterArcs: [
          {
            characterId: 'char1', characterName: '主角', role: 'protagonist',
            appearanceChapters: ['c1'], appearanceCount: 1, consecutiveAbsence: 0,
            arcGaps: ['缺口A'], risk: 'low', riskDescription: '风险描述',
          },
        ],
        foreshadowDensity: [
          { chapterId: 'c1', chapterTitle: 'Ch1', planted: 1, progressing: 0, paidOff: 0 },
        ],
        issues: [
          { id: 'i1', dimension: 'theme', severity: 'error', chapterTitle: 'Ch1', description: '问题', suggestion: '建议' },
        ],
      });
      const md = generateOutlinePolishMarkdown(report);

      // 校验章节出现顺序
      const idxHeader = md.indexOf('# 大纲打磨报告');
      const idxThreeAct = md.indexOf('## 一、三幕结构比例');
      const idxPacing = md.indexOf('## 二、节奏脉搏');
      const idxEmotion = md.indexOf('## 三、情感曲线');
      const idxArc = md.indexOf('## 四、角色弧光分析');
      const idxForeshadow = md.indexOf('## 五、伏笔密度热力图');
      const idxIssues = md.indexOf('## 六、诊断问题清单');
      const idxFooter = md.indexOf('由灵犀写作助手·大纲打磨自动生成');

      expect(idxHeader).toBeGreaterThan(-1);
      expect(idxThreeAct).toBeGreaterThan(idxHeader);
      expect(idxPacing).toBeGreaterThan(idxThreeAct);
      expect(idxEmotion).toBeGreaterThan(idxPacing);
      expect(idxArc).toBeGreaterThan(idxEmotion);
      expect(idxForeshadow).toBeGreaterThan(idxArc);
      expect(idxIssues).toBeGreaterThan(idxForeshadow);
      expect(idxFooter).toBeGreaterThan(idxIssues);
    });

    it('仅必填字段、其他全空 → 仍能正确渲染头部 + 三幕 + 尾部', () => {
      const md = generateOutlinePolishMarkdown(makeBaseReport());
      expect(md).toContain('# 大纲打磨报告');
      expect(md).toContain('## 一、三幕结构比例');
      expect(md).toContain('---');
      // 不应包含二/三/四/五/六
      expect(md).not.toContain('## 二、');
      expect(md).not.toContain('## 三、');
      expect(md).not.toContain('## 四、');
      expect(md).not.toContain('## 五、');
      expect(md).not.toContain('## 六、');
    });
  });
});
