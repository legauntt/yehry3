export async function loadBasisSongs() {
  const response = await fetch("/basis-songs.json", {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("The basis-song list could not load. Please refresh.");
  const { songs } = await response.json();
  return songs.sort(
    (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.collection.localeCompare(b.collection, undefined, {
        sensitivity: "base",
      }),
  );
}

export function mountBasisPicker(root, songs, initial = []) {
  const selected = new Set(initial);
  root.innerHTML = `<span class="field-label">Basis songs <span class="small">(optional, up to 5)</span></span><details class="basis-picker"><summary>Choose basis songs</summary><label for="basis-search">Find a song</label><input id="basis-search" type="search" placeholder="Search A–Z…"><div class="basis-options" role="group" aria-label="Basis songs"></div></details><p class="small" id="basis-count" aria-live="polite"></p><p class="small">Your chosen Tony voice is always included. Leave this empty for an original, or choose songs to inspire the result.</p>`;
  const options = root.querySelector(".basis-options");
  const checkboxes = [];
  for (const song of songs) {
    const label = document.createElement("label");
    label.className = "checkbox basis-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = song.id;
    checkbox.checked = selected.has(song.id);
    const caption = document.createElement("span");
    caption.textContent = `${song.title} (${song.collection})`;
    label.append(checkbox, caption);
    options.append(label);
    checkboxes.push({ checkbox, label, song });
    checkbox.onchange = () => {
      if (checkbox.checked && selected.size < 5) selected.add(song.id);
      else {
        selected.delete(song.id);
        checkbox.checked = false;
      }
      update();
    };
  }
  function update() {
    for (const { checkbox } of checkboxes)
      checkbox.disabled = selected.size >= 5 && !checkbox.checked;
    root.querySelector("summary").textContent = selected.size
      ? `${selected.size} basis song${selected.size === 1 ? "" : "s"} selected`
      : "Choose basis songs";
    root.querySelector("#basis-count").textContent =
      `${selected.size} of 5 selected`;
  }
  root.querySelector("#basis-search").oninput = (event) => {
    const query = event.target.value.toLocaleLowerCase();
    for (const { label, song } of checkboxes)
      label.hidden = !`${song.title} ${song.collection}`
        .toLocaleLowerCase()
        .includes(query);
  };
  update();
  return () => [...selected];
}
