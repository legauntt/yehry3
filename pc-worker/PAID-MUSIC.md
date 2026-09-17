# Eleven Music song generation

The request page has a separate **Band generator** dropdown. Local ACE remains the
default for every new request. Everyone with ordinary request access may explicitly
select **Eleven Music · paid**; Tony V6, V7 and V8 remain independent choices.

Paid requests create new compositions, 120–600 seconds, with one provider take.
Catalog Remix is supported: the retained lyrics and musical brief guide a new
arrangement, while the source recording and vocal references stay on the PC.
This does not preserve or condition on the original melody. The confirmed source
identity, lyric edit choice and public original-song link remain attached.
Style, instrumentation, tempo, key, meter, lyric review, approved lyric wording,
musical timing targets, and vocal/band mix levels carry over. Other basis recordings,
the local backing adapter, local variation settings and multiple composition
candidates remain unavailable on the paid path. The form retains local
choices when switching generators and does not remember paid selection for new songs.

Auto length stays blank while editing. At review, Chairlift resolves a stable
per-request duration from the studio's existing length bands, conditioned on the
provider's 600-second ceiling: mostly 3–5 minutes around four, occasional 2–3 or
5–8 minutes, and rare 9–10 minutes. Repeating the review keeps the same selection;
manual lengths take priority. Local Auto remains omitted for the planner, including
its existing exceptionally rare 19-minute suite policy. The paid integration uses
one composition and cannot produce that 19-minute jackpot.

The confirmation page shows the resolved duration and estimated generation cost and requires a separate
paid confirmation plus the separate paid confirmation password. Chairlift checks
that password before queue admission and budget reservation; it is never sent to
the worker or saved in the request. Only the approved lyric sheet and generated musical directions
go to ElevenLabs. Tony recordings, voice models, raw reference-page snapshots,
credentials and private admin notes are not uploaded. Creative instructions can
influence the resulting lyrics/arrangement, just as they do for local composition.

## Spending and restart behavior

Jesse authorized a **$200 total cap**, available to all submitters, on September 17,
2026. This is not a monthly reset. Both the API and PC reserve a conservative $1 per
requested minute. Published Music pricing was $0.15/minute when checked:
[ElevenLabs API pricing](https://elevenlabs.io/pricing/api). A four-minute song has
an estimated $0.60 generation value and reserves $4. Subscription fees, taxes and
actual account invoicing are not inspected by the integration.

The earlier six-take comparison consumes its existing $9 conservative reservation,
leaving $191 available for new reservations. Do not reset either ledger during an
upgrade. Reservations remain counted after failures or cancellation until an
operator reconciles them against provider history; cancellation cannot refund a
provider request already in flight.

Chairlift reserves funds in the same Mongo transaction as queue admission. A full
queue, stale confirmation, missing paid confirmation, incorrect password, or exhausted budget leaves the
review intact. Replaying a successful confirmation does not reserve twice.

The PC writes its reservation before the only billable request. Its exclusive ledger
lock prevents concurrent calls. A saved receipt and original MP3 recover a lost
final ledger write. An uncertain response without a valid receipt stops with
**Needs attention**, retaining the reservation. Retry cannot send it again.
Provider HTTP redirects are refused, and error bodies/keys are never logged.

The separate `eleven-music-v1` worker capability fences old workers. Catalog paid
remixes additionally require `eleven-music-remix-v1` for both claims and replays. Completed
provider audio is reused for downstream retries. Automatic composition, ending,
suite, sparse-vocal and candidate generation paths cannot create extra paid takes.
Supported local vocal repair and the existing integrity/publication checks remain.

## Installation

Deploy the matching Chairlift contract and frontend. Chairlift configuration:

```
YEHRY3_ELEVEN_MUSIC=true
YEHRY3_MUSIC_CAP_CENTS=20000
YEHRY3_MUSIC_PREVIOUS_CENTS=900
```

Set `YEHRY3_PAID_MUSIC_PASSWORD` as a separate private Chairlift secret. Without it,
new paid confirmations are unavailable. Do not put its value in this repository or
the public build. Existing authorized requests and local requests keep working.

The API's `yehry3_music_budget` document is durable. Previous reservations are seeded
only when creating that document; restarting the API cannot reset spending.

The PC config points `paid_music_policy` at a private local JSON file containing
`version: 1`, `enabled`, `cap_cents: 20000`, and absolute `ledger` and `credential`
paths. The key file remains encrypted with current-user Windows DPAPI. The ledger
must exist before the capability is advertised; missing/corrupt ledgers never
silently start at zero. No key belongs in Chairlift, Git, browser storage or `dist/`.

Install only the reviewed runtime files with `install.ps1 -Files ...`, while both
scheduled tasks are idle. Retain config, existing jobs, models, credentials and the
already-installed V7 repair/V8 lyric constraints. The bundled prerequisite source
matches those installed improvements. Disabling the policy blocks new provider
calls while allowing receipt-backed audio to resume locally.

## Verification

`test_paid_music.py` covers durable reservations, uncertain responses, receipt
recovery, changed output, caps, lock contention, no redirect/retry, section wording,
and monitor escalation. API tests cover concurrent admissions, user access,
confirmation, capability fencing, immutable provider identity and public projections.
Browser tests exercise all three voices, switching, reload/edit, a fresh local
default, mobile layout, cost confirmation and service outages.

The production recipe preparation check covers all nine voice/style combinations
and their frozen resumes without executing paid/GPU/audio stages. Actual paid
composition and Tony conversion were validated in the prior six-take comparison;
this integration's tests do not claim a newly generated full production song.
