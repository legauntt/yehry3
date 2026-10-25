// A listener's shared redraw of a song's clip art, allowed once an hour per song.
// The dialog offers only what the drawing code can draw, as chips per trait, so
// every pick shows in the preview. A shuffle rolls a new picture under the pins,
// and a doodle pad draws over it. Chairlift gets the seed, pins and doodle, plus
// a note of the picks so this listener can look back at what they asked for.
import { artChoices, characterIcon, remixFromPicks, shuffleSeed, songArtwork } from "./song-art.js";
import { canDraw, mountDoodlePad } from "./art-draw.js";

const sections = [["theme", "Character"], ["palette", "Colors"], ["pose", "Pose"], ["prop", "In hand"], ["extra", "Accessory"], ["eyes", "Eyes"], ["mouth", "Mouth"], ["backdrop", "Backdrop"], ["confetti", "Sprinkles"], ["tilt", "Lean"], ["flip", "Facing"]];
let dialog, active = null;
const list = items => items.join(", ");
const copy = strokes => strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => [...point]) }));
// Chairlift keeps 80 characters of the note; whole picks fit, then an ellipsis.
function note(labels) {
  let text = "";
  for (const label of labels) {
    const longer = text ? text + ", " + label : label;
    if (longer.length > 79) return text + "…";
    text = longer;
  }
  return text;
}
function mount() {
  dialog = document.createElement("dialog");
  dialog.className = "art-remix";
  dialog.setAttribute("aria-labelledby", "art-remix-title");
  dialog.innerHTML = `<form method="dialog" novalidate><p class="eyebrow">One redraw per song each hour</p><h2 id="art-remix-title">Redraw this clip art</h2><p class="small" data-art-song></p>
    <div class="art-remix-preview"><figure><img data-art-now alt="" width="240" height="200"><figcaption>Now</figcaption></figure><span aria-hidden="true">→</span><figure><div class="art-remix-canvas"><img data-art-next alt="" width="240" height="200"></div><figcaption>Your redraw</figcaption></figure></div>
    <div class="art-remix-tools"><button type="button" class="song-action" data-art-shuffle>🎲 Shuffle the rest</button><button type="button" class="song-action" data-art-draw aria-pressed="false" aria-controls="art-remix-pad">✏️ Draw on it</button><button type="button" class="song-action" data-art-reset disabled>↺ Start over</button></div>
    <div class="art-remix-pad" id="art-remix-pad" hidden></div>
    <p class="small art-remix-result" role="status" aria-live="polite"></p>
    <p class="small" data-art-note hidden></p>
    <div class="art-remix-picker" data-art-picker></div>
    <p class="small">Everyone sees the picture. A note of your picks is saved with it and shown only to you.</p>
    <div class="art-remix-actions"><button type="button" class="quiet" data-art-cancel>Cancel</button><button type="submit" class="primary" disabled>Use this redraw</button></div></form>`;
  document.body.append(dialog);
  const result = dialog.querySelector(".art-remix-result"), use = dialog.querySelector("[type=submit]"), picker = dialog.querySelector("[data-art-picker]");
  const next = dialog.querySelector("[data-art-next]"), canvas = dialog.querySelector(".art-remix-canvas"), padTools = dialog.querySelector(".art-remix-pad");
  const shuffle = dialog.querySelector("[data-art-shuffle]"), draw = dialog.querySelector("[data-art-draw]"), reset = dialog.querySelector("[data-art-reset]");
  const say = (text, error = false) => {
    result.textContent = text;
    result.classList.toggle("field-error", error);
  };
  const words = new Map();
  const pad = canDraw() ? mountDoodlePad(canvas, padTools, { strokes: () => active?.doodle || [], onChange: () => render(), say }) : null;
  if (!pad) draw.hidden = true;
  function build(choices) {
    picker.innerHTML = "";
    words.clear();
    for (const [trait, name] of sections) {
      if (!choices.open.includes(trait)) continue;
      const section = document.createElement("fieldset");
      section.className = "art-remix-trait";
      section.dataset.trait = trait;
      section.innerHTML = `<legend>${name} <span class="small" data-art-now-label></span></legend>`;
      if (trait === "theme") section.insertAdjacentHTML("beforeend", `<input type="search" class="art-remix-find" placeholder="Find a character (robot, ghost, guitar…)" aria-label="Find a character" autocomplete="off"><p class="small art-remix-missing" hidden></p>`);
      const chips = document.createElement("div");
      chips.className = "art-remix-chips" + (trait === "theme" ? " art-remix-cast" : "");
      const options = trait === "theme" ? choices.characters : trait === "palette" ? choices.swatches : choices.choices[trait].map(([value, label]) => ({ value, label }));
      for (const option of options) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "art-chip";
        chip.dataset.value = String(option.value);
        chip.setAttribute("aria-pressed", "false");
        if (trait === "theme") {
          const icon = new Image(48, 48);
          icon.alt = "";
          icon.decoding = "async";
          chip.append(icon, document.createTextNode(option.label));
          words.set(chip, option.words);
        } else if (trait === "palette") {
          chip.classList.add("art-swatch");
          option.colors.forEach((color, index) => chip.style.setProperty("--swatch-" + index, color));
          chip.setAttribute("aria-label", option.label);
          chip.title = option.label;
        } else chip.textContent = option.label;
        chips.append(chip);
      }
      section.append(chips);
      picker.append(section);
    }
    const note = dialog.querySelector("[data-art-note]");
    note.textContent = ((choices.tier ? "Award art keeps its mascots, stage, sprinkles and empty hands. " : "") + (choices.seesaw ? "See-saw keeps that mouth." : "")).trim();
    note.hidden = !note.textContent;
  }
  // The cast is long; open on the character the picture shows.
  function reveal() {
    const cast = picker.querySelector(".art-remix-cast"), hit = cast?.querySelector("[aria-pressed=true], [data-current]");
    if (hit) cast.scrollTop = hit.getBoundingClientRect().top - cast.getBoundingClientRect().top + cast.scrollTop - 4;
  }
  const labelOf = chip => chip.getAttribute("aria-label") || chip.textContent;
  function render() {
    if (!active) return;
    const { song } = active;
    const drawn = remixFromPicks(song, active);
    const choices = artChoices({ ...song, artRemix: drawn.state });
    active.remix = drawn.changed ? drawn.remix : null;
    next.src = drawn.art.src;
    next.alt = drawn.art.alt;
    pad?.setColors(choices.pens);
    const labels = [];
    for (const section of picker.querySelectorAll("[data-trait]")) {
      const trait = section.dataset.trait, now = choices.current[trait], pinned = active.pins[trait];
      let nowLabel = "";
      for (const chip of section.querySelectorAll(".art-chip")) {
        const value = trait === "theme" ? chip.dataset.value : Number(chip.dataset.value);
        chip.setAttribute("aria-pressed", String(pinned === value));
        chip.toggleAttribute("data-current", now === value);
        if (now === value) nowLabel = labelOf(chip);
        if (pinned === value) labels.push(labelOf(chip).toLowerCase());
        if (trait === "theme" && chip.dataset.palette !== String(choices.current.palette)) {
          chip.dataset.palette = String(choices.current.palette);
          chip.querySelector("img").src = characterIcon(value, choices.current.palette);
        }
      }
      if (trait === "eyes" && !nowLabel) nowLabel = choices.eyesNote;
      section.querySelector("[data-art-now-label]").textContent = nowLabel ? "· now " + nowLabel.toLowerCase() : "";
    }
    const doodled = drawn.remix.doodle !== undefined, shuffled = active.seed !== null;
    const parts = [];
    if (labels.length) parts.push("Pinned: " + list(labels) + ".");
    if (shuffled) parts.push("The rest is shuffled.");
    if (doodled) parts.push(active.doodle.length ? "With your doodle." : "Doodle cleared.");
    if (!drawn.changed) parts.push(labels.length || shuffled ? "That is the picture as it is. Pick something else, or shuffle again." : "Pick a character, colors or a look, shuffle for a new picture, or draw on it.");
    say(parts.join(" "));
    use.disabled = !drawn.changed;
    reset.disabled = !labels.length && !shuffled && !doodled;
    active.note = note([...labels, ...(shuffled ? ["shuffled"] : []), ...(doodled ? [active.doodle.length ? "a doodle" : "doodle cleared"] : [])]);
  }
  picker.addEventListener("click", event => {
    const chip = event.target.closest(".art-chip");
    if (!chip || !active) return;
    const trait = chip.closest("[data-trait]").dataset.trait;
    const value = trait === "theme" ? chip.dataset.value : Number(chip.dataset.value);
    if (active.pins[trait] === value) delete active.pins[trait];
    else active.pins[trait] = value;
    render();
  });
  picker.addEventListener("input", event => {
    const find = event.target.closest(".art-remix-find");
    if (!find) return;
    const query = find.value.trim().toLowerCase(), section = find.closest("[data-trait]"), missing = section.querySelector(".art-remix-missing");
    const chips = [...section.querySelectorAll(".art-chip")];
    const matching = query ? chips.filter(chip => chip.textContent.toLowerCase().includes(query) || chip.dataset.value.includes(query) || words.get(chip)?.test(query)) : chips;
    // An unknown word shows the whole cast rather than nobody.
    for (const chip of chips) chip.hidden = matching.length > 0 && !matching.includes(chip);
    missing.hidden = matching.length > 0;
    missing.textContent = matching.length ? "" : `No “${find.value.trim()}” in the cast, but here is everyone.`;
  });
  shuffle.addEventListener("click", () => {
    active.shuffles += 1;
    active.seed = shuffleSeed(active.song, active.shuffles);
    render();
  });
  reset.addEventListener("click", () => {
    pad?.cancel();
    Object.assign(active, { pins: {}, seed: null, shuffles: 0, doodle: copy(active.base) });
    pad?.refresh();
    render();
  });
  draw.addEventListener("click", () => {
    const on = draw.getAttribute("aria-pressed") !== "true";
    draw.setAttribute("aria-pressed", String(on));
    padTools.hidden = !on;
    canvas.classList.toggle("is-drawing", on);
    if (!on) pad?.cancel();
  });
  dialog.querySelector("[data-art-cancel]").addEventListener("click", () => dialog.close());
  // A click on the backdrop lands on the dialog itself, outside the form.
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { pad?.cancel(); active = null; });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const sending = active;
    if (!sending?.remix || use.disabled) return;
    use.disabled = shuffle.disabled = reset.disabled = true;
    picker.classList.add("is-sending");
    try {
      await sending.submit(sending.remix, sending.note);
      if (active === sending) dialog.close();
    } catch (error) {
      if (active === sending) say(error.message, true);
    } finally {
      picker.classList.remove("is-sending");
      shuffle.disabled = false;
      if (active === sending) {
        use.disabled = !sending.remix;
        reset.disabled = false;
      }
    }
  });
  return { build, render, reveal, pad, draw, padTools, canvas };
}
let ui;
// `submit(remix, note)` saves the redraw and rejects with a listener-readable message.
export function openArtRemix(song, submit) {
  ui ||= mount();
  if (dialog.open) dialog.close();
  const choices = artChoices(song);
  active = { song, submit, pins: {}, seed: null, shuffles: 0, base: copy(choices.doodle), doodle: copy(choices.doodle), remix: null, note: "" };
  const now = songArtwork(song), image = dialog.querySelector("[data-art-now]");
  image.src = now.src;
  image.alt = now.alt;
  dialog.querySelector("[data-art-song]").textContent = "“" + song.title + "”" + (now.remixed ? " has been redrawn before." : "");
  ui.draw.setAttribute("aria-pressed", "false");
  ui.padTools.hidden = true;
  ui.canvas.classList.remove("is-drawing");
  ui.build(choices);
  ui.pad?.refresh();
  ui.render();
  dialog.showModal();
  dialog.scrollTop = 0;
  ui.reveal();
}
