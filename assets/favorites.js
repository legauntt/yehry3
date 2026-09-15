import { api } from "./api.js";

const key = "yehry3:profile";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const validId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value || "");
function remembered() {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

// Only the selected profile ID lives in the browser. Favorites always come from the server.
export function mountFavorites(container, { onChange = () => {}, filter = false } = {}) {
  if (!document.querySelector('link[href="/assets/favorites.css"]')) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/assets/favorites.css";
    document.head.append(css);
  }
  container.classList.add("favorites-panel");
  container.innerHTML = `<div class="profile-controls">
    <label for="listener-profile">Listener profile</label>
    <select id="listener-profile" aria-describedby="profile-help"><option value="">Choose a profile…</option></select>
    <button type="button" class="quiet" id="more-profiles" hidden>More profiles</button>
    <details class="new-profile"><summary>New profile</summary><form id="profile-form">
      <label for="profile-name">Profile name</label><input id="profile-name" name="name" maxlength="60" required autocomplete="nickname" placeholder="Name or nickname">
      <button class="quiet" type="submit">Create profile</button>
    </form></details>
    ${filter ? '<button type="button" class="quiet" id="saved-only" aria-pressed="false">Saved songs (0)</button>' : ""}
    <a class="text-link" id="profile-link" hidden>Saved collection ↗</a>
  </div>
  <p class="small" id="profile-help">Profiles are shared. Anyone can open or edit their saved songs. Choose the same name on another device.</p>
  <p class="small profile-status" id="profile-status" role="status" aria-live="polite"></p>
  <button type="button" class="quiet" id="retry-profiles" hidden>Retry profiles</button>`;
  const $ = (selector) => container.querySelector(selector);
  const picker = $("#listener-profile"), status = $("#profile-status");
  let profiles = new Map(), profile = null, selectedId = "", generation = 0;
  let readVersion = 0;
  let loading = false, available = false, saving = null, creating = false, listing = false;
  let listPage = 0, hasMore = false, listError = false, profileError = false;
  let onlySaved = filter && new URLSearchParams(location.search).get("saved") === "1";

  function writeSelection() {
    try {
      if (selectedId) localStorage.setItem(key, selectedId);
      else localStorage.removeItem(key);
      return true;
    } catch { return false; }
  }
  function share(replace = false) {
    if (!filter) return;
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set("profile", selectedId);
    else url.searchParams.delete("profile");
    if (onlySaved) url.searchParams.set("saved", "1");
    else url.searchParams.delete("saved");
    if (url.href !== location.href) {
      url.searchParams.delete("page");
      history[replace ? "replaceState" : "pushState"](null, "", url);
    }
  }
  function sync(notify = true) {
    const entries = [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (selectedId && !profiles.has(selectedId)) entries.push({ id: selectedId, name: "Selected profile…" });
    const options = '<option value="">Choose a profile…</option>' + entries.map((item) =>
      `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
    if (picker.innerHTML !== options) picker.innerHTML = options;
    picker.value = selectedId;
    $("#more-profiles").hidden = !hasMore;
    $("#more-profiles").disabled = listing;
    $("#profile-form button").disabled = creating;
    $("#retry-profiles").hidden = !listError && !profileError;
    if (filter) {
      $("#saved-only").textContent = `Saved songs (${profile?.songIds.length ?? 0})`;
      $("#saved-only").setAttribute("aria-pressed", String(onlySaved));
    }
    const link = $("#profile-link");
    link.hidden = !profile;
    if (profile) link.href = `/?profile=${encodeURIComponent(profile.id)}&saved=1#collection-title`;
    document.querySelectorAll("[data-save]").forEach(updateButton);
    if (notify) onChange();
  }
  function updateButton(button) {
    const saved = Boolean(profile?.songIds.includes(button.dataset.save));
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", `${saved ? "Unsave" : "Save"} ${button.dataset.songTitle}`);
    button.textContent = `${saved ? "★ Saved" : "☆ Save"}`;
    button.disabled = Boolean(selectedId && (loading || !available || saving));
    button.title = !selectedId ? "Choose a shared profile to save songs" : !available ? "Reconnect to save changes" : `${saved ? "Remove from" : "Save to"} ${profile?.name || "profile"}`;
  }
  function accept(next) {
    if (profile && next.revision < profile.revision) return;
    profile = next;
    profiles.set(next.id, { id: next.id, name: next.name });
  }
  async function refreshList(more = false) {
    if (listing) return;
    listing = true;
    sync(false);
    try {
      const data = await api(`/profiles?page=${more ? listPage + 1 : 0}`);
      for (const item of data.profiles) profiles.set(item.id, item);
      listPage = data.page;
      hasMore = data.hasMore;
      listError = false;
    } catch {
      listError = true;
      if (!profile) status.textContent = "Profiles are temporarily unavailable. Listening is still available.";
    } finally {
      listing = false;
      sync(false);
    }
  }
  async function refreshProfile() {
    if (!selectedId || saving) return;
    const id = selectedId, epoch = generation, version = readVersion;
    try {
      const { profile: next } = await api(`/profiles/${encodeURIComponent(id)}`);
      if (epoch !== generation || version !== readVersion) return;
      accept(next);
      available = true;
      profileError = false;
      status.textContent = `Saved to ${profile.name} · Synced across devices.`;
    } catch (error) {
      if (epoch !== generation || version !== readVersion) return;
      available = false;
      profileError = true;
      status.textContent = error.status === 404 ? error.message : "Couldn’t sync this profile. Saved songs shown may be out of date. Retry when connected.";
    } finally {
      if (epoch === generation && version === readVersion) { loading = false; sync(); }
    }
  }
  async function choose(id, { updateUrl = true, remember = true, snapshot } = {}) {
    generation++;
    selectedId = validId(id) ? id : "";
    profile = null;
    saving = null;
    profileError = false;
    loading = Boolean(selectedId);
    available = false;
    if (!selectedId && updateUrl) onlySaved = false;
    const persisted = !remember || writeSelection();
    if (updateUrl) share();
    status.textContent = selectedId ? "Opening saved songs…" : "Choose or create a profile to start saving songs.";
    if (snapshot && snapshot.id === selectedId) {
      accept(snapshot);
      available = true;
      loading = false;
      status.textContent = `Saved to ${profile.name} · Synced across devices.`;
    }
    sync();
    if (!snapshot) await refreshProfile();
    if (!persisted && profile) status.textContent += " This browser can’t remember your selection; use the saved collection link next time.";
  }
  picker.addEventListener("change", () => { void choose(picker.value); });
  $("#more-profiles").addEventListener("click", () => { void refreshList(true); });
  $("#retry-profiles").addEventListener("click", () => { void refreshList(); void refreshProfile(); });
  $("#saved-only")?.addEventListener("click", () => {
    onlySaved = !onlySaved;
    share();
    sync();
    if (onlySaved && !selectedId) picker.focus();
  });
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (creating) return;
    creating = true;
    const epoch = generation;
    status.textContent = "Opening profile…";
    sync(false);
    try {
      const { profile: next } = await api("/profiles", { method: "POST", body: { name: $("#profile-name").value } });
      profiles.set(next.id, { id: next.id, name: next.name });
      if (epoch !== generation) return;
      $("#profile-name").value = "";
      $(".new-profile").open = false;
      await choose(next.id, { snapshot: next });
      picker.focus();
    } catch (error) {
      if (epoch === generation) status.textContent = error.message;
    } finally { creating = false; sync(false); }
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save]");
    if (!button || button.disabled) return;
    if (!profile) {
      status.textContent = "Choose or create a profile above, then save this song.";
      container.scrollIntoView({ block: "center", behavior: "instant" });
      if (!profiles.size) { $(".new-profile").open = true; $("#profile-name").focus(); }
      else picker.focus();
      return;
    }
    if (saving) return;
    const id = selectedId, epoch = generation, songId = button.dataset.save;
    const saved = !profile.songIds.includes(songId);
    readVersion++;
    saving = { id, songId };
    sync(false);
    try {
      const { profile: next } = await api(`/profiles/${encodeURIComponent(id)}/favorites`, { method: "PATCH", body: { songId, saved } });
      if (epoch !== generation) return;
      accept(next);
      available = true;
      profileError = false;
      status.textContent = `${saved ? "Saved to" : "Removed from"} ${profile.name}.`;
    } catch (error) {
      if (epoch !== generation) return;
      profileError = true;
      status.textContent = `Couldn’t confirm that change. ${error.message} Retry profiles to check before trying again.`;
    } finally {
      if (epoch === generation) {
        saving = null;
        sync();
        const replacement = [...document.querySelectorAll("[data-save]")].find((item) => item.dataset.save === songId);
        (replacement || $("#saved-only") || picker).focus({ preventScroll: true });
      }
    }
  });
  window.addEventListener("popstate", () => {
    onlySaved = filter && new URLSearchParams(location.search).get("saved") === "1";
    void choose(new URLSearchParams(location.search).get("profile") || remembered(), { updateUrl: false });
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    const id = remembered();
    if (id !== selectedId) {
      void choose(id, { updateUrl: false, remember: false });
      share(true);
    }
  });
  const refresh = () => { void refreshList(); void refreshProfile(); };
  let timer;
  const startTimer = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("pagehide", () => clearInterval(timer));
  window.addEventListener("pageshow", (event) => { if (event.persisted) { startTimer(); refresh(); } });
  queueMicrotask(() => {
    void refreshList();
    const params = new URLSearchParams(location.search);
    void choose(params.get("profile") || remembered(), { updateUrl: false });
    startTimer();
  });
  return {
    get loading() { return loading; },
    get onlySaved() { return onlySaved; },
    includes: (song) => !onlySaved || Boolean(profile?.songIds.includes(song.id)),
    emptyMessage: () => !selectedId ? "Choose or create a profile to see its saved songs."
      : loading ? "Opening saved songs…" : !profile ? "Saved songs couldn’t load. Retry profiles above."
        : profile.songIds.length ? "No saved songs match these filters." : "No saved songs yet. Browse all songs and select ☆ Save on your favorites.",
    button(song) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "favorite-button";
      button.dataset.save = song.id;
      button.dataset.songTitle = song.title;
      updateButton(button);
      return button.outerHTML;
    },
    syncButtons() { document.querySelectorAll("[data-save]").forEach(updateButton); },
  };
}
