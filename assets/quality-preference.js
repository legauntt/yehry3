import { getRecordPreferences, setRecordPreference, watchRecordPreferences } from "./record-preferences.js";

const key = "yehry3:show-quality-issues";
const seenKey = "yehry3:preferences-seen";
// Change this when new preferences should be highlighted to returning visitors.
const preferencesVersion = "record-lyric-audio-v1";

if (typeof document !== "undefined") {
  let shown = true;
  let preferencesSeen = false;
  let checkbox;
  let settingsButton;
  let newBadge;
  const recordCheckboxes = new Map();
  const recordSelects = new Map();
  const read = () => {
    try {
      shown = localStorage.getItem(key) !== "false";
      preferencesSeen = localStorage.getItem(seenKey) === preferencesVersion;
    }
    catch { /* Keep this page's choice when storage is unavailable. */ }
  };
  const apply = () => {
    document.documentElement.dataset.showQualityIssues = String(shown);
    if (checkbox) checkbox.checked = shown;
    const preferences = getRecordPreferences();
    recordCheckboxes.forEach((input, name) => { input.checked = preferences[name]; });
    recordSelects.forEach((input, name) => { input.value = String(preferences[name]); });
    if (settingsButton) {
      settingsButton.classList.toggle("has-new-preferences", !preferencesSeen);
      settingsButton.title = preferencesSeen ? "Display settings" : "New lyric audio preference available";
      if (preferencesSeen) settingsButton.removeAttribute("aria-describedby");
      else settingsButton.setAttribute("aria-describedby", "display-settings-updates");
      newBadge.hidden = preferencesSeen;
    }
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
    settingsButton = opener;
    newBadge = document.createElement("span");
    newBadge.className = "settings-new";
    newBadge.textContent = "New";
    newBadge.setAttribute("aria-hidden", "true");
    opener.append(newBadge);
    const updateDescription = document.createElement("span");
    updateDescription.id = "display-settings-updates";
    updateDescription.className = "sr-only";
    updateDescription.textContent = "New lyric audio preference available.";

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
		copy.innerHTML = '<strong>Show review notes</strong><small>Display details about known musical issues. The Needs review badge always stays visible.</small>';
    label.append(checkbox, copy);
    dialog.append(heading, label);
    const recordGroup = document.createElement("fieldset");
    recordGroup.className = "record-preferences";
    const legend = document.createElement("legend");
    legend.textContent = "Record player";
    recordGroup.append(legend);
    for (const [name, title, description] of [
      ["captions", "Lyric captions", "Show comic-book lyric captions when the record is clicked or the page is idle."],
      ["lyricAudio", "Lyric audio", "Use this browser's generated voice to read a lyric aloud when you click the record. Off by default."],
      ["continuous", "Continuous record spins", "Keep the record spinning without slowing down. Click it to spin faster."],
      ["playback", "Spin while music plays", "Start with the music and stop when paused, unless continuous spins are on."],
    ]) {
      const option = document.createElement("label");
      option.className = "quality-preference";
      const input = document.createElement("input");
      input.type = "checkbox";
      const text = document.createElement("span");
      const titleElement = document.createElement("strong");
      titleElement.textContent = title;
      const detail = document.createElement("small");
      detail.textContent = description;
      text.append(titleElement, detail);
      option.append(input, text);
      recordGroup.append(option);
      recordCheckboxes.set(name, input);
      input.addEventListener("change", () => setRecordPreference(name, input.checked));
    }
    for (const [name, title, description, values] of [["lyricFontSize", "Lyric caption size", "Choose the type size for the record popup.", [18, 22, 28, 32, 36]], ["lyricMinLines", "Minimum lyric lines", "The fewest lyric lines in a popup when the screen has room.", [1, 2, 3, 4, 5, 6, 7, 8]], ["lyricMaxLines", "Maximum lyric lines", "The most lyric lines in a popup when the screen has room.", [1, 2, 3, 4, 5, 6, 7, 8]]]) {
      const option = document.createElement("label"); option.className = "record-preference-select";
      const text = document.createElement("span"); const heading = document.createElement("strong"); const detail = document.createElement("small"); heading.textContent = title; detail.textContent = description; text.append(heading, detail);
      const input = document.createElement("select"); input.setAttribute("aria-label", title);
      for (const value of values) { const choice = document.createElement("option"); choice.value = String(value); choice.textContent = name === "lyricFontSize" ? String(value) + "px" : String(value); input.append(choice); }
      option.append(text, input); recordGroup.append(option); recordSelects.set(name, input); input.addEventListener("change", () => setRecordPreference(name, input.value));
    }
    dialog.append(recordGroup);
    host.append(opener, updateDescription, dialog);
    apply();

    opener.addEventListener("click", () => {
      dialog.showModal();
      preferencesSeen = true;
      try { localStorage.setItem(seenKey, preferencesVersion); }
      catch { /* Dismiss the indicator for this visit even without storage. */ }
      apply();
    });
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
    if (event.key !== key && event.key !== seenKey && event.key !== null) return;
    read();
    apply();
  });
  window.addEventListener("pageshow", () => {
    read();
    apply();
  });
  watchRecordPreferences(apply);

  window.mountQualitySettings = mount;
}

export function mountQualitySettings(root = document) {
  window.mountQualitySettings?.(root);
}
