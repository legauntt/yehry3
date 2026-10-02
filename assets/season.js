export function halloweenSeason(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({type, value}) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return date >= '2026-10-01' && date < '2026-11-01';
}
