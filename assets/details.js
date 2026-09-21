import "./quality-preference.js";
import { showMessage } from "./message.js";
import { mountModelInfo } from "./model-info.js";
import { watchCompletions } from "./notifications.js";
import { definePage } from "./shell.js";
const main = document.querySelector("#main");
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const safeUrl = (value) => {
  try { const url = new URL(value, location.origin); return ["https:", "http:"].includes(url.protocol) ? url.href : "#"; }
  catch { return "#"; }
};
async function mountPage() {
  mountModelInfo();
  watchCompletions();
  try {
    if (document.body.dataset.page === "original-prompt")
      await (await import("./original-prompt.js")).originalPromptPage(main, { escape, safeUrl });
    else await (await import("./lyrics.js")).lyricsPage(main, { escape, safeUrl });
  } catch {
    showMessage("This song could not load. Please try again.", true);
  }
}
definePage(import.meta.url, mountPage);
