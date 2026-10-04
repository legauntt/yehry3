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
  const doomer = video.treatment === "doomer";
  const icon = doomer
    ? '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M7 13C7 3 23 3 23 13" fill="#11172c" stroke="#bfcaff" stroke-width="1.5"/><path d="M7 12h16v5H7z" fill="#272e50" stroke="#bfcaff"/><path d="M8 17v5c0 9 14 9 14 0v-5" fill="#cbd3df" stroke="#8595ce"/><path d="m10 20 4 1m4 0 3-1m-8 6h5" fill="none" stroke="#263049" stroke-width="1.5" stroke-linecap="round"/><path d="m25 21 6 4-6 4Z" fill="#dac5ff"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 10 6-4v12l-6-4Z" fill="currentColor"/></svg>';
  return `<div class="track-video-art" data-video-art="${escape(song.id)}">${cover}<button type="button" class="song-video-button${doomer ? " song-video-button-doomer" : ""}" data-video-open="${escape(song.id)}" aria-label="Watch ${video.audio ? "video with chorus audio" : "silent video"} for ${escape(song.title || "this song")}" aria-haspopup="dialog" title="Watch ${video.duration || 15}-second video">${icon}</button></div>`;
}
