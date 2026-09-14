import "./quality-preference.js";
import { mountModelInfo } from "./model-info.js";
import { watchCompletions } from "./notifications.js";
const main = document.querySelector("#main");
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const safeUrl = (value) => {
  try { const url = new URL(value, location.origin); return ["https:", "http:"].includes(url.protocol) ? url.href : "#"; }
  catch { return "#"; }
};
mountModelInfo();
watchCompletions();
try {
  if (document.body.dataset.page === "original-prompt")
    await (await import("./original-prompt.js")).originalPromptPage(main, { escape, safeUrl });
  else await (await import("./lyrics.js")).lyricsPage(main, { escape, safeUrl });
} catch {
  document.querySelector("#message").textContent = "This song could not load. Please try again.";
}
