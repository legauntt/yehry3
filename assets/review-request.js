import { api } from './api.js';
import { savedAuthor, rememberAuthor } from './authored-by.js';
import { mountGenerationReview } from './generation.js';
import { main, escape } from './app-ui.js';

export async function reviewRequest(id) {
  main.innerHTML = `<section class="form-card"><h1>Review your request</h1><p>Use the name shown in the request’s author credit to edit and approve its lyrics or choose a composition.</p><form id="review-name-form"><label for="review-name">Author name</label><input id="review-name" autocomplete="nickname" maxlength="100" required><button class="primary">Open review</button><p class="field-error" role="alert"></p></form><div id="named-review"></div></section>`;
  const form = main.querySelector('#review-name-form'), field = main.querySelector('#review-name'), root = main.querySelector('#named-review');
  field.value = savedAuthor();
  async function load() {
    const username = field.value.trim();
    if (!username) return;
    const error = form.querySelector('[role="alert"]'), button = form.querySelector('button');
    button.disabled = true; error.textContent = ''; root.innerHTML = '';
    // Bind each review to the name used to open it, even while the field is being edited.
    const query = '?username=' + encodeURIComponent(username);
    const reviewApi = (path, options = {}) => {
      const { role, ...rest } = options;
      return api(path.replace(/^\/prompts\//, '/review-requests/') + query, rest);
    };
    try {
      const { prompt: draft } = await reviewApi('/prompts/' + encodeURIComponent(id));
      if (!root.isConnected) return;
      rememberAuthor(username);
      const approved = draft.generationReview?.state === 'approved';
      form.hidden = approved;
      main.querySelector('h1').textContent = approved ? 'Review complete' : 'Review your request';
      main.querySelector('.form-card > p').hidden = approved;
      root.innerHTML = `<h2>${escape(draft.prompt)}</h2>${approved ? '' : `<p>${escape(draft.workerProgress?.stage || draft.status)}</p>`}<div class="named-review-content"></div>`;
      await mountGenerationReview(root.querySelector('.named-review-content'), { draft, api: reviewApi, escape, reload: load, approvalOnly: true });
    } catch (failure) { error.textContent = failure.message; }
    finally { button.disabled = false; }
  }
  form.onsubmit = event => { event.preventDefault(); load(); };
  if (field.value.trim()) await load();
}
