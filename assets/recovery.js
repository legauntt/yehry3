export function recoveryActive(doc, now = Date.now()) {
  return doc.status === "failed" && doc.recovery?.phase === "recovering" && Date.parse(doc.recovery.expiresAt) > now;
}
export function recoveryStatus(doc, now = Date.now()) {
  return recoveryActive(doc, now) ? "recovering" : doc.status;
}
