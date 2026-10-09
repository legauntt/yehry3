// All API calls, sockets and audio in this suite are intercepted fixtures.
// This checks the deployed UI without creating a public recording or admin job.
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'audio-editor.spec.js', workers: 1, timeout: 45000,
  use: { baseURL: 'https://yehry3.app', headless: true, viewport: { width: 1440, height: 1000 } },
});
