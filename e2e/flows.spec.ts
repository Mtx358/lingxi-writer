import { test, expect, type Page } from '@playwright/test';

/**
 * 关键用户流程 E2E 测试（补充 smoke / a11y 未覆盖的流程）。
 *
 * 覆盖：AI 面板交互、版本历史面板、项目导入对话框、软件设置对话框、编辑器多面板布局。
 *
 * 运行环境：vite dev server 的 web 模式（非 Electron）。
 *   - storage 在 web 模式下回退到 LocalStorage 适配器，项目/章节数据可正常读写
 *   - AI 调用与文件选择依赖 Electron IPC，web 模式下不可用
 * 因此 AI 生成 / 文件选择相关测试聚焦"UI 流程可达"而非"功能完整"：
 *   - AI 面板：验证设置面板展开、快捷动作菜单、provider 切换后字段显隐
 *   - 导入对话框：验证对话框打开 + 文件选择区可见 + 关闭交互
 *
 * 不修改 smoke.spec.ts / a11y.spec.ts，作为独立补充测试套件。
 */

// 跳过首次引导覆盖层（OnboardingGuide / InteractiveTour），与 smoke/a11y 一致。
// 通过 addInitScript 在每个测试文档加载前写入 localStorage 标记。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('has_seen_editor_tour', 'true');
  });
});

// 通过 UI 创建空白项目并导航到编辑器。复用 smoke.spec.ts 的同名流程，
// 走真实 store + LocalStorage 落盘，确保 /editor 拿到合法项目。
async function createBlankProjectAndEnterEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /新建项目/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建项目' });
  await dialog.getByPlaceholder('输入项目名称...').fill('流程测试项目');
  // 默认已选中 blank 模板，显式点击确保模板选择步骤可达
  await dialog.getByRole('button', { name: '空白项目' }).click();
  await dialog.getByRole('button', { name: '创建' }).click();
  // 等待编辑器顶部栏渲染完成（"返回项目列表" 按钮为 /editor 路由独有）
  await expect(page.getByRole('button', { name: '返回项目列表' })).toBeVisible();
}

// 在大纲面板点击"新建"添加一个章节，使 AI 面板的快捷动作按钮（依赖 currentChapter）启用。
async function addChapter(page: Page) {
  const outlinePanel = page.locator('[data-tour="outline-panel"]');
  await outlinePanel.getByRole('button', { name: '新建' }).click();
  await expect(outlinePanel.getByText('新章节', { exact: true })).toBeVisible();
}

test.describe('关键用户流程', () => {
  test('AI 面板：设置面板展开、扩写菜单与 provider 切换', async ({ page }) => {
    await createBlankProjectAndEnterEditor(page);
    await addChapter(page);

    // AI 面板为右侧面板默认 tab（rightPanelTab 初值 'ai'），进入编辑器即渲染
    const aiPanel = page.locator('[data-tour="ai-panel"]');
    await expect(aiPanel).toBeVisible();

    // 快捷动作按钮可见（currentChapter 存在时启用）
    await expect(aiPanel.getByRole('button', { name: '智能续写' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: '扩写' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: '润色' })).toBeVisible();

    // 扩写下拉菜单：点击展开后子选项可见
    await aiPanel.getByRole('button', { name: '扩写' }).click();
    await expect(aiPanel.getByRole('button', { name: '丰富细节' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: '增加对话' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: '环境描写' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: '心理活动' })).toBeVisible();

    // 点击 AI 设置齿轮，展开 GenerateModeSelector（provider 选择 / 模型配置 / 风格参数）
    await aiPanel.getByRole('button', { name: 'AI 设置' }).click();
    await expect(aiPanel.getByRole('button', { name: 'Mock' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: 'Ollama' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: 'OpenAI' })).toBeVisible();
    await expect(aiPanel.getByRole('button', { name: 'DeepSeek' })).toBeVisible();

    // 切换到 OpenAI：provider !== 'mock' 时渲染 API Key 输入框（placeholder 'sk-...'）
    await aiPanel.getByRole('button', { name: 'OpenAI' }).click();
    await expect(aiPanel.getByPlaceholder('sk-...')).toBeVisible();

    // 切回 Mock：API Key 输入框卸载
    await aiPanel.getByRole('button', { name: 'Mock' }).click();
    await expect(aiPanel.getByPlaceholder('sk-...')).toHaveCount(0);
  });

  test('版本历史面板：打开、空状态与关闭', async ({ page }) => {
    await createBlankProjectAndEnterEditor(page);
    await addChapter(page);

    // 顶部栏版本历史按钮（data-tour="version-history"）打开右侧抽屉
    const versionBtn = page.locator('[data-tour="version-history"]');
    await expect(versionBtn).toBeVisible();
    await versionBtn.click();

    // VersionHistoryPanel 根节点：role="region" aria-label="版本历史"
    const versionRegion = page.getByRole('region', { name: '版本历史' });
    await expect(versionRegion).toBeVisible();

    // 新项目无任何版本快照，渲染空状态 Empty 组件
    await expect(versionRegion.getByText('暂无历史版本')).toBeVisible();
    await expect(versionRegion.getByText('点击上方保存按钮创建快照')).toBeVisible();

    // 头部"保存当前版本"按钮可达
    await expect(versionRegion.getByRole('button', { name: '保存当前版本' })).toBeVisible();

    // 关闭按钮可达且能关闭抽屉（onClose 卸载整个抽屉层）
    await versionRegion.getByRole('button', { name: '关闭版本历史' }).click();
    await expect(versionRegion).toHaveCount(0);
  });

  test('项目导入对话框：打开、文件选择区与关闭', async ({ page }) => {
    await page.goto('/');

    // 首页"导入作品"按钮触发 ImportModal（web 模式下无法真实选文件，仅验证对话框交互）
    await page.getByRole('button', { name: '导入作品' }).click();

    const dialog = page.getByRole('dialog', { name: '导入作品' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // 文件选择区：拖拽提示文案 + 可点击的 role=button 区域
    await expect(dialog.getByText('拖拽文件到此处，或点击选择')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '点击或拖拽文件到此处导入' })).toBeVisible();

    // 标题层级映射区在未选文件时默认渲染（showMappingConfig = !fileName || isMarkdown）
    await expect(dialog.getByText('标题层级映射')).toBeVisible();

    // 关闭按钮关闭对话框
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('软件设置对话框：AI 区可见与 provider 下拉切换', async ({ page }) => {
    await createBlankProjectAndEnterEditor(page);

    // 顶部栏"软件设置"齿轮按钮打开 SettingsModal
    await page.getByRole('button', { name: '软件设置' }).click();

    const dialog = page.getByRole('dialog', { name: '软件设置' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // 默认进入"通用"区，切到"AI 助手"侧边栏项
    await dialog.getByRole('button', { name: 'AI 助手' }).click();
    await expect(dialog.getByText('配置模型供应商与生成风格')).toBeVisible();

    // 模型供应商下拉可达（aria-label="模型供应商"，native select role=combobox）
    const providerSelect = dialog.getByRole('combobox', { name: '模型供应商' });
    await expect(providerSelect).toBeVisible();

    // 切换到 openai：provider !== 'mock' 时渲染 API Base URL / API Key 字段
    await providerSelect.selectOption('openai');
    await expect(dialog.getByText('API Base URL')).toBeVisible();
    await expect(dialog.getByText('API Key')).toBeVisible();

    // 切回 mock：字段卸载
    await providerSelect.selectOption('mock');
    await expect(dialog.getByText('API Base URL')).toHaveCount(0);

    // 关闭按钮关闭对话框
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('编辑器多面板布局：三栏可达、tab 切换、ProseMirror 可输入', async ({ page }) => {
    await createBlankProjectAndEnterEditor(page);

    // 三栏布局并存：大纲 / 编辑器 / 右侧面板（含 AI 面板为默认 tab）
    const outlinePanel = page.locator('[data-tour="outline-panel"]');
    const editorArea = page.locator('[data-tour="editor-area"]');
    const rightPanel = page.locator('[data-tour="right-panel"]');

    await expect(outlinePanel).toBeVisible();
    await expect(editorArea).toBeVisible();
    await expect(rightPanel).toBeVisible();
    await expect(page.locator('[data-tour="ai-panel"]')).toBeVisible();

    // 大纲面板"新建"按钮可达
    await expect(outlinePanel.getByRole('button', { name: '新建' })).toBeVisible();

    // 右侧面板 tab 可切换：切到"角色"后 AI 面板卸载（rightPanelContent 切换为 CharactersPanel）
    await rightPanel.getByRole('button', { name: '角色' }).click();
    await expect(page.locator('[data-tour="ai-panel"]')).toHaveCount(0);

    // 切回 AI tab：面板重新挂载
    await rightPanel.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.locator('[data-tour="ai-panel"]')).toBeVisible();

    // 添加章节后 ProseMirror 可聚焦与输入
    await outlinePanel.getByRole('button', { name: '新建' }).click();
    const proseMirror = editorArea.locator('.ProseMirror');
    await expect(proseMirror).toBeVisible();
    await proseMirror.click();
    await expect(proseMirror).toBeFocused();
    await page.keyboard.type('灵犀写作测试');
    await expect(proseMirror).toContainText('灵犀写作测试');
  });
});
