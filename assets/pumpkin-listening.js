const morningRoutine = 'distonyc-d59c2b17c667891420654e76';

// season.js is also imported by the Node build, where there is no media player.
if (typeof document !== 'undefined') void import('./player.js').then(({ player, audio }) => {
function sync() {
  const video = document.querySelector('.song-video-viewer[open] video');
  const videoPlaying = video?.dataset.sound === 'true' && !video.paused && !video.ended && !video.error && !video.muted && video.volume > 0;
  const songPlaying = player.playing && !audio.muted && audio.volume > 0;
  const id = videoPlaying ? video.dataset.songId : songPlaying ? player.current?.id : null;
  document.documentElement.dataset.doomerListening = id === morningRoutine ? 'morning' : id ? 'music' : 'idle';
}

// One subscription belongs to the persistent player, rather than each page's mascot.
player.on('change', sync);
for (const event of ['play', 'playing', 'pause', 'ended', 'emptied', 'error', 'volumechange']) {
  audio.addEventListener(event, sync);
  document.addEventListener(event, e => {
    if (e.target.matches?.('.song-video-viewer video')) sync();
  }, true);
}
sync();
});

export function pumpkinPortrait() {
  const portrait = document.createElement('span');
  portrait.className = 'pumpkin-doomer';
  portrait.innerHTML = `<img class="pumpkin-doomer-body" src="/assets/pumpkin-doomer.webp" alt="" width="420" height="397"><span class="pumpkin-doomer-head"><img src="/assets/pumpkin-doomer.webp" alt="" width="420" height="397"><svg class="pumpkin-doomer-smoke" viewBox="0 0 420 397" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M79 215 C65 201 86 192 75 177 C66 165 77 153 70 140"/><path d="M79 215 C91 198 72 183 84 168 C94 156 81 143 91 131"/><path d="M79 215 C70 198 79 185 66 171 C58 163 70 151 63 142"/></g></svg><i class="pumpkin-doomer-ember"></i></span>`;
  return portrait;
}
