import { test, expect } from "@playwright/test";

async function alerts(page, permission, failSetup = false, data = {
  inStudio: [], queued: [], recent: [{ id: `distonyc-${"a".repeat(24)}`, title: "Previously published", idea: "An earlier song", status: "published", publishedAt: new Date().toISOString(), url: "https://example.com/song.mp3" }],
  queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
}) {
  await page.addInitScript(({ permission, failSetup }) => {
    window.alertPermission = permission;
    window.failAlertSetup = failSetup;
    window.permissionRequests = 0;
    window.shownAlerts = [];
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => window.alertPermission });
    Notification.requestPermission = async () => { window.permissionRequests++; window.alertPermission = "granted"; return "granted"; };
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => window.failAlertSetup ? Promise.reject(new Error("Temporary startup failure")) : register(...args);
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options) {
      if (window.failAlertDisplay) throw new Error("Temporary display failure");
      window.shownAlerts.push({ title, options });
    };
  }, { permission, failSetup });
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: data }));
  await page.goto("/queue/");
  return data;
}

function release(letter, title) {
  return { id: `distonyc-${letter.repeat(24)}`, title, idea: "Someone else’s request", authoredBy: "Another listener", status: "published", publishedAt: new Date().toISOString(), url: "https://example.com/song.mp3" };
}

test("granted alert permission survives reload and explicit off stays off without historical notifications", async ({ page }) => {
  await alerts(page, "granted");
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  await expect(page.locator("#recent-releases")).toContainText("Previously published");
  expect(await page.evaluate(() => window.shownAlerts.length)).toBe(0);
  await page.getByRole("button", { name: "Turn off browser alerts" }).click();
  await page.reload();
  await expect(page.locator("#alert-status")).toContainText("Alerts are off");
  await expect(page.getByRole("button", { name: "Enable browser alerts" })).toBeEnabled();
  await page.getByRole("button", { name: "Enable browser alerts" }).click();
  await expect(page.locator("#alert-status")).toContainText("Alerts are on");
  expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
});

test("notification permission is requested only on click and blocked permission is reconciled on return", async ({ page }) => {
  await alerts(page, "default");
  await expect(page.getByRole("button", { name: "Enable browser alerts" })).toBeEnabled();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
  await page.getByRole("button", { name: "Enable browser alerts" }).click();
  await expect(page.locator("#alert-status")).toContainText("Alerts are on");
  expect(await page.evaluate(() => window.permissionRequests)).toBe(1);
  await page.evaluate(() => { window.alertPermission = "denied"; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("button", { name: "Browser alerts blocked" })).toBeDisabled();
  await expect(page.locator("#alert-status")).toContainText("browser settings");
  await page.evaluate(() => { window.alertPermission = "granted"; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(1);
});

test("granted permission with unfinished worker setup offers a retry without another permission prompt", async ({ page }) => {
  await alerts(page, "granted", true);
  await expect(page.getByRole("button", { name: "Finish enabling alerts" })).toBeEnabled();
  await expect(page.locator("#alert-status")).toContainText("Permission is granted, but browser alerts could not start");
  await page.evaluate(() => { window.failAlertSetup = false; });
  await page.getByRole("button", { name: "Finish enabling alerts" }).click();
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
});

test("everyone’s releases are announced across site pages and remembered after reload", async ({ page }) => {
  const data = await alerts(page, "granted");
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("yehry3:announced-releases"))).not.toBeNull();
  for (const [index, path] of ["/", "/admin/", "/distonyc/", "/deetz/", "/fearhunger/"].entries()) {
    await test.step(path, async () => {
      const song = release("bcdef"[index], `Another listener’s song ${index + 1}`);
      data.recent.unshift(song);
      await page.goto(path);
      await expect.poll(() => page.evaluate(() => window.shownAlerts.length)).toBe(1);
      expect(await page.evaluate(() => window.shownAlerts[0].options.body)).toBe(song.title);
      expect(await page.evaluate(() => window.shownAlerts[0].options.data.songId)).toBe(song.id);
      await page.reload();
      await page.evaluate(() => navigator.serviceWorker.ready);
      expect(await page.evaluate(() => window.shownAlerts.length)).toBe(0);
    });
  }
});

test("an open listening-room page polls for everyone’s completed songs", async ({ page }) => {
  const data = await alerts(page, "granted");
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  await page.clock.install();
  const checked = page.waitForResponse(response => response.url().includes("/yehry3/queue?"));
  await page.goto("/");
  await checked;
  await page.evaluate(() => navigator.serviceWorker.ready);
  data.recent.unshift(release("b", "Ready while listening"));
  await page.clock.runFor(30100);
  await expect.poll(() => page.evaluate(() => window.shownAlerts.length)).toBe(1);
  expect(await page.evaluate(() => window.shownAlerts[0].options.body)).toBe("Ready while listening");
});

test("two open tabs announce a release only once", async ({ page, context }) => {
  const data = await alerts(page, "granted");
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  const other = await context.newPage();
  try {
    await alerts(other, "granted", false, data);
    await expect(other.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
    data.recent.unshift(release("b", "One shared announcement"));
    await Promise.all([page.locator("#refresh-queue").click(), other.locator("#refresh-queue").click()]);
    await expect(page.locator("#refresh-queue")).toBeEnabled();
    await expect(other.locator("#refresh-queue")).toBeEnabled();
    const count = async () => (await page.evaluate(() => window.shownAlerts.length)) + (await other.evaluate(() => window.shownAlerts.length));
    await expect.poll(count).toBe(1);
  } finally { await other.close(); }
});

test("a failed system notification retries without losing the completed song", async ({ page }) => {
  const data = await alerts(page, "granted");
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  await page.evaluate(() => { window.failAlertDisplay = true; });
  data.recent.unshift(release("b", "Retained for another try"));
  await page.locator("#refresh-queue").click();
  await expect(page.locator("#alert-status")).toContainText("retry on the next refresh");
  expect(await page.evaluate(() => window.shownAlerts.length)).toBe(0);
  await page.evaluate(() => { window.failAlertDisplay = false; });
  await page.locator("#refresh-queue").click();
  await expect.poll(() => page.evaluate(() => window.shownAlerts.length)).toBe(1);
  await expect(page.locator("#alert-status")).toContainText("Alerts are on");
});
