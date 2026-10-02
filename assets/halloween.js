import { halloweenSeason } from './season.js';

if (halloweenSeason() && !document.querySelector('.halloween-scene')) {
  const scene = document.createElement('div');
  scene.className = 'halloween-scene';
  scene.setAttribute('aria-hidden', 'true');
  const web = '<svg viewBox="0 0 150 150" fill="none" stroke="currentColor"><path d="M0 0L145 145M0 0L150 50M0 0L50 150M0 0H150M0 0V150M0 35Q16 26 34 12Q39 4 40 0M0 70Q33 54 68 23Q76 8 80 0M0 105Q50 81 102 34Q114 12 120 0M35 0Q26 16 12 34Q4 39 0 40M70 0Q54 33 23 68Q8 76 0 80M105 0Q81 50 34 102Q12 114 0 120"/></svg>';
  scene.innerHTML = `<div class="halloween-web web-left">${web}</div><div class="halloween-web web-right">${web}</div><span class="halloween-spider">🕷️</span><span class="halloween-bat bat-one">🦇</span><span class="halloween-bat bat-two">🦇</span><span class="halloween-pumpkin">🎃</span><span class="halloween-skeleton">💀<br>🦴</span><span class="halloween-witch" hidden>🧙‍♀️🧹</span>`;
  document.body.append(scene);
  const witch = scene.querySelector('.halloween-witch');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let idleTimer;
  const wake = () => {
    scene.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (!document.hidden) idleTimer = setTimeout(() => scene.classList.add('is-idle'), 6000);
  };
  addEventListener('pointermove', event => {
    wake();
    if (event.pointerType !== 'mouse' || reduced.matches) return;
    witch.hidden = false;
    witch.style.left = `${Math.max(0, Math.min(innerWidth - 76, event.clientX + 22))}px`;
    witch.style.top = `${Math.max(0, Math.min(innerHeight - 48, event.clientY + 22))}px`;
  }, { passive: true });
  for (const event of ['pointerdown', 'keydown', 'scroll']) addEventListener(event, wake, { passive: true });
  document.addEventListener('mouseleave', () => { witch.hidden = true; });
  reduced.addEventListener('change', () => { if (reduced.matches) witch.hidden = true; });
  document.addEventListener('visibilitychange', () => {
    scene.hidden = document.hidden;
    witch.hidden = true;
    wake();
  });
  wake();
}
