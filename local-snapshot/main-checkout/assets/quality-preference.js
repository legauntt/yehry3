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

  function mount(root = document) {
    const host = root.querySelector("[data-quality-settings]");
    if (!host || host.dataset.qualitySettingsMounted) return;
    host.dataset.qualitySettingsMounted = "true";

    const opener = document.createElement("button");
    opener.type = "button";
    opener.className = "quiet settings-button";
    opener.setAttribute("aria-label", "Open display settings");
    opener.title = "Display settings";
    opener.innerHTML = '<span aria-hidden="true">⚙</span>';

    const dialog = document.createElement("dialog");
    dialog.className = "display-settings-dialog";
    dialog.setAttribute("aria-labelledby", "display-settings-title");
    const heading = document.createElement("div");
    heading.className = "display-settings-heading";
    heading.innerHTML = '<div><p class="eyebrow">Preferences</p><h2 id="display-settings-title">Display settings</h2></div>';
    const close = document.createElement("button");
    close.type = "button";
    close.className = "quiet settings-close";
    close.setAttribute("aria-label", "Close display settings");
    close.textContent = "×";
    heading.append(close);

    const label = document.createElement("label");
    label.className = "quality-preference";
    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = shown;
    const copy = document.createElement("span");
    copy.innerHTML = '<strong>Show “Has issues”</strong><small>Display notices about known musical issues with a song.</small>';
    label.append(checkbox, copy);
    dialog.append(heading, label);
    host.append(opener, dialog);

    opener.addEventListener("click", () => dialog.showModal());
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => opener.focus());
    checkbox.addEventListener("change", () => {
      shown = checkbox.checked;
      try { localStorage.setItem(key, String(shown)); }
      catch { /* Apply immediately even when persistence is blocked. */ }
      apply();
    });
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    read();
    apply();
  });
  window.addEventListener("pageshow", () => {
    read();
    apply();
  });

  window.mountQualitySettings = mount;
}

export function mountQualitySettings(root = document) {
  window.mountQualitySettings?.(root);
}
