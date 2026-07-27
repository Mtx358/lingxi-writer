import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * E2E 层 a11y 自动扫描
 *
 * 用 @axe-core/playwright 在真实浏览器中对关键路由跑 WCAG 2.1 AA 扫描。
 * 与 vitest 中的 axe-core 单元扫描互补：
 *   - 单元层：组件隔离扫描，快、定位精确
 *   - E2E 层：真实渲染 + 路由 + 全局 Provider 下的整页扫描，捕获集成回归
 *
 * 规则集：wcag21aa（与项目 a11y 目标一致）。
 * 失败时打印违规详情，便于定位。
 *
 * 覆盖路由/场景：首页 / 、新建项目对话框、编辑器 /editor、导出 /export、软件设置对话框。
 */

// 在每个测试页面加载前注入 localStorage，跳过首次引导覆盖层
// （OnboardingGuide / InteractiveTour），使扫描聚焦目标路由本身而非引导层。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('has_seen_editor_tour', 'true');
  });
});

// 通过 UI 创建项目并导航到编辑器；后续测试可在此基础上跳转 /export 等。
// 创建流程走真实 store + storage 落盘，确保 /editor、/export 拿得到合法项目。
async function createProjectAndEnterEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /新建项目/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建项目' });
  await dialog.getByPlaceholder('输入项目名称...').fill('a11y 测试项目');
  await dialog.getByRole('button', { name: '创建' }).click();
  // 等待编辑器顶部栏渲染完成（Home 按钮在 /editor 独有）
  await expect(page.getByRole('button', { name: '返回项目列表' })).toBeVisible();
}

test.describe('全页 a11y 扫描（WCAG 2.1 AA）', () => {
  test('首页无违规', async ({ page }) => {
    await page.goto('/');
    // 等待首屏稳定：引导文案出现
    await expect(page.getByRole('heading', { name: '开始你的创作之旅' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('新建项目对话框无违规', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /新建项目/ }).first().click();
    await expect(page.getByRole('dialog', { name: '新建项目' })).toBeVisible();

    // 仅扫描对话框区域，避免与对话框无关的背景元素干扰
    const results = await new AxeBuilder({ page })
      .withTags(['wcag21aa'])
      .include('[role="dialog"]')
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('编辑器路由无违规', async ({ page }) => {
    await createProjectAndEnterEditor(page);

    // 整页扫描：编辑器含 OutlinePanel / TiptapEditor / AIPanel / 右侧多面板，
    // 覆盖 tab 顺序、按钮可访问名、ProseMirror 编辑区 aria 等集成层回归
    const results = await new AxeBuilder({ page })
      .withTags(['wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('导出路由无违规', async ({ page }) => {
    await createProjectAndEnterEditor(page);
    // 编辑器顶部栏的导出按钮（aria-label="导出"）跳转到 /export
    await page.getByRole('button', { name: '导出' }).first().click();
    await expect(page.getByRole('heading', { name: '导出发布' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('软件设置对话框无违规（含焦点陷阱、Toggle role=switch）', async ({ page }) => {
    await createProjectAndEnterEditor(page);
    // 编辑器顶部栏的软件设置按钮（aria-label="软件设置"）打开 SettingsModal
    await page.getByRole('button', { name: '软件设置' }).click();
    await expect(page.getByRole('dialog', { name: '软件设置' })).toBeVisible();

    // 仅扫描对话框区域：SettingsModal 含 sidebar nav / Toggle(role=switch) / Slider(aria-valuetext)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag21aa'])
      .include('[role="dialog"]')
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
