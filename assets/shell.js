// Moving around without unloading. The pages that share the site header (the collection, lyric
// sheets, mixtapes, the queue, Backstage, Aud'tism, Timeline and the request form) change here by fetching the next page and
// swapping its contents in, so the audio element, the bottom player and the listening room's avatars
// carry on untouched. A page module registers what it does with definePage(); the shell mounts it on
// first load and on each visit. Anything that cannot be swapped safely (another kind of page, a link
// that opens elsewhere, a fetch that fails, or a build with new code) is an ordinary navigation.
import { endPage, currentScope } from "./page-scope.js";
import { mountPlayerBar } from "./player-bar.js";
import { showMessage } from "./message.js";
import { applyBranding } from "./branding.js";

const pages = new Map();
// The pages this shell swaps between. Everything else loads normally.
const routes = /^\/(?:$|mixtapes(?:\/|$)|queue(?:\/|$)|admin(?:\/|$)|distonyc(?:\/|$)|lyrics(?:\/|$)|original-prompt(?:\/|$)|audtism(?:\/|$)|timeline(?:\/|$)|sausage(?:\/|$))/;
// Sheets that belong to the shell and the room, never to one page.
const kept = ["/assets/site.css", "/assets/theme.css", "/assets/listeners.css", "/assets/deployment.css", "/assets/favorites.css", "/assets/quality-preference.css"];
const searched = new Set(["/lyrics/", "/original-prompt/", "/queue/details/"]);

let booted = false, mountedKey = "", token = 0, pageAttrs = new Set(), pageSheets = new Set();

const routable = (url) => url.origin === location.origin && routes.test(url.pathname);
// Two addresses are the same page when only their filters or fragment differ; those are the page's own business.
const keyOf = (url) => url.pathname + (searched.has(url.pathname) ? url.search : "");
const hard = (url, push = true) => { location[push ? "assign" : "replace"](url.href); };
const hrefOf = (link) => link.getAttribute("href") || "";
const sheetPath = (link) => { try { return new URL(link.href).pathname; } catch { return ""; } };

// Called by each page module as it loads. The first one to register is the page the visitor arrived on.
export function definePage(url, mount) {
  pages.set(url, mount);
  if (booted) return;
  booted = true;
  mountedKey = keyOf(new URL(location.href));
  for (const link of document.querySelectorAll('link[rel="stylesheet"]'))
    if (!kept.includes(sheetPath(link))) pageSheets.add(link);
  mountPlayerBar();
  void run(mount);
}

async function run(mount) {
  const scope = currentScope();
  try {
    await mount({ scope, page: document.body.dataset.page || "" });
  } catch (error) {
    if (!scope.left) showMessage(error?.message || "This page could not load. Please try again.", true);
  }
}

async function styles(doc, base) {
  const wanted = [...doc.querySelectorAll('link[rel="stylesheet"]')].map((link) => new URL(link.getAttribute("href"), base));
  const have = new Map([...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => [sheetPath(link), link]));
  const loading = [];
  for (const url of wanted) {
    if (have.has(url.pathname)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url.pathname + url.search;
    loading.push(new Promise((resolve) => { link.onload = link.onerror = resolve; }));
    document.head.append(link);
    pageSheets.add(link);
  }
  await Promise.race([Promise.all(loading), new Promise((resolve) => setTimeout(resolve, 4000))]);
  const keep = new Set(wanted.map((url) => url.pathname));
  return () => {
    for (const link of [...pageSheets]) if (!keep.has(sheetPath(link))) { link.remove(); pageSheets.delete(link); }
  };
}

// What a link preview or a search engine would read from the page follows it, though only a fetch of the page reads it.
const described = 'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]';

function swap(doc) {
  document.title = doc.title;
  for (const element of document.head.querySelectorAll(described)) element.remove();
  for (const element of doc.head.querySelectorAll(described)) document.head.append(document.importNode(element, true));
  for (const name of pageAttrs) document.body.removeAttribute(name);
  pageAttrs = new Set();
  for (const { name, value } of doc.body.attributes)
    if (name.startsWith("data-") && name !== "data-update-available") { document.body.setAttribute(name, value); pageAttrs.add(name); }
  const swapIn = (selector) => {
    const from = doc.querySelector(selector), into = document.querySelector(selector);
    if (from && into) into.replaceWith(document.importNode(from, true));
  };
  swapIn(".site-header");
  const from = doc.querySelector("#main"), into = document.querySelector("#main");
  for (const { name } of [...into.attributes]) if (name !== "id") into.removeAttribute(name);
  for (const { name, value } of from.attributes) if (name !== "id") into.setAttribute(name, value);
  into.replaceChildren(...[...from.childNodes].map((node) => document.importNode(node, true)));
  swapIn(".site-footer");
  applyBranding();
  showMessage("");
}

// Fetch the page, prepare its module and styles, then swap; any doubt means a normal navigation.
export async function navigate(target, { push = true, keyboard = false } = {}) {
  const url = new URL(target, location.href);
  if (!routable(url) || document.body.dataset.updateAvailable) return hard(url, push);
  const mine = ++token;
  document.documentElement.dataset.navigating = "true";
  try {
    let response, doc;
    try {
      response = await fetch(url.href, { headers: { Accept: "text/html" }, credentials: "same-origin" });
      if (!response.ok || !/text\/html/.test(response.headers.get("content-type") || "")) return hard(url, push);
      doc = new DOMParser().parseFromString(await response.text(), "text/html");
    } catch { return hard(url, push); }
    if (mine !== token) return;
    // A fetch drops the fragment, and a link to a song on the collection page depends on it.
    const final = new URL(response.url);
    final.hash = url.hash;
    const entry = doc.querySelector('head script[type="module"][src]')?.getAttribute("src");
    const code = (root) => root.querySelector('meta[name="yehry3-code"]')?.content;
    // A newer build has changed the code itself: the loaded modules and this page could disagree.
    if (!doc.querySelector(".site-header") || !doc.querySelector("#main") || !entry || !routable(final) || code(doc) !== code(document)) return hard(url, push);
    const module = new URL(entry, final).href;
    let mount = pages.get(module);
    if (!mount) {
      try { await import(module); } catch { return hard(url, push); }
      mount = pages.get(module);
    }
    if (!mount) return hard(url, push);
    const dropStyles = await styles(doc, final);
    if (mine !== token) return;
    endPage();
    if (push) {
      history.replaceState({ ...history.state, scrolled: scrollY }, "");
      history.pushState({ shell: true }, "", final);
    }
    swap(doc);
    dropStyles();
    mountedKey = keyOf(final);
    scrollTo(0, 0);
    await run(mount);
    const heading = keyboard ? document.querySelector("#main h1") : null;
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    if (final.hash && !document.querySelector(":target")) {
      try { document.getElementById(decodeURIComponent(final.hash.slice(1)))?.scrollIntoView(); }
      catch { /* A fragment that is not a valid escape names nothing to scroll to. */ }
    }
  } finally {
    if (mine === token) delete document.documentElement.dataset.navigating;
  }
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download") || link.dataset.shell === "off") return;
  const url = new URL(link.href, location.href);
  if (!routable(url) || !booted) return;
  // A fragment on this same page is the page's own to follow.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  event.preventDefault();
  void navigate(url, { keyboard: event.detail === 0 });
});

addEventListener("popstate", () => {
  if (!booted) return;
  const url = new URL(location.href);
  if (keyOf(url) === mountedKey) return;
  const y = history.state?.scrolled;
  void navigate(url, { push: false }).then(() => { if (Number.isFinite(y)) scrollTo(0, y); });
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mountPlayerBar(), { once: true });
else mountPlayerBar();
