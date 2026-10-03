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
  let heading = 0;
  let pointerTime = null;
  let velocityPoint = null;
  let fastUntil = 0;
  let scattered = false;
  const phases = bats.map((_, i) => i / bats.length);
  let mouse = {x:-1000, y:-1000};
  let frame = 0;
  let lastFrame = 0;
  let activePattern = 'trail';
  let patternChanged = 0;
  let docked = true;
  let idleTimer = 0;
  const hideFlock = () => {
    flock.hidden = true;
    cancelAnimationFrame(frame);
    frame = lastFrame = 0;
  };
  const startFlight = () => {
    if (!preferences.enabled || reduced.matches || document.hidden) return hideFlock();
    flock.hidden = false;
    if (!frame) frame = requestAnimationFrame(fly);
  };
  const dockFlock = () => {
    clearTimeout(idleTimer);
    docked = true;
    pointerTime = null;
    trail.length = 0;
    startFlight();
  };
  addEventListener('yehry3:bats', () => { applyPreferences(); startFlight(); });
  const fly = now => {
    // Cap decorative JavaScript updates at 30 Hz; wings animate independently.
    if (lastFrame && now - lastFrame < 32) {
      frame = requestAnimationFrame(fly);
      return;
    }
    const elapsed = lastFrame ? Math.min(now - lastFrame, 100) : 33;
    const blend = 1 - Math.exp(-elapsed / (docked ? 300 : 120));
    if (preferences.pattern !== 'random') activePattern = preferences.pattern;
    else if (!patternChanged || now - patternChanged > 5000) {
      const choices = ['trail', 'circle', 'eight', 'spiral'].filter(name => name !== activePattern);
      activePattern = choices[Math.floor(Math.random() * choices.length)];
      patternChanged = now;
    }
    flock.dataset.pattern = activePattern;
    flock.dataset.docked = String(docked);
    flock.dataset.flight = docked ? 'sleep' : scattered ? 'scatter' : 'trail';
    if (!docked && !scattered) {
      trail.unshift({x:mouse.x, y:mouse.y, heading, time:now});
      while (trail.length > 1 && now - trail.at(-1).time > 4300) trail.pop();
    }
    let sample = 0;
    let settled = docked;
    bats.forEach((node, i) => {
      const size = (14 + (i * 7 % 15)) * 1.5 * preferences.size;
      const padding = size * .6 + 8;
      const width = Math.max(1, innerWidth - padding * 2);
      const height = Math.max(1, innerHeight - padding * 2);
      const perimeter = (width + height) * 2;
      let x = padding + width * (i + .5) / bats.length;
      let y = padding;
      if (!docked && scattered) {
        // Patterns vary the edge route, never pull the flock back to the cursor.
        const direction = activePattern === 'eight' && i % 2 ? -1 : 1;
        const pace = activePattern === 'spiral' ? 1 + .3 * Math.sin(now * .001 + i) : 1;
        phases[i] = (phases[i] + direction * elapsed * .00008 * pace + 1) % 1;
        let distance = ((phases[i] + i * .015 * (preferences.spacing - 1) + 1) % 1) * perimeter;
        if (distance < width) { x = padding + distance; y = padding; }
        else if ((distance -= width) < height) { x = innerWidth - padding; y = padding + distance; }
        else if ((distance -= height) < width) { x = innerWidth - padding - distance; y = innerHeight - padding; }
        else { x = padding; y = innerHeight - padding - (distance - width); }
        const separation = 180;
        if (Math.hypot(x - mouse.x, y - mouse.y) < separation) {
          // Scatter along the border away from the pointer.
          if (y === padding || y === innerHeight - padding) x = mouse.x + (x >= mouse.x ? separation : -separation);
          else y = mouse.y + (y >= mouse.y ? separation : -separation);
          x = Math.max(padding, Math.min(innerWidth - padding, x));
          y = Math.max(padding, Math.min(innerHeight - padding, y));
          const escapeDistance = y === padding ? x - padding
            : x === innerWidth - padding ? width + y - padding
            : y === innerHeight - padding ? width + height + innerWidth - padding - x
            : perimeter - (y - padding);
          // Retain the escape point so a route cannot flip to the cursor's other side.
          phases[i] = escapeDistance / perimeter - i * .015 * (preferences.spacing - 1);
        }
      }
      if (!docked && !scattered) {
        const delay = i * 55 * preferences.spacing;
        while (sample + 1 < trail.length && now - trail[sample].time < delay) sample++;
        const point = trail[sample];
        const behind = 38 + i * 45 * preferences.spacing;
        const wave = Math.sin(now * .0035 - i * .25) * (12 + i * .3);
        x = point.x - Math.cos(point.heading) * behind - Math.sin(point.heading) * wave;
        y = point.y - Math.sin(point.heading) * behind + Math.cos(point.heading) * wave;
      }
      x = Math.max(padding, Math.min(innerWidth - padding, x));
      y = Math.max(padding, Math.min(innerHeight - padding, y));
      const position = positions[i] ||= {x,y};
      position.x += (x - position.x) * blend;
      position.y += (y - position.y) * blend;
      position.x = Math.max(padding, Math.min(innerWidth - padding, position.x));
      position.y = Math.max(padding, Math.min(innerHeight - padding, position.y));
      const arrived = Math.hypot(x - position.x, y - position.y) < .5;
      if (!arrived) settled = false;
      const sleeping = docked && arrived;
      if (sleeping) { position.x = x; position.y = y; }
      node.classList.toggle('is-sleeping', sleeping);
      node.style.transform = `translate3d(${position.x.toFixed(1)}px,${position.y.toFixed(1)}px,0) rotate(${sleeping ? 180 : (Math.sin(now * .004 - i * .25) * 15).toFixed(1)}deg)`;
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
    if (scene.classList.contains('is-weaving')) {
      scene.classList.remove('is-weaving');
      scene.querySelector('.halloween-weaving').pauseAnimations();
      scene.querySelector('.halloween-weaving').setCurrentTime(0);
    }
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
    if (event.clientX === mouse.x && event.clientY === mouse.y) return;
    const now = performance.now();
    const dx = event.clientX - mouse.x, dy = event.clientY - mouse.y;
    const distance = Math.hypot(dx, dy);
    // Sample across at least 16 ms so high-rate mice do not look artificially slow.
    const elapsed = pointerTime === null ? 0 : now - pointerTime;
    const travel = velocityPoint ? Math.hypot(event.clientX - velocityPoint.x, event.clientY - velocityPoint.y) : 0;
    const speed = pointerTime !== null && (elapsed >= 16 || travel > 40)
      ? travel * 1000 / Math.max(16, Math.min(100, elapsed)) : null;
    if (distance > 2 && pointerTime !== null) heading = Math.atan2(dy, dx);
    if (pointerTime === null || speed !== null) {
      pointerTime = now;
      velocityPoint = {x:event.clientX, y:event.clientY};
    }
    const wasScattered = scattered;
    if (speed !== null && speed > 650) {
      scattered = true;
      fastUntil = now + 350;
    } else if (speed !== null && speed < 250 && now >= fastUntil) scattered = false;
    if (docked && speed === null) scattered = false;
    mouse = {x:event.clientX, y:event.clientY};
    if (!wasScattered && scattered) positions.forEach((position, i) => {
      const padding = (14 + (i * 7 % 15)) * 1.5 * preferences.size * .6 + 8;
      const width = Math.max(1, innerWidth - padding * 2);
      const height = Math.max(1, innerHeight - padding * 2);
      const originX = Math.max(padding, Math.min(innerWidth - padding, mouse.x));
      const originY = Math.max(padding, Math.min(innerHeight - padding, mouse.y));
      const angle = Math.atan2(position.y - mouse.y, position.x - mouse.x) + .8 * Math.sin(i * 1.7);
      const vx = Math.cos(angle), vy = Math.sin(angle);
      const reach = Math.min(vx > 0 ? (innerWidth-padding-originX)/vx : vx < 0 ? (padding-originX)/vx : Infinity,
        vy > 0 ? (innerHeight-padding-originY)/vy : vy < 0 ? (padding-originY)/vy : Infinity);
      const x = originX + vx * reach, y = originY + vy * reach;
      const edge = Math.abs(y-padding) < .1 ? x-padding : Math.abs(x-(innerWidth-padding)) < .1 ? width+y-padding
        : Math.abs(y-(innerHeight-padding)) < .1 ? width+height+innerWidth-padding-x : (width+height)*2-(y-padding);
      phases[i] = edge / ((width+height)*2) - i * .015 * (preferences.spacing-1);
    });
    if (docked && !scattered) positions.forEach((position, i) => {
      const padding = (14 + (i * 7 % 15)) * 1.5 * preferences.size * .6 + 8;
      const width = Math.max(1, innerWidth - padding * 2);
      const height = Math.max(1, innerHeight - padding * 2);
      // Take off along the ceiling rather than cutting across the page.
      phases[i] = Math.max(0, Math.min(width, position.x - padding)) / ((width + height) * 2) - i * .015 * (preferences.spacing - 1);
    });
    docked = false;
    startFlight();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(dockFlock, 2200);
  }, { passive: true });
  for (const event of ['pointerdown', 'keydown', 'scroll', 'wheel']) addEventListener(event, wake, { passive: true });
  document.addEventListener('mouseleave', dockFlock);
  addEventListener('resize', startFlight, { passive: true });
  reduced.addEventListener('change', () => { dockFlock(); wake(); });
  document.addEventListener('visibilitychange', () => {
    scene.hidden = document.hidden;
    dockFlock();
    wake();
  });
  wake();
  dockFlock();
}
