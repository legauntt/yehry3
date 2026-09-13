# Temporary Arabic vocal experiment

Jesse requested a 19-second sample of Arabic ornamented singing blended with throat singing, published only on `/arabic/`. Future samples in this experiment belong on the same page. Keep them outside the main catalog, Chairlift requests, voting, completion notifications, and site navigation.

The public page and sample list live entirely under `arabic/`. Audio uses the separate GitHub prerelease `arabic-experiments-v1`, with one immutable filename per sample. Only MP3s are uploaded; stems, WAVs, recipe inputs, and diagnostics remain local. The page and its data are noindex and no-store.

To add a requested sample, append its entry to `arabic/samples.json`, upload its MP3 to the experiment release, and deploy. Confirm playback and seeking and verify that neither the sample nor a link to the page enters the main catalog/navigation.

The experiment may be scrubbed at Jesse's request. Remove `arabic/`, its build allowlist entry, its route rules, and its page entry in the build test; delete the experiment release assets/tag as requested. No regular song/catalog cleanup should be necessary. Historical Git/deployment copies are separate from removal of the live experiment.
