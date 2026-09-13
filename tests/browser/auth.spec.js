import { test, expect } from "@playwright/test";

test("Backstage and Make a request remember separate logins after reopening the browser", async ({ page, context, browser, baseURL }) => {
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await expect(page.getByLabel("Your prompt")).toBeVisible();
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator("#signout")).toBeVisible();

  // A fresh context keeps local storage, with none of the old tab's session storage.
  const reopened = await browser.newContext({ baseURL, storageState: await context.storageState() });
  try {
    const next = await reopened.newPage();
    let logins = 0;
    next.on("request", request => {
      if (request.url().endsWith("/yehry3/session") && request.method() === "POST") logins++;
    });
    await next.goto("/admin/");
    await expect(next.locator("#signout")).toBeVisible();
    expect(logins).toBe(0);
    let expired = false;
    await next.route("**/yehry3/admin/prompts?**", route => {
      if (route.request().method() === "OPTIONS" || expired) return route.continue();
      expired = true;
      return route.fulfill({ status: 401, headers: { "access-control-allow-origin": baseURL }, json: { error: "Please sign in again." } });
    });
    await Promise.all([
      next.waitForResponse(response => response.url().includes("/yehry3/admin/prompts?") && response.status() === 200),
      next.getByRole("button", { name: "Refresh", exact: false }).click(),
    ]);
    await expect.poll(() => logins).toBe(1);
    await expect(next.locator("#signout")).toBeVisible();
    await expect(next.locator("#login-form")).toHaveCount(0);
    await next.locator("#signout").click();
    await next.reload();
    await expect(next.locator("#login-form")).toBeVisible();
    expect(await next.evaluate(() => localStorage.getItem("yehry3:auth:admin"))).toBeNull();
    await next.goto("/distonyc/");
    await expect(next.getByLabel("Your prompt")).toBeVisible();
    await next.getByRole("button", { name: "Sign out" }).click();
    await next.reload();
    await expect(next.locator("#login-form")).toBeVisible();
    expect(await next.evaluate(() => localStorage.getItem("yehry3:auth:submitter"))).toBeNull();
  } finally {
    await reopened.close();
  }
});

test("a changed saved Backstage password returns to login without repeated challenges", async ({ page }) => {
  await page.goto("/admin/");
  await page.evaluate(() => localStorage.setItem("yehry3:auth:admin", JSON.stringify({ token: "expired-token", password: "changed-test-password" })));
  let attempts = 0;
  page.on("request", request => {
    if (request.url().endsWith("/yehry3/session") && request.method() === "POST") attempts++;
  });
  await page.reload();
  await expect(page.locator("#login-form")).toBeVisible();
  expect(attempts).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("yehry3:auth:admin"))).toBeNull();
  await page.reload();
  await expect(page.locator("#login-form")).toBeVisible();
  expect(attempts).toBe(1);
});
