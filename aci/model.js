// Preview-only data and state. No API client, credentials, real queue, or audio URLs.
export const STORAGE_KEY = 'yehry3:aci-preview:v1';
export const STAGES = ['Dreaming up a prompt', 'Writing lyrics & a plan', 'Rendering the song', 'Checking the result', 'Releasing to ACI'];
export const AGENTS = [
  { id: 'pancakeo', name: 'Pancakeo', number: '01', count: 109, ideas: 96,
    description: 'A soft spot for small scenes, unlikely protagonists, and a chorus that gets a little carried away.',
    byline: 'The sentimental chaos department.',
    traits: ['Everyday absurdity', 'Big-hearted hooks', 'Genre detours'],
    rules: ['Start with a specific little scene, then let it grow.', 'Give the ridiculous premise an unexpectedly sincere heart.', 'Vary the musical setting; keep the central image memorable.'],
    titles: ['The Last Pancake at the End of the World', 'A Love Song for the Broken Kettle', 'The Moon Forgot Its Keys'],
    prompts: ['A warm, increasingly theatrical soul song about the cook at the last diner on Earth making one final pancake. The world is ending, but he still asks how you like your eggs. Let the chorus turn this tiny kindness into something enormous.', 'Write a bright chamber-pop ballad to a broken kettle. Each failed cup of tea brings back a different person who used to sit at the kitchen table. Give the kettle the last word.', 'A late-night country waltz about the moon locked out of its own apartment, borrowing a ladder from a tired neighbor. Make the tiny domestic details carry the affection.'],
  },
  { id: 'scythe', name: 'Scythe', number: '02', count: 76, ideas: 70,
    description: 'A fondness for sharp premises, theatrical escalation, and making an absurd idea sound suspiciously official.',
    byline: 'The ominous paperwork department.',
    traits: ['Deadpan satire', 'Grand declarations', 'Industrial detours'],
    rules: ['Choose one pointed premise and commit to its logic.', 'Let an overly serious narrator make the absurdity funnier.', 'Escalate through concrete details, with a hook built to repeat.'],
    titles: ['The Department of Almost', 'Mandatory Fun at the End of Time', 'Your Apocalypse Has Been Rescheduled'],
    prompts: ['An industrial disco anthem from the Department of Almost, where every great achievement is approved one signature too late. Deliver the bureaucratic announcements with absolute conviction. The chorus is a celebration of spectacular near-success.', 'A pompous corporate anthem announcing mandatory fun at the end of time. The band grows more triumphant as the instructions become impossible. Keep the narrator painfully sincere.', 'A dark cabaret song in the voice of a very apologetic administrator postponing the apocalypse. Every verse offers a more elaborate excuse; the chorus insists that your patience is appreciated.'],
  },
];
export const SAMPLE_RECORDS = [
  { id: 'sample-1', agent: 'pancakeo', title: 'The Last Pancake at the End of the World', style: 'Soul / a very sincere breakfast', art: 'sun', prompt: AGENTS[0].prompts[0], sample: true },
  { id: 'sample-2', agent: 'scythe', title: 'The Department of Almost', style: 'Industrial disco / official nonsense', art: 'moon', prompt: AGENTS[1].prompts[0], sample: true },
  { id: 'sample-3', agent: 'pancakeo', title: 'A Love Song for the Broken Kettle', style: 'Chamber pop / domestic devotion', art: 'paper', prompt: AGENTS[0].prompts[1], sample: true },
];
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
export function freshState() {
  return { day: today(), paused: false, daily: 1, budget: 5, time: '09:00', enabled: { pancakeo: true, scythe: true }, used: { pancakeo: 0, scythe: 0 }, jobs: [], records: [] };
}
const validAgent = id => AGENTS.some(agent => agent.id === id);
const bounded = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
export function restoreState(raw) {
  const state = freshState();
  if (!raw || typeof raw !== 'object') return state;
  state.paused = raw.paused === true;
  state.daily = bounded(raw.daily, 1, 4, 1);
  state.budget = bounded(raw.budget, 0, 25, 5);
  state.time = typeof raw.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : state.time;
  for (const { id } of AGENTS) {
    state.enabled[id] = raw.enabled?.[id] !== false;
    if (raw.day === state.day) state.used[id] = bounded(raw.used?.[id], 0, 4, 0);
  }
  const validRecord = r => r && validAgent(r.agent) && typeof r.id === 'string' && r.id.length <= 100 &&
    typeof r.title === 'string' && r.title.length <= 150 && typeof r.prompt === 'string' && r.prompt.length <= 2000;
  if (Array.isArray(raw.records)) state.records = raw.records.filter(validRecord).slice(0, 24).map(r => ({
    id: r.id, agent: r.agent, title: r.title, prompt: r.prompt, style: 'Demo release / no audio generated', art: r.agent === 'scythe' ? 'moon' : 'sun',
  }));
  if (raw.day === state.day && Array.isArray(raw.jobs)) {
    for (const job of raw.jobs.filter(validRecord)) {
      if (!state.jobs.some(item => item.agent === job.agent)) state.jobs.push({
        id: job.id, agent: job.agent, title: job.title, prompt: job.prompt, stage: bounded(job.stage, 0, STAGES.length - 1, 0),
      });
    }
  }
  return state;
}
export function runBlocker(state, id) {
  if (state.paused) return 'Resume the studio to try a run.';
  if (!state.budget) return 'Set a spending ceiling above $0 to try a run.';
  if (state.jobs.some(job => job.agent === id)) return 'This agent already has a demo in the queue.';
  if (state.used[id] >= state.daily) return 'Daily demo allowance reached.';
  return '';
}
export function queueDemo(state, id) {
  const agent = AGENTS.find(agent => agent.id === id);
  if (!agent || runBlocker(state, id)) return false;
  const index = (state.used[id] + state.records.filter(record => record.agent === id).length) % agent.titles.length;
  state.jobs.push({ id: crypto.randomUUID(), agent: id, title: agent.titles[index], prompt: agent.prompts[index], stage: 0 });
  state.used[id]++;
  return true;
}
export function advanceDemo(state) {
  if (state.paused || !state.jobs.length) return null;
  const job = state.jobs[0];
  if (++job.stage < STAGES.length) return null;
  state.jobs.shift();
  const record = { id: job.id, agent: job.agent, title: job.title, prompt: job.prompt, art: job.agent === 'scythe' ? 'moon' : 'sun', style: 'Demo release / no audio generated' };
  state.records = [record, ...state.records].slice(0, 24);
  return record;
}
