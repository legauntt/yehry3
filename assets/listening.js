// Observe the player without controlling playback. Page views, buffering and seeks
// do not count; pause/resume retains the same listening session.
export function trackListening(audio, { songId, source, send, onRecorded = () => {}, now = () => performance.now() }) {
  const controller = new AbortController();
  const { signal } = controller;
  let session, playing = false, previous;
  const retryTimers = new Set();
  function baseline() { previous = { time: audio.currentTime, wall: now() }; }
  function start(id) {
    session = { songId: id, requestId: crypto.randomUUID(), source, seconds: 0, sent: false };
    playing = false;
    baseline();
  }
  async function report(listen, attempt = 0) {
    if (signal.aborted) return;
    try {
      const result = await send({ songId: listen.songId, requestId: listen.requestId, source });
      onRecorded(listen.songId, result);
    } catch (error) {
      // A lost response reuses its ID. Analytics failures never interrupt audio.
      if (!signal.aborted && attempt < 2 && (!error.status || error.status >= 500)) {
        const timer = setTimeout(() => { retryTimers.delete(timer); void report(listen, attempt + 1); }, [5000, 20000][attempt]);
        retryTimers.add(timer);
      }
    }
  }
  function sample() {
    const wall = now(), time = audio.currentTime;
    if (session && playing && !audio.seeking && previous) {
      const elapsed = Math.max(0, (wall - previous.wall) / 1000);
      const advanced = Math.max(0, (time - previous.time) / (audio.playbackRate || 1));
      if (advanced <= elapsed + 0.5) session.seconds += Math.min(elapsed, advanced);
      if (!session.sent && session.seconds >= 10) {
        session.sent = true;
        void report(session);
      }
    }
    previous = { time, wall };
  }
  audio.addEventListener("playing", () => { playing = true; baseline(); }, { signal });
  audio.addEventListener("timeupdate", () => sample(), { signal });
  for (const event of ["pause", "waiting", "seeking", "emptied"])
    audio.addEventListener(event, () => { if (event === "pause") sample(); playing = false; baseline(); }, { signal });
  audio.addEventListener("seeked", () => { playing = !audio.paused; baseline(); }, { signal });
  audio.addEventListener("ended", () => {
    // A final timeupdate normally captured the last interval before native pause.
    if (session && !session.sent && audio.duration > 0 && audio.duration < 10 && session.seconds >= audio.duration * 0.9) {
      session.sent = true;
      void report(session);
    }
    start(session?.songId);
  }, { signal });
  if (songId) start(songId);
  return { start, stop() { controller.abort(); retryTimers.forEach(clearTimeout); retryTimers.clear(); } };
}

export function listeningLabel(song) {
  if (!Number.isFinite(song.playCount)) return "";
  if (!song.playCount) return "No listens recorded";
  const last = Date.parse(song.lastPlayedAt);
  return `${song.playCount} ${song.playCount === 1 ? "listen" : "listens"}${Number.isFinite(last) ? ` · Last listened ${new Date(last).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : ""}`;
}
