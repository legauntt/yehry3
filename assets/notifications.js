import { api } from "./api.js";

const preferenceKey = "yehry3:release-alerts";
const seenKey = "yehry3:announced-releases";
const enabledMessage = "Alerts are on for everyone’s completed songs. Keep any yehry3 tab open; an alert arrives when a song is published and ready to play.";
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

// All pages share the same release history and explicit browser opt-out.
export function completionAlerts(button = null, status = null, onRelease = () => {}) {
  let enabled = false,
    seen = null,
    optedOut = false,
    generation = 0,
    lastPermission;
  function display(label, detail, disabled = false) {
    if (button) {
      button.disabled = disabled;
      button.textContent = label;
    }
    if (status) status.textContent = detail;
  }
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
      display("Browser alerts unavailable", "System alerts are unavailable here. New songs still appear below while the queue is open.", true);
      return;
    }
    lastPermission = Notification.permission;
    if (lastPermission === "denied") {
      display("Browser alerts blocked", "Notifications are blocked in your browser settings. The queue will still update here.", true);
      return;
    }
    if (readPreference()) {
      display("Enable browser alerts", "Alerts are off. The queue still refreshes automatically.");
      return;
    }
    if (lastPermission !== "granted") {
      display("Enable browser alerts", "Get an alert whenever anyone’s song is published. Enable alerts to allow notifications in this browser.");
      return;
    }
    display("Checking browser alerts…", "Permission is granted. Checking browser alert setup…", true);
    try {
      await serviceWorker();
      if (current !== generation) return;
      enabled = true;
      display("Turn off browser alerts", enabledMessage);
    } catch {
      if (current !== generation) return;
      display("Finish enabling alerts", "Permission is granted, but browser alerts could not start. Try again to finish setup.");
    }
  }
  let readiness;
  const synchronize = () => (readiness = reconcile());
  if (button) button.onclick = async () => {
    if (enabled) {
      savePreference(true);
      await synchronize();
      return;
    }
    if (!supported()) return;
    button.disabled = true;
    try {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") savePreference(false);
      await synchronize();
    } catch {
      display("Enable browser alerts", "Browser alerts could not start. You can try again; new songs still appear in this queue.");
    }
  };
  synchronize();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) synchronize(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) synchronize(); });
  window.addEventListener("storage", (event) => { if (event.key === preferenceKey || event.key === null) synchronize(); });
  function readSeen() {
    try {
      const saved = JSON.parse(localStorage.getItem(seenKey));
      if (Array.isArray(saved) && saved.every((id) => typeof id === "string")) return new Set(saved.slice(-100));
    } catch { /* Keep the current page's history if storage is unavailable. */ }
    return seen;
  }
  function remember(previous, latest) {
    seen = new Set([...new Set([...(previous || []), ...latest])].slice(-100));
    try { localStorage.setItem(seenKey, JSON.stringify([...seen])); } catch { /* This page still avoids duplicates. */ }
  }
  return async function observe(releases) {
    if (supported() && (Notification.permission !== lastPermission ||
        (!enabled && Notification.permission === "granted" && !readPreference()))) synchronize();
    await readiness;
    const announce = async () => {
      const previous = readSeen();
      const latest = releases.map((song) => song.id);
      if (previous === null) {
        remember(null, latest); // Establish the first baseline without old alerts.
        return;
      }
      const added = releases.filter((song) => !previous.has(song.id));
      if (!added.length) return;
      onRelease(added);
      if (!supported() || Notification.permission !== "granted" || readPreference()) {
        remember(previous, latest);
        return;
      }
      if (!enabled) return; // Retry after incomplete service-worker setup.
      try {
        const worker = await serviceWorker();
        if (readPreference() || Notification.permission !== "granted") {
          remember(previous, latest);
          return;
        }
        await worker.showNotification(
          added.length === 1
            ? "A new Tony song is ready"
            : `${added.length} new Tony songs are ready`,
          {
            body: added.map((song) => song.title || song.idea).join(" · ").slice(0, 240),
            tag: "yehry3-release-" + added[0].id,
            data: { songId: added[0].id },
          },
        );
        remember(previous, latest);
        display("Turn off browser alerts", enabledMessage);
      } catch {
        if (status) status.textContent = "A song is ready. The browser could not display its system alert; it will retry on the next refresh.";
      }
    };
    // Serialize the shared history and delivery so two open pages notify once.
    if (navigator.locks?.request) {
      try {
        await navigator.locks.request(seenKey, { ifAvailable: true }, (lock) => lock ? announce() : undefined);
      } catch { await announce(); }
    } else await announce();
  };
}

let watching = false;
export function watchCompletions() {
  if (watching) return;
  watching = true;
  const observe = completionAlerts();
  let busy = false;
  async function refresh() {
    if (busy || !supported() || Notification.permission !== "granted") return;
    try { if (localStorage.getItem(preferenceKey) === "off") return; } catch { /* Permission still applies. */ }
    busy = true;
    try { await observe((await api("/queue?page=0")).recent); }
    catch { /* A background check retries without interrupting the current page. */ }
    finally { busy = false; }
  }
  refresh();
  let timer = setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("storage", (event) => { if (event.key === preferenceKey || event.key === null) refresh(); });
  window.addEventListener("pagehide", () => clearInterval(timer));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearInterval(timer);
      timer = setInterval(refresh, 30000);
      refresh();
    }
  });
}
