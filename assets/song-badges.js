import { musicBackendBadge } from "./music-provenance.js";
import { remixBadge } from "./remix-badge.js";
import { pitchBadge } from "./pitch-badge.js";
import { sidesBadge } from "./sides.js";
import { repairBadge } from "./repair-status.js";

const escape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function voiceModelBadge(item) {
  const value = typeof item === "string"
    ? item
    : item?.voiceModel ?? item?.originalPrompt?.voiceModel ?? item?.details?.voiceModel;
  const version = /^(?:v\d+|vdb)$/i.test(value || "") ? value.toLowerCase() : "v6";
  const variant = /^(?:v[789]|vdb)$/.test(version) ? " " + version : "";
  const epoch = item?.voiceEpoch ?? item?.originalPrompt?.voiceEpoch ?? item?.details?.voiceEpoch;
  const range = item?.voiceEpochRange ?? item?.originalPrompt?.voiceEpochRange ?? item?.details?.voiceEpochRange;
  const suffix = version === 'v9' && range ? ` · epochs ${range.start} → ${range.end}` : version === 'v9' && Number.isInteger(epoch) && epoch >= 10 && epoch <= 300 && epoch % 10 === 0 ? ` · epoch ${epoch}` : '';
  const title = version === "vdb" ? "Tony’s voice: Demonophonic Blues experiment" : `Tony’s voice: ${version.toUpperCase()}${suffix}`;
  return `<span class="voice-model-badge${variant}" title="${escape(title)}">${escape(version.toUpperCase() + suffix)}</span>`;
}

// One badge row for a song or a request at any stage, so a recording keeps the
// same voice, band generator and remix marks from the queue through its lyrics.
export function songBadges(item) {
  if (!item) return "";
  return `<span class="song-badges">${voiceModelBadge(item)}${musicBackendBadge(item)}${pitchBadge(item)}${remixBadge(item)}${sidesBadge(item)}${repairBadge(item)}</span>`;
}
