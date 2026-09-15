export const tapeKey = "yehry3:mixtape:v1";
export const tapeColors = ["orange", "green", "pink", "blue"];
export const emptyTape = () => ({ v: 1, name: "My Tony C mixtape", color: "orange", a: [], b: [] });

export function validateTape(value) {
  if (!value || value.v !== 1 || typeof value.name !== "string" || value.name.length > 80 ||
      !tapeColors.includes(value.color) || !Array.isArray(value.a) || !Array.isArray(value.b) ||
      value.a.length + value.b.length > 40 ||
      ![...value.a, ...value.b].every(id => typeof id === "string" && /^[a-z0-9-]{1,120}$/.test(id)))
    throw new Error("This mixtape link is incomplete or invalid.");
  return { v: 1, name: value.name.trim() || "My Tony C mixtape", color: value.color, a: [...value.a], b: [...value.b] };
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
