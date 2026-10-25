import { defineConfig } from "@playwright/test";

const live = process.env.YEHRY3_VIDEO_URL;
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: live ? "song-videos-live.spec.js" : "song-videos.spec.js",
  workers: 1,
  timeout: 45000,
  use: { baseURL: live || "http://127.0.0.1:8097", headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: live ? undefined : {
    command: "node scripts/serve.mjs",
    env: { PORT: "8097" },
    url: "http://127.0.0.1:8097",
    reuseExistingServer: false,
  },
});
