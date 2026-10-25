export function queueItemHref(song) {
  return /^distonyc-[a-f0-9]{24}$/.test(song?.id || "")
    ? `/queue/details/?request=${encodeURIComponent(song.id)}`
    : "/queue/";
}
