"""Switch one refused, unstarted paid plan to Local ACE with supplied words.

Run only at an operator's explicit request to switch backend and retain wording.
This reuses the saved musical arrangement, not an additional model consultation.
It never resets recovery budgets or runs after an accepted plan or audio exists.
Use --runtime-root to load the verified installed worker's policy modules.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import sys
import urllib.parse
import uuid


def require_unstarted(prompt, directory):
    from replan import STARTED
    if (prompt.get('status') != 'failed' or prompt.get('workerActive') or
        (prompt.get('workerProgress') or {}).get('stage') != 'Planning the song' or
        any(prompt.get(key) is not None for key in ('songPlan', 'result', 'generationReview')) or
        any((Path(directory) / name).exists() for name in STARTED)):
        raise ValueError('Only failed planning before accepted plans, review or audio can switch')


def exact_plan(saved, old_brief, prompt):
    from common import fingerprint
    from planner import normalize, validate, generation_constraints, backend_constraints
    from request_materials import validate_materials, minimum_duration
    if saved['briefHash'] != fingerprint(old_brief):
        raise ValueError('Refused plan does not match its retained original brief')
    expected = copy.deepcopy(old_brief['details']); expected['musicBackend'] = 'local'
    if prompt['details'] != expected or prompt['prompt'] != old_brief['prompt']:
        raise ValueError('Backend switch must preserve every other submitted detail')
    sheet = expected.get('lyricSheet') or {}
    if sheet.get('mode') != 'preserve' or not sheet.get('text'):
        raise ValueError('An exact preserved lyric sheet is required')
    if (saved['plan']['recipe'] != 'needs_attention' or expected.get('basisSongIds') or
        expected.get('source') or expected.get('remixSource')):
        raise ValueError('Only a refused original composition with no source audio is supported')
    plan = copy.deepcopy(saved['plan'])
    plan.update(recipe='new', lyrics=sheet['text'], vocal_mode='lyrics',
        explanation='Local ACE composition using the supplied preserved lyric sheet and retained country arrangement.')
    brief = {'prompt': prompt['prompt'], 'details': prompt['details']}
    plan = validate(normalize(plan), [], minimum_duration(brief))
    plan = backend_constraints(generation_constraints(validate_materials(plan, brief), brief), brief)
    return brief, plan


def switch(config, api, request):
    from common import load, save, utc, fingerprint, inside
    from operator_retry import find
    import replan
    import lyric_constraints
    prompt = find(api, request)
    directory = inside(Path(config['state_dir']) / 'jobs' / prompt['id'], config['state_dir'])
    require_unstarted(prompt, directory)
    journal_path = directory / 'local-ace-switch.json'
    if journal_path.exists():
        journal = load(journal_path)
        if journal['requestId'] != prompt['id']: raise ValueError('Switch journal belongs to another request')
    else:
        if prompt['details'].get('musicBackend') != 'eleven_music': raise ValueError('Not a paid request')
        journal = {'version': 1, 'requestId': prompt['id'], 'operationId': str(uuid.uuid4()), 'at': utc(),
            'savedPlan': load(directory / 'plan.json'), 'planningInput': load(directory / 'planning-input.json')}
        # Validate before changing the live backend or archiving anything.
        preview = {**prompt, 'details': {**prompt['details'], 'musicBackend': 'local'}}
        exact_plan(journal['savedPlan'], journal['planningInput']['brief'], preview)
        blocked = replan.refusal(directory, False, journal['operationId'])
        if blocked: raise ValueError(blocked)
        save(journal_path, journal)
    path = '/admin/prompts/' + urllib.parse.quote(prompt['id'], safe='')
    if prompt['details'].get('musicBackend') != 'local':
        prompt = api.call(path, 'PATCH', {'action': 'planning-backend', 'backend': 'local',
            'version': prompt['version'], 'requestId': journal['operationId']})['prompt']
    revision = next((row for row in prompt.get('backendRevisions', [])
        if row['requestId'] == journal['operationId']), None)
    if not revision: raise ValueError('No authenticated server revision matches this switch')
    require_unstarted(prompt, directory)
    brief, plan = exact_plan(journal['savedPlan'], journal['planningInput']['brief'], prompt)
    if journal.get('prepared'):
        saved = load(directory / 'plan.json')
        if saved['briefHash'] != fingerprint(brief) or saved['plan'] != plan:
            raise ValueError('Prepared local plan changed; reconcile before retry')
        return prompt
    row = replan.prepare(directory, journal['operationId'], False)
    replan.directive(directory)  # Finish an interrupted archive before writing.
    contract = lyric_constraints.prepare(directory, brief, journal['planningInput'].get('adminNote', ''))
    plan = lyric_constraints.validate(plan, contract, directory)
    planning_input = {**journal['planningInput'], 'briefHash': fingerprint(brief), 'brief': brief,
        'backendSwitch': journal['operationId']}
    save(directory / 'planning-input.json', planning_input)
    save(directory / 'plan.json', {'briefHash': fingerprint(brief), 'plan': plan,
        'model': 'operator-exact-sheet-local-ace-v1'})
    journal.update(prepared=True, archive=row['number'], localBriefHash=fingerprint(brief))
    save(journal_path, journal)
    return prompt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--request', required=True)
    parser.add_argument('--runtime-root', type=Path)
    args = parser.parse_args()
    if args.runtime_root: sys.path.insert(0, str(args.runtime_root.resolve()))
    from common import load
    from queue_monitor import AdminAPI
    password = os.environ.pop('DISTONYC_MONITOR_PASSWORD', '')
    if not password: raise ValueError('Load the DPAPI monitor credential into the environment')
    config = load(args.config)
    prompt = switch(config, AdminAPI(config['api'], password), args.request)
    del password
    print(json.dumps({'id': prompt['id'], 'version': prompt['version'], 'status': prompt['status'],
        'musicBackend': prompt['details']['musicBackend'], 'prepared': True}))


if __name__ == '__main__': main()
