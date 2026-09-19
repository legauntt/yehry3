# September 17 generation evaluation

The public request form defaults fresh requests to V8 when generation-v8-v1 is enabled.
V6/V7/V8 remain selectable; an omitted legacy worker choice resolves to V6.
V7/V8 are experimental voice profiles using the same Seed-VC singing base.
The local standalone V6 studio has its own defaults. These are separate entry points.

## Validated runtime change

`automatic_vocal_repair` still controls bounded dropout recovery. The optional
`automatic_versioned_vocal_repair` setting selects additional voice versions:

```json
{"automatic_vocal_repair": true, "automatic_versioned_vocal_repair": ["v7"]}
```

Use the list above for the September 17 rollout. V8 is implemented for isolated
evaluation but is **not enabled automatically**: three real-audio fixtures were
rejected by unchanged peak/timing checks. V7 passed an injected 0.6-second dropout,
with 7.76 cents median pitch error, no missing windows afterward, exact samples
outside the patch, and an idempotent completed resume. Original songs were untouched.

Repair resolves the checkpoint, adapter rank/layers/strength, style and saved engine
from the failed job. It verifies recipe/checkpoint hashes and available reference
feature hashes. It never substitutes V6 for a saved V7/V8 voice. The budget remains
three short passages totaling at most four missing seconds; each uses contextual
conversion and existing continuity, pitch and peak guards. Diffusion/vocoder calls
are journaled before invocation. An interrupted uncertain call is retained for
inspection rather than invoked again automatically. Failed repair preserves the
original audio and the existing visible-warning route.

Install `renderer.py`, `vocal_repair.py`, `voice_repair_profile.py` and this documentation
with the existing selected-file installer while both scheduled tasks are idle.
Preserve config, credentials, completed songs and job state. Verify runtime-release
hashes and imports afterward. The four PowerShell files in this change reconcile
already installed windowless launchers and selected-file installation behavior.

## Local evaluation tools

`lab/` holds explicit offline experiments, not an automatic provider rollout.
Model weights, training data, audio, API keys and billing journals stay outside Git.
Every local GPU experiment uses the studio's shared lock.

| Tool | Purpose |
| --- | --- |
| `download_models.py` | Download six SHA-pinned ACE model alternatives separately |
| `native_compare.py` | Seventeen frozen-input trials: Q4/Q6/Q8, 4B LM, SFT, XL, Base completion/layer generation, three band strengths |
| `separator_compare.py`, `mdx_gpu_compare.py` | Mel-Band and existing MDX on identical crops; CUDA timings retained separately from CPU control timings |
| `voice_compare.py` | Same checkpoint/pitch/seed/style; 30 vs 50 steps and rhythmic-reference variant |
| `mix_compare.py` | Offline vocal automation capped at 3 dB and 800–3500 Hz backing reduction capped at 1.5 dB |
| `repair_smoke.py` | Isolated copies with injected dropouts; positive and rejected outcomes retained |
| `export_previews.py` | Common loudness within groups, conservative peak headroom, checked MP3 plus WAV exports |
| `review_server.py` | Loopback listening page, saved human notes and current-user DPAPI key setup |
| `paid_compare.py` | Six original 90-second Eleven Music v2.5 compositions with a durable spending journal |

The paid plan has a $50 total authorization cap. At the observed $0.15/minute list
price the initial nine-minute trial estimates $1.35; the runner conservatively
reserves $9 at $1/minute. It does not purchase subscriptions or upload Tony recordings.
An uncertain response retains its reservation and cannot be charged again by an
automatic retry. `wait` waits up to 24 hours for a locally saved key and runs the
prepared plan once; `STOP-PAID` in the report directory cancels that wait.
Paid output is a provider guide performance until separate Tony conversion occurs.

Applio 3.6.4 was assessed as an independent RVC training/integration project. Existing
Seed-VC adapters cannot be loaded into it. No RVC voice was trained or promoted in
this evaluation. Its newer dependency stack belongs in a separate environment.
Genre-specific band training likewise remains dependent on curated instrumental
material and evaluation of the existing adapter comparisons.

## Evidence and decisions

Reports: `C:/Users/Jesse/Documents/Distonyc-upgrades-2026-09-17`.
Experiments: `C:/Users/Jesse/Music/One More Round - extended/AI extension/generation-upgrades-20260917`.
WAV/MP3 comparisons: `C:/Users/Jesse/Music/ABs/Distonyc upgrades 2026-09-17`.
Private listening page: `http://127.0.0.1:53117/`.

All seventeen ACE trials rendered. This establishes compatibility for those saved
durations, not a musical winner or a full production load test. CUDA separator
timings were approximately 1.8–2.3 seconds for current MDX and 2.2–2.8 seconds for Mel-Band
per 24-second crop; both produced finite stems. Reconstruction is not a leakage metric.
The separate supplemental V8 training run failed its improvement criterion and was
not promoted. Existing full-context ending evidence restored transcript support for
the final phrase while preserving the first 90 seconds; a human listening result is
still required before using generative ending replacement automatically.

Keep band/voice/mix defaults until group comparisons support a preference. Record
human judgments explicitly; no metric here establishes Tony likeness or musical taste.

Validation: worker/recovery/monitor/profile unit tests, signal-quality tests, isolated
real-audio repair trials, paid-budget/DPAPI/local-server tests, and headless browser
playback. Exact counts and outcome files are retained in the local completion report.
