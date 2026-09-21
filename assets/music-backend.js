export const PAID_BACKEND = 'eleven_music';
export const MUSIC_BACKEND_PREFERENCE_KEY = 'yehry3:music-backend';
export const PAID_AGREEMENT_KEY = 'yehry3:paid-music-agreed';
export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

const minutes = (seconds) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(seconds / 60);

export function paidCost(details = {}) {
  const duration = details.generation?.duration;
  if (!Number.isInteger(duration) || duration < 69 || duration > 600) return null;
  return { duration, estimate: duration / 60 * 15, reserve: Math.ceil(duration / 60 * 100) };
}

/**
 * What is left to spend, for the sentence under a paid length. The $200 cap is a spending
 * authorization; the plan balance is what the ElevenLabs account can actually pay for, so both
 * are shown, and a length the credits cannot cover is called out before the server refuses it.
 */
export function budgetNote(budget, estimateCents) {
  if (!budget) return '';
  let note = ` ${money(budget.remainingCents)} is available to reserve.`;
  const provider = budget.provider;
  if (provider?.fresh && Number.isFinite(provider.availableCents)) {
    const renews = provider.resetAt ? new Date(provider.resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    note += ` The ElevenLabs plan has about ${money(provider.availableCents)} of generation credits left${renews ? `, renewing ${renews}` : ''}.`;
    if (estimateCents > provider.availableCents)
      note += ' That is not enough for this length, so it cannot be confirmed until credits renew. Choose a shorter song or use local generation.';
  }
  return note;
}

export function savedMusicBackend() {
  try {
    const value = localStorage.getItem(MUSIC_BACKEND_PREFERENCE_KEY);
    return ['local', PAID_BACKEND].includes(value) ? value : '';
  } catch { return ''; }
}

export function rememberMusicBackend(value) {
  if (!['local', PAID_BACKEND].includes(value)) return;
  try { localStorage.setItem(MUSIC_BACKEND_PREFERENCE_KEY, value); }
  catch { /* The current request still retains its per-tab selection. */ }
}

/** The paid agreement is ticked once per browser and stays ticked; unticking it on a later review forgets it. */
export function paidAgreed() {
  try { return localStorage.getItem(PAID_AGREEMENT_KEY) === 'true'; } catch { return false; }
}

export function rememberPaidAgreement(agreed) {
  try {
    if (agreed) localStorage.setItem(PAID_AGREEMENT_KEY, 'true');
    else localStorage.removeItem(PAID_AGREEMENT_KEY);
  } catch { /* Without storage it is simply asked again next time. */ }
}

export function paidConfirmation(details, escape) {
  if (details?.musicBackend !== PAID_BACKEND) return '';
  const cost = paidCost(details);
  if (!cost) return '<p class="field-error">Review this request again to choose its Auto length and confirm the paid cost.</p>';
  const authorization = `<label class="generation-enable"><input type="checkbox" id="confirm-paid" required${paidAgreed() ? ' checked' : ''}> I agree to use paid generation and send this song’s lyrics and musical direction to ElevenLabs.</label>`;
  return `<div class="paid-music-confirmation"><p><strong>Eleven Music · paid</strong><br>${escape(money(cost.estimate))} estimated generation cost for ${minutes(cost.duration)} minutes. This request reserves ${escape(money(cost.reserve))} from the shared $200 total cap.</p>${authorization}<p class="small">Tony’s voice is applied on the studio PC. One paid composition; saved audio is reused on retry. Reservations stay counted after cancellation or an uncertain provider response until reviewed. Estimates exclude subscription fees and taxes.</p></div>`;
}

export function mountMusicBackend(root, { draft, generation, basisRoot, storage, api, escape, onChange }) {
  const key = `music-backend-draft:${draft.id}`;
  const initial = storage.get(key) || draft.details?.musicBackend || savedMusicBackend() || 'local';
  const attached = Boolean(draft.details?.remixSource);
  let available = false, budget;
  root.innerHTML = `<label for="music-backend">Band generator</label><select id="music-backend" name="musicBackend"><option value="local">Local · ACE (no music API charge)</option><option value="eleven_music" disabled>Eleven Music · paid</option></select><p class="small" id="music-backend-status" role="status">Checking paid music availability…</p><div id="paid-music-note" hidden><p class="small">Eleven Music composes the band and guide vocal, then the studio applies your selected Tony voice. Lyrics, style, instruments, timing and mix controls carry over. Catalog remixes use the original lyrics and musical brief to guide a new composition; the recording’s melody is not preserved. Other basis recordings and local variation controls are unavailable.</p><p class="small" id="paid-music-cost"></p></div>`;
  const select = root.querySelector('select'), status = root.querySelector('#music-backend-status');
  if (!['local', PAID_BACKEND].includes(initial)) {
    const invalid = new Option('Saved generator unavailable', initial); invalid.disabled = true; select.add(invalid);
  }
  select.value = initial;
  const updateCost = () => {
    const field = document.querySelector('#gen-duration');
    const raw = field?.value.trim();
    const duration = Number(raw);
    if (!raw) {
      root.querySelector('#paid-music-cost').textContent = 'Auto usually chooses 3–5 minutes (about $0.45–$0.75). Review shows the chosen length and exact reservation before you confirm.';
      return;
    }
    root.querySelector('#paid-music-cost').textContent = Number.isFinite(duration)
      ? `Estimated ${money(duration / 60 * 15)} for ${minutes(duration)} minutes; reserves ${money(Math.ceil(duration / 60 * 100))} from the shared $200 total cap.${budgetNote(budget, Math.ceil(duration * 15 / 60))}` : '';
  };
  const change = () => {
    const paid = select.value === PAID_BACKEND;
    root.querySelector('#paid-music-note').hidden = !paid;
    generation.setBackend(paid ? PAID_BACKEND : 'local');
    basisRoot.hidden = paid;
    document.querySelectorAll('[data-remix-guidance]').forEach(note => {
      note.textContent = paid ? 'Its lyrics and musical brief guide a new composition. The original recording and melody are not sent to Eleven Music.'
        : 'Its vocals guide the new arrangement; exact melody and timing may change.';
    });
    storage.set(key, select.value);
    updateCost(); onChange?.();
  };
  select.addEventListener('change', () => { rememberMusicBackend(select.value); change(); });
  document.querySelector('#generation-root')?.addEventListener('input', updateCost);
  change();
  api('/music-backends', { role: 'submitter' }).then((result) => {
    if (!root.isConnected) return;
    budget = result;
    available = result.enabled === true && (!attached || result.supportsRemix === true);
    select.querySelector('[value="eleven_music"]').disabled = !available;
    status.textContent = attached && !result.supportsRemix ? 'Paid remixes are temporarily unavailable. Your attached recording is retained.'
      : available ? 'Local is the default. Paid generation asks for your agreement at confirmation.'
      : 'Eleven Music is temporarily unavailable. Your saved selection is retained.';
    updateCost();
  }).catch(() => {
    if (root.isConnected) status.textContent = 'Paid availability could not be checked. Local generation is available; reload to try the paid option again.';
  });
  return { read() {
    if (select.value === PAID_BACKEND && !available) throw new Error('Eleven Music is unavailable. Your draft is saved; try again shortly or choose local generation.');
    if (!['local', PAID_BACKEND].includes(select.value)) throw new Error('Choose an available band generator.');
    rememberMusicBackend(select.value);
    return select.value;
  }, value: () => select.value, clear() { storage.remove(key); } };
}
