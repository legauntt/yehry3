#!/usr/bin/env node
// Read-only inventory and publication guard for a cover replacement batch.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import artwork from '../assets/artwork-catalog.js';
import { digest } from './artwork-policy.mjs';

export function artworkKind(song, covers) {
  if (typeof song.adminPinned !== 'boolean') return 'unknown-pin-status';
  return covers[song.id] ? 'saved-image' : 'text-placeholder';
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    output: { type: 'string' }, baseline: { type: 'string' },
    api: { type: 'string', default: 'https://chairlift.fly.dev/yehry3' },
  } });
  const command = positionals[0] || 'audit';
  if (!['audit', 'verify-protected'].includes(command)) throw new Error('Unknown audit command');
  const response = await fetch(values.api + '/songs/summary', {
    headers: { 'X-Visitor-ID': 'yehry3-artwork-program-v1' }, signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  const { songs } = await response.json();
  if (!Array.isArray(songs) || !songs.length) throw new Error('Invalid catalog');
  const root = path.resolve(import.meta.dirname, '..');
  const rows = await Promise.all(songs.map(async song => {
    const cover = artwork[song.id] || null;
    return { id: song.id, title: song.title, adminPinned: song.adminPinned, kind: artworkKind(song, artwork),
      cover, hash: cover ? digest(await readFile(path.join(root, cover.src))) : null };
  }));
  if (command === 'verify-protected') {
    if (!values.baseline) throw new Error('--baseline is required');
    const before = JSON.parse(await readFile(values.baseline, 'utf8'));
    const protectedRows = before.songs.filter(old => old.adminPinned || old.pins > 0 || rows.find(s => s.id === old.id)?.adminPinned);
    for (const old of protectedRows) {
      const current = rows.find(s => s.id === old.id);
      const cover = artwork[old.id] || null;
      const hash = cover ? digest(await readFile(path.join(root, cover.src))) : null;
      if (current?.kind === 'unknown-pin-status' || JSON.stringify(cover) !== JSON.stringify(old.cover) || hash !== old.hash)
        throw new Error(`Pinned cover changed: ${old.title} (${old.id})`);
    }
    if (rows.some(row => row.kind === 'unknown-pin-status')) throw new Error('Unknown live pin status');
    console.log(`Verified ${protectedRows.length} pinned covers unchanged, including pins added during the batch.`);
    return;
  }
  if (!values.output) throw new Error('--output is required');
  const result = { createdAt: new Date().toISOString(), songs: rows };
  await mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ catalog: rows.length, pinned: rows.filter(s => s.adminPinned).length,
    unpinnedText: rows.filter(s => s.kind === 'text-placeholder' && s.adminPinned === false).length,
    savedImages: rows.filter(s => s.kind === 'saved-image').length,
    unknown: rows.filter(s => s.kind === 'unknown-pin-status').map(s => ({ id: s.id, title: s.title })),
    pinnedTitles: rows.filter(s => s.adminPinned).map(s => s.title), output: values.output }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
