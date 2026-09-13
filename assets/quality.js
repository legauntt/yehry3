import "./quality-preference.js";

export function qualityNotice(issues) {
  const known = (Array.isArray(issues) ? issues : []).filter(
    (issue) => Number.isFinite(issue?.seconds) && issue.seconds <= 600 &&
      ((issue.code === "long_instrumental_outro" && issue.seconds > 13) || (issue.code === "long_instrumental_break" && issue.seconds >= 9.5) || (issue.code === "vocal_dropout" && issue.seconds > 0.4)),
  );
  if (!known.length) return "";
  const messages = known.map((issue) => {
    if (issue.code === "long_instrumental_outro") return `Long instrumental ending (${Math.round(issue.seconds)} seconds after the last detected vocal).`;
    if (issue.code === "long_instrumental_break") return `Long instrumental break (${Math.round(issue.seconds)} seconds between detected vocals).`;
    return `A vocal passage could not be fully restored (${Math.round(issue.seconds * 10) / 10} seconds).`;
  });
  return `<details class="quality-notice"><summary>Has issues</summary><p>${messages.join(" ")} The song is available to play.</p></details>`;
}
