import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8")).songs;

async function adminLogin(page, path = "/admin/") {
  await page.goto(path);
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator(".stats")).toBeVisible();
}

test("every Backstage tile filters the queue in place and marks the current filter", async ({ page }) => {
  await adminLogin(page);
  const show = page.getByLabel("Show", { exact: true });
  await expect(page.locator('[data-status-tile="queued"]')).toHaveAttribute("aria-current", "true");
  for (const [status, name] of [["processing", "In the studio"], ["completed", "Ready to publish"], ["published", "Out in the world"], ["attention", "9/11'd Again"]]) {
    await page.locator(".stats").getByText(name, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`status=${status}`));
    await expect(show).toHaveValue(status);
    await expect(page.locator(`[data-status-tile="${status}"]`)).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[aria-current='true'][data-status-tile]")).toHaveCount(1);
  }
  await page.locator(".stats").getByText("Waiting in line", { exact: true }).click();
  expect(new URL(page.url()).searchParams.has("status")).toBe(false);
  await expect(show).toHaveValue("queued");
  // The link still works on its own, for a new tab or a reload.
  await page.goto("/admin/?status=processing");
  await expect(show).toHaveValue("processing");
  await expect(page.locator('[data-status-tile="processing"]')).toHaveAttribute("aria-current", "true");
});

test("Backstage archives a song out of the public site, keeps it findable, and restores it", async ({ page, context }) => {
  test.setTimeout(90000);
  const song = catalog[5];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await adminLogin(page);
  const row = page.locator(`.admin-song[data-song="${song.id}"]`);
  const publicRow = async (visitor) => {
    await visitor.goto(`/?q=${encodeURIComponent(song.title)}`);
    return visitor.locator(`.track[data-id="${song.id}"]`);
  };
  const visitor = await context.newPage();
  try {
    await expect(await publicRow(visitor)).toHaveCount(1);
    await page.locator(".admin-songs > summary").click();
    // Search covers the title and the ID; an unmatched search says so.
    await page.locator("#song-search").fill(song.id);
    await expect(row).toBeVisible();
    await expect(row).toContainText(song.title);
    await page.locator("#song-search").fill("no such song anywhere zzz");
    await expect(page.locator("#song-list")).toContainText("No songs match.");
    await page.locator("#song-search").fill(song.id);
    // Declining the confirmation changes nothing.
    page.once("dialog", (dialog) => dialog.dismiss());
    await row.getByRole("button", { name: /^Archive / }).click();
    await expect(row).not.toHaveClass(/archived/);
    page.once("dialog", (dialog) => { expect(dialog.message()).toContain(song.title); return dialog.accept(); });
    await row.getByRole("button", { name: /^Archive / }).click();
    await expect(page.locator("#message")).toContainText("Song archived");
    // It leaves the live view but shows under Archived and Both.
    await expect(row).toHaveCount(0);
    await page.locator("#song-view").selectOption("archived");
    await expect(row).toHaveClass(/archived/);
    await expect(row).toContainText("Archived");
    await expect(page.locator("#song-summary")).toContainText("1 archived");
    await page.locator("#song-view").selectOption("all");
    await expect(row).toBeVisible();
    // The public catalog, and its remembered fallback, no longer list it.
    await expect(await publicRow(visitor)).toHaveCount(0);
    await visitor.reload();
    await expect(visitor.locator(`.track[data-id="${song.id}"]`)).toHaveCount(0);
    // A queue refresh re-renders Backstage without losing the search or the list.
    await page.locator("#refresh").click();
    await expect(page.locator("#song-search")).toHaveValue(song.id);
    await expect(row).toBeVisible();
    await mkdir("artifacts", { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/admin-songs-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally {
    await page.locator("#song-view").selectOption("all");
    const restore = row.getByRole("button", { name: /^Restore / });
    if (await restore.count()) await restore.click();
  }
  await expect(page.locator("#message")).toContainText("Song restored");
  await page.locator("#song-view").selectOption("live");
  await expect(row).toBeVisible();
  await expect(await publicRow(visitor)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Now Playing shares a link that lands on the home page with that song selected", async ({ page, context }) => {
  test.skip(catalog.length < 30, "needs a second catalog page");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?page=2");
  await expect(page.locator("#share-song")).toBeHidden();
  const first = page.locator(".track [data-play]").first();
  const id = await first.getAttribute("data-play");
  await first.click();
  await expect(page.locator("#share-song")).toBeVisible();
  await page.locator("#share-song").click();
  await expect(page.locator("#message")).toContainText("copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(`http://127.0.0.1:8080/#${id}`);
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.locator(`.track[data-id="${id}"]`)).toHaveClass(/is-revealed/);
  await expect(guest).toHaveURL(/page=2/);
  // It does not start playing for the guest.
  expect(await guest.locator("#audio").evaluate((audio) => audio.paused)).toBe(true);
  // The mobile player keeps the button on its transport row without overflowing.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#share-song")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/share-player-mobile.png" });
  expect(errors).toEqual([]);
});

test("request form: sticky breadcrumb between Essentials and Advanced, and shortcuts into Advanced", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/distonyc/");
  await page.locator("#password").fill("wishbone");
  await page.locator("#login-form button").click();
  await page.locator("#idea").fill("Breadcrumb browser test: a lullaby for a haunted vending machine.");
  await page.locator("#idea-form button").click();
  await expect(page.locator("#voice-model")).toBeVisible();
  const essentials = page.locator("#essentials-panel"), advanced = page.locator("#advanced-panel");
  await expect(essentials.locator(".request-crumbs [aria-current]")).toHaveText("Essentials");
  await expect(essentials.locator(".request-shortcuts")).toContainText("Common things");
  // Lyrics & adaptions opens that Advanced section and brings its field into view.
  await essentials.getByRole("button", { name: "Lyrics & adaptions →" }).click();
  await expect(page.locator("#advanced-tab")).toHaveAttribute("aria-selected", "true");
  await expect(advanced).toBeVisible();
  await expect(page.locator(".request-materials")).toHaveJSProperty("open", true);
  await expect(page.locator("#lyric-sheet")).toBeInViewport();
  await expect(advanced.locator(".request-crumbs [aria-current]")).toHaveText("Advanced");
  // The breadcrumb stays pinned to the top while the panel scrolls.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const crumbs = advanced.locator(".request-crumbs");
  await expect(crumbs).toBeInViewport();
  expect(Math.round((await crumbs.boundingBox()).y)).toBeLessThanOrEqual(1);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/request-crumbs.png" });
  await crumbs.getByRole("button", { name: "Essentials" }).click();
  await expect(page.locator("#essentials-tab")).toHaveAttribute("aria-selected", "true");
  await expect(essentials).toBeVisible();
  await expect(advanced).toBeHidden();
  await expect(page.locator(".request-tabs")).toBeInViewport();
  await essentials.locator(".request-crumbs").getByRole("button", { name: "Advanced" }).click();
  await expect(advanced).toBeVisible();
  // Timing goes to its section, or to the generation switch that gates it.
  await page.locator("#essentials-tab").click();
  const timingLink = essentials.getByRole("button", { name: "Timing →" });
  const timing = advanced.locator("details.generation-group", { hasText: "Timing & key" });
  if (await timing.count()) {
    await timingLink.click();
    await expect(advanced).toBeVisible();
    if (await page.locator("#generation-fields").isVisible()) await expect(timing).toHaveJSProperty("open", true);
    else await expect(page.locator("#generation-enabled")).toBeFocused();
  } else await expect(timingLink).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Backstage says so, instead of erroring, when the studio API has no song archive yet", async ({ page, baseURL }) => {
  const headers = { "access-control-allow-origin": baseURL };
  await page.route("**/yehry3/admin/songs?**", (route) => route.request().method() === "OPTIONS"
    ? route.continue() : route.fulfill({ status: 404, headers, json: { error: "Endpoint not found." } }));
  await adminLogin(page);
  await page.locator(".admin-songs > summary").click();
  await expect(page.locator("#song-list")).toContainText("isn’t available from the studio API yet");
  await expect(page.locator(".stats")).toBeVisible();
  await expect(page.locator("#message")).toBeHidden();
});
