"""One explicit Local ACE recovery after a pre-audio provider policy rejection.

The parent request and failed production remain frozen. A separately journaled
child uses the same plan and voice under the parent's normal worker lease.
"""
import argparse
import copy
from pathlib import Path

from common import fingerprint, load, save, sha, singleton, utc
from composition_ending import work_path

REPORT = 'provider-local-recovery.json'
PLANNING = ('plan.json', 'planning-input.json', 'render-request.json')
EVIDENCE = ('desktop-job.json', 'desktop-status.json', 'track.json',
            'paid-request.json', 'paid-inputs.json', 'paid-error.json',
            'distonyc-configured.json')


def child_request(request):
    child = copy.deepcopy(request)
    child.update(prompt_id=request['prompt_id'] + ':provider-local-v1',
                 directory=str(Path(request['directory']) / 'provider-local-attempt'),
                 music_backend='local', provider_local_attempt=True,
                 parent_progress=str(Path(request['directory']) / 'progress.json'))
    child.pop('paid_authorization', None)
    child['config']['automatic_outro_retry'] = False
    return child


def check_original(request, allow_result=False):
    work = work_path(request)
    state = load(work / 'desktop-status.json')
    error = load(work / 'paid-error.json')
    detail = error.get('detail', {})
    if (request.get('music_backend') != 'eleven_music'
            or request['plan']['recipe'] != 'new' or request.get('basis')
            or request.get('provider_local_attempt')
            or state.get('status') != 'failed' or state.get('stage') != 'generate'
            or state.get('completed') != []
            or error.get('http_status') != 400
            or error.get('prompt_id') != request['prompt_id']
            or detail.get('status') != 'bad_composition_plan'
            or 'terms of service' not in detail.get('message', '').casefold()):
        raise ValueError('Local recovery requires a policy rejection before audio generation')
    if any((work / name).exists() for name in ('paid-receipt.json', 'paid-original.mp3',
                                              'selected-mix.wav')):
        raise ValueError('Retained provider audio must be reconciled before local recovery')
    if any((Path(request['directory']) / name).exists() for name in
           (('ending-repair.json', 'sparse-vocal-repair.json') if allow_result else
            ('render-result.json', 'ending-repair.json', 'sparse-vocal-repair.json'))):
        raise ValueError('Cannot replace completed work or stack composition repairs')
    manifest = load(work / 'desktop-job.json')
    if (sha(work / 'track.json') != manifest['track_sha256']
            or any(sha(work / name) != digest for name, digest in manifest['workers'].items())):
        raise ValueError('Frozen provider production changed')
    from music_backend import verify as verify_paid
    verify_paid(work, manifest)
    if load(work / 'distonyc-configured.json')['plan_hash'] != fingerprint(request['plan']):
        raise ValueError('Frozen provider plan changed')
    return work


def verify(request, record):
    work = check_original(request, allow_result=True)
    if (record.get('version') != 1 or record.get('attempt_limit') != 1
            or record.get('attempts') != 1
            or record.get('request_hash') != fingerprint(request)
            or record.get('original_work') != str(work)
            or record.get('child_request') != child_request(request)):
        raise ValueError('Local recovery inputs or budget changed')
    for base, key, names in ((work, 'original_sha256', EVIDENCE),
                             (Path(request['directory']), 'planning_sha256', PLANNING)):
        if set(record.get(key, {})) != set(names) or any(
                sha(base / name) != digest for name, digest in record[key].items()):
            raise ValueError('Frozen local recovery provenance changed')
    child = record['child_request']
    result_file = Path(request['directory']) / 'render-result.json'
    if result_file.exists() and (record.get('status') != 'verified'
                                or load(result_file) != record.get('result')):
        raise ValueError('Completed local recovery differs from its verified journal')
    if record.get('work_path') != str(work_path(child)):
        raise ValueError('Local recovery work folder changed')
    return child


def child_files(request, child):
    directory = Path(child['directory'])
    directory.mkdir(exist_ok=True)
    for name in PLANNING:
        value = child if name == 'render-request.json' else load(Path(request['directory']) / name)
        path = directory / name
        if path.exists():
            if load(path) != value: raise ValueError('Local recovery child inputs changed')
        elif work_path(child).exists():
            raise ValueError('Restore missing local recovery child inputs')
        else: save(path, value)


def frozen_prompt(prompt, directory):
    """Retain the original planning brief only for an audited backend switch."""
    revisions = prompt.get('backendRevisions', [])
    if not any(row.get('reason') == 'provider_policy' for row in revisions): return prompt
    if len(revisions) != 1: raise ValueError('Unexpected provider recovery history')
    row = revisions[0]
    request = load(Path(directory) / 'render-request.json')
    record = load(Path(directory) / REPORT)
    verify(request, record)
    if (row.get('requestId') != record.get('operation_id')
            or row.get('backend') != 'local'
            or row.get('previousDetails', {}).get('musicBackend') != 'eleven_music'
            or prompt.get('details') != {**row['previousDetails'], 'musicBackend': 'local'}
            or prompt.get('paidAuthorization') != row.get('previousPaidAuthorization')):
        raise ValueError('Server recovery differs from the frozen local authorization')
    original = copy.deepcopy(prompt)
    original['details'] = row['previousDetails']
    return original


def prepare(request, reason, operation_id=None):
    if not isinstance(reason, str) or len(reason.strip()) < 12:
        raise ValueError('Record explicit operator authorization')
    directory = Path(request['directory'])
    with singleton(directory / 'provider-local-prepare.lock') as acquired:
        if not acquired: raise ValueError('Local recovery preparation already running')
        path = directory / REPORT
        if path.exists():
            record = load(path)
            child_files(request, verify(request, record))
            return record
        work = check_original(request)
        child = child_request(request)
        if work_path(child).exists() or Path(child['directory']).exists():
            raise ValueError('Restore existing local recovery journal; never reset the attempt')
        import uuid
        operation_id = str(uuid.UUID(operation_id)) if operation_id else str(uuid.uuid4())
        record = {'version': 1, 'at': utc(), 'status': 'prepared', 'attempt_limit': 1,
                  'operation_id': operation_id,
                  'attempts': 1, 'reason': reason.strip(), 'request_hash': fingerprint(request),
                  'original_work': str(work), 'child_request': child,
                  'work_path': str(work_path(child)),
                  'original_sha256': {name: sha(work / name) for name in EVIDENCE},
                  'planning_sha256': {name: sha(directory / name) for name in PLANNING},
                  'additional_paid_generation': False, 'plan_changed': False,
                  'audio_checks_unchanged': True}
        save(path, record)
        child_files(request, verify(request, record))
        return record


def render_recovery(request, render):
    if request.get('provider_local_attempt') or not request.get('directory'): return None
    path = Path(request['directory']) / REPORT
    if not path.exists(): return None
    record = load(path)
    child = verify(request, record)
    child_files(request, child)
    if record.get('status') == 'verified': return record['result']
    record.update(status='rendering', updated_at=utc())
    save(path, record)
    try:
        result = render(child)
        verify(request, record)
        if (result.get('status') != 'verified'
                or Path(result['work_path']).resolve() != work_path(child).resolve()):
            raise ValueError('Local recovery did not verify its selected recording')
    except Exception as error:
        record.update(status='failed', error=str(error)[-2000:], updated_at=utc())
        save(path, record)
        raise
    result['music_backend'] = 'local'
    record.update(status='verified', result=result, updated_at=utc())
    save(path, record)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--reason', required=True)
    parser.add_argument('--authorize-backend', action='store_true',
                        help='Apply the version-checked admin backend revision for this prepared child')
    args = parser.parse_args()
    request = load(args.request)
    record = prepare(request, args.reason)
    if args.authorize_backend:
        import os
        import urllib.parse
        from queue_monitor import AdminAPI
        from operator_retry import find
        password = os.environ.pop('DISTONYC_MONITOR_PASSWORD', '')
        if not password: raise ValueError('Load the monitor DPAPI credential first')
        api = AdminAPI(request['config']['api'], password)
        del password
        prompt = find(api, request['prompt_id'])
        prompt = api.call('/admin/prompts/' + urllib.parse.quote(prompt['id'], safe=''), 'PATCH',
                         {'action': 'provider-backend', 'backend': 'local',
                          'requestId': record['operation_id'], 'version': prompt['version']})['prompt']
        frozen_prompt(prompt, request['directory'])
        print('Authorized backend recovery for ' + prompt['id'])
    print(record['work_path'])
