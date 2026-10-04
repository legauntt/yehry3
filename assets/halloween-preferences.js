const key = 'yehry3:halloween-level';
export const halloweenLevels = {
  off: { title: 'Off', description: 'No Halloween decorations or animations.', bats: 0, delay: 0, weave: 0, scareEvery: 0 },
  low: { title: 'Low', description: 'Just pumpkins and corner webs. No animations.', bats: 0, delay: 0, weave: 0, scareEvery: 0 },
  medium: { title: 'Medium', description: '12 cursor bats and occasional flybys. No weaving or scares.', bats: 12, delay: 16000, weave: 0, scareEvery: 0 },
  high: { title: 'High', description: 'The classic haunting: 24 bats, weaving webs, flybys and idle scares.', bats: 24, delay: 8000, weave: 6000, scareEvery: 3 },
  extreme: { title: 'EXTREME', description: '36 bats, weaving webs and more frequent flybys and idle scares.', bats: 36, delay: 6000, weave: 4000, scareEvery: 3 },
  haunted: { title: 'HAUNTED', description: '48 bats, faster encounters and an idle scare every other encounter.', bats: 48, delay: 4000, weave: 2000, scareEvery: 2 },
};
let level = 'high';
const apply = () => {
  if (typeof document !== 'undefined') document.documentElement.dataset.halloweenLevel = level;
};
const read = () => {
  try {
    const saved = localStorage.getItem(key);
    level = Object.hasOwn(halloweenLevels, saved) ? saved : 'high';
  } catch { /* Keep this visit's choice when storage is unavailable. */ }
  apply();
};
read();
export const getHalloweenLevel = () => level;
export const getHalloweenProfile = () => halloweenLevels[level];
export function setHalloweenLevel(value) {
  if (!Object.hasOwn(halloweenLevels, value)) return;
  level = value;
  try { localStorage.setItem(key, level); } catch {}
  apply();
  window.dispatchEvent(new Event('yehry3:halloween'));
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { read(); window.dispatchEvent(new Event('yehry3:halloween')); }
  });
  window.addEventListener('pageshow', () => { read(); window.dispatchEvent(new Event('yehry3:halloween')); });
}
