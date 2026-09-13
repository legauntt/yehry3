export function startRecordMotion(record) {
  if (!record) return;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches) {
    record.dataset.motion = "reduced";
    return;
  }

  record.dataset.motion = "active";
  let timer;
  let lastActivity = performance.now();
  const idleFor = 8000;
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
        !record.classList.contains("record-spin-idle")) schedule();
  };

  record.addEventListener("animationend", (event) => {
    if (event.target !== record) return;
    record.classList.remove("record-spin-intro", "record-spin-idle");
    schedule();
  });
  for (const event of ["pointerdown", "keydown", "scroll"]) {
    window.addEventListener(event, activity, { passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !record.classList.contains("record-spin-idle")) schedule();
  });
  motion.addEventListener("change", (event) => {
    if (!event.matches) return;
    clearTimeout(timer);
    record.classList.remove("record-spin-intro", "record-spin-idle");
    record.dataset.motion = "reduced";
  });

  requestAnimationFrame(() => record.classList.add("record-spin-intro"));
}
