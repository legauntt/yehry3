import { test, expect } from "@playwright/test";

// Chairlift starts over on a seed and layers without one; the mock does the same.
function studio(page, songs, writes, state) {
  return Promise.all([
    page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } })),
    page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } })),
    page.route("**/yehry3/song-art/*", async route => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (state.refuse) return route.fulfill({ status: 429, json: { error: "Too many redraws. Try again later." } });
      const song = songs.find(item => item.id === route.request().url().split("/").pop());
      song.artRemix = body.remix.seed === undefined ? { ...song.artRemix, ...body.remix } : body.remix;
      Object.assign(song.feedback, { artRemixed: true, artPrompt: body.prompt, artRedrawAt: new Date(Date.now() + 3600000).toISOString() });
      await route.fulfill({ json: { artRemix: song.artRemix, feedback: song.feedback } });
    }),
  ]);
}
const fixtures = () => ["alpha", "bravo"].map((id, index) => ({
  id, title: id[0].toUpperCase() + id.slice(1), votes: 0, downvotes: 0, milquetoasts: 0, pins: 0,
  feedback: { downvoted: false, milquetoast: false, pinned: false, artRemixed: false }, duration: 60, order: index,
  collection: "distonyc", url: "/fixture.mp3",
}));

test("a listener pins traits, shuffles the rest, redraws hourly, and can read back the note", async ({ page }) => {
  const songs = fixtures(), writes = [], state = { refuse: true };
  await studio(page, songs, writes, state);
  await page.goto("/");
  const art = page.locator('[data-id="alpha"] .track-art'), trigger = page.locator('[data-id="alpha"] [data-art]');
  await expect(trigger).toHaveText("🎨 Redraw");
  const before = await art.getAttribute("src");
  await trigger.click();
  const dialog = page.locator("dialog.art-remix"), use = dialog.getByRole("button", { name: "Use this redraw" }), status = dialog.locator(".art-remix-result");
  const next = dialog.locator("[data-art-next]"), shuffle = dialog.getByRole("button", { name: "Shuffle the rest" }), reset = dialog.getByRole("button", { name: "Start over" });
  const character = dialog.locator('[data-trait="theme"]'), robot = character.locator('.art-chip[data-value="robot"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-art-now]")).toHaveAttribute("src", before);
  await expect(next).toHaveAttribute("src", before);
  await expect(use).toBeDisabled();
  await expect(reset).toBeDisabled();
  await expect(status).toHaveText(/^Pick a character, colors or a look/);
  // Every section says what the picture shows now and marks that chip.
  await expect(character.locator("legend")).toContainText("· now ");
  await expect(character.locator(".art-chip[data-current]")).toHaveCount(1);
  // Eyes are marked too, unless sunglasses hide them, and then the legend says so.
  await expect(dialog.locator('[data-trait="eyes"] legend')).toContainText(/· now (behind the sunglasses|[a-z, -]+)$/);

  // A pick pins a trait: the preview changes at once, and nothing is sent yet.
  await robot.click();
  await expect(robot).toHaveAttribute("aria-pressed", "true");
  await expect(next).not.toHaveAttribute("src", before);
  await expect(next).toHaveAttribute("alt", /robot/);
  await dialog.getByRole("button", { name: "blue", exact: true }).click();
  await dialog.locator('[data-trait="extra"] .art-chip', { hasText: "Sunglasses" }).click();
  await expect(status).toHaveText("Pinned: robot, blue, sunglasses.");
  await expect(use).toBeEnabled();
  const pinnedTake = await next.getAttribute("src");
  // The cast can be searched by name or alias; an unknown word shows everyone.
  const find = character.getByLabel("Find a character");
  await find.fill("bumblebee");
  await expect(character.locator(".art-chip:visible")).toHaveText(["bee"]);
  await find.fill("cat");
  await expect(character.locator(".art-remix-missing")).toHaveText("No “cat” in the cast, but here is everyone.");
  await expect(character.locator(".art-chip:visible")).toHaveCount(await character.locator(".art-chip").count());
  await find.fill("");
  // A shuffle rolls everything else under the pins, again differs, and Start over returns to the picture.
  await shuffle.click();
  await expect(status).toHaveText("Pinned: robot, blue, sunglasses. The rest is shuffled.");
  await expect(next).not.toHaveAttribute("src", pinnedTake);
  await expect(next).toHaveAttribute("alt", /robot/);
  const firstShuffle = await next.getAttribute("src");
  await shuffle.click();
  await expect(next).not.toHaveAttribute("src", firstShuffle);
  await reset.click();
  await expect(next).toHaveAttribute("src", before);
  await expect(use).toBeDisabled();
  // A second tap on a pinned chip unpins it.
  await robot.click();
  await expect(status).toHaveText("Pinned: robot.");
  await robot.click();
  await expect(status).toHaveText(/^Pick a character/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);

  // A refusal stays in the dialog, and the go is not spent.
  await trigger.click();
  await robot.click();
  await dialog.getByRole("button", { name: "blue", exact: true }).click();
  await dialog.locator('[data-trait="extra"] .art-chip', { hasText: "Sunglasses" }).click();
  await shuffle.click();
  await use.click();
  await expect(status).toHaveText("Too many redraws. Try again later.");
  await expect(dialog).toBeVisible();
  await expect(shuffle).toBeEnabled();
  state.refuse = false;
  await use.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#message")).toHaveText("Clip art redrawn for everyone.");
  expect(writes.at(-1)).toEqual({ remix: { seed: expect.any(Number), theme: "robot", palette: 3, extra: 3 }, prompt: "robot, blue, sunglasses, shuffled" });
  await expect(art).not.toHaveAttribute("src", before);
  await expect(art).toHaveAttribute("data-art-remixed", "");
  await expect(art).toHaveAttribute("alt", /robot.*redrawn by listeners/);

  // While it rests, the button shows the note on hover and says it on a tap.
  await expect(trigger).toHaveText("🎨 Redrawn");
  await expect(trigger).toHaveAttribute("aria-disabled", "true");
  await expect(trigger).toHaveAttribute("title", /^You redrew this with “robot, blue, sunglasses, shuffled”\. You can redraw it again at \d/);
  const sent = writes.length;
  // Playwright will not click an aria-disabled button on its own; a finger can.
  await trigger.click({ force: true });
  await expect(dialog).toBeHidden();
  await expect(page.locator("#message")).toHaveText(/^You redrew this with “robot, blue, sunglasses, shuffled”/);
  expect(writes.length).toBe(sent);
  await expect(page.locator('[data-id="bravo"] [data-art]')).toHaveText("🎨 Redraw");
  await expect(page.locator('[data-id="bravo"] .track-art')).not.toHaveAttribute("data-art-remixed", "");

  // An hour on, Chairlift lets this browser go again; a pick layers on the robot.
  Object.assign(songs[0].feedback, { artRemixed: false, artRedrawAt: undefined });
  await page.reload();
  await expect(trigger).toHaveText("🎨 Redraw");
  await expect(trigger).toHaveAttribute("title", "Your last redraw was with “robot, blue, sunglasses, shuffled”.");
  const robotTake = await art.getAttribute("src");
  await trigger.click();
  await expect(robot).toHaveAttribute("data-current", "");
  await expect(dialog.locator('[data-trait="palette"] legend')).toContainText("now blue");
  await dialog.getByRole("button", { name: "pink", exact: true }).click();
  await expect(status).toHaveText("Pinned: pink.");
  await use.click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toEqual({ remix: { palette: 4 }, prompt: "pink" });
  await expect(art).not.toHaveAttribute("src", robotTake);
  await expect(art).toHaveAttribute("alt", /robot/);
});

test("a listener draws on the picture, and the doodle travels as pen strokes", async ({ page }) => {
  const songs = fixtures(), writes = [], state = { refuse: false };
  await studio(page, songs, writes, state);
  await page.goto("/");
  const art = page.locator('[data-id="alpha"] .track-art'), trigger = page.locator('[data-id="alpha"] [data-art]');
  await trigger.click();
  const dialog = page.locator("dialog.art-remix"), use = dialog.getByRole("button", { name: "Use this redraw" }), status = dialog.locator(".art-remix-result");
  const next = dialog.locator("[data-art-next]"), draw = dialog.getByRole("button", { name: "Draw on it" }), pad = dialog.locator(".art-doodle-pad"), ink = dialog.locator("[data-doodle-ink]");
  await expect(dialog).toBeVisible();
  await expect(ink).toBeHidden();
  await draw.click();
  await expect(draw).toHaveAttribute("aria-pressed", "true");
  await expect(ink).toHaveText("Ink left: 100%");
  await dialog.getByRole("button", { name: "Rose" }).click();
  await dialog.getByRole("button", { name: "Thick" }).click();
  const box = await pad.boundingBox();
  const stroke = async () => {
    await page.mouse.move(box.x + box.width * .2, box.y + box.height * .3);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) await page.mouse.move(box.x + box.width * (.2 + step * .06), box.y + box.height * (.3 + Math.sin(step / 2) * .15));
    await page.mouse.up();
  };
  await stroke();
  await expect(status).toHaveText("With your doodle.");
  await expect(next).toHaveAttribute("alt", /with a listener's doodle/);
  await expect(ink).toHaveText(/^Ink left: 9\d%$/);
  await expect(use).toBeEnabled();
  // Undo takes the stroke back; a tap is a dot.
  await dialog.getByRole("button", { name: "Undo" }).click();
  await expect(status).toHaveText(/^Pick a character/);
  await expect(use).toBeDisabled();
  await stroke();
  await page.mouse.click(box.x + box.width * .8, box.y + box.height * .8);
  await use.click();
  await expect(dialog).toBeHidden();
  const sent = writes.at(-1);
  expect(sent.prompt).toBe("a doodle");
  expect(Object.keys(sent.remix)).toEqual(["doodle"]);
  expect(sent.remix.doodle).toMatch(/^4 2 \d+ \d+( -?\d+ -?\d+)+;4 2 \d+ \d+$/);
  await expect(art).toHaveAttribute("alt", /with a listener's doodle, redrawn by listeners/);

  // Next time, the doodle is there to keep drawing on, and Clear sends it away.
  Object.assign(songs[0].feedback, { artRemixed: false, artRedrawAt: undefined });
  await page.reload();
  await trigger.click();
  await expect(dialog.locator("[data-art-now]")).toHaveAttribute("alt", /doodle/);
  await draw.click();
  await expect(ink).toHaveText(/^Ink left: 9\d%$/);
  await dialog.getByRole("button", { name: "Clear" }).click();
  await expect(status).toHaveText("Doodle cleared.");
  await expect(next).not.toHaveAttribute("alt", /doodle/);
  await use.click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toEqual({ remix: { doodle: "" }, prompt: "doodle cleared" });
  await expect(art).not.toHaveAttribute("alt", /doodle/);
});

test("the redraw dialog fits a phone, follows Dark Mode, and offers award art only what it can change", async ({ page }) => {
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
  // Award art owns its mascots, stage, sprinkles and hands, so those rows are not offered.
  await expect(dialog.locator("[data-art-note]")).toHaveText("Award art keeps its mascots, stage, sprinkles and empty hands.");
  for (const trait of ["theme", "prop", "backdrop", "confetti"]) await expect(dialog.locator(`[data-trait="${trait}"]`)).toHaveCount(0);
  await expect(dialog.locator('[data-trait="palette"] .art-chip')).toHaveCount(2);
  await dialog.locator('[data-trait="mouth"] .art-chip:not([data-current])').first().click();
  await expect(dialog.locator(".art-remix-result")).toHaveText(/^Pinned: [a-z ]+\.$/);
  await expect(dialog.getByRole("button", { name: "Use this redraw" })).toBeEnabled();
  expect(await dialog.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(32, 43, 35)");
});
