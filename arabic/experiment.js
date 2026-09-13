const list = document.querySelector("#samples");
const status = document.querySelector("#sample-status");
const players = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

try {
  const response = await fetch("/arabic/samples.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Samples unavailable");
  const { samples } = await response.json();
  if (!Array.isArray(samples)) throw new Error("Invalid sample list");
  const cards = samples.map((sample, index) => {
    const url = new URL(sample.url);
    if (url.protocol !== "https:" || url.hostname !== "github.com" ||
        !url.pathname.startsWith("/legauntt/yehry3/releases/download/arabic-experiments-")) {
      throw new Error("Invalid experiment audio URL");
    }
    const card = element("article", "sample");
    const heading = element("h3", "", sample.title);
    heading.id = `sample-${index + 1}-title`;
    card.setAttribute("aria-labelledby", heading.id);
    card.append(element("p", "sample-number", `SAMPLE ${String(index + 1).padStart(2, "0")} · ${sample.duration} SECONDS`),
      heading, element("p", "sample-description", sample.description));
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = url.href;
    audio.setAttribute("aria-label", `Play ${sample.title}`);
    audio.addEventListener("play", () => players.forEach((player) => {
      if (player !== audio) player.pause();
    }));
    const error = element("p", "sample-error", "This sample is unavailable. Try the MP3 link below or reload the page.");
    error.hidden = true;
    audio.addEventListener("error", () => { error.hidden = false; });
    const download = element("a", "sample-download", "Download MP3");
    download.href = url.href;
    download.setAttribute("download", "");
    card.append(audio, error, download);
    if (sample.note) card.append(element("p", "sample-note", sample.note));
    players.push(audio);
    return card;
  });
  list.replaceChildren(...cards);
  if (!cards.length) list.append(element("p", "", "No samples are currently available."));
} catch {
  status.textContent = "The sample list could not load. Please reload the page.";
}
