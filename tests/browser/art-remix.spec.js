import { test, expect } from "@playwright/test";

test("a listener previews a new picture, redraws hourly, and can read back the prompt", async ({ page }) => {
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
    // Chairlift starts over on a seed and layers without one.
    song.artRemix = body.remix.seed === undefined ? { ...song.artRemix, ...body.remix } : body.remix;
    Object.assign(song.feedback, { artRemixed: true, artPrompt: body.prompt, artRedrawAt: new Date(Date.now() + 3600000).toISOString() });
    await route.fulfill({ json: { artRemix: song.artRemix, feedback: song.feedback } });
  });

  await page.goto("/");
  const art = page.locator('[data-id="alpha"] .track-art'), trigger = page.locator('[data-id="alpha"] [data-art]');
  await expect(trigger).toHaveText("🎨 Redraw");
  const before = await art.getAttribute("src");
  await trigger.click();
  const dialog = page.locator("dialog.art-remix"), use = dialog.getByRole("button", { name: "Use this redraw" });
  const prompt = dialog.getByLabel("What should it be?"), next = dialog.locator("[data-art-next]"), another = dialog.getByRole("button", { name: "Another take" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("New picture")).toBeChecked();
  await expect(dialog.locator("[data-art-now]")).toHaveAttribute("src", before);
  await expect(next).toHaveAttribute("src", before);
  await expect(use).toBeDisabled();
  await expect(another).toBeDisabled();

  // Typing only previews. Nothing is sent until the listener chooses the redraw.
  await prompt.fill("a robot in sunglasses, blue");
  await expect(dialog.locator(".art-remix-result")).toHaveText("A new picture with: robot, sunglasses, blue.");
  await expect(next).not.toHaveAttribute("src", before);
  await expect(next).toHaveAttribute("alt", /robot/);
  const firstTake = await next.getAttribute("src");
  await another.click();
  await expect(next).not.toHaveAttribute("src", firstTake);
  await expect(next).toHaveAttribute("alt", /robot/);
  await prompt.fill("qwertyuiop");
  await expect(dialog.locator(".art-remix-result")).toHaveText(/^A new picture from your words\./);
  await expect(use).toBeEnabled();
  await dialog.getByLabel("Change this one").check();
  await expect(dialog.locator(".art-remix-result")).toHaveText(/^No words I know there, so the dice picked: /);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);

  // A refusal stays in the dialog, and the go is not spent.
  await trigger.click();
  await expect(dialog.getByLabel("New picture")).toBeChecked();
  await prompt.fill("a robot in sunglasses, blue");
  await use.click();
  await expect(dialog.locator(".art-remix-result")).toHaveText("Too many redraws. Try again later.");
  await expect(dialog).toBeVisible();
  await expect(another).toBeEnabled();
  refuse = false;
  await use.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#message")).toHaveText("Clip art redrawn for everyone.");
  expect(writes.at(-1)).toEqual({ remix: { seed: expect.any(Number), theme: "robot", extra: 3, palette: 3 }, prompt: "a robot in sunglasses, blue" });
  await expect(art).not.toHaveAttribute("src", before);
  await expect(art).toHaveAttribute("data-art-remixed", "");
  await expect(art).toHaveAttribute("alt", /robot.*redrawn by listeners/);

  // While it rests, the button shows the prompt on hover and says it on a tap.
  await expect(trigger).toHaveText("🎨 Redrawn");
  await expect(trigger).toHaveAttribute("aria-disabled", "true");
  await expect(trigger).toHaveAttribute("title", /^You redrew this with “a robot in sunglasses, blue”\. You can redraw it again at \d/);
  const sent = writes.length;
  // Playwright will not click an aria-disabled button on its own; a finger can.
  await trigger.click({ force: true });
  await expect(dialog).toBeHidden();
  await expect(page.locator("#message")).toHaveText(/^You redrew this with “a robot in sunglasses, blue”/);
  expect(writes.length).toBe(sent);
  await expect(page.locator('[data-id="bravo"] [data-art]')).toHaveText("🎨 Redraw");
  await expect(page.locator('[data-id="bravo"] .track-art')).not.toHaveAttribute("data-art-remixed", "");

  // An hour on, Chairlift lets this browser go again; a change layers on the robot.
  Object.assign(songs[0].feedback, { artRemixed: false, artRedrawAt: undefined });
  await page.reload();
  await expect(trigger).toHaveText("🎨 Redraw");
  await expect(trigger).toHaveAttribute("title", "Your last redraw was with “a robot in sunglasses, blue”.");
  const robot = await art.getAttribute("src");
  await trigger.click();
  await dialog.getByLabel("Change this one").check();
  await prompt.fill("pink");
  await expect(dialog.locator(".art-remix-result")).toHaveText("Understood: pink.");
  await expect(another).toBeDisabled();
  await use.click();
  await expect(dialog).toBeHidden();
  expect(Object.keys(writes.at(-1).remix)).toEqual(["palette"]);
  expect(writes.at(-1).prompt).toBe("pink");
  await expect(art).not.toHaveAttribute("src", robot);
  await expect(art).toHaveAttribute("alt", /robot/);
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
  await dialog.getByLabel("Change this one").check();
  await dialog.getByLabel("What should it be?").fill("empty hands");
  await expect(dialog.locator(".art-remix-result")).toContainText("Award art keeps its own colors");
  await expect(dialog.getByRole("button", { name: "Use this redraw" })).toBeDisabled();
  expect(await dialog.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(32, 43, 35)");
});
