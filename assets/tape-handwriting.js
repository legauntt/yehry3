const width = 1000, height = 240;

// Store only bounded, normalized pen coordinates. No user HTML, SVG, images,
// or device-specific pixels enter a shared tape.
export function drawInk(canvas, strokes) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = width; canvas.height = height;
  ctx.strokeStyle = "#26372b"; ctx.fillStyle = "#26372b"; ctx.lineWidth = 5;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.beginPath(); ctx.moveTo(...stroke[0]);
    for (const point of stroke.slice(1)) ctx.lineTo(...point);
    if (stroke.length === 1) { ctx.arc(...stroke[0], 2.5, 0, Math.PI * 2); ctx.fill(); }
    else ctx.stroke();
  }
}

// Drawing needs a canvas and pointer input. Without both, tapes fall back to plain "Side A" / "Side B" text.
export const canDraw = () => {
  try { return typeof PointerEvent === "function" && Boolean(document.createElement("canvas").getContext?.("2d")); }
  catch { return false; }
};

// Hand-lettered pen strokes for the pre-draw button. Each glyph is polylines on a unit box (x right, y down)
// with its own advance width; a small repeatable wobble keeps it from looking typeset.
const glyphs = {
  S: [.9, [[[.95, .15], [.75, .02], [.4, 0], [.12, .12], [.1, .3], [.3, .47], [.7, .55], [.92, .7], [.9, .88], [.65, 1], [.3, .99], [.05, .85]]]],
  I: [.2, [[[.5, 0], [.5, 1]]]],
  D: [.85, [[[.1, 0], [.1, 1]], [[.1, .02], [.6, .05], [.9, .3], [.92, .7], [.65, .96], [.1, .99]]]],
  E: [.75, [[[.9, .02], [.1, 0], [.1, 1], [.9, .97]], [[.1, .5], [.7, .5]]]],
  A: [1, [[[.05, 1], [.5, 0], [.95, 1]], [[.25, .62], [.75, .62]]]],
  B: [.85, [[[.1, 0], [.1, 1]], [[.1, .02], [.65, .02], [.85, .2], [.65, .48], [.1, .5]], [[.1, .5], [.75, .52], [.95, .75], [.75, .98], [.1, .98]]]],
};
export function sideInk(side) {
  const letters = `SIDE ${side.toUpperCase()}`, top = 50, tall = 140, wide = 100, gap = 40, space = 70;
  const advance = letter => letter === " " ? space : glyphs[letter][0] * wide + gap;
  let x = Math.round((width - [...letters].reduce((sum, letter) => sum + advance(letter), -gap)) / 2), n = 0;
  const wobble = () => Math.round(Math.sin(++n * 12.9898) * 3);
  const ink = [];
  for (const letter of letters) {
    if (letter !== " ") for (const stroke of glyphs[letter][1])
      ink.push(stroke.map(([u, v]) => [x + Math.round(u * glyphs[letter][0] * wide) + wobble(), top + Math.round(v * tall) + wobble()]
        .map((value, axis) => Math.max(0, Math.min(axis ? height : width, value)))));
    x += advance(letter);
  }
  return ink;
}

export function mountHandwriting(root, { getLabel, onChange }) {
  const refreshers = [];
  for (const editor of root.querySelectorAll("[data-label-editor]")) {
    const side = editor.dataset.labelEditor;
    const canvas = editor.querySelector("canvas");
    const undo = editor.querySelector("[data-ink-undo]");
    const clear = editor.querySelector("[data-ink-clear]");
    const message = editor.querySelector("[data-ink-status]");
    let pointer = null, stroke = null;
    const refresh = () => {
      const ink = getLabel(side).ink;
      drawInk(canvas, ink);
      undo.disabled = clear.disabled = !ink.length;
    };
    const pointAt = event => {
      const rect = canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) / rect.width * width))),
        Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) / rect.height * height)))];
    };
    const full = () => getLabel(side).ink.reduce((count, path) => count + path.length, 0) >= 1200;
    const limitMessage = () => { message.textContent = "This label is full. Undo a stroke to keep writing."; };
    const finish = () => {
      if (pointer === null) return;
      pointer = null; stroke = null; refresh(); onChange(side);
    };
    canvas.addEventListener("pointerdown", event => {
      if (pointer !== null || event.button !== 0) return;
      const ink = getLabel(side).ink;
      if (full() || ink.length >= 60) return limitMessage();
      event.preventDefault(); pointer = event.pointerId;
      canvas.setPointerCapture(pointer); stroke = [pointAt(event)]; ink.push(stroke);
      message.textContent = ""; refresh();
    });
    canvas.addEventListener("pointermove", event => {
      if (pointer !== event.pointerId || !stroke) return;
      const point = pointAt(event), last = stroke.at(-1);
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 4) return;
      if (full()) { limitMessage(); finish(); return; }
      stroke.push(point); drawInk(canvas, getLabel(side).ink);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(event, finish);
    undo.addEventListener("click", () => { finish(); getLabel(side).ink.pop(); message.textContent = ""; refresh(); onChange(side); });
    clear.addEventListener("click", () => { finish(); getLabel(side).ink = []; message.textContent = ""; refresh(); onChange(side); });
    refreshers.push(refresh);
    refresh();
  }
  // Lets the page redraw the pads after it changes a label itself (pre-draw).
  return () => refreshers.forEach(refresh => refresh());
}
