import { pickBrandLine } from "./brand-lines.js";

let previous;
try { previous = sessionStorage.getItem("yehry3:brand-line"); } catch { /* Optional variety preference. */ }
export const brandLine = pickBrandLine(previous);
try { sessionStorage.setItem("yehry3:brand-line", brandLine); } catch { /* Still random without storage. */ }

for (const footer of document.querySelectorAll("[data-brand-footer]")) {
  footer.textContent = `YEHRY3 · ${brandLine.replace("\n", " ")}`;
}
