"""Connected long-song movements, rendered privately and delivered as one mix."""
import argparse
import math
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

if __name__ == '__main__' and '--worker-resources' in sys.argv:
    sys.path.insert(0, sys.argv[sys.argv.index('--worker-resources') + 1])
from common import fingerprint, inside, load, save, sha
from vocal_accents import for_movement as movement_vocal_accents

VERSION = 1


def child_request(request, work, index):
    plan = request['plan']; part = plan['movements'][index]
    count = len(plan['movements'])
    directory = Path(request['directory']) / 'movements' / str(index + 1)
    child_plan = {**plan, **part, 'title': plan['title'][:65] + f' - Movement {index + 1}', 'movements': []}
    if 'vocal_accents' in plan:
        child_plan['vocal_accents'] = movement_vocal_accents(plan, index)
    child_plan['arrangement'] = (f'Movement {index + 1} of {count} in one connected song. '
        'Keep the shared main hook, genre, key and pulse; develop this chapter with its own supplied words. '
        + part['arrangement'])
    config = {**request['config'], 'settings': {**request['config']['settings'],
              'output_dir': str(work / 'private-movements')}}
    return {**request, 'prompt_id': request['prompt_id'] + f':movement:{index + 1}',
            'directory': str(directory), 'config': config, 'plan': child_plan,
            'suite_progress': {'path': str(Path(request['directory']) / 'progress.json'), 'index': index, 'count': count}}


def render_suite(request, render, verify_attempt):
    from planner import validate
    validate(request['plan'], request['basis'])
    settings = request['config']['settings']
    ident = str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + ':suite-v1'))
    work = Path(settings['studio_dir']).parent / ('troofs-suite-' + ident)
    work.mkdir(exist_ok=True)
    path = work / 'suite-job.json'
    inputs = fingerprint({'plan': request['plan'], 'basis': request['basis'], 'settings': settings})
    if path.exists():
        journal = load(path)
        if journal.get('version') != VERSION or journal.get('inputs_hash') != inputs:
            raise ValueError('Saved long-song inputs changed; retain completed movements')
    else:
        snapshot = work / 'finish_suite.py'
        shutil.copy2(Path(__file__), snapshot)
        save(work / 'spec.json', {'kind': 'new', **request['plan']})
        journal = {'version': VERSION, 'inputs_hash': inputs, 'finisher_sha256': sha(snapshot),
                   'spec_sha256': sha(work / 'spec.json'),
                   'title': request['plan']['title'] + ' - D' + ident[:8],
                   'requested_duration': request['plan']['duration'], 'settings': settings,
                   'parts': [], 'status': 'rendering', 'one_public_song': True}
        save(path, journal)
    if sha(work / 'finish_suite.py') != journal['finisher_sha256']:
        raise ValueError('Saved suite finisher changed')
    if sha(work / 'spec.json') != journal['spec_sha256']:
        raise ValueError('Saved suite plan changed')
    if (work / 'mix-results.json').exists():
        return verify_attempt({**request, 'verify_existing': str(work)})
    for index in range(len(request['plan']['movements'])):
        child = child_request(request, work, index)
        directory = Path(child['directory']); directory.mkdir(parents=True, exist_ok=True)
        material = Path(request['directory']) / 'source-material.json'
        if material.exists():
            saved = directory / 'source-material.json'
            if saved.exists() and sha(saved) != sha(material): raise ValueError('Suite source references changed')
            if not saved.exists(): shutil.copy2(material, saved)
        if index < len(journal['parts']):
            result = journal['parts'][index]['result']
            verify_attempt({**child, 'verify_existing': result['work_path']})
            continue
        result = render(child)
        if result.get('status') != 'verified': raise ValueError('Suite movement did not pass verification')
        part_work = inside(result['work_path'], work.parent)
        save(directory / 'render-result.json', result)
        journal['parts'].append({'number': index + 1, 'result': result,
                                'mix_report_sha256': sha(part_work / 'mix-results.json')})
        save(path, journal)
    try: save(Path(request['directory']) / 'progress.json', {'stage': 'Mastering the complete song', 'percent': 95})
    except OSError: pass
    with (Path(request['directory']) / 'suite-master.log').open('a', encoding='utf-8') as log:
        subprocess.run([settings['voice_python'], str(work / 'finish_suite.py'), '--work', str(work),
                        '--worker-resources', str(Path(__file__).parent)], cwd=work,
                       stdout=log, stderr=subprocess.STDOUT, check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    result = verify_attempt({**request, 'verify_existing': str(work)})
    journal.update(status='completed', result=result)
    save(path, journal)
    return result


def aggregate_issues(reports):
    issues = {}; offset = 0.; chapters = []
    for index, report in enumerate(reports):
        chapters.append({'start': offset, 'duration': report['duration'], 'title': report['title']})
        offset += report['duration']
        for issue in report.get('qualityIssues', []):
            code, seconds = issue['code'], issue['seconds']
            if code == 'long_instrumental_outro' and index < len(reports) - 1: continue
            issues[code] = issues.get(code, 0) + seconds if code == 'vocal_dropout' else max(issues.get(code, 0), seconds)
        if index:
            gap = reports[index - 1]['final_post_vocal_seconds'] + report['arrangement']['first_detected_voice']
            if gap >= 9.5: issues['long_instrumental_break'] = max(issues.get('long_instrumental_break', 0), gap)
    return [{'code': code, 'seconds': round(seconds, 2)} for code, seconds in issues.items()], chapters


def join_wavs(paths, destination):
    import numpy as np
    import soundfile as sf
    frames = 0
    with sf.SoundFile(destination, 'w', samplerate=44100, channels=2, subtype='PCM_24') as output:
        for path in paths:
            with sf.SoundFile(path) as source:
                if source.samplerate != 44100 or source.channels != 2:
                    raise ValueError('Movement format changed')
                # Each complete movement already has a checked natural ending.
                # Concatenate its exact PCM, including every quiet vocal tail.
                for block in source.blocks(blocksize=44100 * 4, dtype='float32', always_2d=True):
                    if not np.isfinite(block).all(): raise ValueError('Nonfinite movement audio')
                    output.write(block); frames += len(block)
    return frames


def inspect_audio(path):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    peak = 0.; frames = 0; previous = None
    with sf.SoundFile(path) as source:
        if source.samplerate != 44100 or source.channels != 2: raise ValueError('Invalid full-song audio format')
        for block in source.blocks(blocksize=44100 * 4, dtype='float32', always_2d=True):
            if not np.isfinite(block).all(): raise ValueError('Nonfinite full-song audio')
            context = np.concatenate([previous, block]) if previous is not None else block
            peak = max(peak, float(np.max(np.abs(resample_poly(context, 4, 1, axis=0)))))
            previous = block[-100:]; frames += len(block)
        source.seek(max(0, source.frames - 22050))
        tail = source.read(dtype='float32', always_2d=True)
    return {'frames': frames, 'peak_dbfs': 20 * math.log10(max(peak, 1e-12)),
            'tail_dbfs': float(10 * np.log10(np.mean(tail * tail) + 1e-14))}


def master(work):
    work = Path(work); journal = load(work / 'suite-job.json')
    if sha(work / 'spec.json') != journal['spec_sha256'] or sha(work / 'finish_suite.py') != journal['finisher_sha256']:
        raise ValueError('Saved suite plan or finisher changed')
    reports = []; paths = []
    for part in journal['parts']:
        part_work = inside(part['result']['work_path'], work.parent)
        report_path = part_work / 'mix-results.json'
        if sha(report_path) != part['mix_report_sha256']: raise ValueError('Completed movement report changed')
        report = load(report_path)
        if report.get('validationFailures'):
            from review_publication import verify
            verify(part_work, work / 'private-movements')
        if report.get('status') != 'completed' or not (report['voice_checks']['passed'] or report.get('validationFailures')):
            raise ValueError('Unverified movement cannot enter the full song')
        for item in report['files']:
            path = inside(item.get('file', item.get('path')), work / 'private-movements')
            if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
                raise ValueError('Completed movement audio changed')
            if path.suffix.lower() == '.wav': paths.append(path)
        reports.append(report)
    if len(paths) != len(reports) or not 3 <= len(reports) <= 6 or len(reports) != len(load(work / 'spec.json')['movements']):
        raise ValueError('Incomplete long-song movements')
    staging = work / 'delivery-stage'; staging.mkdir(exist_ok=True)
    wav = staging / (journal['title'] + '.wav'); mp3 = wav.with_suffix('.mp3')
    frames = join_wavs(paths, wav)
    # The creative target is at most 19 minutes; allow bounded ending recovery
    # and natural timing drift without cutting any movement to a stopwatch.
    if not 120 <= frames / 44100 <= 1440: raise ValueError('Unexpected full-song duration')
    ffmpeg = journal['settings']['ffmpeg']
    hidden = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '320k',
        '-metadata', 'title=' + journal['title'], '-metadata', 'artist=troofs - AI music experiment', str(mp3)], check=True, creationflags=hidden)
    decoded = staging / 'decoded-check.wav'
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(mp3), '-c:a', 'pcm_f32le', str(decoded)], check=True, creationflags=hidden)
    checks = inspect_audio(decoded)
    failures = sorted({code for report in reports for code in report.get('validationFailures', [])})
    if checks['tail_dbfs'] >= -60 and failures and 'unfinished_ending' not in failures:
        failures.append('unfinished_ending')
    if abs(checks['frames'] - frames) > 1152 or checks['peak_dbfs'] >= -.5 or (checks['tail_dbfs'] >= -60 and not failures):
        raise ValueError('The complete encoded song did not pass peak, duration or ending checks')
    output = Path(journal['settings']['output_dir']); files = []
    for staged in (wav, mp3):
        final = output / (staged.suffix[1:] + 's') / staged.name
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            if sha(final) != sha(staged): raise ValueError('Refusing to replace an existing full song')
        else: staged.replace(final)
        files.append({'file': str(final), 'bytes': final.stat().st_size, 'sha256': sha(final)})
    issues, chapters = aggregate_issues(reports)
    first_work = Path(journal['parts'][0]['result']['work_path'])
    track = load(first_work / 'track.json')
    track.update(title=journal['title'], duration=frames / 44100, lyrics=load(work / 'spec.json')['lyrics'],
                 output_directory=str(output), multipart_song=True)
    save(work / 'track.json', track)
    report = {'status': 'completed', 'title': journal['title'], 'duration': frames / 44100,
        'files': files, 'wav': files[0]['file'], 'mp3': files[1]['file'],
        'voice_checks': {'passed': all(row['voice_checks']['passed'] for row in reports), 'movements': [row['voice_checks'] for row in reports]},
        'longest_missing_vocal_run_seconds': max(row['longest_missing_vocal_run_seconds'] for row in reports),
        'vocal_dropout_measured': all(row.get('vocal_dropout_measured', True) for row in reports),
        'mp3_true_peak_dbfs': checks['peak_dbfs'], 'final_half_second_rms_dbfs': checks['tail_dbfs'],
        'sample_difference': checks['frames'] - frames, 'final_post_vocal_seconds': reports[-1]['final_post_vocal_seconds'],
        'qualityIssues': issues, 'chapters': chapters, 'new_voice_training': False,
        'generated_source_voice_blend': 0,
        'complete_movement_pcm_preserved': True, 'listening_review': False,
        'movement_provenance': journal['parts'],
        **({'validationFailures': failures, 'reviewState': 'needs_review'} if failures else {})}
    save(work / 'mix-results.json', report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--worker-resources', required=True)
    master(parser.parse_args().work)
