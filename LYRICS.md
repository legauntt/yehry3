# Lyrics archive

Every song in the catalog has a readable share link at `/lyrics/<title>-<short-hash>/`, linked from the main list and Fear & Hunger page. Existing `/lyrics/?song=<id>` links also work. Sheets can be printed or downloaded as text.

New readable links work as soon as Chairlift publishes a song, even before Azure deploys its generated page. The shared lyrics page resolves the complete alias from cached song details or the compact API/static catalogs, then loads the individual song. Independent reads preserve the static and browser fallbacks during API outages. The build puts exact generated-page routes ahead of the shared fallback so existing pages retain their song-specific share previews. Before the next deployment, a new link works for listeners but its preview may be generic. No worker or publication-state change is required.

Every current sheet also has line-level timing derived from the retained vocal word timestamps for its exact production. The backfill matches the saved production to the SHA-256 prefix in the published MP3 filename before deriving cues, so an abandoned render with the same lyrics cannot supply another recording's timeline. While audio plays, the current line is highlighted and kept in view; selecting a timed line seeks the player to its start. Section labels remain visual headings. The timing is monotonic and bounded to the published recording, but stylized singing and source transcription errors can make individual transitions approximate.

The 53 older entries were backfilled from saved local Troofs production files: 39 from the lyric text supplied to the renderer, and 14 from saved source transcriptions. The production manifests were matched to the published MP3 SHA-256 hashes, so alternate versions use their corresponding production text. No new lyrics or transcriptions were generated for the backfill. These copies are also saved under `Music\troofs\lyrics` on Jesse's PC.

Written sheets describe the lyrics supplied for the recording; the generated performance can vary. Source transcriptions are explicitly labeled as potentially imperfect. **Movin On (V6 Extended)** includes both the source transcription and its written extension, with separate labels. The renderer's `[End]` marker is omitted from display.

The two initial Distonyc songs, **Blood on My Shoes at Daybreak** and **Two Names in One Pair of Shoes**, use their saved original lyrics. Future jobs export sheets as part of native publication. The existing planning call also classifies clear Fear & Hunger songs; lyrics export, collection updates, and uploading require no additional model call.

The MP3 folder audit also added **The Stone I Carried**, **Khalim Still Has a Heart**, and **When Arreat Fell**, bringing the catalog to 58 songs at import. Their saved written lyrics and existing public MP3s were matched by SHA-256 to the local delivery manifests. All three appear in both Tony AI and **Shiablo: The Lord of Prisoners** (`/?collection=shiablo`).

The library stores collection, sort order, and search text in the URL (`collection`, `sort`, and `q`). Shared links and browser history restore these controls; default values are omitted from new URLs.

Published Distonyc entries also link to `/original-prompt/?song=<id>`. This sheet shows the confirmed idea, direction, preferences, and up to five basis-song titles. The API derives it from the saved request when publishing; the native worker copies the same allowed fields into the fallback catalog. Existing releases were backfilled from their frozen local request snapshots. Admin notes, credentials, ownership, and local production paths are excluded. This requires no additional model call.

Lyrics and public `{line, start, end}` cues are stored with public song metadata in Mongo and the static fallback catalog. Private word probabilities, raw transcripts, file paths, production configuration, and credentials are excluded from the sheets. Editing a sheet changes its public metadata; it does not alter or rerender the audio.
