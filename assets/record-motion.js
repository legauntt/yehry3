export function startRecordMotion(record) {
  if (!record) return;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  record.tabIndex = 0;
  record.setAttribute("role", "button");
  record.setAttribute("aria-label", "Spin the record");
  record.setAttribute("title", "Click again to spin faster");
  if (motion.matches) {
    record.dataset.motion = "reduced";
    return;
  }

  record.dataset.motion = "active";
  let timer;
  let clickAnimation;
  let coastFrame;
  let lastClickAt = 0;
  let lastCoastAt = 0;
  let lastActivity = performance.now();
  const idleFor = 8000;
  const slowAfter = 600;
  const frictionPerMs = 0.00035;
  const spinRates = [1.25, 1.75, 2.5, 3.5, 5];
  const randomDelay = () => 18000 + Math.random() * 37000;
  const schedule = (delay = randomDelay()) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.hidden) return schedule();
      const remainingIdle = idleFor - (performance.now() - lastActivity);
      if (remainingIdle > 0) return schedule(remainingIdle);
      record.classList.add("record-spin-idle");
    }, delay);
  };
  const activity = () => {
    lastActivity = performance.now();
    if (!record.classList.contains("record-spin-intro") &&
        !record.classList.contains("record-spin-idle") && !clickAnimation) schedule();
  };
  const coast = (now) => {
    if (!clickAnimation) return;
    const elapsed = lastCoastAt ? now - lastCoastAt : 0;
    lastCoastAt = now;
    if (now - lastClickAt > slowAfter) {
      const nextRate = clickAnimation.playbackRate - elapsed * frictionPerMs;
      if (nextRate <= 0.12) {
        clickAnimation.cancel();
        clickAnimation = undefined;
        coastFrame = undefined;
        lastCoastAt = 0;
        delete record.dataset.spinSpeed;
        delete record.dataset.spinRate;
        schedule();
        return;
      }
      clickAnimation.playbackRate = nextRate;
      record.dataset.spinRate = nextRate.toFixed(2);
    }
    coastFrame = requestAnimationFrame(coast);
  };
  const spin = () => {
    clearTimeout(timer);
    record.classList.remove("record-spin-intro", "record-spin-idle");
    const currentRate = clickAnimation?.playbackRate || 0;
    const fasterIndex = spinRates.findIndex((rate) => rate > currentRate + 0.05);
    const speedIndex = fasterIndex < 0 ? spinRates.length - 1 : fasterIndex;
    if (!clickAnimation) {
      clickAnimation = record.animate(
        [{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }],
        { duration: 1600, iterations: Infinity, easing: "linear" },
      );
    }
    const rate = spinRates[speedIndex];
    clickAnimation.playbackRate = rate;
    record.dataset.spinSpeed = String(speedIndex + 1);
    record.dataset.spinRate = rate.toFixed(2);
    lastClickAt = performance.now();
    lastCoastAt = lastClickAt;
    if (!coastFrame) coastFrame = requestAnimationFrame(coast);
  };

  record.addEventListener("animationend", (event) => {
    if (event.target !== record) return;
    record.classList.remove("record-spin-intro", "record-spin-idle");
    schedule();
  });
  for (const event of ["pointerdown", "keydown", "scroll"]) {
    window.addEventListener(event, activity, { passive: true });
  }
  record.addEventListener("click", spin);
  record.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    spin();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !record.classList.contains("record-spin-idle") && !clickAnimation) schedule();
  });
  motion.addEventListener("change", (event) => {
    if (!event.matches) return;
    clearTimeout(timer);
    cancelAnimationFrame(coastFrame);
    coastFrame = undefined;
    clickAnimation?.cancel();
    clickAnimation = undefined;
    record.classList.remove("record-spin-intro", "record-spin-idle");
    delete record.dataset.spinSpeed;
    delete record.dataset.spinRate;
    record.dataset.motion = "reduced";
  });

  requestAnimationFrame(() => record.classList.add("record-spin-intro"));
}
