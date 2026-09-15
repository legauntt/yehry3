const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const titleKey = (title) => String(title || "").normalize("NFKC")
  .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const recordingId = (song) => String(song.id).replace(/^distonyc-/, "");

// Compare the complete catalog so filters, favorites and pagination cannot
// change which recordings receive labels. Take numbers would depend on order.
export function recordingLabels(songs, publishedAt = (song) => song.publishedAt) {
  const groups = new Map();
  for (const song of songs) {
    const key = titleKey(song.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(song);
  }
  const labels = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const entries = group.map((song) => {
      const value = publishedAt(song);
      const date = value ? new Date(value) : null;
      const valid = date && Number.isFinite(date.getTime());
      return {
        song,
        datetime: valid ? date.toISOString() : "",
        text: valid ? `${dateFormat.format(date)} · ${timeFormat.format(date)}` : "",
      };
    });
    for (const entry of entries) {
      const matches = entries.filter((other) => other.text === entry.text);
      let code = "";
      if (!entry.datetime || matches.length > 1) {
        const id = recordingId(entry.song);
        let length = Math.min(6, id.length);
        while (length < id.length && matches.some((other) =>
          other !== entry && recordingId(other.song).slice(0, length) === id.slice(0, length))) length++;
        code = id.slice(0, length);
      }
      const text = entry.text ? `${entry.text}${code ? ` · ${code}` : ""}` : `Recording ${code}`;
      labels.set(entry.song.id, {
        text, datetime: entry.datetime,
        description: entry.datetime ? `Released ${text}` : `${text} · Release time unavailable`,
      });
    }
  }
  return labels;
}

export function recordingLabel(label, escape) {
  if (!label) return "";
  return `<span class="recording-label" title="${escape(label.description)}">${label.datetime
    ? `<span class="sr-only">Released </span><time datetime="${escape(label.datetime)}">${escape(label.text)}</time>`
    : escape(label.text)}</span>`;
}

export function recordingTitle(song, label) {
  return label ? `${song.title} · ${label.description}` : song.title;
}
