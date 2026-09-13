# Distonyc on Windows

The **Distonyc Worker** scheduled task polls Chairlift every two minutes and at sign-in. Windows starts it without a visible window, ignores overlapping triggers, and retries failures three times at five-minute intervals. It runs with Jesse's ordinary interactive Windows account; the PC must be awake and signed in. It does not wake the PC or require a stored Windows password.

## What uses a model

An empty queue makes one API request and exits. A new confirmed brief makes **one schema-constrained Codex planning call**, using the saved CLI login and `gpt-6-astra`. The model chooses a supported recipe and writes the title, complete lyrics when needed, tempo, key, and arrangement. Shell, web, apps, and multi-agent tools are disabled for that call. Submitted text stays in JSON; it never becomes executable code. The validated plan is saved and reused after restarts.

Local audio models still perform composition, separation, Tony V6 voice conversion, and the relevant arrangement stages. Those are fixed Python recipes, not a coding agent making decisions at every step. Polling, priority, locking, stage execution, retries, cancellation, technical checks, MP3 uploads, catalog updates, and Azure deployment run as code. There is no model call per poll or upload. An interrupted planning call can be retried if it never produced a saved plan.

The same planning call marks a song for the Fear & Hunger collection only when the games, characters, or story are clearly its subject. New plans include this boolean; older saved plans remain valid without rewriting their frozen inputs. All generated songs also remain in Distonyc requests.

Publication includes the original confirmed idea, direction, preferences, and basis-song titles for the public “Original prompt” sheet. The worker copies these allowed fields from the saved request; Chairlift derives the same snapshot from Mongo. Private notes, identities, leases, and local file paths are excluded. This adds no model call and does not modify the cached creative plan or recording.

## Requests and limits

- The saved full-catalog **Tony V6 voice is mandatory**. No new voice training occurs.
- Zero basis songs produces an original. Up to five files from `gatsby-opus/static` can condition the composition locally. The dropdown inventories every supported audio file and sorts by title; IDs derive from relative paths, not positions. Audio is never uploaded to the planning model.
- Original songs support 3–5 minutes and genre instructions, with complete lyrics and a resolved ending. Selected references influence arrangement/timbre; they do not guarantee preserved melodies.
- A faithful or acoustic rendition uses exactly one selected source, currently 5–300 seconds. Acoustic reconstruction is experimental and must pass the existing strict checks.
- The existing source-specific quartet recipes support Ball and Chain, One 4 the Road, and Medusa. Their established arrangements are preserved. An unsupported faithful rendition, new quartet arrangement, or incompatible multi-source reconstruction becomes **Needs attention** with an explanation. It is never silently replaced with unrelated music. Add/review a trusted recipe to expand that boundary.
- Existing Troofs checks cover hashes, voice continuity, peaks, tails, and both complete MP3/WAV outputs. They do not constitute a human listening review. A long instrumental outro is advisory: the complete, otherwise valid song is published with a **Has issues** notice showing its measured length. Missing vocals, incomplete endings, invalid audio, peak limits and changed inputs still stop publication.

## Durable production and publication

Mongo holds the queue and metadata; the PC receives only narrow worker API access. A random worker credential is stored with Windows DPAPI (`Export-Clixml`) for the current user, separate from the site's admin login. Only the trusted parent reads it. The PC never receives the production Mongo connection string. Do not copy the credential XML to another Windows account.

Claims use client-saved IDs and random tokens, three-minute leases, and heartbeats every 25 seconds. A worker stops its owned process tree after cancellation, a rejected lease, or 90 seconds without a successful heartbeat. Windows Job Objects also stop its children if the parent dies. The renderer waits for process isolation before spawning any GPU work. The existing Troofs GPU lock serializes the queue with desktop/Troofs jobs.

Each immutable request has a cached plan, frozen inputs, per-stage journal, and verified result. A crash resumes stages/chunks that the underlying recipe supports. Corrupt/changed inputs or a crash during initial recipe customization fail closed for operator attention; they are not destructively recreated. Retry in the admin UI reuses saved work. It does not ask the model to rewrite a failed plan. To repair a creative plan, update its private `plan.json` only before production has started; changed frozen production inputs require a new request.

The state sequence is `queued → processing → completed → publishing → published`. Processing cancellation uses `cancel_requested → canceled` after owned processes stop. `publishing` is a short finalization step: uploads and catalog writes are retried, not canceled halfway through. A missing completed file must be restored from that PC's saved output before publication can continue.

MP3s are uploaded to `legauntt/yehry3`, release `distonyc-v1`, with request- and hash-derived filenames. Existing assets are verified, never overwritten. The PC and API both verify the public bytes. Mongo publishes the song atomically, making it playable/votable immediately. The worker then merges the song into `catalog.json` on `talandar` with a SHA precondition, preserving concurrent changes. That commit triggers Azure and updates the fallback catalog. If this final merge fails, the next scheduled run retries it without rendering again. WAVs, stems, logs, and model files remain on the PC.

New publications also include a lyrics sheet and collection tags in the same result metadata. Original lyrics come from the frozen render specification; source-guided renditions reuse the saved source transcription, labeled as potentially imperfect. Formatting and export need no additional model or transcription call. The worker saves a convenient text copy under `Music\troofs\lyrics`, refuses to overwrite a different existing sheet, and sends only the lyric text/source label to Mongo and the static catalog. The website links `/lyrics/?song=<song-id>` from the main list. Pre-upgrade publications can finish with their original metadata; backfill their sheet separately rather than changing a completed artifact mid-retry.

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

Refresh the basis inventory with `scripts/sync-basis-catalog.py` (see `--help`) and deploy matching JSON files to both repositories, then reinstall the worker's copy. New generated tracks enter the listening catalog; only files actually in `gatsby-opus/static` enter this basis inventory.

## Validation

`python -m unittest -v test_worker.py` checks idle behavior, lost responses, expired claims, plan reuse, safe paths, conflict-aware catalog merges, and Windows process-tree cancellation. Chairlift's Mongo integration tests cover leasing/fencing, cancellation, publication, permissions, password rotation, and optional basis validation. Browser tests cover zero/five selections, the limit, sorting, review persistence, and mobile layout.

`worker.py --verify-existing <completed-work-folder>` is an **operator-only delivery test** that exercises the queue and upload path using an existing technically verified export. It is not accepted from website input and is never in the scheduled task arguments. It does not prove a fresh creative render or human listening quality.

## Musical warnings and real failures

The versioned `quality_finish.py` adapter changes only the known 13-second instrumental-outro assertion while executing the original hash-checked finisher. It retains the positive/finite ending check and every other assertion. Original frozen scripts and manifests remain unchanged; `quality-policy.json` records the policy and any warnings. Warnings travel through the verified result, Mongo, public queue, lyric sheet and fallback catalog. Real renderer failures save `renderer-error.json`; the admin card displays the actual cause with **Retry saved work**, and flushes the latest progress stage before marking failure. Publication outages already retry automatically; deterministic audio failures wait for an explicit retry to avoid repeatedly generating the same result.
