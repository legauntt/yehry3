// Read-only release check. Fixture browser coverage is isolated by the matching Playwright config.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const site = process.env.YEHRY3_SITE_URL || 'https://yehry3.app';
const api = process.env.YEHRY3_API_URL || 'https://chairlift.fly.dev/yehry3';
const id = process.argv[2] || 'distonyc-ad1afcb1111cab848e47f23e';
assert.match(id, /^[a-z0-9-]{1,120}$/);
const visitor = randomUUID();
const get = url => fetch(url, { headers: { 'X-Visitor-ID': visitor }, signal: AbortSignal.timeout(30000) });
const normalize = value => value.replace(/\r\n/g, '\n');
for (const name of ['audio-edit-model.js', 'audio-editor.js', 'audio-editor.css', 'sides.js', 'api.js', 'lyrics.js', 'song-data.js', 'performance-lyrics.js']) {
  const response = await get(`${site}/assets/${name}`);
  assert.equal(response.status, 200, name);
  assert.equal(normalize(await response.text()), normalize(await readFile(new URL(`../assets/${name}`, import.meta.url), 'utf8')), name);
}
for (const endpoint of ['audio-editor', 'audio-source']) {
  assert.equal((await get(`${api}/admin/songs/${id}/${endpoint}`)).status, 401, `${endpoint} admin gate`);
}
const response = await get(`${api}/songs/${id}`);
assert.equal(response.status, 200);
const { song } = await response.json();
assert.equal(song.id, id);
assert.ok(Array.isArray(song.audioEdits));
assert.ok(Object.hasOwn(song, 'defaultAudioEditId'));
assert.ok(!Object.hasOwn(song, 'audioAnalysis'));
if (song.defaultAudioEditId) {
  const edit = song.audioEdits.find(row => row.id === song.defaultAudioEditId);
  assert.equal(song.url, edit.url); assert.equal(song.originalAudio.url, edit.sourceUrl);
} else assert.equal(song.originalAudio, null);
console.log('Deployed audio editor assets, admin-only endpoints, preserved-source playback contract and public detail verified.');
