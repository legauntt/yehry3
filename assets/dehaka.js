const quotes = [
  "I evolve. I adapt. The queue survives.",
  "New essence. New solution.",
  "Failure is only uncollected essence.",
  "A direct retry is not evolution.",
  "The next form will be stronger.",
  "I collect context. Then I adapt.",
];

export function dehakaQuote(random = Math.random) {
  return quotes[Math.floor(random() * quotes.length) % quotes.length];
}

export function dehakaAttemptCount(history = []) {
  return history.filter((entry) =>
    ["queued", "processing", "failed"].includes(entry?.status) ||
    /retry|recover|shepherd/i.test(String(entry?.action || "")),
  ).length;
}

export function dehakaNextStep(doc, adapting, canRetry) {
  if (adapting && doc.recovery?.shepherd)
    return "Inspect the saved evidence, apply the guidance, and use only a supported bounded repair.";
  if (adapting)
    return "Let the active recovery finish; saved stages and integrity checks remain in force.";
  if (canRetry)
    return "Add any useful intent above, then ask Dehaka to diagnose and choose a supported repair.";
  return "Review the retained failure and activity trail; no supported retry is currently available.";
}
