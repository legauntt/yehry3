import { qualityNotice } from '/assets/quality.js';
const region = document.querySelector('#recordings');
const status = document.querySelector('#status');
const motionButton = document.querySelector('#motion');
const allButton = document.querySelector('#play-all');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let motion = !reduced.matches;
let album = false;
let activeAudio = null;
let rows = [];
const visible = new Set();
const safe = (value) => {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin && url.protocol !== 'https:') throw new Error('Unsupported media address');
  return url.href;
};
function updateMotion() {
  motionButton.setAttribute('aria-pressed', String(motion));
  motionButton.textContent = motion ? 'Pause artwork' : 'Animate artwork';
  for (const {video, item} of rows) {
    if (motion && visible.has(video) && !document.hidden) {
      if (!video.src) video.src = safe(item.video);
      void video.play().catch(() => {});
    } else video.pause();
  }
}
motionButton.addEventListener('click', () => { motion = !motion; updateMotion(); });
reduced.addEventListener('change', () => { motion = !reduced.matches; updateMotion(); });
document.addEventListener('visibilitychange', updateMotion);
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
  updateMotion();
}, {threshold: .15});
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function startTrack({audio, item}) {
  activeAudio = audio;
  // play() cannot retry a failed media request until load() clears the error.
  if (audio.error) audio.load();
  audio.currentTime = 0;
  status.textContent = `Loading ${item.title}…`;
  void audio.play().catch(() => {
    album = false;
    status.textContent = `${item.title} could not start. Press “Play the EP” to retry or use its MP3 link.`;
  });
}
function render(item, index) {
  const article = element('article', 'record');
  const heading = element('div', 'record-heading');
  const title = element('h2', '', item.title);
  title.id = item.id;
  article.setAttribute('aria-labelledby', item.id);
  const seconds = Math.round(item.duration);
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  heading.append(element('span', 'number', String(index + 1).padStart(2, '0')), title, element('span', 'genre', `${duration} · ${item.genre}`));
  const sleeve = element('div', 'sleeve');
  const video = element('video');
  video.poster = safe(item.poster); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'none';
  video.setAttribute('aria-label', item.artDescription);
  sleeve.append(video);
  const lower = element('div', 'under-sleeve');
  const transport = element('div', 'transport');
  const audio = element('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = safe(item.audio);
  audio.setAttribute('aria-label', `Listen to ${item.title}`);
  const links = element('div', 'links');
  const mp3 = element('a', '', 'MP3'); mp3.href = safe(item.audio);
  const collection = element('a', '', 'In the collection ↗');
  collection.href = '/?q=' + encodeURIComponent(item.title); collection.dataset.shell = 'off';
  links.append(mp3, collection); transport.append(audio, links);
  lower.append(element('p', 'description', item.description), transport);
  const review = element('div', 'production-notes');
  review.innerHTML = qualityNotice(item.qualityIssues, item.reviewState, item.validationFailures);
  article.append(heading, sleeve, lower, review); region.append(article);
  audio.addEventListener('play', () => {
    activeAudio = audio;
    for (const other of rows) {
      if (other.audio !== audio) other.audio.pause();
      other.article.classList.toggle('playing', other.audio === audio);
    }
    status.textContent = `Loading ${item.title}…`;
  });
  audio.addEventListener('playing', () => { status.textContent = `Playing ${item.title}`; });
  audio.addEventListener('pause', () => {
    article.classList.remove('playing');
    if (!rows.some(row => !row.audio.paused)) status.textContent = 'Paused. Pick up where you left off.';
  });
  audio.addEventListener('ended', () => {
    if (album && rows[index + 1]) {
      startTrack(rows[index + 1]);
    } else { album = false; status.textContent = 'The last note has landed.'; }
  });
  audio.addEventListener('error', () => {
    // An idle track's metadata request must not interrupt the current recording.
    if (audio !== activeAudio) return;
    album = false;
    status.textContent = `${item.title} could not load. Press “Play the EP” to retry or use its MP3 link.`;
  });
  rows.push({item, video, audio, article}); observer.observe(video);
}
allButton.addEventListener('click', () => {
  album = true;
  startTrack(rows[0]);
});
try {
  const response = await fetch('/saxophone/tracks.json');
  if (!response.ok) throw new Error('Track list unavailable');
  const data = await response.json();
  if (!Array.isArray(data.tracks) || data.tracks.length !== 3) throw new Error('Incomplete EP');
  data.tracks.forEach(render); allButton.disabled = false;
  status.textContent = 'Three tracks. Choose a starting point.'; updateMotion();
} catch {
  status.textContent = 'The EP could not load. Refresh this page or visit the collection.';
}
