import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'aci.spec.js',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:8094', headless: true, viewport: { width: 1440, height: 1080 } },
  webServer: {
    command: 'node scripts/serve.mjs',
    env: { PORT: '8094' },
    url: 'http://127.0.0.1:8094',
    reuseExistingServer: false,
  },
});
