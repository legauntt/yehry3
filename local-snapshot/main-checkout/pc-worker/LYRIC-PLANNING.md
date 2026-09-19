# Submitted lyrics: formatting and compact songs

September 14, 2026: Jesse authorized shorter songs with submitted lyrics, including
60- and 90-second settings. Fresh planning uses a 60-second minimum only when a
lyric sheet is present. Other originals and reference-only requests retain 120 seconds.
The local suggestion uses 90 sung words/minute (150 for requested rap/spoken word)
plus ten seconds for the ending, rounded upward to five seconds. Explicit duration
instructions take priority. Preserve mode still checks every word, punctuation and order,
and rejects words that cannot fit at the permitted pace.

Known standalone heading variants are normalized before validating new or retained raw
planner outputs. `[Turn]` becomes `[Bridge]`, `[Final Chorus]` becomes `[Chorus]`, and
common pre/post-chorus spellings use the standard hyphen. Arbitrary bracketed lyrics
and inline labels are preserved and checked. A mismatch names the first differing word
and, where applicable, the unsupported heading. Raw output files and the persistent
three-attempt budget remain intact; valid saved responses need no further model call,
including after an invocation error or exhaustion of the original attempt budget.

## One shorter recovery after sparse vocals

An operator can prepare **one** 60–119-second attempt after Jesse authorizes shortening
an existing request. This is a new complete composition in a separate folder; the old
waveform is never cut. The original must have a submitted lyric sheet and have failed
`configure` with `Insufficient vocal signal activity` before voice conversion. A completed
song, used composition alternative, prior ending recovery or started conversion blocks
this remedy. The original lyrics, arrangement, title, basis recordings and voice stay
the same. No planner call occurs.

```powershell
& 'C:\Python311\python.exe' -X utf8 "$env:LOCALAPPDATA\Distonyc\lyric_length_repair.py" `
  --request '<existing-job>\render-request.json' --duration 85
```

Then use the normal version-checked admin retry for that request. The preparation command
does not requeue work or claim a lease. `lyric-length-repair.json` reserves the one attempt
before generation, pins original audio/planning evidence and the separate child inputs,
and records the actual selected work path. Restarts resume that child. No additional
outro/composition or cutoff-ending attempt is allowed for this shorter recovery; supported
voice repairs and honest issue notices remain available. All existing vocal-activity,
ending, voice, file, hash and export guards still run. Failure evidence follows the child.

Install only reviewed files while both scheduled tasks are idle, pausing future triggers
for the installation. This change needs no API/site deployment: their plan and delivery
contracts already accept durations from five seconds. Preserve the installed worker and
its public song-plan support when source and installed revisions differ.

Validation: `test_request_materials.py`, `test_lyric_length_repair.py`, `test_duration.py`,
and the existing planner, notes, worker, recovery, quality, monitor, composition and
reliability suites. The duration tests exercise the real native engine and studio planner
at 60/85/90/119 seconds without editing their pinned files or generating test audio.
