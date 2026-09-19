import { test, expect } from "@playwright/test";

test("pins stay above the catalog and downvote/milquetoast remain distinct", async ({ page }) => {
  const songs = ["alpha", "bravo", "charlie"].map((id, index) => ({
    id, title: id[0].toUpperCase() + id.slice(1), votes: 0, downvotes: 0, milquetoasts: 0,
    feedback: { downvoted: false, milquetoast: false }, duration: 60, order: index,
    collection: "distonyc", url: "/fixture.mp3",
  }));
  const queue = { inStudio: [{ id: "pending", idea: "Pending idea", title: null, status: "processing" }], queued: [], recent: [] };
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.route("**/yehry3/song-feedback", async route => {
    const { songId, kind } = route.request().postDataJSON();
    const song = songs.find(item => item.id === songId);
    if (kind === "downvote") { song.downvotes = 1; song.feedback.downvoted = true; }
    if (kind === "milquetoast") { song.milquetoasts = 1; song.downvotes = 1; song.feedback.downvoted = true; song.feedback.milquetoast = true; }
    await route.fulfill({ json: { changed: true } });
  });

  await page.goto("/");
  await expect(page.locator("#pending-tracks")).toBeVisible();
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie"]);
  await page.locator('[data-id="charlie"] [data-pin]').click();
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await page.reload();
  await expect(page.locator(".track h3")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await page.locator('[data-id="alpha"] [data-feedback="downvote"]').click();
  await expect(page.locator('[data-id="alpha"] [data-feedback="downvote"]')).toContainText("Downvoted");
  await expect(page.locator('[data-id="alpha"] [data-feedback="milquetoast"]')).toBeEnabled();
  await page.locator('[data-id="bravo"] [data-feedback="milquetoast"]').click();
  await expect(page.locator('[data-id="bravo"] [data-feedback="milquetoast"]')).toContainText("Sent to agent");
  expect(await page.locator("#pending-tracks").evaluate(node => node.compareDocumentPosition(document.querySelector("#tracks")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
});
