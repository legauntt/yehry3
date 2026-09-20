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
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
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
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
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

test("cassette controls pause, seek, flip and automatically continue across sides", async ({ page }) => {
  await catalog(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/mixtapes/#tape=${encodeTape({ ...emptyTape(), a: ["tape-one"], b: ["tape-two"] })}`);
  const audio = page.locator("audio");
  await page.getByRole("button", { name: "Play First record", exact: true }).click();
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await expect(page.locator(".tape-reel").first()).toHaveCSS("animation-play-state", "running");
  await page.getByRole("button", { name: "Pause mixtape" }).click();
  await expect.poll(() => audio.evaluate(a => a.paused)).toBe(true);
  await expect(page.locator(".tape-reel").first()).toHaveCSS("animation-play-state", "paused");
  const seek = page.getByRole("slider", { name: "Seek in song" });
  await seek.fill("20");
  await expect.poll(() => audio.evaluate(a => Math.floor(a.currentTime))).toBe(20);
  await page.getByRole("slider", { name: "Volume", exact: true }).fill("0.4");
  expect(await audio.evaluate(a => a.volume)).toBeCloseTo(.4);
  await page.getByRole("button", { name: "Play the mixtape" }).click();
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime >= 20)).toBe(true);
  await page.getByRole("button", { name: "Flip to side B" }).click();
  await expect(page.locator("#tape-now")).toHaveText("Second record");
  await expect(page.locator("#cassette-side")).toHaveText("SIDE B");
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await page.getByRole("button", { name: "Stop playback" }).click();
  await expect.poll(() => audio.evaluate(a => a.paused && a.currentTime === 0)).toBe(true);
  await page.getByRole("button", { name: "Flip to side A" }).click();
  await expect(page.locator("#tape-now")).toHaveText("First record");
  expect(await audio.evaluate(a => a.paused)).toBe(true);
  await page.getByRole("button", { name: "Play the mixtape" }).click();
  await expect.poll(() => audio.evaluate(a => Number.isFinite(a.duration))).toBe(true);
  await audio.evaluate(a => { a.currentTime = a.duration - .15; });
  await expect(page.locator("#tape-now")).toHaveText("Second record");
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await audio.evaluate(a => { a.currentTime = a.duration - .15; });
  await expect(page.locator("#tape-mode")).toHaveText("TAPE FINISHED · SIDE B");
  await expect(page.locator(".tape-deck")).toHaveAttribute("data-playing", "false");
});

test("editing repeated entries preserves the current audio and updates the next song", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Add Second record to side B" }).click();
  await page.getByRole("button", { name: "Play First record", exact: true }).first().click();
  await expect.poll(() => page.locator("audio").evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await page.locator("audio").evaluate(a => { window.originalAudio = a; a.currentTime = 18; });
  await page.getByRole("button", { name: "Move First record to side B" }).first().click();
  await expect(page.locator("#cassette-side")).toHaveText("SIDE B");
  expect(await page.locator("audio").evaluate(a => a === window.originalAudio && !a.paused && a.currentTime >= 18)).toBe(true);
  await page.getByRole("button", { name: "Move First record up" }).last().click();
  await page.getByRole("button", { name: "Next song", exact: true }).click();
  await expect(page.locator("#tape-now")).toHaveText("Second record");
  await page.getByRole("button", { name: "Remove Second record", exact: true }).click();
  expect(await page.locator("audio").evaluate(a => a.paused && !a.getAttribute("src"))).toBe(true);
  await expect(page.locator(".is-current")).toHaveCount(0);
});

test("surprise mix preserves selections, avoids repeats and respects the 40-track limit", async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...songs[0], id: `song-${i}`, title: `Record ${i}` }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: many } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: many } }));
  await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add Record 0 to side A", exact: true }).click();
  await page.getByRole("button", { name: "Add a surprise mix" }).click();
  await expect(page.locator(".tape-track")).toHaveCount(7);
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("yehry3:mixtape:v1")));
  expect(draft.a[0]).toBe("song-0");
  expect(new Set([...draft.a, ...draft.b]).size).toBe(7);
  expect(Math.abs(draft.a.length - draft.b.length)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("yehry3:mixtape:v1"));
    draft.a = Array(39).fill("song-0"); draft.b = [];
    localStorage.setItem("yehry3:mixtape:v1", JSON.stringify(draft));
  });
  await page.reload();
  await page.getByRole("button", { name: "Add a surprise mix" }).click();
  await expect(page.locator(".tape-track")).toHaveCount(40);
  await expect(page.locator("#tape-surprise")).toBeDisabled();
  expect(await page.locator("[data-add]:enabled").count()).toBe(0);
});

test("record shelf anchors preserve playback and reduced motion keeps reels still", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await catalog(page); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Play the mixtape" }).click();
  await expect.poll(() => page.locator("audio").evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await page.locator("audio").evaluate(a => { window.originalAudio = a; });
  await page.getByRole("link", { name: "Find your first track" }).click();
  expect(await page.locator("audio").evaluate(a => a === window.originalAudio && !a.paused)).toBe(true);
  await page.locator("#tape-picker").scrollIntoViewIfNeeded();
  await expect(page.locator(".tape-dock")).toBeVisible();
  await page.getByRole("button", { name: "Pause from mini player" }).click();
  expect(await page.locator("audio").evaluate(a => a.paused)).toBe(true);
  await page.getByRole("button", { name: "Play from mini player" }).click();
  await expect.poll(() => page.locator("audio").evaluate(a => !a.paused)).toBe(true);
  await expect(page.locator(".tape-reel").first()).toHaveCSS("animation-name", "none");
  await page.reload();
  await expect(page.getByLabel("Mixtape name", { exact: true })).toBeVisible();
  await expect(page.locator(".tape-track")).toHaveCount(1);
});

test("Mixtapes and Backstage stay separate in navigation on desktop and mobile", async ({ page }) => {
  await catalog(page);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Mixtapes", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Backstage", exact: true })).toHaveAttribute("href", "/admin/");
    await nav.getByRole("link", { name: "Mixtapes", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Mixtapes", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Backstage", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await nav.getByRole("link", { name: "Backstage", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Backstage", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Mixtapes", exact: true })).toHaveAttribute("href", "/mixtapes/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

async function drawLabel(page, side) {
  await page.getByText(`Handwrite side ${side.toUpperCase()}`, { exact: true }).click();
  const canvas = page.locator(`[data-label-editor="${side}"] canvas`);
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width * .12, rect.y + rect.height * .75);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height * .25, { steps: 5 });
  await page.mouse.move(rect.x + rect.width * .28, rect.y + rect.height * .75, { steps: 5 });
  await page.mouse.up();
}

test("side labels and real pen strokes survive short-link sharing, reload and a new browser", async ({ page, browser }) => {
  await catalog(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mixtapes/");
  await page.getByLabel("Mixtape name", { exact: true }).fill("Two chapters 🎶");
  await page.getByLabel("Side A label", { exact: true }).fill("The long way home");
  await page.getByLabel("Side B label", { exact: true }).fill("After midnight");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Add Second record to side B" }).click();
  await page.getByRole("button", { name: "Play the mixtape", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await page.locator("audio").evaluate(a => { window.labelAudio = a; a.currentTime = 15; });
  await drawLabel(page, "a");
  expect(await page.locator("audio").evaluate(a => a === window.labelAudio && !a.paused && a.currentTime >= 15)).toBe(true);
  await page.locator('#play-tape').click();
  await expect(page.locator("#tape-label-ink")).toBeVisible();
  const ink = await page.evaluate(() => JSON.parse(localStorage.getItem("yehry3:mixtape:v1")).labels.a.ink);
  expect(ink).toHaveLength(1); expect(ink[0].length).toBeGreaterThan(2);
  await page.getByRole("button", { name: "Flip to side B" }).click();
  await expect(page.locator("#tape-title")).toHaveText("After midnight");
  await expect(page.locator("#tape-title")).toBeVisible();
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  const url = await page.locator("#tape-link").inputValue();
  expect(url.length).toBeLessThan(65); expect(url).not.toContain("#");
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(url);
  await page.reload();
  await expect(page.getByLabel("Side B label", { exact: true })).toHaveValue("After midnight");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yehry3:mixtape:v1")).labels.a.ink)).toEqual(ink);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const recipient = await context.newPage(); await catalog(recipient); await recipient.goto(url);
  await expect(recipient.locator("#tape-label-ink")).toBeVisible();
  await expect(recipient.locator("#tape-label-ink")).toHaveAttribute("aria-label", /The long way home/);
  await expect(recipient.locator(".tape-edit")).toBeHidden();
  expect(await recipient.evaluate(() => localStorage.getItem("yehry3:mixtape:v1"))).toBeNull();
  await recipient.getByRole("button", { name: "Flip to side B" }).click();
  await expect(recipient.locator("#tape-title")).toHaveText("After midnight");
  await recipient.getByRole("button", { name: "Make your own version" }).click();
  await expect(recipient).toHaveURL(/\/mixtapes\/$/);
  await recipient.getByLabel("Side B label", { exact: true }).fill("A different ending");
  await recipient.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(recipient.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  expect(await recipient.locator("#tape-link").inputValue()).not.toBe(url);
  await recipient.goto(url); await recipient.getByRole("button", { name: "Flip to side B" }).click();
  await expect(recipient.locator("#tape-title")).toHaveText("After midnight");
  expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await recipient.screenshot({ path: "artifacts/mixtape-short-labels-mobile.png", fullPage: true });
  await context.close();
});

test("legacy links can be shortened and handwriting can be undone independently per side", async ({ page }) => {
  await catalog(page);
  const legacy = Buffer.from(JSON.stringify({ v: 1, name: "A legacy tape", color: "blue", a: ["tape-one"], b: [] })).toString("base64url");
  await page.goto(`/mixtapes/#tape=${legacy}`);
  await expect(page.locator("#tape-title")).toHaveText("A legacy tape");
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  await page.getByRole("button", { name: "Make your own version" }).click();
  await drawLabel(page, "a"); await drawLabel(page, "b");
  await page.locator('[data-label-editor="a"] [data-ink-undo]').click();
  const labels = await page.evaluate(() => JSON.parse(localStorage.getItem("yehry3:mixtape:v1")).labels);
  expect(labels.a.ink).toHaveLength(0); expect(labels.b.ink).toHaveLength(1);
  await page.getByRole("button", { name: "Flip to side B" }).click();
  await expect(page.locator("#tape-label-ink")).toBeVisible();
  await page.locator('[data-label-editor="b"] [data-ink-clear]').click();
  await expect(page.locator("#tape-label-ink")).toBeHidden();
});

test("short-link write and read failures preserve the local draft and offer a retry", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.route("**/yehry3/mixtapes", route => route.fulfill({ status: 503, json: { error: "The studio is temporarily unavailable." } }));
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-status")).toContainText("Your selection is still here");
  await expect(page.locator("#tape-link")).toBeHidden();
  const draft = await page.evaluate(() => localStorage.getItem("yehry3:mixtape:v1"));
  await page.unroute("**/yehry3/mixtapes");
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  const url = await page.locator("#tape-link").inputValue();
  await page.route("**/yehry3/mixtapes/*", route => route.fulfill({ status: 503, json: { error: "The studio is temporarily unavailable." } }));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yehry3:mixtape:v1"))).toBe(draft);
  await page.unroute("**/yehry3/mixtapes/*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#tape-title")).toHaveText("My Tony C mixtape");
  await page.goto("/mixtapes/abcdefghijkl");
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yehry3:mixtape:v1"))).toBe(draft);
});

test("editing during a slow share never copies a stale version", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  let release;
  await page.route("**/yehry3/mixtapes", async route => {
    await new Promise(resolve => { release = resolve; });
    await route.continue();
  });
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#share-tape")).toHaveAttribute("aria-busy", "true");
  await page.getByLabel("Side A label", { exact: true }).fill("A newer label");
  await expect.poll(() => Boolean(release)).toBe(true); release();
  await expect(page.locator("#tape-status")).toContainText("Your tape changed");
  await expect(page.locator("#tape-link")).toBeHidden();
  await page.unroute("**/yehry3/mixtapes");
  await page.getByRole("button", { name: "Copy mixtape link" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  await page.goto(await page.locator("#tape-link").inputValue());
  await expect(page.locator("#tape-title")).toHaveText("A newer label");
});

test("the editor and record shelf follow Dark Mode instead of staying cream", async ({ page }) => {
  await catalog(page);
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await page.goto("/mixtapes/");
  const luminance = async selector => page.locator(selector).first().evaluate(node => {
    const [r, g, b] = getComputedStyle(node).backgroundColor.match(/\d+/g).map(Number);
    return (r + g + b) / 3;
  });
  for (const selector of [".tape-edit", ".tape-picker", ".side-heading"]) expect(await luminance(selector), selector).toBeLessThan(90);
});
