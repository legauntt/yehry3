import { test, expect } from "@playwright/test";

async function alerts(page, permission, failSetup = false) {
  await page.addInitScript(({ permission, failSetup }) => {
    window.alertPermission = permission;
    window.failAlertSetup = failSetup;
    window.permissionRequests = 0;
    window.shownAlerts = [];
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => window.alertPermission });
    Notification.requestPermission = async () => { window.permissionRequests++; window.alertPermission = "granted"; return "granted"; };
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => window.failAlertSetup ? Promise.reject(new Error("Temporary startup failure")) : register(...args);
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options) { window.shownAlerts.push({ title, options }); };
  }, { permission, failSetup });
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [{ id: `distonyc-${"a".repeat(24)}`, title: "Previously published", idea: "An earlier song", status: "published", publishedAt: new Date().toISOString(), url: "https://example.com/song.mp3" }],
    queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));
  await page.goto("/queue/");
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
