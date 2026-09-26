# Distonyc on Windows

## Intentional nonverbal vocals

When a confirmed nonverbal performance has sustained vocal presence but falls below
the ordinary 50% vocal-activity threshold, `nonverbal_recovery.py` permits one
retained-audio configure recovery. It pins the recording, score, manifest and paid
receipt; the final-ending and file-integrity checks still run. It never composes
another paid song. In-memory NumPy measurements must match the saved evidence.

A previously published unconverted fallback may be completed once through
Chairlift's `complete-retained-vocals` worker endpoint. The original worker, expired
lease, exact version, prior recording hash and unchanged confirmed song are required.
The server downloads and verifies the new asset before atomically replacing the
request and catalog recording. The original release remains in history. Catalog
reconciliation accepts only that matching recorded replacement and preserves other
songs and listener metadata. Keep the old local delivery journal archived when
installing the verified replacement result, then run `delivery_check.py` afresh.

Fresh plans support `vocal_mode: nonverbal` for explicitly requested wordless,
gibberish or vocal-sound performances. The existing `lyrics` field carries a complete
phonetic score with section headings; breaths, laughter and delivery instructions
belong in the arrangement. No English or other real-language words are required.
Fresh wordless plans normalize custom standalone bracketed headings to numbered
sections and preserve their original directions in the arrangement. Performed
phonetic lines, ordinary lyric plans and saved production plans stay unchanged.
For an eligible local wordless cutoff, the existing single longer ending attempt
runs before exporting a needs-review preview. This does not authorize a paid retry
or reset an ending-repair budget.
Real-language non-English songs retain `vocal_mode: lyrics`, as do legacy plans
without this optional field. The selected voice, backend, duration and paid budget
remain unchanged. Both local captions and Eleven Music composition prompts honor
the score. Lexical ending matching is inapplicable; audio ending, continuity,
export and publication integrity checks still run. Technical checks cannot prove
that a generated performance contains no intelligible words; that needs listening.

For a refusal before production starts, use the bounded `replan.prepare` archive
and the versioned targeted admin retry. Never replace started render inputs or
reset planning/recovery journals. Install only the reviewed runtime changes while
worker and monitor are idle, preserving newer installed policies.

## Lyric workshop

`lyric_writer.py` is a separate text-only worker for Step 2 of the website. It holds an authenticated
25-second waiting request to Chairlift, which wakes as soon as a lyric job is committed, then claims
the job immediately. It uses the existing DPAPI worker credential and local Codex login. It never
claims a song, loads a voice, takes the GPU lock, or reserves music funds. Empty waits reconnect
without a polling sleep; a completed draft immediately checks for the next queued job. Connection
failures back off from one to ten seconds, preserving the same claim ID if a response was lost.
Older Chairlift deployments without the waiting endpoint retain three-second polling.
The **Distonyc Lyric Writer** task runs hidden while Jesse is signed in and this PC is awake;
logon and five-minute restart triggers recover it after exit. Only one writer instance runs.
Its launcher owns the lyric process tree through the existing Windows Job helper, so stopping
the scheduled task also stops its worker and releases the singleton lock before an update.
The website marks it offline after 45 seconds without a heartbeat and retains local drafts.

Each job gets one strict semantic classification (45 seconds maximum) followed, only for a
lyric request, by one structured lyric-generation call (90 seconds maximum). Both use low
reasoning with `lyric_writer_model` or the installed `planner_model`, ephemeral sessions,
read-only sandbox, no project documents, shell, apps, web or subagents. The classifier rejects
general conversation, factual answers, code, math, mixed tasks and scope-override attempts;
the writer independently refuses non-lyric output. Source lyrics are quoted material.
Empty polling invokes no model. There is no automatic creative retry: transport retries reuse
the same result, expired/canceled leases cannot publish, and started jobs are never reassigned.

Jobs have a three-minute absolute deadline. Chairlift retains private results for 24 hours;
browser versions survive in the same tab. Temporary local prompts, outputs and logs are removed
after each attempt. `state/lyric-workshop/pickup.json` records the latest private job ID on receipt.
The live check observes that receipt using its own monotonic clock, avoiding server/PC clock skew.
`state/lyric-workshop/health.json` and `state/lyric-writer.log` contain only
service state and error types. An interrupted process can leave a private `attempt-*` directory
under that state folder; it contains no credential and is never part of a public build.

Deploy the matching Chairlift API, then wait for the audio worker and monitor to be idle and run
`./install-lyric-writer.ps1 -Start`. It uses `install.ps1 -RuntimeOnly -Files ...` to back up and
verify just the four lyric runtime/launcher files, preserving config, credentials, recovery
code, and the existing song/monitor schedules. It registers only **Distonyc Lyric Writer**.
To update a running writer, first wait for its health state to be idle, stop that task, install,
and start it again. To disable drafting, disable and stop this task; ordinary songs still work.

Validation: `python -m unittest -v test_lyric_writer.py`. For an explicit bounded real-model check:
`python check_lyric_writer.py --config <installed-config> --output <private-report.json>`.
That check runs eight scope decisions and one lyric draft without creating a song or using a GPU.
Add `--revisions` instead to exercise all six quick actions and a second Funnier pass, with an
explicit locked line. It saves private before/after lyrics for human review and a word-change
diagnostic that ignores punctuation, case and section labels; that number is not a quality score.
Quick actions have distinct substantive editing goals and combine with extra lyric guidance.
The browser saves each version's action/prompt alongside its words, including identical responses.

## Playable publication after failed validation

Musical validation failures now take the retained recording through `review_publication.py`
instead of halting in Needs Attention. It recognizes vocal coverage, pitch/voice,
dropout, mix-quality and incomplete-ending failures from the failed stage. It exports
the complete converted vocal/backing performance when available; if Tony conversion
has not finished, it publishes the complete generated performance with an explicit
**Tony vocals unfinished** note. It never publishes partial conversion chunks.

The fallback preserves every sample of the retained full recording, using only a
whole-recording gain for encoding headroom. No fade, cut or regeneration disguises a
failed check. The original stage remains failed in its private journal; original mix
reports are retained. `review-delivery.json` pins input, manifest, report and export
hashes for restart-safe reuse. Missing/unreadable audio, changed inputs, cancellation,
lease loss and transport failures are not converted into musical review flags.

Published metadata carries bounded `validationFailures` codes and
`reviewState: "needs_review"`, through Chairlift and the fallback catalog. Ordinary
`qualityIssues` never imply this flag. Multipart songs preserve review flags from
their complete movements. Backstage can keep a version, or start a new confirmed
request from the same brief while retaining the original release.

Deploy the API and site first, then selectively install the changed runtime files
while worker and monitor are idle. Do not overwrite newer installed recovery code.
Tests: `test_review_publication.py`, `test_quality.py`, `test_worker.py`,
`test_generation_flow.py`, and the existing recovery/longform tests. Synthetic
MP3/WAV checks invoke FFmpeg and the real stage loop, not paid or GPU music generation.

Song form is optional: chorus-free songs and unlabelled lyrics are supported.
The shared section parser keeps heading variants out of sung-word checks while
preserving literal lyrics. See [song form and section labels](LYRIC-SECTIONS.md).

## Published-song remixes

`catalog_remix: true` enables `catalog-remix-v1` after the matching Chairlift API is deployed.
The Remix shortcut attaches a published song ID, not a title match against the classic basis list.
Chairlift freezes an allowlisted recording descriptor at review and checks it again at confirmation;
workers without this capability cannot claim or replay these requests.

`remix_sources.py` registers eligible published jobs only after verifying both original exports,
their published MP3 identity, the retained converted Tony vocal stem, and the published lyric sheet.
Complete recordings and source manifests stay in `basis_root/published/<song-id>/<sha256>/`,
outside repositories. Converted vocal stems are copied into the same permanent source folder as
`vocals.wav`, verified against their original hashes. Legacy manifests and frozen job inputs remain
unchanged; new source resolution prefers the archived bytes and survives generation-folder cleanup.
Missing recording bytes can be restored only from the frozen release URL with the exact size/hash;
changed files, stems, lyrics, or frozen manifests fail closed. Specialist recordings without retained
converted stems are reported unavailable before submission. No audio or private paths enter Mongo.

The existing reinterpretation recipe uses those vocal references for a new arrangement, keeps
recognizable lyric hooks and motifs, and retains the requested voice model and generated accompaniment.
It does not promise identical melody or timing. Existing confirmed requests and recovery budgets
stay unchanged. A source-less failed request needs a corrected new request, not an edited snapshot.
Registration is idempotent and resumes after publication; it never rerenders a delivered song.
For existing retained publications, load the worker token using the normal DPAPI pattern and run
`sync_remix_sources.py --config <installed-config> --all-published` (or `--request-id <id>`).
`--prepare-only` verifies and retains local sources without changing server metadata. The command
never mutates queue state; per-song results live in `state/remix-source-registration.json`.

After installing the matching API and runtime, enable `catalog_remix_health: true`. At the end of
normal worker runs, a journaled check runs at most every six hours, archives any legacy vocal
references, verifies registered sources, and reports readiness. Missing or corrupt material becomes
unavailable; successful later verification restores it. Server readiness expires after 48 hours without
a successful check. Network failures retain diagnostics and retry after 15 minutes without blocking
normal production or changing queued jobs. Run `sync_remix_sources.py --config <installed-config>
--check-library` for an immediate targeted library check; evidence is `state/remix-source-health.json`.

Published catalog remixes include `remixOf` derived from the frozen source recording. The API
registration step backfills this link from an existing published request, and the worker retains it
in the static catalog. No title matching or private job identity is used for public comparison links.

Validation: `python -m unittest -v test_remix_sources.py test_worker.py test_recovery.py`.
When applying to an installed runtime with newer planner/recovery features, apply only the reviewed
worker/planner changes and new source helper, then use the current selected-file installer. Preserve
all newer installed policies, config, credentials, and journals.

Optional request materials use the private confirmed lyric sheet and saved reference
snapshots. Claims advertise request-materials-v1; older workers skip these requests.
The planner enforces **Keep my wording** or permits explicit adaptation, with at most
three journaled attempts and no browsing. See [the request materials contract](../REQUEST-MATERIALS.md)
for behavior and installation order. Validation uses test_request_materials.py,
test_worker.py and test_recovery.py without a GPU render.

The **Distonyc Worker** scheduled task polls Chairlift every two minutes and at sign-in. Windows starts it without a visible window, ignores overlapping triggers, and retries failures three times at five-minute intervals. It runs with Jesse's ordinary interactive Windows account; the PC must be awake and signed in. It does not wake the PC or require a stored Windows password.

## Queue monitor and automatic recovery

The separate **Distonyc Queue Monitor** task checks all submitted requests every five minutes and at sign-in. Jesse authorized automatic healing on September 12. Failed requests (the website's Needs Attention state) are grouped by cause, requeued when a supported recovery is available, and tracked through publication. Monitoring itself makes no model calls.

| Cause | Automatic action |
| --- | --- |
| Verified local export / publication failure | Resume publication of the same files. |
| Short vocal dropout | First distinguish conservatively verified stereo backing bleed from source voice. For genuine loss, render up to three short passages, totaling at most four seconds, with context and saved V6. Preserve every sample outside the repair. If the bounded repair cannot resolve it, publish the best retained performance with a visible vocal issue notice after the remaining integrity checks pass. |
| Unfinished ending | Use the existing one-time longer composition recovery. Retain the original attempt. |
| Long instrumental gap or outro | Use the existing advisory policies and publish the musical notice with the song when the remaining checks pass. |
| GPU memory, timeout, connection or sharing error | Resume saved stages after cooldowns of 15 and 60 minutes. |
| Changed inputs, unsupported plan or unknown cause | Keep diagnostics in the review report; do not repeat the same failed action. |

Each request gets at most three monitor retries per policy version, and each deterministic musical recovery gets one attempt. A scan requeues at most two requests. Active leases, cancellations and changed server versions are respected. Interrupted vocal repairs resume from cached stages and retained original stems. `automatic_vocal_repair: true` in the installed config enables the renderer hook; setting it false disables new automatic voice repairs.

Jesse's default is to publish a playable song with a visible issue notice when a musical repair cannot succeed. `vocal_dropout_warnings: true` enables that fallback after the API/site warning contract is deployed. The fallback pins the retained source, backing and converted vocal hashes, leaves the audio intact, and retains the measured dropout duration in the report. Invalid/changed files and export integrity failures still require a usable file before publication.

`vocal-evidence.json` records raw missing-window measurements and any conservatively identified separator bleed. Exclusion requires no source pitch in fresh left/right/mid contours, at least 98% low-frequency energy, very quiet upper-band energy, diffuse stereo, and a matching backing tone with at least 0.95 correlation in both channels. F0=0 alone never exempts a vocal. The original dropout thresholds remain; genuine consonants, quiet center vocals and unresolved windows continue through repair or the visible-warning fallback.

Private reports live in `%LOCALAPPDATA%\Distonyc\state\monitor\`: `report.md` is readable, `report.json` contains current category counts, `ledger.json` retains causes/attempts/resolutions and seven days of snapshots, and `health.json` plus `monitor.log` show the monitor's own status. A successful retry is counted as resolved only when the request is published. Bump `POLICY_VERSION` after changing a recovery approach to allow a new bounded retry budget while retaining the old evidence.

The monitor uses a separate current-user DPAPI credential in `monitor-credential.xml`; it authenticates through the normal admin API and never bypasses queue version or ownership checks. Prepare that credential locally, copy the worker code while the worker is idle, then run `install-monitor.ps1 -Start`. Existing `install.ps1` updates monitor files along with the worker without deleting its credential or ledger. Use `Disable-ScheduledTask -TaskName 'Distonyc Queue Monitor'` to pause automatic requeueing, or `Start-ScheduledTask -TaskName 'Distonyc Queue Monitor'` for an immediate check. Both tasks run hidden while this PC is awake and Jesse is signed in.

### Contact Support and Dehaka retirement

Dehaka is retired. `queue_monitor.DEHAKA_RETIRED` disables both automatic and guided
consultations, including cached decisions and pending guidance, regardless of the old
`automatic_shepherd` config value. Set that config value to false on installation too.
Known deterministic recovery, cooldowns, retry budgets, publication and delivery checks
continue. Historical consultation/replan helpers and tests remain for saved journal
compatibility; production configuration cannot turn consultations back on.

Backstage **Contact Support** reads a private, deterministic Chairlift report from
`GET /admin/prompts/:id/support`. It shows the current status/error, recorded queue
history and cited excerpts from the latest retained logs. Copying a report does not
send a ticket, consult a model, or retry the request. The old `shepherd` HTTP action
returns 410. Archive and the existing status controls remain available.

Raw logs are independent of consultations: `dehaka_feed.py` uploads each failure
episode with bounded, redacted log tails, then records queue actions and outcomes.
The historical module, collection, keys and `/dehaka` write route retain their names
for compatibility. The UI reads `/admin/prompts/:id/logs`; `/dehaka` remains an alias.
Published completion-only logs retain their existing 24-hour expiry.

For an authorized single-request deterministic recovery, `queue_monitor.py --config
<installed-config> --request-id <id>` preserves the normal singleton, version/lease,
budget and delivery checks without consulting Dehaka. `--observe-only` stays read-only
against Chairlift. Tests: `test_dehaka_retired.py`, `test_queue_monitor.py`, and
`test_dehaka_feed.py`. Install only the changed monitor/feed after an idle check,
preserving any newer installed recovery policies and all saved state.

## Cover requests fetch their own words

A request that asks Tony to cover a named song, and brings no lyric sheet, basis recording or remix source, used to stop at planning with “a faithful cover requires … lyrics”. Before the first planning call `cover_lyrics.py` now parses the artist and title from the request, searches LRCLIB (`https://lrclib.net`, the only host it contacts), and accepts a result only when the request's own words (or a retained legacy cover hint) name that song, preferring the named artist and the sheet repeated across the most releases. The result is frozen in `cover-lyrics.json` with a SHA-256 of the text, and every later pass rebuilds the same planning brief from it, so the brief hash in `planning-input.json` and `plan.json` stays stable while the server keeps sending the unedited request. The words enter the brief as `details.lyricSheet` with `origin: "cover_lookup"` and a mode frozen in the journal. With the local band generator the mode is `preserve` (or `adapt` when a confirmed length cannot hold the words at 110 words per minute), and the planner never sees or echoes the text: its copy of the sheet carries only the word and stanza counts, and `cover_lyrics.fill` writes the words into the plan with `[Verse n]`/`[Chorus]` labels before validation. The planner's provider cuts off a reply that reproduces published lyrics (`content_filter`), which is why trusted code inserts them. With a hosted composer such as Eleven Music the mode is always `adapt` and the planner writes a loose cover in fresh wording: the service refuses published lyrics, and a paid refusal leaves a reconciliation state that cannot be replanned. The planner is told to use `recipe=new` and not to promise the original melody. The same rule applies when the requester pasted the words themselves: a cover with any lyric sheet and no selected recording is new music set to those words, never a source-dependent rendition that stops for a missing recording. A song that cannot be found is recorded as `not_found` and planned as before. A lyrics-service outage freezes nothing and fails as a retryable transient error. Jobs that already have a plan or planning snapshot are never looked up retroactively; changing them requires a separately authorized repair that preserves the saved inputs.

`worker.py` sends a presence heartbeat (`POST /worker/ping`) at the start and end of every scheduled run. It is advisory: an outage never blocks claim reconciliation.

## What uses a model

An empty queue makes one API request and exits. A new confirmed brief makes **one schema-constrained Codex planning call**, using the saved CLI login and `gpt-5.6-sol` with medium reasoning. The installed `config.json` sets `planner_model`; `planner.py` explicitly passes `model_reasoning_effort="medium"` and ignores the CLI's user config so a global Astra/xhigh preference cannot override the queue launcher. The model chooses a supported recipe and writes the title, complete lyrics when needed, tempo, key, and arrangement. Shell, web, apps, and multi-agent tools are disabled for that call. Submitted text stays in JSON; it never becomes executable code. The validated plan is saved and reused after restarts.

Local audio models still perform composition, separation, Tony V6 voice conversion, and the relevant arrangement stages. Those are fixed Python recipes, not a coding agent making decisions at every step. Polling, priority, locking, stage execution, retries, cancellation, technical checks, MP3 uploads, catalog updates, and Azure deployment run as code. There is no model call per poll or upload. An interrupted planning call can be retried if it never produced a saved plan.

The same planning call marks a song for the Fear & Hunger collection only when the games, characters, or story are clearly its subject. New plans include this boolean; older saved plans remain valid without rewriting their frozen inputs. All generated songs also remain in Distonyc requests.

Publication includes the original confirmed idea, direction, preferences, and basis-song titles for the public “Original prompt” sheet. The worker copies these allowed fields from the saved request; Chairlift derives the same snapshot from Mongo. Private notes, identities, leases, and local file paths are excluded. This adds no model call and does not modify the cached creative plan or recording.

## Requests and limits

- Every request freezes a `details.voiceModel` version. Missing legacy values mean `v6`. V6 remains the established default; later versions resolve through isolated, hash-pinned profiles in installed `config.json` and may not borrow V6 conversion or repair stages. Adding V8 or later requires one Chairlift registry entry plus one installed profile, not a request-schema change. No new voice training occurs during routine generation.
- Installed later-version profiles use `voice_models.<id>` with `label`, `runtime_kind: "fresh-catalog-v1"`, `root`, and SHA-256 pins named `adapter`, `runtime`, `common`, `bank`, and `style`. The same schema applies to V7, V8, and beyond.
- Zero basis songs produces an original. Up to five files from `gatsby-opus/static` can condition the composition locally. The dropdown inventories every supported audio file and sorts by title; IDs derive from relative paths, not positions. Audio is never uploaded to the planning model.
- A single basis song can also inspire a new original with a new subject and lyrics. It does not force a faithful remake. Altered/wrong lyrics and spoken introductions can use the existing single-source reinterpretation recipe; an acoustic rewrite retains newly generated acoustic instrumentation. Missing optional cached-stem fields fall back to provenance-checked completed separation journals when available. Known unstarted capability rejections get one retained, journaled planning upgrade; started recordings are preserved.
- Original songs support 3–5 minutes and genre instructions, with complete lyrics and a resolved ending. Selected references influence arrangement/timbre; they do not guarantee preserved melodies.
- A single-source genre reinterpretation, including rap, uses the saved catalog transcription and isolated vocal references. It preserves recognizable hooks and motifs while composing new lyrics, timing and accompaniment for the requested genre, then applies Tony V6. It requires cached source material; it does not promise unchanged melody. The old, unstarted missing-rap-recipe rejection is upgraded once a supported plan is available, retaining the original rejection in `plan-before-rap-support.json`.
- A faithful or acoustic rendition uses exactly one selected source, currently 5–300 seconds. Acoustic reconstruction is experimental and must pass the existing strict checks.
- The existing source-specific quartet recipes support Ball and Chain, One 4 the Road, and Medusa. Their established arrangements are preserved. An unsupported faithful rendition, new quartet arrangement, or incompatible multi-source reconstruction becomes **Needs attention** with an explanation. It is never silently replaced with unrelated music. Add/review a trusted recipe to expand that boundary.
- Existing Troofs checks cover hashes, voice continuity, peaks, tails, and both complete MP3/WAV outputs. They do not constitute a human listening review. Long instrumental outros and breaks in rock/acoustic-reference compositions are advisory: the complete, otherwise valid song is published with a **Has issues** notice showing the measured lengths. Musical validation failures (including coverage, missing vocals and incomplete endings) now use the flagged full-recording fallback above. Invalid audio, unsafe encoded peaks and changed inputs still stop publication. Opera retains its separate interlude measurements.

## Durable production and publication

After `make_plan` accepts a supported plan, the worker sends its musical fields through `POST /worker/prompts/:id/plan` before rendering. The current processing lease is required; identical retries are accepted and conflicting snapshots are rejected. The API keeps this separate from immutable completion metadata, returns it on public request details, and carries it into the published song. `public_plan.py` excludes notes, explanations, paths, planning inputs and logs. Deploy the matching API before installing the three changed runtime files (`public_plan.py`, `worker.py`, `publish.py`); preserve newer installed worker features when applying these small hooks.

`backfill_plans.py --catalog <catalog.json> --jobs <state/jobs>` audits saved plans without planning or rendering. It matches the request-derived public ID, published title and MP3 hash URL, and checks frozen render inputs when present. `--write` adds only missing fallback plan fields; `--sync --config <config.json>` adds matching API metadata using the existing worker credential from `DISTONYC_WORKER_TOKEN`. Different existing plans fail closed. Backfill does not modify recording URLs, votes, queue state, result metadata or publication times. Test with `python -m unittest -v test_public_plan.py test_worker.py`.

Mongo holds the queue and metadata; the PC receives only narrow worker API access. A random worker credential is stored with Windows DPAPI (`Export-Clixml`) for the current user, separate from the site's admin login. Only the trusted parent reads it. The PC never receives the production Mongo connection string. Do not copy the credential XML to another Windows account.

Claims use client-saved IDs and random tokens, three-minute leases, and heartbeats every 25 seconds. A worker stops its owned process tree after cancellation, a rejected lease, or 90 seconds without a successful heartbeat. Windows Job Objects also stop its children if the parent dies. The renderer waits for process isolation before spawning any GPU work. The existing Troofs GPU lock serializes the queue with desktop/Troofs jobs.

Each immutable request has a cached plan, frozen inputs, per-stage journal, and verified result. A crash resumes stages/chunks that the underlying recipe supports. Corrupt/changed inputs or a crash during initial recipe customization fail closed for operator attention; they are not destructively recreated. Retry in the admin UI reuses saved work. It does not ask the model to rewrite a failed plan. To repair a creative plan, update its private `plan.json` only before production has started; changed frozen production inputs require a new request.

For a measured incomplete ending at the arrangement stage, a new composition of at most 268 seconds can make one automatic recovery attempt with 32 extra seconds (maximum 300). `ending-repair.json` pins the original inputs, evidence and manifest; the new attempt has a separate work folder and seed. It keeps all lyrics and requests twelve seconds for a resolved final chord. The original audio remains intact. Subsequent retries resume the new attempt; they never start an unbounded sequence of regenerations. If that attempt also fails, or the song is already too long for this remedy, it remains Needs attention for an ending/arrangement revision. No fade is used to conceal an unfinished phrase.

State writes use unique temporary files in the same directory, flush to disk, and retry transient Windows access/sharing errors for up to three seconds before failing. Progress display writes are best-effort so a reader or antivirus briefly holding `progress.json` cannot terminate GPU work. Durable stage journals still require successful writes.

The state sequence is `queued → processing → completed → publishing → published`. Processing cancellation uses `cancel_requested → canceled` after owned processes stop. `publishing` is a short finalization step: uploads and catalog writes are retried, not canceled halfway through. A missing completed file must be restored from that PC's saved output before publication can continue.

MP3s are uploaded to `legauntt/yehry3`, release `distonyc-v1`, with request- and hash-derived filenames. Existing assets are verified, never overwritten. The PC and API both verify the public bytes. Mongo publishes the song atomically, making it playable/votable immediately. The worker then merges the song into `catalog.json` on `talandar` with a SHA precondition, preserving concurrent changes. That commit triggers Azure and updates the fallback catalog. If this final merge fails, the next scheduled run retries it without rendering again. WAVs, stems, logs, and model files remain on the PC.

New publications also include a lyrics sheet, line cues and collection tags in the same result metadata. Original lyrics come from the frozen render specification; source-guided renditions reuse the saved source transcription, labeled as potentially imperfect. `lyric_timing.py` monotonically aligns that sheet to the retained final-vocal word timestamps and publishes only bounded `{line, start, end}` cues. Formatting, timing and export need no additional model, transcription call or render. The worker saves a convenient text copy under `Music\troofs\lyrics`, refuses to overwrite a different existing sheet, and excludes raw words, confidence values and local paths from public metadata. The website links `/lyrics/?song=<song-id>` from the main list. `backfill_lyric_cues.py` recreates the audited catalog cues from saved productions without changing audio.

For a correction after publication, `sync-lyric-cues.ps1 -Catalog <catalog.json> -Song <song-id>` sends the audited cues directly to Chairlift. The API requires an exact match with the existing lyric text and kind, updates Mongo immediately, and leaves the immutable render result untouched. `-Write` separately updates the local fallback catalog; collect those fallback changes into one later commit so cue corrections do not each require an Azure deployment.

## Installed files and controls

Installation: `%LOCALAPPDATA%\Distonyc`. `config.json` contains paths and the worker ID. `worker-credential.xml` is DPAPI protected. `state\health.json` reports the last run; `state\worker.log` and `state\jobs\<request-id>\` contain private logs and journals. Full audio exports remain in `Music\troofs\mp3s` and `Music\troofs\wavs`.

```powershell
Get-ScheduledTask -TaskName 'Distonyc Worker'
Get-ScheduledTaskInfo -TaskName 'Distonyc Worker'
Get-Content "$env:LOCALAPPDATA\Distonyc\state\health.json"
Disable-ScheduledTask -TaskName 'Distonyc Worker' # Pause future polls; current work continues.
Enable-ScheduledTask -TaskName 'Distonyc Worker'
Start-ScheduledTask -TaskName 'Distonyc Worker'
```

Use the admin page to cancel the current song. Do not delete its work folder. Task Scheduler and the singleton lock prevent overlapping runs; the worker's own process-tree isolation handles unexpected termination. The admin page shows the worker's last heartbeat and each request's current stage.

To follow the current song's generation log in PowerShell:

```powershell
& "$env:LOCALAPPDATA\Distonyc\logs.ps1" -Follow
```

The helper chooses the active job, or the most recent saved job when idle. **Ctrl+C only stops watching; generation continues.** Use `-Kind planner` for the saved creative planning log, `-Kind progress -Follow` for a compact stage/percentage view, or `-List` to find older jobs. Add `-JobId '<request-id>'` to inspect one specific song. Raw files are `state\jobs\<request-id>\renderer.log`, `planner.log`, and `progress.json`; `state\worker.log` records the task wrapper's output and may be empty during normal generation. These logs stay on this PC.

To update installed code, wait for the task to be idle, then run `pc-worker\install.ps1 -Start`. Installation preserves config, credentials, and state. `run.ps1` loads the DPAPI credential, starts Python, and removes the environment value afterward. Updating the source checkout alone does not change the installed worker. CLI/model/recipe path changes require an explicit local config update.

The fallback catalog publisher copies the server's `publishedAt` timestamp from the completed publication response. Older responses without that field remain supported and do not invent a release time. Install the matching `publish.py` update during an idle worker update for future fallback entries to retain their ages immediately, before the website API responds.

Refresh the basis inventory with `scripts/sync-basis-catalog.py` (see `--help`) and deploy matching JSON files to both repositories, then reinstall the worker's copy. New generated tracks enter the listening catalog; only files actually in `gatsby-opus/static` enter this basis inventory.

## Validation

### Automatic audio lyric views

`transcript_service.py` is a separate post-publication companion, installed under
`%LOCALAPPDATA%\Yehr3Whisper`. It does not change the Distonyc worker runtime,
credentials, rendering queue, written lyrics or audio. The `yehry3 Whisper
Transcripts` scheduled task invokes `pythonw.exe` without a terminal window at
logon and every two minutes. It uses the existing GitHub CLI login to read the
published catalog and fast-forward sanitized `lyric-transcripts/*.whisper.json`
commits; concurrent publication is retried against the latest tree. It checks the
live archive list before recognition and publication. Archived entries are never
updated, and an unavailable archive list stops work until a later retry.

Install from the deployed revision, with the existing local faster-whisper tools
and downloaded `large-v3-turbo` model:

```powershell
.\pc-worker\install-transcripts.ps1 -SpeechRoot 'C:\Users\Jesse\Music\One More Round - extended' -Cache 'C:\Users\Jesse\Music\troofs\whisper-catalog-20260926' -Start
```

CPU is the default (four threads, below-normal priority). `-Device cuda` uses
private NVIDIA DLLs from `speech-cuda/bin`, installed separately with
`python pc-worker/install_whisper_cuda.py --root <speech-root>/speech-cuda`. It takes
the production renderer's existing GPU lock and exits its model process between
songs so rendering can proceed. That installer verifies pinned official NVIDIA
archive checksums and does not alter global PATH. `-Disabled` stages the companion
without running it. Updating it requires only this task to be idle.

`health.json`, `service.log`, `jobs/` and `state.json` inside the companion's own
directory show progress and errors. Failed songs retry after 30 minutes; after
three failures they retry daily. Existing valid transcripts are preserved. The
private recognition cache is keyed by recording, model, recipe and input identity.
No listener review is implied. Recognition uses actual audio without lyric prompts
and automatically detects language. Missing or differently trimmed converted
stems use the verified released MP3; the public view names its source. Empty
recognition is a result with no timed lines, never a copy of the written sheet.

For a resumable local backfill of active songs (archived entries are excluded):

```powershell
python pc-worker/transcribe_catalog.py --catalog catalog.json --basis-root <basis-root> --speech-root <speech-root> --cache <private-cache> --output lyric-transcripts
```

Add `--device cuda --studio-dir <studio-dir> --engine-root <worker-engine-root>
--cuda-root <speech-root>/speech-cuda` for coordinated GPU processing. The command
only writes local drafts; the normal website build/deployment publishes them.
Run `python -m unittest -v test_transcript_service test_transcribe_performance`
from `pc-worker` to verify source validation and conflict-safe publication.

### Existing worker checks

Lyric timing selects retained transcripts by agreement with the written sheet and supported line coverage. It omits lines without word support or plausible duration. Run `python -m unittest -v test_lyric_timing test_audit_lyric_cues test_lyrical_ending test_publish` before installing `lyric_timing.py` with `install.ps1 -RuntimeOnly -Files lyric_timing.py` during an idle worker/monitor window. New songs can publish readable lyrics with partial or no timing.

For an existing catalog, `audit_lyric_cues.py --catalog <catalog.json> --studio-root <production-parent> --report <private-report.json>` is read-only. `--identities <private-hashes.json> --fetch-identities` verifies legacy public MP3 identities. `restore_lyric_evidence.py --report <report> --basis-root <basis-root> --speech-root <speech-tools-parent> --cache <private-cache> --workers 4` recreates missing timestamps from verified retained vocals on the CPU (at most eight decoder threads, below normal Windows priority); reruns reuse completed evidence. Re-audit with `--evidence-cache <private-cache>`, then apply the reviewed report with `--apply <report> --write` and optionally `--sync-config <installed-config>` using the existing DPAPI worker credential. Deploy Chairlift's empty-cue support before clearing entire cue lists. Keep the report for rollback and word-level listening follow-up; automatic transcript agreement does not establish lyric fidelity.

`sync-lyric-cues.ps1 -AuditReport <report> -Catalog <catalog> -Root <installed-worker> -CodeRoot <source-worker>` loads the protected worker credential for a reviewed batch. Read it back with `audit_lyric_cues.py --catalog <catalog> --apply <report> --verify-base https://chairlift.fly.dev/yehry3`; add `--static` and use `https://yehry3.app` to verify the deployed fallback.

`python -m unittest -v test_worker.py test_quality.py test_recovery.py test_queue_monitor.py` checks idle behavior, lost responses, expired claims, plan reuse and capability upgrades, safe paths, conflict-aware catalog merges, Windows process-tree cancellation, concurrent state writes, transient sharing failures, source discovery, bounded recovery and warning rollout. Run `test_vocal_evidence.py` with the saved voice Python for its NumPy/SciPy signal tests. Chairlift's Mongo integration tests cover leasing/fencing, cancellation, publication, permissions, password rotation, and optional basis validation. Browser tests cover zero/five selections, the limit, sorting, review persistence, and mobile layout.

`worker.py --verify-existing <completed-work-folder>` is an **operator-only delivery test** that exercises the queue and upload path using an existing technically verified export. It is not accepted from website input and is never in the scheduled task arguments. It does not prove a fresh creative render or human listening quality.

## Musical warnings and real failures

The versioned `quality_finish.py` adapter changes only the known 13-second instrumental-outro assertion while executing the original hash-checked finisher. `quality_configure.py` makes the 9.5-second instrumental-break limit advisory while retaining minimum vocal span and every ending check. Original frozen scripts and manifests remain unchanged; `arrangement-quality-policy.json` and `quality-policy.json` record the policy and warnings. Warnings travel through the verified result, Mongo, public queue, lyric sheet and fallback catalog. Real renderer failures save `renderer-error.json`; the admin card displays the actual cause with **Retry saved work**, and flushes the latest progress stage before marking failure. Publication outages retry automatically. Cutoff endings have the single bounded recovery described above; other deterministic audio failures wait for an explicit retry.

Rollout compatibility: enable `instrumental_break_warnings: true` in the local worker config only after deploying Chairlift's `long_instrumental_break` metadata support and the website notice. It defaults to false so installing local reliability and recipe fixes cannot send an unsupported issue code to the older production API. Existing long-outro notices continue to work throughout the rollout.

### Resolved musical choices

New plans include bounded musicalSettings from the same planning call: genre, instruments, meter, structure, performance, energy and lyricWorkflow. This is a public summary of the arrangement/lyrics, independent of requested generation controls and never a render override. Unknown/inapplicable choices are empty. Legacy saved plans remain valid and unchanged, including frozen render inputs and pending review offers. The public projection, Chairlift and fallback catalog retain the summary without private notes or paths. Deploy the compatible API and site before installing musical_settings.py, plan_schema.py, planner.py and public_plan.py during an idle worker update; preserve other installed files. Tests cover automatic/explicit choices, one-call reuse, legacy plans and public allowlists.

The September 17 musical-settings backfill covers 78 existing public plans. The reviewed manifest in backfills/musical-settings-20260917.json pins each recording URL and original plan hash. Every prose value is an excerpt from its saved arrangement; section order comes from the original lyric headings. Unknown writing approaches/meters stay blank. backfill_musical_settings.py defaults to validation only; --write adds the summaries to a supplied catalog and --sync --config sends them through the worker-authenticated published-plan endpoint. It validates the whole batch before writing, never rewrites local plan/render inputs and rejects different existing summaries. Deploy the API’s additive summary support first. The older saved-plan backfill preserves these summaries.

Manual song length accepts 69–666 whole seconds with Local ACE and 69–600 with Eleven Music, whose provider maximum remains 600 seconds. Local lengths above 600 use connected movements and require one composition choice. Explicit short lengths work without supplied lyrics, including lyric approval and composition previews. Blank/Auto retains the existing duration distribution and submitted-lyrics exception.
