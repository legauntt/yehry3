# Song form and section labels

A chorus, recurring refrain, and verse/chorus headings are optional. The planner
honors verse-only and continuously developing songs; explicit form requests take
priority over saved defaults and writing-workflow presets. Runtime captions and
energy-building guidance also follow the supplied form.

lyric_sections.py is the common heading parser for wording preservation, explicit
word counts, required sung phrases and backend section mapping. It recognizes only
known standalone headings, with consistent casing, spacing, hyphens and numbered
aliases (including [Final Chorus 2]). Spoken verses, interludes, breakdowns, solos,
movements, sections, tags and codas are handled consistently. Unknown brackets and
inline tags remain lyric content, so genuine additions, omissions and punctuation
changes still fail preservation. Headings cannot satisfy required sung phrases.

Unlabelled backend sections use a neutral [Section] cue. An early [End] never
discards subsequent lyric words. Fresh planner outputs normalize headings after
escaped line breaks are decoded, including lowercase terminal markers. Exhausted
planning retries report the current mismatch while retaining the original budget
and error history; valid retained outputs can still recover without a model call.

Legacy render/spec guidance remains byte-for-byte compatible with saved engine
fingerprints. Only fresh composition captions remove its default chorus assumptions;
already configured audio, saved plans and recovery journals remain untouched.
Validation: test_lyric_sections.py, existing planner/materials/word-limit/generation,
paid-backend and frozen-work/recovery suites. No paid planning or audio generation
is needed to test this contract.
