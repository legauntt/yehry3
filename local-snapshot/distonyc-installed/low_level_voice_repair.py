"""Operator recovery for quiet source phrases rejected by the saved assembler.

The frozen V8 preparation deliberately normalizes each phrase before conversion.
For an explicitly sparse performance, a real low-level phrase can therefore be
converted successfully while the older assembler's absolute 0.001 activity floor
rejects its unnormalized source.  This repair keeps correlated converted phrases,
silences only genuinely inactive phrases, and pins every input before assembly.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d

from common import load, save, sha, utc
from inactive_voice_repair import (ACTIVITY_FLOOR, LIMITS, SR, check_limits,
    envelope, read, retain_and_silence)
from sparse_intent_policy import verify as verify_sparse_intent

REPORT = 'low-level-voice-repair/status.json'
LOW_LEVEL_FLOOR = 1e-6
MIN_CORRELATION = .8
MIN_CHANNEL_CORRELATION = .5
MIN_VOICED_FRACTION = .08


def best_alignment(old, new):
    x, y = envelope(old)[::220], envelope(new)[::220]
    scores = []
    for lag in range(-24, 25):
        aa, bb = (x[:-lag], y[lag:]) if lag > 0 else ((x[-lag:], y[:lag]) if lag < 0 else (x, y))
        if len(aa) > 2:
            score = float(np.corrcoef(aa, bb)[0, 1])
            if np.isfinite(score): scores.append((score, lag))
    if not scores: raise ValueError('Low-level voice phrase has no stable envelope alignment')
    return max(scores)


def analyze(work, rows):
    work = Path(work)
    source = read(work / 'selected-vocals.wav')
    inactive, low_level = [], []
    for row in rows:
        a, b = [round(value * SR) for value in row['interval']]
        chunk = source[a:b]
        old = chunk.mean(axis=1)
        env = envelope(old)
        if (env > max(float(env.max()) * .04, ACTIVITY_FLOOR)).any(): continue
        channel_peaks = [float(envelope(channel).max()) for channel in chunk.T]
        base = {'label': row['label'], 'interval': row['interval'],
                'duration_seconds': (b - a) / SR,
                'source_peak': float(np.max(np.abs(old))),
                'source_rms': float(np.sqrt(np.mean(old * old) + 1e-14)),
                'channel_envelope_peaks': channel_peaks}
        channel_correlation = float(np.corrcoef(chunk[:, 0], chunk[:, 1])[0, 1])
        converted = read(work / 'conversion' / (row['label'] + '-converted.wav')).mean(axis=1)
        converted = np.pad(converted, (0, max(0, len(old) - len(converted))))[:len(old)]
        correlation, lag = best_alignment(old, converted)
        source_f0 = np.load(work / 'conversion' / (row['label'] + '-f0.npy'))
        voiced_fraction = float((source_f0 > 1).mean())
        safe_low_level = (math.isfinite(channel_correlation)
            and channel_correlation >= MIN_CHANNEL_CORRELATION
            and correlation >= MIN_CORRELATION and abs(lag * 220 / SR) <= .05
            and voiced_fraction >= MIN_VOICED_FRACTION)
        if not safe_low_level and max(channel_peaks) <= ACTIVITY_FLOOR:
            inactive.append(base)
            continue
        if not safe_low_level:
            raise ValueError('Quiet stereo source is not safely correlated with its converted phrase: ' + row['label'])
        low_level.append({**base, 'channel_correlation': channel_correlation,
                          'envelope_correlation': correlation,
                          'alignment_shift_seconds': lag * 220 / SR,
                          'source_f0_voiced_fraction': voiced_fraction})
    if not low_level:
        raise ValueError('The failed assembly has no verified low-level voice phrase')
    measured = check_limits(inactive + low_level, sf.info(work / 'selected-vocals.wav').duration)
    return inactive, low_level, measured


def input_hashes(work, rows, inactive):
    inactive_labels = {row['label'] for row in inactive}
    names = ['selected-vocals.wav', 'selected-backing.wav', 'conversion-plan.json',
             'engine_voice.py', 'voice-profile.json', 'track.json',
             'sparse-vocal-intent-policy.json']
    names += ['conversion/' + row['label'] + '-f0.npy' for row in rows]
    names += ['conversion/' + row['label'] + '-converted.wav' for row in rows
              if row['label'] not in inactive_labels]
    return {name: sha(Path(work) / name) for name in names}


def assemble(engine, work, rows, inactive, low_level):
    source = read(work / 'selected-vocals.wav')
    backing = read(work / 'selected-backing.wav')
    sums = np.zeros(len(source), dtype='float32')
    weights = np.zeros_like(sums)
    details = []
    inactive = {row['label']: row for row in inactive}
    low_level = {row['label']: row for row in low_level}
    for row in rows:
        a, b = [round(value * SR) for value in row['interval']]
        old = source[a:b].mean(axis=1)
        new = read(work / 'conversion' / (row['label'] + '-converted.wav')).mean(axis=1)
        new = np.pad(new, (0, max(0, len(old) - len(new))))[:len(old)]
        env = envelope(old)
        floor = LOW_LEVEL_FLOOR if row['label'] in low_level else ACTIVITY_FLOOR
        active = env > max(float(env.max()) * .04, floor)
        if row['label'] in inactive:
            if active.any() or np.max(np.abs(new)) > 1e-7:
                raise ValueError('Inactive voice section changed during recovery: ' + row['label'])
            corr, shift, gain = 1.0, 0, 0.0
            detail = {'label': row['label'], 'shift_seconds': 0.0,
                      'envelope_correlation': 1.0, 'gain': 0.0,
                      'inactive_source_section': True, 'recovery': REPORT}
        else:
            corr, lag = best_alignment(old, new)
            if not active.any(): raise ValueError('Unexpected inactive voice section: ' + row['label'])
            shift = lag * 220
            if shift > 0: new = np.pad(new[shift:], (0, shift))
            if shift < 0: new = np.pad(new[:shift], (-shift, 0))
            gain = engine.rms(old[active]) / engine.rms(new[active]); new *= gain
            new *= engine.connected_gate(env, SR)
            gain2 = engine.rms(old[active]) / engine.rms(new[active]); new *= gain2
            old_long = np.sqrt(np.maximum(uniform_filter1d(old * old, size=round(.8 * SR)), 0) + 1e-10)
            new_long = np.sqrt(np.maximum(uniform_filter1d(new * new, size=round(.8 * SR)), 0) + 1e-10)
            dynamics = np.clip(old_long / np.maximum(new_long, .003), 10 ** (-4 / 20), 10 ** (4 / 20))
            new *= uniform_filter1d(dynamics, size=round(.35 * SR))
            gain *= gain2
            detail = {'label': row['label'], 'shift_seconds': shift / SR,
                      'envelope_correlation': corr, 'gain': gain}
            if row['label'] in low_level:
                detail.update(low_level_source_phrase=True, recovery=REPORT,
                              standard_activity_floor=ACTIVITY_FLOOR,
                              authorized_activity_floor=LOW_LEVEL_FLOOR)
        weight = np.ones(len(old), dtype='float32'); fade = round(.4 * SR)
        if a > 0: weight[:fade] = np.linspace(0, 1, fade)
        if b < len(source): weight[-fade:] = np.linspace(1, 0, fade)
        sums[a:b] += new * weight; weights[a:b] += weight; details.append(detail)
    a = round(rows[0]['interval'][0] * SR); b = round(rows[-1]['interval'][1] * SR)
    if not np.all(weights[a + 1:b - 1] > 0):
        raise ValueError('Low-level voice recovery left a gap in the assembly weights')
    voice = np.repeat((sums / np.maximum(weights, 1e-8))[:, None], 2, axis=1)
    sf.write(work / 'matched-vocals.wav', voice, SR, subtype='FLOAT')
    sf.write(work / 'matched-mix.wav', backing + voice, SR, subtype='FLOAT')
    save(work / 'voice-assembly.json', {'chunks': details,
        'treatment': 'Fresh phrase boundaries with hash-pinned low-level sparse-voice recovery',
        'voice_adapter': load(work / 'voice-profile.json')['files']['adapter'],
        'saved_favorites_used': False, 'generated_singer_blended_back': False,
        'added_grit': False, 'pitch_shift': 0, 'listening_review': False,
        'allow_brief_phonetic_connections': True, 'maximum_short_gap_bridge_seconds': .12,
        'low_level_voice_repair': REPORT})


def validate(engine, work, rows, inactive):
    inactive_labels = {row['label'] for row in inactive}
    engine.validate([row for row in rows if row['label'] not in inactive_labels])
    checks = load(work / 'voice-checks.json')
    for row in inactive:
        source_f0 = np.load(work / 'conversion' / (row['label'] + '-f0.npy'))
        converted = read(work / 'conversion' / (row['label'] + '-converted.wav')).mean(axis=1)
        if np.max(np.abs(converted)) > 1e-7:
            raise ValueError('Inactive voice replacement is no longer silent: ' + row['label'])
        checks['chunks'].append({'label': row['label'], 'voiced_fraction': 0.0,
            'source_voiced_frames': int((source_f0 > 1).sum()), 'converted_voiced_frames': 0,
            'analyzed_frames': int(len(source_f0)), 'peak': 0.0,
            'pitch_check_applicable': False, 'median_pitch_error_cents': None,
            'p90_pitch_error_cents': None, 'inactive_source_section': True,
            'validation_basis': 'Source remains below the saved activity floor; pinned silence prevents invented voicing.',
            'recovery': REPORT})
    checks['chunks'].sort(key=lambda row: row['label']); checks['passed'] = True
    save(work / 'voice-checks.json', checks)


def apply(work):
    work = Path(work).resolve()
    verify_sparse_intent(work)
    status_path = work / REPORT
    report = load(status_path) if status_path.exists() else None
    rows = load(work / 'conversion-plan.json')['chunks']
    state = load(work / 'desktop-status.json')
    if report is None and (state.get('status') != 'failed' or state.get('stage') != 'assemble'
            or 'assert active.any()' not in state.get('error', '')):
        raise ValueError('Low-level voice recovery requires the retained assembly activity failure')
    inactive, low_level, measured = analyze(work, rows)
    hashes = input_hashes(work, rows, inactive)
    if report is None:
        report = {'version': 1, 'at': utc(), 'status': 'retaining',
                  'sections': inactive, 'low_level_sections': low_level,
                  'limits': dict(LIMITS), 'measurements': measured,
                  'inputs_sha256': hashes, 'audio_generation_repeated': False,
                  'voice_model_changed': False, 'other_voice_checks_retained': True}
        for row in report['sections']:
            converted = work / 'conversion' / (row['label'] + '-converted.wav')
            row['generated_sha256'] = sha(converted)
            row['retained_file'] = 'originals/' + converted.name
        save(status_path, report)
    elif (report.get('version') != 1 or report.get('limits') != LIMITS
            or report.get('inputs_sha256') != hashes
            or [row['label'] for row in report.get('sections', [])] != [row['label'] for row in inactive]
            or [row['label'] for row in report.get('low_level_sections', [])] != [row['label'] for row in low_level]):
        raise ValueError('Pinned low-level voice recovery inputs changed')
    retain_and_silence(work, report, status_path)
    if report['status'] == 'applied':
        for filename, key in [('matched-vocals.wav', 'matched_vocals_sha256'),
                              ('matched-mix.wav', 'matched_mix_sha256'),
                              ('voice-checks.json', 'voice_checks_sha256')]:
            if sha(work / filename) != report[key]:
                raise ValueError('Completed low-level voice recovery output changed: ' + filename)
        print(json.dumps({'status': 'applied', 'reused': True})); return
    report['status'] = 'assembling'; save(status_path, report)
    spec = importlib.util.spec_from_file_location('low_level_saved_engine', work / 'engine_voice.py')
    engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
    assemble(engine, work, rows, report['sections'], report['low_level_sections'])
    state.update(status='failed', stage='validate', pid=None,
                 error='Low-level voice assembly completed; saved voice validation is pending.')
    save(work / 'desktop-status.json', state)
    report['status'] = 'validating'; save(status_path, report)
    validate(engine, work, rows, report['sections'])
    if report['inputs_sha256'] != input_hashes(work, rows, inactive):
        raise ValueError('Pinned inputs changed during low-level voice recovery')
    state = load(work / 'desktop-status.json')
    for stage in ('assemble', 'validate'):
        if stage not in state['completed']: state['completed'].append(stage)
    state.update(status='ready', stage='validate', pid=None, error=None)
    save(work / 'desktop-status.json', state)
    report.update(status='applied', matched_vocals_sha256=sha(work / 'matched-vocals.wav'),
                  matched_mix_sha256=sha(work / 'matched-mix.wav'),
                  voice_checks_sha256=sha(work / 'voice-checks.json'))
    save(status_path, report)
    print(json.dumps({'status': 'applied',
        'inactive_sections': [row['label'] for row in report['sections']],
        'low_level_sections': [row['label'] for row in report['low_level_sections']]}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--work', type=Path, required=True)
    apply(parser.parse_args().work)
