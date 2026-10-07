import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { videoVersions } from "../../assets/song-video-versions.js";

const cases = [
  ["distonyc-06d2b8c3c8dffed19df347bb", "It Was Simple, Not Easy", 300, "star-of-david", "Star of David"],
  ["distonyc-d88c69ac5b02b644324e42ad", "Yeah After Midnight", 230.034, "saxophone", "Saxophone"],
  ["distonyc-0dc2bea1e37dea334832f473", "The Golden Answer (Midnight Synth Remedy)", 280.085, "golden-shower", "Showerhead with yellow water"]
];
const media = await readFile(new URL("./fixtures/music-video.mp4", import.meta.url));

for (const [id, title, duration, symbol, iconTitle] of cases) {
const latest = videoVersions(id).at(-1).label;
for (const width of [1440, 390]) {
  test(`${title}: custom launch icon and preserved versions work with keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const songs = [{ id, title, collection: "distonyc", duration, url: "/fixture.mp3", votes: 1, feedback: {} }];
    await page.route("**/yehry3/{catalog,songs/summary}", r => r.fulfill({ json: { songs } }));
    await page.route("**/catalog-summary.json", r => r.fulfill({ json: { songs } }));
    await page.route("**/yehry3/queue?*", r => r.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
    await page.route(/\.mp4(?:\?.*)?$/, r => r.fulfill({ contentType: "video/mp4", body: media }));
    await page.goto(`/#${id}`);
    const trigger = page.locator(`[data-video-open="${id}"]`);
    await expect(trigger.locator('[data-video-symbol]')).toHaveText(iconTitle);
    await expect(trigger.locator("[data-video-symbol]")).toHaveAttribute("data-video-symbol", symbol);
    const glyphBox = await trigger.locator('[data-video-symbol] svg').boundingBox();
    const buttonBox = await trigger.boundingBox();
    expect(glyphBox.x).toBeGreaterThanOrEqual(buttonBox.x);
    expect(glyphBox.y).toBeGreaterThanOrEqual(buttonBox.y);
    expect(glyphBox.x + glyphBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
    expect(glyphBox.y + glyphBox.height).toBeLessThanOrEqual(buttonBox.y + buttonBox.height);
    await expect(trigger).toHaveAttribute("aria-label", `Watch music video with audio for ${title}`);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[aria-pressed="true"]')).toHaveText(latest);
    await expect(dialog.locator('[data-video-play] [data-video-symbol]')).toHaveText(iconTitle);
    await dialog.getByRole("button", { name: "Version A", exact: true }).click();
    await expect(dialog.locator('[data-video-play] [data-video-symbol]')).toHaveCount(0);
    await dialog.getByRole("button", { name: `Version ${latest} (latest)`, exact: true }).click();
    await expect(dialog.locator('[data-video-play] [data-video-symbol]')).toHaveCount(1);
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/glyph-${id}-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.hover();
    await page.waitForTimeout(2300);
    await expect(page.locator('.song-video-preview')).toHaveCount(0);
  });
}

}
