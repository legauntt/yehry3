// Common things people reach for, as [label on Essentials, start of the Advanced section's summary].
const SHORTCUTS = [
  ["Lyrics & adaptions", "Lyrics & references"],
  ["Timing", "Timing & key"],
  ["Style & instruments", "Style & instruments"],
  ["Basis songs", "Choose basis songs"],
];

export function mountRequestTabs(form, storage, draftId) {
  const tabs = [...form.querySelectorAll('[role="tab"]')];
  const key = "refinements-tab:" + draftId;
  const panelOf = (tab) => form.querySelector("#" + tab.getAttribute("aria-controls"));
  const behavior = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  function select(tab, focus = false) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      panelOf(item).hidden = !active;
    }
    storage.set(key, tab.id);
    if (focus) tab.focus();
  }
  // A sticky breadcrumb heads each panel: where you are, and one click to the other one.
  for (const tab of tabs) {
    const nav = document.createElement("nav");
    nav.className = "request-crumbs";
    nav.setAttribute("aria-label", "Request sections");
    nav.innerHTML = "<ol>" + tabs.map((item) => item === tab
      ? `<li aria-current="step">${item.textContent}</li>`
      : `<li><button type="button" class="text-link" data-crumb="${item.id}">${item.textContent}</button></li>`).join("") + "</ol>";
    panelOf(tab).prepend(nav);
  }
  const first = panelOf(tabs[0]).querySelector(".request-crumbs");
  first.insertAdjacentHTML("afterend", '<p class="request-shortcuts"><span>Common things:</span> ' +
    SHORTCUTS.map(([label], index) => `<button type="button" class="text-link" data-shortcut="${index}">${label} →</button>`).join(" ") + "</p>");
  const sectionFor = (summaryText) => [...form.querySelectorAll("details")].find((item) => item.querySelector(":scope > summary")?.textContent.trim().startsWith(summaryText));
  // Sections mount after the tabs, and some (generation) may not exist; hide shortcuts that would lead nowhere.
  function sync() {
    const links = [...form.querySelectorAll("[data-shortcut]")];
    for (const link of links) link.hidden = !sectionFor(SHORTCUTS[Number(link.dataset.shortcut)][1]);
    form.querySelector(".request-shortcuts").hidden = links.every((link) => link.hidden);
  }
  // Land on the section itself. Generation controls stay behind their own switch, so that is where a hidden one leads.
  function openSection(summaryText) {
    select(tabs[1]);
    const details = sectionFor(summaryText);
    const gated = details?.closest("[hidden]");
    const target = (gated ? form.querySelector("#generation-enabled") : details) || panelOf(tabs[1]);
    if (details && !gated) details.open = true;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: behavior() });
      (details && !gated ? details.querySelector(":scope > summary") : target).focus?.({ preventScroll: true });
    });
  }
  form.addEventListener("click", (event) => {
    const crumb = event.target.closest("[data-crumb]");
    if (crumb) {
      select(tabs.find((tab) => tab.id === crumb.dataset.crumb));
      form.querySelector(".request-tabs").scrollIntoView({ block: "start", behavior: behavior() });
      return;
    }
    const shortcut = event.target.closest("[data-shortcut]");
    if (shortcut) openSection(SHORTCUTS[Number(shortcut.dataset.shortcut)][1]);
  });
  for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => select(tab);
    tab.onkeydown = (event) => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[next], true);
    };
  }
  // Reveal invalid fields before the browser tries to focus them on submission.
  form.addEventListener("invalid", (event) => {
    const panel = event.target.closest('[role="tabpanel"]');
    if (panel) select(tabs.find((tab) => tab.id === panel.getAttribute("aria-labelledby")));
  }, true);
  select(tabs.find((tab) => tab.id === storage.get(key)) || tabs[0]);
  return { sync };
}
