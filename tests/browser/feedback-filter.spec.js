import { test, expect } from "@playwright/test";

const song = (id, title, order, extra = {}) => ({
  id, title, votes: 0, downvotes: 0, milquetoasts: 0, pins: 0, order, duration: 60,
  collection: "distonyc", url: "/fixture.mp3", feedback: { downvoted: false, milquetoast: false, pinned: false }, ...extra,
});
const songs = [
  song("plain", "Plain", 1),
  song("down", "Downvoted by someone", 2, { downvotes: 2 }),
  song("meh", "Milquetoasted by someone", 3, { downvotes: 1, milquetoasts: 1 }),
  song("mine", "Downvoted by me", 4, { feedback: { downvoted: true, milquetoast: false, pinned: false } }),
];

async function open(page, url = "/") {
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto(url);
}

test("the feedback filter narrows the catalog to downvoted or milquetoasted songs and is shareable", async ({ page }) => {
  await open(page);
  await expect(page.locator(".track h3")).toHaveCount(4);
  await page.locator(".catalog-filters > summary").click();

  await page.getByLabel("Listener feedback").selectOption("downvoted");
  await expect(page.locator(".track h3")).toHaveText(["Downvoted by someone", "Milquetoasted by someone", "Downvoted by me"]);
  await expect(page.locator("#active-filters")).toContainText("Downvoted");
  expect(new URL(page.url()).searchParams.get("feedback")).toBe("downvoted");

  await page.getByLabel("Listener feedback").selectOption("milquetoast");
  await expect(page.locator(".track h3")).toHaveText(["Milquetoasted by someone"]);
  await expect(page.locator("#track-count")).toContainText("1 song");

  await page.reload();
  await page.locator(".catalog-filters > summary").click();
  await expect(page.getByLabel("Listener feedback")).toHaveValue("milquetoast");
  await expect(page.locator(".track h3")).toHaveText(["Milquetoasted by someone"]);

  await page.getByLabel("Listener feedback").selectOption("all");
  await expect(page.locator(".track h3")).toHaveCount(4);
  expect(new URL(page.url()).searchParams.has("feedback")).toBe(false);
});

test("an unknown feedback value in the link falls back to every song", async ({ page }) => {
  await open(page, "/?feedback=bogus");
  await expect(page.getByLabel("Listener feedback")).toHaveValue("all");
  await expect(page.locator(".track h3")).toHaveCount(4);
});

test("Dark Mode dropdown options keep a dark background and light text", async ({ page, context }) => {
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".catalog-filters > summary").click();
  await page.getByLabel("Listener feedback").selectOption("downvoted");
  const chip = await page.locator(".active-filter").first().evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(chip).toEqual({ background: "rgb(42, 56, 46)", color: "rgb(231, 237, 223)" });
  for (const select of ["#collection-filter", "#feedback-filter", "#sort"]) {
    const colors = await page.locator(`${select} option`).first().evaluate(option => {
      const style = getComputedStyle(option);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(colors).toEqual({ background: "rgb(32, 43, 35)", color: "rgb(231, 237, 223)" });
  }
});
