export const recordPreferenceKeys = {
  continuous: "yehry3:continuous-record-spins",
  playback: "yehry3:spin-record-while-playing",
  captions: "yehry3:record-lyric-captions",
};

const defaults = { continuous: false, playback: false, captions: true };
const preferences = { ...defaults };
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener(getRecordPreferences()));

function read() {
  for (const [name, key] of Object.entries(recordPreferenceKeys)) {
    try {
      const saved = localStorage.getItem(key);
      preferences[name] = saved === null ? defaults[name] : saved === "true";
    }
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
