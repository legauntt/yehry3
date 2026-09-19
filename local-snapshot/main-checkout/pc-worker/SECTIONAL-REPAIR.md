# Operator sectional recovery

Jesse authorized a different recovery for the existing `9-11'd Again` request
after its one full-length sparse-vocal attempt failed. This does not reset that
attempt or the monitor policy. `sectional_repair.py --request <render-request.json>`
prepares a new, separately journaled method for that existing failed request.

The complete frozen lyrics are partitioned into three contiguous groups at
section headings. Every supplied word remains in order. The original duration
is allocated across the groups by word count, including ten seconds for each
resolved ending; key, BPM, arrangement, basis and selected voice are preserved.
No planning-model call or voice training occurs. Both earlier recordings and
their hashes are retained. The parent plan and request stay unchanged.

Each section can try at most three deterministic seeds, with reservations saved
before work starts. Only named pre-conversion composition failures can advance
to the next seed. Cancellation, lease loss, filesystem failures and later voice
failures retain the same work for inspection/resume. Successful sections are
verified and reused. No child can spawn another composition recovery.

Sections use the existing renderer, including its minimum vocal activity,
ending, voice, peak, hash and complete-export checks. They stay in private
subfolders. The existing longform assembler joins their complete verified PCM,
preserving quiet tails, and masters one final MP3/WAV. Musical section-gap
notices remain visible. Existing vocal-dropout warnings can carry into the full
song only when each affected section's policy, stems, report and exports still
verify against their saved hashes. All other delivery guards remain active.

After preparation, use the version-checked admin retry for only the identified
request. Installation changes only selected reviewed files while both tasks
are idle, preserving credentials, configuration, claims and monitor ledgers.
This method is operator-only; it changes no automatic monitor retry budget.

Validation: `test_sectional_repair.py` plus the sparse/shorter recovery,
composition, worker, quality, monitor and reliability suites. The assembler's
synthetic signal test exercises full PCM preservation and real encoded export
verification. Technical checks do not establish human listening quality or
guarantee exact generated melody across the three independent sections.
