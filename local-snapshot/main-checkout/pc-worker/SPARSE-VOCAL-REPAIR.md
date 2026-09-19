# One full-length sparse-vocal recovery

September 15, 2026: Jesse authorized recovery of the existing `9-11'd Again`
request after its original composition had 20.85% detected vocal activity.
Its 444 preserved words cannot fit the shorter 60-119 second recovery.

`sparse_vocal_repair.py` prepares one separate composition for a submitted-lyrics
rock/acoustic original of 120-600 seconds that failed `configure` with measured
vocal activity below 50%, before conversion. It accepts the normal completed
`generate`, `separate`, `words` stages with or without the optional `backing` stage.
The accepted plan, including duration, every lyric, voice, arrangement, tempo,
key and basis inputs, remains unchanged. Only the separate child's seed and
additional vocal pacing guidance differ. There is no planning-model call.

Run only for an operator-authorized request with no active lease:

```powershell
& 'C:\Python311\python.exe' -X utf8 "$env:LOCALAPPDATA\Distonyc\sparse_vocal_repair.py" `
  --request '<saved-job>\render-request.json'
```

Preparation reserves one attempt before any new audio and pins the original
audio/recipe/planning evidence in `sparse-vocal-repair.json`. Then requeue only
that request with the normal version-checked admin API. A restart reuses the
same child and completed stages. Failure evidence follows its actual folder.
Original files stay intact. A prior ending, shorter-song or used outro repair
prevents preparation; this child cannot spawn further composition repairs.
Voice repairs and existing honest musical notices remain available. Every
vocal-activity, ending, file, peak, hash and export guard still runs. If the
child repeats a deterministic failure, stop and report its evidence.

Install only `sparse_vocal_repair.py`, `renderer.py`, `failure_evidence.py`, this
document and the new test file using selected-file installation while both
tasks are idle and future triggers paused. Preserve config, credentials,
claim and monitor journals. This operator-only recovery changes no automatic
monitor policy, retry budget, API, frontend or creative default.

Validation: `test_sparse_vocal_repair.py`, `test_lyric_length_repair.py`,
`test_composition_ending.py`, `test_recovery.py`, `test_worker.py`,
`test_quality.py`, `test_queue_monitor.py`, `test_reliability.py`.
