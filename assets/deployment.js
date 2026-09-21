// Every build stamps its pages and writes /deployment.json. Comparing the two
// tells a long-lived tab that a newer version of the site's code has shipped.
// Song, lyric and clip publications also redeploy but leave the code version
// alone, so they never prompt. Refreshing stays the visitor's choice so a
// reload never interrupts a song that is playing.
const CHECK_MS = 120000;

function currentBuild() {
  const value = document.querySelector(".deployment-stamp time")?.dateTime;
  const time = Date.parse(value || "");
  const code = document.querySelector('meta[name="yehry3-code"]')?.content;
  return Number.isFinite(time) && code ? { time, code } : null;
}

export function watchDeployment() {
  const built = currentBuild();
  if (!built) return; // A page without a build stamp has nothing to compare.
  // "Not now" silences this code version only; a later code change asks again.
  let showing = false, declined = "", checking = false;
  function offer(code) {
    showing = true;
    const element = document.createElement("div");
    element.className = "update-banner";
    element.setAttribute("role", "status");
    element.innerHTML =
      '<span>A newer version of yehry3 is ready.</span><button type="button" class="update-refresh">Update available ↻</button><button type="button" class="update-dismiss" aria-label="Keep this version for now">Not now</button>';
    element.querySelector(".update-refresh").onclick = () => location.reload();
    element.querySelector(".update-dismiss").onclick = () => {
      declined = code;
      showing = false;
      element.remove();
      delete document.body.dataset.updateAvailable;
    };
    document.body.prepend(element);
    document.body.dataset.updateAvailable = "true";
  }
  async function check() {
    if (showing || checking || document.hidden) return;
    checking = true;
    try {
      const response = await fetch(`/deployment.json?at=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return;
      const record = await response.json();
      const published = Date.parse(record?.updatedAt || "");
      const code = typeof record?.code === "string" ? record.code : "";
      // Newer means a later build with different code; an older edge copy of the record is ignored.
      if (!Number.isFinite(published) || published <= built.time) return;
      if (!code || code === built.code || code === declined) return;
      offer(code);
    } catch { /* A later check retries; the current page keeps working. */ }
    finally { checking = false; }
  }
  let timer = setInterval(check, CHECK_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  addEventListener("pagehide", () => clearInterval(timer));
  addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    clearInterval(timer);
    timer = setInterval(check, CHECK_MS);
    check();
  });
  check();
}

watchDeployment();
