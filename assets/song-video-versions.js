import videos from "./song-videos.js";
import history from "./song-video-history.js";

// Stable chronological letters; the current default is always last.
export function videoVersions(id) {
  if (!videos[id]) return [];
  const seen = new Set();
  return [...(history[id] || []), videos[id]]
    .filter(video => video?.src && !seen.has(video.src) && seen.add(video.src))
    .map((video, index) => ({ ...video, label: versionLabel(index) }));
}

function versionLabel(index) {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + (n - 1) % 26) + label;
  }
  return label;
}
