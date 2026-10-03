import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const hosting = JSON.parse(await readFile(new URL('../../staticwebapp.config.json', import.meta.url), 'utf8'));
test.beforeEach(async ({ context }) => {
  // The preview server does not send Azure's CSP; use it in browser checks too.
  await context.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({response, headers: {...response.headers(), 'content-security-policy': hosting.globalHeaders['Content-Security-Policy']}});
  });
});

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
  await page.addInitScript(() => localStorage.setItem('yehry3:bat-settings', JSON.stringify({pattern:'trail'})));
  await page.goto('/queue/');
  await expect(page.locator('.halloween-scene')).toHaveCount(1);
  await page.mouse.move(300, 300);
  await expect(page.locator('.halloween-flock')).toBeVisible();
  await expect(page.locator('.halloween-swarm-bat')).toHaveCount(24);
  await expect(page.locator('.halloween-web')).toHaveCount(2);
  await expect.poll(() => page.locator('.halloween-swarm-bat').first().evaluate(node => parseFloat(getComputedStyle(node).width))).toBeLessThan(43);
  await page.clock.runFor(300);
  expect(await page.locator('.halloween-flock .halloween-bat-shape').first().evaluate(node => getComputedStyle(node).fill)).toBe('rgb(0, 0, 0)');
  const positions = () => page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.map(node => node.style.transform));
  const before = await positions();
  await page.mouse.move(950, 450, {steps:20});
  await page.clock.runFor(600);
  const after = await positions();
  expect(new Set(after).size).toBe(24);
  expect(after[0]).not.toBe(before[0]);
  expect(after[23]).not.toBe(before[23]);
  const sizes = await page.locator('.halloween-swarm-bat').evaluateAll(nodes =>
    nodes.map(node => parseFloat(getComputedStyle(node).width)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(21);
  expect(Math.max(...sizes)).toBeLessThan(43);
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
  // At rest the trail's centers leave room between the silhouettes.
  await page.clock.runFor(1000);
  const gap = await page.locator('.halloween-swarm-bat').evaluateAll(nodes => {
    const centers = nodes.slice(0, 2).map(node => {
      const matrix = new DOMMatrix(node.style.transform);
      return {x: matrix.m41, y: matrix.m42};
    });
    return Math.hypot(centers[1].x - centers[0].x, centers[1].y - centers[0].y);
  });
  expect(gap).toBeGreaterThan(20);
  await page.screenshot({path:'artifacts/halloween-bat-wave.png'});
  await expect(page.locator('.halloween-skeleton, .halloween-pumpkin, .halloween-bat')).toHaveCount(0);
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

test('idle spiders weave across the page and interactions restore corner webs', async ({ page }) => {
  await october(page);
  await page.goto('/queue/');
  await expect(page.locator('.halloween-web')).toHaveCount(2);
  await expect(page.locator('.halloween-weaver')).toHaveCount(3);
  await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-weaving/);
  await page.clock.runFor(6500);
  await expect(page.locator('.halloween-scene')).toHaveClass(/is-weaving/);
  const thread = page.locator('.web-thread').first();
  const progress = await thread.evaluate(node => {
    const animation = node.getAnimations()[0];
    animation.pause(); animation.currentTime = 12000;
    return parseFloat(getComputedStyle(node).strokeDashoffset);
  });
  expect(progress).toBeLessThan(1);
  expect(progress).toBeGreaterThan(0);
  await page.screenshot({path:'artifacts/halloween-weaving.png'});
  for (const interact of [() => page.mouse.move(500, 300), () => page.keyboard.press('Shift'), () => page.mouse.wheel(0,100), () => page.locator('body').tap({force:true})]) {
    await interact();
    await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-weaving/);
    await expect(page.locator('.halloween-web').first()).toBeVisible();
    expect(await thread.evaluate(node => parseFloat(getComputedStyle(node).strokeDashoffset))).toBe(1);
    await page.clock.runFor(6500);
    await expect(page.locator('.halloween-scene')).toHaveClass(/is-weaving/);
  }
});

test('bat display settings apply immediately and persist across navigation and tabs', async ({ page, context }) => {
  await october(page);
  await page.goto('/');
  await page.getByRole('button', {name:'Open display settings'}).click();
  await page.getByLabel('Show trailing bats').uncheck();
  await page.getByLabel('Bat size', {exact:true}).fill('2');
  await page.getByLabel('Bat spacing', {exact:true}).fill('2');
  await page.getByLabel('Wing flapping speed').fill('2');
  await page.getByLabel('Flight pattern').selectOption('circle');
  await page.getByRole('button', {name:'Close display settings'}).click();
  await page.mouse.move(700,400);
  await expect(page.locator('.halloween-flock')).toBeHidden();
  await page.reload();
  await page.getByRole('button', {name:'Open display settings'}).click();
  await expect(page.getByLabel('Show trailing bats')).not.toBeChecked();
  await expect(page.getByLabel('Bat size', {exact:true})).toHaveValue('2');
  await expect(page.getByLabel('Bat spacing', {exact:true})).toHaveValue('2');
  await expect(page.getByLabel('Wing flapping speed')).toHaveValue('2');
  await expect(page.getByLabel('Flight pattern')).toHaveValue('circle');
  await page.getByLabel('Show trailing bats').check();
  await page.getByRole('button', {name:'Close display settings'}).click();
  await page.mouse.move(700,400);
  await expect(page.locator('.halloween-flock')).toBeVisible();
  const other = await context.newPage();
  await october(other);
  await other.goto('/');
  await other.getByRole('button', {name:'Open display settings'}).click();
  await other.getByLabel('Flight pattern').selectOption('random');
  await other.getByLabel('Show trailing bats').uncheck();
  await expect(page.locator('.halloween-flock')).toBeHidden();
  await other.close();
  await page.getByRole('link', {name:'The queue', exact:true}).click();
  await page.getByRole('link', {name:'The collection', exact:true}).click();
  await page.getByRole('button', {name:'Open display settings'}).click();
  await expect(page.getByLabel('Show trailing bats')).not.toBeChecked();
  await expect(page.getByLabel('Flight pattern')).toHaveValue('random');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('dialog', {name:'Display settings'}).screenshot({path:'artifacts/halloween-settings-mobile.png'});
  expect(await page.getByRole('dialog', {name:'Display settings'}).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('bat patterns orbit the pointer and random switches during active flight', async ({ page }) => {
  await october(page);
  await page.goto('/');
  const flock = page.locator('.halloween-flock');
  for (const pattern of ['circle', 'eight', 'spiral']) {
    await page.getByRole('button', {name:'Open display settings'}).click();
    await page.getByLabel('Flight pattern').selectOption(pattern);
    await page.getByRole('button', {name:'Close display settings'}).click();
    await page.mouse.move(700,450);
    await page.clock.runFor(900);
    await expect(flock).toHaveAttribute('data-pattern', pattern);
    const points = await page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.map(node => {
      const m = new DOMMatrix(node.style.transform);
      return {x:m.m41, y:m.m42};
    }));
    expect(points.some(p => p.x < 650)).toBe(true);
    expect(points.some(p => p.x > 750)).toBe(true);
    expect(points.some(p => p.y < 420)).toBe(true);
    expect(points.some(p => p.y > 480)).toBe(true);
    if (pattern === 'circle') {
      for (const p of points) {
        expect(Math.hypot(p.x - 700, p.y - 450)).toBeGreaterThan(80);
        expect(Math.hypot(p.x - 700, p.y - 450)).toBeLessThan(200);
      }
      await page.screenshot({path:'artifacts/halloween-circle.png'});
    }
  }
  await page.getByRole('button', {name:'Open display settings'}).click();
  await page.getByLabel('Bat size', {exact:true}).fill('0.5');
  await page.getByLabel('Flight pattern').selectOption('random');
  await page.getByRole('button', {name:'Close display settings'}).click();
  await page.mouse.move(700,450);
  await page.clock.runFor(100);
  const first = await flock.getAttribute('data-pattern');
  const minimum = await page.locator('.halloween-swarm-bat').first().evaluate(node => parseFloat(getComputedStyle(node).width));
  expect(minimum).toBe(10.5);
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(700 + i,450);
    await page.clock.runFor(1000);
  }
  expect(await flock.getAttribute('data-pattern')).not.toBe(first);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(flock).toBeHidden();
});

test('dashboard pumpkins survive navigation and fit on mobile', async ({ page }) => {
  await october(page);
  await page.goto('/');
  await expect(page.locator('.hero-copy .pumpkin-patch')).toBeVisible();
  await expect(page.locator('.site-footer .pumpkin-patch')).toHaveCount(1);
  await page.getByRole('link', {name:'The queue', exact:true}).click();
  await expect(page.locator('.queue-intro .pumpkin-patch')).toBeVisible();
  await expect(page.locator('.section-heading .dashboard-pumpkins')).toHaveCount(4);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/halloween-pumpkins-mobile.png'});
  await page.getByRole('link', {name:'The collection', exact:true}).click();
  await expect(page.locator('.hero-copy .pumpkin-patch')).toHaveCount(1);
  await expect(page.locator('.site-footer .pumpkin-patch')).toHaveCount(1);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/halloween-pumpkins-desktop.png'});
  await page.clock.setSystemTime(new Date('2026-11-01T08:00:00Z'));
  await page.reload();
  await expect(page.locator('.dashboard-pumpkins')).toHaveCount(0);
});

test('circling bats scatter on movement and settle back into their rings', async ({ page }) => {
  await october(page);
  await page.goto('/');
  await page.getByRole('button', {name:'Open display settings'}).click();
  await page.getByLabel('Flight pattern').selectOption('circle');
  await page.getByRole('button', {name:'Close display settings'}).click();
  await page.mouse.move(700,450);
  await page.clock.runFor(1400);
  const radii = () => page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.map(node => {
    const m = new DOMMatrix(node.style.transform);
    return Math.hypot(m.m41 - 800, m.m42 - 450);
  }));
  await page.mouse.move(800,450);
  await page.clock.runFor(350);
  const edgeDistances = await page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.map(node => {
    const m = new DOMMatrix(node.style.transform);
    return Math.min(m.m41, innerWidth - m.m41, m.m42, innerHeight - m.m42);
  }));
  expect(Math.max(...edgeDistances)).toBeLessThan(110);
  expect(Math.min(...edgeDistances)).toBeGreaterThan(0);
  expect(await page.locator('.halloween-swarm-bat.is-sleeping').count()).toBeGreaterThan(12);
  expect(await page.locator('.is-sleeping .bat-wing').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  const sleeper = page.locator('.halloween-swarm-bat.is-sleeping').first();
  const resting = await sleeper.evaluate(node => node.style.transform);
  await page.clock.runFor(64);
  expect(await sleeper.evaluate(node => node.style.transform)).toBe(resting);
  await page.screenshot({path:'artifacts/halloween-circle-scatter.png'});
  await page.clock.runFor(1300);
  const settled = await radii();
  expect(Math.max(...settled)).toBeLessThan(200);
  expect(Math.min(...settled)).toBeGreaterThan(80);
  await expect(page.locator('.halloween-swarm-bat.is-sleeping')).toHaveCount(0);
  expect(await page.locator('.halloween-flock .bat-wing').first().evaluate(node => getComputedStyle(node).animationName)).toBe('halloween-flap-left');
  await page.screenshot({path:'artifacts/halloween-circle-settled.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('.halloween-flock')).toBeHidden();
});

test('random is the default and inactive bats dock visibly along the sides', async ({ page }) => {
  await october(page);
  await page.goto('/');
  const flock = page.locator('.halloween-flock');
  await expect(flock).toBeVisible();
  await expect(flock).toHaveAttribute('data-docked', 'true');
  await page.getByRole('button', {name:'Open display settings'}).click();
  await expect(page.getByLabel('Flight pattern')).toHaveValue('random');
  await page.getByLabel('Flight pattern').selectOption('circle');
  await page.getByRole('button', {name:'Close display settings'}).click();
  const checkDock = async () => {
    await page.clock.runFor(600);
    await expect(flock).toBeVisible();
    await expect(flock).toHaveAttribute('data-docked', 'true');
    await expect(page.locator('.halloween-swarm-bat.is-sleeping')).toHaveCount(24);
    const points = await page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const m = new DOMMatrix(node.style.transform);
      return { edge:Math.min(m.m41, innerWidth - m.m41), inside:rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight };
    }));
    expect(points.every(point => point.edge < 50 && point.inside)).toBe(true);
  };
  await page.mouse.move(700,450);
  await page.clock.runFor(2300);
  await checkDock();
  await page.mouse.move(600,400);
  await page.keyboard.press('Shift');
  await checkDock();
  await page.mouse.move(700,450);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave')));
  await checkDock();
  await page.setViewportSize({width:390,height:844});
  await checkDock();
  await page.screenshot({path:'artifacts/halloween-docked-mobile.png'});
  await page.mouse.move(180,400);
  await page.clock.runFor(400);
  await page.mouse.move(210,400);
  await page.clock.runFor(350);
  const inside = await page.locator('.halloween-swarm-bat').evaluateAll(nodes => nodes.every(node => {
    const r = node.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }));
  expect(inside).toBe(true);
  await page.screenshot({path:'artifacts/halloween-scatter-mobile.png'});
  await page.getByRole('button', {name:'Open display settings'}).click();
  await page.getByLabel('Show trailing bats').uncheck();
  await expect(flock).toBeHidden();
});
