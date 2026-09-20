// A song can carry a B side: the same song, sung again with another pitch setting for Tony's voice.
// The switch swaps recordings and keeps the listener's place, so the two can be compared mid-line.
import { pitchModes } from './pitch-repair.js';

export function songSides(song) {
  if (!song || !Object.hasOwn(pitchModes, song.pitchRepair) || !Array.isArray(song.alternates)) return [];
  const others = song.alternates.filter((row) => row && typeof row.url === 'string' && Object.hasOwn(pitchModes, row.pitchRepair) && row.pitchRepair !== song.pitchRepair).slice(0, 2);
  if (!others.length) return [];
  return [{ pitchRepair: song.pitchRepair, url: song.url }, ...others].map((row, index) => ({ side: 'ABC'[index], pitchRepair: row.pitchRepair, url: row.url }));
}

export const sidesBadge = (song) => songSides(song).length
  ? '<span class="sides-badge" title="Two recordings of this song: switch Tony’s pitch setting while it plays">A/B</span>' : '';

export function mountSides(root, audio, { safeUrl, onSwitch }) {
  let sides = [], active = 0;
  const draw = () => {
    root.hidden = sides.length < 2;
    root.innerHTML = sides.map((row, index) => `<button type="button" data-side="${index}" aria-pressed="${index === active}" title="${pitchModes[row.pitchRepair][1]}">${row.side} · ${pitchModes[row.pitchRepair][0]}</button>`).join('');
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
