# Artwork safety recovery

New image calls that return the provider codes `moderation_blocked` or
`content_policy_violation` receive at most two safer interpretations per song,
across processes and treatment stages. Authentication errors, timeouts, rate
limits and uncertain results do not trigger these retries.

The first retry sends only fixed benign musical genres and motifs found in the
saved source packet. It explicitly permits the image generator to change the
subject, setting and details. Raw titles, lyrics, requests and planner strings
are omitted. The second interpretation is abstract light, color and rhythm,
without people or narrative events. Provider moderation stays enabled.

Every extra call gets a separate reservation against the existing spend cap
before generation. Failed reservations are retained. Prompts, per-attempt logs,
rejections and successful prompt hashes stay in the persistent audit. Pinned
and archived songs are rechecked before retries and installation. A process exit
does not silently replay an uncertain call.

To recover a historical, positively identified rejection for an unpinned song
that still has no saved cover, use the shared state and budget with
`song-artwork.mjs run --retry-safety --only SONG_ID`. This resumes with the next
safe interpretation, never the original rejected prompt. It cannot be combined
with `--retry`, lifecycle mode, supplied direction or manually reviewed briefs.
Normal scheduled lifecycle passes use the automatic bounded retries for new
failures; existing failures remain reserved until explicit recovery.

Regression coverage: `node --test tests/artwork-safety.test.mjs`, alongside the
budget, pin guard and lifecycle tests. These tests use a fake image CLI and
disposable local API; they make no paid calls.
