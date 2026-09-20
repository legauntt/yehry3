# V8 generation and versioned voices

New requests can select V6, V7, V8 or V9; V9 is the browser default when available, then V8, then V7, and a voice picked in the menu is remembered per browser. Saved requests retain their selected voice. Voice identity is separate from the V8 song-generation profile. V6/V7 can opt into the generator; V8 requires it, and the site also sends it for V9 (the API does not insist).

Contextual vocal repair (a short dropout re-sung by the frozen voice and patched in) covers V6 always and the versioned voices named in `automatic_versioned_vocal_repair`: V7 and V9 on the production worker. A V9 passage is sung by the job's own pinned RVC runtime as a one-phrase job folder under `vocal-repair/`, so its model, index and converter pins are checked exactly as for a song. The versioned runtimes also give a phrase flagged by the advisory pitch report one more take when its asked line is calm, keep the better take, and journal it in `pitch-resing.json`; a B side never copies that journal.

The API requires `YEHRY3_GENERATION_V8=true` for advanced controls and additionally `YEHRY3_VOICE_V8=true` to admit V8 voices. The worker needs `generation_v8=true` and a separately pinned `voice_models.v8` profile. Merge new profile fields into the existing config, preserving V7, credentials and state.

V8 requests preserve `details.voiceModel` and `details.generationProfile` through confirmation. Workers need both `generation-v8-v1` and `voice-v8-v1`; the voice capability is advertised only after verifying the pinned profile. Renderer requests/results use `voice_model` and `generation_profile`; public metadata uses `voiceModel` and `generationProfile`. Completion rejects a different voice or missing V8 generation marker. The control schema's `version: 1` is distinct from the release label.

Advanced options cover style/instruments, timing/key, story/hook/rhythm lyric workflows, phrase preferences and exact locks, owner lyric approval, bounded composition choices and vocal/band gain. Musical controls guide generation; they do not guarantee an exact performance. Advisory ending checks retain transcript uncertainty. Local section editing copies from a source-aligned alternate take; generative repainting and individual instrument layers are not included.

Private owner review data remains in the API's bounded review collection, separate from the public catalog and releases. Reviews release the lease while waiting. Resume uses the saved decision and budgets. Disabling new admissions must retain V8 metadata readers, pending reviews and compatible workers for existing requests.

Install reviewed files with `install.ps1 -Files <explicit filenames>` while the worker and monitor are idle and future triggers are paused. Back up configuration, retain credentials and existing jobs, verify the installed runtime, then resume the scheduled tasks. Do not replace the installed runtime wholesale from a dirty checkout.

The rollout was checked with 197 worker tests on the production PC, 37 website tests and 75 API tests. Engine/reference integration tests require the local saved environment and explicitly skip in CI when it is absent. Browser checks cover version selection, draft refreshes, modal accessibility, lyrics and composition review, preview playback, and private/public boundaries.
