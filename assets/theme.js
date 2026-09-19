/* Loaded before styles so a saved choice applies before the first paint. */
(() => {
  const key = "yehry3:dark-mode";
  let dark = false;
  const read = () => { try { dark = localStorage.getItem(key) === "true"; } catch {} };
  const apply = () => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.dispatchEvent(new Event("yehry3:theme"));
  };
  window.yehry3Theme = {
    isDark: () => dark,
    setDark: value => { dark = Boolean(value); try { localStorage.setItem(key, String(dark)); } catch {} apply(); },
  };
  read(); apply();
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) { read(); apply(); }
  });
  window.addEventListener("pageshow", () => { read(); apply(); });
})();
