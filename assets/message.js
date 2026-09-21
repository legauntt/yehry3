// Status banner (#message): clears itself after a while and can be dismissed with the ×.
// The × is drawn in CSS so the banner's text stays just the message.
let timer = 0;
let hovering = false;
let wait = 0;

const clear = (region) => {
  clearTimeout(timer);
  timer = 0;
  region.textContent = "";
  region.classList.remove("error");
};
const arm = (region) => {
  clearTimeout(timer);
  timer = setTimeout(() => clear(region), wait);
};

// A toast floats at the bottom of the viewport, so it is seen wherever the page is scrolled.
// `action` adds one button ({ label, run }), such as Undo.
let toastTimer = 0;
export function showToast(text, { error = false, action } = {}) {
  let region = document.querySelector("#toast");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast";
    region.className = "toast";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  clearTimeout(toastTimer);
  region.textContent = "";
  region.classList.toggle("error", error);
  const body = document.createElement("span");
  body.textContent = text;
  region.append(body);
  const close = () => { clearTimeout(toastTimer); region.textContent = ""; region.classList.remove("error"); };
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => { close(); action.run(); });
    region.append(button);
  }
  toastTimer = setTimeout(close, error ? 10000 : action ? 8000 : 5000);
}

export function showMessage(text, error = false) {
  const region = document.querySelector("#message");
  if (!region) return;
  clearTimeout(timer);
  region.textContent = "";
  region.classList.toggle("error", error);
  if (!text) return;
  const body = document.createElement("span");
  body.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "message-close";
  close.setAttribute("aria-label", "Dismiss message");
  close.addEventListener("click", () => clear(region));
  region.append(body, close);
  wait = Math.max(6000, text.length * 70) * (error ? 2 : 1);
  if (!region.dataset.timed) {
    region.dataset.timed = "true";
    // Reading time isn't rushed: hovering or focusing inside holds the banner, leaving restarts the clock.
    region.addEventListener("mouseenter", () => { hovering = true; clearTimeout(timer); });
    region.addEventListener("mouseleave", () => { hovering = false; if (region.firstChild) arm(region); });
    region.addEventListener("focusin", () => clearTimeout(timer));
    region.addEventListener("focusout", () => { if (!hovering && region.firstChild) arm(region); });
  }
  if (!hovering) arm(region);
}
