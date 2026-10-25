import { mockCatalogState } from "./helpers/catalog.js";
import { openSongMenu } from "./helpers/song-menu.js";
import { test, expect } from "@playwright/test";

test("only admins can pin or unpin songs from the overflow menu", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yehry3:catalog-view", "list");
    localStorage.setItem("yehry3:auth:admin", JSON.stringify({ token: null, password: "browser-test-admin" }));
  });
  const songs = ["alpha", "bravo", "charlie"].map((id, index) => ({
    id, title: id[0].toUpperCase() + id.slice(1), votes: 0, downvotes: 0, milquetoasts: 0,
    adminPinned: false, feedback: { downvoted: false, milquetoast: false }, duration: 60, order: index,
    collection: "distonyc", url: "/fixture.mp3",
  }));
  await mockCatalogState(page, () => songs);
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/admin/songs?*", route => route.fulfill({ json: { songs: [] } }));
  const writes = [];
  await page.route("**/yehry3/admin/song-pins/*", async route => {
    const id = route.request().url().split("/").pop();
    const { pinned } = route.request().postDataJSON();
    writes.push({ id, pinned, method: route.request().method() });
    songs.find(song => song.id === id).adminPinned = pinned;
    await route.fulfill({ json: { id, pinned, changed: true } });
  });
  await page.goto("/");
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await openSongMenu(page.locator('[data-id="charlie"]'));
  await expect(page.locator('[data-id="charlie"] [data-pin]')).toHaveText("📍 Pin");
  await page.locator('[data-id="charlie"] [data-pin]').click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await expect(page.locator('[data-id="charlie"] [data-pin]')).toHaveText("📌 Unpin");
  await expect(page.locator('[data-id="charlie"]')).toHaveClass(/pinned/);
  await page.reload();
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await openSongMenu(page.locator('[data-id="charlie"]'));
  await page.locator('[data-id="charlie"] [data-pin]').click();
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie"]);
  expect(writes).toEqual([
    { id: "charlie", pinned: true, method: "PATCH" },
    { id: "charlie", pinned: false, method: "PATCH" },
  ]);
});

test("visitors do not get a pin control in the song menu", async ({ page }) => {
  const songs = [{ id: "visitor-song", title: "Visitor Song", votes: 0, downvotes: 0, milquetoasts: 0, adminPinned: false, feedback: { downvoted: false, milquetoast: false }, duration: 60, order: 0, collection: "distonyc", url: "/fixture.mp3" }];
  await mockCatalogState(page, () => songs);
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto("/");
  await openSongMenu(page.locator('[data-id="visitor-song"]'));
  await expect(page.locator('[data-id="visitor-song"] [data-pin]')).toHaveCount(0);
});

test("a vote swaps the regular clip art for that tier's award art without a prompt", async ({ page }) => {
  const songs = [0, 1, 2, 4, 6].map((votes, index) => ({
    id: "song-" + index, title: "Song " + index, votes, downvotes: 0, milquetoasts: 0, pins: 0,
    feedback: { downvoted: false, milquetoast: false, pinned: false }, duration: 60, order: index,
    collection: "distonyc", url: "/fixture.mp3",
  }));
  await mockCatalogState(page, () => songs);
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/votes", async route => {
    songs.find(song => song.id === route.request().postDataJSON().songId).votes++;
    await route.fulfill({ json: { nextVoteAt: null } });
  });
  let dialogs = 0;
  page.on("dialog", dialog => { dialogs++; return dialog.dismiss(); });

  await page.goto("/?sort=title");
  const tier = id => page.locator('[data-id="' + id + '"] .track-art').getAttribute("data-art-tier");
  await expect(page.locator(".track-art")).toHaveCount(5);
  expect(await Promise.all(songs.map(song => tier(song.id)))).toEqual([null, "1", "1", "3", "5"]);
  const before = await page.locator('[data-id="song-4"] .track-art').getAttribute("src");
  await page.locator('[data-id="song-4"] [data-vote]').click();
  await expect(page.locator('[data-id="song-4"] .track-art')).toHaveAttribute("data-art-tier", "7");
  const art = page.locator('[data-id="song-4"] .track-art');
  expect(await art.getAttribute("src")).not.toBe(before);
  await expect.poll(() => art.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(dialogs).toBe(0);
});
