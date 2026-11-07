import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: '../../test-results',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
});
