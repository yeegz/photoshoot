import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4178',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:web && node web/serve.mjs',
    url: 'http://localhost:4178/app/',
    reuseExistingServer: false,
  },
});
