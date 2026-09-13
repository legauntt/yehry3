import { api, login, logout, signedIn } from './api.js';
import { mountGuide } from './deetz-guide.js';

const access = document.querySelector('#access');
const root = document.querySelector('#guide-root');
const toolbar = document.querySelector('#guide-toolbar');
const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const unlock = document.querySelector('#unlock-guide');
const errorMessage = document.querySelector('#access-error');
const status = document.querySelector('#access-status');
const retry = document.querySelector('#retry-guide');
let cleanup;
let expiration;
let generation = 0;

function clearGuide() {
  generation++;
  clearTimeout(expiration);
  cleanup?.();
  cleanup = undefined;
  root.replaceChildren();
  root.hidden = true;
  toolbar.hidden = true;
  access.hidden = false;
}

function lock(message = '') {
  clearGuide();
  logout('submitter');
  errorMessage.textContent = message;
  status.textContent = '';
  retry.hidden = true;
}

async function loadGuide() {
  const current = ++generation;
  status.textContent = 'Opening the guide…';
  errorMessage.textContent = '';
  retry.hidden = true;
  try {
    const content = await api('/deetz', { role:'submitter' });
    if (current !== generation) return;
    if (!Number.isFinite(content.sessionExpiresAt) || content.sessionExpiresAt <= Date.now()) {
      return lock('Your session expired. Please sign in again.');
    }
    cleanup?.();
    cleanup = mountGuide(root, content);
    root.hidden = false;
    toolbar.hidden = false;
    access.hidden = true;
    status.textContent = '';
    clearTimeout(expiration);
    expiration = setTimeout(() => lock('Your session expired. Please sign in again.'), content.sessionExpiresAt-Date.now());
    const anchor = location.hash ? root.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`) : null;
    anchor?.scrollIntoView();
  } catch (error) {
    if (current !== generation) return;
    if (error.status === 401) return lock(error.message);
    clearGuide();
    status.textContent = '';
    errorMessage.textContent = error.message;
    retry.hidden = !signedIn('submitter');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  unlock.disabled = true;
  errorMessage.textContent = '';
  status.textContent = 'Signing in…';
  try {
    await login('submitter', password.value);
    password.value = '';
    await loadGuide();
  } catch (error) {
    errorMessage.textContent = error.message;
    status.textContent = '';
  } finally {
    password.value = '';
    unlock.disabled = false;
  }
});
document.querySelector('#lock-guide').addEventListener('click', () => { lock(); password.focus(); });
retry.addEventListener('click', loadGuide);
window.addEventListener('pagehide', clearGuide);
window.addEventListener('pageshow', event => { if (event.persisted && signedIn('submitter')) loadGuide(); });
if (signedIn('submitter')) loadGuide();
