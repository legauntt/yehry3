// Decorate the existing links so their routes and availability still have one owner.
const icons = {
  lyrics: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  remix: '<path d="M3 6h3c5 0 7 12 12 12h3M17 14l4 4-4 4M3 18h3c2 0 3-2 4-4M14 10c1-2 2-4 4-4h3M17 2l4 4-4 4"/>',
  plan: '<rect x="5" y="4" width="15" height="17" rx="2"/><rect x="9" y="2" width="7" height="4" rx="1"/><path d="m8 11 1 1 2-2m-3 7 1 1 2-2m3-5h3m-3 6h3"/>',
  prompt: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0ZM7 8h10M7 12h7"/>',
  compare: '<path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4"/>',
};

export function decorateSongLinks(root) {
  for (const link of root.querySelectorAll('a, .remix-unavailable')) {
    if (link.dataset.songLink) continue;
    const url = link instanceof HTMLAnchorElement ? new URL(link.href) : null;
    const kind = !url || url.pathname === '/distonyc/' ? 'remix'
      : url.hash === '#compare-original' ? 'compare'
        : url.pathname.startsWith('/lyrics/') ? 'lyrics'
          : url.pathname === '/original-prompt/' ? (url.hash === '#song-plan' ? 'plan' : 'prompt') : null;
    if (!kind) continue;
    const label = link.textContent.replace(/\s*↗\s*$/, '').trim();
    const caption = document.createElement('span');
    caption.className = 'song-link-caption';
    caption.textContent = label;
    caption.setAttribute('aria-hidden', 'true');
    link.dataset.songLink = kind;
    link.dataset.tooltip = link.title ? `${label}. ${link.title}` : label;
    if (!link.hasAttribute('aria-label')) link.setAttribute('aria-label', label);
    link.removeAttribute('title');
    link.classList.remove('text-link', 'small');
    link.classList.add('song-link-icon');
    link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[kind]}</svg>`;
    link.append(caption);
    if (!url) {
      link.tabIndex = 0;
      link.setAttribute('role', 'link');
      link.setAttribute('aria-disabled', 'true');
    }
  }
}

export function mountSongLinkTooltips(root, scope) {
  const tooltip = document.createElement('div');
  tooltip.id = 'song-link-tooltip';
  tooltip.className = 'song-link-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let active, hideTimer;
  const hide = () => {
    clearTimeout(hideTimer);
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  };
  const show = (link) => {
    if (!link || !root.contains(link)) return;
    hide();
    active = link;
    tooltip.textContent = link.dataset.tooltip;
    tooltip.hidden = false;
    link.setAttribute('aria-describedby', tooltip.id);
    const box = link.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(innerWidth - tip.width - 8, box.left + (box.width - tip.width) / 2))}px`;
    tooltip.style.top = `${box.top >= tip.height + 12 ? box.top - tip.height - 6 : box.bottom + 6}px`;
  };
  const scheduleHide = () => {
    hideTimer = setTimeout(() => { if (active !== document.activeElement) hide(); }, 100);
  };
  scope.on(root, 'pointerover', event => {
    if (event.pointerType === 'touch' || matchMedia('(hover: none)').matches) return;
    const link = event.target.closest('[data-song-link]');
    if (root.contains(document.activeElement) && document.activeElement.matches('[data-song-link]') && document.activeElement !== link) return;
    if (link && !link.contains(event.relatedTarget)) show(link);
  });
  scope.on(root, 'pointerout', event => {
    if (active?.contains(event.target) && !active.contains(event.relatedTarget)) scheduleHide();
  });
  scope.on(root, 'focusin', event => show(event.target.closest('[data-song-link]')));
  scope.on(root, 'focusout', hide);
  scope.on(root, 'click', hide);
  scope.on(tooltip, 'pointerenter', () => clearTimeout(hideTimer));
  scope.on(tooltip, 'pointerleave', scheduleHide);
  scope.on(document, 'keydown', event => { if (event.key === 'Escape') hide(); });
  scope.on(window, 'scroll', () => {
    if (active && (active === document.activeElement || active.matches(':hover') || tooltip.matches(':hover'))) show(active);
    else hide();
  }, { capture: true, passive: true });
  scope.on(window, 'resize', hide);
  scope.onLeave(() => { hide(); tooltip.remove(); });
}
