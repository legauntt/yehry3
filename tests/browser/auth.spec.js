import { test, expect } from "@playwright/test";

test("Backstage and Make a request remember separate logins after reopening the browser", async ({ page, context, browser, baseURL }) => {
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await expect(page.getByLabel("Your prompt")).toBeVisible();
  await expect(page.locator("#login-status")).toHaveText("Password saved in this browser.");
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator("#signout")).toBeVisible();
  await expect(page.locator("#login-status")).toHaveText("Password saved in this browser.");

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

test("a session failure after renewal keeps the password through reload and offers retry", async ({ page, baseURL }) => {
  await page.addInitScript(() => localStorage.setItem("yehry3:listeners-hidden", "true"));
  let sessions = 0;
  let failing = false;
  const headers = { "access-control-allow-origin": baseURL };
  // Backstage counts the published songs for its collapsed header; that request is not what this test is about.
  await page.route("**/yehry3/admin/songs?**", route => route.request().method() === "OPTIONS"
    ? route.continue() : route.fulfill({ headers, json: { songs: [], total: 0, page: 0, pageSize: 25, counts: { live: 0, archived: 0 } } }));
  await page.route("**/yehry3/session", route => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill({ headers, json: { token: `accepted-${++sessions}` } });
  });
  await page.route("**/yehry3/admin/prompts?**", route => {
    if (route.request().method() === "OPTIONS") return route.continue();
    return route.fulfill(failing
      ? { status: 401, headers, json: { error: "Please sign in again." } }
      : { headers, json: { prompts: [], counts: {}, total: 0 } });
  });
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("remembered-test-password");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator("#signout")).toBeVisible();
  failing = true;
  await page.reload();
  await expect(page.locator("#retry-admin")).toBeVisible();
  await expect(page.locator("#login-form")).toHaveCount(0);
  expect(sessions).toBe(2);
  expect(await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem("yehry3:auth:admin"))?.password))).toBe(true);
  failing = false;
  await page.locator("#retry-admin").click();
  await expect(page.locator("#signout")).toBeVisible();
  await expect(page.locator("#login-status")).toHaveText("Password saved in this browser.");
  expect(sessions).toBe(2);
});

test("a browser that blocks saved passwords reports a temporary login", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("yehry3:auth:")) throw new DOMException("Storage blocked", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  const headers = { "access-control-allow-origin": baseURL };
  await page.route("**/yehry3/session", route => route.request().method() === "OPTIONS"
    ? route.continue() : route.fulfill({ headers, json: { token: "temporary-test-token" } }));
  await page.route("**/yehry3/admin/prompts?**", route => route.request().method() === "OPTIONS"
    ? route.continue() : route.fulfill({ headers, json: { prompts: [], counts: {}, total: 0 } }));
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("temporary-test-password");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator("#login-status")).toContainText("Your browser could not save this password");
  expect(await page.evaluate(() => localStorage.getItem("yehry3:auth:admin"))).toBeNull();
  await page.reload();
  await expect(page.locator("#login-form")).toBeVisible();
});

test("an older session can save its password for future visits", async ({ page, baseURL }) => {
  const headers = { "access-control-allow-origin": baseURL };
  // This fixture token is not valid at the disposable API. Keep independent
  // presence and published-song requests from signing out the mocked session.
  await page.addInitScript(() => localStorage.setItem("yehry3:listeners-hidden", "true"));
  await page.route("**/yehry3/admin/songs?**", route => route.fulfill({ headers, json: { songs: [], total: 0, counts: { live: 0, archived: 0 } } }));
  await page.route("**/yehry3/admin/prompts?**", route => route.request().method() === "OPTIONS"
    ? route.continue() : route.fulfill({ headers, json: { prompts: [], counts: {}, total: 0 } }));
  await page.route("**/yehry3/session", route => route.request().method() === "OPTIONS"
    ? route.continue() : route.fulfill({ headers, json: { token: "remembered-test-token" } }));
  await page.goto("/admin/");
  await page.evaluate(() => sessionStorage.setItem("yehry3:admin", "legacy-test-token"));
  await page.reload();
  await expect(page.locator("#login-status")).toContainText("This older login has no saved password");
  await page.getByRole("button", { name: "Remember login" }).click();
  await page.getByLabel("Password", { exact: true }).fill("remembered-test-password");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator("#login-status")).toHaveText("Password saved in this browser.");
  expect(await page.evaluate(() => sessionStorage.getItem("yehry3:admin"))).toBeNull();
  await page.reload();
  await expect(page.locator("#signout")).toBeVisible();
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
