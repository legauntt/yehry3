// Public transcript methods. Word recognition and acoustic phonetics stay separate.
export const transcriptMethods = {
  whisper: { label: "Lyrics (Whisper)", model: /^faster-whisper [a-zA-Z0-9_.-]+$/ },
};

export function performanceTranscript(value, song, method) {
  const known = transcriptMethods[method];
  if (!known || value?.version !== 1 || value.songId !== song.id || value.audioUrl !== song.url ||
      !/^[a-f0-9]{64}$/.test(value.audioSha256 || "") || !/^[a-f0-9]{64}$/.test(value.inputSha256 || "") ||
      !song.url.endsWith(`-${value.audioSha256.slice(0, 12)}.mp3`) ||
      value.input !== "converted-tony-vocals" || !known.model.test(value.model) || value.review !== "machine" ||
      !Number.isFinite(value.duration) || !Number.isFinite(song.duration) || Math.abs(value.duration - song.duration) > 2 ||
      !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 2000)
    throw new Error("Transcript does not match this recording");
  let previous = 0;
  const segments = value.segments.map(row => {
    if (!Number.isFinite(row?.start) || !Number.isFinite(row.end) || row.start < previous ||
        row.end <= row.start || row.end > value.duration + .01 ||
        typeof row.text !== "string" || !row.text.trim() || row.text.length > 2000 || /[\r\n]/.test(row.text) ||
        typeof row.uncertain !== "boolean") throw new Error("Invalid transcript segment");
    previous = row.end;
    return { start: row.start, end: row.end, text: row.text, uncertain: row.uncertain };
  });
  // Only these fields can enter the public build; private evidence stays local.
  return { version: 1, songId: song.id, audioUrl: song.url, audioSha256: value.audioSha256,
    inputSha256: value.inputSha256, input: value.input, model: value.model, review: value.review,
    duration: value.duration, segments };
}

export function transcriptLyrics(transcript) {
  return { kind: "performance", text: transcript.segments.map(row => row.text).join("\n"),
    cues: transcript.segments.map((row, line) => ({ line, start: row.start, end: row.end, uncertain: row.uncertain })) };
}

let index;
export function loadTranscriptIndex() {
  index ||= fetch("/assets/lyric-transcripts.json", { signal: AbortSignal.timeout(8000) })
    .then(response => { if (!response.ok) throw new Error("Transcript index unavailable"); return response.json(); })
    .then(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid transcript index");
      return value;
    }).catch(error => { index = null; throw error; });
  return index;
}

export async function loadTranscript(song, method, signal) {
  const entry = (await loadTranscriptIndex())[song.id];
  if (entry?.audioUrl !== song.url || !entry.methods?.includes(method)) return null;
  const response = await fetch(`/lyric-transcripts/${encodeURIComponent(song.id)}.${method}.json`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
  if (!response.ok) throw new Error("Transcript unavailable");
  return performanceTranscript(await response.json(), song, method);
}
