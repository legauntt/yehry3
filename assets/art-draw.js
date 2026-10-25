// A doodle pad over the redraw preview. Pen strokes land in the picture's own
// 240 x 200 space, lose their jitter, and are kept as integers so the whole doodle
// stays a short string Chairlift can store. The pad only shows the stroke being
// drawn; the picture itself shows the finished ones.
import { doodleLimits, serializeDoodle } from "./song-art.js";

const width = 240, height = 200;
// How much of Chairlift's allowance one doodle may spend, with headroom for its encoding.
export const inkBudget = 2400;
const pens = ["Pen", "White", "First color", "Second color", "Rose", "Gold"], sizes = ["Thin", "Medium", "Thick"];
const svgNS = "http://www.w3.org/2000/svg";

// Ramer–Douglas–Peucker: keep the points that shape a line and drop the wobble between them.
export function simplify(points, tolerance = 1.2) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1], along = Math.hypot(bx - ax, by - ay);
  let farthest = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const distance = along < 1e-6 ? Math.hypot(x - ax, y - ay) : Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / along;
    if (distance > farthest) { farthest = distance; at = i; }
  }
  if (farthest <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}
// A finished stroke: simplified, rounded to the grid, without repeats, and never longer than Chairlift allows.
export function settle(points) {
  const rounded = simplify(points).map(([x, y]) => [Math.round(x), Math.round(y)]);
  const kept = rounded.filter(([x, y], i) => !i || x !== rounded[i - 1][0] || y !== rounded[i - 1][1]);
  if (kept.length <= doodleLimits.points) return kept;
  const step = kept.length / doodleLimits.points;
  return Array.from({ length: doodleLimits.points }, (_, i) => kept[Math.min(kept.length - 1, Math.floor(i * step))]);
}
export const canDraw = () => {
  try { return typeof PointerEvent === "function" && typeof document.createElementNS === "function"; }
  catch { return false; }
};

// `strokes()` returns the dialog's stroke list, which the pad edits in place.
// `onChange` runs after every finished stroke, undo or clear; `say` reports limits.
export function mountDoodlePad(canvas, tools, { strokes, onChange, say }) {
  const pad = document.createElementNS(svgNS, "svg");
  pad.setAttribute("class", "art-doodle-pad");
  pad.setAttribute("viewBox", "0 0 " + width + " " + height);
  pad.setAttribute("aria-label", "Doodle pad. Draw over the picture with a mouse, finger or pen.");
  pad.setAttribute("role", "img");
  const live = document.createElementNS(svgNS, "path");
  live.setAttribute("fill", "none");
  live.setAttribute("stroke-linecap", "round");
  live.setAttribute("stroke-linejoin", "round");
  pad.append(live);
  canvas.append(pad);
  tools.innerHTML = '<span class="small" aria-hidden="true">Color</span><div class="art-doodle-pens" role="group" aria-label="Pen color">' + pens.map((name, index) => '<button type="button" class="art-chip art-pen" data-pen="' + index + '" aria-pressed="' + (index === 0) + '" aria-label="' + name + '" title="' + name + '"></button>').join("") + '</div>'
    + '<div class="art-doodle-sizes" role="group" aria-label="Pen size">' + sizes.map((name, index) => '<button type="button" class="art-chip" data-size="' + index + '" aria-pressed="' + (index === 1) + '">' + name + '</button>').join("") + '</div>'
    + '<button type="button" class="song-action" data-doodle-undo disabled>↩️ Undo</button><button type="button" class="song-action doodle-clear" data-doodle-clear disabled>🗑️ Clear</button><span class="small" data-doodle-ink></span>';
  const undo = tools.querySelector("[data-doodle-undo]"), clear = tools.querySelector("[data-doodle-clear]"), meter = tools.querySelector("[data-doodle-ink]");
  let pen = 0, size = 1, colors = [], pointer = null, stroke = null;
  const widths = [3, 6, 11];
  const spent = () => serializeDoodle(strokes()).length;
  const refresh = () => {
    const drawn = strokes();
    undo.disabled = clear.disabled = !drawn.length;
    meter.textContent = "Ink left: " + Math.max(0, Math.round((1 - spent() / inkBudget) * 100)) + "%";
  };
  const pointAt = event => {
    const box = pad.getBoundingClientRect();
    return [Math.max(0, Math.min(width, (event.clientX - box.left) / Math.max(1, box.width) * width)), Math.max(0, Math.min(height, (event.clientY - box.top) / Math.max(1, box.height) * height))];
  };
  const show = () => live.setAttribute("d", stroke ? "M" + stroke.map(([x, y]) => x.toFixed(1) + " " + y.toFixed(1)).join("L") + (stroke.length === 1 ? "L" + stroke[0][0].toFixed(1) + " " + stroke[0][1].toFixed(1) : "") : "");
  const finish = () => {
    if (pointer === null) return;
    pointer = null;
    const drawn = strokes(), points = settle(stroke);
    stroke = null;
    show();
    drawn.push({ pen, width: size, points });
    if (spent() > inkBudget) {
      drawn.pop();
      say("Out of ink. Undo a stroke or clear the doodle to keep drawing.");
    } else say("");
    refresh();
    onChange();
  };
  pad.addEventListener("pointerdown", event => {
    if (pointer !== null || event.button !== 0) return;
    event.preventDefault();
    if (strokes().length >= doodleLimits.strokes || spent() >= inkBudget) return say("Out of ink. Undo a stroke or clear the doodle to keep drawing.");
    pointer = event.pointerId;
    pad.setPointerCapture(pointer);
    stroke = [pointAt(event)];
    live.setAttribute("stroke", colors[pen] || "#303f38");
    live.setAttribute("stroke-width", widths[size]);
    show();
  });
  pad.addEventListener("pointermove", event => {
    if (pointer !== event.pointerId || !stroke) return;
    const point = pointAt(event), last = stroke[stroke.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 1.5) return;
    stroke.push(point);
    show();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(name, finish);
  tools.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.pen !== undefined) {
      pen = Number(button.dataset.pen);
      for (const other of tools.querySelectorAll("[data-pen]")) other.setAttribute("aria-pressed", String(other === button));
    } else if (button.dataset.size !== undefined) {
      size = Number(button.dataset.size);
      for (const other of tools.querySelectorAll("[data-size]")) other.setAttribute("aria-pressed", String(other === button));
    } else if (button === undo) { finish(); strokes().pop(); say(""); refresh(); onChange(); }
    else if (button === clear) { finish(); strokes().splice(0); say(""); refresh(); onChange(); }
  });
  return {
    refresh,
    // The pens are the picture's own inks, so they follow its palette.
    setColors(next) {
      colors = next;
      tools.querySelectorAll("[data-pen]").forEach((button, index) => { button.style.setProperty("--pen", next[index]); });
    },
    cancel: finish,
  };
}
