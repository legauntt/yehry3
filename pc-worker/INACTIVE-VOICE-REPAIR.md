# V7 inactive-section assembly recovery

A fresh-catalog voice job can fail at `assemble` with `assert active.any()` when
its phrase segmentation includes an instrumental intro or break. The renderer's
existing retry hook invokes `inactive_voice_repair.py` on the same work folder.

Version 2 supports at most six inactive sections totaling 60 seconds including
overlapping context, and at most 25% of the full recording after overlaps are
counted once. Jesse authorized this extension on September 13, 2026 for the saved
"Velvet Rims at Midnight" request. This is an assembly repair, with no new music
generation, voice-model change, training, or planning call.

The source must remain below the saved assembler's 0.001 activity floor in mono
and independently in every stereo channel. Opposite-phase singing cannot qualify
through mono cancellation. Every active section still goes through the frozen
engine's original assembly and voice validation. The backing, timing, section
boundaries and source recording remain unchanged. Long instrumental breaks retain
their ordinary advisory notice and all final export checks still apply.

Before replacing inactive converted sections with exact PCM silence, the journal
pins the source, backing, section plan, voice profile, engine, track, pitch files,
all active converted files, and each original inactive converted file. Originals
are retained under `inactive-voice-repair/originals/`. Resumes accept only the
original or exact journaled replacement hash; changed files fail closed.
Completed repairs reuse their hash-checked assembly and voice-validation outputs.
Interrupted validation retains its exact exception and resumes the same repair.
Existing version-1 journals retain their original three-section/30-second bounds.

Validate with the installed NumPy/SciPy voice Python:

```powershell
python -X utf8 -m unittest -v test_inactive_voice_repair.py test_recovery.py test_worker.py test_voice_models.py
```

Install only the reviewed `inactive_voice_repair.py` using `install.ps1 -Files`
while worker and monitor tasks are idle and their future triggers are paused.
Retain all ledgers and frozen inputs. This update does not reset planning,
automatic shepherd, or queue retry budgets. Requeue only the authorized request
through the version-checked API; the worker holds the normal lease and GPU lock.

## Same-attempt recovery (September 21, 2026)

`inactive_recovery.py` runs this repair inside `review_publication.execute` when a first attempt stops at `assemble` with
`assert active.any()` on any voice model but V6, then resumes the remaining stages. A repair the limits reject falls
through to the ordinary needs-review export, so the song still publishes with its issue notice. The queue monitor also
retries the failure once for every non-V6 model without a per-request approval file. Before this, V9 songs with a
silent Eleven intro published the generated singer as "needs review" (three songs on September 20).
Suite movements keep the V8 approval-file rule.
