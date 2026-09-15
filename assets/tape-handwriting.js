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

export function mountHandwriting(root, { getLabel, onChange }) {
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
    editor.addEventListener("toggle", refresh);
    refresh();
  }
}
