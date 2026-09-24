import { definePage } from "./shell.js";
import { player, audio as siteAudio } from "./player.js";
import { qualityNotice } from "./quality.js";
import { songBadges } from "./song-badges.js";

const stages = [
  { id: "seed", label: "Seed", title: "Plant a Tony Seed.", kicker: "01 / The idea & the plan",
    copy: "A request starts with an idea. The planner turns the brief into lyrics, a musical direction and a song structure. The band generator and Tony’s voice are separate choices.",
    output: "A saved plan: words, sections, musical direction and a target length.",
    listenTitle: "Words before waves.", listenCopy: "There isn’t a recording yet. This is the recipe the music generator will work from.", seed: "A little direction. A little imagination. A suspicious amount of Tony." },
  { id: "handoff", label: "Handoff", title: "Let it simmer.", kicker: "02 / Between plan and sound",
    copy: "The saved plan hands over to the renderer. Setup, waiting and other work between those two timestamps all land here. The recordings don’t tell us how much of this gap was spent on each.",
    output: "The renderer begins work on the saved plan.",
    listenTitle: "The quiet part.", listenCopy: "A completed plan is not yet a completed song. This interval matters when you’re wondering where the minutes went.", seed: "Even a banger spends a little time on the back burner." },
  { id: "band", label: "Band", title: "Bring in the band.", kicker: "03 / The paths fork here",
    emp: "Eleven Music composes a full performance remotely: instruments, melody and a guide singer. This is the paid composition step. The guide singer gives Tony a performance to follow later.",
    ace: "ACE composes a full performance on this PC: instruments, melody and a guide singer. There is no paid music-provider call for this step; it uses local compute. Tony’s voice still comes later.",
    output: "A full generated recording with instruments and a guide voice.", layer: "generated",
    listenTitle: "Before the Tony seasoning.", listenCopy: "This is the generated performance, before Tony’s voice conversion. Listen for the melody and phrasing that carry into the finished record." },
  { id: "separate", label: "Separate", title: "Pull it apart.", kicker: "04 / Separate & prepare",
    copy: "The generated recording is separated into vocals and accompaniment. The words are timed, the arrangement is configured, and the ending is checked before the voice work begins.",
    output: "A guide vocal to sing from, and a backing track to keep.", layer: "guide",
    listenTitle: "Two sides of the same sausage.", listenCopy: "Switch between Guide vocal and Band only. Separation can leave a little bleed behind; these are the retained production stems." },
  { id: "tony", label: "Tony", title: "Add the C ingredient.", kicker: "05 / Pitch & voice conversion",
    copy: "The guide performance is prepared in phrases, its pitch is analyzed, and the saved Tony V9 voice model converts the singing. The phrases are assembled back into one vocal, following the guide’s words and timing.",
    output: "An assembled Tony vocal, ready to sit over the band.", layer: "tony",
    listenTitle: "Tony, hold the band.", listenCopy: "Hear Tony solo, then switch to Guide vocal at the same point. Tone changes; the underlying performance still comes from the generated song." },
  { id: "checks", label: "Checks", title: "The taste test.", kicker: "06 / Voice & lyric checks",
    copy: "Automatic checks look at vocal coverage, pitch and the converted words. These checks can trigger a bounded retry. They measure specific problems; they don’t decide whether the song is a good listen.",
    output: "A checked performance, with any unresolved issues carried into publication.", layer: "tony",
    listenTitle: "A second helping?", listenCopy: "This is the retained Tony vocal after checks. A retry doesn’t automatically replace the first take." },
  { id: "record", label: "Record", title: "Dinner is served.", kicker: "07 / Mix, export & publish",
    copy: "Tony and the backing track come together in the final mix. The recording is exported, uploaded and added to the catalog. The full song below is the existing published release.",
    output: "One finished Tony C record, ready for the listening room.", layer: "final",
    listenTitle: "From seed to C.", listenCopy: "Compare the finished passage with the generated mix, or settle in for the whole song." },
];
const layers = { generated: "Generated mix", guide: "Guide vocal", backing: "Band only", tony: "Tony solo", final: "Finished mix" };
const escape = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const duration = (seconds) => seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;

definePage(import.meta.url, async ({ scope }) => {
  const $ = (selector) => document.querySelector(selector);
  const loading = $("#tour-loading");
  let data;
  try {
    const response = await fetch("/sausage/tour.json", { signal: scope.signal });
    if (!response.ok) throw new Error("Tour unavailable");
    data = await response.json();
  } catch {
    if (!scope.left) loading.innerHTML = '<p>The recipe book couldn’t load. <a href="/sausage/" data-shell="off">Try opening it again →</a></p>';
    return;
  }
  if (scope.left) return;
  const excerpt = $("#tour-audio");
  let kitchen = "emp", step = 0, currentLayer = "", pending = null;
  const run = () => data.runs.find(r => r.key === kitchen);
  const setText = (id, text) => { $(id).textContent = text; };
  const readHash = () => {
    const [key, stage] = location.hash.slice(1).split("/");
    kitchen = data.runs.some(r => r.key === key) ? key : "emp";
    step = Math.max(0, stages.findIndex(s => s.id === stage));
  };
  const remember = () => history.replaceState(history.state, "", `${location.pathname}${location.search}#${kitchen}/${stages[step].id}`);

  function selectLayer(layer, keepPosition = false) {
    const time = keepPosition ? excerpt.currentTime : 0;
    const playing = keepPosition && !excerpt.paused && !excerpt.ended;
    excerpt.pause();
    pending = { time, playing };
    currentLayer = layer;
    $("#audio-error").hidden = true;
    excerpt.src = run().clips[layer];
    excerpt.preload = "metadata";
    excerpt.load();
    setText("#audio-label", `${layers[layer]} · ${run().song.title}`);
    $("#audio-direct").href = excerpt.src;
    for (const button of $("#audio-layers").children) button.setAttribute("aria-pressed", String(button.dataset.layer === layer));
  }
  scope.on(excerpt, "loadedmetadata", () => {
    const seek = pending;
    pending = null;
    if (!seek) return;
    excerpt.currentTime = Math.min(seek.time, Math.max(0, excerpt.duration - .1));
    if (seek.playing) void excerpt.play().catch(() => { /* Native controls allow another user gesture. */ });
  });
  scope.on(excerpt, "error", () => { if (excerpt.getAttribute("src")) $("#audio-error").hidden = false; });
  scope.on(excerpt, "play", () => player.pause());
  scope.on(siteAudio, "play", () => { pending = null; excerpt.pause(); });
  scope.onLeave(() => { pending = null; excerpt.pause(); excerpt.removeAttribute("src"); excerpt.load(); });

  $("#tour-steps").innerHTML = stages.map((s, i) => `<button type="button" data-step="${i}" aria-label="${i + 1}. ${s.label}"><span class="step-number" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>${s.label}</button>`).join("");
  $("#audio-layers").innerHTML = Object.entries(layers).map(([key, name]) => `<button type="button" data-layer="${key}" aria-pressed="false">${name}</button>`).join("");

  function render() {
    const r = run(), stage = stages[step];
    for (const button of document.querySelectorAll("[data-kitchen]")) button.setAttribute("aria-pressed", String(button.dataset.kitchen === kitchen));
    for (const [i, button] of [...$("#tour-steps").children].entries()) {
      if (i === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    setText("#tour-run-label", kitchen === "emp" ? "EMP / Eleven Music · paid" : "Local / ACE · on this PC");
    setText("#tour-song", r.song.title);
    $("#tour-song-badges").innerHTML = songBadges(r.song);
    setText("#tour-total", `≈ ${duration(r.totalSeconds)}`);
    setText("#stage-count", `Step ${String(step + 1).padStart(2, "0")} / 07`);
    setText("#stage-time", `≈ ${duration(r.seconds[step])} here`);
    setText("#stage-kicker", stage.kicker);
    setText("#stage-title", stage.title);
    setText("#stage-copy", stage[kitchen] || stage.copy);
    setText("#stage-output", stage.output);
    $("#tour-brief").hidden = step !== 0;
    $("#tour-brief").href = `/original-prompt/?song=${r.song.id}`;
    setText("#stage-footnote", step === 5 ? (r.vocalRetries ? "This ACE run re-sang one flagged phrase. The second take was no closer, so the original take was kept. Retry time is included here." : "This EMP run kept its first converted performance; no vocal re-sing is recorded.") : "");
    setText("#listen-title", stage.listenTitle);
    setText("#listen-copy", stage.listenCopy);
    setText("#listen-eyebrow", stage.layer ? "Hear the same passage at each stage" : "No audio at this stage");
    $("#tour-audio-area").hidden = !stage.layer;
    $("#seed-note").hidden = Boolean(stage.layer);
    setText("#seed-copy", stage.seed || "");
    $("#final-links").hidden = step !== 6;
    $("#full-song-link").href = `/#${r.song.id}`;
    $("#tour-quality").innerHTML = qualityNotice(r.song.qualityIssues, r.song.reviewState, r.song.validationFailures);
    if (stage.layer) selectLayer(stage.layer);
    else { pending = null; excerpt.pause(); excerpt.removeAttribute("src"); excerpt.load(); currentLayer = ""; }
    setText("#audio-note", "0:30–0:54 of the song · Switching layers keeps your place. Original levels; volume may change between layers.");
    setText("#tour-position", `${step + 1} of 7 · ${stage.label}`);
    $("#tour-prev").disabled = step === 0;
    $("#tour-next").disabled = step === stages.length - 1;
  }
  function go(next, key = kitchen) {
    step = Math.max(0, Math.min(stages.length - 1, next));
    kitchen = key;
    render();
    remember();
  }
  scope.on($("#tour-steps"), "click", e => { const b = e.target.closest("[data-step]"); if (b) go(Number(b.dataset.step)); });
  scope.on($("#tour-steps"), "keydown", e => {
    const b = e.target.closest("[data-step]");
    if (!b || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = Number(b.dataset.step);
    go(e.key === "Home" ? 0 : e.key === "End" ? 6 : i + (e.key === "ArrowRight" ? 1 : -1));
    $("#tour-steps").children[step].focus();
  });
  for (const button of document.querySelectorAll("[data-kitchen]")) scope.on(button, "click", () => go(step, button.dataset.kitchen));
  scope.on($("#tour-prev"), "click", () => { go(step - 1); $("#stage-title").focus({ preventScroll: true }); });
  scope.on($("#tour-next"), "click", () => { go(step + 1); $("#stage-title").focus({ preventScroll: true }); });
  scope.on($("#audio-layers"), "click", e => { const b = e.target.closest("[data-layer]"); if (b && b.dataset.layer !== currentLayer) selectLayer(b.dataset.layer, true); });
  scope.on($("#play-full"), "click", () => { pending = null; excerpt.pause(); void player.play(run().song, [run().song], { source: "sausage" }); });
  scope.on(window, "hashchange", () => { readHash(); render(); });

  const max = Math.max(...data.runs.map(r => r.totalSeconds));
  $("#time-comparison").innerHTML = data.runs.map(r => `<div class="time-row"><div class="time-label"><strong>${r.key === "emp" ? "EMP · PAID" : "ACE · LOCAL"}</strong><span>≈ ${duration(r.totalSeconds)}</span></div><div class="time-bar" role="group" aria-label="${r.key.toUpperCase()} stage times">${r.seconds.map((seconds, i) => `<button type="button" class="time-segment" data-run="${r.key}" data-stage="${i}" title="${stages[i].label}: ${duration(seconds)}" aria-label="${r.key.toUpperCase()} ${stages[i].label}: ${duration(seconds)}"></button>`).join("")}<span class="time-remainder" aria-hidden="true"></span></div><div class="time-keys">${r.seconds.map((s, i) => `<button type="button" class="time-key" data-run="${r.key}" data-stage="${i}">${escape(stages[i].label)} ${duration(s)}</button>`).join("")}</div></div>`).join("");
  // CSSOM keeps dynamic sizes compatible with the site's no-inline-style CSP.
  for (const [i, row] of [...$("#time-comparison").children].entries()) {
    const r = data.runs[i];
    for (const [j, segment] of [...row.querySelectorAll(".time-segment")].entries()) segment.style.flex = `${r.seconds[j]} 1 0%`;
    row.querySelector(".time-remainder").style.flex = `${max - r.totalSeconds} 1 0%`;
  }
  scope.on($("#time-comparison"), "click", e => {
    const b = e.target.closest("[data-stage]");
    if (!b) return;
    go(Number(b.dataset.stage), b.dataset.run);
    $("#stage-title").focus({ preventScroll: true });
    $("#tour-steps").scrollIntoView({ behavior: "instant", block: "start" });
  });
  readHash();
  render();
  loading.hidden = true;
  $("#tour-content").hidden = false;
});
