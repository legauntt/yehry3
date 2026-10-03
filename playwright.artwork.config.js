import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: ["artwork-history.spec.js", "cover-art.spec.js"], workers: 1,
  use: { baseURL: "http://127.0.0.1:8086", headless: true },
  webServer: { command: "node scripts/serve.mjs", url: "http://127.0.0.1:8086", reuseExistingServer: false, env: { PORT: "8086" } },
});
