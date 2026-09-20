import { musicBackendBadge } from "./music-provenance.js";
import { remixBadge } from "./remix-badge.js";
import { pitchBadge } from "./pitch-badge.js";
import { sidesBadge } from "./sides.js";

const escape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function voiceModelBadge(item) {
  const value = typeof item === "string"
    ? item
    : item?.voiceModel ?? item?.originalPrompt?.voiceModel ?? item?.details?.voiceModel;
  const version = /^v\d+$/i.test(value || "") ? value.toLowerCase() : "v6";
  const variant = /^v[789]$/.test(version) ? " " + version : "";
  return `<span class="voice-model-badge${variant}" title="Tony’s voice: ${escape(version.toUpperCase())}">${escape(version.toUpperCase())}</span>`;
}

// One badge row for a song or a request at any stage, so a recording keeps the
// same voice, band generator and remix marks from the queue through its lyrics.
export function songBadges(item) {
  if (!item) return "";
  return `<span class="song-badges">${voiceModelBadge(item)}${musicBackendBadge(item)}${pitchBadge(item)}${remixBadge(item)}${sidesBadge(item)}</span>`;
}
