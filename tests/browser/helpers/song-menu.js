export async function openSongMenu(row) {
  await row.waitFor({ state: 'attached' });
  const more = row.locator('.song-more');
  if (await more.isVisible() && await more.getAttribute('aria-expanded') !== 'true') await more.click();
}
