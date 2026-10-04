import { test, expect } from '@playwright/test';
test.beforeEach(async ({page}) => {
  await page.clock.install({time:new Date('2026-10-03T19:00:00Z')});
  await page.route('**/yehry3/**', r => r.fulfill({json:{songs:[],collections:[],items:[],listeners:[]}}));
});
async function settings(page) {
  await page.getByRole('button',{name:'Open display settings'}).click();
  return page.getByLabel('Halloween decor',{exact:true});
}
test('levels default on, apply immediately, and persist across reloads, pages and tabs',async({page,context})=>{
  await page.goto('/');
  const choice=await settings(page);
  await expect(choice).toHaveValue('high');
  for(const [level,count] of [['low',0],['medium',12],['high',24],['extreme',36],['haunted',48]]) {
    await choice.selectOption(level);
    await expect(page.locator('.halloween-swarm-bat')).toHaveCount(count);
    await expect(page.locator('html')).toHaveAttribute('data-halloween-level',level);
  }
  await choice.selectOption('off');
  await expect(page.locator('.halloween-scene')).toBeHidden();
  await expect(page.locator('.site-footer .pumpkin-patch')).toBeHidden();
  await page.getByRole('button',{name:'Close display settings'}).click();
  await page.mouse.move(300,300);
  await page.clock.fastForward(60000);
  await expect(page.locator('.halloween-scene')).toBeHidden();
  await expect(page.locator('.halloween-pass')).toBeHidden();
  await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-weaving|is-scare/);
  await page.reload();
  await expect(await settings(page)).toHaveValue('off');
  await page.getByRole('button',{name:'Close display settings'}).click();
  await page.getByRole('link',{name:'The queue',exact:true}).click();
  await expect(page.locator('.halloween-scene')).toBeHidden();
  const other=await context.newPage();
  await other.clock.install({time:new Date('2026-10-03T19:00:00Z')});
  await other.route('**/yehry3/**', r=>r.fulfill({json:{songs:[],collections:[],items:[]}}));
  await other.goto('/');
  await expect(await settings(other)).toHaveValue('off');
  await other.getByLabel('Halloween decor',{exact:true}).selectOption('low');
  await expect(page.locator('html')).toHaveAttribute('data-halloween-level','low');
  await expect(page.locator('.halloween-scene')).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(page.locator('.halloween-pass')).toBeHidden();
  await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-weaving|is-scare/);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('link',{name:'The collection',exact:true}).click();
  await settings(page);
  expect(await page.locator('.display-settings-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  await page.getByLabel('Halloween decor',{exact:true}).selectOption('haunted');
  await page.getByLabel('Halloween decor',{exact:true}).scrollIntoViewIfNeeded();
  await page.getByRole('dialog',{name:'Display settings'}).screenshot({path:'artifacts/halloween-levels-mobile.png'});
});
test('medium omits weaving and scares; haunted stays dismissible and respects reduced motion',async({page})=>{
  await page.goto('/');
  const choice=await settings(page);
  await choice.selectOption('medium');
  await page.getByRole('button',{name:'Close display settings'}).click();
  for (let i=0; i<4; i++) { await page.clock.fastForward(16000); await page.clock.fastForward(6500); }
  await expect(page.locator('.halloween-scene')).not.toHaveClass(/is-weaving|is-scare/);
  await settings(page);
  await choice.selectOption('haunted');
  await page.getByRole('button',{name:'Close display settings'}).click();
  await page.clock.fastForward(4000);
  await page.clock.fastForward(6500);
  for (let encounter=2; encounter<20; encounter++) {
    await page.clock.fastForward(4000);
    await expect(page.locator('.halloween-scare')).toBeHidden();
    await page.clock.fastForward(6500);
  }
  await page.clock.fastForward(4000);
  await expect(page.locator('.halloween-scare')).toBeVisible();
  await page.mouse.move(300,300);
  await expect(page.locator('.halloween-scare')).toBeHidden();
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('.halloween-scene')).toBeHidden();
});
test('settings still work when localStorage is blocked',async({page})=>{
  await page.addInitScript(()=>{
    Storage.prototype.getItem=()=>{throw new Error('blocked');};
    Storage.prototype.setItem=()=>{throw new Error('blocked');};
  });
  await page.goto('/');
  const choice=await settings(page);
  await expect(choice).toHaveValue('high');
  await expect(page.getByLabel('Listening room theme')).toHaveValue('midnight');
  await choice.selectOption('off');
  await expect(page.locator('.halloween-scene')).toBeHidden();
  await choice.selectOption('medium');
  await expect(page.locator('.halloween-swarm-bat')).toHaveCount(12);
  await page.getByLabel('Listening room theme').selectOption('pumpkin');
  await expect(page.locator('html')).toHaveAttribute('data-room-mood','pumpkin');
});

test('doomer themes persist, synchronize, and preserve the page', async ({page, context}) => {
  await page.goto('/');
  await settings(page);
  await expect(page.getByLabel('Listening room theme')).toHaveValue('midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const hero = await page.locator('.hero-copy').elementHandle();
  for (const mood of ['midnight','concrete','pumpkin']) {
    await page.getByLabel('Listening room theme').selectOption(mood);
    await expect(page.locator('html')).toHaveAttribute('data-room-mood',mood);
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    expect(await hero.evaluate(node => node.isConnected)).toBe(true);
  }
  await page.reload();
  await settings(page);
  await expect(page.getByLabel('Listening room theme')).toHaveValue('pumpkin');
  const other = await context.newPage();
  await other.clock.install({time:new Date('2026-10-03T19:00:00Z')});
  await other.route('**/yehry3/**', r=>r.fulfill({json:{songs:[],collections:[],items:[],listeners:[]}}));
  await other.goto('/queue/');
  await expect(other.locator('html')).toHaveAttribute('data-room-mood','pumpkin');
  await other.goto('/');
  await settings(other);
  await expect(other.getByLabel('Listening room theme')).toHaveValue('pumpkin');
  await other.getByLabel('Listening room theme').selectOption('concrete');
  await expect(page.getByLabel('Listening room theme')).toHaveValue('concrete');
  await other.close();
  await page.getByRole('checkbox',{name:/^Dark Mode/}).uncheck();
  await expect(page.getByLabel('Listening room theme')).toHaveValue('classic');
  await page.getByLabel('Listening room theme').selectOption('pumpkin');
  await page.getByRole('button',{name:'Close display settings'}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.pumpkin-doomer')).toBeVisible();
  expect(await page.locator('.pumpkin-doomer').evaluate(n=>n.complete && n.naturalWidth>0)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/doomer-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/doomer-desktop.png'});
  await settings(page);
  await page.getByLabel('Halloween decor',{exact:true}).selectOption('off');
  await page.getByRole('button',{name:'Close display settings'}).click();
  await expect(page.locator('.pumpkin-doomer')).toBeHidden();
});

test('midnight default preserves saved Classic and legacy Dark Mode choices', async ({page}) => {
  await page.goto('/');
  for (const dark of ['false','true']) {
    await page.evaluate(dark => {
      localStorage.removeItem('yehry3:room-mood');
      localStorage.setItem('yehry3:dark-mode',dark);
    },dark);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-room-mood','classic');
    await expect(page.locator('html')).toHaveAttribute('data-theme',dark==='true'?'dark':'light');
  }
  await settings(page);
  await page.getByRole('checkbox',{name:/^Dark Mode/}).uncheck();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-room-mood','classic');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-room-mood','midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
