import { test, expect } from "@playwright/test";

const detail = {
  id: "singing-record",
  title: "The Singing Record",
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  duration: 180,
  collection: "tonyai",
  hasLyrics: true,
  lyrics: {
    kind: "written",
    text: "[Verse]\nThe midnight train is calling every dreamer home\nA little spark is dancing underneath the rain",
  },
};
const summary = { ...detail, lyrics: undefined };

test("record clicks and idle spins show comic lyric captions unless the saved preference is off", async ({ page }) => {
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [summary] } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [summary], nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/songs/singing-record.json", route => route.fulfill({ json: detail }));
  await page.route("**/yehry3/songs/singing-record", route => route.fulfill({ json: { song: detail } }));
  await page.goto("/");

  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  const captions = page.getByRole("checkbox", { name: "Lyric captions" });
  await expect(captions).toBeChecked();
  await page.getByRole("button", { name: "Close display settings" }).click();

  const record = page.locator(".record");
  const bubble = page.locator(".record-lyric");
  await expect(bubble).toBeHidden();
  await record.click({ force: true });
  await expect(bubble).toBeVisible();
  await expect(bubble.locator("blockquote")).toContainText(/midnight train|little spark/i);
  await expect(bubble.locator("figcaption")).toContainText(detail.title);

  await page.mouse.click(10, 10);
  await expect(bubble).toBeHidden();
  await record.press("Enter");
  await expect(bubble).toBeVisible();
  await page.mouse.click(10, 10);
  await record.evaluate(element => element.dispatchEvent(new CustomEvent("recordidle")));
  await expect(bubble).toBeVisible();

  await page.getByRole("button", { name: "Open display settings" }).click();
  await captions.uncheck();
  await expect(bubble).toBeHidden();
  await page.getByRole("button", { name: "Close display settings" }).click();
  await record.click({ force: true });
  await expect(bubble).toBeHidden();
  await record.evaluate(element => element.dispatchEvent(new CustomEvent("recordidle")));
  await expect(bubble).toBeHidden();

  await page.reload();
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(captions).not.toBeChecked();
  await captions.check();
  await page.getByRole("button", { name: "Close display settings" }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  await record.click({ force: true });
  await expect(bubble).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/record-singer-mobile.png", animations: "disabled" });
});
