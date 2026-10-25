#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { state: { type: 'string' }, output: { type: 'string' }, logs: { type: 'boolean', default: false }, audit: { type: 'string' }, baseline: { type: 'string' }, 'skipped-report': { type: 'string' } } });
if (!values.state) throw new Error('--state is required');
const state = path.resolve(values.state);
const ledger = JSON.parse(await readFile(path.join(state, 'ledger.json'), 'utf8'));
const plan = JSON.parse(await readFile(path.join(state, 'plan.json'), 'utf8').catch(() => '{"jobs":[]}'));
const counts = {};
const failures = [];
for (const [key, entry] of Object.entries(ledger.jobs)) {
  counts[entry.status] = (counts[entry.status] || 0) + 1;
  if (entry.status === 'failed-or-uncertain') {
    const job = plan.jobs.find(job => job.key === key);
    const packet = JSON.parse(await readFile(path.join(state, key, 'sources.json'), 'utf8').catch(() => '{}'));
    const failure = { key, id: packet.song?.id || job?.id, title: entry.title || job?.title || packet.song?.title, error: entry.error, folder: path.join(state, key) };
    const log = await readFile(path.join(state, key, 'generation.log'), 'utf8').catch(() => '');
    failure.reason = log.includes('moderation_blocked') ? 'Provider safety rejection' : 'Failed or uncertain; manual review required';
    failure.categories = log.match(/safety_violations=\[([^\]]+)\]/)?.[1] || 'Other / not specified';
    failure.stage = log.match(/'moderation_stage': '([^']+)'/)?.[1] || 'Not specified';
    if (values.logs) failure.log = log || 'No generation log; failure occurred outside the image call.';
    failures.push(failure);
  }
}
const report = JSON.stringify({ lifetimeReservedEstimate: ledger.reservations, backfillReservedEstimate: ledger.oneOffReservations ?? ledger.reservations, monthlyReservedEstimates: ledger.monthlyReservations || {}, auditEvents: ledger.events?.length || 0, estimatesAreNotBills: true, counts, failures }, null, 2);
if (values.output) await writeFile(values.output, report + '\n');
if (values['skipped-report']) {
  if (!values.audit || !values.baseline) throw new Error('--audit and --baseline are required for --skipped-report');
  const audit = JSON.parse(await readFile(values.audit, 'utf8'));
  const baseline = JSON.parse(await readFile(values.baseline, 'utf8'));
  const link = song => `[${String(song.title).replaceAll('|', '\\|').replaceAll('[', '\\[').replaceAll(']', '\\]')}](https://yehry3.app/song/${encodeURIComponent(song.id)}/)`;
  const rows = failures.map(failure => {
    const current = audit.songs.find(song => song.id === failure.id);
    const installed = current?.cover?.interpretation === 'non-explicit-scene' ? 'Resolved with a reviewed non-explicit picture' : current?.cover?.interpretation === 'humorous-fallback' ? 'Resolved with a humorous fallback picture' : 'Has a saved cover now';
    return `| ${link(failure)} | ${failure.reason}: ${failure.categories} (${failure.stage}) | ${current ? current.kind === 'text-placeholder' ? 'Placeholder remains' : installed : 'Not in the current active catalog'} |`;
  });
  const unknown = audit.songs.filter(song => song.kind !== 'saved-image' && !failures.some(failure => failure.id === song.id));
  const preserved = baseline.songs.filter(song => song.kind === 'saved-image');
  const text = [
    '# Skipped artwork report', '', `Catalog checked: ${audit.createdAt}.`, '',
    `${audit.songs.length} active songs; ${audit.songs.filter(song => song.kind === 'saved-image').length} saved pictures; ${audit.songs.filter(song => song.kind === 'text-placeholder').length} remaining placeholders.`, '',
    '## Requests that did not produce an installed image', '',
    'These are historical provider-reported reasons, not guesses from song titles. Original failed receipts remain in the audit even when a separately reviewed alternative picture resolves the missing cover. Current status is shown alongside each failure.', '',
    '| Song | Recorded reason | Current status |', '| --- | --- | --- |', ...rows, '',
    '## Other active songs without a saved picture', '',
    ...(unknown.length ? unknown.map(song => `- ${link(song)} — ${song.kind}; no failed attempt is recorded in this ledger.`) : ['None.']), '',
    '## Intentionally preserved during the backfill', '',
    'These already had pictures and did not need generation. Pinned covers were also protected by your instruction.', '',
    ...preserved.map(song => `- ${link(song)} — ${song.pins > 0 ? 'pinned; preserved' : 'existing picture; preserved'}.`), '',
    'Archived songs were excluded before planning the batch. This report covers the recomputed active catalog and every failed attempt in the retained ledger.', '',
  ].join('\n');
  await writeFile(values['skipped-report'], text);
}
console.log(report);
