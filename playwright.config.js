import { defineConfig, devices } from '@playwright/test';

const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results';
const htmlOutputFolder = process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: htmlOutputFolder }]
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
