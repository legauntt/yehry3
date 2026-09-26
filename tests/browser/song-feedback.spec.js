import { openSongMenu } from "./helpers/song-menu.js";
import { test, expect } from "@playwright/test";

test("shared pins stay above the catalog and downvote/milquetoast remain distinct", async ({ page }) => {
  const songs = ["alpha", "bravo", "charlie"].map((id, index) => ({
    id, title: id[0].toUpperCase() + id.slice(1), votes: 0, downvotes: 0, milquetoasts: 0, pins: 0,
    feedback: { downvoted: false, milquetoast: false, pinned: false }, duration: 60, order: index,
    collection: "distonyc", url: "/fixture.mp3",
  }));
  const queue = { inStudio: [{ id: "pending", idea: "Pending idea", title: null, status: "processing" }], queued: [], recent: [] };
  const writes = [];
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.route("**/yehry3/song-feedback", async route => {
    const { songId, kind } = route.request().postDataJSON();
    writes.push(kind);
    const song = songs.find(item => item.id === songId);
    if (kind === "downvote") { song.downvotes = 1; song.feedback.downvoted = true; }
    if (kind === "milquetoast") { song.milquetoasts = 1; song.downvotes = 1; song.feedback.downvoted = true; song.feedback.milquetoast = true; }
    await route.fulfill({ json: { changed: true } });
  });
  await page.route("**/yehry3/song-pins/*", async route => {
    const id = route.request().url().split("/").pop();
    const { pinned } = route.request().postDataJSON();
    writes.push(pinned ? "pin" : "unpin");
    const song = songs.find(item => item.id === id);
    if (song.feedback.pinned !== pinned) song.pins += pinned ? 1 : -1;
    song.feedback.pinned = pinned;
    await route.fulfill({ json: { pinned, pins: song.pins } });
  });
  // Each action asks first. Record the wording and answer as the step requires.
  const prompts = [];
  let accept = false;
  page.on("dialog", dialog => {
    prompts.push(dialog.type() + ": " + dialog.message());
    return accept ? dialog.accept() : dialog.dismiss();
  });

  await page.goto("/");
  await expect(page.locator("#pending-tracks")).toBeVisible();
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Declining leaves every song untouched and sends nothing.
  await openSongMenu(page.locator('[data-id="charlie"]'));
  await page.locator('[data-id="charlie"] [data-pin]').click();
  await openSongMenu(page.locator('[data-id="alpha"]'));
  await page.locator('[data-id="alpha"] [data-feedback="downvote"]').click();
  await openSongMenu(page.locator('[data-id="bravo"]'));
  await page.locator('[data-id="bravo"] [data-feedback="milquetoast"]').click();
  expect(prompts).toEqual([
    "confirm: Pin “Charlie” to the top for everyone?",
    "confirm: Downvote “Alpha”? This cannot be undone.",
    "confirm: Mark “Bravo” as milquetoast? It also counts as a downvote, tells the song agent to avoid this pattern, and cannot be undone.",
  ]);
  expect(writes).toEqual([]);
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await expect(page.locator('[data-id="alpha"] [data-feedback="downvote"]')).toHaveText("Downvote");
  await expect(page.locator('[data-id="bravo"] [data-feedback="milquetoast"]')).toHaveText("Milquetoast");
  await expect(page.locator('[data-id="charlie"] [data-pin]')).toBeEnabled();

  accept = true;
  await openSongMenu(page.locator('[data-id="charlie"]'));
  await page.locator('[data-id="charlie"] [data-pin]').click();
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await expect(page.locator('[data-id="charlie"] [data-pin]')).toContainText("Pinned · 1");
  await expect(page.locator('[data-id="charlie"]')).toHaveCSS("border-top-width", "5px");
  await expect(page.locator('[data-id="charlie"]')).toHaveCSS("border-top-color", "rgb(212, 160, 23)");
  await expect(page.locator('[data-id="alpha"]')).not.toHaveClass(/pinned/);
  expect(await page.evaluate(() => localStorage.getItem("yehry3:pinned-songs"))).toBeNull();
  await page.reload();
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);

  // Removing a pin asks too, and declining keeps it.
  accept = false;
  await openSongMenu(page.locator('[data-id="charlie"]'));
  await page.locator('[data-id="charlie"] [data-pin]').click();
  expect(prompts.at(-1)).toBe("confirm: Remove your shared pin from “Charlie”?");
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  accept = true;
  await openSongMenu(page.locator('[data-id="charlie"]'));
  await page.locator('[data-id="charlie"] [data-pin]').click();
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie"]);

  await openSongMenu(page.locator('[data-id="alpha"]'));
  await page.locator('[data-id="alpha"] [data-feedback="downvote"]').click();
  await expect(page.locator('[data-id="alpha"] [data-feedback="downvote"]')).toContainText("Downvoted");
  await expect(page.locator('[data-id="alpha"] [data-feedback="milquetoast"]')).toBeEnabled();
  await openSongMenu(page.locator('[data-id="bravo"]'));
  await page.locator('[data-id="bravo"] [data-feedback="milquetoast"]').click();
  await expect(page.locator('[data-id="bravo"] [data-feedback="milquetoast"]')).toContainText("Sent to agent");
  expect(writes).toEqual(["pin", "unpin", "downvote", "milquetoast"]);
  expect(await page.locator("#pending-tracks").evaluate(node => node.compareDocumentPosition(document.querySelector("#tracks")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
});

test("a vote swaps the regular clip art for that tier's award art without a prompt", async ({ page }) => {
  const songs = [0, 1, 2, 4, 6].map((votes, index) => ({
    id: "song-" + index, title: "Song " + index, votes, downvotes: 0, milquetoasts: 0, pins: 0,
    feedback: { downvoted: false, milquetoast: false, pinned: false }, duration: 60, order: index,
    collection: "distonyc", url: "/fixture.mp3",
  }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
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
