export const recordPreferenceKeys = {
  continuous: "yehry3:continuous-record-spins",
  playback: "yehry3:spin-record-while-playing",
  captions: "yehry3:record-lyric-captions",
  lyricAudio: "yehry3:record-lyric-audio",
  lyricFontSize: "yehry3:record-lyric-font-size",
  lyricMinLines: "yehry3:record-lyric-min-lines",
  lyricMaxLines: "yehry3:record-lyric-max-lines",
};

const defaults = { continuous: false, playback: false, captions: true, lyricAudio: false, lyricFontSize: 28, lyricMinLines: 1, lyricMaxLines: 8 };
const numberPreference = (value, fallback, min, max) => { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
const preferences = { ...defaults };
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener(getRecordPreferences()));

function read() {
  for (const [name, key] of Object.entries(recordPreferenceKeys)) {
    try {
      const saved = localStorage.getItem(key);
      if (name === "lyricFontSize") preferences[name] = numberPreference(saved, defaults[name], 18, 36);
      else if (name === "lyricMinLines" || name === "lyricMaxLines") preferences[name] = numberPreference(saved, defaults[name], 1, 8);
      else preferences[name] = saved === null ? defaults[name] : saved === "true";
    }
    catch { /* Keep this page's choice when storage is unavailable. */ }
  }
  if (preferences.lyricMinLines > preferences.lyricMaxLines) preferences.lyricMaxLines = preferences.lyricMinLines;
}

export function getRecordPreferences() {
  return { ...preferences };
}

export function setRecordPreference(name, enabled) {
  if (!Object.hasOwn(recordPreferenceKeys, name)) return;
  if (name === "lyricFontSize") preferences[name] = numberPreference(enabled, defaults[name], 18, 36);
  else if (name === "lyricMinLines" || name === "lyricMaxLines") { preferences[name] = numberPreference(enabled, defaults[name], 1, 8); if (name === "lyricMinLines" && preferences.lyricMinLines > preferences.lyricMaxLines) preferences.lyricMaxLines = preferences.lyricMinLines; if (name === "lyricMaxLines" && preferences.lyricMaxLines < preferences.lyricMinLines) preferences.lyricMinLines = preferences.lyricMaxLines; }
  else preferences[name] = Boolean(enabled);
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
