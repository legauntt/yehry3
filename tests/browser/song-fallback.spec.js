import { test, expect } from "@playwright/test";

const id = "distonyc-newly-published-fixture";

test("a published song opens through its share link before the static page exists", async ({ page }) => {
  await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({
    json: { song: { id, status: "published", title: "Fresh from the studio" } },
  }));
  const response = await page.goto(`/song/${id}/`);
  expect(response.status()).toBe(404);
  await expect(page).toHaveURL(`http://127.0.0.1:8080/?shared=${id}#${id}`, { timeout: 15000 });
});

test("an unknown song ID keeps the real 404 page", async ({ page }) => {
  await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({ status: 404, json: { error: "Not found" } }));
  const response = await page.goto(`/song/${id}/`);
  expect(response.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Lost between tracks.");
  await expect(page).toHaveURL(`http://127.0.0.1:8080/song/${id}/`);
});
