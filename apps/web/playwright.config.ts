import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3000', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
