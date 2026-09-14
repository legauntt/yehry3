import { test, expect } from "@playwright/test";

test("Backstage summarizes advanced settings and lets admins read long attachments on desktop and mobile", async ({ page }) => {
  const sheet = "[Verse 1]\n" + "A lantern lights the railway home\n".repeat(90) + "[End]";
  const attack = '<img src=x onerror="alert(1)">';
  const request = {
    id: "expanded-brief", status: "queued", priority: 0, version: 1,
    prompt: "A lantern in the last train window", authoredBy: "Jesse",
    confirmedAt: "2026-09-13T20:00:00Z", history: [],
    details: {
      voiceModel: "v7", keep: "Keep the lantern hook.", direction: "Warm guitar.\nBuild to a bright final chorus.",
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
  await expect(card.locator(".prompt-summary")).toContainText("Tony V7 · experimental");
  await expect(card.locator(".prompt-summary")).toContainText("Adapt these lyrics");
  await expect(card.locator(".prompt-summary")).toContainText("3 reference links");
  await expect(card.locator(".prompt-summary")).toContainText("2 basis songs");
  await expect(card.locator(".material-text").first()).toBeHidden();
  await card.getByText("Open brief & controls").click();
  await expect(card.getByRole("heading", { name: "Essentials", exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Advanced", exact: true })).toBeVisible();
  await expect(card.locator(".brief")).toContainText(request.details.direction);
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
