export function mountRequestTabs(form, storage, draftId) {
  const tabs = [...form.querySelectorAll('[role="tab"]')];
  const key = "refinements-tab:" + draftId;
  function select(tab, focus = false) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      form.querySelector("#" + item.getAttribute("aria-controls")).hidden = !active;
    }
    storage.set(key, tab.id);
    if (focus) tab.focus();
  }
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
}
