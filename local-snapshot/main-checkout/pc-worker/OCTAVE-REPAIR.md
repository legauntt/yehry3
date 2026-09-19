# Targeted V7 octave correction

`octave_pitch_repair.py` is an operator utility, not an automatic queue remedy.
It was added for the authorized repair of The Crooked Crown Campaign. The saved
alternate-reference attempt remains exhausted and unchanged.

First confirm that the identified Chairlift request is failed with no active
worker. Inspect the saved pitch contours. The utility accepts one V7 phrase,
up to four seconds, whose measured median pitch is one octave below its saved
melody. Run it with the saved voice Python and explicit `--work`, `--label`,
and `--interval START STOP` arguments. It spends one persistent attempt before
creating the candidate. It changes neither the production recording nor the
queue while preparing.

The candidate uses the installed FFmpeg Rubber Band filter with unchanged
tempo, preserved formants, smooth transients and 40ms crossfades. Only the
measured interval is corrected. All PCM outside that interval is retained
exactly. A short filter-tail omission can be padded only in unused context,
at least 100ms beyond the corrected interval; this never pads delivered audio.
The entire original phrase validator must pass, and the assembled patch must
also pass the existing 60-cent median pitch limit. Source files, candidates,
frozen workers and all originals are pinned/retained in `pitch-octave-repair/`.

After the candidate is verified, recheck authoritative request state and run
the same utility with `--work WORK --apply`. Application uses atomic file
replacements and resumes interrupted application only from pinned originals
or their verified replacements. Then use the version-checked admin retry API
for that request. The normal worker finishes continuity, peaks, ending,
MP3/WAV verification, publication and catalog deployment. No global worker
installation or automatic recovery-policy change is required.

The only special runtime resume handles the original filter-context length
adapter error. It reuses the same retained shifted phrase and preserves the
one-attempt count. A failed musical candidate cannot be reset by invoking the
utility again. Cancellation/queue changes must be reconciled before applying
or requeueing; the utility itself has no queue credentials or mutation API.

Validation: run `test_octave_pitch_repair.py` with the saved voice Python.
Tests cover unchanged PCM, crossfade boundaries, invalid signal/duration,
unchanged pitch limits, exhausted budgets and interrupted application.
