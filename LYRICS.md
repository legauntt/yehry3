# Lyrics archive

Every song in the catalog has a readable share link at `/lyrics/<title>-<short-hash>/`, linked from the main list and Fear & Hunger page. Existing `/lyrics/?song=<id>` links also work. Sheets can be printed or downloaded as text.

New readable links work as soon as Chairlift publishes a song, even before Azure deploys its generated page. The shared lyrics page resolves the complete alias from cached song details or the compact API/static catalogs, then loads the individual song. Independent reads preserve the static and browser fallbacks during API outages. The build puts exact generated-page routes ahead of the shared fallback so existing pages retain their song-specific share previews. Before the next deployment, a new link works for listeners but its preview may be generic. No worker or publication-state change is required.

Line-level timing uses vocal word timestamps for the exact published production. Transcript selection considers lyric agreement and supported lines rather than the number of recognized words. Unsupported, implausibly compressed or stretched lines stay readable without click-to-seek timing; a sheet can have partial timing or none. While audio plays, supported lines are highlighted and kept in view. Section labels remain visual headings. Stylized singing and transcription errors can still make transitions approximate.

`pc-worker/audit_lyric_cues.py` audits a catalog without writing by default. Its private report pins each recording URL, duration and original lyric sheet. Applying a reviewed report changes cues only, validates the complete batch before writing, and rejects concurrent lyric/cue revisions. Published MP3 hashes identify the production; legacy URLs can be streamed and hashed with `--fetch-identities`. When old timestamps are missing, `restore_lyric_evidence.py` can transcribe the hash-verified retained vocal stem into a separate private cache using the existing local CPU speech model. Neither tool changes audio or substitutes recognition guesses for written lyrics. Audit reports and transcripts stay outside the public repository and build.

The 53 older entries were backfilled from saved local Troofs production files: 39 from the lyric text supplied to the renderer, and 14 from saved source transcriptions. The production manifests were matched to the published MP3 SHA-256 hashes, so alternate versions use their corresponding production text. No new lyrics or transcriptions were generated for the backfill. These copies are also saved under `Music\troofs\lyrics` on Jesse's PC.

Written sheets describe the lyrics supplied for the recording; the generated performance can vary. Source transcriptions are explicitly labeled as potentially imperfect. **Movin On (V6 Extended)** includes both the source transcription and its written extension, with separate labels. The renderer's `[End]` marker is omitted from display.

The IPA and Phonics reading modes use the CMU pronunciation dictionary. They do
not measure Tony's delivery or establish what words he sang. Unknown spellings
stay unchanged. The decorative Diacritics mode has been removed; old links fall
back to Original.

For a recording-based transcription, use `pc-worker/transcribe_performance.py`.
It requires both the hash-verified released MP3 and its retained converted Tony
vocal stem (`matched-vocals.wav`, archived as `vocals.wav`). A guide singer's
stem or source transcript is not accepted. Recognition reads the audio without
the written lyrics as a prompt, and produces its own words and timestamps.
Continuous recognition is the default, following the full-verse Pumpkin test.
`--segmentation phrases` instead uses energy windows with padding for quiet
consonants. That experiment can avoid instrumental gaps but introduce errors at
window boundaries; neither result is assumed correct from confidence alone.
Private evidence records the audio identities and model; a separate public draft
contains only recording identity, machine-transcription attribution, segment text,
timing and uncertainty flags. The program does not publish that draft or overwrite
written lyrics. A machine result must be checked against the recording before it
is presented as accurate; recognition confidence alone is not a listening review.

```powershell
python pc-worker/transcribe_performance.py --catalog catalog.json --song <song-id> --basis-root <basis-root> --speech-root <speech-tools-parent> --cache <private-cache> --model large-v3-turbo
```

Models are local by default; `--download-model` explicitly permits fetching the
requested model. The tool runs on four CPU threads at below-normal Windows
priority, leaving the song-rendering GPU alone. Verified cached recognition is
reused. Cache paths must be outside this repository. Recordings without a pinned
release identity and converted vocal archive need source verification first.
Each completed run also writes a private `review.html`: timestamp buttons play
the released recording, the player can switch to Tony's isolated vocals at the
same position, and the supplied lyrics are available separately for comparison.

## Optional recognizer views

The dropdown includes **Lyrics (Whisper)** for recordings with a published machine
transcript. Its own segment timestamps drive highlighting, click-to-seek and moment
links. `?view=whisper` selects it for recipients regardless of their saved preference.
Switching between written and recognized text keeps audio playing and translates any
old line hash into a timestamp, because their line numbers differ. Downloads and print
follow the selected view and preserve its machine attribution and uncertainty marks.
Unavailable recordings show a disabled option; stale or failed transcript links keep
the written sheet usable and explain the fallback. Recognition never replaces the
original lyric sheet.

The first published example is **The Pumpkin Knows My Name**, using unprompted
continuous `faster-whisper large-v3-turbo` on its verified converted Tony vocals.
This is explicitly a machine result without listening review. A question mark means
the model flagged uncertainty, not that unmarked lines have been verified.

Only sanitized public drafts belong in `lyric-transcripts/<song-id>.whisper.json`.
`scripts/performance-transcripts.mjs` validates the released URL/hash, duration and
segments, omits archived songs and generates the small availability index plus
per-recording JSON. It exports only allowed public fields; private evidence, word
probabilities and local paths stay outside the repository. `assets/performance-lyrics.js`
registers each supported method and validates again against the current song before
display. New recognizers should get their own method and accurate label here.

Whisper recognizes words, not acoustic IPA. There is deliberately no **Phonetics
(Whisper)** option: a future phonetics view must use an actual audio-to-phoneme
recognizer. The separate dictionary modes remain guides to written words.

The two initial Distonyc songs, **Blood on My Shoes at Daybreak** and **Two Names in One Pair of Shoes**, use their saved original lyrics. Future jobs export sheets as part of native publication. The existing planning call also classifies clear Fear & Hunger songs; lyrics export, collection updates, and uploading require no additional model call.

The MP3 folder audit also added **The Stone I Carried**, **Khalim Still Has a Heart**, and **When Arreat Fell**, bringing the catalog to 58 songs at import. Their saved written lyrics and existing public MP3s were matched by SHA-256 to the local delivery manifests. All three appear in both Tony AI and **Shiablo: The Lord of Prisoners** (`/?collection=shiablo`).

The library stores collection, sort order, and search text in the URL (`collection`, `sort`, and `q`). Shared links and browser history restore these controls; default values are omitted from new URLs.

Published Distonyc entries also link to `/original-prompt/?song=<id>`. This sheet shows the confirmed idea, direction, preferences, and up to five basis-song titles. The API derives it from the saved request when publishing; the native worker copies the same allowed fields into the fallback catalog. Existing releases were backfilled from their frozen local request snapshots. Admin notes, credentials, ownership, and local production paths are excluded. This requires no additional model call.

Lyrics and public `{line, start, end}` cues are stored with public song metadata in Mongo and the static fallback catalog. Private word probabilities, raw transcripts, file paths, production configuration, and credentials are excluded from the sheets. Editing a sheet changes its public metadata; it does not alter or rerender the audio.
