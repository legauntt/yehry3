import { needsReview } from "./repair-status.js";
import { recoveryActive } from "./recovery.js";

// Curated from September 12–October 3 shepherd outcomes. Publication and
// automated checks are evidence of delivery, not proof that a performance sounds right.
const remedies = [
  {
    id: "paid-plan", matches: /bad_composition_plan|eleven.*(?:400|reject|refus)|content.policy|copyright/i,
    title: "Try the same lyrics with Local ACE",
    reason: "A new Local ACE request delivered Golden Answer Piano Remedy after repeated Eleven Music plan rejections. Repeating the rejected paid plan did not help.",
    request: "Inspect the saved rejection. Prepare a NEW Local ACE request preserving my exact lyrics, voice choice and arrangement. Show the proposed brief before submitting; do not rewrite lyrics to evade a rejection or spend on another identical paid attempt.",
  },
  {
    id: "nonverbal", matches: /nonverbal|wordless|phonetic|lexical|gibberish|jibberish/i,
    title: "Make the wordless plan explicit",
    reason: "Explicit nonverbal vocals and varied phonetic sections produced the chromatic jibberish release. Kraza Vellum still had an unfinished ending; repetitive auto-replanning was rejected.",
    request: "Check whether this is intentionally wordless. Preserve its phonetic score, explicitly use nonverbal vocals and validate supported section headings and varied phrasing. Show corrections before creating a new request. Verify the ending by listening; do not invent lexical lyrics.",
  },
  {
    id: "duration", matches: /duration|too (?:long|short)|sparse|word.count|words.*(?:fit|second)|lyric.*(?:fit|length)/i,
    title: "Fit the duration to the lyric sheet",
    reason: "Weird Hair Weird Smells recovered with a new 350-second plan for 503 words. Nine-Eleven’d Again recovered after an explicitly approved shorter, sparse arrangement.",
    request: "Measure the saved lyric density and section timings against current backend limits. Propose a duration that fits without dropping or adding words. Keep confirmed inputs immutable and create a revised request only after I approve the brief. Do not blindly extend or shorten this song.",
  },
  {
    id: "saved-work", matches: /inactive|one.sample|boundary|basis|reference.*(?:missing|not found)|section.*(?:label|format)|line.limit|30.line|packag|permission.denied|publication|voice.model.*(?:differ|mismatch)/i,
    title: "Repair the stopped stage using saved work",
    reason: "Rooms We Never Named recovered from sample-boundary faults; Ash Has No Anthem recovered after restoring its pinned basis recordings. Section-format and packaging fixes also delivered songs without replacing their lyrics.",
    request: "Inspect the exact failing stage and retained artifacts. Repair the specific format, boundary, file lock, packaging or pinned-reference fault if confirmed. Verify source hashes and confirmed voice identity, preserve the successful render, and resume only the affected stage after fixing the cause. Do not substitute reference recordings or rerender the whole song by default.",
  },
  {
    id: "vocals", matches: /vocal|voice_validation|pitch|octave|missing.*(?:word|phrase)|unconverted/i,
    title: "Audit and repair the exact vocal passage",
    reason: "Crooked Crown Campaign passed checks after a targeted two-second octave repair. Yeah After Midnight’s replacement still omitted “Yeah”; a later local correction was not verified as a live release.",
    request: "Listen to the original retained vocal stem and name the exact missing words, timestamps or pitch fault. Propose a bounded passage repair preserving the surrounding performance. Compare before and after by listening, verify intended closing words, then verify published MP3/WAV playback. A passed check alone must not close the issue.",
  },
  {
    id: "ending", matches: /unfinished_ending|ending|outro/i,
    title: "Inspect the ending before replacing the song",
    reason: "Midnight Swing and Kraza Vellum remained unfinished despite recovery. There is no verified general auto-fix for this symptom.",
    request: "Listen to the last vocal and instrumental cadence in the saved render. Identify whether it cuts off, omits closing lyrics, or only has an intentional outro. Propose a bounded ending repair with a before/after listening comparison, or explain why a revised request is needed. Do not promise that another full render will finish it.",
  },
];

export function clippyOptions(doc) {
  if (doc?.status !== "failed" && !needsReview(doc)) return [];
  // Diagnose current errors, never a song title, user lyrics or old failure history.
  const symptoms = [doc.workerError, ...(doc.result?.validationFailures || doc.validationFailures || []),
    ...(doc.result?.qualityIssues || doc.qualityIssues || []).map(issue => issue.code)].filter(Boolean).join(" ");
  const options = remedies.filter(option => option.matches.test(symptoms)).slice(0, 3);
  options.push({
    id: "inspect", title: "Inspect before spending another attempt",
    reason: "The cause is not always in the summary. Retained plans, stems and logs can separate a repairable stage from a brief that needs changing.",
    request: "Inspect this request’s retained plan, logs, completed stages and previous recovery attempts. State the actual cause and what has already failed. Propose one bounded remedy with evidence, reuse saved work where possible, and ask before any paid generation. Preserve lyrics and confirmed inputs. Verify musical quality by listening as well as delivery; do not repeat Dehaka’s automatic corrections.",
  });
  options.push({ id: "archive", title: "Archive and you try again",
    reason: "Start from a revised brief when the frozen inputs or the performance need a fresh attempt. Saved history remains available; another render is not a guaranteed fix.",
    request: "Archive this failed request or rejected recording using the existing supported controls, retaining its history and saved artifacts. Then you try again: inspect why previous attempts failed and prepare a new corrected brief, preserving my lyrics, chosen voice and creative intent. Show me the concrete changes before submitting. Do not repeat the failed auto-corrections or launch paid generation without my approval. Verify both the musical result by listening and the eventual live delivery." });
  return options;
}

export function clippyMarkup(doc, escape, { canArchive = false } = {}) {
  const options = clippyOptions(doc);
  if (!options.length) return "";
  const working = doc.workerActive || recoveryActive(doc);
  return `<section class="clippy" aria-label="Clippy remediation suggestions"><div class="clippy-heading"><span class="clippy-icon" aria-hidden="true">📎</span><div><h3>Clippy</h3><p>Looks like this song needs a hand.</p></div></div><p class="small">Suggestions from past shepherd recoveries. You choose the next step.${working ? " Recovery is still running; wait for it to stop before starting another attempt." : ""}</p><ol class="clippy-options">${options.map(option => `<li><h4>${escape(option.title)}</h4><p class="small">${escape(option.reason)}</p>${option.id === "archive"
    ? `<p class="small">${needsReview(doc) ? "Use Regenerate above to review a replacement brief; the old recording is archived when you queue the replacement. Or use Archive to take it down now." : canArchive ? "Use Archive below to stop recovery, then open a new request and revise your original brief." : "Open brief & controls below to inspect the available status changes before starting over."}</p><button type="button" class="quiet" data-clippy="archive" aria-controls="support-${escape(doc.id)}">Prepare this fix</button> <a class="text-link" href="/distonyc/">Open a new request →</a>`
    : `<button type="button" class="quiet" data-clippy="${option.id}" aria-controls="support-${escape(doc.id)}">Prepare this fix</button>`}</li>`).join("")}</ol><p class="small">Clippy prepares a repair request. It does not run automatic corrections or start generation.</p></section>`;
}
