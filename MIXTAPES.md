# Mixtape experiment

`/mixtapes/` is a standalone frontend experiment. It has its own JavaScript,
stylesheet and page. The only collection change is the “Make a mixtape” link;
the build adds the new public directory. It makes no API writes and requires no
database, worker, authentication or audio-file changes.

The browser remembers one draft at `yehry3:mixtape:v1`. Versioned shared links
encode only the title, an allowed sleeve color and up to 40 public song IDs in
the fragment. Opening a shared link leaves the local draft alone until the
listener chooses “Make your own version”. Links are snapshots; later edits do
not change previously shared tapes. Missing songs stay visible and are skipped
for playback. The static summary catalog remains an API-outage fallback.

Rollback: revert the commit titled “Add standalone Side A / Side B mixtape
experiment”, then rebuild and deploy. Later Remix and timestamp-sharing commits
do not import this feature. Browser draft data can remain harmlessly in place
for a future re-enable. Reverting removes the new page, so shared mixtape links
will stop working; existing song, lyric and request links are unaffected.
