export const recordPreferenceKeys = {
  continuous: "yehry3:continuous-record-spins",
  playback: "yehry3:spin-record-while-playing",
};

const preferences = { continuous: false, playback: false };
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener(getRecordPreferences()));

function read() {
  for (const [name, key] of Object.entries(recordPreferenceKeys)) {
    try { preferences[name] = localStorage.getItem(key) === "true"; }
    catch { /* Keep this page's choice when storage is unavailable. */ }
  }
}

export function getRecordPreferences() {
  return { ...preferences };
}

export function setRecordPreference(name, enabled) {
  if (!Object.hasOwn(recordPreferenceKeys, name)) return;
  preferences[name] = Boolean(enabled);
  try { localStorage.setItem(recordPreferenceKeys[name], String(preferences[name])); }
  catch { /* The current page still responds when persistence is blocked. */ }
  notify();
}

export function watchRecordPreferences(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  read();
  window.addEventListener("storage", event => {
    if (event.key !== null && !Object.values(recordPreferenceKeys).includes(event.key)) return;
    read();
    notify();
  });
  window.addEventListener("pageshow", () => {
    read();
    notify();
  });
}
