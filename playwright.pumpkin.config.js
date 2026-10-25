import { defineConfig } from '@playwright/test';

const live = process.env.YEHRY3_SITE_URL;
export default defineConfig({
  testDir: './tests/browser', testMatch: live ? 'pumpkin-listening.spec.js' : ['pumpkin-listening.spec.js', 'halloween-settings.spec.js'], workers: 1,
  use: { baseURL: live || 'http://127.0.0.1:8098', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: 'node scripts/serve.mjs', env: { PORT: '8098' },
    url: 'http://127.0.0.1:8098', reuseExistingServer: false,
  },
});
