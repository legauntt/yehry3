# V8 measured lyric limits

Fresh V8 planning now counts written lyric words and feeds explicit numeric limit failures into the existing maximum of three persisted planning attempts. For example, a 161-word draft for a 100–160-word request receives its actual count and can correct only unprotected text. An accepted saved plan is reused.

Supported direct whole-sheet instructions include "Write between 260 and 350 words", "Keep the lyrics to 250–330 words", "Exactly 120 words", "At most 160 words", "At least 100 words", and strict "Under 100 words" (99 maximum). Quoted text, supplied lyric sheets, per-section limits, approximate ranges and narrative facts are not interpreted as hard whole-sheet limits. Unrecognized wording remains creative direction for the planner. This is intentionally a narrow parser, not a complete English constraint interpreter.

Contractions and hyphenated words count once; written repetitions count every time. Only recognized standalone section labels are omitted. Explicit required phrases, locked lines and preserve-mode lyrics are validated first. Conflicting word limits may yield needs_attention instead of deleting protected words. Private creative limits take priority and are snapshotted without including the note text in public plan fields.

lyric-constraints.json freezes the rule before the first call. lyric-pacing.json records the latest evaluated draft's counts by section, vocal-time estimate, actual word density and any limit error; it is advisory about pacing. Per-attempt errors and original outputs remain in the existing journal. No additional critique call or retry budget is introduced. Legacy in-flight jobs and saved/started audio are not subjected to a newly inferred rule. Explicit V6/V7 requests are excluded.

Word density does not verify performed timing. Rap, sustained melodic phrasing and sparse supplied lyrics require musical judgment. An explicit long ending without numeric timing receives no default density estimate. The voice checkpoint, audio renderer and public generation schema are unchanged by this module.

Validation: 224 repository worker tests passed with the established voice-lab Python. A replay over installed worker modules passed all applicable tests; five repository-layout-dependent checks were skipped there and pass in the repository. One fresh tool-free gpt-5.6-sol/medium request corrected 161 to 160 words in two persisted attempts, retaining shoes, boots, crooked grin, brass buckle and the locked line. This demonstrates constraint enforcement, not an audible or general lyric-quality improvement.
