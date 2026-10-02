import { halloweenSeason } from './season.js';

if (halloweenSeason() && !document.querySelector('.halloween-scene')) {
  // Simple vector silhouettes keep a hundred independently moving bats inexpensive.
  const bat = `<svg viewBox="0 0 80 44" class="halloween-bat-shape"><path class="bat-wing wing-left" d="M38 21Q23 5 2 3L9 29Q17 20 22 34Q30 27 37 38Z"/><path class="bat-wing wing-right" d="M42 21Q57 5 78 3L71 29Q63 20 58 34Q50 27 43 38Z"/><path d="M34 17L33 8L40 13L47 8L46 17Q53 32 40 43Q27 32 34 17Z"/></svg>`;
  const witch = `<svg class="halloween-witch" viewBox="0 0 300 180"><g fill="#000"><path d="M85 66L112 7L130 54L155 64L143 73L70 73Z"/><path d="M70 69Q115 51 156 68Q121 81 70 69Z"/><path d="M109 74Q134 69 136 85L149 93L135 97Q137 111 117 112L107 94Z"/><path d="M112 104Q82 110 79 132L53 151Q93 165 128 145L159 138L175 152L185 145L159 120L130 121Z"/><path d="M128 106L155 111L184 95L191 102L160 124L125 118Z"/><path d="M24 148L254 120L258 129L25 157Z"/><path d="M232 124L282 97L270 123L297 110L281 136L300 134L269 159L232 133Z"/></g></svg>`;
  const scene = document.createElement('div');
  scene.className = 'halloween-scene';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `<div class="halloween-flock" hidden>${Array.from({length:100}, (_, i) => `<span class="halloween-swarm-bat" style="--bat-size:${14 + (i * 7 % 15)}px;--wing-speed:${.22 + (i % 7) * .025}s;--wing-delay:${-i * .037}s">${bat}</span>`).join('')}</div>
    <div class="halloween-pass" hidden></div>
    <div class="halloween-scare" hidden><svg class="halloween-lightning" viewBox="0 0 1000 800" preserveAspectRatio="none"><path d="M220 0L160 230L270 205L110 530L190 300L90 330L220 0ZM810 0L700 270L820 240L680 650L750 350L640 380L810 0Z"/></svg>
      <div class="halloween-laugh"><svg class="halloween-face" viewBox="0 0 400 380"><path fill="#598031" d="M184 73Q176 30 211 12L232 30Q202 41 215 77Z"/><path fill="#e96b0c" stroke="#ffad32" stroke-width="5" d="M200 73C74 29 10 120 26 232C37 333 112 371 200 344C288 371 363 333 374 232C390 120 326 29 200 73Z"/><path fill="none" stroke="#a83c09" stroke-width="6" d="M157 80Q82 198 155 341M243 80Q318 198 245 341M200 85V339"/><g fill="#fff09a" stroke="#4e1709" stroke-width="7" stroke-linejoin="round"><path d="M81 176L145 126L161 191Z M319 176L255 126L239 191Z M200 184L180 219H220Z"/><path class="halloween-mouth" d="M78 238L116 254L135 236L157 266L183 252L200 275L218 252L244 266L266 236L285 254L322 238Q295 329 200 326Q105 329 78 238Z"/></g></svg><span class="halloween-ha ha-left">HA!</span><span class="halloween-ha ha-right">HA HA!</span></div>
      <span class="halloween-dismiss">Move your mouse or tap to escape</span></div>`;
  document.body.append(scene);
  const flock = scene.querySelector('.halloween-flock');
  const pass = scene.querySelector('.halloween-pass');
  const scare = scene.querySelector('.halloween-scare');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Set();
  const bats = [...flock.children];
  const positions = [];
  const trail = [];
  let mouse = {x:0, y:0};
  let heading = 0;
  let frame = 0;
  let lastFrame = 0;
  const hideFlock = () => {
    flock.hidden = true;
    cancelAnimationFrame(frame);
    frame = 0;
    trail.length = 0;
    positions.length = 0;
    lastFrame = 0;
  };
  const fly = now => {
    const blend = lastFrame ? 1 - Math.exp(-Math.min(now - lastFrame, 50) / 55) : 1;
    // Time-based history keeps the same slinky shape at 60 or 144 Hz.
    trail.unshift({x:mouse.x, y:mouse.y, heading, time:now});
    while (trail.length > 1 && now - trail.at(-1).time > 1700) trail.pop();
    let sample = 0;
    bats.forEach((node, i) => {
      const delay = i * 14;
      while (sample + 1 < trail.length && now - trail[sample].time < delay) sample++;
      const point = trail[sample];
      const wave = Math.sin(now * .0035 - i * .25) * (12 + i * .3);
      const behind = 28 + i * 5.5;
      const x = point.x - Math.cos(point.heading) * behind - Math.sin(point.heading) * wave;
      const y = point.y - Math.sin(point.heading) * behind + Math.cos(point.heading) * wave;
      const position = positions[i] ||= {x,y};
      position.x += (x - position.x) * blend;
      position.y += (y - position.y) * blend;
      node.style.transform = `translate3d(${position.x.toFixed(1)}px,${position.y.toFixed(1)}px,0) rotate(${(Math.sin(now * .004 - i * .25) * 15).toFixed(1)}deg)`;
    });
    lastFrame = now;
    frame = requestAnimationFrame(fly);
  };
  let encounter = 0;
  let passNumber = 0;
  const later = (callback, delay) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  };
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    pass.hidden = scare.hidden = true;
    scene.classList.remove('is-scare');
    pass.classList.remove('is-flying');
  };
  const schedule = (delay = 8000) => {
    if (document.hidden || reduced.matches) return;
    later(() => {
      hideFlock();
      if (encounter++ % 3 === 2) {
        scare.hidden = false;
        scene.classList.add('is-scare');
        later(() => { scare.hidden = true; scene.classList.remove('is-scare'); schedule(30000); }, 5500);
      } else {
        const kind = passNumber++ % 3;
        pass.innerHTML = kind === 0 ? witch : kind === 1 ? '👻' : `<div class="halloween-pass-bats">${bat.repeat(7)}</div>`;
        pass.style.top = `${20 + Math.random() * 45}%`;
        pass.classList.toggle('from-right', passNumber % 2 === 0);
        pass.hidden = false;
        pass.classList.add('is-flying');
        later(() => { pass.hidden = true; pass.classList.remove('is-flying'); schedule(); }, 6500);
      }
    }, delay);
  };
  const wake = () => { clear(); schedule(); };
  addEventListener('pointermove', event => {
    wake();
    if (event.pointerType !== 'mouse' || reduced.matches || document.hidden) return;
    const dx = event.clientX - mouse.x;
    const dy = event.clientY - mouse.y;
    if (Math.hypot(dx, dy) > 2) heading = Math.atan2(dy, dx);
    mouse = {x:event.clientX, y:event.clientY};
    flock.hidden = false;
    if (!frame) frame = requestAnimationFrame(fly);
    later(hideFlock, 2200);
  }, { passive: true });
  for (const event of ['pointerdown', 'keydown', 'scroll', 'wheel']) addEventListener(event, () => { hideFlock(); wake(); }, { passive: true });
  document.addEventListener('mouseleave', hideFlock);
  reduced.addEventListener('change', () => { hideFlock(); wake(); });
  document.addEventListener('visibilitychange', () => {
    scene.hidden = document.hidden;
    hideFlock();
    wake();
  });
  schedule();
}
