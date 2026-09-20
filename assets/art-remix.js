// A listener's shared redraw of a song's clip art, allowed once an hour per song.
// The prompt previews live in this browser. Chairlift gets the seed and traits it
// produced, plus the words so this listener can look back at what they asked for.
import { remixFromPrompt, songArtwork } from "./song-art.js";

let dialog, active = null;
const list = (items) => items.join(", ");
function mount() {
  dialog = document.createElement("dialog");
  dialog.className = "art-remix";
  dialog.setAttribute("aria-labelledby", "art-remix-title");
  dialog.innerHTML = `<form method="dialog" novalidate><p class="eyebrow">One redraw per song each hour</p><h2 id="art-remix-title">Redraw this clip art</h2><p class="small" data-art-song></p>
    <div class="art-remix-preview"><figure><img data-art-now alt="" width="240" height="200"><figcaption>Now</figcaption></figure><span aria-hidden="true">→</span><figure><img data-art-next alt="" width="240" height="200"><figcaption>Your redraw</figcaption></figure></div>
    <fieldset class="art-remix-mode"><legend class="sr-only">How much to redraw</legend><label><input type="radio" name="art-remix-mode" value="fresh" checked> New picture</label><label><input type="radio" name="art-remix-mode" value="layer"> Change this one</label></fieldset>
    <label for="art-remix-prompt">What should it be?</label><input id="art-remix-prompt" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="a robot in sunglasses, blue, holding a balloon">
    <p class="small art-remix-result" role="status" aria-live="polite"></p>
    <p class="small">Try a character (robot, ghost, guitar…), a color, sunglasses, a monocle, a balloon, wink, dance, polka dots or flip. Everyone sees the picture. Your words are saved with it and shown only to you.</p>
    <div class="art-remix-actions"><button type="button" class="song-action" data-art-again disabled>🎲 Another take</button><button type="button" class="song-action" data-art-cancel>Cancel</button><button type="submit" class="primary" disabled>Use this redraw</button></div></form>`;
  document.body.append(dialog);
  const input = dialog.querySelector("#art-remix-prompt"), result = dialog.querySelector(".art-remix-result"), use = dialog.querySelector("[type=submit]"), another = dialog.querySelector("[data-art-again]");
  const say = (text, error = false) => {
    result.textContent = text;
    result.classList.toggle("field-error", error);
  };
  function preview() {
    const fresh = dialog.querySelector("[name=art-remix-mode]:checked").value === "fresh";
    const drawn = remixFromPrompt(active.song, input.value, { fresh, again: active.again });
    active.remix = drawn.changed ? drawn.remix : null;
    dialog.querySelector("[data-art-next]").src = drawn.art.src;
    dialog.querySelector("[data-art-next]").alt = drawn.art.alt;
    use.disabled = !drawn.changed;
    // Another take only helps where something is rolled: a new picture, or the dice.
    another.disabled = !input.value.trim() || !(fresh || drawn.diced.length);
    if (!input.value.trim()) return say("");
    if (!drawn.changed) return say(fresh ? "That came out the same. Try another take." : "That would not change this picture. Try other words, or a new picture." + (drawn.art.tier ? " Award art keeps its own colors, stage and empty hands." : ""));
    if (fresh) return say(drawn.understood.length ? "A new picture with: " + list(drawn.understood) + "." : "A new picture from your words. Name a character, a color or a prop to steer it.");
    const parts = drawn.understood.length ? ["Understood: " + list(drawn.understood) + "."] : [];
    if (drawn.diced.length) parts.push((parts.length ? "The dice also picked: " : drawn.asked ? "The dice picked: " : "No words I know there, so the dice picked: ") + list(drawn.diced) + ".");
    say(parts.join(" "));
  }
  input.addEventListener("input", () => {
    active.again = 0;
    preview();
  });
  dialog.querySelector(".art-remix-mode").addEventListener("change", preview);
  another.addEventListener("click", () => {
    active.again += 1;
    preview();
  });
  dialog.querySelector("[data-art-cancel]").addEventListener("click", () => dialog.close());
  // A click on the backdrop lands on the dialog itself, outside the form.
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { active = null; });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const sending = active;
    if (!sending?.remix || use.disabled) return;
    const rollable = !another.disabled;
    use.disabled = another.disabled = input.disabled = true;
    try {
      await sending.submit(sending.remix, input.value.trim());
      if (active === sending) dialog.close();
    } catch (error) {
      if (active === sending) say(error.message, true);
    } finally {
      input.disabled = false;
      if (active === sending) {
        use.disabled = !sending.remix;
        another.disabled = !rollable;
      }
    }
  });
  return preview;
}
let preview;
// `submit(remix, prompt)` saves the redraw and rejects with a listener-readable message.
export function openArtRemix(song, submit) {
  preview ||= mount();
  if (dialog.open) dialog.close();
  active = { song, submit, remix: null, again: 0 };
  const now = songArtwork(song), image = dialog.querySelector("[data-art-now]");
  image.src = now.src;
  image.alt = now.alt;
  dialog.querySelector("[data-art-song]").textContent = "“" + song.title + "”" + (now.remixed ? " has been redrawn before." : "");
  dialog.querySelector("#art-remix-prompt").value = "";
  dialog.querySelector("[value=fresh]").checked = true;
  preview();
  dialog.showModal();
}
