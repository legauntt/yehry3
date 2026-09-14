import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../../wiseau/clips.json", import.meta.url), "utf8"),
);
const clip = manifest.clips[0];

test("a shared Tommy line opens from its stable link, plays, and offers its MP3", async ({ page }) => {
  test.skip(!clip, "Nothing has been shared yet; the uploader adds the first clip after this page is live.");
  await page.goto(`/wiseau/${clip.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(clip.text);
  await expect(page).toHaveTitle(/Tommy says/);
  await expect(page.getByText("He never said this.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Download MP3/ })).toHaveAttribute("href", clip.url);

  const audio = await page.request.get(clip.url);
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toBe("audio/mpeg");
  const served = await page.request.get("/wiseau/clips.json");
  expect(served.headers()["content-type"]).toBe("application/json");
  expect((await served.json()).clips.map((entry) => entry.id)).toContain(clip.id);

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 15000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".player")).toBeInViewport();
});

test("the index lists every shared line and an unknown link explains itself", async ({ page }) => {
  await page.goto("/wiseau/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tommy says.");
  await expect(page.locator(".row")).toHaveCount(manifest.clips.length);
  if (clip) await expect(page.locator(".row-quote").first()).toHaveAttribute("href", `/wiseau/${clip.id}`);
  else await expect(page.locator(".clips-empty")).toHaveText("Nothing shared yet.");

  await page.goto("/wiseau/nope2345");
  await expect(page.getByRole("status")).toContainText("No clip lives at this link");
  await expect(page.locator(".row")).toHaveCount(manifest.clips.length);

  const bare = await page.request.get("/wiseau", { maxRedirects: 0 });
  expect(bare.status()).toBe(301);
  expect(bare.headers().location).toBe("/wiseau/");
});
