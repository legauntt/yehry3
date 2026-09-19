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

export function lyricPassage(lines, random = Math.random, viewport = {}) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const width = Number(viewport.width) || 1280;
  const height = Number(viewport.height) || 720;
  const minimum = Math.min(8, Math.max(1, Number(viewport.minLines) || 1));
  const maximum = Math.min(8, Math.max(minimum, Number(viewport.maxLines) || 8));
  const expandedLimit = width < 540
    ? (height < 600 ? 1 : 4)
    : height < 700 ? 4 : height < 900 ? 6 : 8;
  const visibleMaximum = Math.min(lines.length, expandedLimit, maximum);
  const visibleMinimum = Math.min(visibleMaximum, minimum);
  const counts = Array.from({ length: visibleMaximum - visibleMinimum + 1 }, (_, index) => visibleMinimum + index);
  const count = Math.min(lines.length, counts[Math.floor(random() * counts.length)]);
  const start = Math.floor(random() * (lines.length - count + 1));
  return lines.slice(start, start + count);
}
