export function qualityNotice(issues) {
  const known = (Array.isArray(issues) ? issues : []).filter(
    (issue) => issue?.code === "long_instrumental_outro" && Number.isFinite(issue.seconds) && issue.seconds > 13 && issue.seconds <= 600,
  );
  if (!known.length) return "";
  return `<details class="quality-notice"><summary>Has issues</summary><p>Long instrumental ending (${Math.round(known[0].seconds)} seconds after the last detected vocal). The song is available to play.</p></details>`;
}
