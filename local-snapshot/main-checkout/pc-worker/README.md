# Distonyc on Windows

Optional request materials preserve the installed `request-materials-v1` capability,
private lyric sheets and reviewed reference snapshots. Exact-word validation and
the existing three-attempt `material-planning-attempts.json` budget remain in force.
The general planner normalization, note snapshot and recovery policies apply alongside
them; installing recovery must not replace the newer lyric/publication helpers.

Preserve-mode planning normalizes a small allowlist of equivalent standalone section
labels (`[Turn]` → `[Bridge]`, `[Final Chorus]` → `[Chorus]`, and common pre/post-chorus
spellings) before validation. Every supplied word, spelling, punctuation and order still
has to match; arbitrary bracketed text and inline labels are not discarded. Errors name
the first mismatched word and flag unsupported headings. Raw outputs and the three-attempt
journal stay intact, and newly valid retained outputs can recover after that budget is
exhausted without another model call. A valid saved response is also reused immediately
when its invocation reports an error. Accepted frozen plans are never normalized again.
Validation: `python -m unittest -v test_request_materials.py test_planner.py test_admin_notes.py test_worker.py`.

Submitted lyric sheets can use **60–119 seconds** when their length calls for a compact
song. Other originals retain the 120-second minimum; reference links alone do not lower
it. The saved suggestion budgets about 90 sung words/minute (150 for requested rap/spoken
word), plus ten seconds for the ending, with a 60-second floor. Explicit requested length
still takes priority, and preserve mode retains its maximum pacing check. The contextual
schema, saved-plan validator and native engine agree on the range. Existing frozen plans
keep their durations. See `LYRIC-PLANNING.md` for the operator-only, single shorter attempt
available after a sparse-vocal failure before voice conversion.

The **Distonyc Worker** scheduled task polls Chairlift every two minutes and at sign-in. Windows starts it without a visible window, ignores overlapping triggers, and retries failures three times at five-minute intervals. It runs with Jesse's ordinary interactive Windows account; the PC must be awake and signed in. It does not wake the PC or require a stored Windows password.

Both scheduled tasks start `launch_hidden.py` with the configured Python's sibling
`pythonw.exe`. It creates PowerShell's console hidden before the process starts;
starting PowerShell directly with `-WindowStyle Hidden` can briefly flash a terminal.
The launcher waits and returns the script's exit code, preserving task overlap and
retry behavior. Existing worker/monitor logs remain in use; startup errors are saved
in `state/worker-launcher.log` or `state/monitor-launcher.log`. When first updating a
selected set of files, include `launch_hidden.py`, `install.ps1`, and
`install-monitor.ps1`, then run `install-monitor.ps1` to update the monitor action too.

## Queue monitor and automatic recovery

The separate **Distonyc Queue Monitor** task checks all submitted requests every five minutes and at sign-in. It groups failures by their saved inner cause, retries supported recoveries, and tracks publication. Empty scans make no model calls. Jesse's September 13 policy adds one bounded shepherd consultation for eligible failures that the built-in remedies cannot resolve.

### Reliability and automatic shepherd (September 13)

`automatic_shepherd: true` consults the saved shepherd/triage skills once per request, using `shepherd_model` (default: the configured planner model). `shepherd_skill` names the local shepherd `SKILL.md`. This diagnostic call has a 90-second timeout, structured output and no shell, web, apps, credentials or file-editing tools. Trusted code executes supported saved-work retries. Missing material, credentials, provenance/integrity failures and exhausted repairs remain operator work; this fallback cannot apply arbitrary code edits. `jobs/<id>/shepherd/` retains the input, decision, log and one-call budget. Consultation never resets another recovery budget.

The monitor follows the selected composition/ending folder and failed stage log. It can reuse normalized rejected planner output and resume frozen work through the UTF-8 and musical-spacing policies. Queue-full responses spend no retry attempt; lost responses reconcile against the authoritative version. Cancellation and active leases prevent action. `--observe-only` makes no queue writes or model calls.

With `recovery_status_api: true`, failures initially display **Recovering automatically**. The monitor renews this hint while a supported retry/cooldown is pending, or marks **Needs attention** when intervention is needed. Hints expire after 20 minutes if monitoring stops. Deploy Chairlift and the frontend before enabling it. Queue states, capacity, versions and leases remain authoritative.

`verify_recovered_publication: true` checks one recovered delivery per scan: MP3/WAV hashes, published result, public release hash, fallback merge, deployed catalog entry and ranged playback response. Publication and full delivery verification are reported separately. No song is rerendered for a catalog outage.

Each worker failure has an immutable `jobs/<id>/failures/*.json` record. Monitor JSON includes `reliability_72h`, counting recovered and canceled failures from server history. `reliability_audit.py --config <config> --snapshot <private-server-snapshot> --output <private-directory>` produces a detailed audit. Keep private snapshots out of Git.

Install reviewed files with `install.ps1 -Files <explicit filenames>`. Unselected files are preserved; replaced files are backed up under `state/installations/`. `runtime-release.json` records installed hashes. Both launchers verify those hashes and the three-attempt/key-normalization planner contract before running, detecting partial updates and older planners. Wait for both tasks to be idle and pause future triggers during installation. Preserve config, credentials and recovery ledgers.

| Cause | Automatic action |
| --- | --- |
| Verified local export / publication failure | Resume publication of the same files. |
| Short vocal dropout | First distinguish conservatively verified stereo backing bleed from source voice. For genuine loss, render up to three short passages, totaling at most four seconds, with context and saved V6. Preserve every sample outside the repair. If the bounded repair cannot resolve it, publish the best retained performance with a visible vocal issue notice after the remaining integrity checks pass. |
| Unfinished ending | Use the existing one-time longer composition recovery. Retain the original attempt. |
| Long instrumental gap or outro | New compositions can try one alternate arrangement before voice conversion, as described below. Otherwise retain the advisory policies and publish the musical notice with the song when the remaining checks pass. |
| GPU memory, timeout, connection or sharing error | Resume saved stages after cooldowns of 15 and 60 minutes. |
| Changed inputs, unsupported plan or unknown cause | Keep diagnostics in the review report; do not repeat the same failed action. |

Each request gets at most three monitor retries per policy version, and each deterministic musical recovery gets one attempt. A scan requeues at most two requests. Active leases, cancellations and changed server versions are respected. Interrupted vocal repairs resume from cached stages and retained original stems. `automatic_vocal_repair: true` in the installed config enables the renderer hook; setting it false disables new automatic voice repairs.

Jesse's default is to publish a playable song with a visible issue notice when a musical repair cannot succeed. `vocal_dropout_warnings: true` enables that fallback after the API/site warning contract is deployed. V6 first receives its bounded passage repair; versioned voices that do not have a compatible passage repair proceed directly to the warning fallback. The fallback pins the retained source, backing and converted vocal hashes, leaves the audio intact, and retains the measured dropout duration in the report. The selected frozen finisher remains model-specific, and final delivery relaxes only the named dropout guard; invalid/changed files and every other export integrity failure still require a usable file before publication.

`vocal-evidence.json` records raw missing-window measurements and any conservatively identified separator bleed. Exclusion requires no source pitch in fresh left/right/mid contours, at least 98% low-frequency energy, very quiet upper-band energy, diffuse stereo, and a matching backing tone with at least 0.95 correlation in both channels. F0=0 alone never exempts a vocal. The original dropout thresholds remain; genuine consonants, quiet center vocals and unresolved windows continue through repair or the visible-warning fallback.

Private reports live in `%LOCALAPPDATA%\Distonyc\state\monitor\`: `report.md` is readable, `report.json` contains current category counts, `ledger.json` retains causes/attempts/resolutions and seven days of snapshots, and `health.json` plus `monitor.log` show the monitor's own status. A successful retry is counted as resolved only when the request is published. Bump `POLICY_VERSION` after changing a recovery approach to allow a new bounded retry budget while retaining the old evidence.

The monitor uses a separate current-user DPAPI credential in `monitor-credential.xml`; it authenticates through the normal admin API and never bypasses queue version or ownership checks. Prepare that credential locally, copy the worker code while the worker is idle, then run `install-monitor.ps1 -Start`. Existing `install.ps1` updates monitor files along with the worker without deleting its credential or ledger. Use `Disable-ScheduledTask -TaskName 'Distonyc Queue Monitor'` to pause automatic requeueing, or `Start-ScheduledTask -TaskName 'Distonyc Queue Monitor'` for an immediate check. Both tasks run hidden while this PC is awake and Jesse is signed in.

## What uses a model

An empty queue makes one API request and exits. A new confirmed brief makes **up to three schema-constrained Codex planning calls**, using the saved CLI login and `gpt-5.6-terra` with medium reasoning. The installed `config.json` sets `planner_model`; `planner.py` explicitly passes `model_reasoning_effort="medium"` and ignores the CLI's user config so a global preference cannot override the queue launcher. The model chooses a supported recipe and writes the title, complete lyrics when needed, tempo, key, and arrangement. Shell, web, apps, and multi-agent tools are disabled for that call. Submitted text stays in JSON; it never becomes executable code. The validated plan is saved and reused after restarts.

Local audio models still perform composition, separation, Tony V6 voice conversion, and the relevant arrangement stages. Those are fixed Python recipes, not a coding agent making decisions at every step. Polling, priority, locking, stage execution, retries, cancellation, technical checks, MP3 uploads, catalog updates, and Azure deployment run as code. There is no model call per poll or upload. A valid first result stops the loop immediately. Invalid JSON, rejected settings, or a failed invocation feed the exact validation error or structured CLI error and prior output into the next turn. Equivalent notation is normalized locally before spending another turn. The three-attempt limit includes the initial call, is persisted before each invocation, and survives restarts and manual retries. Each output and log is retained separately; a completed valid response is reused even if its invocation reported an error. Cancellation and lease loss stop the loop. Exhausted attempts stay available for review, and started audio is never replanned by this loop.

`plan_schema.py` defines the planner's JSON output contract, including enumerated musical keys, supported vocal-reference styles, integer tempo/duration limits, and text-length limits. Before accepting fresh or previously rejected output, the worker normalizes equivalent notation (`C-sharp minor`, `C♯ minor`, and `C#m` become `C# minor`), case/spacing in recipe and style, and whole-number numeric spellings. It does not guess missing keys/modes, substitute genres, clamp values, or change frozen production plans. Validation errors name the field and accepted format. A saved result that now validates is reused on retry with its original lyrics and arrangement, without another model call; the original planner output remains intact. Regression tests: `python -m unittest -v test_planner.py`. Attempt budgets and errors are recorded in `planner-result*-attempts.json`; correction outputs use `-attempt-2` and `-attempt-3` filenames. Each explicitly supported legacy capability upgrade has its own bounded planning cycle.

The same planning call marks a song for the Fear & Hunger collection only when the games, characters, or story are clearly its subject. New plans include this boolean; older saved plans remain valid without rewriting their frozen inputs. All generated songs also remain in Distonyc requests.

Publication includes the original confirmed idea, direction, preferences, and basis-song titles for the public “Original prompt” sheet. The worker copies these allowed fields from the saved request; Chairlift derives the same snapshot from Mongo. Private notes, identities, leases, and local file paths are excluded. This adds no model call and does not modify the cached creative plan or recording.

## Private admin notes

The authenticated worker receives each request's private admin note. On first planning, the note is supplied to the model as additional creative direction, separately from the public brief. Creative corrections in the note take precedence over conflicting submitted preferences, within the supported recipes and mandatory Tony V6 voice rules. Notes cannot authorize tools or operational actions.

Save notes before planning starts. The first planning input snapshots the note; retries use that snapshot and existing saved plans remain unchanged when a note is edited. Older saved inputs without a note keep their original behavior. Notes remain excluded from submitter responses, the public queue, catalog metadata and Original prompt sheets, although their creative direction can influence the published song.

## Requests and limits

### Optional Arabic/throat vocal accent

Fresh originals and reinterpretations can use `vocal_accents` for one short 4–9-second phrase in an intro, bridge, or sung outro. Most plans leave this array empty. It is an occasional vocal color; the main singing, instrumentation and song language stay directed by the brief. `words` contains 2–8 words actually present in the relevant song lyrics, including a retained Tony hook when appropriate. Plan connected vowels and smeared consonants with a recognizable trace of those words, rather than stock chant filler. A sung outro accent follows the usual final-vocal timing window.

Jesse preferred the first half of the 19-second `/arabic` experiment. The private approved reference is its first 9.5 seconds, stored under `troofs-studio/vocal-techniques/arabic-ornament-v1/`. `vocal_accents.py` snapshots and hashes that reference into selected new jobs; `vocal_accent_runtime.py` appends it to the existing composition reference without replacing selected basis audio. The original local LM draft is retained and the requested caption reaches synthesis unchanged. Full-catalog Tony V6 conversion remains mandatory. Reference PCM is never spliced into the final song, and no training or new source singer blend occurs.

This is experimental generation guidance, including the target duration and section placement; no automatic check establishes that the style was realized or stayed exactly within that interval. The existing conversion and integrity checks remain. Older plans, started recordings, faithful renditions and the published sample are unchanged. A long suite selects only one movement for the accent, so it cannot repeat automatically in every chapter. Sample-only experiments continue to belong exclusively on `/arabic`; a complete requested song using the treatment follows its normal publication route.

Validation: `python -m unittest -v test_vocal_accents.py test_planner.py test_admin_notes.py test_duration.py test_recovery.py test_composition_ending.py test_worker.py`. The audio-reference test uses the saved voice Python and approved local WAV, with no music-model invocation.

- The saved full-catalog **Tony V6 voice is mandatory**. No new voice training occurs.
- Zero basis songs produces an original. Up to five files from the complete local basis library can condition the composition. The library is `C:/Users/Jesse/Music/Tony C basis recordings`, outside all repositories; installed `config.json` selects it with `basis_root`. The dropdown sorts the inventory by title; IDs derive from preserved relative paths, not positions. Audio is never uploaded to the planning model.
- A single basis song can also inspire a new original with a new subject and lyrics. It does not force a faithful remake. Altered/wrong lyrics and spoken introductions can use the existing single-source reinterpretation recipe; an acoustic rewrite retains newly generated acoustic instrumentation. Missing optional cached-stem fields fall back to provenance-checked completed separation journals when available. Known unstarted capability rejections get one retained, journaled planning upgrade; started recordings are preserved.
- Original songs support 2–10 minutes in one render, and connected suites up to 19 minutes, with genre instructions, with complete lyrics and a resolved ending. Selected references influence arrangement/timbre; they do not guarantee preserved melodies.
- A single-source genre reinterpretation, including rap, uses the saved catalog transcription and isolated vocal references. It preserves recognizable hooks and motifs while composing new lyrics, timing and accompaniment for the requested genre, then applies Tony V6. It requires cached source material; it does not promise unchanged melody. The old, unstarted missing-rap-recipe rejection is upgraded once a supported plan is available, retaining the original rejection in `plan-before-rap-support.json`.
- A faithful or acoustic rendition uses exactly one selected source, currently 5–300 seconds. Acoustic reconstruction is experimental and must pass the existing strict checks.
- The existing source-specific quartet recipes support Ball and Chain, One 4 the Road, and Medusa. Their established arrangements are preserved. An unsupported faithful rendition, new quartet arrangement, or incompatible multi-source reconstruction becomes **Needs attention** with an explanation. It is never silently replaced with unrelated music. Add/review a trusted recipe to expand that boundary.
- Existing Troofs checks cover hashes, voice continuity, peaks, tails, and both complete MP3/WAV outputs. They do not constitute a human listening review. Long instrumental outros and breaks in rock/acoustic-reference compositions are advisory: the complete, otherwise valid song is published with a **Has issues** notice showing the measured lengths. Minimum vocal coverage, missing vocals, incomplete endings, invalid audio, peak limits and changed inputs still stop publication. Opera retains its separate interlude policy.

## Durable production and publication

Mongo holds the queue and metadata; the PC receives only narrow worker API access. A random worker credential is stored with Windows DPAPI (`Export-Clixml`) for the current user, separate from the site's admin login. Only the trusted parent reads it. The PC never receives the production Mongo connection string. Do not copy the credential XML to another Windows account.

Claims use client-saved IDs and random tokens, three-minute leases, and heartbeats every 25 seconds. A worker stops its owned process tree after cancellation, a rejected lease, or 90 seconds without a successful heartbeat. Windows Job Objects also stop its children if the parent dies. The renderer waits for process isolation before spawning any GPU work. The existing Troofs GPU lock serializes the queue with desktop/Troofs jobs.

Each immutable request has a cached plan, frozen inputs, per-stage journal, and verified result. A crash resumes stages/chunks that the underlying recipe supports. Corrupt/changed inputs or a crash during initial recipe customization fail closed for operator attention; they are not destructively recreated. Retry in the admin UI reuses saved work. It does not ask the model to rewrite a failed plan. To repair a creative plan, update its private `plan.json` only before production has started; changed frozen production inputs require a new request.

For a measured incomplete ending at the arrangement stage, a new composition of at most 568 seconds can make one automatic recovery attempt with 32 extra seconds (maximum 600). `ending-repair.json` pins the original inputs, evidence and manifest; the new attempt has a separate work folder and seed. It keeps all lyrics and requests twelve seconds for a resolved final chord. The original audio remains intact. Subsequent retries resume the new attempt; they never start an unbounded sequence of regenerations. If that attempt also fails, or the song is already too long for this remedy, it remains Needs attention for an ending/arrangement revision. No fade is used to conceal an unfinished phrase.

State writes use unique temporary files in the same directory, flush to disk, and retry transient Windows access/sharing errors for up to three seconds before failing. Progress display writes are best-effort so a reader or antivirus briefly holding `progress.json` cannot terminate GPU work. Durable stage journals still require successful writes.

The renderer enables Python UTF-8 mode for recipe subprocesses and their descendants. This lets legacy frozen recipes read saved Unicode lyrics consistently on Windows without changing their scripts or input hashes. Failure notices retain the innermost exception, including encoding and filesystem errors, instead of just the stage wrapper.

The state sequence is `queued → processing → completed → publishing → published`. Processing cancellation uses `cancel_requested → canceled` after owned processes stop. `publishing` is a short finalization step: uploads and catalog writes are retried, not canceled halfway through. A missing completed file must be restored from that PC's saved output before publication can continue.

MP3s are uploaded to `legauntt/yehry3`, release `distonyc-v1`, with request- and hash-derived filenames. Existing assets are verified, never overwritten. The PC and API both verify the public bytes. Mongo publishes the song atomically, making it playable/votable immediately. The worker then merges the song into `catalog.json` on `talandar` with a SHA precondition, preserving concurrent changes. That commit triggers Azure and updates the fallback catalog. If this final merge fails, the next scheduled run retries it without rendering again. WAVs, stems, logs, and model files remain on the PC.

New publications also include a lyrics sheet and collection tags in the same result metadata. Original lyrics come from the frozen render specification; source-guided renditions reuse the saved source transcription, labeled as potentially imperfect. Formatting and export need no additional model or transcription call. The worker saves a convenient text copy under `Music\troofs\lyrics`, refuses to overwrite a different existing sheet, and sends only the lyric text/source label to Mongo and the static catalog. The website links `/lyrics/?song=<song-id>` from the main list. Pre-upgrade publications can finish with their original metadata; backfill their sheet separately rather than changing a completed artifact mid-retry.

## Length variety

Fresh original/reinterpretation plans receive a deterministic, saved length suggestion in `duration-policy.json`: 67% near four minutes (a triangular 180–300-second distribution centered at 240), 15% at 120–180 seconds, 17% at 300–480 seconds, 0.9% at 540–600 seconds, and 0.1% at 1140 seconds. Suggestions are rounded to five seconds and stable across retries. An explicit duration request takes priority. Lyrics and musical development should fill the form; do not pad short material with long instrumental tails. Existing plans and faithful source timing remain unchanged.

`duration_runtime.py` widens only the two recognized planning checks in memory to 120–600 seconds, preserving the installed engine and recipe files. `duration_ending.py` retains the quiet-tail and isolated-vocal checks while allowing the minimum duration of a two-minute composition. Unknown validator shapes fail closed for review.

The music backend supports at most ten minutes per render. Above that, the planner writes 3–6 complete, connected movements of 120–300 seconds, with a common key/pulse, recurring hook and evolving narrative. Five 228-second movements make a nineteen-minute suite. Each uses the existing Tony V6 conversion and bounded recovery. `longform.py` journals and resumes finished movements, stores their audio privately, preserves their complete PCM including quiet tails, and masters one MP3/WAV for publication. Only that complete song enters the catalog. The combined lyric sheet stays within 16000 characters. Chapter gaps and final-outro warnings are retained; there is no promise of identical generated melody across independently composed movements.

The requested creative maximum is 19 minutes. The publisher accepts verified exports up to 24 minutes/64 MB to accommodate bounded ending repairs and natural timing drift without truncating audio. That delivery allowance does not change the creative length distribution. The suite finisher checks hashes, full encoded duration, peaks and the final decay. A crash/cancellation retains completed movements and frozen inputs; it cannot silently restart the suite with different material.

Validation: run `test_duration.py` with the worker tests and `test_longform_audio.py` using the saved voice Python. These cover native planning at 2/4/8/10 minutes, the 19-minute movement contract, weighted suggestions, restart/cancellation, and a full 19-minute synthetic PCM-to-MP3 assembly through the actual delivery verifier. Synthetic checks establish file and workflow integrity; future real songs provide the musical assessment.

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

### Complete local basis library

Jesse's September 13 policy is to keep **every selectable basis recording downloaded locally**, outside Git checkouts and website build folders. The library is `C:/Users/Jesse/Music/Tony C basis recordings`. Preserve the inventory's `relativePath` values (`dvdp/`, `bonus/`, `butts/`, `heh/`, `tonify/mp3s/`) and IDs when relocating audio. Do not repopulate `gatsby-opus/static`: its former recordings are now immutable GitHub Release assets.

`sync_basis_library.py` downloads all 61 current inventory entries using the original release manifests, verifies exact byte sizes and SHA-256 hashes, and safely reuses verified local files. It refuses conflicting bytes and destinations inside Git. Run it from this directory:

```powershell
& 'C:\Python311\python.exe' -X utf8 .\sync_basis_library.py `
  --catalog "$env:LOCALAPPDATA\Distonyc\basis-songs.json" `
  --manifest 'C:\Users\Jesse\code\gatsby-opus\media\site-audio\manifest.json' `
  --manifest 'C:\Users\Jesse\code\gatsby-opus\media\tonify\manifest.json' `
  --destination 'C:\Users\Jesse\Music\Tony C basis recordings'
```

Add `--verify-only` to check the complete library without downloading. `verification.json` records each file's provenance/hash, and the combined `manifest.json` covers both original site audio and Tony V6 clips. Keep these reports and all audio outside Git; repository content is code and metadata only.

After verification, wait for worker and monitor tasks to be idle and pause future triggers briefly while updating installed configuration. Set `basis_root` and `basis_cache` to the library directory and `basis_release_manifest` to its `manifest.json`, preserving all other configuration and recovery state. Check all inventory entries through installed `worker.basis_files` in groups of at most five before restoring the task triggers. Never rewrite a started job's frozen paths or inputs during migration; retain required old-path copies until that job is delivered and record the relocation with its evidence.

When intentionally expanding the selectable inventory, inspect `scripts/sync-basis-catalog.py` and the source metadata before indexing the external library, then deploy matching JSON inventories to both repositories and the installed worker. Download and verify every newly selectable entry. New generated listening-catalog tracks do not automatically become basis selections. Missing files after a site migration require restoring exact manifest-pinned originals, not dropping selections or resetting a request's recovery budget.

## Validation

`python -m unittest -v test_worker.py test_quality.py test_recovery.py test_queue_monitor.py` checks idle behavior, lost responses, expired claims, plan reuse and capability upgrades, safe paths, conflict-aware catalog merges, Windows process-tree cancellation, concurrent state writes, transient sharing failures, source discovery, bounded recovery and warning rollout. Run `test_vocal_evidence.py` with the saved voice Python for its NumPy/SciPy signal tests. Chairlift's Mongo integration tests cover leasing/fencing, cancellation, publication, permissions, password rotation, and optional basis validation. Browser tests cover zero/five selections, the limit, sorting, review persistence, and mobile layout.

`worker.py --verify-existing <completed-work-folder>` is an **operator-only delivery test** that exercises the queue and upload path using an existing technically verified export. It is not accepted from website input and is never in the scheduled task arguments. It does not prove a fresh creative render or human listening quality.

## Musical warnings and real failures

Future plans target the **last sung syllable 8–12 seconds before the end**, instead of merely giving vocals a finish-by deadline. The same timing instruction reaches local composition at the start of the caption. `allow_long_instrumental_outro=true` honors an explicitly requested long ending; a genre such as cinematic synth-rock does not imply that preference. Legacy frozen plans remain valid and unchanged.

With `automatic_outro_retry: true`, a new original or reinterpretation with more than **20 seconds** after the last detected vocal gets at most **one alternate composition**, before any Tony voice conversion. This uses local music generation with the same supplied lyrics, duration, genre and V6 model, a separate seed/work folder, and stronger final-section pacing. It makes no additional Codex planning call. The original and alternate both pass the existing composition, separation, arrangement and ending stages. A natural trailing-silence trim is accounted for before deciding whether a retry is needed.

Select the alternate only if its measured outro is 2–13 seconds, improves by at least eight seconds, and does not materially worsen vocal coverage or instrumental breaks. If it fails or is not sufficiently better, finish the retained original and publish its remaining issue notice. No waveform is cut to satisfy this policy. Existing/started work, faithful renditions, explicit long-outro requests and the separate cutoff-ending recovery bypass this retry. Cancellation stops work; a restart resumes the same single attempt. `state/jobs/<request-id>/composition-ending-repair.json` retains the attempt budget, both measurements and input hashes, selected version, failure reason if any, and delivery outcome. Source changes invalidate that evidence. Voice dropout recovery follows the selected work folder. The retry adds one composition/separation pass only when needed; it does not convert both versions through Tony V6.

Validation: `python -m unittest -v test_composition_ending.py test_planner.py test_quality.py test_recovery.py test_worker.py test_queue_monitor.py`. The ending suite exercises the actual local engine's pause/resume boundary before its `prepare` voice stage, as well as retained fallback, cancellation, restart budgets, source tampering and explicit long-ending preferences. These checks establish workflow behavior, not subjective musical improvement; assess that on subsequent real requests.

The versioned `quality_finish.py` adapter changes only the known 13-second instrumental-outro assertion while executing the original hash-checked finisher. `quality_configure.py` makes the 9.5-second instrumental-break limit advisory while retaining minimum vocal span and every ending check. Original frozen scripts and manifests remain unchanged; `arrangement-quality-policy.json` and `quality-policy.json` record the policy and warnings. Warnings travel through the verified result, Mongo, public queue, lyric sheet and fallback catalog. Real renderer failures save `renderer-error.json`; the admin card displays the actual cause with **Retry saved work**, and flushes the latest progress stage before marking failure. Publication outages retry automatically. Cutoff endings have the single bounded recovery described above; other deterministic audio failures wait for an explicit retry.

Rollout compatibility: enable `instrumental_break_warnings: true` in the local worker config only after deploying Chairlift's `long_instrumental_break` metadata support and the website notice. It defaults to false so installing local reliability and recipe fixes cannot send an unsupported issue code to the older production API. Existing long-outro notices continue to work throughout the rollout.
