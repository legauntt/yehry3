import { test, expect } from "@playwright/test";

test("a listener previews and spends one shared clip art redraw per song", async ({ page }) => {
  const songs = ["alpha", "bravo"].map((id, index) => ({
    id, title: id[0].toUpperCase() + id.slice(1), votes: 0, downvotes: 0, milquetoasts: 0, pins: 0,
    feedback: { downvoted: false, milquetoast: false, pinned: false, artRemixed: false }, duration: 60, order: index,
    collection: "distonyc", url: "/fixture.mp3",
  }));
  const writes = [];
  let refuse = true;
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/song-art/*", async route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (refuse) return route.fulfill({ status: 429, json: { error: "Too many redraws. Try again later." } });
    const song = songs.find(item => item.id === route.request().url().split("/").pop());
    song.artRemix = { ...song.artRemix, ...body.remix };
    song.feedback.artRemixed = true;
    await route.fulfill({ json: { artRemix: song.artRemix } });
  });

  await page.goto("/");
  const art = page.locator('[data-id="alpha"] .track-art'), trigger = page.locator('[data-id="alpha"] [data-art]');
  await expect(trigger).toHaveText("🎨 Redraw");
  const before = await art.getAttribute("src");
  await trigger.click();
  const dialog = page.locator("dialog.art-remix"), use = dialog.getByRole("button", { name: "Use this redraw" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-art-now]")).toHaveAttribute("src", before);
  await expect(dialog.locator("[data-art-next]")).toHaveAttribute("src", before);
  await expect(use).toBeDisabled();

  // Typing only previews. Nothing is sent until the listener chooses the redraw.
  await dialog.getByLabel("What should change?").fill("a robot in sunglasses, blue");
  await expect(dialog.locator(".art-remix-result")).toHaveText("Understood: robot, sunglasses, blue.");
  await expect(dialog.locator("[data-art-next]")).not.toHaveAttribute("src", before);
  await expect(dialog.locator("[data-art-next]")).toHaveAttribute("alt", /robot/);
  await dialog.getByLabel("What should change?").fill("qwertyuiop");
  await expect(dialog.locator(".art-remix-result")).toHaveText(/^No words I know there, so the dice picked: /);
  await expect(use).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);

  // A refusal stays in the dialog, and the go is not spent.
  await trigger.click();
  await dialog.getByLabel("What should change?").fill("a robot in sunglasses, blue");
  await use.click();
  await expect(dialog.locator(".art-remix-result")).toHaveText("Too many redraws. Try again later.");
  await expect(dialog).toBeVisible();
  refuse = false;
  await use.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#message")).toHaveText("Clip art redrawn for everyone.");
  expect(writes.at(-1)).toEqual({ remix: { theme: "robot", extra: 3, palette: 3 } });
  await expect(art).not.toHaveAttribute("src", before);
  await expect(art).toHaveAttribute("data-art-remixed", "");
  await expect(art).toHaveAttribute("alt", /robot.*redrawn by listeners/);
  await expect(trigger).toHaveText("🎨 Redrawn");
  await expect(trigger).toBeDisabled();
  await expect(page.locator('[data-id="bravo"] [data-art]')).toBeEnabled();
  await expect(page.locator('[data-id="bravo"] .track-art')).not.toHaveAttribute("data-art-remixed", "");
});

test("the redraw dialog fits a phone and follows Dark Mode", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  const songs = [{ id: "alpha", title: "Alpha", votes: 3, feedback: {}, duration: 60, order: 0, collection: "distonyc", url: "/fixture.mp3" }];
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto("/");
  await page.locator('[data-id="alpha"] [data-art]').click();
  const dialog = page.locator("dialog.art-remix");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  // Award art owns its colors, so a color-only prompt is refused with the reason.
  await dialog.getByLabel("What should change?").fill("empty hands");
  await expect(dialog.locator(".art-remix-result")).toContainText("Award art keeps its own colors");
  await expect(dialog.getByRole("button", { name: "Use this redraw" })).toBeDisabled();
  expect(await dialog.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(32, 43, 35)");
});
