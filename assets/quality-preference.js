const key = "yehry3:show-quality-issues";

if (typeof document !== "undefined") {
  let shown = true;
  let checkbox;
  const read = () => {
    try { shown = localStorage.getItem(key) !== "false"; }
    catch { /* Keep this page's choice when storage is unavailable. */ }
  };
  const apply = () => {
    document.documentElement.dataset.showQualityIssues = String(shown);
    if (checkbox) checkbox.checked = shown;
  };
  read();
  apply();

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./quality-preference.css", import.meta.url).href;
  document.head.append(stylesheet);

  function mount() {
    const footer = document.querySelector("footer");
    if (!footer) return;
    footer.classList.add("has-display-preference");
    const label = document.createElement("label");
    label.className = "quality-preference";
    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = shown;
    label.append(checkbox, document.createTextNode('Show “Has issues”'));
    footer.append(label);
    checkbox.addEventListener("change", () => {
      shown = checkbox.checked;
      try { localStorage.setItem(key, String(shown)); }
      catch { /* Apply immediately even when persistence is blocked. */ }
      apply();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else mount();

  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    read();
    apply();
  });
  window.addEventListener("pageshow", () => {
    read();
    apply();
  });
}
