"""Publish retained playable audio when musical validation rejects a performance.

This is a separate delivery, never a claim that the failed quality checks passed.
Frozen inputs, original diagnostics, complete duration and file hashes are retained.
"""
import argparse
import math
import re
import subprocess
from pathlib import Path
from common import inside, load, save, sha

CODES = ('vocal_activity', 'voice_validation', 'vocal_dropout', 'unfinished_ending', 'mix_quality', 'unconverted_vocals')
VERIFY_FAILURES = {
    'Voice validation did not pass.': 'voice_validation',
    'Peak or ending validation failed.': 'mix_quality',
    'A vocal phrase may be missing.': 'vocal_dropout',
}


def classify(work, error):
    """Recognize actual quality failures, never transport, input or runtime errors."""
    message = str(error)
    if message in VERIFY_FAILURES:
        return [VERIFY_FAILURES[message]]
    state_path = Path(work) / 'desktop-status.json'
    if not state_path.exists(): return []
    state = load(state_path)
    detail = state.get('error', '')
    exceptions = list(re.finditer(r'^([\w.]+(?:Error|Exception)|KeyboardInterrupt|SystemExit)(?::|$)', detail, re.MULTILINE))
    if exceptions:
        last = exceptions[-1]
        detail = detail[detail.rfind('Traceback (most recent call last)', 0, last.start()) if 'Traceback (most recent call last)' in detail[:last.start()] else 0:]
        if last.group(1) not in ('AssertionError', 'ValueError'): return []
    if state.get('status') == 'failed' and state.get('stage') == 'finish' and 'ValueError: The final vocal has no complete ending' in detail:
        return ['unfinished_ending']
    if state.get('status') != 'failed' or 'AssertionError' not in detail:
        return []
    if state.get('stage') == 'configure':
        for text, code in (
            ('Insufficient vocal signal activity', 'vocal_activity'),
            ('Insufficient lead vocal coverage', 'vocal_activity'),
            ('Overlong orchestral gap', 'vocal_activity'),
            ('Repeated long instrumental interludes', 'vocal_activity'),
            ('Too much instrumental space', 'vocal_activity'),
            ('assert regions', 'vocal_activity'),
            ('Long instrumental introduction', 'vocal_activity'),
            ('Ending needs completion before fade', 'unfinished_ending'),
        ):
            if text in detail:
                return [code]
    if state.get('stage') == 'validate':
        if any(text in detail for text in ("item['peak']", "median_pitch_error_cents",
                'Insufficient mutually voiced frames', 'Added sustained voicing',
                "timing['envelope_correlation']", 'assert voiced.sum()')):
            return ['voice_validation']
    if state.get('stage') == 'assemble' and 'assert active.any()' in detail:
        return ['voice_validation']
    if state.get('stage') == 'finish':
        for text, code in (
            ('Missing vocal phrase', 'vocal_dropout'),
            ('Missing original vocal phrase', 'vocal_dropout'),
            ('Ending tail remains loud', 'unfinished_ending'),
            ('assert db(rms(', 'unfinished_ending'),
            ('encoded_peak', 'mix_quality'),
            ('mp3_peak', 'mix_quality'),
            ('assert voice_corr', 'voice_validation'),
            ("assert checks['passed']", 'voice_validation'),
            ('Long instrumental outro requires', 'unfinished_ending'),
        ):
            if text in detail:
                return [code]
    return []


def verify(work, output_dir):
    work = Path(work)
    marker = load(work / 'review-delivery.json')
    if marker.get('version') != 1 or marker.get('manifest_sha256') != sha(work / 'desktop-job.json'):
        raise ValueError('Saved review delivery inputs changed')
    manifest = load(work / 'desktop-job.json')
    if sha(work / 'track.json') != manifest['track_sha256']:
        raise ValueError('Frozen review track changed')
    track = load(work / 'track.json')
    if sha(work.parent / 'catalog-expansion-v6/tony-catalog-adapter.pt') != track['model_sha256']:
        raise ValueError('Frozen review voice model changed')
    if manifest.get('source_sha256') and sha(track['source_file']) != manifest['source_sha256']:
        raise ValueError('Frozen review source recording changed')
    for name, digest in manifest.get('workers', {}).items():
        if Path(name).name != name or sha(work / name) != digest:
            raise ValueError('Frozen review worker changed')
    for name, digest in marker['inputs_sha256'].items():
        if Path(name).name != name or sha(work / name) != digest:
            raise ValueError('Saved review audio changed')
    if sha(work / 'mix-results.json') != marker['report_sha256']:
        raise ValueError('Saved review report changed')
    result = marker['result']
    if result.get('status') != 'verified' or result.get('new_training') is not False or Path(result['work_path']).resolve() != work.resolve():
        raise ValueError('Invalid saved review delivery identity')
    if not result.get('validationFailures') or any(code not in CODES for code in result['validationFailures']):
        raise ValueError('Invalid review delivery evidence')
    if not math.isfinite(result['duration']) or not 5 <= result['duration'] <= 1440:
        raise ValueError('Invalid review delivery duration')
    if {Path(item['path']).suffix for item in result['files']} != {'.wav', '.mp3'}:
        raise ValueError('Both playable review exports are required')
    for item in result['files']:
        path = inside(item['path'], Path(output_dir) / (Path(item['path']).suffix[1:] + 's'))
        if not path.is_file() or path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
            raise ValueError('A review delivery file changed or is missing')
    return result


def execute(engine, request, work, manifest, review_fallback=True, **options):
    """Retain the normal renderer, with one deterministic playable-delivery fallback."""
    settings = request['config']['settings']
    if (work / 'review-delivery.json').exists():
        return verify(work, settings['output_dir'])
    try:
        return engine.execute_stages(work, manifest, **options)
    except (RuntimeError, ValueError) as error:
        failures = classify(work, error)
        if not failures or not review_fallback:
            raise
        engine.validate_saved(work, load(work / 'desktop-job.json'))
        saved = {'version': 1, 'validationFailures': failures, 'error': str(error),
                 'manifest_sha256': sha(work / 'desktop-job.json'),
                 'allow_generated': request['config'].get('publish_unconverted_review', True)}
        save(work / 'validation-publication.json', saved)
        with (work / 'review-export.log').open('a', encoding='utf-8') as log:
            subprocess.run([settings['voice_python'], str(Path(__file__).resolve()), '--work', str(work)],
                           cwd=work, stdout=log, stderr=subprocess.STDOUT, check=True,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return verify(work, settings['output_dir'])


def export(work):
    import numpy as np
    import soundfile as sf
    from longform import inspect_audio
    work = Path(work).resolve()
    policy = load(work / 'validation-publication.json')
    manifest = load(work / 'desktop-job.json')
    if sha(work / 'desktop-job.json') != policy['manifest_sha256']:
        raise ValueError('Frozen review manifest changed')
    if sha(work / 'track.json') != manifest['track_sha256']:
        raise ValueError('Frozen review track changed')
    settings = manifest['settings']
    if (work / 'review-delivery.json').exists():
        return verify(work, settings['output_dir'])
    track = load(work / 'track.json')
    inputs = {'track.json': sha(work / 'track.json')}
    failures = list(policy['validationFailures'])

    def read(name):
        path = work / name
        inputs[name] = sha(path)
        samples, rate = sf.read(path, dtype='float32', always_2d=True)
        if rate != 44100 or samples.shape[1] != 2 or not len(samples) or not np.isfinite(samples).all():
            raise ValueError('The retained audio is not a complete readable stereo recording')
        return samples

    # Use the converted performance whenever it exists. Before conversion, retain
    # the generated performance and say explicitly that Tony vocals are unfinished.
    if (work / 'matched-vocals.wav').exists() and (work / 'selected-backing.wav').exists():
        voice, backing = read('matched-vocals.wav'), read('selected-backing.wav')
        if voice.shape != backing.shape:
            raise ValueError('Retained voice and backing lengths differ')
        config_path = work / 'mix-config.json'
        gain = 1. if manifest['kind'] == 'new' else 0.
        if config_path.exists():
            inputs[config_path.name] = sha(config_path)
            gain = float(load(config_path).get('vocal_gain_db', 1.))
        if not math.isfinite(gain) or abs(gain) > 24:
            raise ValueError('Invalid retained vocal gain')
        samples = backing + voice * 10 ** (gain / 20)
    elif policy.get('allow_generated') and manifest['kind'] == 'new':
        samples = read('selected-mix.wav')
        failures.append('unconverted_vocals')
    else:
        raise ValueError('No retained converted performance is available to publish')
    duration = len(samples) / 44100
    if not 5 <= duration <= 1440 or not np.isfinite(samples).all():
        raise ValueError('Invalid retained full recording')
    # A single whole-recording gain provides encoding headroom; never cut, fade,
    # stretch, splice or regenerate any passage to make validation appear green.
    gain = min(1., .7 / max(float(np.max(np.abs(samples))), 1e-12))
    samples *= gain
    staging = work / 'review-export'
    staging.mkdir(exist_ok=True)
    stem = work.name + '-needs-review'
    wav, mp3 = staging / (stem + '.wav'), staging / (stem + '.mp3')
    sf.write(wav, samples, 44100, subtype='PCM_24')
    ffmpeg = settings['ffmpeg']
    hidden = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '320k',
                    '-metadata', 'title=' + track['title'], str(mp3)], check=True, creationflags=hidden)
    decoded = staging / 'decoded.wav'
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(mp3), '-c:a', 'pcm_f32le', str(decoded)],
                   check=True, creationflags=hidden)
    checks = inspect_audio(decoded)
    if abs(checks['frames'] - len(samples)) > 1152 or checks['peak_dbfs'] >= 0:
        raise ValueError('The review MP3 is truncated or clips')
    if checks['tail_dbfs'] >= -60 and 'unfinished_ending' not in failures:
        failures.append('unfinished_ending')
    for name, digest in inputs.items():
        if sha(work / name) != digest:
            raise ValueError('Retained audio changed while exporting')
    files = []
    for staged in (wav, mp3):
        target = Path(settings['output_dir']) / (staged.suffix[1:] + 's') / staged.name
        target = inside(target, settings['output_dir'])
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if sha(target) != sha(staged):
                raise ValueError('Refusing to overwrite a different review recording')
        else:
            staged.replace(target)
        files.append({'path': str(target), 'bytes': target.stat().st_size, 'sha256': sha(target)})
    result = {'status': 'verified', 'title': track['title'], 'duration': duration, 'files': files,
              'work_path': str(work), 'new_training': False, 'listening_review': False,
              'reviewState': 'needs_review', 'validationFailures': list(dict.fromkeys(failures))}
    report_path = work / 'mix-results.json'
    previous = load(report_path) if report_path.exists() else {}
    if report_path.exists() and not load(report_path).get('full_recording_preserved'):
        prior = work / 'mix-results-before-review.json'
        if prior.exists() and load(prior) != load(report_path):
            raise ValueError('A different original validation report is already retained')
        if not prior.exists():
            save(prior, load(report_path))
    arrangement = load(work / 'arrangement-checks.json') if (work / 'arrangement-checks.json').exists() else {}
    voice_checks = load(work / 'voice-checks.json') if (work / 'voice-checks.json').exists() else {'passed': False, 'review_required': True}
    report = {**result, 'status': 'completed', 'voice_checks': voice_checks,
              'mp3_true_peak_dbfs': checks['peak_dbfs'], 'final_half_second_rms_dbfs': checks['tail_dbfs'],
              # Keep measured evidence when available. The compatibility zero is
              # explicitly unmeasured, never evidence that the dropout check passed.
              'longest_missing_vocal_run_seconds': previous.get('longest_missing_vocal_run_seconds', 0),
              'vocal_dropout_measured': previous.get('vocal_dropout_measured', 'longest_missing_vocal_run_seconds' in previous),
              'qualityIssues': previous.get('qualityIssues', []),
              'arrangement_measured': bool(arrangement),
              'final_post_vocal_seconds': max(0, duration - arrangement.get('last_detected_voice', duration)),
              'arrangement': {'first_detected_voice': arrangement.get('first_detected_voice', 0), **arrangement},
              'full_recording_preserved': True, 'master_gain': gain}
    save(report_path, report)
    save(work / 'review-delivery.json', {'version': 1, 'manifest_sha256': policy['manifest_sha256'],
         'inputs_sha256': inputs, 'report_sha256': sha(report_path), 'result': result})
    return verify(work, settings['output_dir'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    export(parser.parse_args().work)
