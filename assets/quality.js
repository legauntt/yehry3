import "./quality-preference.js";
export { mountQualitySettings } from "./quality-preference.js";

export function qualityNotice(issues, suppliedReviewState) {
  const known = (Array.isArray(issues) ? issues : []).filter(
    (issue) => issue?.code === "unconfirmed_lyric_ending" || Number.isFinite(issue?.seconds) && issue.seconds <= 1440 &&
      ((issue.code === "early_lyric_ending" && issue.seconds > 20) || (issue.code === "long_instrumental_outro" && issue.seconds > 13) || (issue.code === "long_instrumental_break" && issue.seconds >= 9.5) || (issue.code === "vocal_dropout" && issue.seconds > 0.4)),
  );
  if (!known.length) return "";
  // Older static catalogs predate the explicit field, so validated issues remain the fallback.
  const reviewState = suppliedReviewState === "needs_review" ? suppliedReviewState : "needs_review";
  const messages = known.map((issue) => {
    if (issue.code === "unconfirmed_lyric_ending") return "Automatic lyric review could not confirm the intended closing words; a listening check is needed.";
    if (issue.code === "early_lyric_ending") return `Automatic lyric review suggests the closing words finish ${Math.round(issue.seconds)} seconds before the end; a listening check is needed.`;
    if (issue.code === "long_instrumental_outro") return `Long instrumental ending (${Math.round(issue.seconds)} seconds after the last detected vocal).`;
    if (issue.code === "long_instrumental_break") return `Long instrumental break (${Math.round(issue.seconds)} seconds between detected vocals).`;
    return `A vocal passage could not be fully restored (${Math.round(issue.seconds * 10) / 10} seconds).`;
  });
  return `<div class="review-state" data-review-state="${reviewState}"><span class="badge needs_review">Needs review</span><details class="quality-notice"><summary>Review notes</summary><p>${messages.join(" ")} The song is available to play.</p></details></div>`;
}
