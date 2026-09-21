const key = "yehry3:authored-by";
let remembered = "";

export function savedAuthor() {
  try {
    remembered = localStorage.getItem(key) || "";
  } catch {
    // Keep the name usable for this page when browser storage is unavailable.
  }
  return remembered;
}

export function rememberAuthor(value) {
  const changed = value !== remembered;
  remembered = value;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // A storage restriction must not prevent a request.
  }
  if (changed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(changeEvent));
}

// One name is shared by the request form, the mixtape form and the listening room's card. A change made in
// this tab, or in another, is announced so each of them shows the same name at once.
const changeEvent = "yehry3:author-changed";
export function onAuthorChange(listener) {
  if (typeof window === "undefined") return;
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", (event) => { if (event.key === key || event.key === null) listener(); });
}
if (typeof window !== "undefined") {
  // Any "Authored by" field on the page follows the saved name, unless it is the one being typed in.
  onAuthorChange(() => {
    const name = savedAuthor();
    const field = document.getElementById("authored-by");
    if (!field || field === document.activeElement || field.value === name) return;
    field.value = name;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export const authorFieldFor = shownWith => `<label for="authored-by">Authored by <span class="small">(optional)</span></label><input id="authored-by" name="authoredBy" type="text" maxlength="100" autocomplete="nickname" aria-describedby="authored-by-help"><p class="small" id="authored-by-help">Your name or nickname, shown with ${shownWith}. Remembered in this browser for next time.</p>`;
export const authorField = authorFieldFor("your request and song");

export function authoredByLine(name, escape) {
  return typeof name === "string" && name.trim()
    ? `<span class="authored-by small">Authored by ${escape(name)}</span>`
    : "";
}
