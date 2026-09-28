import artwork from "./artwork-catalog.js";
import previews from "./artwork-previews.js";

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
  if (!art) return '<div class="track-art track-art-pending"' + clip + ' role="img" aria-label="' + escape(`Cover pending for ${song.title || "this song"}`) + '"><span aria-hidden="true">' + escape(song.title || "Untitled") + '</span></div>';
  const preview = previews[art.src];
  const responsive = preview ? ` srcset="${escape(preview.srcset)}" sizes="${escape(coverSizes(view, art.src))}"` : "";
  return `<div class="track-art-frame"><img class="track-art"${clip} src="${escape(art.src)}"${responsive} alt="${escape(art.alt)}" width="${preview?.width || 1024}" height="${preview?.height || 1024}" loading="lazy" decoding="async" data-cover-treatment="${escape(art.treatment || "existing")}"><button type="button" class="cover-enlarge" data-cover-open="${escape(song.id)}" aria-label="Enlarge cover for ${escape(song.title || "this song")}" title="View full-size cover"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg></button></div>`;
}
