"""One operator-authorized shorter composition for a sparse submitted lyric sheet.

The original plan, audio and journals stay intact. Retries resume the same child;
no planner call, automatic repeat composition, waveform cut or relaxed audio guard.
"""
import argparse
import copy
from pathlib import Path

from common import fingerprint, inside, load, save, sha, utc
from composition_ending import work_path
from planner import validate
from request_materials import render_brief, validate_materials

REPORT = 'lyric-length-repair.json'
ORIGINAL_FILES = ('desktop-job.json', 'desktop-status.json', 'track.json',
                  'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav',
                  'arrangement-checks.json')


def verify(request, record):
    directory = Path(request['directory'])
    if (record.get('version') != 1 or record.get('attempt_limit') != 1 or record.get('attempts') != 1
            or record.get('request_hash') != fingerprint(request)):
        raise ValueError('Saved lyric-length repair inputs or budget changed')
    original = inside(record['original_work'], Path(request['config']['settings']['studio_dir']).parent)
    if original.resolve() != work_path(request).resolve():
        raise ValueError('Unexpected original lyric-length repair folder')
    if set(record.get('original_sha256', {})) != set(ORIGINAL_FILES):
        raise ValueError('Missing retained original composition evidence')
    if any(sha(original / name) != digest for name, digest in record['original_sha256'].items()):
        raise ValueError('Original composition changed during lyric-length repair')
    if set(record.get('planning_sha256', {})) != {'plan.json', 'planning-input.json'}:
        raise ValueError('Missing frozen lyric-length planning evidence')
    for name, digest in record['planning_sha256'].items():
        if name not in ('plan.json', 'planning-input.json') or sha(directory / name) != digest:
            raise ValueError('Frozen lyric-length planning inputs changed')
    child = record['child_request']
    child_dir = inside(child['directory'], directory)
    if child_dir != directory / 'lyric-length-attempt':
        raise ValueError('Unexpected shorter-attempt directory')
    if (fingerprint(child) != record['child_request_hash'] or
            child['prompt_id'] != request['prompt_id'] + ':lyric-length-v1' or
            not child.get('lyric_length_attempt') or child['config'].get('automatic_outro_retry')):
        raise ValueError('Saved shorter composition changed')
    expected = {**request['plan'], 'duration': record['duration']}
    if child['plan'] != expected or not 60 <= record['duration'] < min(120, request['plan']['duration']):
        raise ValueError('Shorter repair changed more than the authorized duration')
    validate_materials(validate(child['plan'], child['basis'], 60), render_brief(request))
    return child


def child_files(request, child):
    directory, child_dir = Path(request['directory']), Path(child['directory'])
    child_dir.mkdir(exist_ok=True)
    values = {'planning-input.json': load(directory / 'planning-input.json'),
              'plan.json': {**load(directory / 'plan.json'), 'plan': child['plan']},
              'render-request.json': child}
    for name, value in values.items():
        path = child_dir / name
        if path.exists():
            if load(path) != value: raise ValueError('Saved shorter-attempt inputs changed: ' + name)
        else:
            if (child_dir / 'render-result.json').exists() or work_path(child).exists():
                raise ValueError('Restore the missing shorter-attempt inputs before resuming')
            save(path, value)


def prepare(request, duration):
    """Called explicitly by an operator after approval to shorten this request."""
    directory = Path(request['directory']); path = directory / REPORT
    if path.exists():
        record = load(path)
        if record['duration'] != duration: raise ValueError('The single shorter attempt is already reserved')
        child_files(request, verify(request, record))
        return record
    if request.get('verify_existing') or request.get('lyric_length_attempt'):
        raise ValueError('Cannot shorten a delivery test or repeat a shorter attempt')
    if request['plan']['recipe'] not in ('new', 'reinterpretation'):
        raise ValueError('Shorter composition requires an original or reinterpretation')
    if type(duration) is not int or not 60 <= duration < min(120, request['plan']['duration']):
        raise ValueError('Choose 60–119 whole seconds below the original duration')
    brief = render_brief(request)
    if (directory / 'render-result.json').exists() or (directory / 'ending-repair.json').exists():
        raise ValueError('Cannot shorten a completed song or replace an ending repair')
    outro = directory / 'composition-ending-repair.json'
    if outro.exists() and load(outro).get('attempts') != 0:
        raise ValueError('A composition alternative has already been attempted')
    work = work_path(request); state = load(work / 'desktop-status.json')
    if (state.get('status') != 'failed' or state.get('stage') != 'configure'
            or 'Insufficient vocal signal activity' not in state.get('error', '')
            or set(state.get('completed', [])) != {'generate', 'separate', 'words'}):
        raise ValueError('Shorter recovery requires the saved sparse-vocal failure before conversion')
    child = copy.deepcopy(request)
    child.update(prompt_id=request['prompt_id'] + ':lyric-length-v1',
                 directory=str(directory / 'lyric-length-attempt'), lyric_length_attempt=True,
                 parent_progress=str(directory / 'progress.json'))
    child['plan']['duration'] = duration
    child['config']['automatic_outro_retry'] = False
    validate_materials(validate(child['plan'], child['basis'], 60), brief)
    record = {'version': 1, 'at': utc(), 'status': 'prepared', 'attempt_limit': 1, 'attempts': 1,
              'reason': 'Operator authorized a shorter setting of the submitted lyrics after sparse vocal activity.',
              'request_hash': fingerprint(request), 'duration': duration,
              'original_duration': request['plan']['duration'], 'original_work': str(work),
              'original_sha256': {name: sha(work / name) for name in ORIGINAL_FILES},
              'planning_sha256': {name: sha(directory / name) for name in ('plan.json', 'planning-input.json')},
              'child_request': child, 'child_request_hash': fingerprint(child),
              'work_path': str(work_path(child)), 'lyrics_changed': False, 'original_audio_retained': True,
              'additional_planning_calls': 0, 'audio_checks_unchanged': True}
    # Reserve the sole attempt before creating or running its work. Initialization
    # can finish after a crash, but a different duration cannot start another try.
    save(path, record)
    child_files(request, verify(request, record))
    return record


def render_repair(request, render):
    if request.get('lyric_length_attempt'): return None
    path = Path(request['directory']) / REPORT
    if not path.exists(): return None
    record = load(path); child = verify(request, record); child_files(request, child)
    record.update(status='rendering', updated_at=utc()); save(path, record)
    try:
        result = render(child)
    except Exception as error:
        record.update(status='failed', error=str(error)[-2000:], updated_at=utc()); save(path, record)
        raise
    verify(request, record)
    record.update(status=result['status'], result=result, updated_at=utc()); save(path, record)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--duration', type=int, required=True)
    args = parser.parse_args()
    record = prepare(load(args.request), args.duration)
    print(f"Prepared one {record['duration']}-second attempt: {record['work_path']}")
