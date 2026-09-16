"""Operator-authorized sectional recovery; preserve prior attempts and one song.

Three contiguous lyric groups use the frozen voice, music plan and total target
duration. Each group gets at most three distinct composition attempts. Finished
sections and all rejected sources remain private and resumable.
"""
import argparse
import copy
import itertools
import shutil
import subprocess
import uuid
from pathlib import Path

from common import fingerprint, inside, load, save, sha, singleton, utc
from composition_ending import work_path
from request_materials import render_brief, validate_materials, words
from planner import validate
from sparse_vocal_repair import verify as verify_sparse

REPORT = 'sectional-repair.json'
ATTEMPTS = 3
MUSICAL_FAILURES = ('Insufficient vocal signal activity', 'Too much instrumental space',
                    'Ending needs completion before fade')


def sections(plan):
    blocks = []
    for line in plan['lyrics'].splitlines():
        if line.strip().startswith('[') and line.strip().endswith(']'):
            blocks.append([line])
        elif blocks:
            blocks[-1].append(line)
        elif line.strip():
            raise ValueError('Sectional recovery requires labeled lyric sections')
    blocks = ['\n'.join(b).strip() for b in blocks if words('\n'.join(b))]
    if not 3 <= len(blocks) <= 20:
        raise ValueError('Sectional recovery requires 3-20 labeled lyric sections')
    candidates = []
    for a, b in itertools.combinations(range(1, len(blocks)), 2):
        groups = ['\n\n'.join(g) + '\n[End]' for g in (blocks[:a], blocks[a:b], blocks[b:])]
        counts = [len(words(g)) for g in groups]
        candidates.append((sum(n*n for n in counts), a, b, groups, counts))
    _, _, _, groups, counts = min(candidates)
    available = plan['duration'] - 30
    durations = [round(10 + available * n / sum(counts)) for n in counts[:2]]
    durations.append(plan['duration'] - sum(durations))
    if any(not 60 <= d <= 300 for d in durations):
        raise ValueError('Each recovered section must fit 60-300 seconds')
    if sum((words(g) for g in groups), []) != words(plan['lyrics']):
        raise ValueError('Section grouping changed the frozen lyric words')
    return [{'lyrics': g, 'duration': d, 'word_count': n} for g, d, n in zip(groups, durations, counts)]


def suite_work(request):
    ident = uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + ':sectional-v1')
    return Path(request['config']['settings']['studio_dir']).parent / ('troofs-suite-' + str(ident))


def child_request(request, part, index, attempt):
    child = copy.deepcopy(request)
    child['prompt_id'] += f':sectional-v1:{index+1}:{attempt}'
    child['directory'] = str(Path(request['directory']) / 'sectional-parts' / str(index+1) / f'attempt-{attempt}')
    child['config']['automatic_outro_retry'] = False
    child['config']['settings']['output_dir'] = str(suite_work(request) / 'private-movements')
    child['plan'].update(lyrics=part['lyrics'], duration=part['duration'], movements=[],
                         title=request['plan']['title'][:60] + f' - Part {index+1}')
    child['sectional_part'] = True
    child['suite_progress'] = {'path': str(Path(request['directory']) / 'progress.json'), 'index': index, 'count': 3}
    return child


def child_values(request, child):
    brief = copy.deepcopy(render_brief(request))
    brief['details']['lyricSheet'] = {'mode': 'preserve', 'text': child['plan']['lyrics']}
    validate_materials(validate(child['plan'], child['basis'], 60), brief)
    return {'planning-input.json': {'brief': brief, 'briefHash': fingerprint(brief)},
            'plan.json': {'plan': child['plan'], 'briefHash': fingerprint(brief), 'model': 'sectional-recovery-no-planner-call'},
            'render-request.json': child}


def child_files(request, child):
    directory = Path(child['directory']); directory.mkdir(parents=True, exist_ok=True)
    for name, value in child_values(request, child).items():
        path = directory / name
        if path.exists():
            if load(path) != value: raise ValueError('Frozen sectional child inputs changed: ' + name)
        elif work_path(child).exists():
            raise ValueError('Restore missing sectional child inputs before resuming')
        else: save(path, value)


def verify(request, journal):
    job = Path(request['directory'])
    if (journal.get('version') != 1 or journal.get('request_hash') != fingerprint(request)
            or journal.get('attempts_per_section') != ATTEMPTS or journal.get('sections') != sections(request['plan'])
            or journal.get('work_path') != str(suite_work(request))):
        raise ValueError('Sectional repair inputs or attempt limits changed')
    names = ('plan.json', 'planning-input.json', 'render-request.json', 'sparse-vocal-repair.json')
    if set(journal.get('parent_sha256', {})) != set(names):
        raise ValueError('Incomplete sectional parent provenance')
    if any(sha(job/name) != digest for name, digest in journal['parent_sha256'].items()):
        raise ValueError('Earlier frozen request or repair journal changed')
    previous = load(job/'sparse-vocal-repair.json')
    verify_sparse(request, previous)
    previous_work = Path(previous['work_path'])
    if any(sha(previous_work/name) != digest for name, digest in journal['previous_sha256'].items()):
        raise ValueError('Previous composition changed')
    work = suite_work(request)
    if sha(work/'finish_suite.py') != journal['finisher_sha256'] or sha(work/'spec.json') != journal['spec_sha256']:
        raise ValueError('Sectional assembly code or plan changed')
    attempts = journal.get('attempts')
    if not isinstance(attempts, list) or len(attempts) != 3:
        raise ValueError('Missing sectional attempt budget')
    for index, rows in enumerate(attempts):
        if len(rows) > ATTEMPTS: raise ValueError('Sectional attempt budget exceeded')
        for number, row in enumerate(rows, 1):
            child = child_request(request, journal['sections'][index], index, number)
            if (row.get('number') != number or row.get('child_hash') != fingerprint(child)
                    or row.get('status') not in ('reserved', 'composition_failed', 'verified')):
                raise ValueError('Sectional attempt reservation changed')
            if row['status'] == 'composition_failed':
                state_path = work_path(child)/'desktop-status.json'
                if sha(state_path) != row['failure_state_sha256']:
                    raise ValueError('Retained failed section changed')
    return work


def prepare(request):
    job = Path(request['directory'])
    with singleton(job/'sectional-prepare.lock') as acquired:
        if not acquired: raise ValueError('Sectional preparation is already running')
        path = job/REPORT
        if path.exists():
            journal = load(path); verify(request, journal); return journal
        if request.get('sectional_part') or request.get('verify_existing') or request['plan']['recipe'] != 'new':
            raise ValueError('Sectional recovery requires the original existing request')
        if (job/'render-result.json').exists(): raise ValueError('Cannot replace a completed song')
        prior = load(job/'sparse-vocal-repair.json'); verify_sparse(request, prior)
        prior_work = Path(prior['work_path']); state = load(prior_work/'desktop-status.json')
        if prior['status'] != 'failed' or state['stage'] != 'configure' or 'Insufficient vocal signal activity' not in state.get('error', ''):
            raise ValueError('Sectional recovery requires the retained failed sparse-vocal attempt')
        parts = sections(request['plan'])
        for index, part in enumerate(parts): child_values(request, child_request(request, part, index, 1))
        work = suite_work(request)
        if work.exists() or (job/'sectional-parts').exists():
            raise ValueError('Restore the existing sectional journal instead of resetting attempts')
        work.mkdir()
        shutil.copy2(Path(__file__).with_name('longform.py'), work/'finish_suite.py')
        save(work/'spec.json', {'kind': 'new', **request['plan'], 'movements': parts})
        names = ('plan.json', 'planning-input.json', 'render-request.json', 'sparse-vocal-repair.json')
        retained = ('desktop-job.json', 'desktop-status.json', 'track.json', 'generated.wav',
                    'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav', 'arrangement-checks.json')
        journal = {'version': 1, 'at': utc(), 'status': 'prepared', 'request_hash': fingerprint(request),
                   'sections': parts, 'attempts_per_section': ATTEMPTS, 'attempts': [[], [], []],
                   'work_path': str(work), 'parent_sha256': {n: sha(job/n) for n in names},
                   'previous_sha256': {n: sha(prior_work/n) for n in retained},
                   'finisher_sha256': sha(work/'finish_suite.py'), 'spec_sha256': sha(work/'spec.json'),
                   'original_plan_unchanged': True, 'prior_attempts_preserved': True, 'additional_planner_calls': 0}
        save(path, journal); verify(request, journal); return journal


def selected_work(request, journal):
    work = verify(request, journal)
    if journal.get('status') in ('mastering', 'verified'): return work
    for index, rows in enumerate(journal['attempts']):
        if rows and rows[-1]['status'] != 'verified':
            return work_path(child_request(request, journal['sections'][index], index, rows[-1]['number']))
    return work


def render_repair(request, render, verify_attempt):
    if request.get('sectional_part'): return None
    path = Path(request['directory'])/REPORT
    if not path.exists(): return None
    journal = load(path); work = verify(request, journal); parts = []
    journal['status'] = 'rendering'; save(path, journal)
    for index, part in enumerate(journal['sections']):
        rows = journal['attempts'][index]
        while not rows or rows[-1]['status'] != 'verified':
            if not rows or rows[-1]['status'] == 'composition_failed':
                if len(rows) >= ATTEMPTS:
                    journal.update(status='failed', error=f'Section {index+1} exhausted its three composition attempts')
                    save(path, journal); raise RuntimeError(journal['error'])
                number = len(rows)+1; child = child_request(request, part, index, number)
                rows.append({'number': number, 'status': 'reserved', 'child_hash': fingerprint(child), 'at': utc()})
                save(path, journal)
            child = child_request(request, part, index, rows[-1]['number']); child_files(request, child)
            try:
                result = render(child)
            except RuntimeError as error:
                state_path = work_path(child)/'desktop-status.json'
                state = load(state_path) if state_path.exists() else {}
                if (state.get('status') == 'failed' and state.get('stage') == 'configure'
                        and any(msg in state.get('error', '') for msg in MUSICAL_FAILURES)):
                    rows[-1].update(status='composition_failed', error=str(error)[-2200:],
                                    failure_state_sha256=sha(state_path))
                    save(path, journal); continue
                raise
            if (result.get('status') != 'verified' or result.get('voice_model', 'v6') != request.get('voice_model', 'v6')
                    or Path(result['work_path']).resolve() != work_path(child).resolve()):
                raise ValueError('Section result does not match its verified voice and work folder')
            rows[-1].update(status='verified', result=result, mix_report_sha256=sha(work_path(child)/'mix-results.json'))
            save(Path(child['directory'])/'render-result.json', result); save(path, journal)
        row = rows[-1]; child = child_request(request, part, index, row['number']); child_files(request, child)
        verify_attempt({**child, 'verify_existing': row['result']['work_path']})
        if sha(work_path(child)/'mix-results.json') != row['mix_report_sha256']:
            raise ValueError('Completed section report changed')
        parts.append({'number': index+1, 'result': row['result'], 'mix_report_sha256': row['mix_report_sha256']})
    verify(request, journal)
    suite = {'version': 1, 'title': request['plan']['title'] + ' - D' + work.name.removeprefix('troofs-suite-')[:8],
             'requested_duration': request['plan']['duration'], 'settings': request['config']['settings'],
             'parts': parts, 'finisher_sha256': journal['finisher_sha256'], 'spec_sha256': journal['spec_sha256']}
    save(work/'suite-job.json', suite); journal['status'] = 'mastering'; save(path, journal)
    save(Path(request['directory'])/'progress.json', {'stage': 'Mastering the complete song', 'percent': 95})
    if not (work/'mix-results.json').exists():
        settings = request['config']['settings']
        with (Path(request['directory'])/'sectional-master.log').open('a', encoding='utf-8') as log:
            subprocess.run([settings['voice_python'], str(work/'finish_suite.py'), '--work', str(work),
                            '--worker-resources', str(Path(__file__).parent)], cwd=work, stdout=log,
                           stderr=subprocess.STDOUT, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    result = verify_attempt({**request, 'verify_existing': str(work)})
    journal.update(status='verified', result=result, finished_at=utc()); save(path, journal)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--request', required=True, type=Path)
    record = prepare(load(parser.parse_args().request))
    print('Prepared sectional recovery: ' + record['work_path'])
    print('Section durations: ' + ', '.join(str(p['duration']) for p in record['sections']))
