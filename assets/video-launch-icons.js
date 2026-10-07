const saxophone = '<svg viewBox="0 0 36 36" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg"><title>Saxophone</title><path d="M8 5h5l5 5v15c0 3 4 4 5 1l2-8 7-3-3 13c-1 5-5 7-10 5-4-1-6-4-6-8V12L9 9H6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m24 18 7 2M18 15h3m-3 5h3m-3 5h3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const starOfDavid = '<svg viewBox="0 0 36 36" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg"><title>Star of David</title><path d="M18 4 32 28H4Z M18 32 4 8h28Z" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/></svg>';

const goldenShower = '<svg viewBox="0 0 36 36" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg"><title>Showerhead with yellow water</title><path d="M6 16V9a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M15 17a7 7 0 0 1 14 0Z" fill="currentColor"/><path d="M16 21c0 0-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Zm12 0s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Zm-6 6s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z" fill="#ffe342"/></svg>';

export function videoLaunchIcon(treatment) {
  if (treatment === "midnight-synth-film") return `<span data-video-symbol="golden-shower" aria-hidden="true">${goldenShower}</span>`;
  if (treatment === "midnight-jazz-film") return `<span data-video-symbol="saxophone" aria-hidden="true">${saxophone}</span>`;
  if (treatment === "tragic-courtroom-aria") return `<span data-video-symbol="star-of-david" aria-hidden="true">${starOfDavid}</span>`;
  return "";
}
