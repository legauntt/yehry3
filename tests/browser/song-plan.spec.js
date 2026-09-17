import { test, expect } from "@playwright/test";

const id = `distonyc-${"f".repeat(24)}`;
const musicalSettings = { genre: "Piano funk", instruments: ["Electric piano", "Bass", '<img src=x onerror="window.planXss=1">'],
  meter: "4/4", structure: "Verse → Chorus → Verse → Final chorus", performance: "Connected melodic singing",
  energy: "Build to the final chorus", lyricWorkflow: "Story first" };
const plan = { musicalSettings, version: 1, title: "The saved title", recipe: "new", style: "rock", duration: 240,
  bpm: 110, keyscale: "D minor", arrangement: 'Quiet piano, then a full chorus. <img src=x onerror="window.planXss=1">',
  lyrics: "[Verse]\nSaved words\n[Chorus]\nA refrain", movements: [{ duration: 120, arrangement: "A quiet return", lyrics: "Movement words" }] };
const song = { id, title: "The recorded title", url: "/fearhunger/Fear and Hunger.mp3", duration: 245, collection: "distonyc",
  originalPrompt: { idea: "The user’s original idea", direction: "Piano rock", keep: "A warm voice", basisSongs: [], voiceModel: "v6" },
  songPlan: plan, lyrics: { text: "Final words", kind: "written" } };

test("Full Auto links to resolved musical choices, escaped lyrics and mobile layout", async ({ page }) => {
  await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({ json: { song } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [song], nextVoteAt: null } }));
  await page.goto("/");
  await page.getByRole("link", { name: `Song plan for ${song.title}` }).click();
  await expect(page.locator(".original-prompt")).toContainText(song.originalPrompt.idea);
  await expect(page.locator("#song-plan")).toContainText("110 BPM");
  await expect(page.locator("#song-plan")).toContainText("The saved title");
  await expect(page.locator("#song-plan")).toContainText("fields left on Auto");
  for (const text of ["Style or genre", "Piano funk", "Featured instruments", "Electric piano, Bass",
    "4/4", musicalSettings.structure, musicalSettings.performance, musicalSettings.energy, "Story first"]) {
    await expect(page.locator("#song-plan")).toContainText(text);
  }
  await page.locator(".plan-lyrics summary").first().click();
  await expect(page.locator(".plan-lyrics .lyrics-text").first()).toBeVisible();
  expect(await page.evaluate(() => window.planXss)).toBeUndefined();
  await expect(page.locator("#song-plan img")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".original-prompt").screenshot({ path: "artifacts/song-plan-mobile.png" });
});

test("offline and older API responses retain the matching fallback plan", async ({ page }) => {
  await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({ json: { song: { ...song, songPlan: undefined } } }));
  await page.route(`**/songs/${id}.json`, route => route.fulfill({ json: song }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [{ ...song, songPlan: undefined }], nextVoteAt: null } }));
  await page.route(`**/yehry3/queue/${id}`, route => route.fulfill({ status: 404, json: { error: "Missing" } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [song] } }));
  await page.goto(`/original-prompt/?song=${id}`);
  await expect(page.locator("#song-plan")).toContainText("110 BPM");
  await expect(page.locator("#song-plan")).toContainText("Electric piano, Bass");
  await page.route(`**/yehry3/songs/${id}`, route => route.abort());
  await page.reload();
  await expect(page.locator("#song-plan")).toContainText("110 BPM");
  await page.evaluate(() => localStorage.removeItem("yehry3:public-songs:v1"));
  await page.route(`**/songs/${id}.json`, route => route.fulfill({ json: { ...song, songPlan: undefined } }));
  await page.reload();
  await expect(page.locator("#song-plan")).toContainText("No saved plan is available");
  await expect(page.locator(".original-prompt")).toContainText(song.originalPrompt.idea);
});

test("an open request page shows its plan as soon as the next poll finds it", async ({ page }) => {
  await page.clock.install();
  let ready = false;
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({ json: { song: { id, idea: "The request", status: "processing", originalPrompt: song.originalPrompt, ...(ready ? { songPlan: plan } : {}) } } }));
  await page.goto(`/original-prompt/?song=${id}`);
  await expect(page.locator("#song-plan")).toContainText("after planning finishes");
  ready = true;
  await page.clock.fastForward(30001);
  await expect(page.locator("#song-plan")).toContainText("110 BPM");
  await expect(page.getByRole("link", { name: "Hear the song" })).toHaveCount(0);
});

test("older saved plans show existing settings without inventing instruments", async ({ page }) => {
  const older = { ...song, songPlan: { ...plan, musicalSettings: undefined } };
  await page.route("**/yehry3/songs/" + id, route => route.fulfill({ json: { song: older } }));
  await page.route("**/songs/" + id + ".json", route => route.fulfill({ json: older }));
  await page.goto("/original-prompt/?song=" + id);
  await expect(page.locator("#song-plan")).toContainText("110 BPM");
  await expect(page.locator("#song-plan")).toContainText("D minor");
  await expect(page.locator("#song-plan")).toContainText("Quiet piano, then a full chorus.");
  await expect(page.locator("#song-plan")).not.toContainText("Featured instruments");
  await expect(page.locator("#song-plan")).not.toContainText("undefined");
});

test("explicit Advanced selections remain separate from resolved planner choices", async ({ page }) => {
  const explicit = { ...song, originalPrompt: { ...song.originalPrompt, generation: {
    version: 1, genre: "Funk", instruments: ["Piano"], bpm: 110
  } } };
  await page.route("**/yehry3/songs/" + id, route => route.fulfill({ json: { song: explicit } }));
  await page.goto("/original-prompt/?song=" + id);
  await expect(page.locator(".generation-brief")).toContainText("Funk");
  await expect(page.locator(".generation-brief")).toContainText("Piano");
  await expect(page.locator("#song-plan")).toContainText("Piano funk");
  await expect(page.locator("#song-plan")).toContainText("Electric piano, Bass");
});
