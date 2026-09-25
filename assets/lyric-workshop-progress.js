// Sample the visible animation once per writing session. No device fingerprint or
// benchmark: a stalled hat or fewer than 20 frames/second gets the simpler loader.
export function workshopProgress(element) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const travel = element.querySelector('.workshop-hat-travel');
  const events = new AbortController();
  let active = false, slow = false, frame, deadline;

  function stopSampling() {
    cancelAnimationFrame(frame);
    clearTimeout(deadline);
  }
  function sync() {
    stopSampling();
    const visible = active && !document.hidden;
    element.dataset.simple = String(slow || motion.matches);
    element.dataset.paused = String(!visible);
    if (!visible || slow || motion.matches) return;

    // Allow the dialog's initial layout to settle before measuring cadence.
    const warmup = performance.now() + 250;
    let started, frames = 0, animationStart;
    const animationTime = () => travel.getAnimations?.()[0]?.currentTime;
    const sample = now => {
      if (now >= warmup) {
        if (started === undefined) {
          started = now;
          animationStart = animationTime();
        } else frames++;
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    // The timer also catches browsers that stop delivering animation frames.
    deadline = setTimeout(() => {
      stopSampling();
      if (!active || document.hidden) return;
      const elapsed = started === undefined ? 0 : performance.now() - started;
      const animationEnd = animationTime();
      const stalled = typeof travel.getAnimations === 'function' &&
        (typeof animationStart !== 'number' || typeof animationEnd !== 'number' || animationEnd - animationStart < 500);
      slow = elapsed <= 0 || frames * 1000 / elapsed < 20 || stalled;
      element.dataset.simple = String(slow || motion.matches);
    }, 2000);
  }
  document.addEventListener('visibilitychange', sync, { signal: events.signal });
  motion.addEventListener('change', sync, { signal: events.signal });
  return {
    setActive(value) {
      if (value === active) return;
      active = value;
      sync();
    },
    destroy() {
      active = false;
      stopSampling();
      events.abort();
    },
  };
}
