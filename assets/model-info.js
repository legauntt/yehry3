export function voiceVersionLabel(value) {
  const version = /^v\d+$/i.test(value || '') ? value.toLowerCase() : 'v6';
  const description = { v6: 'established', v7: 'fresh catalog', v8: 'expanded recordings' }[version];
  return `Tony ${version.toUpperCase()}${description ? ' · ' + description : ''}`;
}

export const modelComparison = [
  ["V6 · established", "The established full-catalog Tony voice. Its voice adapter has rank 8 in attention layers 9–16."],
  ["V7 · fresh catalog", "A fresh, recording-balanced selection: 492 excerpts from 27 recordings, without saved-favorite weighting. A new adapter trained on the same pretrained base, not on V6 weights: rank 16 in layers 5–16, trained for 8,000 steps. No new backing-band model."],
  ["V8 · expanded recordings", "A separate voice adapter trained on 79 minutes from 35 recordings, adding eight recordings to V7's training bank. It keeps V7's adapter size and trained from the same original base for 8,000 steps. The added excerpts have automated screening and still need listening review."],
  ["What the tests found", "V7 had about 0.6% lower development reconstruction loss than V6. V8 was effectively tied with V7: 0.037% higher development loss and 0.027% lower loss on two reserved songs. These measure a training objective; better Tony likeness or musical quality has not been established."],
  ["V8 song generation", "Choosing V8 also uses its updated lyric and ending guidance. Advanced options offer instruments and styles, timing and key, lyric approval, and composition choices. V6 and V7 can also use these optional generation controls."],
  ["Which should I choose?", "V8 is the default for new requests when available and remains experimental. V7 is the fallback when V8 is unavailable. Choose V6 for the established voice. Requests and finished songs retain the selected version; changing voices does not rewrite existing songs."],
];

export function modelInfoButton() {
  return '<button type="button" class="model-info-button" data-model-info="versions" aria-haspopup="dialog">Compare voices ⓘ</button>';
}

export function mountModelInfo() {
  if (document.getElementById("model-comparison")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "model-comparison";
  dialog.className = "model-comparison";
  dialog.setAttribute("aria-labelledby", "model-comparison-title");
  const heading = document.createElement("h2");
  heading.id = "model-comparison-title";
  heading.textContent = "Tony V6, V7 and V8";
  heading.tabIndex = -1;
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
  close.autofocus = false;
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
    if (event.target.closest('[data-model-info]')) { dialog.showModal(); heading.focus({ preventScroll: true }); dialog.scrollTop = 0; }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
