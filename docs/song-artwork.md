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

The default state directory is `~/output/imagegen/yehry3-artwork`; pass `--state` to choose another. Keep this directory across runs. It contains `plan.json`, each exact `sources.json` and `prompt.txt`, the generated master image, CLI logs, and a persistent `ledger.json`. These do not enter the public build. Only generated image assets and cover metadata do. Never commit the key file or use the key itself as a command argument. `--key-file` takes precedence over a stale environment key.

`--budget` is a **cumulative conservative estimated-spend ceiling for this state directory**, not a new allowance each run and not a provider billing guarantee. Reservations include UTF-8 byte-based input estimates plus 20% image-output headroom, using the September 27, 2026 GPT Image 2 prices. The bundled CLI does not expose actual usage. Failed or uncertain attempts keep their reservation. Existing output is reused without another API call. Failed or uncertain jobs require explicit `--retry`; a CLI/API failure is never bypassed or rewritten to evade content checks. The CLI is invoked once per job with one wrapper attempt; its installed SDK may still retry transport errors.

Use `--limit N` to cap new calls, `--concurrency 1..6` (default 3), and `--low-listens N` to change the threshold. Source packets and prompts are prepared before key access or generation. A state-directory lock prevents concurrent runs from double-spending; after a crash, inspect `run.lock`, its PID, and the ledger before removing the stale lock. Do not run multiple state directories against the same checkout.

The program installs covers locally; normal checked Git deployment publishes them. It does not embed credentials in the website or call image generation from a listener's browser. Re-run it to process new songs and future pin milestones. No recurring paid schedule is installed by default.

Official pricing reference: https://developers.openai.com/api/docs/models/gpt-image-2
