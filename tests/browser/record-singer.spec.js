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
    text: "[Verse]\nThe midnight train is calling every dreamer home\nA little spark is dancing underneath the rain\nFootsteps keep their rhythm by the river\nEvery window throws a little gold\nMorning finds the station slowly waking\nOld guitars are leaning by the door\nSomeone hums a harmony behind us\nStreetlights fade beneath the climbing sun\nHome is in the chorus we remember\nSing it till the restless night is done",
  },
};
const summary = { ...detail, lyrics: undefined };

test("record clicks and idle spins show comic lyric captions unless the saved preference is off", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => .999;
    window.__spokenLyrics = [];
    window.__speechCancels = 0;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      cancel: () => { window.__speechCancels += 1; },
      speak: (utterance) => window.__spokenLyrics.push({
        text: utterance.text, rate: utterance.rate, pitch: utterance.pitch,
      }),
    } });
  });
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [summary] } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [summary], nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/songs/singing-record.json", route => route.fulfill({ json: detail }));
  await page.route("**/yehry3/songs/singing-record", route => route.fulfill({ json: { song: detail } }));
  await page.goto("/");

  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  const captions = page.getByRole("checkbox", { name: "Lyric captions" });
  const lyricAudio = page.getByRole("checkbox", { name: "Lyric audio" });
  await expect(captions).toBeChecked();
  await expect(lyricAudio).not.toBeChecked();
  await page.getByRole("button", { name: "Close display settings" }).click();

  const record = page.locator(".record");
  const bubble = page.locator(".record-lyric");
  await expect(bubble).toBeHidden();
  await record.click({ force: true });
  await expect(bubble).toBeVisible();
  const captionSizing = await bubble.evaluate(element => ({
    fontSize: parseFloat(getComputedStyle(element.querySelector("blockquote")).fontSize),
    paddingTop: parseFloat(getComputedStyle(element).paddingTop),
  }));
  expect(captionSizing.fontSize).toBeGreaterThanOrEqual(22.4);
  expect(captionSizing.paddingTop).toBe(24);
  await expect(bubble).toHaveAttribute("data-line-count", "8");
  await expect(bubble.locator("blockquote")).toContainText(/morning finds|restless night/i);
  await expect(bubble.locator("figcaption")).toContainText(detail.title);
  expect(await page.evaluate(() => window.__spokenLyrics)).toEqual([]);

  await page.mouse.click(10, 10);
  await expect(bubble).toBeHidden();
  await record.press("Enter");
  await expect(bubble).toBeVisible();
  await page.mouse.click(10, 10);
  await record.evaluate(element => element.dispatchEvent(new CustomEvent("recordidle")));
  await expect(bubble).toBeVisible();
  expect(await page.evaluate(() => window.__spokenLyrics)).toEqual([]);

  await page.getByRole("button", { name: "Open display settings" }).click();
  await lyricAudio.check();
  await page.getByRole("button", { name: "Close display settings" }).click();
  await record.click({ force: true });
  await expect.poll(() => page.evaluate(() => window.__spokenLyrics.length)).toBe(1);
  expect(await page.evaluate(() => window.__spokenLyrics[0].rate)).toBeCloseTo(0.92);
  expect(await page.evaluate(() => window.__spokenLyrics[0].pitch)).toBeCloseTo(1.08);
  expect(await page.evaluate(() => window.__spokenLyrics[0].text)).toMatch(/morning finds|restless night/i);
  await record.evaluate(element => element.dispatchEvent(new CustomEvent("recordidle")));
  await expect.poll(() => page.evaluate(() => window.__spokenLyrics.length)).toBe(1);

  await page.getByRole("button", { name: "Open display settings" }).click();
  await captions.uncheck();
  await expect(bubble).toBeHidden();
  await page.getByRole("button", { name: "Close display settings" }).click();
  await record.evaluate(element => element.dispatchEvent(new CustomEvent("recordidle")));
  await expect(bubble).toBeHidden();
  expect(await page.evaluate(() => window.__spokenLyrics)).toHaveLength(1);
  await record.click({ force: true });
  await expect.poll(() => page.evaluate(() => window.__spokenLyrics.length)).toBe(2);
  await expect(bubble).toBeHidden();

  await page.getByRole("button", { name: "Open display settings" }).click();
  await lyricAudio.uncheck();
  expect(await page.evaluate(() => window.__speechCancels)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close display settings" }).click();
  await record.click({ force: true });
  await expect(bubble).toBeHidden();
  await record.evaluate(element => element.dispatchEvent(new CustomEvent("recordidle")));
  await expect(bubble).toBeHidden();
  expect(await page.evaluate(() => window.__spokenLyrics)).toHaveLength(2);

  await page.reload();
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(captions).not.toBeChecked();
  await expect(lyricAudio).not.toBeChecked();
  await captions.check();
  await page.getByRole("button", { name: "Close display settings" }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await record.click({ force: true });
  await expect(bubble).toBeVisible();
  const mobileCaptionSizing = await bubble.evaluate(element => ({
    fontSize: parseFloat(getComputedStyle(element.querySelector("blockquote")).fontSize),
    paddingTop: parseFloat(getComputedStyle(element).paddingTop),
  }));
  expect(mobileCaptionSizing.fontSize).toBeGreaterThanOrEqual(22.4);
  expect(mobileCaptionSizing.paddingTop).toBe(18);
  await expect(bubble).toHaveAttribute("data-line-count", "4");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileBubble = await bubble.evaluate(element => {
    const box = element.getBoundingClientRect();
    const contentBottom = element.querySelector('figcaption').getBoundingClientRect().bottom;
    return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, contentBottom, viewportHeight: innerHeight, viewportWidth: innerWidth };
  });
  expect(mobileBubble.top).toBeGreaterThanOrEqual(0);
  expect(mobileBubble.right).toBeLessThanOrEqual(mobileBubble.viewportWidth);
  expect(mobileBubble.bottom).toBeLessThanOrEqual(mobileBubble.viewportHeight);
  expect(mobileBubble.left).toBeGreaterThanOrEqual(0);
  expect(mobileBubble.contentBottom).toBeLessThanOrEqual(mobileBubble.bottom);
  await page.screenshot({ path: "artifacts/record-singer-mobile.png" });
});
