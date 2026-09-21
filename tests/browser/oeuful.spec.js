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

  // Each turntable has a Side slider for how long its records may play. Changing one sends that
  // deck's cued records back and dresses it again, and leaves the other deck alone. Turntables
  // can be added, up to five, and any of them can be set to play whole songs. The booth remembers
  // all of it for the next visit.
  await expect(page.locator("#deck-a .deck-side output")).toHaveText("13 s");
  await page.locator("#deck-a .deck-side input").fill("5");
  await expect(page.locator("#deck-a .deck-side output")).toHaveText("30 s");
  await expect(page.locator("#deck-b .deck-side output")).toHaveText("13 s");
  await expect(page.locator("#deck-a")).toHaveAttribute("data-state", "cued");
  await expect(page.locator("#fewer")).toBeDisabled();
  await page.locator("#more").click();
  await expect(page.locator("#deck-c")).toHaveAttribute("data-state", "cued");
  await expect(page.locator("#tables-text")).toHaveText("3");
  await page.locator("#deck-c .deck-whole").click();
  await expect(page.locator("#deck-c .deck-side output")).toHaveText("Full");
  await expect(page.locator("#deck-c .deck-side input")).toBeDisabled();
  await expect(page.locator("#deck-c")).toHaveAttribute("data-state", "cued");
  await page.reload();
  await expect(page.locator("#deck-a .deck-side output")).toHaveText("30 s");
  await expect(page.locator("#deck-c .deck-whole")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#deck-c .deck-whole").click();
  await expect(page.locator("#deck-c .deck-side output")).toHaveText("13 s");
  await expect(page.locator("#deck-c")).toHaveAttribute("data-state", "cued");
  await page.locator("#more").click();
  await page.locator("#more").click();
  await expect(page.locator("#deck-e")).toHaveAttribute("data-state", "cued");
  await expect(page.locator("#more")).toBeDisabled();
  for (let count = 5; count > 2; count -= 1) await page.locator("#fewer").click();
  await expect(page.locator(".deck")).toHaveCount(2);
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
  await expect(page.locator("#tally")).toHaveText(/^[3-9] sides played$/, { timeout: 15000 });

  // With some overlap the next record comes in while the last is still singing, so two decks
  // play at once. Muting every deck silences them without stopping them.
  await page.locator("#overlap").fill("50");
  await expect(page.locator("#overlap-text")).toHaveText("50%");
  await page.waitForFunction(() => document.querySelectorAll('.deck[data-state="playing"]').length === 2);
  await page.locator("#overlap").fill("0");
  for (const name of ["a", "b"]) await page.locator("#deck-" + name + " .deck-mute").click();
  await expect(page.locator("#deck-a .deck-mute")).toHaveAttribute("aria-pressed", "true");
  await page.waitForFunction(() => {
    const sounding = window.oeufulSounds.filter((sound) => !sound.paused && !sound.muted);
    return sounding.length && sounding.every((sound) => sound.volume === 0);
  });
  for (const name of ["a", "b"]) await page.locator("#deck-" + name + " .deck-mute").click();
  await page.waitForFunction(() => window.oeufulSounds.some((sound) => !sound.paused && !sound.muted && sound.volume > 0.5));

  // Lifting the needle stops the sound, the gasp and the caption; dropping it picks the side back up.
  await start.click();
  await expect(page.locator("#booth")).toHaveAttribute("data-state", "idle");
  await expect(page.locator(".egg-caption")).toHaveCount(0);
  await expect(page.locator("#art")).not.toHaveClass(/egg-shock/);
  await expect(page.locator("#skip")).toBeDisabled();
  await start.click();
  await expect(page.locator("#booth")).toHaveAttribute("data-state", "playing");
});
