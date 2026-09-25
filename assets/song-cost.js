import { musicBackendOf } from './music-provenance.js';
import { settledSongCosts } from './settled-song-costs.js';

// The published ledger snapshot contains generation charges only, in USD cents.
// New songs still get a labeled estimate until their settlement is exported.
export function songCost(song) {
  if (musicBackendOf(song) !== 'eleven_music') return null;
  const settled = settledSongCosts[song.id];
  if (Number.isSafeInteger(settled) && settled >= 0) return { cents: settled, estimated: false };
  const seconds = song.duration;
  return { cents: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60 * 15) : 50, estimated: true };
}

export function songCostLabel(song) {
  if (musicBackendOf(song) === 'local') return '<span class="song-cost free" title="Made on the local band generator; no music API charge.">FREE</span>';
  const cost = songCost(song);
  if (!cost) return '';
  const amount = cost.cents >= 100
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cost.cents / 100)
    : `${new Intl.NumberFormat('en-US').format(cost.cents)} ¢`;
  const description = cost.estimated
    ? 'Estimated generation cost in USD; based on 15 cents per minute when length is known, otherwise about 50 cents.'
    : 'Recorded generation cost in USD, reconciled against provider credit usage.';
  return `<span class="song-cost" title="${description} Subscription fees and taxes excluded.">${amount}</span>`;
}
