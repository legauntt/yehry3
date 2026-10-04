// Keep short sound loops on the audio clock instead of restarting an AAC decoder.
export function videoLoopAudio(video, onError, onReady = () => {}) {
  let context, gain, source, buffer, ready, url, request, generation = 0, playback = 0;
  let started = 0, offset = 0, rate = 1;
  const stop = () => { source?.stop(); source?.disconnect(); source = null; };
  const position = () => buffer ? (offset + (context.currentTime - started) * rate) % buffer.duration : 0;
  const volume = () => { if (gain) gain.gain.value = video.muted ? 0 : video.volume; };
  function load() {
    const token = generation;
    request = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
    ready = fetch(url, { signal }).then(response => {
      if (!response.ok) throw new Error("Loop audio could not load");
      return response.arrayBuffer();
    }).then(bytes => context.decodeAudioData(bytes)).then(decoded => {
      if (token === generation) buffer = decoded;
    });
    ready.catch(() => {
      if (token === generation) { ready = null; onError(); }
    });
  }
  function select(next) {
    generation++; playback++;
    request?.abort(); ready = null;
    stop(); buffer = null; url = next;
    if (!next && !context) return;
    if (!context) {
      context = new AudioContext();
      gain = context.createGain();
      gain.connect(context.destination);
    }
    if (!next) return;
    // The viewer uses a silent picture track with this separate lossless sound.
    load();
  }
  async function prepare() {
    if (!context) return true;
    const token = generation;
    await context.resume();
    if (url && !buffer) { if (!ready) load(); await ready; }
    return token === generation;
  }
  async function play() {
    if (!url) return;
    const token = generation;
    const attempt = playback;
    try {
      if (!await prepare() || token !== generation || attempt !== playback || video.paused || source) return;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      rate = video.playbackRate;
      source.playbackRate.value = rate;
      source.connect(gain);
      volume();
      offset = video.currentTime % buffer.duration;
      started = context.currentTime;
      source.start(0, offset);
      onReady();
    } catch {
      // load() reports its own failure; resume/start failures still need feedback.
      if (token === generation && attempt === playback && ready) onError();
    }
  }
  function seek(manual = false) {
    if (!source || !buffer) return;
    const target = video.currentTime % buffer.duration;
    // Picture decoding can drift over many cycles; its automatic wrap must never
    // reset the audio clock. Pointer/keyboard seeks to zero remain explicit.
    if (!manual && video.loop && target < .25) return;
    const distance = Math.abs(position() - target);
    // Native video looping fires seek events. Do not restart the sound at that seam.
    if (Math.min(distance, buffer.duration - distance) < .25) return;
    stop(); void play();
  }
  return {
    select, prepare, play, pause: () => { playback++; stop(); }, volume, seek,
    get pending() { return Boolean(url && !buffer); },
    prime: () => { if (context) void context.resume().catch(() => {}); },
    rate: () => { if (source) { stop(); void play(); } },
    destroy: () => { generation++; playback++; request?.abort(); stop(); if (context) void context.close(); },
  };
}
