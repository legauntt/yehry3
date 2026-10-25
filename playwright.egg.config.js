import { defineConfig } from '@playwright/test';

const live = process.env.YEHRY3_EGG_URL;
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'egg-slices.spec.js',
  workers: 1,
  timeout: 45000,
  use: { baseURL: live || 'http://127.0.0.1:18307', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: 'node scripts/serve.mjs',
    env: { PORT: '18307' },
    url: 'http://127.0.0.1:18307',
    reuseExistingServer: false,
  },
});
