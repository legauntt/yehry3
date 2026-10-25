// Explicit, text-only live acceptance check. Creates one expiring, UNCONFIRMED draft.
// It never confirms a song, calls a music provider, or uses the GPU.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
if (!args.includes('--base') || !args.includes('--output') || !process.env.YEHRY3_PROMPT_PASSWORD) throw new Error('Supply --base, --output and YEHRY3_PROMPT_PASSWORD for an explicit lyric-only check.');
const base = option('--base').replace(/\/$/, ''), output = path.resolve(option('--output'));
const pickupReport = args.includes('--pickup-report') ? path.resolve(option('--pickup-report')) : null;
if (!base.startsWith('https://') && !base.startsWith('http://127.0.0.1:')) throw new Error('HTTPS or a local preview is required.');
const headers = { 'Content-Type': 'application/json', 'X-Visitor-ID': randomUUID() };
async function call(endpoint, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + endpoint, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  assert.equal(response.ok, true, `HTTP ${response.status}: ${data.error || endpoint}`);
  return data;
}
const { token } = await call('/session', { role: 'submitter', password: process.env.YEHRY3_PROMPT_PASSWORD });
headers.Authorization = 'Bearer ' + token;
assert.equal((await call('/lyric-workshop')).available, true, 'The lyric writer must be online.');
const { prompt } = await call('/prompts', { prompt: 'An original funny disco song about a lonely robot waiting for the last bus. The final verse reveals that the robot is the bus driver.', authoredBy: '', requestId: randomUUID() });
const report = { checkedAt: new Date().toISOString(), draftId: prompt.id, rejections: [], generations: [] };
async function generate(instruction, lyrics = '', action = 'custom') {
  const start = performance.now();
  let { job } = await call('/lyric-workshop', { requestId: randomUUID(), draftId: prompt.id, instruction, lyrics, action, direction: 'Disco, with a comic final reveal', keep: 'A singable hook', duration: 180 });
  let pickupWithinMs;
  if (pickupReport && ['queued', 'working'].includes(job.state)) {
    const pickupDeadline = performance.now() + 30000;
    while (performance.now() < pickupDeadline) {
      let pickup;
      try { pickup = JSON.parse(await readFile(pickupReport, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (pickup?.jobId === job.id) {
        // Includes submission round trip and up to 50 ms of observation delay:
        // an upper bound on pickup, measured entirely on this PC's clock.
        pickupWithinMs = Math.ceil(performance.now() - start);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(Number.isFinite(pickupWithinMs), 'The PC must acknowledge this exact lyric job.');
  }
  const deadline = Date.now() + 185000;
  while (['queued', 'working'].includes(job.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    ({ job } = await call('/lyric-workshop/' + encodeURIComponent(job.id)));
  }
  return { ...job, seconds: Math.round((performance.now() - start) / 100) / 10, ...(pickupWithinMs === undefined ? {} : { pickupWithinMs }) };
}
for (const instruction of ['How are you?', "What's the weather?", "What's the square root", 'Write a python program']) {
  const job = await generate(instruction);
  assert.equal(job.state, 'rejected'); assert.equal(job.lyrics, undefined);
  report.rejections.push({ instruction, state: job.state });
}
const generated = await generate('Write a first lyric draft from my song idea and all supplied song preferences.');
assert.equal(generated.state, 'ready'); assert.ok(generated.lyrics.length >= 74);
report.generations.push({ id: generated.id, seconds: generated.seconds, words: generated.lyrics.split(/\s+/).length, ...(pickupReport ? { pickupWithinMs: generated.pickupWithinMs } : {}) });
// Simulate a manual edit, then a quick action on that exact current sheet.
const edited = generated.lyrics + '\n[Outro]\nOne more stop, then home.';
const revised = await generate('', edited, 'funnier');
assert.equal(revised.state, 'ready'); assert.ok(revised.lyrics.length >= 74);
report.generations.push({ id: revised.id, seconds: revised.seconds, words: revised.lyrics.split(/\s+/).length, ...(pickupReport ? { pickupWithinMs: revised.pickupWithinMs } : {}) });
const { prompt: reviewed } = await call('/prompts/' + encodeURIComponent(prompt.id), {
  version: prompt.version, direction: 'Playful disco with a bright dance groove', keep: 'Keep the chosen words', basisSongIds: [], voiceModel: 'v6', lyricSheet: { text: revised.lyrics, mode: 'preserve' },
}, 'PATCH');
assert.equal(reviewed.status, 'review'); assert.equal(reviewed.confirmedAt, undefined);
assert.deepEqual(reviewed.details.lyricSheet, { text: revised.lyrics, mode: 'preserve' });
report.exactWordingSaved = true; report.songConfirmed = false;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
