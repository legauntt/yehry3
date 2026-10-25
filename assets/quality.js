import "./quality-preference.js";
import { repairTime } from "./repair-status.js";
export { mountQualitySettings } from "./quality-preference.js";

export function qualityNotice(issues, suppliedReviewState, validationFailures, repairedAt) {
  const reasons = {
    vocal_activity: "The performance did not pass vocal coverage checks.",
    voice_validation: "The converted vocals did not pass automatic voice checks.",
    vocal_dropout: "Automatic validation detected missing vocal passages.",
    unfinished_ending: "The ending did not pass completion checks.",
    mix_quality: "The mix did not pass automatic quality checks.",
    unconverted_vocals: "Tony vocals are unfinished; this is the retained generated performance.",
  };
  const failures = repairTime({ repairedAt }) ? [] : (Array.isArray(validationFailures) ? validationFailures : []).filter(code => Object.hasOwn(reasons, code));
  const known = (Array.isArray(issues) ? issues : []).filter(
    (issue) => validMeasurement(issue) || issue?.code === "low_vocal_coverage" && Number.isFinite(issue.fraction) && issue.fraction > 0 && issue.fraction < .5 || issue?.code === "unconfirmed_lyric_ending" || Number.isFinite(issue?.seconds) && issue.seconds <= 1440 &&
      ((issue.code === "early_lyric_ending" && issue.seconds > 20) || (issue.code === "long_instrumental_outro" && issue.seconds > 13) || (issue.code === "long_instrumental_break" && issue.seconds >= 9.5) || (issue.code === "vocal_dropout" && issue.seconds > 0.4)),
  );
  if (!known.length && !failures.length) return "";
  const needsReview = failures.length > 0 && suppliedReviewState === "needs_review";
  const messages = known.map((issue) => {
    if (issue.code === 'vocal_activity_check') {
      if (issue.fraction >= issue.requiredFraction) return `Vocal activity check passed: ${percent(issue.fraction)}% measured activity (minimum ${percent(issue.requiredFraction)}%).`;
      return `Vocal activity check failed: ${percent(issue.fraction)}% measured activity; the usual check requires ${percent(issue.requiredFraction)}%. ${issue.fraction >= issue.minimumFraction ? `This meets the ${percent(issue.minimumFraction)}% minimum for publication with review.` : `This is below the ${percent(issue.minimumFraction)}% minimum for publication with review.`}`;
    }
    if (issue.code === 'voice_pitch_check') return `Pitch comparison failed for ${issue.phrase}: ${issue.sourceFrames} pitched source frames and ${issue.convertedFrames} pitched converted frames out of ${issue.analyzedFrames} analyzed frames (${percent(issue.sourceFrames / issue.analyzedFrames)}% and ${percent(issue.convertedFrames / issue.analyzedFrames)}%). The comparison requires at least ${issue.minimumMutualFrames} matching pitched frames. Too little matching pitch was detected to verify the converted voice automatically; a listening review is needed.`;
    if (issue.code === "low_vocal_coverage") return `Instrumental-heavy arrangement: ${Math.round(issue.fraction * 100)}% measured vocal activity. Sparse vocals were allowed for this request.`;
    if (issue.code === "unconfirmed_lyric_ending") return "Automatic lyric review could not confirm the intended closing words; a listening check is needed.";
    if (issue.code === "early_lyric_ending") return `Automatic lyric review suggests the closing words finish ${Math.round(issue.seconds)} seconds before the end; a listening check is needed.`;
    if (issue.code === "long_instrumental_outro") return `Long instrumental ending (${Math.round(issue.seconds)} seconds after the last detected vocal).`;
    if (issue.code === "long_instrumental_break") return `Long instrumental break (${Math.round(issue.seconds)} seconds between detected vocals).`;
    return `A vocal passage could not be fully restored (${Math.round(issue.seconds * 10) / 10} seconds).`;
  });
  messages.unshift(...failures.map(code => reasons[code]));
  return `<div class="review-state"${needsReview ? ' data-review-state="needs_review"' : ""}>${needsReview ? '<span class="badge needs_review">Needs review</span>' : ""}<details class="quality-notice"${failures.length ? ' open' : ''}><summary>${failures.length ? "Review notes" : "Has issues"}</summary><p>${messages.join(" ")} The song is available to play.</p></details></div>`;
}

const percent = value => Math.round(value * 1000) / 10;
function validMeasurement(issue) {
  if (issue?.code === 'vocal_activity_check') return ['fraction', 'requiredFraction', 'minimumFraction'].every(key => Number.isFinite(issue[key]) && issue[key] >= 0 && issue[key] <= 1) && issue.minimumFraction <= issue.requiredFraction;
  if (issue?.code === 'voice_pitch_check') return /^phrase-\d{3,4}$/.test(issue.phrase) && ['sourceFrames', 'convertedFrames', 'analyzedFrames', 'minimumMutualFrames'].every(key => Number.isInteger(issue[key]) && issue[key] >= 0 && issue[key] <= 1000000) && issue.analyzedFrames > 0 && Math.max(issue.sourceFrames, issue.convertedFrames) <= issue.analyzedFrames && issue.minimumMutualFrames > 0;
  return false;
}
