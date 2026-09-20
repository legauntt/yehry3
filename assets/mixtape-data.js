// A draft only survives a reload of the tab that is editing it; "New" always starts from an empty tape.
export const tapeKey = "yehry3:mixtape:v1";
// Clipart is the song covers' procedural art, stored as a seed plus optional character and trait numbers
// (see tape-art.js), never as an uploaded image or SVG. Keys are kept in a fixed order so equal pictures match.
export const artIndexes = ["palette", "pose", "prop", "extra", "eyes", "mouth", "backdrop", "confetti", "tilt", "flip"];
export function validateArt(value) {
  if (value === undefined || value === "") return null;
  const bad = new Error("This side's clipart is incomplete or invalid.");
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) throw bad;
  if (Object.keys(value).some(key => key !== "seed" && key !== "theme" && !artIndexes.includes(key))) throw bad;
  const result = { seed: value.seed };
  if (value.theme !== undefined) { if (typeof value.theme !== "string" || !/^[a-z]{1,24}$/.test(value.theme)) throw bad; result.theme = value.theme; }
  for (const key of artIndexes) {
    if (value[key] === undefined) continue;
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] >= 64) throw bad;
    result[key] = value[key];
  }
  return result;
}
export const tapeColors = ["orange", "green", "pink", "blue"];
export const blankLabel = () => ({ text: "", ink: [] });
export const defaultName = "My Tony C mixtape";
// A new tape is genuinely empty: no name, songs, drawing or clipart. The default name applies when it is published.
export const emptyTape = () => ({ v: 2, name: "", color: "orange", a: [], b: [], labels: { a: blankLabel(), b: blankLabel() } });
export const tapeIdPattern = /^[A-Za-z0-9_-]{12}$/;
export const tapeHref = id => {
  if (!tapeIdPattern.test(id || "")) throw new Error("This mixtape link is incomplete or invalid.");
  return `/mixtapes/${id}`;
};

function validateLabel(value) {
  // Typed text is legacy: tapes are hand-drawn now, but older ones still open.
  const text = value?.text === undefined ? "" : value.text;
  if (!value || typeof text !== "string" || text.length > 80 || !Array.isArray(value.ink) || value.ink.length > 60)
    throw new Error("This side's label is incomplete or invalid.");
  const art = validateArt(value.art);
  let points = 0;
  const ink = value.ink.map(stroke => {
    if (!Array.isArray(stroke) || !stroke.length || (points += stroke.length) > 1200) throw new Error("This handwritten label is too large.");
    return stroke.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger) || point[0] < 0 || point[0] > 1000 || point[1] < 0 || point[1] > 240)
        throw new Error("This handwritten label contains invalid pen coordinates.");
      return [...point];
    });
  });
  return { text: text.trim(), ink, ...(art ? { art } : {}) };
}

export function validateTape(value) {
  if (!value || ![1, 2].includes(value.v) || typeof value.name !== "string" || value.name.length > 80 ||
      !tapeColors.includes(value.color) || !Array.isArray(value.a) || !Array.isArray(value.b) ||
      value.a.length + value.b.length > 40 ||
      ![...value.a, ...value.b].every(id => typeof id === "string" && /^[a-z0-9-]{1,120}$/.test(id)))
    throw new Error("This mixtape link is incomplete or invalid.");
  return { v: 2, name: value.name.trim() || defaultName, color: value.color, a: [...value.a], b: [...value.b],
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
