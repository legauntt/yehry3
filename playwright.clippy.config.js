import { defineConfig } from "@playwright/test";
const live = process.env.YEHRY3_CLIPPY_URL;
export default defineConfig({
  testDir: "./tests/browser", testMatch: "clippy.spec.js", workers: 1,
  use: { baseURL: live || "http://127.0.0.1:8097", headless: true },
  webServer: live ? undefined : { command: "node scripts/serve.mjs", env: {PORT: "8097"},
    url: "http://127.0.0.1:8097", reuseExistingServer: false },
});
