import { currentScope } from "./page-scope.js";
import { getRecordPreferences, watchRecordPreferences } from "./record-preferences.js";

export function startRecordMotion(record, audio) {
  if (!record) return;
  const scope = currentScope();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  record.tabIndex = 0;
  record.setAttribute("role", "button");
  record.setAttribute("aria-label", "Spin the record");
  record.setAttribute("title", "Click again to spin faster");
  record.dataset.motion = motion.matches ? "reduced" : "active";
  let timer;
  let clickAnimation;
  let coastFrame;
  let introFrame;
  let introPending = true;
  let lastClickAt = 0;
  let lastCoastAt = 0;
  let lastActivity = performance.now();
  let restingAngle = 0;
  let preferences = getRecordPreferences();
  let sustained = false;
  const idleFor = 8000;
  const slowAfter = 600;
  const frictionPerMs = 0.00035;
  const spinDuration = 1600;
  const spinRates = [1.25, 1.75, 2.5, 3.5, 5];
  const randomDelay = () => 18000 + Math.random() * 37000;
  const startIntro = () => {
    if (!introPending || document.readyState !== "complete" || document.hidden) return;
    cancelAnimationFrame(introFrame);
    // Give the loaded page a paint before starting, including on slower PCs.
    introFrame = requestAnimationFrame(() => {
      introFrame = requestAnimationFrame(() => {
        introFrame = undefined;
        if (!introPending || document.hidden) return;
        if (wantsSustainedSpin()) {
          syncSustainedSpin();
          return;
        }
        introPending = false;
        record.classList.add("record-spin-intro");
      });
    });
  };
  const schedule = (delay = randomDelay()) => {
    clearTimeout(timer);
    if (motion.matches || introPending || clickAnimation || sustained) return;
    timer = setTimeout(() => {
      if (document.hidden) return schedule();
      const remainingIdle = idleFor - (performance.now() - lastActivity);
      if (remainingIdle > 0) return schedule(remainingIdle);
      record.classList.add("record-spin-idle");
      record.dispatchEvent(new CustomEvent("recordidle"));
    }, delay);
  };
  const activity = () => {
    lastActivity = performance.now();
    if (!motion.matches && !record.classList.contains("record-spin-intro") &&
        !record.classList.contains("record-spin-idle") && !clickAnimation) schedule();
  };
  const stopClickSpin = () => {
    cancelAnimationFrame(coastFrame);
    coastFrame = undefined;
    if (!clickAnimation) return;
    const elapsed = Number(clickAnimation.currentTime) || 0;
    restingAngle = (restingAngle + elapsed / spinDuration * 360) % 360;
    record.style.transform = `rotate(${restingAngle}deg)`;
    clickAnimation.cancel();
    clickAnimation = undefined;
    lastCoastAt = 0;
    delete record.dataset.spinSpeed;
    delete record.dataset.spinRate;
  };
  const coast = (now) => {
    if (!clickAnimation) return;
    const elapsed = lastCoastAt ? now - lastCoastAt : 0;
    lastCoastAt = now;
    if (now - lastClickAt > slowAfter) {
      const nextRate = clickAnimation.playbackRate - elapsed * frictionPerMs;
      if (nextRate <= 0.12) {
        stopClickSpin();
        coastFrame = undefined;
        schedule();
        return;
      }
      clickAnimation.playbackRate = nextRate;
      record.dataset.spinRate = nextRate.toFixed(2);
    }
    coastFrame = requestAnimationFrame(coast);
  };
  const startSpin = (rate) => {
    introPending = false;
    cancelAnimationFrame(introFrame);
    introFrame = undefined;
    clearTimeout(timer);
    record.classList.remove("record-spin-intro", "record-spin-idle");
    if (!clickAnimation) {
      clickAnimation = record.animate(
        [{ transform: `rotate(${restingAngle / 360}turn)` }, { transform: `rotate(${1 + restingAngle / 360}turn)` }],
        { duration: spinDuration, iterations: Infinity, easing: "linear" },
      );
    }
    clickAnimation.playbackRate = rate;
    record.dataset.spinRate = rate.toFixed(2);
  };
  const spin = () => {
    const currentRate = clickAnimation?.playbackRate || 0;
    const fasterIndex = spinRates.findIndex((rate) => rate > currentRate + 0.05);
    const speedIndex = fasterIndex < 0 ? spinRates.length - 1 : fasterIndex;
    startSpin(spinRates[speedIndex]);
    record.dataset.spinSpeed = String(speedIndex + 1);
    lastClickAt = performance.now();
    lastCoastAt = lastClickAt;
    if (!sustained && !coastFrame) coastFrame = requestAnimationFrame(coast);
    record.dispatchEvent(new CustomEvent("recordspin"));
  };
  const wantsSustainedSpin = () => preferences.continuous ||
    (preferences.playback && audio && !audio.paused && !audio.ended && !audio.error && audio.readyState >= 2);
  const syncSustainedSpin = () => {
    const wasSustained = sustained;
    sustained = Boolean(wantsSustainedSpin());
    if (sustained) {
      clearTimeout(timer);
      cancelAnimationFrame(coastFrame);
      coastFrame = undefined;
      if (!clickAnimation && !document.hidden) {
        // Carry the arrival/idle angle into the steady animation without a jump.
        const matrix = new DOMMatrixReadOnly(getComputedStyle(record).transform);
        restingAngle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        startSpin(spinRates[0]);
        record.dataset.spinSpeed = "1";
      }
    } else if (wasSustained) {
      stopClickSpin();
      schedule();
    }
  };

  scope.onLeave(watchRecordPreferences(value => {
    preferences = value;
    syncSustainedSpin();
  }));
  scope.onLeave(() => { clearTimeout(timer); cancelAnimationFrame(coastFrame); cancelAnimationFrame(introFrame); clickAnimation?.cancel(); });
  // The audio element outlives the page, so the record's hold on it ends with the page.
  for (const event of ["play", "playing", "pause", "ended", "emptied", "error"]) {
    if (audio) scope.on(audio, event, syncSustainedSpin);
  }

  record.addEventListener("animationend", (event) => {
    if (event.target !== record) return;
    record.classList.remove("record-spin-intro", "record-spin-idle");
    schedule();
  });
  for (const event of ["pointerdown", "keydown", "scroll"]) {
    scope.on(window, event, activity, { passive: true });
  }
  record.addEventListener("click", spin);
  record.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    spin();
  });
  scope.on(document, "visibilitychange", () => {
    syncSustainedSpin();
    startIntro();
    if (!document.hidden && !introPending && !record.classList.contains("record-spin-intro") &&
        !record.classList.contains("record-spin-idle") && !clickAnimation) schedule();
  });
  scope.on(motion, "change", (event) => {
    record.dataset.motion = event.matches ? "reduced" : "active";
    // These saved choices explicitly opt into animation, including on Windows
    // with animation effects disabled. Unrequested idle spins still stay off.
    if (wantsSustainedSpin()) return syncSustainedSpin();
    if (event.matches) {
      clearTimeout(timer);
      cancelAnimationFrame(coastFrame);
      coastFrame = undefined;
      stopClickSpin();
      record.classList.remove("record-spin-idle");
      delete record.dataset.spinSpeed;
      delete record.dataset.spinRate;
      return;
    }
    schedule();
  });

  // The short arrival spin is intentional even with Windows animation effects off.
  // Reduced motion continues to disable automatic idle spins.
  scope.on(window, "load", startIntro, { once: true });
  startIntro();
}
