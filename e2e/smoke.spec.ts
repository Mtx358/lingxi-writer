import { test, expect, type Page } from '@playwright/test';

/**
 * 冒烟测试：验证应用能正常启动、首屏渲染、核心交互可达。
 *
 * 不依赖任何外部数据（localStorage 为空时 Home 显示空状态引导）。
 * 作为 E2E 基线：任何破坏应用启动的改动都会在此暴露。
 *
 * 运行环境：vite dev server 的 web 模式（非 Electron）。web 模式下 storage
 * 自动回退到 LocalStorage 适配器（见 src/utils/storage/index.ts 的 isElectron 判定），
 * 项目/章节数据可正常读写，因此建项 → 进入编辑器 → 添加章节的核心流程可完整走通，
 * 无需 mock IPC。
 */

// 跳过首次引导覆盖层，使测试聚焦目标流程：
//   - OnboardingGuide（首页）：fixed inset-0 z-50 全屏遮罩，会拦截首页按钮点击
//   - InteractiveTour（编辑器）：进入编辑器约 500ms 后弹出，覆盖编辑器交互区
// 通过 addInitScript 在每个测试文档加载前写入 localStorage 标记，复用 a11y.spec.ts 的做法。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('has_seen_editor_tour', 'true');
  });
});

// 通过 UI 创建空白项目并导航到编辑器。复用此流程以减少重复。
// 走真实 store + LocalStorage 落盘，确保 /editor 拿到合法项目。
async function createBlankProjectAndEnterEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /新建项目/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建项目' });
  await dialog.getByPlaceholder('输入项目名称...').fill('冒烟测试项目');
  // 默认已选中 blank 模板，显式点击确保模板选择步骤可达
  await dialog.getByRole('button', { name: '空白项目' }).click();
  await dialog.getByRole('button', { name: '创建' }).click();
  // 等待编辑器顶部栏渲染完成（"返回项目列表" 按钮为 /editor 路由独有）
  await expect(page.getByRole('button', { name: '返回项目列表' })).toBeVisible();
}

test.describe('应用冒烟', () => {
  test('首页渲染标题与主导航', async ({ page }) => {
    await page.goto('/');

    // 应用标题
    await expect(page.getByRole('heading', { name: '灵犀写作助手' })).toBeVisible();

    // 空状态下展示开始引导
    await expect(page.getByRole('heading', { name: '开始你的创作之旅' })).toBeVisible();

    // 新建项目入口可达（按钮或链接）
    await expect(page.getByRole('button', { name: /新建项目/ }).first()).toBeVisible();
  });

  test('打开新建项目对话框', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /新建项目/ }).first().click();

    // 对话框标题出现，且为模态（role=dialog）
    const dialog = page.getByRole('dialog', { name: '新建项目' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('路由跳转到编辑器并返回', async ({ page }) => {
    await page.goto('/');

    // 直接通过 hash 路由进入一个不存在的项目编辑器，应用应优雅降级而非白屏崩溃。
    // EditorPage 的 openProject 对不存在的 projectId 不会抛错（storage.get 返回空默认值），
    // 加载完成后 currentProject 为 undefined，进入"项目不存在"分支；若 openProject 抛错
    // 则进入"项目加载失败"分支。两个分支均渲染"返回首页"按钮，可作为降级成功的断言。
    await page.goto('/#/project/non-existent-project/editor');

    // 断言降级 UI 的"返回首页"按钮可见：证明应用未白屏且提供了可交互的回退路径
    await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible();
  });

  test('新建空白项目并进入编辑器', async ({ page }) => {
    await createBlankProjectAndEnterEditor(page);

    // URL 跳转到编辑器路由 /#/project/<id>/editor
    await expect(page).toHaveURL(/\/project\/[^/]+\/editor/);

    // 编辑器页关键 UI 可见：大纲面板与编辑器区域
    await expect(page.locator('[data-tour="outline-panel"]')).toBeVisible();
    await expect(page.locator('[data-tour="editor-area"]')).toBeVisible();

    // 大纲面板有添加章节入口：底部"新建"按钮始终渲染（不依赖大纲是否为空）
    await expect(
      page.locator('[data-tour="outline-panel"]').getByRole('button', { name: '新建' })
    ).toBeVisible();
  });

  test('编辑器添加章节与编辑器可聚焦', async ({ page }) => {
    await createBlankProjectAndEnterEditor(page);

    const outlinePanel = page.locator('[data-tour="outline-panel"]');
    // 空白项目初始无章节；点击大纲面板底部"新建"按钮添加一个章节
    await outlinePanel.getByRole('button', { name: '新建' }).click();

    // 大纲列表出现新章节节点（addChapter 以"新章节"为默认标题）
    await expect(outlinePanel.getByText('新章节', { exact: true })).toBeVisible();

    // 编辑器区域可见，且 TiptapEditor 渲染的 ProseMirror contenteditable 可聚焦
    const editor = page.locator('[data-tour="editor-area"]');
    await expect(editor).toBeVisible();
    const proseMirror = editor.locator('.ProseMirror');
    await expect(proseMirror).toBeVisible();
    await proseMirror.click();
    await expect(proseMirror).toBeFocused();
  });
});
