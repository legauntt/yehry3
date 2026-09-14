// Tommy says: this script runs both /wiseau/ (every shared line) and /wiseau/<id> (one line).
// scripts/build.mjs writes a copy of the page per clip at dist/wiseau/<id>/index.html with the
// line in its title and link-preview metadata; the id is read from the path and looked up in
// the static manifest that scripts/share_yehry3.py in the wiseau-tts project commits alongside
// each MP3. No API, no accounts: the manifest and the clips are plain files on this site.
const SITE_NAME = "Tommy says";
const status = document.querySelector("#status");
const eyebrow = document.querySelector("#eyebrow-text");
const clipView = document.querySelector("#clip");
const listView = document.querySelector("#list");
const rows = document.querySelector("#clips");
const clipTemplate = document.querySelector("#clip-template");
const rowTemplate = document.querySelector("#row-template");
const requestedId = decodeURIComponent(location.pathname)
  .replace(/^\/wiseau\/?/, "")
  .replace(/\/+$/, "");

const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Los_Angeles",
});
const clock = (seconds) => {
  const m = Math.floor(seconds / 60), s = seconds - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
};
const roughLength = (seconds) =>
  seconds < 60 ? `${Math.round(seconds)} second${Math.round(seconds) === 1 ? "" : "s"}` : clock(seconds);
const sizeLabel = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function mountPlayer(root, clip) {
  const audio = root.querySelector("audio");
  const play = root.querySelector(".play");
  const wave = root.querySelector(".wave");
  const now = root.querySelector(".now");
  const total = root.querySelector(".total");
  const ctx = wave.getContext("2d");
  const styles = getComputedStyle(document.documentElement);
  const colorBar = styles.getPropertyValue("--bar").trim();
  const colorAccent = styles.getPropertyValue("--accent").trim();
  const peaks = Array.isArray(clip.peaks) && clip.peaks.length ? clip.peaks : Array(96).fill(0.5);
  let frame = 0;

  audio.src = clip.url;
  const duration = () =>
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : clip.duration;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = wave.clientWidth, h = wave.clientHeight;
    if (!w || !h) return;
    if (wave.width !== Math.round(w * dpr) || wave.height !== Math.round(h * dpr)) {
      wave.width = Math.round(w * dpr);
      wave.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = peaks.length, gap = 2, bw = Math.max(1, (w - gap * (n - 1)) / n);
    const played = duration() ? audio.currentTime / duration() : 0;
    const mid = h / 2;
    for (let i = 0; i < n; i++) {
      const x = i * (bw + gap);
      const bh = Math.max(2, peaks[i] * (h - 4));
      ctx.fillStyle = (i + 0.5) / n <= played ? colorAccent : colorBar;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, mid - bh / 2, bw, bh, bw / 2);
      else ctx.rect(x, mid - bh / 2, bw, bh);
      ctx.fill();
    }
    now.textContent = clock(audio.currentTime);
    wave.setAttribute("aria-valuenow", audio.currentTime.toFixed(1));
    wave.setAttribute("aria-valuetext", `${audio.currentTime.toFixed(1)} seconds`);
  };
  const tick = () => {
    draw();
    if (!audio.paused) frame = requestAnimationFrame(tick);
  };
  const setPlaying = (on) => {
    play.setAttribute("aria-pressed", on ? "true" : "false");
    play.setAttribute("aria-label", on ? "Pause" : "Play");
  };
  const seekTo = (fraction) => {
    audio.currentTime = Math.min(Math.max(fraction, 0), 1) * duration();
    draw();
  };

  play.addEventListener("click", async () => {
    if (!audio.paused) return audio.pause();
    try {
      await audio.play();
    } catch {
      status.textContent = "Playback was blocked. Press play again, or use the MP3 link.";
    }
  });
  audio.addEventListener("play", () => {
    setPlaying(true);
    cancelAnimationFrame(frame);
    tick();
  });
  audio.addEventListener("pause", () => {
    setPlaying(false);
    cancelAnimationFrame(frame);
    draw();
  });
  audio.addEventListener("ended", () => {
    setPlaying(false);
    cancelAnimationFrame(frame);
    audio.currentTime = 0;
    draw();
  });
  audio.addEventListener("loadedmetadata", () => {
    total.textContent = clock(duration());
    wave.setAttribute("aria-valuemax", duration().toFixed(1));
    draw();
  });
  audio.addEventListener("error", () => {
    status.textContent = "The clip could not be loaded. Try the MP3 link below.";
  });
  wave.addEventListener("click", (event) => {
    const box = wave.getBoundingClientRect();
    seekTo((event.clientX - box.left) / box.width);
  });
  wave.addEventListener("keydown", (event) => {
    const step = 0.25;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      audio.currentTime = Math.min(audio.currentTime + step, duration());
      draw();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      audio.currentTime = Math.max(audio.currentTime - step, 0);
      draw();
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      play.click();
    }
  });
  window.addEventListener("resize", draw);
  total.textContent = clock(clip.duration);
  wave.setAttribute("aria-valuemax", clip.duration.toFixed(1));
  requestAnimationFrame(draw);
}

function showClip(clip) {
  const view = clipTemplate.content.cloneNode(true);
  view.querySelector(".quote").textContent = `“${clip.text}”`;
  const byline = view.querySelector(".byline");
  byline.append(`${roughLength(clip.duration)} in the voice of `);
  const who = document.createElement("b");
  who.textContent = clip.voice || "Tommy Wiseau";
  byline.append(who, ", produced by a voice model. He never said this.");

  const download = view.querySelector(".download");
  download.href = clip.url;
  download.textContent = `Download MP3 (${sizeLabel(clip.bytes)})`;

  view.querySelector(".meta-voice").textContent =
    `${clip.voice || "Tommy Wiseau"}, cloned from about 40 minutes of The Room and his interviews`;
  view.querySelector(".meta-model").textContent = clip.weights
    ? `${clip.model} (${clip.weights})`
    : clip.model || "Voice model";
  const reference = view.querySelector(".meta-reference");
  if (clip.reference?.text) {
    reference.append("A dataset clip: ");
    const q = document.createElement("span");
    q.className = "q";
    q.textContent = `“${clip.reference.text}”`;
    reference.append(q);
  } else {
    reference.textContent = clip.reference?.clip || "The model's own pick";
  }
  view.querySelector(".meta-shared").textContent = clip.createdAt
    ? dateLabel.format(new Date(clip.createdAt))
    : "Unknown";

  const copy = view.querySelector(".copy");
  const link = `${location.origin}/wiseau/${clip.id}`;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = "Link copied";
      copy.dataset.state = "done";
    } catch {
      copy.textContent = link;
      copy.dataset.state = "shown";
    }
    setTimeout(() => {
      copy.textContent = "Copy link";
      delete copy.dataset.state;
    }, 2500);
  });

  clipView.replaceChildren(view);
  mountPlayer(clipView, clip);
  document.title = `“${clip.text}” · ${SITE_NAME}`;
  eyebrow.textContent = "Voice memo · synthetic voice";
  listView.hidden = true;
  clipView.hidden = false;
  status.textContent = "";
}

function showList(clips) {
  rows.replaceChildren(
    ...clips.map((clip) => {
      const row = rowTemplate.content.cloneNode(true);
      const quote = row.querySelector(".row-quote");
      quote.href = `/wiseau/${clip.id}`;
      quote.textContent = `“${clip.text}”`;
      row.querySelector(".row-meta").textContent = `${
        clip.createdAt ? dateLabel.format(new Date(clip.createdAt)) : "Undated"
      } · ${clock(clip.duration)}`;
      const audio = row.querySelector("audio");
      audio.src = clip.url;
      audio.setAttribute("aria-label", `Play “${clip.text}”`);
      return row;
    }),
  );
  if (!clips.length) {
    const empty = document.createElement("li");
    empty.className = "clips-empty";
    empty.textContent = "Nothing shared yet.";
    rows.append(empty);
  }
  listView.hidden = false;
  clipView.hidden = true;
}

async function load() {
  let manifest;
  try {
    const response = await fetch("/wiseau/clips.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(response.statusText);
    manifest = await response.json();
  } catch {
    status.textContent = "The clips could not be loaded. Try again in a moment.";
    return;
  }
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];
  if (requestedId) {
    const clip = clips.find((entry) => entry.id === requestedId);
    if (clip) return showClip(clip);
    status.textContent =
      "No clip lives at this link. It may have been removed, or the address was copied incompletely. Here is everything that has been shared.";
    showList(clips);
    return;
  }
  status.textContent = "";
  showList(clips);
}

load();
