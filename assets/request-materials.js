export const MAX_WORDS = 3000, MAX_CHARS = 30000;
export const wordCount = (value) => value.trim() ? value.trim().split(/\s+/u).length : 0;
const section = /^\[\s*(?:(?:verse|chorus|bridge|intro|outro|pre\s*-?\s*chorus|post\s*-?\s*chorus|refrain|hook|instrumental|spoken\s+(?:intro|verse)|breakdown|solo|interlude|movement|section|tag|coda|end|turn|(?:final|last)\s+(?:chorus|verse)|final\s+(?:refrain|hook|tag)|chorus\s+reprise)(?:\s+\d+)?)\s*\]$/i;
export const sungWords = (value) => wordCount(value.split("\n").filter((line) => !section.test(line.trim())).join("\n"));
export function durationIssue(details, prompt = "") {
  if (!details?.lyricSheet || details.lyricSheet.mode !== "preserve") return "";
  if (details.lyricSheet.text.replace(/\n?\[End\]\s*$/i, "").trim().length < 74) return "Keeping this short sheet unchanged leaves too little material for the current song format. Add more lyrics or choose Adapt these lyrics.";
  const rate = /\b(?:rap|spoken word)\b/i.test(prompt + " " + (details.direction || "")) ? 180 : 110;
  const cap = details.musicBackend === "eleven_music" || details.generation?.candidates > 1 ? 600 : 1140;
  const chosen = details.generation?.duration;
  const seconds = Number.isInteger(chosen) ? Math.min(chosen, cap) : cap;
  if (sungWords(details.lyricSheet.text) <= seconds / 60 * rate) return "";
  const limit = Number.isInteger(chosen) && chosen <= cap ? `selected ${seconds}-second song length` : `${cap / 60}-minute song limit`;
  return `Keeping every word would exceed the ${limit} at this pace. Choose a longer supported length, shorten the sheet, or choose Adapt these lyrics.`;
}
export function lyricError(text) {
  if (text.length > MAX_CHARS || wordCount(text) > MAX_WORDS) return "Lyrics must be at most 3,000 words and 30,000 characters.";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) return "Lyrics must be plain text.";
  if (text.trim() && !sungWords(text)) return "Add some words to sing, not only section labels.";
  return "";
}
export function hasMaterialEdits(draft, storage) {
  if (!draft || draft.confirmedAt) return false;
  try { return JSON.parse(storage.get("materials:" + draft.id))?.version === draft.version; } catch { return false; }
}
export function mountMaterials(root, draft, { api, storage, escape, lyricChoiceRoot }) {
  const key = "materials:" + draft.id;
  let saved;
  try { saved = JSON.parse(storage.get(key)); } catch { /* Saved server brief remains available. */ }
  const initial = saved?.version === draft.version ? saved : draft.details || {};
  let references = structuredClone(initial.references || []);
  let pending = 0;
  root.innerHTML = '<details class="request-materials"><summary>Lyrics &amp; references <span class="small">(optional)</span></summary>' +
    '<div class="materials-fields"><label for="lyric-sheet">Lyric sheet</label>' +
    '<textarea id="lyric-sheet" rows="9" aria-describedby="lyric-count lyric-help material-visibility" placeholder="[Verse 1]&#10;Paste your words here…"></textarea>' +
    '<p id="lyric-count" class="small" aria-live="polite"></p><p id="lyric-help" class="small">Up to 3,000 words and 30,000 characters. Keep line breaks and section labels. The final song’s lyric sheet will be public; the performance may vary.</p>' +
    '<label for="lyric-mode">How should we use these lyrics?</label><select id="lyric-mode"><option value="preserve">Keep my wording</option><option value="adapt">Adapt these lyrics</option></select>' +
    '<p id="lyric-mode-help" class="small"></p><p id="lyric-length" class="small" role="status"></p>' +
    '<h3>Reference links</h3><p class="small">Add up to three public HTTPS links. Choose how to use each one.</p><p class="small" id="material-visibility">Once you confirm your request, anyone can view the supplied lyrics, reference links, notes, and saved page text in its prompt details.</p>' +
    '<div id="reference-list"></div><button type="button" class="quiet" id="add-reference">Add a reference link</button>' +
    '<p class="small material-storage" role="status"></p></div></details>';
  const find = (selector) => root.querySelector(selector) || lyricChoiceRoot?.querySelector(selector);
  const panel = find("details"), sheet = find("#lyric-sheet"), mode = find("#lyric-mode"), add = find("#add-reference");
  sheet.value = initial.lyricSheet?.text || "";
  mode.value = initial.lyricSheet?.mode || "preserve";
  panel.open = Boolean(sheet.value || references.length);
  if (lyricChoiceRoot) {
    for (const selector of ['label[for="lyric-mode"]', '#lyric-mode', '#lyric-mode-help', '#lyric-length']) lyricChoiceRoot.append(find(selector));
    find('label[for="lyric-mode"]').textContent = 'May the lyrics change?';
    mode.options[0].textContent = 'Keep the supplied words';
    mode.options[1].textContent = 'Allow adapting the lyrics';
  }
  function current() {
    return { lyricSheet: sheet.value.trim() ? { text: sheet.value.replace(/\r\n?/g, "\n").trim(), mode: mode.value } : null, references };
  }
  function remember() {
    const data = JSON.stringify({ version: draft.version, ...current() });
    storage.set(key, data);
    find(".material-storage").textContent = storage.get(key) === data ? "Edits are saved in this tab until you review the request." : "This browser could not save these edits. Keep this page open until you review the request.";
  }
  function updateLyrics() {
    sheet.setCustomValidity(lyricError(sheet.value));
    find("#lyric-count").textContent = wordCount(sheet.value).toLocaleString() + " / 3,000 words · " + sheet.value.length.toLocaleString() + " / 30,000 characters";
    find("#lyric-count").classList.toggle("field-error", Boolean(lyricError(sheet.value)));
    find("#lyric-mode-help").textContent = mode.value === "preserve" ? "Keep every supplied word in order. Musical arrangement and section formatting may change." : "Allow rewriting, shortening, and restructuring to fit the song. Your original sheet stays saved.";
    const durationField = document.querySelector('#gen-duration');
    const duration = durationField && !durationField.disabled ? durationField.value.trim() : '';
    const candidates = document.querySelector('#gen-candidates');
    const details = { ...current(), direction: document.querySelector("#direction")?.value || "",
      musicBackend: document.querySelector('#music-backend')?.value,
      generation: { ...(duration ? { duration: Number(duration) } : {}),
        candidates: candidates && !candidates.disabled ? Number(candidates.value || 1) : 1 } };
    const issue = durationIssue(details, draft.prompt);
    const count = sungWords(sheet.value);
    find("#lyric-length").textContent = issue || (count > 600 ? "This is a long lyric sheet. At a melodic pace, allow roughly " + Math.ceil(count / 110) + "–" + Math.ceil(count / 80) + " minutes, or choose adaptation." : "");
  }
  function renderReferences() {
    find("#reference-list").innerHTML = references.map((ref, index) => {
      const snapshot = ref.snapshot;
      return '<fieldset class="reference-card" data-reference="' + index + '"><legend>Reference ' + (index + 1) + '</legend>' +
        '<label for="reference-url-' + index + '">Reference URL ' + (index + 1) + '</label><input type="url" required maxlength="2000" id="reference-url-' + index + '" value="' + escape(ref.url || "") + '" placeholder="https://…">' +
        '<label for="reference-purpose-' + index + '">Use link ' + (index + 1) + ' for</label><select id="reference-purpose-' + index + '"><option value="creative"' + (ref.purpose !== "lyrics" ? " selected" : "") + '>Creative reference</option><option value="lyrics"' + (ref.purpose === "lyrics" ? " selected" : "") + '>Import lyrics</option></select>' +
        '<label for="reference-note-' + index + '">What should we take from reference ' + (index + 1) + '?</label><textarea rows="2" maxlength="500" id="reference-note-' + index + '">' + escape(ref.note || "") + '</textarea>' +
        '<div class="actions"><button type="button" class="quiet resolve-reference">Preview link</button><button type="button" class="quiet remove-reference">Remove reference ' + (index + 1) + '</button></div>' +
        '<div class="reference-preview" aria-live="polite">' + preview(snapshot, ref.purpose, index) + '</div></fieldset>';
    }).join("");
    add.disabled = references.length >= 3;
    find("#reference-list").querySelectorAll(".reference-card").forEach((card, index) => {
      const ref = references[index], url = card.querySelector("input"), purpose = card.querySelector("select"), note = card.querySelector("textarea");
      const previewRoot = card.querySelector(".reference-preview");
      function invalidate() {
        ref.url = url.value; ref.purpose = purpose.value;
        delete ref.snapshotId; delete ref.snapshot;
        previewRoot.innerHTML = preview(null, ref.purpose, index);
        remember();
      }
      url.oninput = invalidate; purpose.onchange = invalidate;
      note.oninput = () => { ref.note = note.value; remember(); };
      card.querySelector(".remove-reference").onclick = () => { references.splice(index, 1); renderReferences(); remember(); add.focus(); };
      function bindUse() {
      const use = previewRoot.querySelector(".use-lyrics");
        if (use) use.onclick = () => {
          const content = previewRoot.querySelector(".imported-lyrics").value;
          const error = lyricError(content);
          if (error) { previewRoot.querySelector(".import-error").textContent = error; return; }
          sheet.value = content;
          updateLyrics(); remember(); sheet.focus();
          previewRoot.querySelector(".import-error").textContent = "Added to the lyric sheet. Review it above.";
        };
      }
      bindUse();
      card.querySelector(".resolve-reference").onclick = async (event) => {
        if (!url.reportValidity()) return;
        if (!url.value.startsWith("https://")) { previewRoot.textContent = "Use a public HTTPS link."; return; }
        const requestedUrl = url.value, requestedPurpose = purpose.value;
        const button = event.currentTarget;
        pending++; button.disabled = true; button.textContent = "Reading link…";
        try {
          const data = await api("/references/resolve", { method: "POST", role: "submitter", body: { url: requestedUrl, purpose: requestedPurpose } });
          if (!card.isConnected || ref.url !== requestedUrl || ref.purpose !== requestedPurpose) return;
          Object.assign(ref, data.reference); url.value = ref.url;
          previewRoot.innerHTML = preview(ref.snapshot, ref.purpose, index); bindUse(); remember();
        } catch (error) {
          if (card.isConnected && ref.url === requestedUrl && ref.purpose === requestedPurpose) previewRoot.textContent = error.message + " You can paste lyrics or describe this reference instead.";
        } finally {
          pending--; button.disabled = false; button.textContent = "Preview link";
        }
      };
    });
  }
  function preview(snapshot, purpose, index) {
    if (!snapshot) return '<p class="small">No content retrieved yet. Preview this link, or ' + (purpose === "lyrics" ? "paste its lyrics into the sheet above." : "describe what to borrow in the note.") + '</p>';
    let html = '<p><strong>' + escape(snapshot.title) + '</strong></p><p class="small">' + escape(snapshot.message || (snapshot.status === "ready" ? "Lyrics retrieved. Check the text before using it." : "Paste the lyrics instead.")) + '</p>';
    if (snapshot.text && purpose === "lyrics") html += '<label for="imported-lyrics-' + index + '">Review imported lyrics ' + (index + 1) + '</label><textarea rows="7" class="imported-lyrics" id="imported-lyrics-' + index + '">' + escape(snapshot.text) + '</textarea><button class="quiet use-lyrics" type="button">Use these lyrics — replace the sheet above</button><p class="small import-error" role="status"></p>';
    else if (snapshot.text) html += '<details><summary>View retrieved content</summary><pre class="material-text">' + escape(snapshot.text) + '</pre></details>';
    return html;
  }
  sheet.oninput = () => { updateLyrics(); remember(); };
  mode.onchange = () => { updateLyrics(); remember(); };
  document.querySelector("#direction")?.addEventListener("input", updateLyrics);
  for (const selector of ['#gen-duration', '#gen-candidates', '#generation-enabled', '#music-backend'])
    document.querySelector(selector)?.addEventListener('change', updateLyrics);
  root.addEventListener("invalid", () => { panel.open = true; }, true);
  add.onclick = () => { if (references.length >= 3) return; references.push({ url: "", purpose: "creative", note: "" }); renderReferences(); remember(); find("#reference-url-" + (references.length - 1)).focus(); };
  updateLyrics(); renderReferences();
  return {
    getLyrics() { return sheet.value; },
    setLyrics(value) {
      const error = lyricError(value);
      if (error) throw new Error(error);
      sheet.value = value; mode.value = 'preserve'; panel.open = true;
      updateLyrics(); remember();
    },
    read() {
      if (pending) throw new Error("Wait for the reference preview to finish before reviewing.");
      const data = current(), error = lyricError(sheet.value);
      if (error) { panel.open = true; sheet.focus(); throw new Error(error); }
      return { ...data, references: data.references.map(({ url, purpose, note, snapshotId }) => ({ url, purpose, note, ...(snapshotId ? { snapshotId } : {}) })) };
    },
    clear() { storage.remove(key); },
  };
}
export function materialBrief(details, escape) {
  if (!details?.lyricSheet && !details?.references?.length) return "";
  let html = '<div class="materials-review"><h3>Lyrics &amp; references</h3>';
  if (details.lyricSheet) html += '<p><strong>' + (details.lyricSheet.mode === "adapt" ? "Adapt these lyrics" : "Keep my wording") + '</strong> · ' + wordCount(details.lyricSheet.text).toLocaleString() + ' words</p><details><summary>Read the submitted lyric sheet</summary><pre class="material-text" tabindex="0" role="region" aria-label="Submitted lyric sheet">' + escape(details.lyricSheet.text) + '</pre></details>';
  for (const [index, ref] of (details.references || []).entries()) {
    const snapshot = ref.snapshot;
    const status = snapshot?.status === "ready" ? "Content saved" : snapshot ? "Content unavailable" : "Not previewed";
    html += '<div class="reference-review"><h4>Reference ' + (index + 1) + ' · ' + (ref.purpose === "lyrics" ? "Import lyrics" : "Creative reference") + '</h4><p class="small reference-status">' + status + '</p>';
    if (snapshot?.title) html += '<p class="reference-title">' + escape(snapshot.title) + '</p>';
    html += '<p>' + referenceLink(ref.url, escape) + '</p>';
    if (ref.note) html += '<p class="reference-note"><strong>Use this for:</strong> ' + escape(ref.note) + '</p>';
    html += '<p class="small">' + escape(ref.snapshot?.message || (ref.snapshot?.text ? "Reviewed page text saved with the request." : "No page content retrieved. Using your supplied lyrics or reference note.")) + '</p>';
    if (ref.snapshot?.text) html += '<details><summary>View saved reference content</summary><pre class="material-text" tabindex="0" role="region" aria-label="Saved content for reference ' + (index + 1) + '">' + escape(ref.snapshot.text) + '</pre></details>';
    html += '</div>';
  }
  return html + '<p class="small">Supplied lyrics, reference links, notes, and saved page text are public once the request is confirmed.</p></div>';
}

function referenceLink(value, escape) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) {
      return '<a href="' + escape(url.href) + '" target="_blank" rel="noopener noreferrer">' + escape(value) + '</a>';
    }
  } catch { /* Older or invalid references remain readable as text. */ }
  return escape(value);
}
