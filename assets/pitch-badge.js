import { pitchModes } from "./pitch-repair.js";

// Only songs and requests that recorded a pitch setting show it; older recordings stay unmarked.
export function pitchOf(item) {
  const value = item?.pitchRepair ?? item?.originalPrompt?.generation?.pitchRepair ?? item?.details?.generation?.pitchRepair;
  return Object.hasOwn(pitchModes, value) ? value : null;
}

export function pitchBadge(item) {
  const mode = pitchOf(item);
  if (!mode) return "";
  const [label] = pitchModes[mode];
  const description = `Tony’s pitch: ${label}`;
  return `<span class="pitch-badge ${mode}" title="${description}" aria-label="${description}">${label}</span>`;
}
