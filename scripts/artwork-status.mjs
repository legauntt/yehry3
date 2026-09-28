#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { state: { type: 'string' }, output: { type: 'string' }, logs: { type: 'boolean', default: false } } });
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
    const failure = { key, title: entry.title || job?.title || packet.song?.title, error: entry.error, folder: path.join(state, key) };
    if (values.logs) failure.log = await readFile(path.join(state, key, 'generation.log'), 'utf8').catch(() => 'No generation log; failure occurred outside the image call.');
    failures.push(failure);
  }
}
const report = JSON.stringify({ lifetimeReservedEstimate: ledger.reservations, backfillReservedEstimate: ledger.oneOffReservations ?? ledger.reservations, monthlyReservedEstimates: ledger.monthlyReservations || {}, auditEvents: ledger.events?.length || 0, estimatesAreNotBills: true, counts, failures }, null, 2);
if (values.output) await writeFile(values.output, report + '\n');
console.log(report);
