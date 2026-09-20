import { trackListening } from './listening.js';
import { api } from './api.js';

export function mountRemixComparison(song, remixAudio, { escape, safeUrl }) {
  const source = song.remixOf;
  if (!source || !/^[a-z0-9-]{1,120}$/.test(source.songId) || source.songId === song.id || !safeUrl(source.url)) return null;
  const element = document.createElement('details');
  element.className = 'remix-comparison'; element.id = 'compare-original';
  element.innerHTML = `<summary><h2>Compare with the original</h2></summary><p>Remix of <a href="/lyrics/?song=${encodeURIComponent(source.songId)}">${escape(source.title)}</a>.</p>
    <div class="actions"><button type="button" class="quiet" data-compare-original>Play original</button><button type="button" class="quiet" data-compare-remix>Play remix</button></div>
    <audio controls preload="none" src="${escape(safeUrl(source.url))}" aria-label="Original: ${escape(source.title)}"></audio>
    <p class="small">Each recording keeps its own place when you switch. Arrangements and timing may differ.</p><p class="small" role="status" data-compare-status></p>`;
  const original = element.querySelector('audio');
  const controller = new AbortController(), { signal } = controller;
  /* The sheet opens collapsed; the "Compare with original" deep link still reveals it. */
  const openForHash = () => { if (location.hash === '#compare-original') element.open = true; };
  openForHash();
  addEventListener('hashchange', openForHash, { signal });
  element.addEventListener('toggle', () => { if (!element.open) original.pause(); }, { signal });
  const status = element.querySelector('[data-compare-status]');
  async function play(audio) {
    (audio === original ? remixAudio : original).pause();
    try { await audio.play(); status.textContent = ''; }
    catch { status.textContent = 'Playback could not start. Try the audio controls.'; }
  }
  element.querySelector('[data-compare-original]').addEventListener('click', () => play(original), { signal });
  element.querySelector('[data-compare-remix]').addEventListener('click', () => play(remixAudio), { signal });
  original.addEventListener('play', () => { if (!original.paused) remixAudio.pause(); }, { signal });
  remixAudio.addEventListener('play', () => { if (!remixAudio.paused) original.pause(); }, { signal });
  const listening = trackListening(original, { songId: source.songId, source: 'lyrics', send: body => api('/listens', { method: 'POST', body }) });
  return { element, key: JSON.stringify(source), remixAudio, stop() { controller.abort(); listening.stop(); original.pause(); } };
}
