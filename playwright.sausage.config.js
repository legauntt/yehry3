import { defineConfig } from "@playwright/test";

const live = process.env.YEHRY3_TOUR_URL;
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "sausage.spec.js",
  workers: 1,
  timeout: 45000,
  use: { baseURL: live || "http://127.0.0.1:8092", headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: "node scripts/serve.mjs",
    env: { PORT: "8092" },
    url: "http://127.0.0.1:8092",
    reuseExistingServer: false,
  },
});
