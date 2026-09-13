const v7Studies = new Set([
  "telephone-wire-tony-v7-study",
  "spare-key-weather-tony-v7-study",
  "the-last-light-in-the-station-tony-v7-study",
]);

// Shared explanatory copy, independent of future model-selection controls.
export const modelComparison = [
  ["V6 · production", "The established full-catalog Tony voice used for requests. Its voice adapter has rank 8 in attention layers 9–16."],
  ["V7 · experimental", "A fresh, recording-balanced selection: 492 excerpts from 27 recordings, without saved-favorite weighting. A new adapter trained on the same pretrained base, not on V6 weights: rank 16 in layers 5–16, trained for 8,000 steps. No new backing-band model."],
  ["What the test found", "About 0.6% lower held-set reconstruction loss than V6 with matched references. That split helped select the candidate; this is not proof of better Tony likeness or musical quality."],
  ["What stays the same", "V6 remains the production default. These three V7 studies are for listening review, with unresolved issue notices retained. Publishing them does not enable V7 for new requests."],
];

export function modelInfoButton(song) {
  return v7Studies.has(song?.id)
    ? '<button type="button" class="model-info-button" data-model-info="v7" aria-haspopup="dialog">V6 vs V7 ⓘ</button>'
    : "";
}

export function mountModelInfo() {
  if (document.getElementById("model-comparison")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "model-comparison";
  dialog.className = "model-comparison";
  dialog.setAttribute("aria-labelledby", "model-comparison-title");
  const heading = document.createElement("h2");
  heading.id = "model-comparison-title";
  heading.textContent = "Tony V6 vs Tony V7";
  dialog.append(heading);
  for (const [label, text] of modelComparison) {
    const section = document.createElement("section");
    const title = document.createElement("h3");
    const paragraph = document.createElement("p");
    title.textContent = label;
    paragraph.textContent = text;
    section.append(title, paragraph);
    dialog.append(section);
  }
  const form = document.createElement("form");
  form.method = "dialog";
  const close = document.createElement("button");
  close.className = "quiet";
  close.textContent = "Close comparison";
  close.autofocus = true;
  form.append(close);
  dialog.append(form);
  document.body.append(dialog);
  // This informational dialog has one interactive control. Keep keyboard
  // traversal in the dialog; Escape retains the browser's native dismissal.
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      close.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-model-info="v7"]')) dialog.showModal();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
