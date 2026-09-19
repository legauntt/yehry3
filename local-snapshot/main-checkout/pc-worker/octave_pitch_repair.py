"""Operator-only, one-attempt octave repair for a measured versioned voice phrase.

Render a candidate with --prepare; inspect its retained checks before --apply.
This does not change queue state, creative inputs, models, or acceptance limits.
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from common import load, save, sha, singleton, utc

SR = 44100
REPORT = 'pitch-octave-repair/status.json'


def read(path):
    audio, rate = sf.read(path, dtype='float32', always_2d=True)
    if rate != SR or not np.isfinite(audio).all():
        raise ValueError('Invalid saved audio: ' + str(path))
    return audio


def patch(original, shifted, start, stop, fade=.04):
    """Crossfade only the measured error interval, preserving all other PCM."""
    if original.shape != shifted.shape or not (0 <= start < stop <= len(original)):
        raise ValueError('Correction shape or interval changed')
    if (stop - start) / SR > 4:
        raise ValueError('Octave repair exceeds four seconds')
    width = round(fade * SR)
    if width <= 1 or stop - start < width * 2:
        raise ValueError('Correction interval is too short for its crossfades')
    weight = np.ones(stop - start, dtype='float32')
    weight[:width] = .5 - .5 * np.cos(np.linspace(0, np.pi, width))
    weight[-width:] = weight[:width][::-1]
    result = original.copy()
    result[start:stop] = original[start:stop] * (1 - weight[:, None]) + shifted[start:stop] * weight[:, None]
    if not np.isfinite(result).all() or np.max(np.abs(result)) >= .999:
        raise ValueError('Correction failed signal integrity')
    if not np.array_equal(result[:start], original[:start]) or not np.array_equal(result[stop:], original[stop:]):
        raise ValueError('Correction changed audio outside its interval')
    return result


def fit_context(original, shifted, stop):
    # Rubber Band may omit a short filter tail. Only unused context can be
    # padded; a corrected sample or its crossfade must never come from padding.
    if original.shape[1:] != shifted.shape[1:] or abs(len(original)-len(shifted)) > round(.25*SR):
        raise ValueError('Pitch filter changed context duration unexpectedly')
    if len(shifted) < stop + round(.1*SR):
        raise ValueError('Pitch filter output does not cover the complete correction')
    if len(shifted) < len(original):
        shifted = np.pad(shifted, ((0, len(original)-len(shifted)), (0, 0)))
    return shifted[:len(original)]


def saved_engine(work):
    spec = importlib.util.spec_from_file_location('octave_saved_engine', work / 'engine_voice.py')
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    return engine


def shift(ffmpeg, source, destination):
    subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-n', '-i', str(source),
        '-af', 'rubberband=tempo=1:pitch=2:transients=smooth:formant=preserved:pitchq=quality:channels=together',
        '-c:a', 'pcm_f32le', str(destination)], check=True, timeout=120,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def measured_pitch(engine, audio):
    from modules.rmvpe import RMVPE
    c = engine.c
    c.torch.backends.mkldnn.enabled = False
    c.torch.set_num_threads(2)
    pitch = RMVPE(str(c.MODELS / 'rmvpe.pt'), is_half=False, device='cpu')
    with c.torch.inference_mode():
        samples = c.torch.from_numpy(c.resample_poly(audio.mean(1), 160, 441).astype('float32'))
        return pitch.infer_from_audio(samples, thred=.03)


def pitch_check(expected, actual, interval=None):
    n = min(len(expected), len(actual))
    a, b = (0, n) if interval is None else (round(interval[0] / .01), min(n, round(interval[1] / .01)))
    old, new = expected[a:b], actual[a:b]
    both = (old > 1) & (new > 1)
    if both.sum() <= 10:
        raise ValueError('Insufficient mutually voiced frames')
    cents = 1200 * np.log2(new[both] / old[both])
    return {'mutually_voiced_frames': int(both.sum()),
        'median_signed_cents': float(np.median(cents)),
        'median_pitch_error_cents': float(np.median(np.abs(cents))),
        'p90_pitch_error_cents': float(np.percentile(np.abs(cents), 90))}


def verify_files(root, pins):
    for name, expected in pins.items():
        if sha(root / name) != expected:
            raise ValueError('Pinned repair file changed: ' + name)


def prepare(work, label, interval):
    root = work / 'pitch-octave-repair'
    path = root / 'status.json'
    retained = None
    if path.exists():
        report = load(path)
        if report['status'] in ('verified', 'applied'):
            verify_files(root, report['candidate_sha256'])
            return report
        if report['status'] == 'failed' and report.get('error') == 'Correction shape or interval changed':
            verify_files(work, report['source_sha256'])
            if report['label'] != label or report['interval'] != interval:
                raise ValueError('Runtime resume cannot change the attempted repair')
            retained = report
        else:
            raise ValueError('The one octave-correction attempt is already consumed; inspect its retained evidence')
    state = load(work / 'desktop-status.json')
    if state.get('status') != 'failed' or state.get('stage') != 'validate':
        raise ValueError('Octave repair requires a saved voice-validation failure')
    if load(work / 'track.json').get('voice_model') != 'v7':
        raise ValueError('This reviewed operator repair is limited to Tony V7')
    manifest = load(work / 'desktop-job.json')
    verify_files(work, manifest['workers'])
    if sha(work / 'track.json') != manifest['track_sha256']:
        raise ValueError('Frozen track changed')
    rows = load(work / 'conversion-plan.json')['chunks']
    row = next(item for item in rows if item['label'] == label)
    origin, end = row['interval']
    start, stop = interval
    if not (origin <= start < stop <= end and stop - start <= 4):
        raise ValueError('Repair must fit inside one phrase and four seconds')
    source_names = ['selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav', 'matched-mix.wav',
        'voice-assembly.json', 'conversion-plan.json', 'desktop-status.json', 'desktop-job.json', 'track.json',
        'voice-profile.json', 'engine_voice.py']
    source_names += ['conversion/' + item['label'] + suffix for item in rows for suffix in ('-converted.wav', '-f0.npy')]
    pins = {name: sha(work / name) for name in source_names}
    report = retained or {'version': 1, 'status': 'preparing', 'attempts': 1, 'at': utc(), 'work': str(work),
        'label': label, 'interval': interval, 'phrase_interval': row['interval'], 'source_sha256': pins,
        'method': 'One-octave upward Rubber Band correction with preserved formants and 40ms crossfades',
        'thresholds_unchanged': True, 'source_voice_blend': 0, 'new_training': False,
        'authorization': 'Jesse explicitly requested this additional bounded fix after review of the exhausted alternate-reference attempt.'}
    if retained:
        report.setdefault('runtime_recoveries', []).append({'at': utc(), 'error': report['error'],
            'remedy': 'Reuse the same shifted phrase; pad only unused filter-tail context outside the correction.',
            'shifted_phrase_sha256': sha(root / 'shifted-phrase.wav')})
    save(path, report)  # Spend the attempt before producing any candidate.
    try:
        originals = root / 'originals'
        candidate = root / 'candidate'
        originals.mkdir(exist_ok=True)
        (candidate / 'conversion').mkdir(parents=True, exist_ok=True)
        for name in ['matched-vocals.wav', 'matched-mix.wav', 'voice-assembly.json', 'desktop-status.json']:
            shutil.copy2(work / name, originals / name)
        for item in rows:
            for suffix in ('-converted.wav', '-f0.npy'):
                name = item['label'] + suffix
                shutil.copy2(work / 'conversion' / name, candidate / 'conversion' / name)
        shutil.copy2(work / 'conversion' / (label + '-converted.wav'), originals / (label + '-converted.wav'))
        shutil.copy2(work / 'voice-assembly.json', candidate / 'voice-assembly.json')
        engine = saved_engine(work)
        expected = np.load(work / 'conversion' / (label + '-f0.npy'))
        raw = read(work / 'conversion' / (label + '-converted.wav'))
        before = measured_pitch(engine, raw)
        report['before'] = pitch_check(expected, before, [start-origin, stop-origin])
        if abs(report['before']['median_signed_cents'] + 1200) >= 60:
            raise ValueError('Measured error is not the reviewed one-octave downward failure')
        ffmpeg = manifest['settings']['ffmpeg']
        if retained is None:
            shift(ffmpeg, originals / (label + '-converted.wav'), root / 'shifted-phrase.wav')
        shifted = read(root / 'shifted-phrase.wav')
        shifted = fit_context(raw, shifted, round((stop-origin)*SR))
        corrected = patch(raw, shifted, round((start-origin)*SR), round((stop-origin)*SR))
        sf.write(candidate / 'conversion' / (label + '-converted.wav'), corrected, SR, subtype='FLOAT')
        # Correct the assembled V7 stem independently; do not alter the backing or re-normalize other sections.
        voice = read(originals / 'matched-vocals.wav')
        a, b = round(origin * SR), round(end * SR)
        sf.write(root / 'assembled-context.wav', voice[a:b], SR, subtype='FLOAT')
        shift(ffmpeg, root / 'assembled-context.wav', root / 'shifted-context.wav')
        shifted_context = fit_context(voice[a:b], read(root / 'shifted-context.wav'), round((stop-origin)*SR))
        local = patch(voice[a:b], shifted_context, round((start-origin)*SR), round((stop-origin)*SR))
        revised = voice.copy()
        revised[a:b] = local
        report['assembled_pitch'] = pitch_check(expected, measured_pitch(engine, local), [start-origin+.05, stop-origin-.05])
        if report['assembled_pitch']['median_pitch_error_cents'] >= 60:
            raise ValueError('Corrected assembled passage still fails the original pitch limit')
        left, right = round(start * SR), round(stop * SR)
        if not np.array_equal(revised[:left], voice[:left]) or not np.array_equal(revised[right:], voice[right:]):
            raise ValueError('Assembled correction changed samples outside the patch')
        mix = read(originals / 'matched-mix.wav')
        revised_mix = mix.copy()
        backing = read(work / 'selected-backing.wav')
        revised_mix[left:right] = backing[left:right] + revised[left:right]
        sf.write(candidate / 'matched-vocals.wav', revised, SR, subtype='FLOAT')
        sf.write(candidate / 'matched-mix.wav', revised_mix, SR, subtype='FLOAT')
        engine.HERE, engine.OUT = candidate, candidate / 'conversion'
        engine.validate(rows)  # Execute the entire original, unchanged 27-phrase validator.
        report['after'] = next(item for item in load(candidate / 'voice-checks.json')['chunks'] if item['label'] == label)
        report['unchanged_samples_outside_patch'] = True
        verify_files(work, pins)
        report['candidate_sha256'] = {str(item.relative_to(root)): sha(item) for item in candidate.rglob('*') if item.is_file()}
        report.update(status='verified', verified_at=utc())
        save(path, report)
        return report
    except BaseException as error:
        report.update(status='failed', error=str(error), failed_at=utc())
        save(path, report)
        raise


def apply(work):
    root = work / 'pitch-octave-repair'
    report = load(root / 'status.json')
    if report['status'] == 'applied':
        verify_files(work, report['applied_sha256'])
        return report
    if report['status'] not in ('verified', 'applying'):
        raise ValueError('Only a fully verified candidate may be applied')
    verify_files(root, report['candidate_sha256'])
    candidate = root / 'candidate'
    names = ['conversion/' + report['label'] + '-converted.wav', 'matched-vocals.wav', 'matched-mix.wav', 'voice-checks.json']
    if report['status'] == 'verified':
        verify_files(work, report['source_sha256'])
        assembly = load(work / 'voice-assembly.json')
        assembly['octave_pitch_repair'] = {'report': REPORT, 'interval': report['interval'], 'semitones': 12,
            'formants_preserved': True, 'unchanged_samples_outside_patch': True}
        save(root / 'apply-ready/voice-assembly.json', assembly)
        state = load(work / 'desktop-status.json')
        if 'validate' not in state['completed']:
            state['completed'].append('validate')
        state.update(status='ready', stage='validate', pid=None, error=None)
        save(root / 'apply-ready/desktop-status.json', state)
        report['replacements'] = {name: {'source': str((candidate / name).relative_to(root)), 'sha256': sha(candidate / name)} for name in names}
        for name in ['voice-assembly.json', 'desktop-status.json']:
            report['replacements'][name] = {'source': 'apply-ready/' + name, 'sha256': sha(root / 'apply-ready' / name)}
        report.update(status='applying')
        save(root / 'status.json', report)
    # Restart accepts only a pinned original or its already-verified replacement.
    for name, expected in report['source_sha256'].items():
        allowed = {expected}
        if name in report['replacements']:
            allowed.add(report['replacements'][name]['sha256'])
        if sha(work / name) not in allowed:
            raise ValueError('Repair input changed during application: ' + name)
    for name, item in report['replacements'].items():
        if sha(root / item['source']) != item['sha256']:
            raise ValueError('Verified replacement changed: ' + name)
        target = work / name
        if target.exists() and sha(target) == item['sha256']:
            continue
        if name not in report['source_sha256'] and target.exists():
            raise ValueError('An unexpected output appeared during application: ' + name)
        temporary = target.with_name(target.name + '.octave-repair.tmp')
        shutil.copy2(root / item['source'], temporary)
        os.replace(temporary, target)
    report['applied_sha256'] = {name: item['sha256'] for name, item in report['replacements'].items() if name != 'desktop-status.json'}
    report.update(status='applied', applied_at=utc())
    save(root / 'status.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--label')
    parser.add_argument('--interval', nargs=2, type=float)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply and (not args.label or args.interval is None):
        parser.error('Preparing an operator repair requires an explicit --label and --interval')
    work = args.work.resolve()
    with singleton(work / 'pitch-octave-repair/operator.lock') as acquired:
        if not acquired:
            raise RuntimeError('Another octave repair is active for this song')
        result = apply(work) if args.apply else prepare(work, args.label, args.interval)
        print(json.dumps({key: result[key] for key in ['status', 'label', 'interval', 'before', 'after', 'assembled_pitch']}), flush=True)
