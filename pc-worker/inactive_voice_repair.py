"""Recover a frozen fresh-catalog render whose source has an inactive voice section.

The generated section is retained, then replaced with silence so a voice model
cannot invent singing inside an instrumental gap. Frozen workers and creative
inputs are not changed.
"""
import argparse, importlib.util, json, re, shutil, tempfile, traceback
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d

from common import load, save, sha

SR = 44100
REPORT = 'inactive-voice-repair/status.json'
ACTIVITY_FLOOR = .001
LIMITS = {'sections': 6, 'seconds': 60, 'fraction': .25}


def read(path):
    audio, rate = sf.read(path, dtype='float32', always_2d=True)
    if rate != SR or not np.isfinite(audio).all():
        raise ValueError(f'Invalid saved audio: {path}')
    return audio


def envelope(audio):
    return np.sqrt(np.maximum(uniform_filter1d(audio * audio, size=round(.025 * SR)), 0) + 1e-12)


def inactive_rows(work, rows):
    source = read(work / 'selected-vocals.wav')
    labels = set()
    found = []
    for row in rows:
        label = row['label']
        if not isinstance(label, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', label) or label in labels:
            raise ValueError('Invalid or repeated voice section label')
        labels.add(label)
        if len(row['interval']) != 2 or not all(np.isfinite(value) for value in row['interval']):
            raise ValueError('Invalid voice section interval')
        a, b = [round(value * SR) for value in row['interval']]
        if not 0 <= a < b <= len(source):
            raise ValueError('Voice section lies outside the retained source')
        old = source[a:b].mean(axis=1)
        env = envelope(old)
        active = env > max(float(env.max()) * .04, ACTIVITY_FLOOR)
        if not active.any():
            channel_peaks = [float(envelope(channel).max()) for channel in source[a:b].T]
            if max(channel_peaks) > ACTIVITY_FLOOR:
                raise ValueError('Stereo cancellation hides activity in source section: ' + label)
            found.append({
                'label': row['label'],
                'interval': row['interval'],
                'duration_seconds': (b - a) / SR,
                'source_peak': float(np.max(np.abs(old))),
                'source_rms': float(np.sqrt(np.mean(old * old) + 1e-14)),
                'channel_envelope_peaks': channel_peaks,
            })
    return found


def check_limits(inactive, duration, legacy=False):
    if not inactive:
        raise ValueError('The failed assembly has no inactive source section')
    seconds = sum(row['duration_seconds'] for row in inactive)
    limits = {'sections': 3, 'seconds': 30} if legacy else LIMITS
    if len(inactive) > limits['sections'] or seconds > limits['seconds']:
        raise ValueError('Inactive source sections exceed the bounded recovery limit')
    # Count overlapping context once when measuring the share of the performance.
    end, union = 0, 0
    for start, stop in sorted(row['interval'] for row in inactive):
        union += max(0, stop - max(start, end))
        end = max(end, stop)
    if not legacy and (duration <= 0 or union / duration > limits['fraction']):
        raise ValueError('Inactive source sections exceed the bounded share of the performance')
    return {'sections': len(inactive), 'seconds_with_context': seconds,
            'unique_seconds': union, 'duration_seconds': duration}


def input_hashes(work, rows, inactive):
    inactive_labels = {row['label'] for row in inactive}
    names = ['selected-vocals.wav', 'selected-backing.wav', 'conversion-plan.json',
             'engine_voice.py', 'voice-profile.json', 'track.json']
    names += ['conversion/' + row['label'] + '-f0.npy' for row in rows]
    names += ['conversion/' + row['label'] + '-converted.wav' for row in rows
              if row['label'] not in inactive_labels]
    return {name: sha(work / name) for name in names}


def retain_and_silence(work, report, status_path):
    """Only accept the original or the exact journaled replacement on a restart."""
    originals = status_path.parent / 'originals'
    originals.mkdir(parents=True, exist_ok=True)
    # Verify every retained/current file before changing any section.
    for row in report['sections']:
        converted = work / 'conversion' / (row['label'] + '-converted.wav')
        retained = status_path.parent / row['retained_file']
        if retained.parent != originals:
            raise ValueError('Invalid retained voice section path')
        allowed = {row['generated_sha256'], row.get('replacement_sha256')}
        if sha(converted) not in allowed:
            raise ValueError('Inactive converted section changed: ' + row['label'])
        if not retained.exists():
            if sha(converted) != row['generated_sha256']:
                raise ValueError('Original inactive section is missing: ' + row['label'])
            shutil.copy2(converted, retained)
        if sha(retained) != row['generated_sha256']:
            raise ValueError('Retained inactive section changed')
    for row in report['sections']:
        converted = work / 'conversion' / (row['label'] + '-converted.wav')
        if row.get('replacement_sha256') == sha(converted):
            continue
        audio = read(converted)
        with tempfile.NamedTemporaryFile(dir=converted.parent, suffix='.wav', delete=False) as handle:
            temporary = Path(handle.name)
        try:
            # PCM silence is exact and has no timestamped WAV PEAK chunk.
            sf.write(temporary, np.zeros_like(audio), SR, subtype='PCM_24')
            digest = sha(temporary)
            if row.get('replacement_sha256') not in (None, digest):
                raise ValueError('Inactive replacement format changed')
            row['replacement_sha256'] = digest
            save(status_path, report)
            temporary.replace(converted)
        finally:
            temporary.unlink(missing_ok=True)


def assemble(engine, work, rows, inactive):
    source = read(work / 'selected-vocals.wav')
    backing = read(work / 'selected-backing.wav')
    sums = np.zeros(len(source), dtype='float32')
    weights = np.zeros_like(sums)
    details = []
    inactive = {row['label']: row for row in inactive}
    for row in rows:
        a, b = [round(value * SR) for value in row['interval']]
        old = source[a:b].mean(axis=1)
        new = read(work / 'conversion' / (row['label'] + '-converted.wav')).mean(axis=1)
        new = np.pad(new, (0, max(0, len(old) - len(new))))[:len(old)]
        env = envelope(old)
        active = env > max(float(env.max()) * .04, ACTIVITY_FLOOR)
        if row['label'] in inactive:
            if active.any() or np.max(np.abs(new)) > 1e-7:
                raise ValueError('Inactive voice section changed during recovery: ' + row['label'])
            corr, shift, gain = 1.0, 0, 0.0
            detail = {'label': row['label'], 'shift_seconds': 0.0, 'envelope_correlation': 1.0,
                      'gain': 0.0, 'inactive_source_section': True,
                      'recovery': REPORT, 'source_peak': inactive[row['label']]['source_peak'],
                      'source_rms': inactive[row['label']]['source_rms']}
        else:
            x, y = env[::220], engine.env(new)[::220]
            scores = []
            for lag in range(-24, 25):
                aa, bb = (x[:-lag], y[lag:]) if lag > 0 else ((x[-lag:], y[:lag]) if lag < 0 else (x, y))
                score = float(np.corrcoef(aa, bb)[0, 1])
                if np.isfinite(score):
                    scores.append((score, lag))
            if not scores or not active.any():
                raise ValueError('Unexpected inactive voice section: ' + row['label'])
            corr, lag = max(scores)
            shift = lag * 220
            if shift > 0:
                new = np.pad(new[shift:], (0, shift))
            if shift < 0:
                new = np.pad(new[:shift], (-shift, 0))
            gain = engine.rms(old[active]) / engine.rms(new[active])
            new *= gain
            gate = engine.connected_gate(env, SR)
            new *= gate
            gain2 = engine.rms(old[active]) / engine.rms(new[active])
            new *= gain2
            old_long = np.sqrt(np.maximum(uniform_filter1d(old * old, size=round(.8 * SR)), 0) + 1e-10)
            new_long = np.sqrt(np.maximum(uniform_filter1d(new * new, size=round(.8 * SR)), 0) + 1e-10)
            dynamics = np.clip(old_long / np.maximum(new_long, .003), 10 ** (-4 / 20), 10 ** (4 / 20))
            dynamics = uniform_filter1d(dynamics, size=round(.35 * SR))
            new *= dynamics
            gain *= gain2
            detail = {'label': row['label'], 'shift_seconds': shift / SR,
                      'envelope_correlation': corr, 'gain': gain}
        weight = np.ones(len(old), dtype='float32')
        fade = round(.4 * SR)
        if a > 0:
            weight[:fade] = np.linspace(0, 1, fade)
        if b < len(source):
            weight[-fade:] = np.linspace(1, 0, fade)
        sums[a:b] += new * weight
        weights[a:b] += weight
        details.append(detail)
    a = round(rows[0]['interval'][0] * SR)
    b = round(rows[-1]['interval'][1] * SR)
    if not np.all(weights[a + 1:b - 1] > 0):
        raise ValueError('Voice section recovery left a gap in the assembly weights')
    voice = np.repeat((sums / np.maximum(weights, 1e-8))[:, None], 2, axis=1)
    sf.write(work / 'matched-vocals.wav', voice, SR, subtype='FLOAT')
    sf.write(work / 'matched-mix.wav', backing + voice, SR, subtype='FLOAT')
    save(work / 'voice-assembly.json', {
        'chunks': details,
        'treatment': 'Fresh phrase boundaries and neutral catalog references; V7 candidate',
        'voice_adapter': load(work / 'voice-profile.json')['files']['adapter'],
        'saved_favorites_used': False,
        'generated_singer_blended_back': False,
        'added_grit': False,
        'pitch_shift': 0,
        'listening_review': False,
        'allow_brief_phonetic_connections': True,
        'maximum_short_gap_bridge_seconds': .12,
        'inactive_voice_repair': REPORT,
    })


def validate(engine, work, rows, inactive):
    inactive_labels = {row['label'] for row in inactive}
    active_rows = [row for row in rows if row['label'] not in inactive_labels]
    engine.validate(active_rows)
    checks = load(work / 'voice-checks.json')
    for row in inactive:
        source_f0 = np.load(work / 'conversion' / (row['label'] + '-f0.npy'))
        converted = read(work / 'conversion' / (row['label'] + '-converted.wav')).mean(axis=1)
        if np.max(np.abs(converted)) > 1e-7:
            raise ValueError('Inactive voice replacement is no longer silent: ' + row['label'])
        checks['chunks'].append({
            'label': row['label'],
            'voiced_fraction': 0.0,
            'source_voiced_frames': int((source_f0 > 1).sum()),
            'converted_voiced_frames': 0,
            'analyzed_frames': int(len(source_f0)),
            'peak': 0.0,
            'pitch_check_applicable': False,
            'median_pitch_error_cents': None,
            'p90_pitch_error_cents': None,
            'inactive_source_section': True,
            'validation_basis': ('Source energy is below the saved assembly activity floor; '
                                 'pinned silence prevents invented voicing in the instrumental gap.'),
            'recovery': REPORT,
        })
    checks['chunks'].sort(key=lambda row: row['label'])
    checks['passed'] = True
    save(work / 'voice-checks.json', checks)


def apply(work):
    work = Path(work).resolve()
    status_path = work / REPORT
    report = load(status_path) if status_path.exists() else None
    plan = load(work / 'conversion-plan.json')
    rows = plan['chunks']
    inactive = inactive_rows(work, rows)
    if report is not None and report.get('version') not in (1, 2):
        raise ValueError('Unsupported inactive voice recovery journal')
    measured = check_limits(inactive, sf.info(work / 'selected-vocals.wav').duration,
                            legacy=report is not None and report['version'] == 1)
    root = status_path.parent
    originals = root / 'originals'
    originals.mkdir(parents=True, exist_ok=True)
    if report is None:
        report = {'version': 2, 'status': 'retaining', 'sections': inactive,
                  'limits': dict(LIMITS), 'measurements': measured,
                  'inputs_sha256': input_hashes(work, rows, inactive)}
        for row in report['sections']:
            converted = work / 'conversion' / (row['label'] + '-converted.wav')
            row['generated_sha256'] = sha(converted)
            row['retained_file'] = 'originals/' + converted.name
        save(status_path, report)
    elif [(row['label'], row['interval']) for row in report['sections']] != [(row['label'], row['interval']) for row in inactive]:
        raise ValueError('Inactive voice recovery inputs changed')
    if report['version'] == 2 and (report['limits'] != LIMITS or
            report['inputs_sha256'] != input_hashes(work, rows, inactive)):
        raise ValueError('Pinned inactive voice recovery inputs changed')
    retain_and_silence(work, report, status_path)
    if report['status'] == 'applied':
        for filename, key in [('matched-vocals.wav', 'matched_vocals_sha256'),
                              ('matched-mix.wav', 'matched_mix_sha256'),
                              ('voice-checks.json', 'voice_checks_sha256')]:
            if sha(work / filename) != report[key]:
                raise ValueError('Completed inactive voice recovery output changed: ' + filename)
        print(json.dumps({'status': 'applied', 'reused': True}))
        return
    report['status'] = 'assembling'
    save(status_path, report)
    spec = importlib.util.spec_from_file_location('inactive_voice_saved_engine', work / 'engine_voice.py')
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    assemble(engine, work, rows, report['sections'])
    # Persist the stage before validation so a failure resumes this same repair.
    state = load(work / 'desktop-status.json')
    state.update(status='failed', stage='validate', pid=None,
                 error='Inactive voice assembly completed; saved voice validation is pending.')
    save(work / 'desktop-status.json', state)
    report['status'] = 'validating'
    save(status_path, report)
    try:
        validate(engine, work, rows, report['sections'])
    except Exception:
        state.update(error=traceback.format_exc())
        save(work / 'desktop-status.json', state)
        report['status'] = 'validation_failed'
        save(status_path, report)
        raise
    if report['version'] == 2 and report['inputs_sha256'] != input_hashes(work, rows, inactive):
        raise ValueError('Pinned inputs changed during inactive voice recovery')
    state = load(work / 'desktop-status.json')
    for stage in ['assemble', 'validate']:
        if stage not in state['completed']:
            state['completed'].append(stage)
    state.update(status='ready', stage='validate', pid=None, error=None)
    save(work / 'desktop-status.json', state)
    report.update(status='applied', matched_vocals_sha256=sha(work / 'matched-vocals.wav'),
                  matched_mix_sha256=sha(work / 'matched-mix.wav'),
                  voice_checks_sha256=sha(work / 'voice-checks.json'))
    save(status_path, report)
    print(json.dumps({'status': 'applied', 'sections': [row['label'] for row in report['sections']]}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    apply(parser.parse_args().work)
