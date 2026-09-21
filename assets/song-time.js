// A position in a song as m:ss.
export const clock = (seconds) => Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
