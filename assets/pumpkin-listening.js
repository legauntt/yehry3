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
    <span class="pumpkin-doomer-head">
      <img src="/assets/pumpkin-doomer.webp" alt="" width="420" height="397">
      <svg class="pumpkin-morning-detail pumpkin-doomer-eyes" viewBox="0 0 420 397" aria-hidden="true">
        <g fill="#f67e81" fill-opacity=".6"><path d="M88 146 Q105 147 124 142 Q121 162 100 161 Q91 158 88 146"/><path d="M162 144 Q183 152 211 149 Q205 166 182 162 Q168 159 162 144"/></g>
        <g fill="none" stroke="#a42132" stroke-width="3" stroke-linecap="round"><path d="M90 150 l10 5 -3 5 M120 148 l-8 6 5 5 M169 151 l10 7 -4 3 M204 153 l-9 3 4 6"/></g>
      </svg>
      <svg class="pumpkin-morning-detail pumpkin-doomer-mouth" viewBox="0 0 420 397" aria-hidden="true">
        <path d="M108 192 L124 199 L133 193 L145 201 L159 197 L172 206 L188 201 Q182 231 151 234 Q121 231 108 192Z" fill="#241007" stroke="#71300d" stroke-width="3" stroke-linejoin="round"/>
        <path class="pumpkin-candle-glow" d="M113 197 L124 203 L133 197 L145 205 L159 201 L172 210 L183 207 Q177 228 151 230 Q126 228 113 197Z" fill="#ff9c24"/>
        <path d="M142 215 Q149 213 156 215 L158 230 L142 230Z" fill="#ffe5a0"/>
        <path d="M143 215 L143 221 Q146 224 148 219 L148 216" fill="none" stroke="#fff2ce" stroke-width="2"/>
        <path d="M149 215 L149 211" stroke="#3b2010" stroke-width="2"/>
        <g class="pumpkin-candle-flame">
          <path d="M149 214 C135 209 146 203 150 194 C151 201 163 209 149 214Z" fill="#ffb52e"/>
          <path d="M149 213 C143 210 149 205 150 203 C154 208 155 212 149 213Z" fill="#fff5be"/>
        </g>
        <path d="M124 199 L133 193 L137 205 L126 205Z M157 222 L165 220 L167 230 L157 233Z" fill="#dd751d" stroke="#71300d" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <svg class="pumpkin-doomer-smoke" viewBox="0 0 420 397" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M79 215 C65 201 86 192 75 177 C66 165 77 153 70 140"/><path d="M79 215 C91 198 72 183 84 168 C94 156 81 143 91 131"/><path d="M79 215 C70 198 79 185 66 171 C58 163 70 151 63 142"/></g></svg>
      <i class="pumpkin-doomer-ember"></i>
    </span>`;
  return portrait;
}
