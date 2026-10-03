import { halloweenSeason } from './season.js';
import { getBatPreferences } from './bat-preferences.js';

if (halloweenSeason() && !document.querySelector('.halloween-scene')) {
  // A small flock leaves the page readable while the wings beat independently.
  const bat = `<svg viewBox="0 0 80 44" class="halloween-bat-shape"><path class="bat-wing wing-left" d="M38 21Q23 5 2 3L9 29Q17 20 22 34Q30 27 37 38Z"/><path class="bat-wing wing-right" d="M42 21Q57 5 78 3L71 29Q63 20 58 34Q50 27 43 38Z"/><path d="M34 17L33 8L40 13L47 8L46 17Q53 32 40 43Q27 32 34 17Z"/></svg>`;
  const witch = `<svg class="halloween-witch" viewBox="0 0 300 180"><g fill="#000"><path d="M85 66L112 7L130 54L155 64L143 73L70 73Z"/><path d="M70 69Q115 51 156 68Q121 81 70 69Z"/><path d="M109 74Q134 69 136 85L149 93L135 97Q137 111 117 112L107 94Z"/><path d="M112 104Q82 110 79 132L53 151Q93 165 128 145L159 138L175 152L185 145L159 120L130 121Z"/><path d="M128 106L155 111L184 95L191 102L160 124L125 118Z"/><path d="M24 148L254 120L258 129L25 157Z"/><path d="M232 124L282 97L270 123L297 110L281 136L300 134L269 159L232 133Z"/></g></svg>`;
  const scene = document.createElement('div');
  scene.className = 'halloween-scene';
  scene.setAttribute('aria-hidden', 'true');
  const web = '<svg viewBox="0 0 150 150" fill="none" stroke="currentColor"><path d="M0 0L145 145M0 0L150 50M0 0L50 150M0 0H150M0 0V150M0 35Q16 26 34 12Q39 4 40 0M0 70Q33 54 68 23Q76 8 80 0M0 105Q50 81 102 34Q114 12 120 0M35 0Q26 16 12 34Q4 39 0 40M70 0Q54 33 23 68Q8 76 0 80M105 0Q81 50 34 102Q12 114 0 120"/></svg>';
  // Spokes and curved rings are drawn progressively from three spider stations.
  const woven = [[180,180,240],[740,270,340],[420,590,300]].map(([x,y,r], index) => {
    const point = (angle, radius) => `${(x + Math.cos(angle) * radius).toFixed(1)} ${(y + Math.sin(angle) * radius).toFixed(1)}`;
    const spokes = Array.from({length:10}, (_, i) => `M${x} ${y}L${point(i * Math.PI / 5, r)}`).join('');
    const rings = [.25,.5,.75,1].map(scale => Array.from({length:10}, (_, i) => {
      const angle = i * Math.PI / 5;
      return `${i ? 'L' : 'M'}${point(angle, r * scale)}Q${point(angle + Math.PI / 10, r * scale * .86)} ${point(angle + Math.PI / 5, r * scale)}`;
    }).join('') + 'Z').join('');
    const route = `M${x} ${y}L${point(0,r)}L${point(Math.PI / 5,r)}L${x} ${y}L${point(Math.PI * .8,r)}L${point(Math.PI,r)}L${x} ${y}`;
    return `<g class="halloween-woven-web"><path class="web-thread" pathLength="1" d="${spokes}${rings}"/><g class="halloween-weaver"><ellipse rx="5" ry="7"/><path d="M-4 -4L-11 -9M-5 0L-13 -2M-5 4L-12 9M4 -4L11 -9M5 0L13 -2M5 4L12 9"/><animateMotion dur="25s" begin="indefinite" fill="freeze" path="${route}"/></g></g>`;
  }).join('');
  scene.innerHTML = `<div class="halloween-web web-left">${web}</div><div class="halloween-web web-right">${web}</div><span class="halloween-spider">🕷️</span><svg class="halloween-weaving" viewBox="0 0 1000 700" preserveAspectRatio="none">${woven}</svg>
    <div class="halloween-flock" hidden>${Array.from({length:24}, () => `<span class="halloween-swarm-bat">${bat}</span>`).join('')}</div>
    <div class="halloween-pass" hidden></div>
    <div class="halloween-scare" hidden><svg class="halloween-lightning" viewBox="0 0 1000 800" preserveAspectRatio="none"><path d="M220 0L160 230L270 205L110 530L190 300L90 330L220 0ZM810 0L700 270L820 240L680 650L750 350L640 380L810 0Z"/></svg>
      <div class="halloween-laugh"><svg class="halloween-face" viewBox="0 0 400 380"><path fill="#598031" d="M184 73Q176 30 211 12L232 30Q202 41 215 77Z"/><path fill="#e96b0c" stroke="#ffad32" stroke-width="5" d="M200 73C74 29 10 120 26 232C37 333 112 371 200 344C288 371 363 333 374 232C390 120 326 29 200 73Z"/><path fill="none" stroke="#a83c09" stroke-width="6" d="M157 80Q82 198 155 341M243 80Q318 198 245 341M200 85V339"/><g fill="#fff09a" stroke="#4e1709" stroke-width="7" stroke-linejoin="round"><path d="M81 176L145 126L161 191Z M319 176L255 126L239 191Z M200 184L180 219H220Z"/><path class="halloween-mouth" d="M78 238L116 254L135 236L157 266L183 252L200 275L218 252L244 266L266 236L285 254L322 238Q295 329 200 326Q105 329 78 238Z"/></g></svg><span class="halloween-ha ha-left">HA!</span><span class="halloween-ha ha-right">HA HA!</span></div>
      <span class="halloween-dismiss">Move your mouse or tap to escape</span></div>`;
  document.body.append(scene);
  scene.querySelectorAll('.halloween-woven-web').forEach((node, index) => node.style.setProperty('--weave-delay', `${index * 5}s`));
  const flock = scene.querySelector('.halloween-flock');
  const pass = scene.querySelector('.halloween-pass');
  const scare = scene.querySelector('.halloween-scare');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Set();
  const bats = [...flock.children];
  let preferences = getBatPreferences();
  const applyPreferences = () => {
    preferences = getBatPreferences();
    bats.forEach((node, i) => {
      node.style.setProperty('--bat-size', `${(14 + (i * 7 % 15)) * 1.5 * preferences.size}px`);
      node.style.setProperty('--wing-speed', `${(.16 + (i % 7) * .015) / preferences.speed}s`);
      node.style.setProperty('--wing-delay', `${-i * .037}s`);
    });
  };
  applyPreferences();
  const positions = [];
  const trail = [];
  let mouse = {x:0, y:0};
  let heading = 0;
  let frame = 0;
  let lastFrame = 0;
  let activePattern = 'trail';
  let patternChanged = 0;
  let scatter = 0;
  let scatterUntil = 0;
  let docked = true;
  const hideFlock = () => {
    flock.hidden = true;
    cancelAnimationFrame(frame);
    frame = 0;
    trail.length = 0;
    positions.length = 0;
    lastFrame = 0;
    patternChanged = 0;
    scatter = 0;
    scatterUntil = 0;
  };
  const dockFlock = () => {
    docked = true;
    scatter = 0;
    scatterUntil = 0;
    trail.length = 0;
    if (!preferences.enabled || reduced.matches || document.hidden) return hideFlock();
    flock.hidden = false;
    if (!frame) frame = requestAnimationFrame(fly);
  };
  addEventListener('yehry3:bats', () => { applyPreferences(); if (!preferences.enabled) hideFlock(); else if (!frame) dockFlock(); });
  const fly = now => {
    const blend = lastFrame ? 1 - Math.exp(-Math.min(now - lastFrame, 50) / 55) : 1;
    if (lastFrame && now > scatterUntil) scatter *= Math.exp(-Math.min(now - lastFrame, 50) / 160);
    if (preferences.pattern !== 'random') activePattern = preferences.pattern;
    else if (!patternChanged || now - patternChanged > 5000) {
      const choices = ['trail', 'circle', 'eight', 'spiral'].filter(name => name !== activePattern);
      activePattern = choices[Math.floor(Math.random() * choices.length)];
      patternChanged = now;
    }
    flock.dataset.pattern = activePattern;
    flock.dataset.docked = String(docked);
    // Time-based history keeps the same slinky shape at 60 or 144 Hz.
    trail.unshift({x:mouse.x, y:mouse.y, heading, time:now});
    while (trail.length > 1 && now - trail.at(-1).time > 4300) trail.pop();
    let sample = 0;
    let settled = docked;
    bats.forEach((node, i) => {
      const delay = i * 55 * preferences.spacing;
      while (sample + 1 < trail.length && now - trail[sample].time < delay) sample++;
      const point = trail[sample];
      const wave = Math.sin(now * .0035 - i * .25) * (12 + i * .3);
      const behind = 38 + i * 45 * preferences.spacing;
      let x = point.x - Math.cos(point.heading) * behind - Math.sin(point.heading) * wave;
      let y = point.y - Math.sin(point.heading) * behind + Math.cos(point.heading) * wave;
      if (activePattern !== 'trail') {
        // Three loose rings keep the flock spaced around the pointer, with a clear center.
        const ring = Math.floor(i / 8);
        const angle = now * .0012 * (ring === 1 ? -1 : 1) + (i % 8) * Math.PI / 4 + ring * .3;
        const radius = (85 + ring * 55) * preferences.spacing;
        const reach = activePattern === 'spiral' ? radius * (1 + .22 * Math.sin(now * .0015 + ring)) : radius;
        x = mouse.x + Math.cos(angle) * reach;
        y = mouse.y + (activePattern === 'eight' ? Math.sin(angle * 2) * reach * .6 : Math.sin(angle) * reach);
        // Send each bat along its own ray to the viewport border, then regroup.
        const escape = angle + .65 * Math.sin(i * 1.7 + heading);
        const padding = (14 + (i * 7 % 15)) * 1.5 * preferences.size * .6 + 8;
        const originX = Math.max(padding, Math.min(innerWidth - padding, mouse.x));
        const originY = Math.max(padding, Math.min(innerHeight - padding, mouse.y));
        const dx = Math.cos(escape), dy = Math.sin(escape);
        const distance = Math.min(
          dx === 0 ? Infinity : dx > 0 ? (innerWidth - padding - originX) / dx : (padding - originX) / dx,
          dy === 0 ? Infinity : dy > 0 ? (innerHeight - padding - originY) / dy : (padding - originY) / dy
        );
        x += (originX + dx * distance - x) * scatter;
        y += (originY + dy * distance - y) * scatter;
      }
      const padding = (14 + (i * 7 % 15)) * 1.5 * preferences.size * .6 + 8;
      if (docked) {
        x = i % 2 ? innerWidth - padding : padding;
        y = innerHeight * (Math.floor(i / 2) + 1) / 13;
      }
      x = Math.max(padding, Math.min(innerWidth - padding, x));
      y = Math.max(padding, Math.min(innerHeight - padding, y));
      const position = positions[i] ||= {x,y};
      position.x += (x - position.x) * blend;
      position.y += (y - position.y) * blend;
      // Resizing must not strand bats beyond the new viewport.
      position.x = Math.max(padding, Math.min(innerWidth - padding, position.x));
      position.y = Math.max(padding, Math.min(innerHeight - padding, position.y));
      if (Math.hypot(x - position.x, y - position.y) > .1) settled = false;
      node.style.transform = `translate3d(${position.x.toFixed(1)}px,${position.y.toFixed(1)}px,0) rotate(${(Math.sin(now * .004 - i * .25) * 15).toFixed(1)}deg)`;
    });
    lastFrame = settled ? 0 : now;
    frame = settled ? 0 : requestAnimationFrame(fly);
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
    scene.classList.remove('is-weaving');
    scene.querySelector('.halloween-weaving').pauseAnimations();
    scene.querySelector('.halloween-weaving').setCurrentTime(0);
  };
  const schedule = (delay = 8000) => {
    if (document.hidden || reduced.matches) return;
    later(() => {
      dockFlock();
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
  const wake = () => {
    clear(); schedule();
    if (!document.hidden && !reduced.matches) later(() => {
      scene.classList.add('is-weaving');
      const canvas = scene.querySelector('.halloween-weaving');
      canvas.unpauseAnimations();
      canvas.querySelectorAll('animateMotion').forEach(node => node.beginElement());
    }, 6000);
  };
  addEventListener('pointermove', event => {
    wake();
    if (event.pointerType !== 'mouse' || reduced.matches || document.hidden || !preferences.enabled) return;
    const dx = event.clientX - mouse.x;
    const dy = event.clientY - mouse.y;
    if (frame && !docked && activePattern !== 'trail' && Math.hypot(dx, dy) > 0) {
      scatter = Math.min(1, scatter + Math.hypot(dx, dy) / 30);
      scatterUntil = performance.now() + 450;
    }
    if (Math.hypot(dx, dy) > 2) heading = Math.atan2(dy, dx);
    mouse = {x:event.clientX, y:event.clientY};
    docked = false;
    flock.hidden = false;
    if (!frame) frame = requestAnimationFrame(fly);
    later(dockFlock, 2200);
  }, { passive: true });
  for (const event of ['pointerdown', 'keydown', 'scroll', 'wheel']) addEventListener(event, () => { dockFlock(); wake(); }, { passive: true });
  document.addEventListener('mouseleave', dockFlock);
  addEventListener('resize', () => { if (docked) dockFlock(); }, { passive: true });
  reduced.addEventListener('change', () => { dockFlock(); wake(); });
  document.addEventListener('visibilitychange', () => {
    scene.hidden = document.hidden;
    dockFlock();
    wake();
  });
  wake();
  dockFlock();
}
