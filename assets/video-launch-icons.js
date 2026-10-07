const saxophone = '<svg viewBox="0 0 36 36" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg"><title>Saxophone</title><path d="M8 5h5l5 5v15c0 3 4 4 5 1l2-8 7-3-3 13c-1 5-5 7-10 5-4-1-6-4-6-8V12L9 9H6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m24 18 7 2M18 15h3m-3 5h3m-3 5h3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const starOfDavid = '<svg viewBox="0 0 36 36" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg"><title>Star of David</title><path d="M18 4 32 28H4Z M18 32 4 8h28Z" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/></svg>';

export function videoLaunchIcon(treatment) {
  if (treatment === "midnight-jazz-film") return `<span data-video-symbol="saxophone" aria-hidden="true">${saxophone}</span>`;
  if (treatment === "tragic-courtroom-aria") return `<span data-video-symbol="star-of-david" aria-hidden="true">${starOfDavid}</span>`;
  return "";
}
