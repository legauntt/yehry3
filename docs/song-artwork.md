# Song cover artwork

Dashboard uses saved raster covers from `assets/artwork-catalog.js`. Clip art and the listener Redraw action are retired there. Newly published songs without a cover temporarily show a plain title sleeve. The legacy drawing engine remains for mixtape labels and its existing consumers.

The title sleeve is an ungenerated placeholder, never a completed cover. Every generated cover must depict a picture grounded in the full available lyrics, genre, original prompt and song plan. Typography, title cards, printed lyrics and word clouds are explicitly prohibited.

## Replace title placeholders while preserving pins

For the September 27 correction, preserve all existing saved images and all pinned songs. An audit fixes the eligible set so later catalog additions cannot silently expand a paid batch:

```powershell
node scripts/audit-song-artwork.mjs --output path/to/audit-before.json
npm run artwork:plan -- --from-audit path/to/audit-before.json --state path/to/generation
node scripts/song-artwork.mjs report --state path/to/generation
# After approving the concrete sources, prompts and estimated budget:
npm run artwork:run -- --from-audit path/to/audit-before.json --state path/to/generation --key-file "$HOME/wup.txt" --python "$HOME/.venvs/yehry3-imagegen/Scripts/python.exe" --budget 10
# Before publication, protect both initial pins and pins added during the run:
node scripts/audit-song-artwork.mjs verify-protected --baseline path/to/audit-before.json
```

`--from-audit` selects only the audit's unpinned text placeholders and implies `--exclude-pinned --placeholders-only`. Existing images are preserved even if votes or pin milestones otherwise qualify them for an upgrade. `--exclude-pinned` also overrides explicit redo requests, fails closed on missing pin counts, and checks the public summary endpoint before each paid call and just before installation. If a pin arrives during rendering, the generated master remains local and the original cover stays installed. Keep the before audit and run `verify-protected` immediately before publishing. It checks the exact metadata and image hashes for initial and current pinned songs.

For visual review, `artwork-contact-sheet.py AUDIT OUTPUT_DIRECTORY` renders the saved covers from an audit into numbered contact sheets. Review for actual pictorial content before publishing; a generated file existing does not by itself establish that the image meets the brief.

`scripts/song-artwork.mjs` is the maintained artwork program. It fetches the **full public song detail**, the same material used by Lyrics and Original prompt, and passes complete lyrics, the original request (including reference descriptions and supplied lyrics), and the full song planner output to `gpt-image-2`. Repeated long texts use lossless references; nothing is silently truncated. Missing sources are recorded. Oversized prompts or source-fetch failures are listed for review rather than generating from the title alone. It uses the installed Imagegen skill CLI, not a second SDK implementation.

## Reviewed alternatives for rejected covers

Individual rejected generation jobs remain reserved in the ledger for manual
review. A pass with no installed changes cleans its temporary checkout and lets
unrelated future songs proceed. Publication, protection and cleanup failures
still retain a pending worktree and stop unattended publication.

A provider rejection requires manual review. Read the full saved lyrics, original prompt and song plan, then author an actually non-explicit scene. Retain safe themes and musical character; abandon unsafe events rather than disguising them. The full sources and original rejection remain in the audit. Only the reviewed visual brief goes to the image provider for this alternative.

`--reviewed-briefs FILE` accepts a private JSON file with `version: 1` and a `songs` map keyed by song ID. Each entry requires `sourceHash` matching the current complete source packet, `kind: "non-explicit-scene"`, a review `rationale`, a pictured `scene`, `musicalContext` and descriptive `alt`. Changed source material must be reviewed again. This mode requires `--from-audit`, selects only listed unpinned placeholders, preserves saved images and cannot run in lifecycle mode. It does not automatically rewrite or retry failures.

```powershell
node scripts/song-artwork.mjs plan --from-audit audit-before.json --reviewed-briefs reviewed-briefs.json --state path/to/shared/generation
node scripts/song-artwork.mjs run --from-audit audit-before.json --reviewed-briefs reviewed-briefs.json --state path/to/shared/generation --budget 25 --budget-period cumulative --key-file "$HOME/wup.txt" --python "$HOME/.venvs/yehry3-imagegen/Scripts/python.exe"
```

If an alternative is also rejected, a separately reviewed `kind: "humorous-fallback"` may specify a neutral cartoon with a short sign such as BANNED. This is the narrow exception to the no-text rule: a pictured scene must dominate, not a title card. Never repeat the prohibited subject. Inspect each result before publication. Per-job `reviewed-brief.json`, prompt, master, source hash, brief hash and ledger receipt document the transformation and cost reservation; existing failed receipts are retained.

## Rules

- No existing image, zero votes and fewer than 10 listens: **basic**, low quality.
- No existing image and at least one vote, or 10+ listens: **emphasis**, medium quality.
- A real pin added **after 2026-09-27 22:39:48.5439589 UTC**: **monument**, high quality. This can replace an existing cover once. Existing pins do not qualify merely because they are still pinned.
- Otherwise preserve an existing image. Changing votes does not silently replace it. Explicit `--redo ID` supports requested replacements and retains the previous image file.

All treatments use 1024 × 1024 WebP. Monument means more detailed art direction and high rendering quality, not mandatory statue imagery. Chairlift's durable `artworkPinnedAt` records actual new pin insertions, survives unpinning, and ignores repeated pin requests. Existing pin records bridge rollout. Once a monument is installed, later pins do not generate it again.

## Run

Node 22+ is required. Install `openai` and `Pillow` in the Python environment used by the bundled Imagegen CLI. The CLI defaults to `~/.codex/skills/.system/imagegen/scripts/image_gen.py`; override with `--cli` if necessary. The generated master stays in the state directory; `prepare-cover.py` validates its dimensions and makes a quality-86 WebP for the website.

```powershell
# Read-only public API requests; save the full plan, sources and prompts. No paid calls.
npm run artwork:plan

# Paid calls, explicit key-file override, bounded cumulative estimated spend.
npm run artwork:run -- --key-file "$HOME/wup.txt" --python "$HOME/.venvs/yehry3-imagegen/Scripts/python.exe" --budget 10

# Limit to one song, or explicitly replace a supplied cover.
npm run artwork:plan -- --only SONG_ID
npm run artwork:run -- --redo SONG_ID --direction path/to/art-direction.txt

# After deployment, compare every saved cover and Dashboard module to the live bytes.
npm run artwork:verify
```

The default state directory is `~/output/imagegen/yehry3-artwork`; pass `--state` to choose another. Keep this directory across runs. It contains the latest `plan.json`, archived nonempty plans in `plans/`, each exact `sources.json` and `prompt.txt`, the generated master image, CLI logs, and a persistent `ledger.json`. These do not enter the public build. Only generated image assets and cover metadata do. Never commit the key file or use the key itself as a command argument. `--key-file` takes precedence over a stale environment key.

`--budget` is a **conservative estimated-spend ceiling**, not a new allowance each run and not a provider billing guarantee. The default `--budget-period cumulative` tracks this backfill against its $25 allowance. `--budget-period monthly` tracks a separate $40 allowance for each calendar month in America/Los_Angeles; the initial backfill does not consume that new monthly allowance. Reservations include UTF-8 byte-based input estimates plus 20% image-output headroom, using the September 27, 2026 GPT Image 2 prices. The bundled CLI does not expose actual usage. Failed or uncertain attempts keep their reservation. Existing output is reused without another API call. Failed or uncertain jobs require explicit `--retry`; a CLI/API failure is never bypassed or rewritten to evade content checks. The CLI is invoked once per job with one wrapper attempt; its installed SDK may still retry transport errors.

Use `--limit N` to cap new calls, `--concurrency 1..6` (default 3), and `--low-listens N` to change the threshold. Source packets and prompts are prepared before key access or generation. A state-directory lock prevents concurrent runs from double-spending; after a crash, inspect `run.lock`, its PID, and the ledger before removing the stale lock. Do not run multiple state directories against the same checkout.

The program installs covers locally; normal checked Git deployment publishes them. It does not embed credentials in the website or call image generation from a listener's browser.

## New-track incubation

Jesse approved a cheap picture first and one richer picture after **24 hours** on September 27, 2026. `--lifecycle --incubation-hours 24` implements that policy:

- First observation of an active new song: **incubating**, a low-quality pictorial cover using the same full source material.
- Still active 24 hours after first observation: **mature**, one medium-quality finished picture.
- Incubation timing is durable in `incubation.json` and in each incubation cover's `firstSeenAt`. Restarting the process does not restart the clock.
- Existing supplied images, this correction's basic/emphasis covers, and completed mature covers remain unchanged. Only a lifecycle-owned incubation image can be automatically upgraded.
- The installed task's `baseline` points to this batch's existing-catalog audit. Those tracks never enter new-track automation, including any rejected covers left as placeholders. A failed/uncertain first-stage request cannot be retried by merely reaching maturity.
- Pinned songs are always protected in lifecycle mode, including pins added while an image is rendering. This mode does not invoke the manual monument rule.
- Archived songs are absent from the active API snapshot and rechecked before generation and installation. A song absent during the first pass can go directly to mature after its recorded incubation period.
- Failed or rejected image calls retain their reservations and require manual review. The scheduler never retries them automatically or changes rejected source material.

`scripts/artwork-lifecycle.py --config PRIVATE_CONFIG.json` runs one complete pass in an isolated worktree from current `origin/talandar`: audit, bounded generation, pin protection, build/tests, commit, rebase concurrent publications, push, exact live verification, and clean worktree removal. `--check` only plans and cleans up; it makes no image calls or deployment. A failure preserves the worktree and writes `automation/pending.json`, which blocks later passes until reviewed. Every command's output is retained under `automation/runs/`.

The Windows installer `scripts/install-artwork-task.ps1 -Config PRIVATE_CONFIG.json` copies the runner outside the task worktree and registers **yehry3 Artwork Lifecycle**, every 15 minutes while Jesse is logged in. It uses `pythonw.exe`, hidden subprocesses, and overlapping runs are ignored. Thus an initial picture is requested on the first poll; the free title sleeve remains visible until generation and deployment finish. The mature stage follows on the first poll after 24 hours.

The private config contains `repo`, `workspace`, `state`, `baseline`, `node`, `npmCli`, `python`, `keyFile`, `budget: 40`, `budgetPeriod: "monthly"`, `incubationHours: 24`, `limit`, and `concurrency`. It points to the existing key file; it never contains the key. The installed task preserves this backfill's **same audit ledger**, with a new **$40 allowance per calendar month**. The runner refuses to start if that ledger is missing and stops paid work when that month's conservative reservations reach the allowance. A run crossing a month boundary defers any unstarted old-month reservations until the next pass. Nothing deletes or zeroes historical receipts: `oneOffReservations`, `monthlyReservations`, lifetime `reservations`, per-job states, and append-only `events` retain estimates and outcomes. Attempt logs, full creative sources, exact prompts, originals, and deployment logs are stored beside the ledger. These are estimates, not provider billing statements. Inspect status with:

```powershell
node scripts/artwork-status.mjs --state path/to/shared/generation --logs
Get-ScheduledTaskInfo -TaskName 'yehry3 Artwork Lifecycle'
```

To pause future generation: `Disable-ScheduledTask -TaskName 'yehry3 Artwork Lifecycle'`. Keep its state, ledger and masters. Changing the allowance requires a new authorization and updating the runner's explicit ceiling.

Official pricing reference: https://developers.openai.com/api/docs/models/gpt-image-2
