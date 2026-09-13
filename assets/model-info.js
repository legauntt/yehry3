export const modelComparison = [
  ["V6 · established", "The established full-catalog Tony voice. Its voice adapter has rank 8 in attention layers 9–16."],
  ["V7 · experimental", "A fresh, recording-balanced selection: 492 excerpts from 27 recordings, without saved-favorite weighting. A new adapter trained on the same pretrained base, not on V6 weights: rank 16 in layers 5–16, trained for 8,000 steps. No new backing-band model."],
  ["What the test found", "About 0.6% lower held-set reconstruction loss than V6 with matched references. That split helped select the candidate; this is not proof of better Tony likeness or musical quality."],
  ["Which should I choose?", "V6 is the established default. V7 is available for new requests if you want to try the experimental voice. Finished songs keep a V6 or V7 badge so you can tell which one was used."],
];

export function modelInfoButton() {
  return '<button type="button" class="model-info-button" data-model-info="v7" aria-haspopup="dialog">V6 vs V7 ⓘ</button>';
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
