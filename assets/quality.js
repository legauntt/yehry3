export function qualityNotice(issues) {
  const known = (Array.isArray(issues) ? issues : []).filter(
    (issue) => Number.isFinite(issue?.seconds) && issue.seconds <= 600 &&
      ((issue.code === "long_instrumental_outro" && issue.seconds > 13) || (issue.code === "long_instrumental_break" && issue.seconds >= 9.5)),
  );
  if (!known.length) return "";
  const messages = known.map((issue) => issue.code === "long_instrumental_outro"
    ? `Long instrumental ending (${Math.round(issue.seconds)} seconds after the last detected vocal).`
    : `Long instrumental break (${Math.round(issue.seconds)} seconds between detected vocals).`);
  return `<details class="quality-notice"><summary>Has issues</summary><p>${messages.join(" ")} The song is available to play.</p></details>`;
}
