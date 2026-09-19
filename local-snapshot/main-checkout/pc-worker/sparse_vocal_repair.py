"""One operator-authorized full-length composition after sparse source vocals.

Retain frozen inputs and the failed original; resume one separate child with the
same plan and voice. No planner calls, waveform edits, or relaxed audio checks.
"""
import argparse
import copy
import math
from pathlib import Path

from common import fingerprint, inside, load, save, sha, singleton, utc
from composition_ending import journal_for, work_path
from planner import validate
from request_materials import render_brief, validate_materials

REPORT = 'sparse-vocal-repair.json'
ORIGINAL_FILES = ('desktop-job.json', 'desktop-status.json', 'track.json',
                  'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav',
                  'arrangement-checks.json', 'distonyc-configured.json')
RETAINED_ORIGINAL_FILES = tuple(name for name in ORIGINAL_FILES if name != 'desktop-status.json')
CHILD_FAILURE_FILES = ('desktop-job.json', 'desktop-status.json', 'paid-request.json',
                       'paid-inputs.json', 'paid-error.json')
PLANNING_FILES = ('plan.json', 'planning-input.json', 'render-request.json')
GUIDANCE = ('Vocal arrangement recovery: make this a sung song with the lead singer present throughout. '
            'Begin the first supplied verse within eight seconds. Sing every supplied line in its original order '
            'as connected melodic phrases and sustained notes, distributing the verses and choruses across the '
            'whole duration. Keep only short breathing spaces between phrases and sections; avoid extended '
            'instrumental solos or empty verses. Keep the original tempo, genre, instrumentation and expressive '
            'vocal direction. Do not add, omit or repeat lyric words. ')


def child_request(request):
    child = copy.deepcopy(request)
    directory = Path(request['directory'])
    child.update(prompt_id=request['prompt_id'] + ':sparse-vocal-v1',
                 directory=str(directory / 'sparse-vocal-attempt'), sparse_vocal_attempt=True,
                 sparse_vocal_guidance=GUIDANCE, parent_progress=str(directory / 'progress.json'))
    child['config']['automatic_outro_retry'] = False
    return child


def planning_files(request):
    """Keep the frozen remix-source snapshot with a source-guided retry."""
    return PLANNING_FILES + (("source-material.json",) if request["plan"]["recipe"] == "reinterpretation" else ())


def retained_request(request):
    selected = copy.deepcopy(request)
    selected['retained_sparse_original'] = True
    return selected


def provider_policy_rejection(record):
    error = str(record.get('error', '')).casefold()
    return (record.get('status') == 'failed' and 'eleven music http 400' in error
            and 'terms of service' in error and 'no automatic repeat charge' in error)


def verify_retained(request, record):
    directory = Path(request['directory'])
    retained = record.get('retained_original', {})
    selected = retained_request(request)
    if (retained.get('version') != 1 or retained.get('request_hash') != fingerprint(selected)
            or retained.get('provider_disposition') != 'terms_of_service_rejection'):
        raise ValueError('Saved retained-original selection changed')
    original = inside(record['original_work'], Path(request['config']['settings']['studio_dir']).parent)
    if original != work_path(request).resolve() or retained.get('work_path') != str(original):
        raise ValueError('Unexpected retained-original work folder')
    if set(retained.get('inputs_sha256', {})) != set(RETAINED_ORIGINAL_FILES):
        raise ValueError('Missing retained-original provenance')
    if any(sha(original / name) != digest for name, digest in retained['inputs_sha256'].items()):
        raise ValueError('Retained-original inputs changed')
    policy = original / 'sparse-vocal-intent-policy.json'
    from sparse_intent_policy import verify as verify_sparse_intent
    intent = verify_sparse_intent(original)
    if (intent.get('kind') != 'paid_spoken_jazz_reinterpretation'
            or retained.get('policy_sha256') != sha(policy)):
        raise ValueError('Retained-original sparse-intent policy changed')
    child = record.get('child_request')
    if child != child_request(request) or fingerprint(child) != record.get('child_request_hash'):
        raise ValueError('Saved sparse-vocal child inputs changed')
    child_work = work_path(child)
    if set(retained.get('child_failure_sha256', {})) != set(CHILD_FAILURE_FILES):
        raise ValueError('Missing sparse-vocal provider failure provenance')
    if any(sha(child_work / name) != digest for name, digest in retained['child_failure_sha256'].items()):
        raise ValueError('Sparse-vocal provider failure evidence changed')
    if any(sha(directory / name) != digest for name, digest in record['planning_sha256'].items()):
        raise ValueError('Frozen sparse-vocal planning inputs changed')
    return selected


def verify(request, record):
    directory = Path(request['directory'])
    if (record.get('version') != 1 or record.get('attempt_limit') != 1 or record.get('attempts') != 1
            or record.get('request_hash') != fingerprint(request)):
        raise ValueError('Saved sparse-vocal repair inputs or budget changed')
    if record.get('retained_original'):
        return verify_retained(request, record)
    original = inside(record['original_work'], Path(request['config']['settings']['studio_dir']).parent)
    if original != work_path(request).resolve():
        raise ValueError('Unexpected original sparse-vocal repair folder')
    for base, key, names in ((original, 'original_sha256', ORIGINAL_FILES),
                             (directory, 'planning_sha256', planning_files(request))):
        if set(record.get(key, {})) != set(names):
            raise ValueError('Missing sparse-vocal repair provenance')
        if any(sha(base / name) != digest for name, digest in record[key].items()):
            raise ValueError('Frozen sparse-vocal repair inputs changed')
    child = record['child_request']
    if child != child_request(request) or fingerprint(child) != record['child_request_hash']:
        raise ValueError('Saved sparse-vocal child inputs changed')
    if record.get('work_path') != str(work_path(child)):
        raise ValueError('Saved sparse-vocal child work path changed')
    validate_materials(validate(child['plan'], child['basis']), render_brief(request))
    return child


def prepare_retained_original(request, record):
    if record.get('retained_original'):
        return verify_retained(request, record)
    if not provider_policy_rejection(record):
        raise ValueError('Retained-original fallback requires the exhausted provider-policy rejection')
    child = verify(request, record)
    original = work_path(request).resolve()
    policy = original / 'sparse-vocal-intent-policy.json'
    if not policy.is_file():
        raise ValueError('Retained-original fallback requires the reviewed sparse-intent policy')
    from sparse_intent_policy import verify as verify_sparse_intent
    intent = verify_sparse_intent(original)
    if intent.get('kind') != 'paid_spoken_jazz_reinterpretation':
        raise ValueError('Retained-original fallback is limited to the reviewed paid spoken-jazz remix')
    child_work = work_path(child)
    if any(not (child_work / name).is_file() for name in CHILD_FAILURE_FILES):
        raise ValueError('Sparse-vocal provider failure evidence is incomplete')
    selected = retained_request(request)
    record['retained_original'] = {
        'version': 1, 'at': utc(), 'status': 'prepared',
        'reason': 'The one replacement composition was rejected by provider policy; resume the hash-pinned paid original with its truthful spacing notice.',
        'provider_disposition': 'terms_of_service_rejection', 'provider_error': record['error'][-2000:],
        'request_hash': fingerprint(selected), 'work_path': str(original),
        'policy_sha256': sha(policy),
        'inputs_sha256': {name: sha(original / name) for name in RETAINED_ORIGINAL_FILES},
        'child_failure_sha256': {name: sha(child_work / name) for name in CHILD_FAILURE_FILES},
        'audio_changed': False, 'additional_paid_generation': False,
        'repair_attempts_consumed': record['attempts'], 'other_integrity_checks_retained': True}
    record.update(status='retained_original_prepared', selected_work=str(original), updated_at=utc())
    save(Path(request['directory']) / REPORT, record)
    return verify_retained(request, record)


def child_files(request, child):
    directory, child_dir = Path(request['directory']), Path(child['directory'])
    child_dir.mkdir(exist_ok=True)
    values = {'plan.json': load(directory / 'plan.json'),
              'planning-input.json': load(directory / 'planning-input.json'),
              'render-request.json': child}
    for name, value in values.items():
        path = child_dir / name
        if path.exists():
            if load(path) != value: raise ValueError('Saved sparse-vocal child file changed: ' + name)
        else:
            if work_path(child).exists() or (child_dir / 'render-result.json').exists():
                raise ValueError('Restore the missing sparse-vocal child inputs before resuming')
            save(path, value)
    if request['plan']['recipe'] == 'reinterpretation':
        source = directory / 'source-material.json'
        target = child_dir / 'source-material.json'
        if not source.is_file():
            raise ValueError('Frozen source-material snapshot is missing')
        if target.exists():
            if sha(target) != sha(source):
                raise ValueError('Saved sparse-vocal source material changed')
        else:
            target.write_bytes(source.read_bytes())


def prepare(request):
    """Explicit operator entry point; it reserves one attempt but never requeues."""
    directory = Path(request['directory'])
    with singleton(directory / 'sparse-vocal-prepare.lock') as acquired:
        if not acquired: raise ValueError('Sparse-vocal repair preparation is already running')
        return _prepare(request)


def _prepare(request):
    directory = Path(request['directory']); path = directory / REPORT
    if path.exists():
        record = load(path); child_files(request, verify(request, record)); return record
    if (request.get('verify_existing') or request.get('sparse_vocal_attempt')
            or request.get('lyric_length_attempt')):
        raise ValueError('Cannot repeat or nest sparse-vocal composition recovery')
    plan = request['plan']
    if (plan['recipe'] not in ('new', 'reinterpretation') or plan['style'] not in ('rock', 'acoustic')
            or not 120 <= plan['duration'] <= 600):
        raise ValueError('Sparse-vocal recovery requires a 120-600 second rock/acoustic original or source-guided reinterpretation')
    brief = render_brief(request)
    validate_materials(validate(plan, request['basis']), brief)
    if any((directory / name).exists() for name in ('render-result.json', 'ending-repair.json', 'lyric-length-repair.json')):
        raise ValueError('Cannot replace completed work or stack composition repairs')
    outro = journal_for(request)
    if outro and (outro['attempts'] != 0 or outro['status'] != 'original'):
        raise ValueError('A composition alternative has already been attempted')
    work = work_path(request); state = load(work / 'desktop-status.json')
    completed = set(state.get('completed', []))
    error = state.get('error', '')
    coverage_failure = 'Insufficient vocal signal activity' in error
    no_regions_failure = 'assert regions' in error
    if (state.get('status') != 'failed' or state.get('stage') != 'configure'
            or not (coverage_failure or no_regions_failure)
            or completed not in ({'generate', 'separate', 'words'}, {'generate', 'separate', 'backing', 'words'})):
        raise ValueError('Sparse-vocal recovery requires the saved coverage failure before voice conversion')
    coverage = load(work / 'arrangement-checks.json').get('voiced_energy_fraction')
    if not isinstance(coverage, (float, int)) or not math.isfinite(coverage) or not 0 <= coverage < .5:
        raise ValueError('Missing measured sparse-vocal evidence')
    manifest = load(work / 'desktop-job.json')
    if (sha(work / 'track.json') != manifest['track_sha256']
            or any(sha(work / name) != digest for name, digest in manifest['workers'].items())
            or load(work / 'distonyc-configured.json')['plan_hash'] != fingerprint(plan)):
        raise ValueError('Frozen original recipe or plan changed')
    child = child_request(request)
    if work_path(child).exists() or Path(child['directory']).exists():
        raise ValueError('Restore the existing sparse-vocal repair journal; do not reset its attempt')
    record = {'version': 1, 'at': utc(), 'status': 'prepared', 'attempt_limit': 1, 'attempts': 1,
              'reason': 'Operator authorized one full-length composition after insufficient source-vocal activity.',
              'request_hash': fingerprint(request), 'original_work': str(work),
              'original_sha256': {name: sha(work / name) for name in ORIGINAL_FILES},
              'planning_sha256': {name: sha(directory / name) for name in planning_files(request)},
              'child_request': child, 'child_request_hash': fingerprint(child), 'work_path': str(work_path(child)),
              'original_coverage': coverage, 'original_audio_retained': True, 'plan_changed': False,
              'additional_planning_calls': 0, 'audio_checks_unchanged': True}
    save(path, record)
    child_files(request, verify(request, record))
    return record


def render_repair(request, render):
    if request.get('sparse_vocal_attempt') or request.get('retained_sparse_original'): return None
    path = Path(request['directory']) / REPORT
    if not path.exists(): return None
    record = load(path)
    if record.get('retained_original'):
        selected = verify(request, record)
    elif provider_policy_rejection(record):
        selected = prepare_retained_original(request, record)
        record = load(path)
    else:
        selected = verify(request, record); child_files(request, selected)
    retained = bool(selected.get('retained_sparse_original'))
    if retained:
        record['retained_original'].update(status='rendering', updated_at=utc())
        record.update(status='retained_original_rendering',
                      selected_work=str(work_path(request)), updated_at=utc())
        save(path, record)
    else:
        record.update(status='rendering', updated_at=utc()); save(path, record)
    try:
        result = render(selected)
    except Exception as error:
        if retained:
            record['retained_original'].update(status='failed', error=str(error)[-2000:], updated_at=utc())
            record.update(status='retained_original_failed',
                          selected_work=str(work_path(request)), updated_at=utc())
        else:
            record.update(status='failed', error=str(error)[-2000:], updated_at=utc())
        save(path, record)
        raise
    verify(request, record)
    if result.get('status') != 'verified' or Path(result['work_path']).resolve() != work_path(selected).resolve():
        raise ValueError('Sparse-vocal recovery did not verify its selected composition')
    if retained:
        record['retained_original'].update(status='verified', result=result, updated_at=utc())
    record.update(status='verified', selected_work=str(work_path(selected)),
                  result=result, updated_at=utc()); save(path, record)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    record = prepare(load(args.request))
    print('Prepared one full-length sparse-vocal attempt: ' + record['work_path'])
