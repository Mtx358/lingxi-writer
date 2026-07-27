/**
 * 大纲打磨报告 → Markdown 导出
 *
 * 单独拆分文件的原因：原 /utils/exporters.ts 在模块顶层静态 import 了
 * docx / pdf-lib / jszip 三大库（共 ~960KB），而 generateOutlinePolishMarkdown
 * 仅是纯字符串拼接、不依赖这些库。若仍从 exporters.ts 导入，会让左侧大纲打磨
 * 面板（首屏可见）依赖整组导出库，破坏按需加载。拆出后 EditorPage 首屏
 * 不再拉取 export-vendor chunk。
 */
import type { OutlinePolishReport, OutlinePolishDimension, OutlineIssueSeverity, CharacterArcAnalysis } from '@/types';

const OUTLINE_DIMENSION_LABELS: Record<OutlinePolishDimension, string> = {
  theme: '主题锚定',
  structure: '结构递进',
  character: '人物一致性',
  logic: '叙事逻辑',
  pacing: '节奏与信息量',
  foreshadow: '伏笔闭环',
  style: '文风一致',
};

const OUTLINE_SEVERITY_LABELS: Record<OutlineIssueSeverity, string> = {
  error: '严重',
  warning: '警告',
  info: '提示',
};

const OUTLINE_SEVERITY_EMOJI: Record<OutlineIssueSeverity, string> = {
  error: '🔴',
  warning: '🟡',
  info: '🔵',
};

const CHARACTER_ARC_RISK_LABELS: Record<CharacterArcAnalysis['risk'], string> = {
  high: '高风险',
  medium: '中等风险',
  low: '低风险',
  ok: '健康',
};

/** 将大纲打磨报告渲染为 Markdown 字符串 */
export function generateOutlinePolishMarkdown(report: OutlinePolishReport): string {
  const lines: string[] = [];
  const generatedAt = new Date(report.generatedAt).toLocaleString('zh-CN');
  const scopeDesc = report.scope === 'all' ? '全量大纲' : `局部（章节 ID: ${report.scope}）`;

  lines.push(`# 大纲打磨报告`);
  lines.push('');
  lines.push(`- **生成时间**：${generatedAt}`);
  lines.push(`- **诊断范围**：${scopeDesc}`);
  lines.push(`- **章节总数**：${report.totalChapters}`);
  lines.push(`- **总字数**：${report.totalWords.toLocaleString()}`);
  lines.push('');

  // 概览：三幕比例
  const [a, b, c] = report.threeActRatio;
  lines.push(`## 一、三幕结构比例`);
  lines.push('');
  lines.push(`| 幕 | 占比 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 开端 | ${a}% |`);
  lines.push(`| 发展 | ${b}% |`);
  lines.push(`| 高潮与结局 | ${c}% |`);
  lines.push('');

  // 节奏曲线
  if (report.pacingCurve.length > 0) {
    lines.push(`## 二、节奏脉搏（张力曲线）`);
    lines.push('');
    lines.push(`| 章节 | 字数 | 张力 |`);
    lines.push(`| --- | --- | --- |`);
    report.pacingCurve.forEach(p => {
      lines.push(`| ${p.chapterTitle} | ${p.wordCount} | ${p.tension}% |`);
    });
    lines.push('');
  }

  // 情感曲线
  if (report.emotionCurve.length > 0) {
    lines.push(`## 三、情感曲线`);
    lines.push('');
    lines.push(`| 章节 | 情感强度 |`);
    lines.push(`| --- | --- |`);
    report.emotionCurve.forEach(p => {
      lines.push(`| ${p.chapterTitle} | ${p.emotion}% |`);
    });
    lines.push('');
  }

  // 角色弧光
  if (report.characterArcs.length > 0) {
    lines.push(`## 四、角色弧光分析`);
    lines.push('');
    report.characterArcs.forEach(arc => {
      lines.push(`### ${arc.characterName}（${CHARACTER_ARC_RISK_LABELS[arc.risk]}）`);
      lines.push('');
      lines.push(`- 出场章节数：${arc.appearanceCount}`);
      lines.push(`- 末尾连续缺席：${arc.consecutiveAbsence} 章`);
      if (arc.riskDescription) lines.push(`- 风险：${arc.riskDescription}`);
      if (arc.arcGaps.length > 0) {
        lines.push(`- 弧光缺口：`);
        arc.arcGaps.forEach(g => lines.push(`  - ${g}`));
      }
      lines.push('');
    });
  }

  // 伏笔密度
  if (report.foreshadowDensity.length > 0) {
    lines.push(`## 五、伏笔密度热力图`);
    lines.push('');
    lines.push(`| 章节 | 埋设 | 推进 | 回收 |`);
    lines.push(`| --- | --- | --- | --- |`);
    report.foreshadowDensity.forEach(d => {
      lines.push(`| ${d.chapterTitle} | ${d.planted} | ${d.progressing} | ${d.paidOff} |`);
    });
    lines.push('');
  }

  // 诊断问题
  if (report.issues.length > 0) {
    lines.push(`## 六、诊断问题清单`);
    lines.push('');
    // 按维度分组
    const byDimension = new Map<OutlinePolishDimension, typeof report.issues>();
    report.issues.forEach(issue => {
      if (issue.ignored) return; // 忽略项不出现在导出报告中
      const list = byDimension.get(issue.dimension) || [];
      list.push(issue);
      byDimension.set(issue.dimension, list);
    });

    byDimension.forEach((list, dim) => {
      lines.push(`### ${OUTLINE_DIMENSION_LABELS[dim]}（${list.length} 项）`);
      lines.push('');
      list.forEach((issue, idx) => {
        const status = issue.resolved ? '✅ 已采纳' : `${OUTLINE_SEVERITY_EMOJI[issue.severity]} ${OUTLINE_SEVERITY_LABELS[issue.severity]}`;
        lines.push(`**${idx + 1}. [${issue.chapterTitle || '全局'}]** ${issue.description}  \`${status}\``);
        lines.push('');
        lines.push(`- 建议：${issue.suggestion}`);
        lines.push('');
      });
    });
  }

  lines.push(`---`);
  lines.push(`*由灵犀写作助手·大纲打磨自动生成*`);
  return lines.join('\n');
}
