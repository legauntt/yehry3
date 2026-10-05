import artwork from "./artwork-catalog.js";
import previews from "./artwork-previews.js";
import videos from "./song-videos.js";

export function coverSizes(view, src) {
  const { width = 1024, height = 1024 } = previews[src] || {};
  // Auto uses the laid-out image box for lazy images. The fallback matches the
  // grid breakpoints, compact phone covers and List for older browsers.
  return view === "list" ? "auto, (max-width: 650px) 52px, 58px"
    : `auto, (max-width: 540px) ${Math.round(160 * width / height)}px, (max-width: 800px) calc(50vw - 42px), (max-width: 1100px) calc(33.333vw - 42px), 280px`;
}

// Dashboard covers are saved images. A new song gets a quiet sleeve until its
// artwork is ready; listener votes never redraw an image in the browser.
export function songArtworkMarkup(song, escape, view = "grid") {
  const art = artwork[song.id];
  const clip = song.url ? ` data-clip-id="${escape(song.id)}" data-clip-url="${escape(song.url)}" data-clip-title="${escape(song.title || "Untitled")}" data-clip-duration="${Number(song.duration) || 0}"` : "";
  const pending = '<div class="track-art track-art-pending"' + clip + ' role="img" aria-label="' + escape(`Cover pending for ${song.title || "this song"}`) + '"><span aria-hidden="true">' + escape(song.title || "Untitled") + '</span></div>';
  const preview = art && previews[art.src];
  const responsive = preview ? ` srcset="${escape(preview.srcset)}" sizes="${escape(coverSizes(view, art.src))}"` : "";
  const cover = art ? `<button type="button" class="track-art-frame" data-cover-open="${escape(song.id)}" aria-label="Enlarge cover for ${escape(song.title || "this song")}" aria-haspopup="dialog" title="View full-size cover"><img class="track-art" src="${escape(art.src)}"${responsive} alt="${escape(art.alt)}" width="${preview?.width || 1024}" height="${preview?.height || 1024}" loading="lazy" decoding="async" data-cover-treatment="${escape(art.treatment || "existing")}"></button>` : pending;
  const video = videos[song.id];
  if (!video) return cover;
  const watch = video.fullLength ? "Watch full music video" : `Watch ${video.duration || 15}-second video`;
  const doomer = video.treatment === "doomer";
  // Logo source: https://www.arbys.com/brands/arbys/logo.svg
  const icon = video.treatment === "doomer-pumpkin"
    ? '<img data-video-pumpkin="true" src="/assets/doomer-pumpkin-video.svg" width="34" height="31" alt="" aria-hidden="true">'
    : video.treatment === "arbys"
    ? '<img data-video-arbys="true" src="/assets/arbys-video-logo.svg" width="32" height="28" alt="" aria-hidden="true">'
    : video.treatment === "two-towers"
    ? '<svg viewBox="0 0 34 28" width="29" height="24" aria-hidden="true"><g data-video-towers="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 25V5h7v20M13 25V2h7v23M2 25h19"/><path d="M5 8h3m-3 4h3m-3 4h3m-3 4h3m7-15h3m-3 4h3m-3 4h3m-3 4h3m-3 4h3" stroke-width="1"/></g><path d="m23 10 8 5-8 5Z" fill="currentColor"/><path d="M30 7a11 11 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    : video.hasAudio
    ? '<svg viewBox="0 0 32 24" width="27" height="21" aria-hidden="true"><rect x="2" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m14 10 6-4v12l-6-4Z" fill="currentColor"/><path d="M24 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
    : doomer
    ? '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M7 13C7 3 23 3 23 13" fill="#11172c" stroke="#bfcaff" stroke-width="1.5"/><path d="M7 12h16v5H7z" fill="#272e50" stroke="#bfcaff"/><path d="M8 17v5c0 9 14 9 14 0v-5" fill="#cbd3df" stroke="#8595ce"/><path d="m10 20 4 1m4 0 3-1m-8 6h5" fill="none" stroke="#263049" stroke-width="1.5" stroke-linecap="round"/><path d="m25 21 6 4-6 4Z" fill="#dac5ff"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 10 6-4v12l-6-4Z" fill="currentColor"/></svg>';
  return `<div class="track-video-art" data-video-art="${escape(song.id)}">${cover}<button type="button" class="song-video-button${doomer ? " song-video-button-doomer" : ""}${video.hasAudio ? " song-video-button-gold" : ""}${video.treatment === "arbys" ? " song-video-button-arbys" : ""}${video.treatment === "doomer-pumpkin" ? " song-video-button-pumpkin" : ""}" data-video-open="${escape(song.id)}" aria-label="Watch ${video.hasAudio ? "music video with audio" : video.audio ? "video with chorus audio" : "silent video"} for ${escape(song.title || "this song")}" aria-haspopup="dialog" title="${watch}${video.hasAudio ? " · With audio and sing-along lyrics" : ""}">${icon}${video.hasAudio ? '<span class="song-video-sparkle" aria-hidden="true">✦</span>' : ""}</button></div>`;
}
