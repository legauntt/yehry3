import { defineConfig } from '@playwright/test';

const live = process.env.YEHRY3_EP_URL;
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'saxophone.spec.js',
  workers: 1,
  timeout: 45000,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  use: { baseURL: live || 'http://127.0.0.1:8098', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: 'node scripts/serve.mjs',
    env: { PORT: '8098' },
    url: 'http://127.0.0.1:8098',
    reuseExistingServer: false,
  },
});
