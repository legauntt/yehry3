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
  portrait.innerHTML = `
    <img class="pumpkin-doomer-body" src="/assets/pumpkin-doomer.webp" alt="" width="420" height="397">
    <svg class="pumpkin-morning-detail pumpkin-doomer-lights" viewBox="0 0 420 397" aria-hidden="true">
      <path class="pumpkin-light-wire" d="M72 271 Q115 319 190 316 T310 257 Q331 264 348 306"/>
      <g class="pumpkin-light-bulbs"><circle cx="87" cy="288" r="8"/><circle cx="117" cy="308" r="8"/><circle cx="154" cy="316" r="8"/><circle cx="192" cy="316" r="8"/><circle cx="228" cy="309" r="8"/><circle cx="261" cy="293" r="8"/><circle cx="290" cy="271" r="8"/><circle cx="323" cy="267" r="8"/><circle cx="341" cy="290" r="8"/></g>
    </svg>
    <span class="pumpkin-doomer-head">
      <img src="/assets/pumpkin-doomer.webp" alt="" width="420" height="397">
      <svg class="pumpkin-morning-detail pumpkin-doomer-eyes" viewBox="0 0 420 397" aria-hidden="true">
        <g fill="#f67e81" fill-opacity=".6"><path d="M88 146 Q105 147 124 142 Q121 162 100 161 Q91 158 88 146"/><path d="M162 144 Q183 152 211 149 Q205 166 182 162 Q168 159 162 144"/></g>
        <g fill="none" stroke="#a42132" stroke-width="3" stroke-linecap="round"><path d="M90 150 l10 5 -3 5 M120 148 l-8 6 5 5 M169 151 l10 7 -4 3 M204 153 l-9 3 4 6"/></g>
      </svg>
      <svg class="pumpkin-morning-detail pumpkin-doomer-lights" viewBox="0 0 420 397" aria-hidden="true">
        <path class="pumpkin-light-wire" d="M226 9 Q272 20 286 89 T295 176 Q288 198 270 189"/>
        <g class="pumpkin-light-bulbs"><circle cx="237" cy="14" r="7"/><circle cx="261" cy="31" r="7"/><circle cx="277" cy="61" r="7"/><circle cx="288" cy="96" r="7"/><circle cx="297" cy="132" r="7"/><circle cx="296" cy="167" r="7"/><circle cx="280" cy="191" r="7"/></g>
      </svg>
      <svg class="pumpkin-doomer-smoke" viewBox="0 0 420 397" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M79 215 C65 201 86 192 75 177 C66 165 77 153 70 140"/><path d="M79 215 C91 198 72 183 84 168 C94 156 81 143 91 131"/><path d="M79 215 C70 198 79 185 66 171 C58 163 70 151 63 142"/></g></svg>
      <i class="pumpkin-doomer-ember"></i>
    </span>`;
  return portrait;
}
