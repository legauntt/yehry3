import { defineConfig } from '@playwright/test';
const live = process.env.YEHRY3_WORKER_WARNING_URL;
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'worker-warning.spec.js',
  workers: 1,
  use: { baseURL: live || 'http://127.0.0.1:18315', headless: true },
  webServer: live ? undefined : {
    command: 'node scripts/serve.mjs', env: { PORT: '18315' },
    url: 'http://127.0.0.1:18315', reuseExistingServer: false,
  },
});
