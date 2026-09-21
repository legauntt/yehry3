import { player } from './player.js';

// Compare a remix with its original on the site's one player. Each recording keeps its own place, so
// switching between them picks up where each was left; `sheet` is the lyric sheet's view of the player
// (lyrics.js), whose song is the remix.
export function mountRemixComparison(song, sheet, { escape, safeUrl, scope }) {
  const source = song.remixOf;
  if (!source || !/^[a-z0-9-]{1,120}$/.test(source.songId) || source.songId === song.id || !safeUrl(source.url)) return null;
  const original = { id: source.songId, title: source.title, url: source.url, hasLyrics: true };
  const element = document.createElement('details');
  element.className = 'remix-comparison'; element.id = 'compare-original';
  element.innerHTML = `<summary><h2>Compare with the original</h2></summary><p>Remix of <a href="/lyrics/?song=${encodeURIComponent(source.songId)}">${escape(source.title)}</a>.</p>
    <div class="actions"><button type="button" class="quiet" data-compare-original>Play original</button><button type="button" class="quiet" data-compare-remix>Play remix</button></div>
    <p class="small" data-compare-now aria-live="polite"></p>
    <p class="small">Each recording keeps its own place when you switch. Arrangements and timing may differ.</p><p class="small" role="status" data-compare-status></p>`;
  const controller = new AbortController(), { signal } = controller;
  const audio = player.audio;
  const places = { original: 0, remix: 0 };
  const which = () => player.current?.id === original.id ? 'original' : player.current?.id === song.id ? 'remix' : null;
  /* The sheet opens collapsed; the "Compare with original" deep link still reveals it. */
  const openForHash = () => { if (location.hash === '#compare-original') element.open = true; };
  openForHash();
  addEventListener('hashchange', openForHash, { signal });
  const status = element.querySelector('[data-compare-status]');
  const now = element.querySelector('[data-compare-now]');
  function sync() {
    const current = which();
    now.textContent = current && player.playing ? `Playing the ${current}.` : '';
  }
  // Whichever is loaded remembers where it was as the other is chosen.
  function remember() {
    const current = which();
    if (current) places[current] = audio.currentTime || 0;
  }
  async function play(target) {
    if (which() === target) { status.textContent = ''; return player.toggle(target === 'original' ? original : song, undefined, { source: 'lyrics' }); }
    remember();
    const at = target === 'original' ? places.original : (places.remix || sheet.pendingAt || 0);
    const started = await player.play(target === 'original' ? original : song, [target === 'original' ? original : song], { source: 'lyrics', at });
    status.textContent = started ? '' : 'Playback could not start. Try the audio controls.';
    return started;
  }
  /* Collapsing the comparison stops the original. */
  element.addEventListener('toggle', () => { if (!element.open && which() === 'original') player.pause(); }, { signal });
  element.querySelector('[data-compare-original]').addEventListener('click', () => play('original'), { signal });
  element.querySelector('[data-compare-remix]').addEventListener('click', () => play('remix'), { signal });
  for (const event of ['play', 'pause', 'ended', 'emptied']) audio.addEventListener(event, sync, { signal });
  player.on('change', sync, signal);
  scope?.onLeave(() => controller.abort());
  sync();
  return { element, key: JSON.stringify(source), stop() { controller.abort(); } };
}
