import { defineConfig } from "@playwright/test";

// These lyric-sheet tests stub public song reads; no database or song generation is needed.
const live = process.env.YEHRY3_LYRICS_URL;
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["lyrics-routing.spec.js", "lyric-moments.spec.js", "lyric-views.spec.js"],
  workers: 1,
  timeout: 45000,
  use: { baseURL: live || "http://127.0.0.1:8096", headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: "node scripts/serve.mjs",
    env: { PORT: "8096" },
    url: "http://127.0.0.1:8096",
    reuseExistingServer: false,
  },
});
