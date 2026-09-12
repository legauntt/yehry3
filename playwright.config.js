import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:8080",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command: "node scripts/build.mjs && node scripts/serve.mjs",
      url: "http://127.0.0.1:8080",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: "node scripts/dev-api.mjs",
      url: "http://127.0.0.1:3000/yehry3/songs",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      env: { YEHRY3_ADMIN_PASSWORD: "browser-test-admin" },
    },
  ],
});
