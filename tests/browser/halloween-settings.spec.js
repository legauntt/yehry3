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
  await choice.selectOption('off');
  await expect(page.locator('.halloween-scene')).toBeHidden();
  await choice.selectOption('medium');
  await expect(page.locator('.halloween-swarm-bat')).toHaveCount(12);
});
