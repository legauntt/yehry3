const supported = () =>
  window.isSecureContext &&
  "Notification" in window &&
  "serviceWorker" in navigator;
let registration;
async function serviceWorker() {
  if (!registration) {
    registration = (async () => {
      let timer;
      try {
        return await Promise.race([
          navigator.serviceWorker.register("/notifications-sw.js").then(() => navigator.serviceWorker.ready),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Alert setup timed out")), 10000); }),
        ]);
      } finally { clearTimeout(timer); }
    })().catch((error) => {
        registration = null;
        throw error;
      });
  }
  return registration;
}

// Browser permission persists; only an explicit opt-out is saved here. Each new
// queue visit starts a fresh release baseline so older songs never flood alerts.
export function completionAlerts(button, status, onRelease) {
  const preferenceKey = "yehry3:release-alerts";
  let enabled = false,
    previous = null,
    optedOut = false,
    generation = 0,
    lastPermission;
  function readPreference() {
    try { optedOut = localStorage.getItem(preferenceKey) === "off"; } catch { /* Keep this page's preference. */ }
    return optedOut;
  }
  function savePreference(off) {
    optedOut = off;
    try { localStorage.setItem(preferenceKey, off ? "off" : "on"); } catch { /* This page still honors the choice. */ }
  }
  async function reconcile() {
    const current = ++generation;
    enabled = false;
    if (!supported()) {
      button.disabled = true;
      button.textContent = "Browser alerts unavailable";
      status.textContent = "System alerts are unavailable here. New songs still appear below while the queue is open.";
      return;
    }
    lastPermission = Notification.permission;
    if (lastPermission === "denied") {
      button.disabled = true;
      button.textContent = "Browser alerts blocked";
      status.textContent = "Notifications are blocked in your browser settings. The queue will still update here.";
      return;
    }
    button.disabled = false;
    button.textContent = "Enable browser alerts";
    if (readPreference()) {
      status.textContent = "Alerts are off. The queue still refreshes automatically.";
      return;
    }
    if (lastPermission !== "granted") {
      status.textContent = "Get an alert when a new song is published. Enable alerts to allow notifications in this browser.";
      return;
    }
    button.disabled = true;
    button.textContent = "Checking browser alerts…";
    status.textContent = "Permission is granted. Checking browser alert setup…";
    try {
      await serviceWorker();
      if (current !== generation) return;
      enabled = true;
      button.disabled = false;
      button.textContent = "Turn off browser alerts";
      status.textContent = "Alerts are on for new releases. Keep this queue tab open; alerts may be delayed when the browser suspends it.";
    } catch {
      if (current !== generation) return;
      button.disabled = false;
      button.textContent = "Finish enabling alerts";
      status.textContent = "Permission is granted, but browser alerts could not start. Try again to finish setup.";
    }
  }
  button.onclick = async () => {
    if (enabled) {
      savePreference(true);
      await reconcile();
      return;
    }
    if (!supported()) return;
    button.disabled = true;
    try {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") savePreference(false);
      await reconcile();
    } catch {
      button.disabled = false;
      button.textContent = "Enable browser alerts";
      status.textContent = "Browser alerts could not start. You can try again; new songs still appear in this queue.";
    }
  };
  reconcile();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reconcile(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) reconcile(); });
  window.addEventListener("storage", (event) => { if (event.key === preferenceKey || event.key === null) reconcile(); });
  return async function observe(releases) {
    if (supported() && Notification.permission !== lastPermission) await reconcile();
    const latest = new Set(releases.map((song) => song.id));
    if (previous === null) {
      previous = latest;
      return;
    }
    const added = releases.filter((song) => !previous.has(song.id));
    previous = new Set([...previous, ...latest].slice(-100));
    if (!added.length) return;
    onRelease(added);
    if (!enabled || !supported() || Notification.permission !== "granted")
      return;
    try {
      const worker = await serviceWorker();
      // One summary per refresh. Stable tags replace duplicates across open queue tabs.
      await worker.showNotification(
        added.length === 1
          ? "A new Tony song is ready"
          : `${added.length} new Tony songs are ready`,
        {
          body: added
            .map((song) => song.title || song.idea)
            .join(" · ")
            .slice(0, 240),
          tag: "yehry3-release-" + added[0].id,
          data: { songId: added[0].id },
        },
      );
    } catch {
      status.textContent =
        "A song is ready below. The browser could not display its system alert.";
    }
  };
}
