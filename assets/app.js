import { api, login, logout, signedIn, storage } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const main = $("#main");
const page = document.body.dataset.page;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const labels = {
  draft: "Your idea",
  review: "Ready to confirm",
  queued: "In the queue",
  processing: "In the studio",
  completed: "Ready to publish",
  published: "Published",
  failed: "Needs attention",
  canceled: "Canceled",
  cancel_requested: "Cancellation requested",
};
const date = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const badge = (status) =>
  `<span class="badge ${escape(status)}">${escape(labels[status] || status)}</span>`;
const duration = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const message = (text, error = false) => {
  const region = $("#message");
  region.textContent = text;
  region.classList.toggle("error", error);
};
function busy(button, value) {
  button.disabled = value;
  button.setAttribute("aria-busy", String(value));
}
function focusHeading() {
  const heading = $("h1", main);
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
function safeUrl(value) {
  try {
    const url = new URL(value, location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}
document
  .querySelector(`[data-nav="${page}"]`)
  ?.setAttribute("aria-current", "page");

async function library() {
  main.innerHTML = `
    <section class="hero">
      <div><p class="eyebrow">Tony C · The listening room</p><h1>Same voice.<br><em>Wildly different</em><br>directions.</h1>
        <p class="lede">A growing collection of originals, remixes, and beautiful wrong turns. Find your favorite. Give it a vote. Dream up the next one.</p>
        <div class="actions"><button class="primary" id="play-all">Play the collection <span aria-hidden="true">↗</span></button><a class="text-link" href="/distonyc/">Make a request <span aria-hidden="true">→</span></a></div>
      </div>
      <div class="sleeve" aria-label="Tony C record sleeve"><div class="sleeve-top"><span>YEHRY3 RECORDS</span><span>VOL. 01</span></div><div class="record"><div class="record-label"><span>TONY C</span><small>& THE POSSIBILITIES</small><i></i><span class="label-bottom">PLAY IT LOUD</span></div></div><div class="sleeve-bottom"><span>FAMILIAR VOICE.<br>UNFAMILIAR TERRITORY.</span><span class="stamp">Give it<br>a spin.</span></div></div>
    </section>
    <section class="collection" aria-labelledby="collection-title">
      <div class="section-heading"><div><p class="eyebrow">The catalog</p><h2 id="collection-title">Pick your next obsession.</h2></div><p class="small" id="track-count">Loading songs…</p></div>
      <div class="toolbar"><label class="search"><span class="sr-only">Search songs</span><input type="search" id="search" placeholder="Search songs or styles…"></label><label class="sr-only" for="collection-filter">Collection</label><select id="collection-filter"><option value="all">All collections</option><option value="tonyai">Tony AI</option><option value="fearhunger">Fear & Hunger</option></select><label class="sr-only" for="sort">Sort songs</label><select id="sort"><option value="catalog">Latest additions</option><option value="votes">Most loved</option><option value="title">A to Z</option></select><button class="quiet" id="shuffle">Shuffle ↝</button></div>
      <p class="small vote-note" id="vote-note">One anonymous vote per hour across the collection.</p><div id="tracks" class="tracks"><p class="empty">Getting the records out…</p></div>
    </section>
    <section class="request-banner"><p class="eyebrow">Distonyc</p><h2>Heard something<br>in your head?</h2><p>Medusa as a barbershop quartet? An old favorite in a new universe? Put it on the wish list.</p><a class="primary" href="/distonyc/">Pitch the next song <span aria-hidden="true">↗</span></a></section>
    <aside class="player" aria-label="Music player" hidden><div class="now-playing"><span class="eyebrow">On the turntable</span><strong id="now-title"></strong></div><button id="previous" class="quiet" aria-label="Previous song">←</button><audio id="audio" controls preload="none"></audio><button id="next" class="quiet" aria-label="Next song">→</button><a id="download" class="text-link" target="_blank" rel="noopener">MP3 ↗</a></aside>`;
  let songs = [],
    visible = [],
    queue = [],
    current = null,
    nextVoteAt = null,
    online = false,
    voting = false;
  const audio = $("#audio");
  function render() {
    const query = $("#search").value.toLowerCase();
    const collection = $("#collection-filter").value;
    visible = songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) &&
        (collection === "all" || song.collection === collection),
    );
    if ($("#sort").value === "votes")
      visible.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    if ($("#sort").value === "title")
      visible.sort((a, b) => a.title.localeCompare(b.title));
    $("#track-count").textContent =
      `${visible.length} songs · Many possible directions`;
    $("#tracks").innerHTML = visible.length
      ? visible
          .map(
            (
              song,
              index,
            ) => `<article class="track ${current?.id === song.id ? "playing" : ""}" data-id="${escape(song.id)}">
      <span class="track-number">${String(index + 1).padStart(2, "0")}</span><button class="play-song" data-play="${escape(song.id)}" aria-label="Play ${escape(song.title)}">▶</button><div class="track-info"><h3>${escape(song.title)}</h3><p>${song.collection === "fearhunger" ? "Fear & Hunger" : "Tony AI"} <span>·</span> ${duration(song.duration)}</p></div><button class="vote" data-vote="${escape(song.id)}" aria-label="Vote for ${escape(song.title)}"><span aria-hidden="true">♡</span> <span>${online ? song.votes || 0 : "—"}</span></button></article>`,
          )
          .join("")
      : '<p class="empty">No songs match. Try another title or style.</p>';
    cooldown();
  }
  function cooldown() {
    const left = Math.max(0, new Date(nextVoteAt || 0) - Date.now());
    $("#vote-note").textContent = !online
      ? "Listening is available. Voting is temporarily offline."
      : left
        ? `Thanks for the love. Your next vote is available in ${Math.ceil(left / 60000)} min.`
        : "One anonymous vote per hour across the collection. Shared networks share the limit.";
    document.querySelectorAll("[data-vote]").forEach((button) => {
      button.disabled = !online || Boolean(left) || voting;
    });
  }
  async function play(song, newQueue) {
    if (!song) return;
    if (newQueue) queue = [...newQueue];
    current = song;
    $(".player").hidden = false;
    $("#now-title").textContent = song.title;
    $("#download").href = safeUrl(song.url);
    audio.src = safeUrl(song.url);
    render();
    try {
      await audio.play();
    } catch {
      message("Press play in the player to start this song.");
    }
  }
  function next(offset) {
    const index = queue.findIndex((song) => song.id === current?.id) + offset;
    if (index >= 0 && index < queue.length) play(queue[index]);
  }
  $("#tracks").addEventListener("click", async (event) => {
    const playButton = event.target.closest("[data-play]");
    if (playButton)
      return play(
        songs.find((song) => song.id === playButton.dataset.play),
        visible,
      );
    const voteButton = event.target.closest("[data-vote]");
    if (!voteButton || voting) return;
    voting = true;
    cooldown();
    const id = voteButton.dataset.vote;
    // Keep a request ID until a definitive response, including network retries.
    const key = `vote-request:${id}`;
    const requestId = storage.get(key) || crypto.randomUUID();
    storage.set(key, requestId);
    try {
      const result = await api("/votes", {
        method: "POST",
        body: { songId: id, requestId },
      });
      nextVoteAt = result.nextVoteAt;
      storage.remove(key);
      message("Vote counted. Good taste.");
      await refresh();
    } catch (error) {
      if (error.retryAt) nextVoteAt = error.retryAt;
      if (error.status) storage.remove(key);
      message(
        error.retryAt
          ? `Your next vote is available ${date(error.retryAt)}.`
          : error.message,
        true,
      );
    } finally {
      voting = false;
      cooldown();
    }
  });
  async function refresh() {
    try {
      const data = await api("/songs");
      if (!data.songs?.length)
        throw new Error("The catalog is being connected.");
      songs = data.songs;
      nextVoteAt = data.nextVoteAt;
      online = true;
    } catch {
      online = false;
    }
    render();
  }
  for (const id of ["search", "collection-filter", "sort"])
    $(`#${id}`).addEventListener("input", render);
  $("#play-all").onclick = () => play(visible[0], visible);
  $("#shuffle").onclick = () => {
    const shuffled = [...visible];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    play(shuffled[0], shuffled);
  };
  $("#previous").onclick = () => next(-1);
  $("#next").onclick = () => next(1);
  audio.onended = () => next(1);
  audio.onerror = () =>
    message(
      "This track could not load. Try another song or open its MP3 link.",
      true,
    );
  try {
    songs = (await (await fetch("/catalog.json")).json()).songs;
  } catch {
    message("The catalog could not load. Refresh to try again.", true);
  }
  render();
  await refresh();
  setInterval(cooldown, 15000);
  setInterval(refresh, 60000);
}

function loginView(role, onSuccess) {
  const admin = role === "admin";
  main.innerHTML = `<section class="form-layout"><div><p class="eyebrow">${admin ? "Backstage" : "Distonyc"}</p><h1>${admin ? "Run the<br><em>request line.</em>" : "A little idea.<br><em>A whole new song.</em>"}</h1><p class="lede">${admin ? "Review the requests, shape the queue, and keep the music moving." : "Tell us what you’re hearing. We’ll fine-tune the idea together before it joins the queue."}</p><p class="margin-note">${admin ? "Admin access" : "01 / The idea<br>02 / The direction<br>03 / The final say"}</p></div><div class="form-card"><span class="tiny-label">${admin ? "AUTHORIZED PERSONNEL" : "IF YOU KNOW, YOU KNOW"}</span><h2>${admin ? "Welcome backstage." : "Come on in."}</h2><p>${admin ? "Use your separate admin password." : "Never tell anyone your password"}</p><form id="login-form"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200"><button class="primary" type="submit">${admin ? "Open the queue" : "Let’s make something"} <span aria-hidden="true">→</span></button><p id="form-error" class="field-error" role="alert"></p></form></div></section>`;
  $("#login-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("button", event.target);
    busy(button, true);
    $("#form-error").textContent = "";
    try {
      await login(role, $("#password").value);
      $("#password").value = "";
      await onSuccess();
    } catch (error) {
      $("#form-error").textContent = error.message;
    } finally {
      busy(button, false);
    }
  };
}

async function requests() {
  let draft = null;
  async function load() {
    const id = storage.get("draft");
    if (id) {
      try {
        draft = (
          await api(`/prompts/${encodeURIComponent(id)}`, { role: "submitter" })
        ).prompt;
      } catch (error) {
        if (error.status === 401) return loginView("submitter", load);
        if (error.status === 404) {
          storage.remove("draft");
          draft = null;
        } else {
          message(error.message, true);
          if (!draft) {
            main.innerHTML =
              '<section class="empty"><h1>Your request is still saved.</h1><p>We couldn’t load its latest status. Try again when the studio reconnects.</p><button class="primary" id="retry-request">Try again</button></section>';
            $("#retry-request").onclick = load;
          } else render();
          return;
        }
      }
    }
    render();
  }
  function render(mode) {
    const stage =
      mode ||
      (draft?.confirmedAt
        ? "submitted"
        : draft?.status === "review"
          ? "review"
          : draft
            ? "details"
            : "idea");
    const number = { idea: 1, details: 2, review: 3, submitted: 3 }[stage];
    main.innerHTML = `<section class="request-intro"><p class="eyebrow">Distonyc</p><h1>Let’s hear<br><em>your wild idea.</em></h1><p class="lede">A familiar song in unfamiliar territory. Or something nobody’s heard before.</p></section><section class="workbench"><ol class="steps" aria-label="Request progress">${["The idea", "The direction", "The final say"].map((name, i) => `<li ${i + 1 === number ? 'aria-current="step"' : ""}><span>0${i + 1}</span>${name}</li>`).join("")}</ol><div class="request-form" id="request-form"></div></section>`;
    const form = $("#request-form");
    if (stage === "idea") {
      form.innerHTML = `<p class="eyebrow">Turn 01 · What if…</p><h2>What should we make?</h2><p>Pick a song and take it somewhere unexpected, or pitch an original.</p><form id="idea-form"><label for="idea">Your prompt</label><textarea id="idea" rows="5" minlength="10" maxlength="2000" required placeholder="Rendition of Medusa as a barbershop quartet"></textarea><p class="small">A sentence or two is plenty to get started.</p><button class="primary">Find the direction <span aria-hidden="true">→</span></button><p class="field-error" role="alert"></p></form>`;
      $("#idea").value = storage.get("idea-text") || "";
      $("#idea").oninput = (event) => {
        storage.set("idea-text", event.target.value);
        storage.remove("prompt-request");
      };
      $("#idea-form").onsubmit = (event) =>
        run(event, async () => {
          const requestId =
            storage.get("prompt-request") || crypto.randomUUID();
          storage.set("prompt-request", requestId);
          draft = (
            await api("/prompts", {
              method: "POST",
              role: "submitter",
              body: { prompt: $("#idea").value, requestId },
            })
          ).prompt;
          storage.set("draft", draft.id);
          storage.remove("prompt-request");
          render();
        });
    } else if (stage === "details") {
      form.innerHTML = `<p class="eyebrow">Turn 02 · Let’s get specific</p><h2>Here’s what I’m hearing.</h2><blockquote>${escape(draft.prompt)}</blockquote><p>Before this goes to the studio, tell us what should change and what should stay.</p><form id="details-form"><label for="source">Which song are we starting with?</label><input id="source" maxlength="200" required placeholder="Medusa — or “original song”"><label for="direction">What should the new version sound like?</label><textarea id="direction" rows="3" minlength="10" maxlength="2000" required placeholder="Four close vocal harmonies, playful barbershop, no instruments…"></textarea><label for="keep">What should we keep?</label><textarea id="keep" rows="2" maxlength="1000" required placeholder="The melody and lyrics, especially the main hook. Or: surprise me."></textarea><div class="actions"><button class="primary">Review the request <span aria-hidden="true">→</span></button><button class="quiet" type="button" id="start-over">Change the idea</button></div><p class="field-error" role="alert"></p></form>`;
      for (const key of ["source", "direction", "keep"])
        $(`#${key}`).value = draft.details?.[key] || "";
      $("#start-over").onclick = () => {
        storage.set("idea-text", draft.prompt);
        draft = null;
        storage.remove("draft");
        render();
      };
      $("#details-form").onsubmit = (event) =>
        run(event, async () => {
          const details = Object.fromEntries(
            ["source", "direction", "keep"].map((key) => [
              key,
              $(`#${key}`).value,
            ]),
          );
          draft = (
            await api(`/prompts/${encodeURIComponent(draft.id)}`, {
              method: "PATCH",
              role: "submitter",
              body: { version: draft.version, ...details },
            })
          ).prompt;
          render();
        });
    } else if (stage === "review") {
      form.innerHTML = `<p class="eyebrow">One last check</p><h2>Does this sound right?</h2><p>This is the brief that will go into the studio queue.</p>${brief(draft)}<form id="confirm-form"><label class="checkbox"><input type="checkbox" id="confirm" required><span>Yes, this is the song I want to request.</span></label><div class="actions"><button class="primary">Send to the queue <span aria-hidden="true">↗</span></button><button class="quiet" type="button" id="edit">Fine-tune it</button></div><p class="small">Up to three confirmed requests per hour. Timing depends on the studio queue.</p><p class="field-error" role="alert"></p></form>`;
      $("#edit").onclick = () => render("details");
      $("#confirm-form").onsubmit = (event) =>
        run(event, async () => {
          draft = (
            await api(`/prompts/${encodeURIComponent(draft.id)}/confirm`, {
              method: "POST",
              role: "submitter",
              body: {
                version: draft.version,
                confirmed: $("#confirm").checked,
              },
            })
          ).prompt;
          storage.remove("idea-text");
          render();
        });
    } else {
      form.innerHTML = `<span class="success-mark" aria-hidden="true">✓</span><p class="eyebrow">Request received</p><h2>Your idea is on the list.</h2><p>Your idea has a place in the studio queue. Check back here for its progress.</p>${badge(draft.status)}${brief(draft)}${draft.publishedUrl ? `<a class="primary" href="${escape(safeUrl(draft.publishedUrl))}" target="_blank" rel="noopener">Hear your song ↗</a>` : ""}<div class="actions"><button class="quiet" id="refresh-status">Refresh status</button><button class="primary" id="another">Another idea ↗</button></div><p class="small">This browser tab remembers your request. Keep it open to check back.</p>`;
      $("#another").onclick = () => {
        draft = null;
        storage.remove("draft");
        render();
      };
      $("#refresh-status").onclick = async (event) => {
        busy(event.target, true);
        await load();
      };
    }
    focusHeading();
  }
  async function run(event, action) {
    event.preventDefault();
    const button = $('button[type="submit"], button:not([type])', event.target);
    busy(button, true);
    try {
      await action();
      message("");
    } catch (error) {
      if (error.status === 401) return loginView("submitter", load);
      if (error.status === 409) {
        await load();
        message(error.message, true);
      } else {
        const target = $(".field-error", event.target);
        if (target)
          target.textContent = error.retryAt
            ? `${error.message} Try again ${date(error.retryAt)}.`
            : error.message;
      }
    } finally {
      busy(button, false);
    }
  }
  if (!signedIn("submitter")) loginView("submitter", load);
  else await load();
}
function brief(doc) {
  return `<dl class="brief"><dt>The idea</dt><dd>${escape(doc.prompt)}</dd><dt>Starting point</dt><dd>${escape(doc.details?.source)}</dd><dt>The direction</dt><dd>${escape(doc.details?.direction)}</dd><dt>Keep the good stuff</dt><dd>${escape(doc.details?.keep)}</dd></dl>`;
}

async function admin() {
  let data = null,
    filter = "queued",
    pageNumber = 0,
    loadSequence = 0;
  async function load() {
    const sequence = ++loadSequence;
    try {
      const response = await api(
        `/admin/prompts?status=${filter}&page=${pageNumber}`,
        { role: "admin" },
      );
      if (sequence !== loadSequence) return;
      data = response;
      render();
    } catch (error) {
      if (sequence !== loadSequence) return;
      if (error.status === 401) return loginView("admin", load);
      message(error.message, true);
      if (!data)
        main.innerHTML =
          '<section class="empty"><h1>The queue couldn’t load.</h1><button class="primary" id="retry-admin">Try again</button></section>';
      $("#retry-admin")?.addEventListener("click", load);
    }
  }
  function render() {
    main.innerHTML = `<section class="admin-intro"><div><p class="eyebrow">Backstage · Studio queue</p><h1>Make room for<br><em>the next one.</em></h1></div><button class="quiet" id="signout">Sign out ↗</button></section><div class="stats">${[
      ["queued", "Waiting in line"],
      ["processing", "In the studio"],
      ["completed", "Ready to publish"],
      ["published", "Out in the world"],
    ]
      .map(
        ([status, label]) =>
          `<div><strong>${data.counts[status] || 0}</strong><span>${label}</span></div>`,
      )
      .join(
        "",
      )}</div><section class="admin-queue"><div class="toolbar"><label for="status-filter">Show</label><select id="status-filter"><option value="all">All requests</option>${Object.entries(
      labels,
    )
      .filter(([key]) => !["draft", "review"].includes(key))
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join(
        "",
      )}</select><button class="quiet" id="refresh">Refresh ↻</button><span class="small">${data.total} requests · Higher priority goes first; oldest wins ties.</span></div><div id="queue">${data.prompts.length ? data.prompts.map(row).join("") : '<div class="empty"><span class="empty-symbol">◎</span><h2>A little room for possibility.</h2><p>No requests in this view yet.</p><a class="text-link" href="/distonyc/">Make the first request →</a></div>'}</div><div class="pagination"><button class="quiet" id="prev-page" ${pageNumber === 0 ? "disabled" : ""}>← Previous</button><span>Page ${pageNumber + 1}</span><button class="quiet" id="next-page" ${(pageNumber + 1) * 50 >= data.total ? "disabled" : ""}>Next →</button></div></section>`;
    $("#status-filter").value = filter;
    $("#status-filter").onchange = (event) => {
      filter = event.target.value;
      pageNumber = 0;
      load();
    };
    $("#refresh").onclick = load;
    $("#signout").onclick = () => {
      logout("admin");
      data = null;
      loginView("admin", load);
    };
    $("#prev-page").onclick = () => {
      pageNumber--;
      load();
    };
    $("#next-page").onclick = () => {
      pageNumber++;
      load();
    };
    $("#queue").addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = event.target.closest("[data-prompt]");
      const doc = data.prompts.find((item) => item.id === card.dataset.prompt);
      const kind = event.target.dataset.action;
      const body = { action: kind, version: doc.version };
      if (kind === "priority")
        body.priority = Number($('[name="priority"]', event.target).value);
      if (kind === "note") body.note = $('[name="note"]', event.target).value;
      if (kind === "status") {
        body.status = $('[name="status"]', event.target).value;
        if (body.status === "published")
          body.publishedUrl = $('[name="publishedUrl"]', event.target).value;
        if (
          ["canceled", "cancel_requested"].includes(body.status) &&
          !window.confirm(
            body.status === "cancel_requested"
              ? "Request cancellation? A running job must acknowledge it before stopping."
              : "Cancel this queued request?",
          )
        )
          return;
      }
      const button = $("button", event.target);
      busy(button, true);
      try {
        await api(`/admin/prompts/${encodeURIComponent(doc.id)}`, {
          method: "PATCH",
          role: "admin",
          body,
        });
        message("Queue updated.");
        await load();
      } catch (error) {
        if (error.status === 401) {
          data = null;
          loginView("admin", load);
        } else {
          message(error.message, true);
          if (error.status === 409) await load();
        }
      } finally {
        busy(button, false);
      }
    });
    document.querySelectorAll('[name="status"]').forEach(
      (select) =>
        (select.onchange = () => {
          const field = $(".publish-field", select.closest("form"));
          field.hidden = select.value !== "published";
          $("input", field).required = !field.hidden;
        }),
    );
  }
  function row(doc) {
    const id = escape(doc.id);
    return `<article class="queue-card" data-prompt="${id}"><div class="queue-heading"><div>${badge(doc.status)}<h2>${escape(doc.prompt)}</h2><p class="small">Received ${date(doc.confirmedAt)} · Priority ${doc.priority}</p></div>${doc.status === "queued" ? `<form data-action="priority" class="priority-form"><label for="priority-${id}">Priority</label><div><input id="priority-${id}" name="priority" type="number" min="-10000" max="10000" step="1" value="${doc.priority}" required><button class="quiet">Set</button></div></form>` : ""}</div><details><summary>Open brief & controls <span aria-hidden="true">＋</span></summary>${brief(doc)}<form data-action="note"><label for="note-${id}">Private admin note</label><textarea id="note-${id}" name="note" rows="2" maxlength="2000">${escape(doc.adminNote || "")}</textarea><button class="quiet">Save note</button></form>${data.transitions[doc.status]?.length ? `<form data-action="status" class="status-form"><label for="status-${id}">Move request to</label><select id="status-${id}" name="status" required><option value="" disabled selected>Choose a status</option>${data.transitions[doc.status].map((status) => `<option value="${status}">${labels[status]}</option>`).join("")}</select><label class="publish-field" hidden>Published song URL<input name="publishedUrl" type="url" placeholder="https://yehry3.app/…"></label><button class="primary">Update status</button></form>` : ""}${doc.publishedUrl ? `<p><a href="${escape(safeUrl(doc.publishedUrl))}" target="_blank" rel="noopener">Open published song ↗</a></p>` : ""}<h3 class="history-title">Activity</h3><ol class="history">${[
      ...(doc.history || []),
    ]
      .reverse()
      .map(
        (entry) =>
          `<li><time>${date(entry.at)}</time><span>${escape(entry.actor)} · ${escape(entry.action)}${entry.status ? ` → ${escape(labels[entry.status] || entry.status)}` : ""}${entry.priority !== undefined ? ` → ${entry.priority}` : ""}</span></li>`,
      )
      .join("")}</ol></details></article>`;
  }
  if (!signedIn("admin")) loginView("admin", load);
  else await load();
}

try {
  if (page === "requests") await requests();
  else if (page === "admin") await admin();
  else await library();
} catch (error) {
  message(error.message, true);
}
