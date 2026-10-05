"""Operator-authorized completion of one published, unconverted retained recording.

Run through retained-instrumental.ps1. Frozen inputs and prior exports stay intact.
One journal pins the authorization, original recording and bounded resume attempts.
No composition stage, paid generator, queue retry or lease reset is allowed.
"""
import argparse
import os
import shutil
import uuid
from pathlib import Path
from common import API, fingerprint, inside, load, save, sha, singleton, utc

REPORT = 'instrumental-heavy-retained.json'
BASE = ('desktop-job.json', 'track.json', 'distonyc-configured.json',
        'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav',
        'selected-vocals-words.json')


def verify_authorization(work):
    work = Path(work)
    record = load(work / REPORT)
    inputs = record.get('inputs_sha256', {})
    if (record.get('version') != 1 or set(inputs) != set(BASE) or
            record.get('additional_generation') is not False or
            not isinstance(record.get('reason'), str) or len(record['reason']) < 12):
        raise ValueError('Invalid retained instrumental-heavy authorization')
    if any(sha(work / name) != digest for name, digest in inputs.items()):
        raise ValueError('Retained instrumental-heavy inputs changed')
    directory = Path(record['directory'])
    if directory.name != record['request_id']:
        raise ValueError('Retained authorization request mismatch')
    if any(sha(directory / name) != digest for name, digest in record['job_sha256'].items()):
        raise ValueError('Frozen retained request changed')
    configured = load(work / 'distonyc-configured.json')
    request = load(directory / 'render-request.json')
    if (configured['prompt_id'] != record['request_id'] or
            request['prompt_id'] != record['request_id'] or
            configured['plan_hash'] != fingerprint(request['plan'])):
        raise ValueError('Retained production plan mismatch')
    journal = load(directory / 'retained-instrumental.json')
    if journal['authorization_sha256'] != sha(work / REPORT):
        raise ValueError('Retained authorization changed')
    return record


def eligible(prompt):
    if (prompt['status'] != 'published' or prompt.get('recordingCompletion') or
            prompt.get('reviewDecision') or
            'unconverted_vocals' not in prompt['result'].get('validationFailures', [])):
        raise ValueError('Only an unreviewed published unconverted preview can be completed')


def archive_preview_marker(work, directory):
    marker = work / 'review-delivery.json'
    if not marker.exists(): return
    preview = load(marker)
    prior = load(directory / 'retained-prior-result.json')
    if (preview.get('manifest_sha256') != sha(work / 'desktop-job.json') or
            preview.get('result', {}).get('files') != prior['files'] or
            any(sha(work / name) != digest for name, digest in preview['inputs_sha256'].items())):
        raise ValueError('Prior preview provenance changed')
    for item in prior['files']:
        if sha(item['path']) != item['sha256']: raise ValueError('Prior preview export changed')
    destination = work / 'retained-prior-review-delivery.json'
    if destination.exists(): raise ValueError('Prior review marker is already archived')
    marker.rename(destination)


def run(config, api, wanted, action, reason=''):
    directory = inside(Path(config['state_dir']) / 'jobs' / wanted, Path(config['state_dir']) / 'jobs')
    with singleton(directory / 'retained-instrumental.lock') as acquired:
        if not acquired: raise ValueError('Retained recording completion is already running')
        prompt = api.call('/prompts/' + wanted)['prompt']
        journal_path = directory / 'retained-instrumental.json'
        request = load(directory / 'render-request.json')
        original = load(directory / 'render-result.json')
        work = inside(original['work_path'], Path(config['settings']['studio_dir']).parent)
        if action == 'authorize':
            if journal_path.exists():
                verify_authorization(work)
                return load(journal_path)
            eligible(prompt)
            if len(reason.strip()) < 12: raise ValueError('Record the user authorization reason')
            if request.get('music_backend', 'local') != 'local' or request.get('voice_model', 'v6') != 'v6':
                raise ValueError('This retained controller only supports local Tony V6 recordings')
            state = load(work / 'desktop-status.json')
            if (state['status'] != 'failed' or state['stage'] != 'configure' or
                    set(state['completed']) != {'generate', 'separate', 'words'} or
                    'Insufficient vocal signal activity' not in state.get('error', '')):
                raise ValueError('This is not a retained vocal-coverage configure failure')
            record = {'version': 1, 'at': utc(), 'request_id': wanted, 'directory': str(directory),
                      'reason': reason.strip(), 'additional_generation': False,
                      'inputs_sha256': {name: sha(work / name) for name in BASE},
                      'job_sha256': {name: sha(directory / name) for name in ('render-request.json', 'plan.json')},
                      'prior_sha256': prompt['result']['sha256']}
            save(work / REPORT, record)
            journal = {'version': 1, 'request_id': str(uuid.uuid4()), 'prompt': prompt,
                       'authorization_sha256': sha(work / REPORT), 'attempts': [], 'status': 'authorized'}
            save(journal_path, journal)
            verify_authorization(work)
            shutil.copy2(directory / 'render-result.json', directory / 'retained-prior-result.json')
            return journal
        verify_authorization(work)
        journal = load(journal_path)
        if action in ('render', 'finalize'):
            eligible(prompt)
            if prompt['version'] != journal['prompt']['version']: raise ValueError('Published request changed')
            result_path = directory / 'retained-render-result.json'
            if result_path.exists(): return load(result_path)
            if len(journal['attempts']) >= 3: raise ValueError('Retained completion resume budget exhausted')
            from renderer import module_at, execution_manifest, with_quality, adapt_quality_verification
            engine = module_at('distonyc_retained_engine', Path(config['engine_resources']) / 'engine_tasks.py')
            engine.save = save
            if action == 'finalize':
                manifest = load(work / 'desktop-job.json')
                engine.validate_saved(work, manifest)
                state = load(work / 'desktop-status.json')
                if not {task['name'] for task in manifest['tasks']}.issubset(state['completed']):
                    raise ValueError('All retained audio stages must finish before final verification')
                archive_preview_marker(work, directory)
                adapt_quality_verification(engine)
                result = with_quality(engine.verify_work(work, config['settings']['output_dir']))
                result['voice_model'] = 'v6'
                if request.get('generation_profile') == 'v8': result['generation_profile'] = 'v8'
                save(result_path, result)
                state.update(status='completed', stage='completed', pid=None, error=None)
                save(work / 'desktop-status.json', state)
                journal['status'] = 'rendered'; save(journal_path, journal)
                return result
            adapt_quality_verification(engine)
            with engine.gpu_lock(config['settings']['studio_dir']):
                manifest = load(work / 'desktop-job.json')
                engine.validate_saved(work, manifest)
                state = load(work / 'desktop-status.json')
                if not {'generate', 'separate', 'words'}.issubset(state['completed']):
                    raise ValueError('Retained composition stages are incomplete')
                execution = execution_manifest(manifest, instrumental_heavy=True,
                                               vocal_dropout_warnings=config.get('vocal_dropout_warnings', False))
                archive_preview_marker(work, directory)
                if any(task['name'] in {'generate', 'separate', 'words'} and task['name'] not in state['completed']
                       for task in execution['tasks']): raise ValueError('New composition is forbidden')
                journal['attempts'].append({'at': utc(), 'stage': state['stage']})
                journal['status'] = 'rendering'; save(journal_path, journal)
                try:
                    result = with_quality(engine.execute_stages(work, execution))
                except Exception as error:
                    journal.update(status='needs_attention', error=str(error)); save(journal_path, journal)
                    raise
                result['voice_model'] = 'v6'
                if request.get('generation_profile') == 'v8': result['generation_profile'] = 'v8'
                save(result_path, result)
                journal['status'] = 'rendered'; save(journal_path, journal)
                return result
        if action == 'publish':
            from worker import metadata
            from publish import upload_asset
            result = load(directory / 'retained-render-result.json')
            mp3, meta = metadata(config, request['plan'], result)
            prior = journal['prompt']['result']
            if 'unconverted_vocals' in meta.get('validationFailures', []): raise ValueError('Tony conversion is incomplete')
            if any(meta.get(key) != prior.get(key) for key in ('title', 'generationProfile', 'voiceModel', 'collections')):
                raise ValueError('Retained recording identity changed')
            if any(meta['lyrics'][key] != prior['lyrics'][key] for key in ('text', 'kind')):
                raise ValueError('Retained recording lyrics changed')
            payload = {'version': journal['prompt']['version'], 'priorSha256': prior['sha256'],
                       'requestId': journal['request_id'], 'result': meta}
            trim = load(Path(result['work_path']) / 'mix-results.json').get('quiet_tail_trim')
            if abs(meta['duration'] - prior['duration']) > 1:
                if (not trim or trim.get('status') != 'ready' or
                        abs(trim['source_duration'] - prior['duration']) >= .01 or
                        abs(trim['output_duration'] - meta['duration']) >= .01):
                    raise ValueError('Retained duration changed without verified silence trimming')
                payload['quietTailTrim'] = trim
            if journal.get('payload') and journal['payload'] != payload:
                # A duration-rejected first upload can add verified trim evidence only.
                without_trim = {key: value for key, value in payload.items() if key != 'quietTailTrim'}
                if (not prompt.get('recordingCompletion') and 'quietTailTrim' in payload and
                        journal['payload'] == without_trim):
                    save(directory / 'retained-duration-rejected-payload.json', journal['payload'])
                else:
                    raise ValueError('Completion replay changed')
            journal['payload'] = payload; save(journal_path, journal)
            upload_asset(config, journal['prompt']['songId'], meta, mp3, directory)
            prompt = api.call('/prompts/' + wanted + '/complete-retained-vocals', payload, timeout=120)['prompt']
            save(directory / 'retained-published.json', prompt)
            if (directory / 'delivery-check.json').exists() and not (directory / 'retained-prior-delivery.json').exists():
                (directory / 'delivery-check.json').rename(directory / 'retained-prior-delivery.json')
            save(directory / 'render-result.json', result)
            journal['status'] = 'published'; save(journal_path, journal)
        elif action != 'verify': raise ValueError('Unknown retained completion action')
        from delivery_check import verify_delivery
        return verify_delivery(config, prompt)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--request', required=True)
    parser.add_argument('--action', required=True, choices=('authorize', 'render', 'finalize', 'publish', 'verify'))
    parser.add_argument('--reason', default='')
    args = parser.parse_args()
    config = load(args.config)
    api = API(config['api'], config['worker_id'], os.environ.pop('DISTONYC_WORKER_TOKEN'))
    result = run(config, api, args.request, args.action, args.reason)
    print({'status': result.get('status'), 'request': args.request})
