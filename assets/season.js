import './halloween-preferences.js';

export function halloweenSeason(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({type, value}) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return date >= '2026-10-01' && date < '2026-11-01';
}

export function mountDashboardPumpkins(root) {
  if (!halloweenSeason()) return;
  const decorate = (host, cluster = false) => {
    if (!host || host.querySelector('.dashboard-pumpkins')) return;
    const pumpkins = document.createElement('span');
    pumpkins.className = `dashboard-pumpkins${cluster ? ' pumpkin-patch' : ''}`;
    pumpkins.setAttribute('aria-hidden', 'true');
    pumpkins.textContent = cluster ? '🎃 🎃 🎃' : '🎃';
    if (cluster && !host.matches('.site-footer')) {
      const portrait = document.createElement('img');
      portrait.className = 'pumpkin-doomer';
      portrait.src = '/assets/pumpkin-doomer.webp';
      portrait.alt = '';
      portrait.width = 180;
      portrait.height = 180;
      pumpkins.prepend(portrait);
    }
    host.prepend(pumpkins);
  };
  decorate(root.querySelector('.hero-copy, .queue-intro'), true);
  root.querySelectorAll('.section-heading h2, .request-banner').forEach(host => decorate(host));
  decorate(document.querySelector('.site-footer'), true);
}
