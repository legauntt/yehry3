import { defineConfig } from '@playwright/test';

// Review interactions use intercepted API responses; no real requests or generation.
const live = process.env.YEHRY3_REVIEW_URL;
export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['queue-details.spec.js', 'remix.spec.js'],
  workers: 1,
  timeout: 45000,
  use: { baseURL: live || 'http://127.0.0.1:18306', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: 'node scripts/serve.mjs',
    env: { PORT: '18306' },
    url: 'http://127.0.0.1:18306',
    reuseExistingServer: false,
  },
});
