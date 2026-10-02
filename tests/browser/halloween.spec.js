import { test, expect } from '@playwright/test';

async function october(page) {
  await page.clock.install({ time: new Date('2026-10-15T12:00:00Z') });
}
test('seasonal pitch default preserves choices and expires in November', async ({ page }) => {
  await october(page);
  await page.goto('/queue/');
  const mount = () => page.evaluate(async () => {
    const { pitchControl, mountPitchControl } = await import('/assets/pitch-repair.js');
    const root = document.createElement('div');
    root.id = 'season-test';
    root.innerHTML = pitchControl({choices:{pitchRepair:['clean','wild','haunted']}});
    document.querySelector('#main').append(root);
    mountPitchControl(root, {});
  });
  await mount();
  await expect(page.locator('#gen-pitchRepair')).toHaveValue('haunted');
  await expect(page.locator('.pitch-pumpkin')).toBeVisible();
  await page.locator('#gen-pitchRepair').selectOption('wild');
  await page.reload(); await mount();
  await expect(page.locator('#gen-pitchRepair')).toHaveValue('wild');
  await page.clock.setSystemTime(new Date('2026-11-01T08:00:00Z'));
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await mount();
  await expect(page.locator('#gen-pitchRepair')).toHaveValue('clean');
  await expect(page.locator('.halloween-scene')).toHaveCount(0);
  await expect(page.locator('.pitch-pumpkin')).toHaveCount(0);
});
test('decorations idle, follow the cursor, respect reduced motion and fit phones', async ({ page }) => {
  await october(page);
  await page.goto('/queue/');
  await expect(page.locator('.halloween-scene')).toHaveCount(1);
  await page.mouse.move(300, 300);
  await expect(page.locator('.halloween-witch')).toBeVisible();
  await page.clock.fastForward(6500);
  await expect(page.locator('.halloween-scene')).toHaveClass(/is-idle/);
  await page.mouse.move(350, 300);
  await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-idle/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.halloween-witch')).toBeHidden();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/halloween-mobile.png'});
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/halloween-desktop.png'});
});
