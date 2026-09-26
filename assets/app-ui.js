import { showMessage } from "./message.js";
import { voiceModelBadge } from "./song-badges.js";
import { pitchBadge } from "./pitch-badge.js";
import { sidesBadge } from "./sides.js";
import { songCostLabel } from "./song-cost.js";
import { songPlanLink } from "./song-plan.js";
import { authoredByLine } from "./authored-by.js";
import { lyricsHref } from "./song-links.js";
import { badgeSoundIcon, hasBadgeSound } from "./badge-sound.js";

const $ = (selector, root = document) => root.querySelector(selector);
const main = $("#main");
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
  publishing: "Publishing",
  published: "Published",
  needs_review: "Needs review",
  failed: "9/11'd Again",
  attention: "9/11'd Again",
  recovering: "Recovering automatically",
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
  hasBadgeSound(status)
    ? `<button type="button" class="badge ${escape(status)} badge-sound" title="Play a line from “Nine-Eleven'd Again”" aria-label="${escape(labels[status])} (play sound)">${escape(labels[status])}${badgeSoundIcon}</button>`
    : `<span class="badge ${escape(status)}">${escape(labels[status] || status)}</span>`;
const duration = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const ageFromElapsed = (elapsed) => {
  elapsed = Math.max(0, elapsed);
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Less than a minute old";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} old`;
  const hours = Math.floor(minutes / 60);
  if (hours <= 24) return `${hours} ${hours === 1 ? "hour" : "hours"} old`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} old`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks} ${weeks === 1 ? "week" : "weeks"} old`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months} ${months === 1 ? "month" : "months"} old`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} old`;
};
const age = (value) => ageFromElapsed(Date.now() - new Date(value).getTime());
const collections = (song) => [
  ...new Set([song.collection, ...(song.collections || [])]),
];
const collectionNames = {
  fearhunger: "Fear & Hunger",
  tonyai: "Tony AI",
  distonyc: "Distonyc requests",
  shiablo: "Shiablo: The Lord of Prisoners",
};
// The two main collections are the default; only the exceptions are worth a label on each row.
const unlabeledCollections = new Set(["tonyai", "distonyc"]);
const message = showMessage;
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

function songPublishedAt(song, recentPublishedAt) {
  for (const value of [song.publishedAt, recentPublishedAt]) {
    if (value && Number.isFinite(new Date(value).getTime())) return value;
  }
  const order = Number(song.order);
  const orderedDate = new Date(-order);
  return order < 0 && Number.isFinite(orderedDate.getTime()) ? orderedDate.toISOString() : "";
}

function songMeta(song, recentPublishedAt) {
  const publishedAt = songPublishedAt(song, recentPublishedAt);
  const releaseAge = publishedAt
    ? age(publishedAt)
    : "Age unavailable";
  const shown = collections(song).filter((name) => !unlabeledCollections.has(name));
  return `<div class="track-meta">${shown.length ? `<span class="track-collections">${escape(
    shown.map((name) => collectionNames[name] || name).join(" / "),
  )}</span>` : ""}${authoredByLine(song.authoredBy, escape)}${voiceModelBadge(song)}${songCostLabel(song)}${pitchBadge(song)}${sidesBadge(song)}<span class="track-duration">${duration(song.duration)}</span>${publishedAt ? `<time class="track-age" datetime="${escape(publishedAt)}" title="Released ${escape(date(publishedAt))}">${releaseAge}</time>` : `<span class="track-age" title="Exact release time unavailable">${releaseAge}</span>`}</div>`;
}

function songLinks(song) {
  return `<div class="track-links" role="group" aria-label="Explore song">${(song.lyrics?.text || song.hasLyrics) ? `<a class="text-link" href="${lyricsHref(song)}" aria-label="Lyrics for ${escape(song.title)}">Lyrics ↗</a>` : ""}${songPlanLink(song, escape)}${(song.originalPrompt || song.hasOriginalPrompt) ? `<a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}" aria-label="Original prompt for ${escape(song.title)}">Original prompt ↗</a>` : ""}</div>`;
}


export { $, main, escape, labels, date, badge, duration, ageFromElapsed, age, collections, collectionNames, unlabeledCollections, message, busy, focusHeading, safeUrl, songPublishedAt, songMeta, songLinks };
