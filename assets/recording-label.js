const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const titleKey = (title) => String(title || "").normalize("NFKC")
  .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
// This vocabulary and hash define the aliases; keep them fixed across releases.
const modifiers = [
  "bop", "brisk", "calm", "cozy", "dizzy", "drum", "fizzy", "fluffy",
  "funky", "glow", "goofy", "hazy", "icy", "jazzy", "jolly", "lazy",
  "lil", "loud", "lunar", "mad", "mint", "misty", "mossy", "neon",
  "nimble", "odd", "peppy", "plush", "pop", "punk", "rosy", "shiny",
  "silly", "sleepy", "snug", "soft", "spicy", "tiny", "wavy", "wild",
  "wily", "zany", "zap", "zing", "zoom", "zippy",
];
const nouns = [
  "bat", "bear", "bee", "birb", "blob", "boop", "bun", "cat", "clam",
  "cloud", "cow", "crab", "crow", "cub", "deer", "dog", "dove", "duck",
  "eel", "elf", "elk", "emu", "finch", "fox", "frog", "gnat", "goat",
  "goose", "gull", "hare", "hawk", "imp", "kiwi", "koala", "koi",
  "lark", "lemur", "lion", "loon", "lynx", "mink", "mole", "moose",
  "moth", "mouse", "newt", "otter", "owl", "panda", "pika", "puff",
  "puma", "quail", "seal", "slug", "snail", "squid", "stoat", "toad",
  "tuna", "walrus", "whale", "wisp", "wolf", "wren", "wup", "yak", "yeti",
];
const aliases = modifiers.flatMap((modifier) => nouns.map((noun) => `${modifier}-${noun}`))
  .filter((alias) => alias.length <= 10);
function aliasHash(id) {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// Compare the complete catalog so filters, favorites and pagination cannot
// change which recordings receive labels. Resolve rare word-pair collisions in
// fixed ID order, independently of votes, dates or the visitor's display order.
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
    const used = new Set();
    const ordered = [...group].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const song of ordered) {
      const start = aliasHash(song.id) % aliases.length;
      let offset = 0;
      while (offset < aliases.length && used.has(aliases[(start + offset) % aliases.length])) offset++;
      // Even a title with more recordings than word pairs must stay unambiguous.
      const text = offset < aliases.length ? aliases[(start + offset) % aliases.length] : `r-${(used.size + 1).toString(36)}`;
      used.add(text);
      const value = publishedAt(song);
      const date = value ? new Date(value) : null;
      const valid = date && Number.isFinite(date.getTime());
      labels.set(song.id, {
        text,
        description: `Recording ${text} · ${valid ? `Released ${dateFormat.format(date)} · ${timeFormat.format(date)}` : "Release time unavailable"}`,
      });
    }
  }
  return labels;
}

export function recordingLabel(label, escape) {
  if (!label) return "";
  return `<span class="recording-label" title="${escape(label.description)}">${escape(label.text)}</span>`;
}

export function recordingTitle(song, label) {
  return label ? `${song.title} · Recording ${label.text}` : song.title;
}
