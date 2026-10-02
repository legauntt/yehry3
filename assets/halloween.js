import { halloweenSeason } from './season.js';

if (halloweenSeason() && !document.querySelector('.halloween-scene')) {
  const scene = document.createElement('div');
  scene.className = 'halloween-scene';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `<div class="halloween-flock" hidden><span>🦇</span><span>🦇</span><span>🦇</span></div>
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
      flock.hidden = true;
      if (encounter++ % 3 === 2) {
        scare.hidden = false;
        scene.classList.add('is-scare');
        later(() => { scare.hidden = true; scene.classList.remove('is-scare'); schedule(30000); }, 5500);
      } else {
        pass.textContent = ['🧙‍♀️🧹', '👻', '🦇 🦇 🦇'][passNumber++ % 3];
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
    flock.hidden = false;
    flock.style.left = `${Math.max(0, Math.min(innerWidth - 100, event.clientX + 20))}px`;
    flock.style.top = `${Math.max(0, Math.min(innerHeight - 80, event.clientY + 16))}px`;
    later(() => { flock.hidden = true; }, 1800);
  }, { passive: true });
  for (const event of ['pointerdown', 'keydown', 'scroll', 'wheel']) addEventListener(event, () => { flock.hidden = true; wake(); }, { passive: true });
  document.addEventListener('mouseleave', () => { flock.hidden = true; });
  reduced.addEventListener('change', () => { flock.hidden = true; wake(); });
  document.addEventListener('visibilitychange', () => {
    scene.hidden = document.hidden;
    flock.hidden = true;
    wake();
  });
  schedule();
}
