import { defineConfig } from '@playwright/test';
const live = process.env.YEHRY3_HALLOWEEN_URL;
export default defineConfig({
  testDir: './tests/browser', testMatch: ['**/halloween.spec.js', '**/halloween-settings.spec.js'], workers: 1,
  use: { baseURL: live || 'http://127.0.0.1:8103', headless: true },
  webServer: live ? undefined : { command: 'node scripts/serve.mjs', env: {PORT:'8103'},
    url: 'http://127.0.0.1:8103', reuseExistingServer: false },
});
