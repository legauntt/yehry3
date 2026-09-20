import { artIds } from "./mixtape-data.js";

// Fixed, first-party drawings on a 24 x 24 grid. A tape stores only the ID, so
// no listener-supplied markup ever reaches the page.
const shapes = {
  star: { label: "Star", markup: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>' },
  heart: { label: "Heart", markup: '<path d="M12 20.5S3.5 15 3.5 9.3A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 2.3c0 5.7-8.5 11.2-8.5 11.2z"/>' },
  bolt: { label: "Lightning bolt", markup: '<path d="M13.5 2 5 13.5h6L10 22l9-12h-6z"/>' },
  moon: { label: "Moon", markup: '<path d="M20 14.8A8.5 8.5 0 0 1 9.2 4 8.5 8.5 0 1 0 20 14.8z"/>' },
  note: { label: "Music note", markup: '<path d="M19 3v12.5a3 3 0 1 1-2-2.8V7.3L10 8.8V18a3 3 0 1 1-2-2.8V5z"/>' },
  sun: { label: "Sun", markup: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
};

export const artChoices = artIds.map(id => ({ id, label: shapes[id].label }));
export const artName = id => shapes[id]?.label || "";
// Decorative copies (gallery cards, radio buttons) are hidden from screen readers; their parent already has a name.
export const artSvg = (id, decorative = false) => shapes[id]
  ? `<svg class="tape-art" viewBox="0 0 24 24" fill="currentColor" ${decorative ? 'aria-hidden="true"' : `role="img" aria-label="${shapes[id].label} clipart"`}>${shapes[id].markup}</svg>`
  : "";
