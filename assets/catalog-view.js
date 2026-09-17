const key = "yehry3:catalog-view";
const normalize = (value) => value === "list" ? "list" : "grid";

export function mountCatalogView(root, tracks) {
  function apply(value) {
    const view = normalize(value);
    tracks.dataset.view = view;
    root.querySelectorAll("[data-catalog-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.catalogView === view));
    });
  }
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Storage is optional. */ }
  apply(saved);
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-catalog-view]");
    if (!button) return;
    const view = normalize(button.dataset.catalogView);
    // Only change layout: preserve the rows, filters, queue, and audio element.
    apply(view);
    try { localStorage.setItem(key, view); } catch { /* Keep the in-page choice. */ }
  });
  window.addEventListener("storage", (event) => {
    try {
      if (event.storageArea === localStorage && (event.key === key || event.key === null)) apply(event.newValue);
    } catch { /* Storage is optional. */ }
  });
}

