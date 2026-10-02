const key = 'yehry3:bat-settings';
const defaults = { enabled: true, size: 1, spacing: 1, speed: 1 };
let settings = { ...defaults };
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    settings = { enabled: saved.enabled !== false };
    for (const name of ['size', 'spacing', 'speed']) {
      const value = Number(saved[name]);
      settings[name] = Number.isFinite(value) && value >= .5 && value <= 3 ? value : defaults[name];
    }
  } catch { /* Retain this visit's choices if storage is unavailable. */ }
}
read();
export const getBatPreferences = () => ({ ...settings });
export function setBatPreference(name, value) {
  if (!(name in defaults)) return;
  if (name === 'enabled') settings.enabled = Boolean(value);
  else if (Number.isFinite(Number(value))) settings[name] = Math.max(.5, Math.min(3, Number(value)));
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch {}
  window.dispatchEvent(new Event('yehry3:bats'));
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) { read(); window.dispatchEvent(new Event('yehry3:bats')); }
});
