// The switch swaps recordings and keeps the listener's place for comparison.
import { pitchModes } from './pitch-repair.js';
import guides from './guide-catalog.js';

export function songSides(song) {
  const original = song?.originalAudio?.url || song?.url;
  const edits = song?.audioEdits?.filter(row => row.sourceUrl === original) || [];
  if (edits.length) {
    const rows = [{ url: original, label: 'Original', title: 'Full original recording' },
      ...edits.map((row, i) => ({ url: row.url, label: `Edit ${i + 1}`, title: `Edited recording · ${row.fade}s fade out` }))];
    const selected = rows.findIndex(row => row.url === song.url);
    if (selected > 0) rows.unshift(...rows.splice(selected, 1));
    if (guides[song.id]?.url) rows.push({ url: guides[song.id].url, label: 'Guide', title: 'Original guide mix' });
    for (const row of song.alternates || []) if (Object.hasOwn(pitchModes, row.pitchRepair)) rows.push({ url: row.url, label: pitchModes[row.pitchRepair][0], title: pitchModes[row.pitchRepair][1] });
    return rows.map((row, i) => ({ ...row, side: String.fromCharCode(65 + i) }));
  }
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
  ? `<span class="sides-badge" title="${song.audioEdits?.length ? 'Choose an edited recording or the full original' : guides[song.id] ? 'Compare Tony and the original guide mix' : 'Switch Tony’s pitch setting while it plays'}">A/B</span>` : '';

export function mountSides(root, audio, { safeUrl, onSwitch }) {
  let sides = [], active = 0;
  const draw = () => {
    root.hidden = sides.length < 2;
    root.setAttribute('aria-label', 'Choose a recording');
    root.innerHTML = sides.map((row, index) => `<button type="button" data-side="${index}" aria-pressed="${index === active}" title="${row.title}">${row.side} · ${row.label}</button>`).join('');
  };
  root.addEventListener('click', async (event) => {
    const index = Number(event.target.closest('[data-side]')?.dataset.side);
    if (!Number.isInteger(index) || index === active || !sides[index]) return;
    const at = audio.currentTime, playing = !audio.paused && !audio.ended;
    active = index; draw();
    audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - .05) : at); } catch { /* Starts from the top instead. */ } }, { once: true });
    audio.src = safeUrl(sides[index].url);
    onSwitch?.(sides[index]);
    if (playing) { try { await audio.play(); } catch { /* The player's own button still works. */ } }
  });
  return { show(song) { sides = songSides(song); active = 0; draw(); } };
}
