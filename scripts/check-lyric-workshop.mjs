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
const { prompt } = await call('/prompts', { prompt: 'An original funny disco song about a lonely robot waiting for the last bus', authoredBy: '', requestId: randomUUID() });
const report = { checkedAt: new Date().toISOString(), draftId: prompt.id, rejections: [], generations: [] };
async function generate(instruction, lyrics = '', action = 'custom') {
  const start = Date.now();
  let { job } = await call('/lyric-workshop', { requestId: randomUUID(), draftId: prompt.id, instruction, lyrics, action, direction: 'Disco, with a comic final reveal', keep: 'A singable hook', duration: 180 });
  const deadline = Date.now() + 185000;
  while (['queued', 'working'].includes(job.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    ({ job } = await call('/lyric-workshop/' + encodeURIComponent(job.id)));
  }
  let pickupMs;
  if (pickupReport && job.state === 'ready') {
    const pickup = JSON.parse(await readFile(pickupReport, 'utf8'));
    assert.equal(pickup.jobId, job.id, 'Pickup measurement must belong to this exact lyric job.');
    assert.ok(Number.isFinite(pickup.pickupMs) && pickup.pickupMs >= 0);
    pickupMs = pickup.pickupMs;
  }
  return { ...job, seconds: Math.round((Date.now() - start) / 100) / 10, ...(pickupMs === undefined ? {} : { pickupMs }) };
}
for (const instruction of ['How are you?', "What's the weather?", "What's the square root", 'Write a python program']) {
  const job = await generate(instruction);
  assert.equal(job.state, 'rejected'); assert.equal(job.lyrics, undefined);
  report.rejections.push({ instruction, state: job.state });
}
const generated = await generate('Write complete lyrics. Let the final verse reveal that the robot is the bus driver.');
assert.equal(generated.state, 'ready'); assert.ok(generated.lyrics.length >= 74);
report.generations.push({ id: generated.id, seconds: generated.seconds, words: generated.lyrics.split(/\s+/).length, ...(pickupReport ? { pickupMs: generated.pickupMs } : {}) });
// Simulate a manual edit, then a quick action on that exact current sheet.
const edited = generated.lyrics + '\n[Outro]\nOne more stop, then home.';
const revised = await generate('', edited, 'funnier');
assert.equal(revised.state, 'ready'); assert.ok(revised.lyrics.length >= 74);
report.generations.push({ id: revised.id, seconds: revised.seconds, words: revised.lyrics.split(/\s+/).length, ...(pickupReport ? { pickupMs: revised.pickupMs } : {}) });
const { prompt: reviewed } = await call('/prompts/' + encodeURIComponent(prompt.id), {
  version: prompt.version, direction: 'Playful disco with a bright dance groove', keep: 'Keep the chosen words', basisSongIds: [], voiceModel: 'v6', lyricSheet: { text: revised.lyrics, mode: 'preserve' },
}, 'PATCH');
assert.equal(reviewed.status, 'review'); assert.equal(reviewed.confirmedAt, undefined);
assert.deepEqual(reviewed.details.lyricSheet, { text: revised.lyrics, mode: 'preserve' });
report.exactWordingSaved = true; report.songConfirmed = false;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
