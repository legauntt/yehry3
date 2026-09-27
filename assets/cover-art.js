import artwork from "./artwork-catalog.js";

// Dashboard covers are saved images. A new song gets a quiet sleeve until its
// artwork is ready; listener votes never redraw an image in the browser.
export function songArtworkMarkup(song, escape) {
  const art = artwork[song.id];
  if (!art) return '<div class="track-art track-art-pending" role="img" aria-label="' + escape(`Cover pending for ${song.title || "this song"}`) + '"><span aria-hidden="true">' + escape(song.title || "Untitled") + '</span></div>';
  return '<img class="track-art" src="' + escape(art.src) + '" alt="' + escape(art.alt) + '" width="1024" height="1024" loading="lazy" decoding="async" data-cover-treatment="' + escape(art.treatment || "existing") + '">';
}
