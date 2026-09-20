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
