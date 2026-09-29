// The switch swaps recordings and keeps the listener's place for comparison.
import { pitchModes } from './pitch-repair.js';
import guides from './guide-catalog.js';

export function songSides(song) {
  const guide = song && guides[song.id];
  if (guide?.url && typeof song.url === 'string')
    return [
      { side: 'A', label: 'Tony', title: 'Final recording with Tony’s voice', url: song.url },
      { side: 'B', label: 'Guide', title: 'Original mix before Tony’s vocal replacement', url: guide.url },
    ];
  if (!song || !Object.hasOwn(pitchModes, song.pitchRepair) || !Array.isArray(song.alternates)) return [];
  const others = song.alternates.filter((row) => row && typeof row.url === 'string' && Object.hasOwn(pitchModes, row.pitchRepair) && row.pitchRepair !== song.pitchRepair).slice(0, 2);
  if (!others.length) return [];
  return [{ pitchRepair: song.pitchRepair, url: song.url }, ...others].map((row, index) => ({
    side: 'ABC'[index], label: pitchModes[row.pitchRepair][0], title: pitchModes[row.pitchRepair][1], url: row.url,
  }));
}

export const sidesBadge = (song) => songSides(song).length
  ? `<span class="sides-badge" title="${guides[song.id] ? 'Compare Tony and the original guide mix' : 'Switch Tony’s pitch setting while it plays'}">A/B</span>` : '';

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
