"""One native scheduled run. Empty queues never invoke a model or acquire the GPU."""
import argparse, json, os, secrets, sys, threading, time, traceback, uuid
from pathlib import Path
from common import API, APIError, inside, load, save, sha, singleton, utc
from winprocess import Stopped, run_owned
from planner import make_plan
from publish import upload, update_catalog
from public_plan import public_plan
from lyrics import make_sheet, export_sheet
from voice_models import selected
from remix_sources import CAPABILITY as REMIX_CAPABILITY, resolve as remix_basis, register as register_remix

TERMINAL = {'published', 'failed', 'canceled'}

def basis_files(config, prompt):
    if prompt['details'].get('remixSource'):
        if prompt['details'].get('basisSongIds'): raise ValueError('A catalog remix requires exactly one attached recording')
        return [remix_basis(config, prompt['details']['remixSource'])]
    songs = {item['id']: item for item in load(config['basis_catalog'])['songs']}
    identifiers = prompt['details'].get('basisSongIds', [])
    # Preserve requests submitted before the dropdown existed. Resolve only one exact catalog title.
    if 'basisSongIds' not in prompt['details'] and prompt['details'].get('source'):
        source = prompt['details']['source'].strip().strip('\"\'').casefold()
        matches = [song['id'] for song in songs.values() if song.get('title', '').casefold() == source]
        if len(matches) == 1: identifiers = matches
    if len(identifiers) > 5 or len(set(identifiers)) != len(identifiers): raise ValueError('Invalid basis selection')
    result = []
    for identifier in identifiers:
        if identifier not in songs: raise ValueError('A selected basis song is missing from this PC catalog')
        song = songs[identifier]; path = inside(Path(config['basis_root']) / song['relativePath'], config['basis_root'])
        if not path.is_file(): raise ValueError('A selected basis recording is missing on this PC')
        result.append({**song, 'path': str(path), 'sha256': sha(path)})
    return result

class Heartbeat:
    def __init__(self, api, prompt, lease, directory, health):
        self.api, self.prompt, self.lease, self.directory, self.health = api, prompt, lease, Path(directory), health
        self.last_ok = time.monotonic(); self.reason = None; self.done = threading.Event(); self.stage = 'Planning the song'
        self.thread = threading.Thread(target=self.loop, daemon=True)
    def beat(self):
        progress = {'stage': self.stage, 'percent': 0}
        try:
            if self.stage == 'Rendering' and (self.directory / 'progress.json').exists(): progress = load(self.directory / 'progress.json')
        except (OSError, ValueError): pass
        response = self.api.call(f"/prompts/{self.prompt['id']}/heartbeat", {'leaseToken': self.lease, **progress})
        self.prompt = response['prompt']; self.last_ok = time.monotonic()
        save(self.health, {'at': utc(), 'status': self.prompt['status'], 'promptId': self.prompt['id'], **progress})
        if self.prompt['status'] == 'cancel_requested': self.reason = 'cancel'
    def loop(self):
        while not self.done.wait(25):
            try: self.beat()
            except APIError as error:
                if error.status in [401, 403, 404, 409]: self.reason = 'lease'
            except (OSError, ValueError): pass
            if self.stopped(): return
    def stopped(self):
        if not self.reason and time.monotonic() - self.last_ok > 90: self.reason = 'offline'
        return bool(self.reason)
    def start(self): self.beat(); self.thread.start(); return self
    def close(self):
        self.done.set()
        if self.thread.is_alive(): self.thread.join(timeout=30)

def metadata(config, plan, result, voice_model='v6'):
    if result.get('status') != 'verified' or result.get('new_training') is not False: raise ValueError('The renderer did not verify the saved Tony voice mix')
    if result.get('voice_model', 'v6') != voice_model: raise ValueError('The rendered voice model differs from the confirmed request')
    files = result.get('files', [])
    if {Path(item['path']).suffix.lower() for item in files} != {'.mp3', '.wav'}: raise ValueError('Both verified MP3 and WAV are required')
    for item in files:
        path = inside(item['path'], Path(config['settings']['output_dir']) / (Path(item['path']).suffix[1:] + 's'))
        if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']: raise ValueError('A rendered file changed')
    mp3 = next(item for item in files if Path(item['path']).suffix.lower() == '.mp3')
    sheet = make_sheet(config, plan, result)
    export_sheet(config, mp3['path'], plan['title'], sheet)
    return mp3['path'], {'title': plan['title'], 'duration': result['duration'], 'bytes': mp3['bytes'], 'sha256': mp3['sha256'],
                         'voiceModel': voice_model,
                         'lyrics': sheet, 'collections': ['distonyc', 'fearhunger'] if plan.get('fear_hunger') else ['distonyc'],
                         **({'qualityIssues': result['qualityIssues']} if result.get('qualityIssues') else {})}

def new_claim(path):
    claim = {'claimId': str(uuid.uuid4()), 'leaseToken': secrets.token_urlsafe(40)}
    save(path, claim); return claim

def run_once(config, api, verify_existing=None):
    state = Path(config['state_dir']); state.mkdir(parents=True, exist_ok=True)
    journal = state / 'claim.json'; health = state / 'health.json'
    claim = load(journal) if journal.exists() else new_claim(journal)
    if claim.get('promptId'):
        previous = api.call('/prompts/' + claim['promptId'])['prompt']
        if previous['status'] in TERMINAL:
            if previous['status'] == 'published':
                update_catalog(config, previous)
                register_remix(config, api, previous)
            journal.unlink(); save(health, {'at': utc(), 'status': previous['status'], 'promptId': previous['id']}); return
    capabilities = ['request-materials-v1'] + ([REMIX_CAPABILITY] if config.get('catalog_remix') else [])
    try: prompt = api.call('/claim', {**claim, 'capabilities': capabilities})['prompt']
    except APIError as error:
        if error.status != 410: raise
        claim = new_claim(journal); prompt = api.call('/claim', {**claim, 'capabilities': capabilities})['prompt']
    if not prompt:
        journal.unlink(); save(health, {'at': utc(), 'status': 'idle'}); return
    claim['promptId'] = prompt['id']; save(journal, claim)
    directory = inside(state / 'jobs' / prompt['id'], state / 'jobs'); directory.mkdir(parents=True, exist_ok=True)
    save(directory / 'prompt.json', prompt)
    if prompt['status'] in TERMINAL:
        if prompt['status'] == 'published':
            update_catalog(config, prompt)
            register_remix(config, api, prompt)
        journal.unlink(); return
    heartbeat = Heartbeat(api, prompt, claim['leaseToken'], directory, health)
    def action(name, **body):
        return api.call(f"/prompts/{prompt['id']}/{name}", {'leaseToken': claim['leaseToken'], **body}, timeout=150 if name == 'publish' else 25)['prompt']
    try:
        heartbeat.start()
        if heartbeat.stopped(): raise Stopped('Cancellation requested')
        result_file = directory / 'render-result.json'
        if prompt['status'] == 'processing':
            voice_model = selected(prompt)
            basis = basis_files(config, prompt)
            # The model receives creative metadata; local paths remain in the trusted renderer input.
            plan = make_plan(config, prompt, directory, basis, heartbeat.stopped)
            if plan['recipe'] == 'needs_attention': raise ValueError(plan['explanation'])
            # Save the accepted musical plan before rendering; retries reuse this snapshot.
            prompt = action('plan', songPlan=public_plan(plan))
            if not result_file.exists():
                request = {'config': config, 'prompt_id': prompt['id'], 'plan': plan, 'basis': basis, 'directory': str(directory),
                    'voice_model': voice_model}
                if verify_existing: request['verify_existing'] = str(Path(verify_existing).resolve())
                from frozen_request import reuse_or_save
                request = reuse_or_save(directory / 'render-request.json', request)
                heartbeat.stage = 'Rendering'
                error_file = directory / 'renderer-error.json'; error_file.unlink(missing_ok=True)
                try:
                    run_owned([config['settings']['python'], str(Path(__file__).with_name('renderer.py')), '--request', str(directory / 'render-request.json'), '--gate', str(directory / 'start.gate')],
                        directory, directory / 'renderer.log', heartbeat.stopped, gate=directory / 'start.gate')
                except RuntimeError:
                    if error_file.exists(): raise RuntimeError(load(error_file)['message']) from None
                    raise
            mp3, completed = metadata(config, plan, load(result_file), voice_model)
            prompt = action('complete', result=completed)
        else:
            if not result_file.exists(): raise ValueError('This PC is missing the completed mix. Restore its saved job folder before publishing.')
            plan = load(directory / 'plan.json')['plan']
            voice_model = selected(prompt)
            mp3, completed = metadata(config, plan, load(result_file), voice_model)
            # Finish pre-upgrade publications with their original immutable metadata.
            if any(completed.get(key) != value for key, value in prompt['result'].items()): raise ValueError('The saved mix differs from the server result')
        if heartbeat.stopped(): raise Stopped('Cancellation or lease loss')
        if prompt['status'] == 'completed': prompt = action('publishing')
        heartbeat.stage = 'Publishing the verified MP3'
        upload(config, prompt, mp3, directory, heartbeat.stopped)
        if heartbeat.stopped(): raise Stopped('Lease lost during publication')
        prompt = action('publish')
        heartbeat.close()
        update_catalog(config, prompt)
        register_remix(config, api, prompt)
        save(health, {'at': utc(), 'status': 'published', 'promptId': prompt['id'], 'url': prompt['releaseUrl']})
        journal.unlink()
    except Stopped:
        heartbeat.close()
        if heartbeat.reason == 'cancel':
            action('cancel'); journal.unlink(); save(health, {'at': utc(), 'status': 'canceled', 'promptId': prompt['id']})
        else: raise
    except (APIError, OSError):
        # A transport response may be lost after the server commits a transition.
        # Retain the claim so the next run reconciles instead of failing that work.
        raise
    except Exception as error:
        stage = heartbeat.stage
        if stage == 'Rendering':
            try: stage = load(directory / 'progress.json').get('stage', stage)
            except (OSError, ValueError, AttributeError): pass
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else (
            f'{stage} failed: {type(error).__name__}: {error}. Saved work is retained; Retry resumes completed stages.')
        try:
            failure = {'at': utc(), 'stage': stage, 'version': prompt.get('version'),
                'type': type(error).__name__, 'message': message, 'traceback': traceback.format_exc()[-16000:]}
            save(directory / 'worker-error.json', failure)
            save(directory / 'failures' / (str(uuid.uuid4()) + '.json'), failure)
        except (OSError, ValueError): pass
        # Flush the latest stage instead of leaving a previous heartbeat's label.
        confirmed = False
        if not heartbeat.stopped():
            try: heartbeat.beat(); confirmed = True
            except APIError as refresh_error:
                if refresh_error.status in (401, 403, 404, 409): heartbeat.reason = 'lease'
            except (OSError, ValueError): pass
        heartbeat.close()
        # Publication is a durable finalization step: never rerender a completed mix after an upload outage.
        if confirmed and heartbeat.prompt['status'] in ['processing', 'completed'] and not heartbeat.stopped():
            try:
                action('fail', error=message[:1000], automaticRecovery=config.get('recovery_status_api', False)); journal.unlink()
            except (APIError, OSError): pass
        raise
    finally: heartbeat.close()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--verify-existing', type=Path, help='Operator-only delivery test; verifies an already completed Troofs work folder')
    args = parser.parse_args(); config = load(args.config)
    token = os.environ.pop('DISTONYC_WORKER_TOKEN', '')
    if len(token) < 32: raise ValueError('The DPAPI-protected worker credential was not loaded')
    state = Path(config['state_dir'])
    with singleton(state / 'worker.lock') as acquired:
        if not acquired: return
        try:
            api = API(config['api'], config['worker_id'], token)
            run_once(config, api, args.verify_existing)
            from remix_health import check_due
            check_due(config, api)
        except Exception as error:
            save(state / 'health.json', {'at': utc(), 'status': 'needs_attention', 'error': str(error)[:1000]})
            traceback.print_exc(); raise SystemExit(1)

if __name__ == '__main__': main()
