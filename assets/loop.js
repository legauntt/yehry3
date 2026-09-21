// One repeat preference for every yehry3 player, saved per browser like the
// other listening preferences. Looping suppresses the collection's automatic
// advance, because a looping track never reports that it ended.
const key = "yehry3:loop-track";

function saved() {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}

// Returns a reusable control. Pages that rebuild their player call attach()
// with the replacement audio element instead of mounting a second toggle.
export function mountLoopToggle({ label = "Loop", className = "quiet loop-toggle" } = {}) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.dataset.loopToggle = "";
  let looping = saved(), audio = null;
  function apply() {
    if (audio) audio.loop = looping;
    element.setAttribute("aria-pressed", String(looping));
    element.textContent = `${label} ${looping ? "on" : "off"}`;
    element.title = looping
      ? "Repeating this track. Turn it off to play on."
      : "Repeat this track instead of moving on.";
  }
  element.onclick = () => {
    looping = !looping;
    try { localStorage.setItem(key, String(looping)); } catch { /* This page still honors the choice. */ }
    apply();
    // Another toggle in this page (the bar's and a lyric sheet's) follows without waiting for storage.
    dispatchEvent(new CustomEvent("yehry3:loop", { detail: { from: element, looping } }));
  };
  const reread = () => { looping = saved(); apply(); };
  const follow = (event) => { if (event.detail?.from !== element) { looping = event.detail.looping; apply(); } };
  const controller = new AbortController(), { signal } = controller;
  addEventListener("storage", (event) => { if (event.key === key || event.key === null) reread(); }, { signal });
  addEventListener("pageshow", reread, { signal });
  addEventListener("yehry3:loop", follow, { signal });
  apply();
  return {
    element,
    attach(replacement) { audio = replacement || null; apply(); },
    // A toggle on a page that is being left stops listening; the audio keeps its setting.
    destroy() { controller.abort(); element.remove(); },
  };
}
