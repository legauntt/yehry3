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
test("build, reorder, publish and reopen a tape without replacing the saved draft", async ({ page, context }) => {
  await catalog(page);
  await page.goto("/mixtapes/new");
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
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  const url = await page.locator("#tape-link").inputValue();
  await page.getByLabel("Mixtape name", { exact: true }).fill("New draft");
  const recipient = await context.newPage(); await catalog(recipient); await recipient.goto(url);
  await expect(recipient.getByRole("heading", { level: 1 })).toHaveText("Late night 🎶");
  await expect(recipient.locator("#tape-collection-name")).toHaveText("Late night 🎶");
  // An already-published tape offers its link, not a second publish.
  await expect(recipient.getByRole("button", { name: "Publish mixtape" })).toHaveCount(0);
  await recipient.getByRole("button", { name: "Copy link" }).click();
  await expect(recipient.locator("#tape-link")).toHaveValue(url);
  await expect(recipient.locator(".tape-edit")).toBeHidden();
  await expect(recipient.locator('[data-side="b"] .tape-track strong')).toHaveText("First record");
  // A draft belongs to the tab that is editing it; a recipient's tab has none.
  expect(await recipient.evaluate(() => sessionStorage.getItem("yehry3:mixtape:v1"))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("yehry3:mixtape:v1")).name)).toBe("New draft");
  await recipient.getByRole("button", { name: "Make your own version" }).click();
  await expect(recipient).toHaveURL(/\/mixtapes\/new$/);
  await expect(recipient.getByLabel("Mixtape name", { exact: true })).toHaveValue("Late night 🎶");
  await expect(recipient.locator(".tape-track")).toHaveCount(2);
  await recipient.close();
  // Publishing put it in the public gallery.
  await page.goto("/mixtapes/");
  await expect(page.getByRole("link", { name: "Late night 🎶, 2 tracks" })).toHaveAttribute("href", new URL(url).pathname);
});
test("tape playback continues through edits, seeking and the next track", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/new");
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
  await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Blocked"); } }));
  await catalog(page);
  await page.route("**/yehry3/songs/summary", route => route.abort());
  await page.goto("/mixtapes/new");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await expect(page.locator("#tape-status")).toContainText("storage is unavailable");
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/mixtape-mobile.png", fullPage: true });
});
test("untrusted links and missing songs stay safe and readable", async ({ page }) => {
  await catalog(page);
  await page.goto("/mixtapes/#tape=broken");
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
  await page.goto(`/mixtapes/#tape=${encodeTape({ ...emptyTape(), name: '<img src=x onerror="alert(1)">', a: ["missing"] })}`);
  await expect(page.locator("#tape-collection-name")).toHaveText('<img src=x onerror="alert(1)">');
  await expect(page.getByRole("heading", { level: 1 })).toHaveText('<img src=x onerror="alert(1)">');
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
  await catalog(page); await page.goto("/mixtapes/new");
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
  await page.goto("/mixtapes/new");
  await page.getByRole("button", { name: "Add Record 0 to side A", exact: true }).click();
  await page.getByRole("button", { name: "Add a surprise mix" }).click();
  await expect(page.locator(".tape-track")).toHaveCount(7);
  const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem("yehry3:mixtape:v1")));
  expect(draft.a[0]).toBe("song-0");
  expect(new Set([...draft.a, ...draft.b]).size).toBe(7);
  expect(Math.abs(draft.a.length - draft.b.length)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem("yehry3:mixtape:v1"));
    draft.a = Array(39).fill("song-0"); draft.b = [];
    sessionStorage.setItem("yehry3:mixtape:v1", JSON.stringify(draft));
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
  await page.goto("/mixtapes/new");
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
  const canvas = page.locator(`[data-label-editor="${side}"] canvas`);
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width * .12, rect.y + rect.height * .75);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height * .25, { steps: 5 });
  await page.mouse.move(rect.x + rect.width * .28, rect.y + rect.height * .75, { steps: 5 });
  await page.mouse.up();
}
// Clipart is drawn from words like a song cover's redraw; the same words on the same side always draw the same picture.
const clipart = (page, side, words) => page.locator(`[data-art-side="${side}"]`).getByLabel("What should it be?").fill(words);
const artSrc = (page, selector = "#tape-label-art img") => page.locator(selector).getAttribute("src");

test("side labels are drawn or clipart, fall back to Side A / Side B, and survive publishing and a new browser", async ({ page, browser }) => {
  await catalog(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mixtapes/new");
  // Labels are hand-drawn only: there is no typed label field any more.
  await expect(page.getByLabel("Side A label", { exact: true })).toHaveCount(0);
  await page.getByLabel("Mixtape name", { exact: true }).fill("Two chapters 🎶");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Add Second record to side B" }).click();
  await expect(page.locator("#tape-title")).toHaveText("Side A");
  await expect(page.locator("#tape-title")).not.toHaveClass(/sr-only/);
  await page.getByRole("button", { name: "Play the mixtape", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await page.locator("audio").evaluate(a => { window.labelAudio = a; a.currentTime = 15; });
  await drawLabel(page, "a");
  expect(await page.locator("audio").evaluate(a => a === window.labelAudio && !a.paused && a.currentTime >= 15)).toBe(true);
  await page.locator('#play-tape').click();
  await expect(page.locator("#tape-label-ink")).toBeVisible();
  await expect(page.locator("#tape-title")).toHaveClass(/sr-only/);
  const ink = await page.evaluate(() => JSON.parse(sessionStorage.getItem("yehry3:mixtape:v1")).labels.a.ink);
  expect(ink).toHaveLength(1); expect(ink[0].length).toBeGreaterThan(2);
  // Clipart can be a side's label too: beside the drawing on side A, on its own on side B.
  await clipart(page, "a", "a green robot in sunglasses");
  await expect(page.locator("#tape-label-art img")).toBeVisible();
  await expect(page.locator("#tape-label-art img")).toHaveAttribute("alt", /^Side A clipart\. Silly clip art:/);
  await expect(page.locator("#tape-label-ink")).toBeVisible();
  await page.getByRole("button", { name: "Flip to side B" }).click();
  await expect(page.locator("#tape-title")).toHaveText("Side B");
  await expect(page.locator("#tape-title")).not.toHaveClass(/sr-only/);
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await clipart(page, "b", "a ghost with a balloon");
  await expect(page.locator("#tape-label-art img")).toBeVisible();
  await expect(page.locator('[data-art-side="b"] [data-art-status]')).toContainText("ghost");
  const ghost = await artSrc(page);
  await page.getByRole("button", { name: "Another take of Side B clipart" }).click();
  expect(await artSrc(page)).not.toBe(ghost);
  await clipart(page, "b", "a ghost with a balloon");
  expect(await artSrc(page)).toBe(ghost);
  await expect(page.locator("#tape-title")).toHaveClass(/sr-only/);
  await expect(page.locator("#tape-title")).toHaveText("Side B");
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  const url = await page.locator("#tape-link").inputValue();
  expect(url.length).toBeLessThan(65); expect(url).not.toContain("#");
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(url);
  await page.reload();
  await expect(page.locator('[data-art-side="b"] [data-art-preview] img')).toHaveAttribute("src", ghost);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("yehry3:mixtape:v1")).labels.a.ink)).toEqual(ink);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const recipient = await context.newPage(); await catalog(recipient); await recipient.goto(url);
  await expect(recipient.locator("#tape-label-ink")).toBeVisible();
  await expect(recipient.locator("#tape-label-ink")).toHaveAttribute("aria-label", "Handwritten Side A label");
  await expect(recipient.locator("#tape-label-art img")).toHaveAttribute("alt", /^Side A clipart\./);
  await expect(recipient.locator(".tape-edit")).toBeHidden();
  await recipient.getByRole("button", { name: "Flip to side B" }).click();
  await expect(recipient.locator("#tape-label-art img")).toHaveAttribute("src", ghost);
  await recipient.getByRole("button", { name: "Make your own version" }).click();
  await expect(recipient).toHaveURL(/\/mixtapes\/new$/);
  await clipart(recipient, "b", "a sun with a lollipop");
  expect(await artSrc(recipient, '[data-art-side="b"] [data-art-preview] img')).not.toBe(ghost);
  await recipient.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(recipient.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  expect(await recipient.locator("#tape-link").inputValue()).not.toBe(url);
  await recipient.goto(url); await recipient.getByRole("button", { name: "Flip to side B" }).click();
  await expect(recipient.locator("#tape-label-art img")).toHaveAttribute("src", ghost);
  expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await recipient.screenshot({ path: "artifacts/mixtape-labels-mobile.png", fullPage: true });
  await context.close();
});

test("pre-draw fills only blank labels, and handwriting can be undone independently per side", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/new");
  const draft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("yehry3:mixtape:v1")));
  const preDraw = page.getByRole("button", { name: "Pre-draw Side A & B" });
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await drawLabel(page, "b");
  const before = (await draft()).labels.b.ink;
  await preDraw.click();
  const labels = (await draft()).labels;
  expect(labels.a.ink.length).toBeGreaterThan(3);
  expect(labels.b.ink).toEqual(before);
  await expect(page.locator("#tape-label-ink")).toBeVisible();
  await expect(preDraw).toBeDisabled();
  await page.locator('[data-label-editor="a"] [data-ink-clear]').click();
  await expect(preDraw).toBeEnabled();
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await drawLabel(page, "a");
  await page.locator('[data-label-editor="a"] [data-ink-undo]').click();
  expect((await draft()).labels.a.ink).toHaveLength(0);
  await page.getByRole("button", { name: "Flip to side B" }).click();
  await expect(page.locator("#tape-label-ink")).toBeVisible();
  await page.locator('[data-label-editor="b"] [data-ink-clear]').click();
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await preDraw.click();
  await page.screenshot({ path: "artifacts/mixtape-predraw.png", fullPage: true });
});

test("a device that cannot draw shows plain Side A / Side B and still allows clipart", async ({ page }) => {
  await catalog(page);
  await page.addInitScript(() => { delete window.PointerEvent; });
  await page.goto("/mixtapes/new");
  await expect(page.locator("canvas.handwriting-pad")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pre-draw/ })).toHaveCount(0);
  await expect(page.locator(".tape-edit")).toContainText("can’t draw labels");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await expect(page.locator("#tape-title")).toHaveText("Side A");
  await clipart(page, "a", "a heart-eyed book");
  await expect(page.locator("#tape-label-art img")).toBeVisible();
  // A drawn tape made elsewhere reads as plain text here.
  const inked = { ...emptyTape(), a: ["tape-one"], b: ["tape-two"], labels: { a: { text: "", ink: [[[0, 0], [500, 120]]] }, b: { text: "", ink: [[[0, 0], [500, 120]]] } } };
  await page.goto(`/mixtapes/#tape=${encodeTape(inked)}`);
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await expect(page.locator("#tape-title")).toHaveText("Side A");
  await page.getByRole("button", { name: "Flip to side B" }).click();
  await expect(page.locator("#tape-title")).toHaveText("Side B");
});

test("the Mixtapes page opens on the gallery, with an empty state and a New button", async ({ page }) => {
  await page.route(/\/yehry3\/mixtapes\?page=\d+$/, route => route.fulfill({ json: { mixtapes: [], page: 0, hasMore: false } }));
  await catalog(page);
  await page.goto("/mixtapes/");
  await expect(page.getByRole("heading", { name: "Mixtapes", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No mixtapes yet." })).toBeVisible();
  await expect(page.locator(".tape-cards")).toBeHidden();
  await expect(page.getByRole("link", { name: /^New mixtape/ }).first()).toBeVisible();
  await expect(page.locator(".tape-edit")).toHaveCount(0);
  await page.getByRole("link", { name: /^New mixtape/ }).click();
  await expect(page).toHaveURL(/\/mixtapes\/new$/);
  // New is an empty tape: no songs, no name, no drawing, no clipart.
  await expect(page.getByLabel("Mixtape name", { exact: true })).toHaveValue("");
  await expect(page.locator(".tape-track")).toHaveCount(0);
  await expect(page.locator("#tape-label-ink")).toBeHidden();
  await expect(page.locator("#tape-label-art")).toBeHidden();
  await expect(page.locator('[data-art-side="a"] [data-art-preview]')).toContainText("No clipart yet");
  await expect(page.getByRole("button", { name: "Remove Side A clipart" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish mixtape" })).toBeDisabled();
});

test("gallery cards show every published tape, page through them, and New discards an old draft", async ({ page }) => {
  const tape = name => ({ v: 2, name, color: "green", a: ["tape-one"], b: ["tape-two", "tape-one"],
    labels: { a: { text: "", ink: [[[0, 0], [300, 100], [600, 20]]], art: { seed: 12345, theme: "ghost" } }, b: { text: "", ink: [] } } });
  const ids = Array.from({ length: 13 }, (_, i) => `tape${String(i).padStart(8, "0")}`);
  await page.route(/\/yehry3\/mixtapes\?page=\d+$/, route => {
    const index = Number(new URL(route.request().url()).searchParams.get("page"));
    const slice = ids.slice(index * 12, index * 12 + 12).map((id, i) => ({ id, createdAt: "2026-09-20T12:00:00.000Z", tape: tape(`Tape ${index * 12 + i}`) }));
    route.fulfill({ json: { mixtapes: slice, page: index, hasMore: index === 0 } });
  });
  await catalog(page);
  await page.goto("/mixtapes/new");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.goto("/mixtapes/");
  await expect(page.locator(".tape-card")).toHaveCount(12);
  const first = page.getByRole("link", { name: "Tape 0, 3 tracks" });
  await expect(first).toHaveAttribute("href", `/mixtapes/${ids[0]}`);
  await expect(first).toContainText("Sep");
  // Side A is drawn with clipart; side B has nothing drawn, so it reads "Side B".
  await expect(first.locator('[data-face="a"] canvas')).toBeVisible();
  await expect(first.locator('[data-face="a"] img')).toBeVisible();
  await expect(first.locator('[data-face="b"] em')).toHaveText("Side B");
  await expect(first.locator("canvas").first()).toHaveJSProperty("width", 1000);
  await page.getByRole("button", { name: "Show more tapes" }).click();
  await expect(page.locator(".tape-card")).toHaveCount(13);
  await expect(page.getByRole("button", { name: "Show more tapes" })).toBeHidden();
  await page.screenshot({ path: "artifacts/mixtape-gallery.png", fullPage: true });
  await page.getByRole("link", { name: /^New mixtape/ }).click();
  await expect(page.locator(".tape-track")).toHaveCount(0);
});

test("the gallery reports a load failure and retries", async ({ page }) => {
  await catalog(page);
  let fail = true;
  await page.route(/\/yehry3\/mixtapes\?page=\d+$/, route => fail
    ? route.fulfill({ status: 503, json: { error: "The studio is temporarily unavailable." } })
    : route.fulfill({ json: { mixtapes: [], page: 0, hasMore: false } }));
  await page.goto("/mixtapes/");
  await expect(page.getByRole("heading", { name: "The gallery could not load." })).toBeVisible();
  await expect(page.getByRole("link", { name: /^New mixtape/ })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No mixtapes yet." })).toBeVisible();
});

test("old links and typed labels still open, but clipart must be a bounded picture", async ({ page }) => {
  await catalog(page);
  const legacy = Buffer.from(JSON.stringify({ v: 1, name: "A legacy tape", color: "blue", a: ["tape-one"], b: [] })).toString("base64url");
  await page.goto(`/mixtapes/#tape=${legacy}`);
  await expect(page.locator("#tape-collection-name")).toHaveText("A legacy tape");
  await expect(page.locator("#tape-title")).toHaveText("Side A");
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  const typed = { ...emptyTape(), a: ["tape-one"], labels: { a: { text: "Old typed label", ink: [] }, b: { text: "", ink: [] } } };
  await page.goto(`/mixtapes/#tape=${encodeTape(typed)}`);
  await expect(page.locator("#tape-title")).toHaveText("Old typed label");
  const hostile = Buffer.from(JSON.stringify({ ...typed, v: 2, labels: { a: { text: "", ink: [], art: { seed: 1, src: "javascript:alert(1)" } }, b: { text: "", ink: [] } } })).toString("base64url");
  await page.goto(`/mixtapes/#tape=${hostile}`);
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
});

test("publish and read failures preserve the local draft and offer a retry", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/new");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.route("**/yehry3/mixtapes", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "The studio is temporarily unavailable." } }) : route.continue());
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-status")).toContainText("Your selection is still here");
  await expect(page.locator("#tape-link")).toBeHidden();
  const draft = await page.evaluate(() => sessionStorage.getItem("yehry3:mixtape:v1"));
  await page.unroute("**/yehry3/mixtapes");
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  const url = await page.locator("#tape-link").inputValue();
  await page.route("**/yehry3/mixtapes/*", route => route.fulfill({ status: 503, json: { error: "The studio is temporarily unavailable." } }));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("yehry3:mixtape:v1"))).toBe(draft);
  await page.unroute("**/yehry3/mixtapes/*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#tape-collection-name")).toHaveText("My Tony C mixtape");
  await page.goto("/mixtapes/abcdefghijkl");
  await expect(page.getByRole("heading", { name: "This mixtape could not open." })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("yehry3:mixtape:v1"))).toBe(draft);
});

test("editing during a slow publish never copies a stale version", async ({ page }) => {
  await catalog(page); await page.goto("/mixtapes/new");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  let release;
  await page.route("**/yehry3/mixtapes", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise(resolve => { release = resolve; });
    await route.continue();
  });
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#share-tape")).toHaveAttribute("aria-busy", "true");
  await clipart(page, "a", "a robot");
  await expect.poll(() => Boolean(release)).toBe(true); release();
  await expect(page.locator("#tape-status")).toContainText("Your tape changed");
  await expect(page.locator("#tape-link")).toBeHidden();
  await page.unroute("**/yehry3/mixtapes");
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/\/mixtapes\/[A-Za-z0-9_-]{12}$/);
  await page.goto(await page.locator("#tape-link").inputValue());
  await expect(page.locator("#tape-label-art img")).toHaveAttribute("alt", /^Side A clipart\./);
});

test("the editor and record shelf follow Dark Mode instead of staying cream", async ({ page }) => {
  await catalog(page);
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await page.goto("/mixtapes/new");
  const luminance = async selector => page.locator(selector).first().evaluate(node => {
    const [r, g, b] = getComputedStyle(node).backgroundColor.match(/\d+/g).map(Number);
    return (r + g + b) / 3;
  });
  for (const selector of [".tape-edit", ".tape-picker", ".side-heading"]) expect(await luminance(selector), selector).toBeLessThan(90);
});

test("Authored by fills in from the remembered name, is published with the tape and shows in the gallery and on the tape", async ({ page, browser }) => {
  await catalog(page);
  const published = [];
  await page.route(/\/yehry3\/mixtapes$/, route => {
    if (route.request().method() !== "POST") return route.fallback();
    published.push(route.request().postDataJSON().tape);
    return route.fulfill({ json: { id: "authored0001", tape: published.at(-1) } });
  });
  await page.route(/\/yehry3\/mixtapes\/authored0001$/, route => route.fulfill({ json: { id: "authored0001", tape: published[0] } }));
  await page.route(/\/yehry3\/mixtapes\?page=\d+$/, route => route.fulfill({ json: { mixtapes: published.map(tape => ({ id: "authored0001", tape, createdAt: "2026-09-20T12:00:00.000Z" })), page: 0, hasMore: false } }));
  await page.goto("/mixtapes/new");
  const author = page.getByLabel("Authored by");
  await expect(author).toHaveValue("");
  await page.evaluate(() => localStorage.setItem("yehry3:authored-by", "Remembered Rae"));
  // A fresh tape starts with the name used on a song request; it is a real, editable field.
  await page.goto("/mixtapes/");
  await page.getByRole("link", { name: /^New mixtape/ }).first().click();
  await expect(author).toHaveValue("Remembered Rae");
  await author.fill("  Original Olly  ");
  expect(await page.evaluate(() => localStorage.getItem("yehry3:authored-by"))).toBe("  Original Olly  ");
  await page.reload();
  await expect(author).toHaveValue("Original Olly");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(page.locator("#tape-link")).toHaveValue(/authored0001$/);
  expect(published[0].authoredBy).toBe("Original Olly");
  // The gallery card and the tape's own page both say who authored it.
  await page.goto("/mixtapes/");
  const card = page.locator(".tape-card").first();
  await expect(card.locator(".authored-by")).toHaveText("Authored by Original Olly");
  await expect(card).toHaveAttribute("aria-label", /authored by Original Olly/);
  // Someone else opens it, sees the byline, and their own copy carries their name instead.
  const viewer = await browser.newContext(); const tab = await viewer.newPage(); await catalog(tab);
  await tab.route(/\/yehry3\/mixtapes\/authored0001$/, route => route.fulfill({ json: { id: "authored0001", tape: published[0] } }));
  await tab.route(/\/yehry3\/mixtapes$/, route => {
    if (route.request().method() !== "POST") return route.fallback();
    published.push(route.request().postDataJSON().tape);
    return route.fulfill({ json: { id: "authored0002", tape: published.at(-1) } });
  });
  await tab.goto("/mixtapes/authored0001");
  await expect(tab.locator(".tape-intro .authored-by")).toHaveText("Authored by Original Olly");
  await tab.evaluate(() => localStorage.setItem("yehry3:authored-by", "Viewer Val"));
  await tab.getByRole("button", { name: "Make your own version" }).click();
  await expect(tab).toHaveURL(/\/mixtapes\/new$/);
  await expect(tab.getByLabel("Authored by")).toHaveValue("Viewer Val");
  // Clearing it clears it for next time, and the tape is published without a name.
  await tab.getByLabel("Authored by").fill("");
  expect(await tab.evaluate(() => localStorage.getItem("yehry3:authored-by"))).toBeNull();
  await tab.getByRole("button", { name: "Publish mixtape" }).click();
  await expect(tab.locator("#tape-link")).toHaveValue(/authored0002$/);
  expect("authoredBy" in published.at(-1)).toBe(false);
  await viewer.close();
});

test("Authored by stays usable on a phone and when browser storage is unavailable", async ({ page }) => {
  await catalog(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  await page.goto("/mixtapes/new");
  const author = page.getByLabel("Authored by");
  await expect(author).toBeVisible();
  await expect(page.locator("#authored-by-help")).toBeVisible();
  await author.fill("No storage Nat");
  await expect(author).toHaveValue("No storage Nat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("clipart fills the whole label rectangle in the editor, the deck and the gallery", async ({ page }) => {
  await catalog(page);
  const tape = { v: 2, name: "Wide art", color: "green", a: ["tape-one"], b: [], labels: { a: { text: "", ink: [], art: { seed: 12345, theme: "ghost" } }, b: { text: "", ink: [] } } };
  await page.route(/\/yehry3\/mixtapes\?page=\d+$/, route => route.fulfill({ json: { mixtapes: [{ id: "wideart00001", tape, createdAt: "2026-09-20T12:00:00.000Z" }], page: 0, hasMore: false } }));
  const fills = async (outer, inner) => {
    const [o, i] = [await outer.boundingBox(), await inner.boundingBox()];
    expect(Math.abs(o.width - i.width), "width").toBeLessThan(3); expect(Math.abs(o.height - i.height), "height").toBeLessThan(3);
    expect(Math.abs(i.width / i.height - 1000 / 240), "aspect").toBeLessThan(.08);
  };
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/mixtapes/new");
    await page.getByRole("button", { name: "Add First record to side A" }).click();
    await page.locator('[data-art-side="a"] [data-art-words]').fill("a robot in sunglasses");
    await expect(page.locator(".cassette-face")).toHaveClass(/has-art/);
    await fills(page.locator(".cassette-face"), page.locator(".cassette-art img"));
    const preview = await page.locator('[data-art-side="a"] [data-art-preview] img').boundingBox();
    expect(Math.abs(preview.width / preview.height - 1000 / 240)).toBeLessThan(.08);
    expect(await page.locator(".cassette-art img").getAttribute("src")).toContain("viewBox%3D%220%200%201000%20240%22");
    await page.goto("/mixtapes/");
    await fills(page.locator('.tape-card-side[data-face="a"]'), page.locator('.tape-card-side[data-face="a"] img'));
  }
  await page.goto("/mixtapes/new");
  await page.getByRole("button", { name: "Add First record to side A" }).click();
  await page.locator('[data-art-side="a"] [data-art-words]').fill("a ghost");
  await page.getByRole("button", { name: "Remove Side A clipart" }).click();
  await expect(page.locator(".cassette-face")).not.toHaveClass(/has-art/);
});
