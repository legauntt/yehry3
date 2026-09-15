export const tapeKey = "yehry3:mixtape:v1";
export const tapeColors = ["orange", "green", "pink", "blue"];
export const blankLabel = () => ({ text: "", ink: [] });
export const emptyTape = () => ({ v: 2, name: "My Tony C mixtape", color: "orange", a: [], b: [], labels: { a: blankLabel(), b: blankLabel() } });
export const tapeIdPattern = /^[A-Za-z0-9_-]{12}$/;
export const tapeHref = id => {
  if (!tapeIdPattern.test(id || "")) throw new Error("This mixtape link is incomplete or invalid.");
  return `/mixtapes/${id}`;
};

function validateLabel(value) {
  if (!value || typeof value.text !== "string" || value.text.length > 80 || !Array.isArray(value.ink) || value.ink.length > 60)
    throw new Error("This side's label is incomplete or invalid.");
  let points = 0;
  const ink = value.ink.map(stroke => {
    if (!Array.isArray(stroke) || !stroke.length || (points += stroke.length) > 1200) throw new Error("This handwritten label is too large.");
    return stroke.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger) || point[0] < 0 || point[0] > 1000 || point[1] < 0 || point[1] > 240)
        throw new Error("This handwritten label contains invalid pen coordinates.");
      return [...point];
    });
  });
  return { text: value.text.trim(), ink };
}

export function validateTape(value) {
  if (!value || ![1, 2].includes(value.v) || typeof value.name !== "string" || value.name.length > 80 ||
      !tapeColors.includes(value.color) || !Array.isArray(value.a) || !Array.isArray(value.b) ||
      value.a.length + value.b.length > 40 ||
      ![...value.a, ...value.b].every(id => typeof id === "string" && /^[a-z0-9-]{1,120}$/.test(id)))
    throw new Error("This mixtape link is incomplete or invalid.");
  return { v: 2, name: value.name.trim() || "My Tony C mixtape", color: value.color, a: [...value.a], b: [...value.b],
    labels: value.v === 1 ? { a: blankLabel(), b: blankLabel() } : { a: validateLabel(value.labels?.a), b: validateLabel(value.labels?.b) } };
}

export function encodeTape(tape) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateTape(tape)));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeTape(value) {
  if (!/^[A-Za-z0-9_-]{1,9000}$/.test(value || "")) throw new Error("This mixtape link is incomplete or invalid.");
  try {
    const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
    return validateTape(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { throw new Error("This mixtape link is incomplete or invalid."); }
}

export function tapeDuration(ids, songs) {
  let seconds = 0, unknown = false;
  for (const id of ids) {
    const duration = songs.get(id)?.duration;
    if (!Number.isFinite(duration) || duration <= 0) unknown = true;
    else seconds += duration;
  }
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}${unknown ? " + unknown time" : ""}`;
}
