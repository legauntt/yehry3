// Keep short sound loops on the audio clock instead of restarting an AAC decoder.
export function videoLoopAudio(video, onError) {
  let context, gain, source, buffer, ready, url, generation = 0;
  let started = 0, offset = 0, rate = 1;
  const stop = () => { source?.stop(); source?.disconnect(); source = null; };
  const position = () => buffer ? (offset + (context.currentTime - started) * rate) % buffer.duration : 0;
  const volume = () => { if (gain) gain.gain.value = video.muted ? 0 : video.volume; };
  function select(next) {
    const token = ++generation;
    stop(); buffer = null; url = next;
    if (!next && !context) return;
    if (!context) {
      context = new AudioContext();
      gain = context.createGain();
      gain.connect(context.destination);
    }
    if (!next) return;
    // The viewer uses a silent picture track with this separate lossless sound.
    ready = fetch(next).then(response => {
      if (!response.ok) throw new Error("Loop audio could not load");
      return response.arrayBuffer();
    }).then(bytes => context.decodeAudioData(bytes)).then(decoded => {
      if (token === generation) buffer = decoded;
    });
    ready.catch(() => { if (token === generation) onError(); });
  }
  async function prepare() {
    if (!context) return true;
    const token = generation;
    await context.resume();
    if (url) await ready;
    return token === generation;
  }
  async function play() {
    if (!url) return;
    const token = generation;
    try {
      if (!await prepare() || token !== generation || video.paused || source) return;
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
    } catch { if (token === generation) onError(); }
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
    select, prepare, play, pause: stop, volume, seek,
    prime: () => { if (context) void context.resume().catch(() => {}); },
    rate: () => { if (source) { stop(); void play(); } },
    destroy: () => { generation++; stop(); if (context) void context.close(); },
  };
}
