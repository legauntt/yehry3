// The switch swaps recordings and keeps the listener's place for comparison.
import { pitchModes } from './pitch-repair.js';

// First Tony/guide trial. The guide file is staged only in the local preview's dist/.
const guideTrial = {
  id: 'distonyc-06d2b8c3c8dffed19df347bb',
  url: '/preview-media/it-was-simple-not-easy-guide.mp3',
};
const localPreview = typeof location !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(location.hostname);

export function songSides(song) {
  if (localPreview && song?.id === guideTrial.id && typeof song.url === 'string')
    return [
      { side: 'A', label: 'Tony', title: 'Final recording with Tony’s voice', url: song.url },
      { side: 'B', label: 'Guide', title: 'Original stand-in vocal before Tony’s replacement', url: guideTrial.url },
    ];
  if (!song || !Object.hasOwn(pitchModes, song.pitchRepair) || !Array.isArray(song.alternates)) return [];
  const others = song.alternates.filter((row) => row && typeof row.url === 'string' && Object.hasOwn(pitchModes, row.pitchRepair) && row.pitchRepair !== song.pitchRepair).slice(0, 2);
  if (!others.length) return [];
  return [{ pitchRepair: song.pitchRepair, url: song.url }, ...others].map((row, index) => ({
    side: 'ABC'[index], label: pitchModes[row.pitchRepair][0], title: pitchModes[row.pitchRepair][1], url: row.url,
  }));
}

export const sidesBadge = (song) => songSides(song).length
  ? `<span class="sides-badge" title="${localPreview && song.id === guideTrial.id ? 'Compare Tony and the original guide vocal' : 'Switch Tony’s pitch setting while it plays'}">A/B</span>` : '';

export function mountSides(root, audio, { safeUrl, onSwitch }) {
  let sides = [], active = 0;
  const draw = () => {
    root.hidden = sides.length < 2;
    root.setAttribute('aria-label', sides[0]?.label === 'Tony' ? 'Compare Tony and guide recordings' : 'Same song, different pitch settings');
    root.innerHTML = sides.map((row, index) => `<button type="button" data-side="${index}" aria-pressed="${index === active}" title="${row.title}">${row.side} · ${row.label}</button>`).join('');
  };
  root.addEventListener('click', async (event) => {
    const index = Number(event.target.closest('[data-side]')?.dataset.side);
    if (!Number.isInteger(index) || index === active || !sides[index]) return;
    const at = audio.currentTime, playing = !audio.paused && !audio.ended;
    active = index; draw();
    audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, Number.isFinite(audio.duration) ? audio.duration : at); } catch { /* Starts from the top instead. */ } }, { once: true });
    audio.src = safeUrl(sides[index].url);
    onSwitch?.(sides[index]);
    if (playing) { try { await audio.play(); } catch { /* The player's own button still works. */ } }
  });
  return { show(song) { sides = songSides(song); active = 0; draw(); } };
}
