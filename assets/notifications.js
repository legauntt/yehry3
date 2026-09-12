const supported = () =>
  window.isSecureContext &&
  "Notification" in window &&
  "serviceWorker" in navigator;
let registration;
async function serviceWorker() {
  if (!registration)
    registration = navigator.serviceWorker
      .register("/notifications-sw.js")
      .then(() => navigator.serviceWorker.ready)
      .catch((error) => {
        registration = null;
        throw error;
      });
  return registration;
}

// Permission and the completion baseline last only for this queue tab's visit.
export function completionAlerts(button, status, onRelease) {
  let enabled = false,
    previous = null;
  if (!supported()) {
    button.disabled = true;
    status.textContent =
      "System alerts are unavailable here. New songs still appear below while the queue is open.";
  }
  button.onclick = async () => {
    if (enabled) {
      enabled = false;
      button.textContent = "Enable browser alerts";
      status.textContent =
        "Alerts are off. The queue still refreshes automatically.";
      return;
    }
    button.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        status.textContent =
          permission === "denied"
            ? "Notifications are blocked in your browser settings. The queue will still update here."
            : "No permission granted. You can enable alerts later.";
        return;
      }
      await serviceWorker();
      enabled = true;
      button.textContent = "Turn off browser alerts";
      status.textContent =
        "Alerts are on for new releases. Keep this queue tab open; alerts may be delayed when the browser suspends it.";
    } catch {
      status.textContent =
        "Browser alerts could not start. New songs will still appear in this queue.";
    } finally {
      button.disabled = false;
    }
  };
  return async function observe(releases) {
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
