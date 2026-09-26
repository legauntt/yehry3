// Grid and List share one action row and a popout, with no duplicate controls.
export function mountSongMenus(root, scope) {
  let openedId = null;
  const menu = () => [...root.querySelectorAll('.song-menu')]
    .find(item => item.closest('[data-id]').dataset.id === openedId);
  function position() {
    const current = menu();
    if (!current) return;
    const panel = current.querySelector('.song-menu-panel');
    const button = current.querySelector('.song-more');
    const anchor = button.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, anchor.right - box.width))}px`;
    const below = innerHeight - anchor.bottom - 8;
    const top = below >= box.height || below >= anchor.top
      ? anchor.bottom + 6 : anchor.top - box.height - 6;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - box.height - 8, top))}px`;
  }
  function sync() {
    let found = false;
    for (const item of root.querySelectorAll('.song-menu')) {
      const open = item.closest('[data-id]').dataset.id === openedId;
      item.classList.toggle('is-open', open);
      item.querySelector('.song-more').setAttribute('aria-expanded', String(open));
      if (open) found = true;
    }
    if (!found) openedId = null;
    position();
  }
  function close(focus = false) {
    const button = menu()?.querySelector('.song-more');
    openedId = null;
    sync();
    if (focus) button?.focus({ preventScroll: true });
  }
  scope.on(root, 'click', event => {
    const button = event.target.closest('.song-more');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    openedId = openedId === id ? null : id;
    sync();
  });
  scope.on(document, 'pointerdown', event => {
    if (!event.target.closest('dialog[open]') && !menu()?.contains(event.target)) close();
  });
  scope.on(document, 'focusin', event => {
    const current = menu();
    // A redraw dialog temporarily owns focus, then returns it to its trigger.
    if (current?.contains(event.relatedTarget) && !current.contains(event.target)
      && !event.target.closest('dialog[open]')) close();
  });
  scope.on(document, 'keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]') || !menu()) return;
    event.preventDefault();
    close(true);
  });
  scope.on(window, 'scroll', position, { capture: true, passive: true });
  scope.on(window, 'resize', position);
  const observer = new MutationObserver(() => close());
  observer.observe(root, { attributes: true, attributeFilter: ['data-view'] });
  scope.onLeave(() => observer.disconnect());
  return { sync };
}
