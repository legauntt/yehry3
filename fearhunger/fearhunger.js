import { api } from "../assets/api.js";
import { qualityNotice } from "../assets/quality.js";

const cards = [],
  players = [],
  known = new Map();
const status = document.querySelector("#status");
const note = document.querySelector("#collection-note");
const shuffleButton = document.querySelector("#shuffle");
let shuffled = false,
  queue = [],
  cursor = -1,
  busy = false,
  timer;
const duration = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const title = (index) => cards[index].querySelector("h3").textContent;

function order(items) {
  const copy = [...items];
  if (shuffled)
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
  return copy;
}
function markPlaying(index) {
  players.forEach((player, i) => {
    if (i !== index) player.pause();
    cards[i].classList.toggle("is-playing", i === index);
  });
  status.textContent = `Playing ${title(index)}.`;
}
async function playQueued() {
  const index = queue[cursor];
  if (index === undefined) return;
  players[index].currentTime = 0;
  try {
    await players[index].play();
  } catch {
    if (queue[cursor] === index)
      status.textContent = `Press play on ${title(index)} to continue, or use its MP3 link.`;
  }
}
function register(card) {
  const index = cards.length,
    player = card.querySelector("audio");
  cards.push(card);
  players.push(player);
  known.set(card.dataset.songId, card);
  player.addEventListener("play", () => {
    if (queue[cursor] !== index) {
      queue = [index];
      cursor = 0;
    }
    markPlaying(index);
  });
  player.addEventListener("pause", () => {
    card.classList.remove("is-playing");
    if (queue[cursor] === index && !player.ended)
      status.textContent = `Paused · ${title(index)}.`;
  });
  player.addEventListener("ended", () => {
    card.classList.remove("is-playing");
    if (queue[cursor] === index && cursor + 1 < queue.length) {
      cursor++;
      void playQueued();
    } else status.textContent = "Finished. Choose a song or play all again.";
  });
  player.addEventListener("error", () => {
    if (queue[cursor] === index)
      status.textContent = `Unable to play ${title(index)}. Try its MP3 link.`;
  });
}
document.querySelectorAll(".track").forEach(register);
document.querySelector("#play-all").addEventListener("click", () => {
  players.forEach((player) => player.pause());
  queue = order(players.map((_, i) => i).filter((i) => !cards[i].hidden));
  cursor = 0;
  void playQueued();
});
shuffleButton.addEventListener("click", () => {
  shuffled = !shuffled;
  shuffleButton.setAttribute("aria-pressed", String(shuffled));
  if (queue.length > 1 && cursor >= 0) {
    const past = queue.slice(0, cursor + 1);
    queue = [...past, ...order(queue.slice(cursor + 1).sort((a, b) => a - b))];
  }
});
document.querySelector(".collection-controls").hidden = false;

function update(songs) {
  const matching = songs.filter(
    (song) =>
      song.collection === "fearhunger" ||
      song.collections?.includes("fearhunger"),
  );
  const ids = new Set(matching.map((song) => song.id));
  for (const song of matching) {
    if (!/^[a-z0-9-]{1,120}$/.test(song.id)) continue;
    let card = known.get(song.id);
    if (!card) {
      let url;
      try {
        url = new URL(song.url, location.origin);
      } catch {
        continue;
      }
      if (!["https:", "http:"].includes(url.protocol)) continue;
      card = document.createElement("article");
      card.className = "track";
      card.dataset.songId = song.id;
      card.dataset.generated = "true";
      card.innerHTML =
        '<span class="track-number" aria-hidden="true"></span><div class="track-body"><div class="track-heading"><h3></h3><span class="duration"></span></div><p class="track-description">A Tony C song from the studio request queue.</p><audio controls preload="none"></audio><a class="download" target="_blank" rel="noopener">Open MP3 ↗</a><a class="lyrics-link" hidden>Lyrics ↗</a><a class="original-prompt-link" hidden>Original prompt ↗</a></div>';
      card.querySelector("h3").id = "title-" + song.id;
      card.querySelector("h3").textContent = song.title;
      card.querySelector(".duration").textContent = duration(song.duration);
      card.querySelector("audio").src = url.href;
      card
        .querySelector("audio")
        .setAttribute("aria-labelledby", "title-" + song.id);
      card.querySelector(".download").href = url.href;
      document.querySelector(".recordings").append(card);
      register(card);
    }
    let author = card.querySelector(".authored-by");
    if (!author) {
      author = document.createElement("p");
      author.className = "authored-by track-description";
      card.querySelector("audio").before(author);
    }
    author.hidden = !song.authoredBy;
    author.textContent = song.authoredBy ? `Authored by ${song.authoredBy}` : "";
    let warning = card.querySelector(".quality-container");
    if (!warning) {
      warning = document.createElement("div");
      warning.className = "quality-container";
      card.querySelector("audio").before(warning);
    }
    const notice = qualityNotice(song.qualityIssues);
    if (warning.dataset.notice !== notice) {
      warning.innerHTML = notice;
      warning.dataset.notice = notice;
    }
    const lyrics = card.querySelector(".lyrics-link");
    if (song.lyrics?.text) {
      lyrics.href = "/lyrics/?song=" + encodeURIComponent(song.id);
      lyrics.hidden = false;
    }
    const original = card.querySelector(".original-prompt-link");
    if (original && song.originalPrompt) {
      original.href = "/original-prompt/?song=" + encodeURIComponent(song.id);
      original.hidden = false;
    }
  }
  // Keep a currently playing track alive if its tags change during a refresh.
  cards.forEach((card, i) => {
    if (card.dataset.generated)
      card.hidden = !ids.has(card.dataset.songId) && players[i].paused;
  });
  queue = [
    ...queue.slice(0, cursor + 1),
    ...queue.slice(cursor + 1).filter((i) => !cards[i].hidden),
  ];
  cards
    .filter((card) => !card.hidden)
    .forEach((card, index) => {
      card.querySelector(".track-number").textContent = String(
        index + 1,
      ).padStart(2, "0");
    });
  note.textContent = `${cards.filter((card) => !card.hidden).length} songs · New releases appear automatically.`;
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    update((await api("/songs")).songs);
  } catch {
    note.textContent =
      "The saved collection is available. Checking for new songs is temporarily offline.";
  } finally {
    busy = false;
  }
}
try {
  update((await (await fetch("/catalog.json")).json()).songs);
} catch {
  /* The original three recordings remain available in HTML. */
}
await refresh();
timer = setInterval(refresh, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
addEventListener("pagehide", () => clearInterval(timer));
addEventListener("pageshow", (event) => {
  if (event.persisted) {
    clearInterval(timer);
    timer = setInterval(refresh, 60000);
    refresh();
  }
});
