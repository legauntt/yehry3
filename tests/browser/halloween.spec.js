import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });

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
test('bats follow the cursor and idle flybys dismiss on activity', async ({ page }) => {
  await october(page);
  await page.goto('/queue/');
  await expect(page.locator('.halloween-scene')).toHaveCount(1);
  await page.mouse.move(300, 300);
  await expect(page.locator('.halloween-flock')).toBeVisible();
  await expect(page.locator('.halloween-swarm-bat')).toHaveCount(100);
  await page.clock.runFor(300);
  expect(await page.locator('.halloween-flock .halloween-bat-shape').first().evaluate(node => getComputedStyle(node).fill)).toBe('rgb(0, 0, 0)');
  const positions = () => page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.map(node => node.style.transform));
  const before = await positions();
  await page.mouse.move(950, 450, {steps:20});
  await page.clock.runFor(600);
  const after = await positions();
  expect(new Set(after).size).toBe(100);
  expect(after[0]).not.toBe(before[0]);
  expect(after[99]).not.toBe(before[99]);
  const sizes = await page.locator('.halloween-swarm-bat').evaluateAll(nodes =>
    nodes.map(node => parseFloat(getComputedStyle(node).width)));
  expect(Math.min(...sizes)).toBeGreaterThan(4.5);
  expect(Math.max(...sizes)).toBeLessThan(9.5);
  const wings = page.locator('.halloween-flock .bat-wing').first();
  expect(await wings.evaluate(node => getComputedStyle(node).animationName)).toBe('halloween-flap-left');
  const flap = await wings.evaluate(node => {
    const animation = node.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const up = getComputedStyle(node).transform;
    animation.currentTime = animation.effect.getTiming().duration;
    return { up, down: getComputedStyle(node).transform };
  });
  expect(flap.down).not.toBe(flap.up);
  // At rest the trail's centers leave room between these tiny silhouettes.
  await page.clock.runFor(1000);
  const gap = await page.locator('.halloween-swarm-bat').evaluateAll(nodes => {
    const centers = nodes.slice(0, 2).map(node => {
      const matrix = new DOMMatrix(node.style.transform);
      return {x: matrix.m41, y: matrix.m42};
    });
    return Math.hypot(centers[1].x - centers[0].x, centers[1].y - centers[0].y);
  });
  expect(gap).toBeGreaterThan(8);
  await page.screenshot({path:'artifacts/halloween-bat-wave.png'});
  await expect(page.locator('.halloween-web, .halloween-spider, .halloween-skeleton, .halloween-pumpkin, .halloween-bat')).toHaveCount(0);
  await page.clock.runFor(8100);
  await expect(page.locator('.halloween-pass')).toBeVisible();
  await expect(page.locator('.halloween-witch')).toBeVisible();
  expect(await page.locator('.halloween-witch').evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(180);
  expect(await page.locator('.halloween-witch path').first().evaluate(node => getComputedStyle(node).fill)).toBe('rgb(0, 0, 0)');
  await page.locator('.halloween-pass').evaluate(node => {
    const crossing = node.getAnimations().find(animation => animation.animationName === 'halloween-crossing');
    crossing.pause(); crossing.currentTime = 3200;
  });
  await page.screenshot({path:'artifacts/halloween-flyby.png'});
  await page.mouse.move(350, 300);
  await expect(page.locator('.halloween-pass')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.halloween-flock')).toBeHidden();
  await page.clock.runFor(60000);
  await expect(page.locator('.halloween-pass')).toBeHidden();
  await expect(page.locator('.halloween-scare')).toBeHidden();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/halloween-mobile.png'});
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/halloween-desktop.png'});
});

test('pumpkin blackout laughs, dismisses immediately, and expires by itself', async ({ page }) => {
  await october(page);
  await page.goto('/queue/');
  await page.clock.runFor(37500);
  await expect(page.locator('.halloween-scare')).toBeVisible();
  await expect(page.locator('.halloween-scene')).toHaveClass(/is-scare/);
  await expect(page.locator('.halloween-ha')).toHaveCount(2);
  await page.screenshot({path:'artifacts/halloween-scare-desktop.png', animations:'disabled'});
  await page.mouse.move(400, 300);
  await expect(page.locator('.halloween-scare')).toBeHidden();
  await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-scare/);
  await page.setViewportSize({width:390,height:844});
  await page.clock.runFor(37500);
  await expect(page.locator('.halloween-scare')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/halloween-scare-mobile.png', animations:'disabled'});
  await page.locator('body').tap({force:true});
  await expect(page.locator('.halloween-scare')).toBeHidden();
  await page.clock.runFor(44000);
  await expect(page.locator('.halloween-scare')).toBeHidden();
});
