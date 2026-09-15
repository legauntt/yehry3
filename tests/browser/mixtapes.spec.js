import { test, expect } from "@playwright/test";
import { emptyTape, encodeTape } from "../../assets/mixtape-data.js";
const songs = [
  { id: "tape-one", title: "First record", duration: 75, url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", hasLyrics: true },
  { id: "tape-two", title: "Second record", duration: 90, url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3" },
];
async function catalog(page) {
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
}
test("build, reorder, share and reopen a tape without replacing the saved draft", async ({ page, context }) => {
  await catalog(page);
  await page.goto("/mixtapes/");
  await page.getByLabel("Mixtape name", { exact: true }).fill("Late night 🎶");
  await page.getByLabel("Sleeve color").selectOption("pink");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Add Second record to side A" }).click();
  await page.getByRole("button", { name: "Move Second record up" }).click();
  await expect(page.locator('[data-side="a"] .tape-track strong')).toHaveText(["Second record", "First record"]);
  await page.getByRole("button", { name: "Move First record to side B" }).click();
  await expect(page.locator('[data-side="a"]')).toContainText("1:30");
  await expect(page.locator('[data-side="b"]')).toContainText("1:15");
  await page.reload();
  await expect(page.getByLabel("Mixtape name", { exact: true })).toHaveValue("Late night 🎶");
  await expect(page.locator(".tape-sleeve")).toHaveAttribute("data-color", "pink");
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  const url = await page.locator("#tape-link").inputValue();
  await page.getByLabel("Mixtape name", { exact: true }).fill("New draft");
  const recipient = await context.newPage(); await catalog(recipient); await recipient.goto(url);
  await expect(recipient.locator("#tape-title")).toHaveText("Late night 🎶");
  await expect(recipient.locator(".tape-edit")).toBeHidden();
  await expect(recipient.locator('[data-side="b"] .tape-track strong')).toHaveText("First record");
  expect(await recipient.evaluate(() => JSON.parse(localStorage.getItem("yehry3:mixtape:v1")).name)).toBe("New draft");
  await recipient.getByRole("button", { name: "Make your own version" }).click();
  await expect(recipient.getByLabel("Mixtape name", { exact: true })).toHaveValue("Late night 🎶");
  await recipient.close();
});
test("tape playback continues through edits, seeking and the next track", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Add Second record to side B" }).click();
  await page.getByRole("button", { name: "Play the mixtape", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  await page.locator("audio").evaluate(audio => { window.tapeAudio = audio; audio.currentTime = 12; });
  await page.getByLabel("Mixtape name", { exact: true }).fill("Still playing");
  expect(await page.locator("audio").evaluate(audio => audio === window.tapeAudio && !audio.paused && audio.currentTime >= 12)).toBe(true);
  await page.getByRole("button", { name: "Next song", exact: true }).click();
  await expect(page.locator("#tape-now")).toHaveText("Second record");
  await expect(page.getByRole("button", { name: "Next song", exact: true })).toBeDisabled();
});
test("mobile, unavailable storage and API fallback still allow sharing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new Error("Blocked"); } }));
  await catalog(page);
  await page.route("**/yehry3/songs/summary", route => route.abort());
  await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await expect(page.locator("#tape-status")).toContainText("storage is unavailable");
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/#tape=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/mixtape-mobile.png", fullPage: true });
});
test("untrusted links and missing songs stay safe and readable", async ({ page }) => {
  await catalog(page);
  await page.goto("/mixtapes/#tape=broken");
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
  await page.goto(`/mixtapes/#tape=${encodeTape({ ...emptyTape(), name: '<img src=x onerror="alert(1)">', a: ["missing"] })}`);
  await expect(page.locator("#tape-title")).toHaveText('<img src=x onerror="alert(1)">');
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator(".tape-track")).toContainText("Song unavailable");
  await expect(page.getByRole("button", { name: "Play the mixtape", exact: true })).toBeDisabled();
});
