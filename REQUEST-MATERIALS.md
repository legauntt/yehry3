# Optional lyrics and reference links

The direction step has a collapsible **Lyrics & references** panel. A pasted
sheet may contain up to 3,000 whitespace-separated words and 30,000 JavaScript
characters (UTF-16 code units). No paste is silently truncated. Standard section
labels and line breaks are preserved. The user chooses **Keep my wording**
(default) or **Adapt these lyrics**.

Keep my wording protects the words, spelling, punctuation and order supplied to
generation. Whitespace and standard section labels may change. The performance
can vary. Adaptation permits rewriting, shortening and restructuring; the original
submission remains in the saved brief. The active planner and renderer currently
support 3–5 minutes. Review prevents queueing a preserved sheet that is too short
for the renderer or too dense for five minutes at the current melodic/explicit rap
pacing guidance, and offers editing or adaptation.

Each of up to three public HTTPS links has its own **Creative reference** or
**Import lyrics** purpose and optional note. Previewing never replaces an existing
sheet. A lyric preview is editable, and **Use these lyrics — replace the sheet
above** explicitly applies it. A changed URL or purpose invalidates the preview.
Unsubmitted edits survive reload in the same tab when browser storage is available.
Reviewed drafts, capacity retries and worker restarts retain the accepted snapshots.

## Retrieval

- Creative pages supply up to 5,000 characters of readable text.
- YouTube watch, short, embed and youtu.be links supply title/channel metadata
  through oEmbed. A descriptive note is required. Audio is not downloaded or analyzed.
- Lyric import recognizes Genius, AZLyrics, Lyrics.com, Wikisource poem containers
  and public plain-text links. Availability depends on the source; blocked, removed,
  oversized or unsupported pages offer a paste fallback. Source words are never
  invented or silently truncated.
- Authenticated Chairlift retrieval accepts HTTPS on port 443 without credentials.
  DNS addresses are checked and pinned for each connection; private, local, reserved
  and mixed public/private results are rejected, including redirects. Retrieval has
  a 10-second total deadline, a 1 MiB response ceiling and at most three redirects.
  HTML scripts, forms and navigation are removed without execution.
- Preview limits are 12 per browser owner and 24 per network per 15 minutes, with
  a service cap of 120/hour. These do not change normal request admission limits.

## Data and privacy

**details.lyricSheet** is {text, mode: "preserve" | "adapt"} or null.
**details.references** contains {url, purpose, note, snapshotId?, snapshot?}.
The server owns each snapshot's text, kind, title, retrieval time and content hash.
Clients submit snapshot IDs; they cannot forge fetched content or borrow another
requester's preview. Temporary previews expire after 24 hours. Accepted copies live
inside the confirmed brief so future website changes or cache expiry cannot change
the song.

After confirmation, anyone can view supplied lyric sheets, their preserve/adapt mode,
reference URLs, purposes, notes, and saved reference text in Original prompt details.
This includes previously confirmed requests and published songs. The anonymous
GET /queue/:publicId endpoint reads these materials from the saved request, with no
migration or repeat retrieval. Polling queue lists and the song catalog remain compact;
the frontend loads the material only when a visitor opens prompt details. During an
API outage, the page retains the catalog brief and explains that materials could not
be loaded instead of claiming none were supplied.

Drafts and temporary previews retain their existing owner checks. Admin notes,
worker diagnostics, local paths, internal snapshot IDs and hashes remain excluded.
The final recording's lyric sheet is also public, using the existing Lyrics page
and catalog. Published sheets allow 32,000 UTF-16 characters to accommodate the
input sheet plus arrangement labels.

The frontend checks GET /request-materials before offering the controls.
New worker claims advertise **request-materials-v1**; older workers skip attached
requests. Planning has no web, shell or app tools. Attached requests receive at most
three durable planning attempts; exact-word validation runs before a plan is saved.
Canceled or interrupted calls retain the spent budget and previously saved output.
Existing requests and frozen plans without attachments use their existing behavior.

## Validation and rollout

Validation includes frontend unit tests; browser reload/edit, limits, import preview,
failure, mobile, attribution and queue-capacity interactions; API ownership,
snapshot expiry, anonymous confirmed-material access, operational-field redaction,
worker capability and publication checks; and
worker preservation, adaptation, budget, cancellation and restart tests. Models and
GPU rendering are mocked. Public retrieval smoke checks verified YouTube metadata,
ordinary page text and a Wikisource poem.

Deploy Chairlift first, update the installed worker while idle, then deploy the
website. Worker code changes are limited to planner.py, lyrics.py, worker.py
and the new request_materials.py. Preserve config, credentials, job journals and
all other installed files. The existing installer can run from a staging directory
containing an exact snapshot of the installed code plus these four reviewed updates.
Recheck installed hashes immediately before installation.

Rollback the frontend controls first. Retain the capable API and worker until
requests already containing attachments finish; an old worker must not receive those
jobs. Catalog publications use the existing revision-aware merge.
