export function editSettings(end, fade, duration) {
  if (![end, fade, duration].every(Number.isFinite) || end < 1 || end > duration || fade < 0 || fade > Math.min(60, end)) throw new Error('Choose an end within the recording and a fade of 0–60 seconds, no longer than the edit.');
  return { end, fade };
}
export function peaks(buffer, count = 1200) {
  const result = new Float32Array(count), step = Math.ceil(buffer.length / count);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) result[Math.min(count - 1, Math.floor(i / step))] = Math.max(result[Math.min(count - 1, Math.floor(i / step))], Math.abs(samples[i]));
  }
  return result;
}
// The preview and FFmpeg both use a linear amplitude fade over the final seconds.
export function fadeGain(at, end, fade) { return at >= end ? 0 : fade > 0 ? Math.min(1, Math.max(0, (end - at) / fade)) : 1; }
export const timeLabel = value => `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`;
