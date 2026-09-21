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
  remembered = value;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // A storage restriction must not prevent a request.
  }
}

export const authorFieldFor = shownWith => `<label for="authored-by">Authored by <span class="small">(optional)</span></label><input id="authored-by" name="authoredBy" type="text" maxlength="100" autocomplete="nickname" aria-describedby="authored-by-help"><p class="small" id="authored-by-help">Your name or nickname, shown with ${shownWith}. Remembered in this browser for next time.</p>`;
export const authorField = authorFieldFor("your request and song");

export function authoredByLine(name, escape) {
  return typeof name === "string" && name.trim()
    ? `<span class="authored-by small">Authored by ${escape(name)}</span>`
    : "";
}
