// Keep the collection's disclosures in one row while their panels float below it.
// Native details preserve keyboard activation and the profile's save-song shortcut.
export function mountCatalogTools(toolbar, scope) {
  const disclosures = [...toolbar.querySelectorAll(
    '.catalog-filters, .profile-details, .listening-overview, .catalog-voting',
  )];
  for (const disclosure of disclosures) {
    disclosure.classList.add('catalog-popout');
    scope.on(disclosure, 'toggle', () => {
      if (disclosure.open) {
        for (const other of disclosures) if (other !== disclosure) other.open = false;
      }
    });
  }
  const dismissOutside = event => {
    for (const disclosure of disclosures) {
      if (!disclosure.contains(event.target)) disclosure.open = false;
    }
  };
  scope.on(document, 'pointerdown', dismissOutside);
  scope.on(document, 'focusin', event => {
    // A save failure can open the profile while focus is restored to its song.
    // Only dismiss for keyboard focus that actually leaves this panel.
    for (const disclosure of disclosures) {
      if (disclosure.contains(event.relatedTarget) && !disclosure.contains(event.target)) disclosure.open = false;
    }
  });
  scope.on(document, 'keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const opened = disclosures.find(disclosure => disclosure.open);
    if (!opened) return;
    event.preventDefault();
    opened.open = false;
    opened.querySelector('summary').focus();
  });
}
