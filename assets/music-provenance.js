// Read saved attribution only. A missing provider is unknown for older recordings.
export function musicBackendOf(item) {
  const value = item?.musicBackend ?? item?.originalPrompt?.musicBackend ?? item?.details?.musicBackend;
  return value === 'eleven_music' || value === 'local' ? value : null;
}

export function musicBackendLabel(backend) {
  return backend === 'eleven_music' ? 'Eleven Music · paid' : backend === 'local' ? 'Local · ACE' : '';
}

export function musicBackendBadge(item) {
  const backend = musicBackendOf(item);
  if (!backend) return '';
  const label = musicBackendLabel(backend);
  const description = `Band generator: ${label}. Tony’s voice is selected separately.`;
  return `<span class="music-backend-badge ${backend}" title="${description}" aria-label="${description}">${label}</span>`;
}
