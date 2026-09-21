import { test, expect } from "@playwright/test";

// The booth gets a crate of two short local recordings, so the hand-over between decks can be
// watched without the network. With two songs, each rests one turn, so they alternate.
const clip = (id, title, url, words) => ({ id, title, url, publishedAt: null, lines: [[0.1, 1.3, words]], moments: [[0, 0]] });
const clips = [
  clip("crash", "One Loud Crash", "/assets/sounds/one-loud-crash.mp3", "One loud crash"),
  clip("again", "Nine-Eleven'd Again", "/assets/sounds/nine-elevend-again.mp3", "Nine-eleven'd again"),
];

test("Œuful plays sung moments back to back across two decks", async ({ page }) => {
  // The booth keeps its sounds to itself, so the page is asked to remember each one it makes.
  await page.addInitScript(() => {
    const Made = window.Audio;
    window.oeufulSounds = [];
    window.Audio = function Audio(...given) {
      const made = new Made(...given);
      window.oeufulSounds.push(made);
      return made;
    };
  });
  await page.route("**/egg-clips.json", (route) => route.fulfill({ json: { clips } }));
  await page.route("**/songs/summary", (route) => route.fulfill({ json: { songs: [] } }));
  await page.goto("/oeuful");
  await expect(page).toHaveURL(/\/oeuful\/$/);
  const start = page.locator("#start");
  await expect(start).toBeEnabled();
  // The booth opens dressed: a record cued on each deck, and nothing sounding yet.
  await expect(page.locator("#deck-a")).toHaveAttribute("data-state", "cued");
  await expect(page.locator("#deck-b")).toHaveAttribute("data-state", "cued");
  await expect(page.locator(".egg-caption")).toHaveCount(0);

  // The Side slider sets how long a record may play. Changing it sends the cued records back
  // and dresses the decks again, and the booth remembers the length for the next visit.
  await expect(page.locator("#length-text")).toHaveText("13 s");
  await page.locator("#length").fill("5");
  await expect(page.locator("#length-text")).toHaveText("30 s");
  await expect(page.locator("#deck-a")).toHaveAttribute("data-state", "cued");
  await expect(page.locator("#deck-b")).toHaveAttribute("data-state", "cued");
  await page.reload();
  await expect(page.locator("#length-text")).toHaveText("30 s");
  await expect(start).toBeEnabled();
  await expect(page.locator("#deck-b")).toHaveAttribute("data-state", "cued");

  await start.click();
  await expect(page.locator("#deck-a")).toHaveAttribute("data-state", "playing");
  await expect(page.locator("#art")).toHaveClass(/egg-shock/);
  const first = await page.locator(".egg-caption-title").textContent();
  await expect(page.locator(".egg-caption-words")).not.toBeEmpty();

  // The side ends and deck B comes in over it with the other song: for a moment both records
  // sound, the old one turning down as it goes. Then A again, without being asked.
  await expect(page.locator("#mixer")).toHaveAttribute("data-live", "B");
  await page.waitForFunction(() => {
    const sounding = window.oeufulSounds.filter((sound) => !sound.paused);
    return sounding.length === 2 && sounding.some((sound) => sound.volume < 0.8) && document.querySelector('#deck-a[data-state="leaving"]');
  });
  await expect(page.locator("#deck-b")).toHaveAttribute("data-state", "playing");
  await expect(page.locator(".egg-caption-title")).not.toHaveText(first);
  await expect(page.locator("#mixer")).toHaveAttribute("data-live", "A");
  await expect(page.locator("#tally")).toHaveText(/^[3-9] sides played$/);

  // Lifting the needle stops the sound, the gasp and the caption; dropping it picks the side back up.
  await start.click();
  await expect(page.locator("#booth")).toHaveAttribute("data-state", "idle");
  await expect(page.locator(".egg-caption")).toHaveCount(0);
  await expect(page.locator("#art")).not.toHaveClass(/egg-shock/);
  await expect(page.locator("#skip")).toBeDisabled();
  await start.click();
  await expect(page.locator("#booth")).toHaveAttribute("data-state", "playing");
});
