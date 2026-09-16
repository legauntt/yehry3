import { test, expect } from "@playwright/test";

const generation = { version: 1, genre: 'Soul waltz', instruments: ['Piano', 'Cello'], avoidInstruments: ['Drum machine'], structure: 'Verse, Chorus, Bridge, Final chorus', duration: 180, bpm: 98, keyscale: 'D minor', meter: '3/4', vocalEntry: 0, endingSeconds: 4, maxBreakSeconds: 0, lyricWorkflow: 'story', avoidPhrases: ['stock phrase'], requiredPhrases: ['Last train home'], lockedLines: ['Carry me home'], reviewLyrics: true, candidates: 2, variation: 'adventurous', seed: 0, vocalGainDb: -2, backingGainDb: 1, performance: 'natural', energy: 'auto' };
async function checkGeneration(brief) {
  for (const value of ['Soul waltz', 'Piano', 'Drum machine', 'Verse, Chorus, Bridge, Final chorus', '180', '98', 'D minor', '3/4', 'Story first', 'stock phrase', 'Last train home', 'Carry me home', 'Approve before composing', 'More adventurous']) await expect(brief.locator('.generation-brief')).toContainText(value);
  await expect(brief.locator('.generation-brief dt')).not.toContainText(['Vocal delivery', 'Energy through the song']);
  await expect(brief.locator('.generation-brief')).not.toContainText('Choose for this song');
}

for (const status of ["queued", "published"]) {
  test(`anonymous visitors can read supplied material for a ${status} request`, async ({ page }) => {
    const id = "distonyc-" + "b".repeat(24);
    const attack = '<img src=x onerror="alert(1)">';
    const originalPrompt = { idea: "An evening railway song", direction: "Warm guitar", keep: "A hopeful chorus", basisSongs: [], voiceModel: "v8", generation };
    const song = { id, title: "Evening Railway", url: "https://example.org/song.mp3", lyrics: { text: "Finished song lyrics", kind: "written" }, originalPrompt };
    const full = { id, idea: originalPrompt.idea, status, originalPrompt: {
      ...originalPrompt, generation, lyricSheet: { text: "[Verse]\nSupplied words\n" + attack, mode: "adapt" }, references: [
        { url: "https://example.org/" + "railway".repeat(35), purpose: "creative", note: "Borrow the atmosphere.", snapshot: { status: "ready", title: "An evening train", text: "Saved page\n" + attack } },
      ],
    } };
    await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: status === "published" ? [song] : [] } }));
    await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
    await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({ json: { song: { ...(status === "published" ? song : {}), ...full } } }));
    await page.goto(`/original-prompt/?song=${id}`);
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(page.locator(".brief")).not.toContainText("are private");
    await checkGeneration(page.locator(".brief"));
    await expect(page.locator(".brief")).toContainText("Tony V8 · expanded recordings");
    await expect(page.locator(".materials-review")).toContainText("Adapt these lyrics");
    await page.getByText("Read the submitted lyric sheet").click();
    await expect(page.getByRole("region", { name: "Submitted lyric sheet" })).toHaveText(full.originalPrompt.lyricSheet.text);
    await expect(page.locator(".reference-review a")).toHaveAttribute("href", full.originalPrompt.references[0].url);
    await page.getByText("View saved reference content").click();
    await expect(page.getByRole("region", { name: "Saved content for reference 1" })).toContainText(attack);
    await expect(page.locator(".brief img")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/public-materials-${status}-mobile.png`, fullPage: true });
    if (status === "published") {
      await expect(page.getByRole("link", { name: "Hear the song" })).toHaveAttribute("href", song.url);
      await expect(page.getByRole("link", { name: "Lyrics ↗", exact: true })).toBeVisible();
      await page.route(`**/yehry3/songs/${id}`, route => route.abort());
      await page.reload();
      await expect(page.locator(".original-prompt h1")).toHaveText(song.title);
      await expect(page.locator(".materials-review")).toContainText("Adapt these lyrics");
      await expect(page.locator(".materials-review")).not.toContainText("No lyric sheet");
    }
  });
}

test("Backstage summarizes advanced settings and lets admins read long attachments on desktop and mobile", async ({ page }) => {
  const sheet = "[Verse 1]\n" + "A lantern lights the railway home\n".repeat(90) + "[End]";
  const attack = '<img src=x onerror="alert(1)">';
  const request = {
    id: "expanded-brief", status: "queued", priority: 0, version: 1,
    prompt: "A lantern in the last train window", authoredBy: "Jesse",
    confirmedAt: "2026-09-13T20:00:00Z", history: [],
    details: {
      voiceModel: "v7", generation, keep: "Keep the lantern hook.", direction: "Warm guitar.\nBuild to a bright final chorus.",
      basisSongTitles: ["Medusa", "Railway & Rain"], lyricSheet: { text: sheet, mode: "adapt" },
      references: [
        { url: "https://example.org/" + "long-title".repeat(20), purpose: "creative", note: "Borrow the warm atmosphere.\nKeep the final lift.", snapshot: { title: "An evening train " + attack, status: "ready", text: "Saved atmosphere\n" + attack, message: "Page text saved." } },
        { url: "https://example.org/lyrics", purpose: "lyrics", note: "Use the pasted words.", snapshot: { status: "unavailable", message: "This page could not be read." } },
        { url: "https://example.org/drums", purpose: "creative", note: "Soft brushed drums." },
      ],
    },
  };
  await page.route("**/yehry3/admin/prompts?**", route => route.fulfill({ json: { prompts: [request], total: 1, page: 0, counts: { queued: 1 }, transitions: { queued: ["canceled"] }, workers: [] } }));
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  const card = page.locator('[data-prompt="expanded-brief"]');
  await expect(card.locator(".prompt-summary")).toContainText("Tony V7 · fresh catalog");
  await expect(card.locator(".prompt-summary")).toContainText("Adapt these lyrics");
  await expect(card.locator(".prompt-summary")).toContainText("3 reference links");
  await expect(card.locator(".prompt-summary")).toContainText("2 basis songs");
  await expect(card.locator(".material-text").first()).toBeHidden();
  await card.getByText("Open brief & controls").click();
  await expect(card.getByRole("heading", { name: "Essentials", exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Advanced", exact: true })).toBeVisible();
  await expect(card.locator(".brief")).toContainText(request.details.direction);
  await checkGeneration(card.locator(".brief"));
  await expect(card.locator(".prompt-summary")).toContainText("V8 generation");
  await expect(card.locator(".prompt-summary")).toContainText("Advanced settings");
  await expect(card.locator(".reference-status")).toHaveText(["Content saved", "Content unavailable", "Not previewed"]);
  await expect(card.locator(".reference-review").first().getByRole("link")).toHaveAttribute("href", request.details.references[0].url);
  await expect(card.locator(".reference-review").first()).toContainText(attack);
  await expect(card.locator("img")).toHaveCount(0);
  await card.getByText("Read the submitted lyric sheet").click();
  const lyrics = card.getByRole("region", { name: "Submitted lyric sheet", exact: true });
  await expect(lyrics).toHaveText(sheet);
  await lyrics.focus();
  await page.keyboard.press("Control+End");
  await expect.poll(() => lyrics.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await card.getByText("View saved reference content").click();
  await expect(card.getByRole("region", { name: "Saved content for reference 1" })).toContainText(attack);
  await expect(card.getByLabel("Private admin note")).toBeVisible();
  await page.screenshot({ path: "artifacts/prompt-details-admin-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/prompt-details-admin-mobile.png", fullPage: true });
  await card.getByText("Read the submitted lyric sheet").click();
  await expect(lyrics).toBeHidden();
  await expect(card.getByRole("region", { name: "Saved content for reference 1" })).toBeVisible();
});
