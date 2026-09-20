// A listener's one shared redraw of a song's clip art. The prompt previews live in
// this browser; only the traits it pinned are sent, never the words themselves.
import { remixFromPrompt, songArtwork } from "./song-art.js";

let dialog, active = null;
const list = (items) => items.join(", ");
function mount() {
  dialog = document.createElement("dialog");
  dialog.className = "art-remix";
  dialog.setAttribute("aria-labelledby", "art-remix-title");
  dialog.innerHTML = `<form method="dialog" novalidate><p class="eyebrow">One redraw per song</p><h2 id="art-remix-title">Redraw this clip art</h2><p class="small" data-art-song></p>
    <div class="art-remix-preview"><figure><img data-art-now alt="" width="240" height="200"><figcaption>Now</figcaption></figure><span aria-hidden="true">→</span><figure><img data-art-next alt="" width="240" height="200"><figcaption>Your redraw</figcaption></figure></div>
    <label for="art-remix-prompt">What should change?</label><input id="art-remix-prompt" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="a robot in sunglasses, blue, holding a balloon">
    <p class="small art-remix-result" role="status" aria-live="polite"></p>
    <p class="small">Try a character (robot, ghost, guitar…), a color, sunglasses, a monocle, a balloon, wink, dance, polka dots, flip, or “surprise me”. Everyone sees the result, and this browser gets one go per song.</p>
    <div class="art-remix-actions"><button type="button" class="song-action" data-art-cancel>Cancel</button><button type="submit" class="primary" disabled>Use this redraw</button></div></form>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input"), result = dialog.querySelector(".art-remix-result"), use = dialog.querySelector("[type=submit]");
  const say = (text, error = false) => {
    result.textContent = text;
    result.classList.toggle("field-error", error);
  };
  function preview() {
    const drawn = remixFromPrompt(active.song, input.value);
    active.remix = drawn.changed ? drawn.remix : null;
    dialog.querySelector("[data-art-next]").src = drawn.art.src;
    dialog.querySelector("[data-art-next]").alt = drawn.art.alt;
    use.disabled = !drawn.changed;
    if (!input.value.trim()) return say("");
    if (!drawn.changed) return say("That would not change this picture. Try other words." + (drawn.art.tier ? " Award art keeps its own colors, stage and empty hands." : ""));
    const parts = drawn.understood.length ? ["Understood: " + list(drawn.understood) + "."] : [];
    if (drawn.diced.length) parts.push((parts.length ? "The dice also picked: " : drawn.asked ? "The dice picked: " : "No words I know there, so the dice picked: ") + list(drawn.diced) + ".");
    say(parts.join(" "));
  }
  input.addEventListener("input", preview);
  dialog.querySelector("[data-art-cancel]").addEventListener("click", () => dialog.close());
  // A click on the backdrop lands on the dialog itself, outside the form.
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { active = null; });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const sending = active;
    if (!sending?.remix || use.disabled) return;
    use.disabled = input.disabled = true;
    try {
      await sending.submit(sending.remix);
      if (active === sending) dialog.close();
    } catch (error) {
      if (active === sending) say(error.message, true);
    } finally {
      input.disabled = false;
      if (active === sending) use.disabled = !sending.remix;
    }
  });
  return preview;
}
let preview;
// `submit(remix)` saves the redraw and rejects with a listener-readable message.
export function openArtRemix(song, submit) {
  preview ||= mount();
  if (dialog.open) dialog.close();
  active = { song, submit, remix: null };
  const now = songArtwork(song), image = dialog.querySelector("[data-art-now]");
  image.src = now.src;
  image.alt = now.alt;
  dialog.querySelector("[data-art-song]").textContent = "“" + song.title + "”" + (now.remixed ? " has been redrawn before; yours builds on it." : "");
  dialog.querySelector("input").value = "";
  preview();
  dialog.showModal();
}
