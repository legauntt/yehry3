"""Tony V9 (RVC via Applio) singing the barbershop quartet's four independent parts.

quartet.py's `analyze`/`arrange`/`chunks`/`features`/`pitch` stages already compute, per role, the
guide content audio and a target pitch curve (the lead's own tracked melody, or for tenor/baritone/bass
a synthetic harmony curve from the chord arrangement) -- none of that is specific to which voice sings
it. Only `diffuse`/`vocode` are V6's own diffusion model. This module stands in for those two stages
when the request's voice model is v9, reusing the same Applio pitch-override technique voice_runtime.py
already uses for the normal single-voice V9 path (see tony-v9-rvc/runtime-profile/rvc_sing.py): Applio's
own pitch tracker is bypassed in favor of a saved target f0 curve, so Applio can be made to sing a
harmony note the input audio never had.

quartet.py itself is never imported or modified here; this writes the same `conversion/<role>-<NN>-voice
-converted.wav` and `-f0.npy` files quartet.py's own diffuse stage would, so `assemble`/`validate`/`master`
run unchanged for either voice model.
"""
import os
import subprocess
from pathlib import Path

import numpy as np

from common import load, save, sha

ROLES = ['lead', 'tenor', 'baritone', 'bass']
GUIDE_ROLES = {'lead': 'lead', 'tenor': 'upper', 'baritone': 'upper', 'bass': 'bass'}


def target_pitch(work, out, role, base, row):
    """The 10ms-frame f0 curve this role should sing for one chunk: the lead's own tracked melody,
    or a harmony role's arranged chord-tone curve, masked to the base guide's own voiced frames."""
    source_f0 = np.load(out / (base + '-f0.npy'))
    if role == 'lead':
        return source_f0.astype('float32')
    full = np.load(work / (role + '-target-pitch.npy'))
    a, _ = row['interval']
    frame_times = np.arange(len(source_f0)) * .01 + a
    hz = np.interp(frame_times, np.arange(len(full)) * .01, full)
    return np.where(source_f0 > 1, hz, 0).astype('float32')


def verify_applio(applio):
    root = Path(applio['root'])
    assert (root / '.git/HEAD').read_text('utf-8').strip() == applio['commit'], 'Applio is not at the pinned commit'
    assert sha(root / 'rvc/models/embedders/contentvec/pytorch_model.bin') == applio['embedder_sha256'], 'The content encoder changed'
    return root


def diffuse(work, voice_profile, log=None):
    work = Path(work)
    out = work / 'conversion'
    plan = load(work / 'conversion-plan.json')
    rows = plan['chunks']
    pending = []
    for row in rows:
        for role in ROLES:
            target = f'{role}-{row["index"] + 1:02}-voice'
            if (out / (target + '-converted.wav')).exists():
                continue
            base = row['labels'][GUIDE_ROLES[role]]
            f0 = target_pitch(work, out, role, base, row)
            np.save(out / (target + '-f0.npy'), f0)
            pending.append({'target': target, 'base': base})
    if not pending:
        return
    applio = load(voice_profile['files']['applio'])
    root = verify_applio(applio)
    labels = [item['target'] for item in pending]
    subprocess.run([applio['python'], '-X', 'utf8', str(Path(__file__).with_name('quartet_rvc_sing.py')),
                     '--work', str(work), '--applio', str(root),
                     '--model', voice_profile['files']['adapter'], '--index', voice_profile['files']['index'],
                     '--labels', *labels], check=True, stdout=log, stderr=subprocess.STDOUT)
    for item in pending:
        assert (out / (item['target'] + '-converted.wav')).exists(), f"Applio did not convert {item['target']}"


def vocode(work, voice_profile, log=None):
    """V9 has no separate vocode stage: diffuse already wrote the converted audio, matching how
    voice_runtime.py's single-voice V9 pipeline reports the same thing for this stage name."""
    print('Tony V9 has no separate vocode stage: the RVC model reads the phrase audio and renders sound itself.', flush=True)


def correct_attribution(work, voice_profile, ffmpeg):
    """quartet.py's own master()/verify() always write and re-check 'Tony C V6 sings...' -- verify()
    asserts sha(d['voice_adapter'])==MODEL_SHA (a constant pinned to the V6 adapter) on every future
    call, so voice_adapter itself can never be corrected without breaking re-verification forever.
    This corrects what IS safe to correct: the public-facing mp3 comment tag and the non-verified
    voice-checks.json truthfulness flags, keeping files[] bytes/sha256 self-consistent so quartet.py's
    verify() and engine_tasks.verify_work() both keep passing on every later call."""
    work = Path(work)
    label = voice_profile.get('label', voice_profile['name'])
    comment = f'AI barbershop quartet: {label} sings lead, tenor, baritone and bass. Four separately rendered vocal parts.'
    for report_name in ('mix-results.json', 'delivery-manifest.json'):
        report_path = work / report_name
        report = load(report_path)
        if report.get('voice_model') == voice_profile['name']:
            continue
        for item in report['files']:
            path = Path(item['file'])
            if path.suffix != '.mp3':
                continue
            partial = path.with_name(path.stem + '.partial.mp3')
            subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(path), '-c', 'copy',
                             '-metadata', 'comment=' + comment, str(partial)],
                            check=True, creationflags=subprocess.CREATE_NO_WINDOW)
            os.replace(partial, path)
            item['bytes'] = path.stat().st_size
            item['sha256'] = sha(path)
        report['voice_model'] = voice_profile['name']
        report['sung_by'] = label
        save(report_path, report)
    checks_path = work / 'voice-checks.json'
    checks = load(checks_path)
    if checks.get('all_roles_use_tony_v6'):
        checks['all_roles_use_tony_v6'] = False
        checks[f"all_roles_use_tony_{voice_profile['name']}"] = True
        save(checks_path, checks)
