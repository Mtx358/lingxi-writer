import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config.
 *
 * - testDir: ./e2e, isolated from vitest unit tests under src
 * - webServer: auto-starts vite dev server (port 5173); reuses existing in non-CI
 * - baseURL: HashRouter app, home is /, routes switch via #/path
 * - Chromium only: Electron desktop targets Chromium, no cross-browser matrix
 * - screenshot + trace on first retry for local and CI debugging
 *
 * Run:
 *   npx playwright test                       # run all E2E
 *   npx playwright test --ui                  # interactive mode
 *   npx playwright test e2e/a11y.spec.ts
 *
 * Install browser kernel before first run: npx playwright install chromium
 *
 * NOTE: keep comments ASCII-only. Playwright's bundled babel transform mis-parses
 * multibyte chars in block comments (offset bug), breaking config load.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
