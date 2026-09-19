export function singableLines(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.length >= 12 &&
      line.length <= 110 &&
      !(line.startsWith("[") && line.endsWith("]")) &&
      line.split(/\s+/u).length >= 3,
    );
}
