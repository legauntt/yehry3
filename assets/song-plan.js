export function songPlanLink(song, escape) {
  return song.songPlan || song.hasSongPlan
    ? `<a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}#song-plan" aria-label="Song plan for ${escape(song.title || song.idea)}">Song plan ↗</a>`
    : "";
}

export function songPlanSection(song, escape) {
  const plan = song.songPlan;
  const waiting = ["queued", "processing"].includes(song.status);
  if (!plan) return `<section id="song-plan" class="song-plan"><h2>Song plan</h2><p class="small">${waiting ? "The song plan will appear here after planning finishes." : "No saved plan is available for this song."}</p></section>`;
  const length = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
  const approaches = { new: "Original song", reinterpretation: "Source-inspired reinterpretation", remix: "Faithful rendition", acoustic: "Acoustic rendition", barbershop: "Barbershop quartet" };
  const fields = [["Planned title", plan.title], ["Approach", approaches[plan.recipe] || plan.recipe],
    ["Vocal reference style", plan.style], ["Planned length", length(plan.duration)],
    ["Tempo", `${plan.bpm} BPM`], ["Key", plan.keyscale], ["Arrangement", plan.arrangement]];
  const lyrics = (text) => text ? `<details class="plan-lyrics"><summary>Planned lyrics</summary><div class="lyrics-text">${escape(text)}</div></details>` : "";
  return `<section id="song-plan" class="song-plan"><h2>Song plan</h2><p class="small">The saved creative plan used to make the song. The finished recording may vary from these planned timings and lyrics.</p><dl class="brief">${fields.map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`).join("")}</dl>${lyrics(plan.lyrics)}${(plan.movements || []).map((movement, index) => `<section class="plan-movement"><h3>Movement ${index + 1} · ${length(movement.duration)}</h3><p>${escape(movement.arrangement)}</p>${lyrics(movement.lyrics)}</section>`).join("")}</section>`;
}
