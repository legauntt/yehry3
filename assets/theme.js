/* Loaded before styles so a saved choice applies before the first paint. */
(() => {
  const key = "yehry3:dark-mode";
  const moodKey = "yehry3:room-mood";
  const moods = ['classic', 'midnight', 'concrete', 'pumpkin'];
  let mood = 'midnight';
  let dark = true;
  const read = () => { try {
    const savedDark = localStorage.getItem(key);
    const saved = localStorage.getItem(moodKey);
    // Preserve explicit themes and older Dark Mode choices; new visitors get Midnight.
    mood = moods.includes(saved) ? saved : savedDark !== null ? 'classic' : 'midnight';
    dark = mood !== 'classic' || savedDark === "true";
  } catch {} };
  const apply = () => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.roomMood = mood;
    window.dispatchEvent(new Event("yehry3:theme"));
  };
  window.yehry3Theme = {
    isDark: () => dark,
    getMood: () => mood,
    setMood: value => {
      if (!moods.includes(value)) return;
      mood = value;
      if (mood !== 'classic') dark = true;
      try { localStorage.setItem(moodKey, mood); localStorage.setItem(key, String(dark)); } catch {}
      apply();
    },
    setDark: value => {
      dark = Boolean(value);
      if (!dark) mood = 'classic';
      try { localStorage.setItem(key, String(dark)); localStorage.setItem(moodKey, mood); } catch {}
      apply();
    },
  };
  read(); apply();
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === moodKey || event.key === null) { read(); apply(); }
  });
  window.addEventListener("pageshow", () => { read(); apply(); });
})();
