// Recover public approved sheets omitted from older static catalog publications.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function syncApprovedLyricSheets(catalog, publishedSongs) {
  const result = structuredClone(catalog);
  const changed = [];
  for (const song of result.songs) {
    const published = publishedSongs.find(item => item.id === song.id);
    const sheet = published?.originalPrompt?.finalLyricSheet;
    if (!sheet || !song.originalPrompt) continue;
    assert.equal(published.url, song.url, `Recording differs for ${song.id}`);
    const { finalLyricSheet: existing, ...brief } = song.originalPrompt;
    const { finalLyricSheet, ...publicBrief } = published.originalPrompt;
    assert.deepEqual(publicBrief, {
      ...brief, voiceModel: brief.voiceModel || song.voiceModel || 'v6',
    }, `Confirmed brief differs for ${song.id}`);
    assert.deepEqual(Object.keys(sheet), ['text']);
    assert.equal(typeof sheet.text, 'string');
    assert.ok(sheet.text.length >= 80 && sheet.text.length <= 32000);
    assert.match(sheet.text.trimEnd(), /\[End\]$/);
    assert.equal(brief.generation?.reviewLyrics, true, `Review was not requested for ${song.id}`);
    if (existing) {
      assert.deepEqual(existing, sheet, `Existing approved sheet differs for ${song.id}`);
      continue;
    }
    song.originalPrompt.finalLyricSheet = structuredClone(sheet);
    changed.push(song.id);
  }
  return { catalog: result, changed };
}

export function catalogWithSheets(source, result) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  for (const id of result.changed) {
    const song = result.catalog.songs.find(item => item.id === id);
    const start = source.indexOf(`"id": ${JSON.stringify(id)}`);
    const marker = '"originalPrompt": {';
    const at = source.indexOf(marker, start) + marker.length;
    assert.ok(start >= 0 && at >= start + marker.length);
    const field = JSON.stringify({ finalLyricSheet: song.originalPrompt.finalLyricSheet }, null, 2)
      .split('\n').slice(1, -1).map(line => '      ' + line).join(newline);
    source = source.slice(0, at) + newline + field + ',' + source.slice(at);
  }
  assert.deepEqual(JSON.parse(source), result.catalog);
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../catalog.json', import.meta.url);
  const source = await readFile(file, 'utf8');
  const catalog = JSON.parse(source);
  const response = await fetch('https://chairlift.fly.dev/yehry3/songs', {
    headers: { 'X-Visitor-ID': randomUUID(), Origin: 'https://yehry3.app' },
    signal: AbortSignal.timeout(45000),
  });
  assert.ok(response.ok, `Public catalog returned ${response.status}`);
  const published = await response.json();
  assert.ok(Array.isArray(published.songs));
  assert.equal(new Set(published.songs.map(song => song.id)).size, published.songs.length);
  const result = syncApprovedLyricSheets(catalog, published.songs);
  if (process.argv.includes('--write') && result.changed.length) {
    await writeFile(file, catalogWithSheets(source, result));
  }
  console.log(`${process.argv.includes('--write') ? 'Synced' : 'Would sync'} ${result.changed.length} approved lyric sheets: ${result.changed.join(', ')}`);
}
