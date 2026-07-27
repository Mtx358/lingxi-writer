import axe from 'axe-core';

/**
 * axe-core 单元层 a11y 扫描辅助
 *
 * 在 vitest（jsdom）中对 Testing Library 渲染出的容器跑 WCAG 2.1 AA 扫描。
 * 适合组件隔离场景下快速捕获 a11y 回归（缺失 label、role 错误、对比度等）。
 *
 * 与 E2E 层 @axe-core/playwright 互补：
 *   - 单元层：快、定位到组件、CI 必跑
 *   - E2E 层：真实浏览器 + 路由集成扫描
 *
 * 用法：
 *   const { container } = render(<MyComponent />);
 *   await expectNoA11yViolations(container);
 *
 * 或仅扫描特定规则：
 *   await expectNoA11yViolations(container, { rules: { 'color-contrast': { enabled: true } } });
 *
 * 注意：jsdom 不计算真实布局/颜色，color-contrast 等依赖渲染的规则在单元层会
 * 被跳过（axe 自动 incomplete），完整颜色对比验证交给 E2E 层。
 */

export interface AxeScanOptions {
  /** 透传给 axe.run 的 axe.RunOptions，如 { rules: {...} } */
  runOptions?: axe.RunOptions;
  /** 自定义上下文，默认为传入的 container */
  context?: axe.ElementContext;
}

/**
 * 对容器执行 a11y 扫描，断言无 WCAG 2.1 AA 违规。
 * 失败时抛出含违规详情的错误，便于在测试输出中直接定位。
 */
export async function expectNoA11yViolations(
  container: HTMLElement,
  options: AxeScanOptions = {},
): Promise<void> {
  // ensure axe 样式表已注入 jsdom（axe.run 内部会处理）
  const results = await axe.run(
    options.context ?? container,
    {
      runOnly: {
        type: 'tag',
        values: ['wcag21aa'],
      },
      ...options.runOptions,
    },
  );

  if (results.violations.length > 0) {
    const detail = results.violations
      .map((v) => {
        const nodes = v.nodes
          .map((n, i) => `  [${i + 1}] ${n.html}\n      ${n.failureSummary ?? ''}`)
          .join('\n');
        return `✗ ${v.id} (${v.help})\n  impact: ${v.impact}\n  ${v.helpUrl}\n${nodes}`;
      })
      .join('\n\n');
    throw new Error(
      `发现 ${results.violations.length} 项 a11y 违规（WCAG 2.1 AA）：\n\n${detail}`,
    );
  }
}
